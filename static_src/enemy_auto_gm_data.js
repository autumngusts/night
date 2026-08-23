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
    // 以下：劇本2「咬噬之顎」／劇本3「知性之蟲」で遭遇するエネミー（大教會／小砦・小塔カード
    // 抽出分）。既存の「乱戦ダメージ修正が「—」の行は乱戦ダメージ無し」「対象明記が無ければ
    // 前衛均等割り」等のルールを踏襲。属性ダイス（例:「炎:1D」）は従来通りGM手動反映のため
    // elementAccumに含めない（固定値の場合のみelementAccumを使う、例:「出血:2」）。
    "soldier_knight|mausoleum_knight": {
      rows: [
        {
          // 「踏み込み突き＆転移」：乱戦ダメージ修正±0、対象明記無しのため既定ルール（前衛均等割り）。
          // 個別ダメージ180は「敵視:1以上」の後衛PC1体が対象だが、既存のtargetRule語彙に
          // 「後衛」を条件にできるkindが無いため、targetRuleは設定せず金額のみ記録する
          // （GMが本文の対象条件を見て手動で適用、数値を捏造しない）。特殊能力「転移」は
          // 対応するタグが無いため注記のみ。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180 }],
        },
        {
          // 「切り払い＆転移」：「敵視:1以上」のPC全員（前後衛問わず）が「乱戦ダメージ:2人分」の
          // 対象（本文に明記、前衛限定ではない）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「重撃」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ120は
          // 「敵視:最大」のPC1体。本文の「前回合で敵人が受けた◆の回数だけ+120」という動的加算は
          // 既存機構では追跡できないため反映しない（数値を捏造しない、GMが手動加算）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
      ],
    },
    "mage_messenger|sinners": {
      rows: [
        {
          // 「杖撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「罰の荊」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ120（出血:2は固定値の
          // ためelementAccum）を「敵視:1以上」のPC1体（対象不特定）に2回実行、輪流受傷
          // （distribution:"rotate"、ユーザー確認済み既定ルール）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            {
              amount: 120,
              repeat: 2,
              distribution: "rotate",
              targetRule: { kind: "aggroAtLeast1All" },
              elementAccum: [{ label: "出血", amount: 2 }],
            },
          ],
        },
        {
          // 「罪の荊」：乱戦ダメージ修正±0（出血:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。「乱戦ダメージ対象になった敵視最大PC全員に出血:1D」はHP損害を
          // 伴わない状態異常付与のみのためindividualDamageは設定しない（GM手動反映）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "strong_type|fire_monk_warrior": {
      rows: [
        {
          // 「連続突き」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「突進＆発火」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ120＋
          // 「炎:4」（固定値のためelementAccum）を「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "炎", amount: 4 }] }],
        },
        {
          // 「炎の嵐」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別効果は「炎:1D」
          // （属性ダイスのみ、HP損害を伴わないためindividualDamage無し）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "demihuman_beastfolk_club|lion_hybrids": {
      rows: [
        {
          // 「横薙ぎ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「溜め斬撃」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。個別効果は
          // 「敵視:最大のPC全員のみ」が〈11|体能〉判定を行う（対象を絞った判定のため、
          // 全PCが判定する前提のsavingThrow機構では表現できない、GMが手動判定・反映）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "soldier_knight|leyndell_knights": {
      rows: [
        {
          // 「群がる」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ「HP損害:■■■」＝
          // 実際に描かれた■の数（3、CLAUDE.md §17の□/■記法確認済みルール通り literal count）を
          // 「敵視:1以上」のPC全員に。体力骰消費による軽減はPC側任意選択のため自動計算しない。
          rollMin: 1,
          rollMax: 2,
          individualDamage: [{ amount: 3, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「大弓＆弩」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者0人なら前衛が対象
          // （本文に明記されたフォールバック規則）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「防御反撃」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。次のアクション
          // フェイズ終了までエネミーに「HP価値:+10（上限100）」する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
      ],
    },
    "troll_dragonkin_wormface|mad_flame_troll": {
      rows: [
        {
          // 「腕薙ぎ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「狂火」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。個別効果は「敵視:最大」
          // PC1体への「発狂:1D」（属性ダイスのみ、HP損害を伴わないためindividualDamage無し）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「狂火豪雨」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者0人なら前衛が対象
          // （本文に明記されたフォールバック規則、発狂:2Dは属性ダイスのためGM手動反映）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
      ],
    },
    "crystal_puppet|puppet_soldiers": {
      rows: [
        {
          // 「武器振り回し」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。「この乱戦ダメージを
          // 防御するPCは防御消耗+1」に対応するタグが無いため注記のみ（GM手動反映）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「乱射弓箭」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者0人なら前衛が対象。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「大暴れ」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。個別ダメージ180は
          // 「敵視:最大」のPC1体。この個別ダメージを回避するPCはダイスコストが半減する
          // （reducible_by_stamina_dice、既存タグと同じ効果）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "mage_messenger|war_sorcerers": {
      rows: [
        {
          // 「杖撃」：乱戦ダメージ修正±0、本文自体が無いため既定ルール（前衛均等割り）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「ヘイムの大槌」：乱戦ダメージ修正+120（魔:1Dは属性ダイスのためGM手動反映）、対象
          // 明記無しのため既定ルール。個別効果：「敵視:最大」PC1体の次アクションフェイズ体力骰-2
          // （stamina_dice_reduction_next_phase、HP損害を伴わないためindividualDamage無し）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「ヘイムの砲丸」：乱戦ダメージ修正+120（魔:1Dは属性ダイスのためGM手動反映）、対象
          // 明記無しのため既定ルール。個別効果は後衛PC1体への「魔:2D」（属性ダイスのみ、HP損害を
          // 伴わないためindividualDamage無し）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "demihuman_beastfolk_club|farum_azula_beastmen": {
      rows: [
        {
          // 「防御反撃」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。次のアクション
          // フェイズ終了までエネミーに「HP価値:+20（上限100）」する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「投擲刀」：乱戦ダメージ修正－60（雷:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。個別ダメージ120を「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「落雷」：乱戦ダメージ修正－120（雷:2Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "formless_other|man_bats": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「音波攻撃」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ120を
          // 「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「爪撃＆滞空」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。次のアクション
          // フェイズ開始時、PC全員が出目に関わらず後衛へ強制配置される（既存タグ流用）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase"],
        },
      ],
    },
    "mage_messenger|perfumers": {
      rows: [
        {
          // 「火花の香」：乱戦ダメージ修正－120（炎:2Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果は「敵視:1以上」PC全員への「炎:1D」（属性ダイスのみ、
          // HP損害を伴わないためindividualDamage無し）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「高揚の香」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。次のアクションフェイズ
          // 終了までエネミーに「HP価値:+30（上限100）」する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「毒の噴霧」：乱戦ダメージ修正－120（猛毒:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果はPC全員〈11|運試し〉、失敗者は「猛毒:2D」（HP損害を
          // 伴わない状態異常のみのためsavingThrow/individualDamageは設定しない、GM手動反映）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "undead|rotten_undead": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「振り拳攻撃」：乱戦ダメージ修正+60、本文自体が無いため既定ルール（前衛均等割り）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ180を
          // 「敵視:最大」のPC全員（同点は全員該当、aggroMaxが対応）に、ガード不可。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    "warrior_swordsman|blood_noble": {
      rows: [
        {
          // 「突進突き＆噛みつき」：乱戦ダメージ修正+60＋「出血:2」（固定値のためelementAccum）、
          // 対象明記無しのため既定ルール。個別ダメージ120＋「出血:2」を「敵視:最大」のPC1体に。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60, elementAccum: [{ label: "出血", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "出血", amount: 2 }] }],
        },
        {
          // 「連続突き＆迂回」：乱戦ダメージ修正が「－」（ダッシュ表記）のため発生しない。次の
          // アクションフェイズ終了までエネミーに「HP価値:+10（上限100）」する。個別効果
          // （PC人数回実行、既存の「PC人数回実行」解釈を踏襲＝対象全員に1回ずつ）：
          // 「敵視:1以上」の前衛PC全員に個別ダメージ180＋「出血:3」（固定値）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            { amount: 180, targetRule: { kind: "frontAggroAtLeast1All" }, elementAccum: [{ label: "出血", amount: 3 }] },
          ],
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「血の茨」：乱戦ダメージ修正±0（出血:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。個別効果は「敵視:1以上」PC全員〈12|運試し〉、成功でも出血:1・失敗で
          // 出血:1Dが発生する（成功時にも効果があるためsavingThrow.onFail機構では表現できない、
          // HP損害を伴わないためGM手動反映）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "warrior_swordsman|zamor_ancient_hero": {
      rows: [
        {
          // 「曲剣斬り」：乱戦ダメージ修正+60、対象明記無しのため既定ルール。この乱戦ダメージを
          // 回避するPCはダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「拒絶の霜」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ「HP損害:■■」＝
          // 実際に描かれた■の数（2、literal count）をPC全員に。体力骰消費による軽減はPC側任意
          // 選択のため自動計算しない。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 2, targetRule: { kind: "allPCs" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「暴雪吐息」：乱戦ダメージ修正±0（凍傷:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別ダメージ120を「敵視:1以上」のPC全員に。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "big_dog_bear|rune_bear": {
      rows: [
        {
          // 「腕振り回し」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別効果：
          // 「敵視:1以上」PC全員の次アクションフェイズ体力骰-1（HP損害を伴わないため
          // individualDamage無し）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「伏せ叩き」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。この乱戦ダメージを
          // 回避するPCはダイスコストが半減する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「抱きしめ」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ300を
          // 「敵視:最大」のPC1体に、ガード不可。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    // 出目が範囲でなく単一値（1~6の各値ごとに1行）の系統。
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
          // 「連続踏みつけ」：乱戦ダメージは2回発生する。対象明記無しのため既定ルール。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「腕薙ぎ」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。個別効果は
          // 「敵視:1以上」PC全員への「呪死:2」（固定値だがHP損害を伴わない状態異常のみのため
          // individualDamageは設定しない）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ240
          // （呪死:1Dは属性ダイスのためGM手動反映）を「敵視:最大」のPC1体に。
          rollMin: 4,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「吐き出し」：乱戦ダメージ修正－120（呪死:1Dは属性ダイスのためGM手動反映）、対象
          // 明記無しのため既定ルール。個別ダメージ120＋「呪死:2」（固定値）を「敵視:1以上」の
          // PC全員に。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "呪死", amount: 2 }] }],
        },
        {
          // 「死の瘴気」：乱戦ダメージ修正が「—」のため発生しない。次のアクションフェイズ終了まで
          // エネミーに「HP価値:+20（上限100）」する。個別効果は「敵視:1以上→12／それ以外→10」の
          // 運試し判定、失敗者は「呪死:1D」（HP損害を伴わない状態異常のみのためsavingThrow機構は
          // 使わずGM手動反映）。
          rollMin: 6,
          rollMax: 6,
          conditions: ["enemy_hp_value_buff"],
        },
      ],
    },
    "warrior_swordsman|cursed_swordsman": {
      rows: [
        {
          // 「円刃剣の舞」：乱戦ダメージ修正±0（出血:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別ダメージ60（出血:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:最大」のPC1体に。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 60, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「短剣投擲」：乱戦ダメージ修正－60（出血:1Dは属性ダイスのためGM手動反映）。乱戦
          // ダメージの基本対象はPC全員だが、「敵視:1以上」の前衛PCのみ「2人分」の重み付けを
          // 受ける複合ルールで、既存のtargetRule語彙に一致するものが無いため、targetRuleは
          // 設定せず合計傷害値のみ算出する（GMが本文を見て手動で振り分ける、edele「突進」と
          // 同種の扱い）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
        },
        {
          // 「奇襲＆闇に潜む」：乱戦ダメージ修正+120（出血:1Dは属性ダイスのためGM手動反映）、
          // 対象明記無しのため既定ルール。「乱戦ダメージ対象になった敵視最大PC1体は〈12|精神〉を
          // 行い、失敗でこの乱戦ダメージにガード不可」という条件付き判定は既存のsavingThrow機構
          // （常に全PCが判定する前提）では表現できないため、GM手動判定に委ねる。特殊能力
          // 「闇に潜む」は対応するタグが無いため注記のみ。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "formless_other|spider_scorpions": {
      rows: [
        {
          // 「毒液噴射」：乱戦ダメージ修正±0（猛毒:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果は「敵視:最大」PC1体への「猛毒:1D」（HP損害を伴わない
          // ためindividualDamage無し）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「剪撃連続攻撃」：乱戦ダメージは2回発生する。対象明記無しのため既定ルール。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -240, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ180（猛毒:1Dは
          // 属性ダイスのためGM手動反映）を「敵視:最大」のPC全員に、ガード不可。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    "rat_basilisk|big_rats": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「飛びかかり」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別効果：
          // 「敵視:最大」のPC1体に追加個別ダメージ120。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「引っかき」：乱戦ダメージ修正+60、本文自体が無いため既定ルール（前衛均等割り）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "demihuman_beastfolk_club|hybrids": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「射撃攻撃」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。個別ダメージ120を
          // 「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「前転攻撃」：乱戦ダメージ修正+120、本文自体が無いため既定ルール（前衛均等割り）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    // 以下：劇本2/劇本3のPlaywright全流程playthrough（tools/field_card_sweep/
    // scenario23_full_playthrough.js）で複数回試行して実際に遭遇したエネミー
    // （大野營地／坑道／湖沼／封牢／魔術師之塔／教會／砦カード等の抽出分）。
    "strong_type|pumpkin_helm_madman": {
      rows: [
        {
          // 「棍棒振り回し」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「棍棒叩きつけ」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者0人なら前衛が対象。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「頭突き連打」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ180
          // （PC人数回実行、既存解釈＝対象全員に1回ずつ）を「敵視:1以上」の前衛PC全員に。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 180, targetRule: { kind: "frontAggroAtLeast1All" } }],
        },
      ],
    },
    "demihuman_beastfolk_club|rot_kindred": {
      rows: [
        {
          // 「大鎌薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「回り込み」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。この乱戦ダメージを
          // 回避するPCはダイスコストが半減する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「蟲の糸」：乱戦ダメージ修正が「—」のため発生しない。個別効果（PC人数回実行、既存解釈＝
          // 対象全員に1回ずつ）：「敵視:1以上」のPC1体に個別ダメージ120。この個別ダメージを
          // 回避するPCはダイスコストが半減する（防御消耗+1に対応するタグは無いため注記のみ）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "strong_type|omen_children": {
      rows: [
        {
          // 「大刀振り回し」：乱戦ダメージ修正±0（聖:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果は「敵視:最大」PC全員への「聖:1D」（HP損害を伴わない
          // ためindividualDamage無し）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ240（聖:1Dは属性
          // ダイスのためGM手動反映）を「敵視:最大」のPC全員に、ガード不可。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「光弾爆発」：乱戦ダメージ修正±0（聖:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。個別ダメージ180（聖:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:1以上」のPC全員に。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "grafted|grafted_prince": {
      rows: [
        {
          // 「連続攻撃」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ240を
          // 「敵視:最大」のPC1体に。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「防御反撃」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。本文の「この敵人が
          // 今回合の行動階段で受けた◆の回数だけ+120」という動的加算は既存機構では追跡できない
          // ため反映しない（数値を捏造しない、GMが手動加算）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「咆哮＆連続突き」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ「HP損害:■■」
          // ＝実際に描かれた■の数（2、literal count）を前衛PC全員に。加えて個別ダメージ120
          // （執行2回、対象「敵視:1以上」PC1体・不特定、輪流受傷）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [
            { amount: 2, targetRule: { kind: "frontAll" } },
            { amount: 120, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "troll_dragonkin_wormface|dragonkin_soldier": {
      rows: [
        {
          // 「腕薙ぎ払い」：乱戦ダメージ修正+60、対象明記無しのため既定ルール。個別ダメージ180を
          // 「敵視:1以上」のPC全員に。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「両腕叩きつけ」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。「敵視:1以上」の
          // PC全員が防御時に防御消耗+1になる効果は対応するタグが無いため注記のみ。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ300を
          // 「敵視:最大」のPC1体に、ガード不可。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    "soldier_knight|hound_knight": {
      rows: [
        {
          // 「踏み込み斬撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「猟犬剣技＆後跳び」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。次のアクション
          // フェイズ終了までエネミーに「HP価値:+10（上限100）」する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「地擦り斬り＆掬い斬り」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ
          // 180を「前衛の中で敵視:最大」のPC全員に。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "frontAggroMaxAll" } }],
        },
      ],
    },
    "mage_messenger|glintstone_sorcerers": {
      rows: [
        {
          // 「拳打」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「輝石飛石」：乱戦ダメージ修正－60（魔:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別ダメージ120（魔:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「渦の飛石」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者0人なら前衛が対象
          // （魔:2Dは属性ダイスのためGM手動反映）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
      ],
    },
    "crystal_puppet|crystal_people": {
      rows: [
        {
          // 「連続槍突き」：乱戦ダメージ修正－120、対象明記無しのため既定ルール。個別効果
          // （執行2回）：「敵視:1以上」のPC1体（対象不特定）に個別ダメージ120、輪流受傷。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「輪刃回転斬り」：乱戦ダメージ修正+120（魔:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果は「敵視:1以上」PC全員への「魔:1D」（HP損害を伴わない
          // ためindividualDamage無し）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「結晶散乱」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記、
          // 魔:2Dは属性ダイスのためGM手動反映）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
      ],
    },
    // 出目が範囲でなく単一値（1~6の各値ごとに1行）の系統。
    "grafted|royal_wraith": {
      rows: [
        {
          // 「猛追」：乱戦ダメージ修正が「—」のため発生しない。個別効果（PC人数+1回実行、既存の
          // 「PC人数回実行」解釈を踏襲＝対象全員に1回ずつ、超過分1回は反映しない）：
          // 「敵視:1以上」のPC1体に個別ダメージ120＋「猛毒:1」（固定値のためelementAccum）。
          rollMin: 1,
          rollMax: 1,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "猛毒", amount: 1 }] }],
        },
        {
          // 「回転殴打＆転移」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「毒吐き」：乱戦ダメージ修正－120（猛毒:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別ダメージ180（猛毒:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「叩きつけ＆転移」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。個別効果：
          // 「敵視:1以上」PC全員の次アクションフェイズ体力骰-1（HP損害を伴わないため
          // individualDamage無し）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「光弾爆発」：乱戦ダメージ修正±0（聖:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。個別ダメージ180（聖:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:1以上」のPC全員に。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「死の叫び」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ「HP損害:■■■」＝
          // 実際に描かれた■の数（3、literal count）を「敵視:1以上」のPC全員に。
          rollMin: 6,
          rollMax: 6,
          individualDamage: [{ amount: 3, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "warrior_swordsman|stoneskin_kings": {
      rows: [
        {
          // 「踏み込み薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「重力弾＆引力波」：乱戦ダメージ修正±0（魔:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別ダメージ180（魔:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:最大」のPC1体に。次のアクションフェイズ開始時、PC全員が骰目に関わらず前衛へ
          // 強制配置される（force_back_row_next_phaseの対称タグとしてforce_front_row_next_phase
          // を新設、既存のforce_back同様コードからは未消費の記録用タグ）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["force_front_row_next_phase"],
        },
        {
          // 「隕石＆斥力波」：乱戦ダメージ修正が「—」のため発生しない。次のアクションフェイズ開始時、
          // PC全員が骰目に関わらず後衛へ強制配置される（既存タグ）。個別効果（PC人数+1回実行、
          // 既存解釈＝対象全員に1回ずつ）：「敵視:1以上」のPC1体に個別ダメージ120
          // （魔:1Dは属性ダイスのためGM手動反映）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["force_back_row_next_phase"],
        },
      ],
    },
    "warrior_swordsman|black_blade_assassin": {
      rows: [
        {
          // 「突入斬り」：乱戦ダメージ修正±0（出血:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。個別効果は「敵視:1以上」PC全員への「出血:1D」（HP損害を伴わないため
          // individualDamage無し）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み捕らえ＆跳躍」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。個別ダメージ
          // 180を「敵視:最大」のPC1体に、ガード不可。特殊能力「跳躍」は対応するタグが無いため注記
          // のみ。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「死の刃＆跳躍」：乱戦ダメージ修正－120（出血:1Dは属性ダイスのためGM手動反映）、対象
          // 明記無しのため既定ルール。個別ダメージ120（出血:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:最大」のPC1体に、ガード不可。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    // 出目が範囲でなく単一値（1~6の各値ごとに1行）の系統。
    "dragon|ancient_dragon": {
      rows: [
        {
          // 「尻尾振り回し」：「敵視:1以上」のPC全員が「乱戦ダメージ:3人分」の対象（本文に明記、
          // 前衛限定ではない）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「爪撃」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者0人なら前衛が対象。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「空中回転＆滞空」：乱戦ダメージ修正が「—」のため発生しない。個別効果はPC全員
          // 〈11|運試し〉、半数以上失敗で「時間流逝」累積という多数決条件のため、既存機構
          // （常に個々のPCに対して成否判定するsavingThrow）では表現できない、GM手動判定に委ねる。
          // 特殊能力「滞空」は対応するタグが無いため注記のみ。
          rollMin: 3,
          rollMax: 3,
        },
        {
          // 「這いずり赤雷」：乱戦ダメージ修正－120（雷:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果は判定（敵視:1以上→目標12／それ以外→目標10、体能）、
          // 失敗者に個別ダメージ240（雷:1Dは属性ダイスのためGM手動反映）。
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
            onFail: { amount: 240 },
          },
        },
        {
          // 「赤雷叩きつけ」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別効果は
          // 「敵視:1以上」PC限定の〈11|体能〉判定（対象を絞った判定のため、全PCが判定する前提の
          // savingThrow機構では表現できない、GM手動判定に委ねる、雷:1Dは属性ダイスのためGM手動
          // 反映）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「炎息＆滞空」：乱戦ダメージ修正±0（炎:2Dは属性ダイスのためGM手動反映）、PC全員
          // （前後衛問わず）が対象（本文に明記）。特殊能力「滞空」は対応するタグが無いため注記
          // のみ。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "allPCs" },
        },
      ],
    },
    "death_bird_raven|death_ritual_bird": {
      rows: [
        {
          // 「槍振り」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「尻尾振り回し＆飛び退き」：「敵視:1以上」のPC全員が「乱戦ダメージ:3人分」の対象
          // （本文に明記、前衛限定ではない）。特殊能力「飛び退き」は対応するタグが無いため注記のみ。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「噛みつき」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ240（凍傷:2Dは属性
          // ダイスのためGM手動反映）を「敵視:最大」のPC1体に、ガード不可。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「霊炎発火」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ180
          // （炎:1D＋凍傷:1Dは属性ダイスのためGM手動反映）を「敵視:1以上」のPC全員に。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「槍を呼ぶ＆飛び退き」：乱戦ダメージ修正+180（炎:1D＋凍傷:1Dは属性ダイスのためGM手動
          // 反映）、PC全員（前後衛問わず）が対象（本文に明記）。個別効果は「敵視:1以上」PC全員への
          // 「炎:1D」＋「凍傷:1D」（HP損害を伴わないためindividualDamage無し）。特殊能力
          // 「飛び退き」は対応するタグが無いため注記のみ。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "allPCs" },
        },
        {
          // 「古き死の怨霊」：乱戦ダメージ修正が「—」のため発生しない。個別効果（PC人数回実行、
          // 既存解釈＝対象全員に1回ずつ）：「敵視:1以上」のPC1体に個別ダメージ180
          // （炎:1D＋凍傷:1Dは属性ダイスのためGM手動反映）。
          rollMin: 6,
          rollMax: 6,
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "strong_type|divine_skin_apostles": {
      rows: [
        {
          // 「双刃剣乱舞」：前衛の中で「敵視:最大」のPC全員に「乱戦ダメージ:3人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「連続突き」：乱戦ダメージ修正－60、対象明記無しのため既定ルール。個別効果（執行2回）：
          // 「敵視:1以上」のPC1体（対象不特定）に個別ダメージ180、輪流受傷。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「黒炎投擲」：乱戦ダメージ修正±0（炎:1Dは属性ダイスのためGM手動反映）。乱戦ダメージは
          // 前衛ではなく後衛が対象、後衛不在なら前衛が対象（本文に明記、新設backAllキンドを使用）。
          // 個別効果は「敵視:1以上」PC全員への「炎:1D」＋特殊能力「黒炎の侵蝕」（HP損害を伴わない
          // ためindividualDamage無し、特殊能力は対応するタグが無いため注記のみ）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "backAll", fallback: "front" },
        },
        {
          // 「連合攻撃」：乱戦ダメージは2回発生する。「敵視:1以上」で前衛のPC全員に
          // 「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -180, repeat: 2 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「肉弾戦車」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。本文の「敵視:最大の
          // PC全員はこの乱戦ダメージに対してガード不可」は対象全体ではなく一部のみへの制限のため、
          // 既存の行単位conditionsでは正確に表現できず注記のみに留める（GMが手動適用）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「黒炎乱舞」：乱戦ダメージ修正+60（炎:1Dは属性ダイスのためGM手動反映）、対象明記無しの
          // ため既定ルール。個別ダメージ120（炎:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:1以上」のPC全員に。特殊能力「黒炎の侵蝕」は対応するタグが無いため注記のみ。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "troll_dragonkin_wormface|troll": {
      rows: [
        {
          // 「拳打叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「踏みつけ」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。個別効果：
          // 「敵視:1以上」PC全員の次アクションフェイズ体力骰-1（HP損害を伴わないため
          // individualDamage無し）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「剣薙ぎ払い」：乱戦ダメージ修正－240、基本対象は明記無しのため既定ルール（前衛均等
          // 割り）。本文の「通常の乱戦ダメージ処理後、前衛の敵視:1以上のPC全員に追加でもう1回
          // 乱戦ダメージを分配する」は、既存のgroupDamage.repeat（同一対象へのN回専用）では
          // 対象が異なるため表現できず、追加分はGM手動適用に委ねる。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -240 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "crustacean|big_crayfish": {
      rows: [
        {
          // 「爪突き刺し」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ120を
          // 「敵視:最大」のPC1体に、加えて次アクションフェイズ体力骰-1。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「水鉄砲」：乱戦ダメージ修正－120、対象明記無しのため既定ルール。この乱戦ダメージを
          // 回避するPCはダイスコストが半減する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「挟み込み拘束」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ240を
          // 「敵視:最大」のPC1体に、ガード不可。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    "golem_maiden_puppet|kidnapper_maiden_puppets": {
      rows: [
        {
          // 「刃刀回転突撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「刃刀投擲」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ180を
          // 「敵視:最大」のPC1体に。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「少女の抱擁」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ360を
          // 「敵視:最大」のPC1体に、ガード不可。この個別ダメージを回避するPCはダイスコストが
          // 半減する。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 360, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard", "reducible_by_stamina_dice"],
        },
      ],
    },
    "imp_watchdog_gargoyle|grave_guardian_birds": {
      rows: [
        {
          // 「嘴つつき」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「眠りの霧」：乱戦ダメージ修正が「—」のため発生しない。個別効果はPC全員〈11|精神〉、
          // 失敗者は「睡眠:2D」（HP損害を伴わない状態異常のみのためsavingThrow/individualDamage
          // は設定しない、GM手動反映）。
          rollMin: 3,
          rollMax: 4,
        },
        {
          // 「光輪」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ120（聖:1Dは
          // 属性ダイスのためGM手動反映）を「敵視:最大」のPC1体に。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
      ],
    },
    "warrior_swordsman|divine_bird_warrior": {
      rows: [
        {
          // 「双曲剣」：乱戦ダメージ修正+120、対象明記無しのため既定ルール。この乱戦ダメージを
          // 回避するPCはダイスコストが半減する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「鉤爪踏みつけ」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。この乱戦ダメージは
          // ガード不可。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard"],
        },
        {
          // 「羽翼吹き荒れ」：乱戦ダメージ修正+60、PC全員（前後衛問わず）が対象（本文に明記）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "allPCs" },
        },
      ],
    },
    "warrior_swordsman|nox_warriors": {
      rows: [
        {
          // 「流体剣」：乱戦ダメージ修正±0、本文自体が無いため既定ルール（前衛均等割り）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「流体槍」：乱戦ダメージ修正+60、PC全員（前後衛問わず）が対象（本文に明記）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "allPCs" },
        },
        {
          // 「夜霧」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ「HP損害:■■」＝
          // 実際に描かれた■の数（2、literal count）をPC全員に。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 2, targetRule: { kind: "allPCs" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "big_dog_bear|consort_red_wolf": {
      rows: [
        {
          // 「突進噛みつき」：乱戦ダメージは2回発生する。対象明記無しのため既定ルール。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -180, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「魔力輝剣＆赤狼跳躍」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ180
          // （魔:1Dは属性ダイスのためGM手動反映）を「敵視:最大」のPC1体に。次のアクションフェイズ
          // 終了までエネミーに「HP価値:+20（上限100）」する。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「輝石彗星＆輝剣円陣」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ120
          // （魔:1Dは属性ダイスのためGM手動反映）を「敵視:1以上」の中からランダム1体に3回実行
          // （本文が「ランダム1名」と明記しているためdistribution:"rotate"、既存ルールと同じ扱い）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 120, repeat: 3, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "warrior_swordsman|grave_warden_duelist": {
      rows: [
        {
          // 「横薙ぎ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「咆哮」：乱戦ダメージ修正±0、対象明記無しのため既定ルール。個別ダメージ「HP損害:■」＝
          // 実際に描かれた■の数（1、literal count）を前衛PC全員に。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 1, targetRule: { kind: "frontAll" } }],
        },
        {
          // 「乱撃」：乱戦ダメージ修正+60、対象明記無しのため既定ルール。この乱戦ダメージを回避
          // するPCはダイスコストが半減する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "crystal_puppet|living_jars": {
      rows: [
        {
          // 「殴打」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「叩き落とし」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ180を
          // 「敵視:1以上」のPC全員に。次のアクションフェイズ開始時に獲得する体力骰も1個減少する
          // （HP損害を伴わない部分はconditionsで記録）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「回転体当たり」：乱戦ダメージは2回発生する。対象明記無しのため既定ルール。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -240, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "warrior_swordsman|loathsome_crushers": {
      rows: [
        {
          // 「連続攻撃」：乱戦ダメージ修正±0（出血:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別ダメージ120（出血:1Dは属性ダイスのためGM手動反映）を
          // 「敵視:最大」のPC1体に。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「跳躍叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記、
          // 出血:1Dは属性ダイスのためGM手動反映）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「火噴き」：乱戦ダメージ修正－120（炎:1Dは属性ダイスのためGM手動反映）、対象明記
          // 無しのため既定ルール。個別効果は「敵視:1以上」PC全員への「炎:1D」（HP損害を伴わない
          // ためindividualDamage無し）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
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
