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
    // 劇本3「夜之強敵決定表」（fields_data_1.js:463-471）の5体：百足のデーモン／戦場の宿将／
    // 爛れた樹霊／ティビアの呼び舟（1日目）、大土竜（2日目）。熔鉄デーモンはTask 3で、ノクスの
    // 竜人兵はTask 4で、ツリーガード&王都の騎兵は既存cavalry|tree_guard_capital_cavalryで
    // 構造化済みのため対象外（task-8-brief.md参照）。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - lava_pooling_trigger（大土竜専用）: 特殊能力「溶岩の滞留」＝効果発揮後、エンドフェイズ
    //   開始時に前衛のPC全員へ「炎:1D」を与える、という遅延・持続効果のトリガーであることの記録
    //   （furnace_flame_triggerと同じ設計思想。値は「■」ではなく「炎:1D」で確定しているが、この
    //   行自身のgroupDamage/individualDamageとは発生タイミングが異なる別枠の効果のため、
    //   elementAccumには含めずconditionsのみで記録する）。
    // - mob_hp_full_heal（既存タグ、本ブロックでも再利用）: 「モブHPの1行を最大値まで回復する」
    //   というエネミー側の自己回復効果（PCへの効果ではない）。
    "crustacean|centipede_demon": {
      // 特殊能力「目立つ腕」でモブ1を追加。actions配列の末尾2行（roll:"—"の「蠢く尻尾」
      // ［体勢崩し発生ターンに追加行動として実行］／「動き回る腕」［モブHP0以下になったターンに
      // 追加行動として実行］）は、通常のディフェンスフェイズのアクション決定（1Dロール）に
      // 加えて追加で実行される特殊トリガー行動であり、既存のrollOverride/rollBonusAfterGuardBreak
      // （どちらも「1D自体の振り方・出目のズラし方」を変える機構であり「追加行動を割り込ませる」
      // 機構ではない）では表現できない新しいパターンのため未構造化のまま
      // （demihuman_beastfolk_club|demihuman_queen_swordmasterの「棄杖＆流星撃」と同種の判断。
      // GMがこの2行の条件成立時に手動で追加実行する）。rows配列はactions配列の先頭4行
      // （通常の1D6ロール対象、roll:"1~2"/"3"/"4"/"5~6"）にのみ対応させる。
      rows: [
        {
          // 「回転攻撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「つかみかかり」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。「敵視:最大」のPC全員はこの乱戦ダメージに対してガード
          // 不可（no_guard、前衛均等割りの対象全員のうち敵視最大の部分集合にのみ適用される）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard"],
        },
        {
          // 「炎吐き」：乱戦ダメージ修正±0＋「炎:2D」（mod欄の固定値、骰子ではないためelementAccum）。
          // 乱戦ダメージはPC全員を対象とする（本文に明記）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 2 }] },
          targetRule: { kind: "allPCs" },
        },
        {
          // 「跳躍体当たり」：乱戦ダメージ修正+180（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次のアクションフェイズ
          // 開始時に獲得するスタミナダイスが1個減少する（HP損害を伴わないためconditionsのみ）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
      ],
    },
    "soldier_knight|battlefield_veteran": {
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
          // 「斧槍の連撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）＋
          // 「腐敗:1D」（mod欄の固定値、骰子ではないためailmentAccumとして同じ対象に付随）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 60, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「一斉射撃」：乱戦ダメージは「敵視:1以上」のPC全員を対象とする。対象となるPCが1人も
          // いない場合は、通常通り、前衛が対象となる（本文に明記されたフォールバック規則）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「薙ぎ払い＆再召喚」：乱戦ダメージ修正－120（「—」ではないため発生）。乱戦ダメージは
          // PC全員を対象とする（本文に明記、remote_veteranの同名行とは対象記載が異なる点に注意）。
          // 加えてモブHPの1行を最大値まで回復するエネミー側の自己回復効果（mob_hp_full_heal）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "allPCs" },
          conditions: ["mob_hp_full_heal"],
        },
        {
          // 「腐敗薙ぎ払い」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果は全PCプール・敵視分岐DCの判定（敵視:1以上→
          // 目標12、敵視:0→目標10、フィジカル）で、失敗したPCに【個別ダメージ:120】＋
          // 「腐敗:1D」（mod欄の固定値と一致）を与える。savingThrow.onFailはamountしか反映
          // しないため、ダメージと蓄積が揃った本行はsavingThrowを使わずGM手動判定に委ねる
          // （saving_throw_damage_and_ailment_manual）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["saving_throw_damage_and_ailment_manual"],
        },
        {
          // 「腐敗の嵐」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員に【個別ダメージ:60】＋
          // 「腐敗:1D」を無条件で与える（判定を伴わないためsavingThrowではなくindividualDamage）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroAtLeast1All" }, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          ],
        },
      ],
    },
    "tree_spirit|withered_tree_spirit": {
      rows: [
        {
          // 「突進」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「尻尾薙ぎ払い」：乱戦ダメージ修正－240、乱戦ダメージは2回発生する。対象の明記が無い
          // ため既定ルール（前衛均等割り）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -240, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「咥え込み＆回り込み」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別
          // 効果（PC人数回実行）:「敵視:1以上」のPC1体に【個別ダメージ:300】＋「聖:1D」を与える
          // ——「PC人数」はパーティ人数に依存する可変値のため、既存のrepeat/rotate機構（固定回数
          // 専用）は使わず、conditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。
          // 特殊能力「回り込み」（次のアクションフェイズ開始時、PC全員はスタミナダイスの出目に
          // かかわらず後衛に配置される＝force_back_row_next_phaseと同じ効果）も効果発揮。
          rollMin: 3,
          rollMax: 3,
          conditions: ["variable_repeat_manual", "force_back_row_next_phase"],
        },
        {
          // 「咆哮＆黄金の柱」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ180＋「聖:1D」は「敵視:最大」のPC1体に別枠で
          // 発生。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "聖", amount: 1 }] }],
        },
        {
          // 「黄金の爆発＆回り込み」：乱戦ダメージ修正±0＋「聖:2D」（mod欄の固定値、骰子では
          // ないためelementAccum）。対象の明記が無いため既定ルール（前衛均等割り）。特殊能力
          // 「回り込み」（force_back_row_next_phase）を効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0, elementAccum: [{ label: "聖", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「黄金ブレス」：乱戦ダメージ修正+120＋「聖:1D」（mod欄の固定値、骰子ではないため
          // elementAccum）。対象の明記が無いため既定ルール（前衛均等割り）。「敵視:最大」のPC
          // 全員は、この乱戦ダメージに対してガード不可（no_guard）で、回避時のダイスコストも
          // 半減（reducible_by_stamina_dice）——いずれも前衛均等割りの対象全員のうち敵視最大の
          // 部分集合にのみ適用される。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 120, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard", "reducible_by_stamina_dice"],
        },
      ],
    },
    "undead|tibias_summoning_boat": {
      rows: [
        {
          // 「飛沫の一撃＆転移」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次のアクション
          // フェイズ開始時に獲得するスタミナダイスが1個減少する。アクション名に「転移」とあるが
          // 注釈本文には特殊能力「転移」の効果発揮が明記されていないため、数値・効果を捏造せず
          // タグ付けしない（他の行では該当能力名を明記時のみforce_back_row_next_phaseを付与）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「櫂振り回し＆再召喚」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に
          // 明記）。特殊能力「再召喚」（モブHPの1行を最大値まで回復、mob_hp_full_heal）を効果発揮。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["mob_hp_full_heal"],
        },
        {
          // 「死に生きる者:暴れまわる＆転移」：乱戦ダメージ修正－300、乱戦ダメージは2回発生する。
          // 対象の明記が無いため既定ルール（前衛均等割り）。特殊能力「転移」（次のアクション
          // フェイズ開始時、PC全員はスタミナダイスの出目にかかわらず後衛に配置される＝
          // force_back_row_next_phase）を効果発揮。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「死に生きる者:掴みかかり＆再召喚」：乱戦ダメージ修正－60（「—」ではないため発生）。
          // 「敵視:1以上」のPC全員はこの乱戦ダメージに対してガード不可（no_guard、対象の明記が
          // 無いため既定ルール＝前衛均等割りの対象全員のうち敵視1以上の部分集合にのみ適用）。
          // 特殊能力「再召喚」（mob_hp_full_heal）を効果発揮。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard", "mob_hp_full_heal"],
        },
        {
          // 「死儀礼の鳥:呪霊爆発＆転移」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の
          // 明記が無いため既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員に【個別
          // ダメージ:120】＋「聖:1D」（mod欄の固定値と一致する個別効果の骰子付随ダメージ）を
          // 別枠で発生。特殊能力「転移」（force_back_row_next_phase）を効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "聖", amount: 1 }] }],
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「死儀礼の鳥:槍呼び＆再召喚」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の
          // 明記が無いため既定ルール（前衛均等割り）。個別効果は「敵視:1以上」のPCのみが対象の
          // 判定（11|フィジカル、全PCプールではなく敵視1以上のみに絞られた部分集合）で、失敗した
          // PCに【個別ダメージ:180】＋「炎:1D」＋「凍傷:1D」（mod欄の固定値と一致）を与える。
          // 対象が全PCプールではなく敵視条件で絞られた部分集合のためsavingThrow（全PC対象・
          // 敵視分岐DC前提）は使わず、本文をそのままGM手動判定に委ねる（conditionsも無し、
          // 数値を捏造しない）。特殊能力「再召喚」（mob_hp_full_heal）を効果発揮。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["mob_hp_full_heal"],
        },
      ],
    },
    "dragon|great_earth_dragon": {
      rows: [
        {
          // 「剣薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「武器叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果:「敵視:最大」のPC全員は次のアクションフェイズ
          // 開始時に獲得するスタミナダイスが2個減少する（HP損害を伴わないためconditionsのみ）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「尻尾振り回し」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。乱戦ダメージを回避するPCは、支払ったダイスコストの値を
          // 半分として扱う（reducible_by_stamina_dice）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「溶岩吐き＆溶岩の滞留」：乱戦ダメージ修正±0＋「炎:1D」（mod欄の固定値、骰子では
          // ないためelementAccum、対象の明記が無いため既定ルール＝前衛均等割り）。個別ダメージ
          // 180は「敵視:最大」のPC1体に別枠で発生。特殊能力「溶岩の滞留」（効果発揮後、エンド
          // フェイズ開始時に前衛のPC全員へ別途「炎:1D」を与える遅延・持続効果、lava_pooling_
          // trigger）を効果発揮。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["lava_pooling_trigger"],
        },
        {
          // 「這いずり回り＆溶岩の滞留」：乱戦ダメージ修正－240、乱戦ダメージは2回発生する。対象の
          // 明記が無いため既定ルール（前衛均等割り）。特殊能力「溶岩の滞留」（lava_pooling_
          // trigger）を効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -240, repeat: 2 },
          targetRule: { kind: "frontAll" },
          conditions: ["lava_pooling_trigger"],
        },
        {
          // 「立ち上がり剣撃＆溶岩の滞留」：乱戦ダメージ修正±0。乱戦ダメージは「敵視:1以上」の
          // PC全員を対象とする。対象となるPCが1人もいない場合は、通常通り、前衛が対象となる
          // （本文に明記されたフォールバック規則）。特殊能力「溶岩の滞留」（lava_pooling_
          // trigger）を効果発揮。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
          conditions: ["lava_pooling_trigger"],
        },
      ],
    },
    // 劇本4「夜之強敵決定表」（fields_data_1.js:474-482）の3体：接ぎ木の君主（1日目、
    // familyId:grafted）、神肌の使徒たち／降る星の成獣（2日目、familyId:strong_type／
    // rock_spirit_beast）。貪食ドラゴン／英雄のガーゴイル／ミミズ顔たち／熔鉄デーモンはTask 3で
    // 構造化済み、ツリーガード&王都の騎兵は既存cavalry|tree_guard_capital_cavalryのため対象外
    // （task-12-brief.md参照）。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - back_row_target_manual: 乱戦ダメージの対象が「前衛ではなく後衛」（後衛にPCが1人もいない
    //   場合のみ前衛にフォールバック）という、既存6種のtargetRule.kindのいずれにも該当しない
    //   対象規則。新しいtargetRule.kindは追加せず、targetRuleを省略しconditionsとコメントで
    //   GM手動処理に委ねる（Global Constraint 6）。
    // - aggro_area_target_manual: 乱戦ダメージの対象が「敵視:最大のPCが存在するエリア（前衛／
    //   後衛）全員」という、PC個人ではなくエリア単位の多数決で決まる対象規則（同数時は前衛固定の
    //   タイブレークを伴う）。既存6種のtargetRule.kindはいずれもPC個人の敵視/隊列条件で候補を
    //   決めるため、このエリア多数決型の対象規則には対応できない（Global Constraint 6、
    //   strong_type|loathed_demon「転移＆杖撃」と同種の判断）。
    // - black_flame_corrosion_trigger（神肌の使徒たち専用）: 特殊能力「黒炎の侵蝕（条件発揮）」＝
    //   適用後、そのフェイズ中に「乱戦ダメージ or 個別ダメージ」でHP損害を受けたPCが
    //   「最大HP:-□（最低値1）」（重複可）を被り、PCが「祝福での休息」を行うか当該「夜の強敵」を
    //   撃破するまで持続する、という条件発揮型の効果を適用したことの記録（furnace_flame_trigger
    //   と同じ設計思想。この行自身のgroupDamage/individualDamageとは別枠・別タイミングの効果の
    //   ため、conditionsのみで記録する）。
    // - gravity_rock_generate_trigger（降る星の成獣専用）: 特殊能力「重力岩生成（条件発揮）」＝
    //   戦闘終了か「重力岩破壊」が発揮されるまでの間、PCたちの任意でPC1人を選び、「重力岩」が
    //   無い場合のみ前衛エリアに生成する（生成後、選ばれたPCが前衛にいればディフェンスフェイズ
    //   開始時に「岩に隠れる」選択肢を得る）という、既存スキーマに無い持続的な場：状態オブジェクト
    //   を導入する効果のため、条件発揮のトリガーであることのみをconditionsで記録する。
    // - gravity_rock_break_trigger（降る星の成獣専用）: 特殊能力「重力岩破壊（条件発揮）」＝
    //   「重力岩」が生成されている場合、PC1人がそれを破壊してもよく、破壊した場合このエネミーは
    //   「HP損害:■■■」（■は数値未確定のプレースホルダのため自動計算しない／Global
    //   Constraint 1）を被る、という条件発揮型のPC選択トリガーであることの記録。
    "grafted|grafted_lord": {
      rows: [
        {
          // 「転がりジャンプ斬り」：乱戦ダメージ修正+60（「—」ではないため発生、本文に乱戦
          // ダメージの対象明記なし）。既定ルール（前衛均等割り）。個別効果は「敵視:最大」のPC1体
          // の次アクションフェイズ開始時のスタミナダイス-2のみでHP損害を伴わないため、
          // conditionsのみ記録する（stamina_dice_reduction_next_phase）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「風飛ばし」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （2回実行）：「敵視:最大」のPC1体に【個別ダメージ:180】を与える（対象が「敵視:最大」
          // の単一PCで明確なため、輪流分配ではなく同一対象への2回実行として構造化）。
          rollMin: 2,
          rollMax: 2,
          individualDamage: [{ amount: 180, repeat: 2, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「アースシーカー」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別効果は全PCプール・敵視分岐DCの判定
          // （敵視:1以上→目標12、それ以外→目標10、運試し）で、失敗したPCに【個別ダメージ:180】を
          // 与える（ダメージのみで属性/状態異常蓄積を伴わないため、既存のsoldier_knight|
          // red_lion_knights「アローレイン」と同型でsavingThrowに構造化できる）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 120 },
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
          // 「地擦り斬撃＆体当たり」：乱戦ダメージ修正+180（「—」ではないため発生、本文に乱戦
          // ダメージの対象明記なし）。既定ルール（前衛均等割り）。個別効果:「敵視:1以上」の
          // PC全員（前衛限定の記載なし）に無条件で【個別ダメージ:120】＋「聖:1D」を与え、次の
          // アクションフェイズ開始時のスタミナダイス-1も発生する（HP損害を伴わない部分は
          // conditionsで記録）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "聖", amount: 1 }] }],
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「尻尾薙ぎ払い＆叩きつけ」：乱戦ダメージ修正－300、乱戦ダメージは2回発生する。対象の
          // 明記が無いため既定ルール（前衛均等割り）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「斧連続攻撃」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、既存のrepeat/rotate機構（固定回数専用）は使わず
          // conditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。このダメージを
          // 回避するPCはダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 6,
          rollMax: 6,
          conditions: ["variable_repeat_manual", "reducible_by_stamina_dice"],
        },
      ],
    },
    "strong_type|divine_skin_apostles": {
      rows: [
        {
          // 「両刃剣乱舞」：前衛の中で「敵視:最大」のPC全員に「乱戦ダメージ:3人分」を割り振る
          // （本文に明記、soldier_knight|crucible_knight「薙ぎ払い」と同型のfrontAggroMaxAll）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「連続突き」：乱戦ダメージ修正－60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ180は「敵視:1以上」のPC1体（対象不特定）に
          // 2回実行。ユーザー確認済み：対象は「敵視:1以上」を満たす候補の中で輪流受傷、最初の
          // 対象はランダム。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 180, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
        },
        {
          // 「黒炎投げ」：乱戦ダメージ修正±0（「—」ではないため発生）。乱戦ダメージは前衛を対象と
          // せず、代わりに後衛を対象とする（後衛にPCが1人もいない場合は前衛が対象）——既存6種の
          // targetRule.kindのいずれにも該当しない対象規則のため、新規kindは追加せずtargetRuleを
          // 省略する（back_row_target_manual）。mod欄の「炎:1D」は本文が別途「敵視:1以上」の
          // PC全員へ与えると明記しており、乱戦ダメージの対象（後衛／フォールバック前衛）とは
          // 異なる集団への蓄積のみの効果（HP損害を伴わない）のため、groupDamage.elementAccumにも
          // individualDamageにも構造化できない（accum_target_mismatch_manual）。特殊能力
          // 「黒炎の侵蝕」を適用（black_flame_corrosion_trigger）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 0 },
          conditions: ["back_row_target_manual", "accum_target_mismatch_manual", "black_flame_corrosion_trigger"],
        },
        {
          // 「連携攻撃」：乱戦ダメージ修正－180、乱戦ダメージは2回発生する。「敵視:1以上」で前衛
          // のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -180, repeat: 2 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「肉弾戦車」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。「敵視:最大」のPC全員はこの乱戦ダメージに対してガード不可
          // （no_guard、前衛均等割りの対象全員のうち敵視最大の部分集合にのみ適用される）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard"],
        },
        {
          // 「黒炎の乱舞」：乱戦ダメージ修正+60（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果：「敵視:1以上」のPC全員（前衛限定の
          // 記載なし）に無条件で【個別ダメージ:120】＋「炎:1D」を与える——mod欄の「炎:1D」は
          // この個別効果と数値・種別が一致するため二重計上を避けgroupDamageには付随させない。
          // 特殊能力「黒炎の侵蝕」を適用（black_flame_corrosion_trigger）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "炎", amount: 1 }] }],
          conditions: ["black_flame_corrosion_trigger"],
        },
      ],
    },
    "rock_spirit_beast|falling_star_beast": {
      rows: [
        {
          // 「突進＆重力岩破壊」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:3人分」（本文に
          // 明記）。特殊能力「重力岩破壊」を効果発揮（gravity_rock_break_trigger）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["gravity_rock_break_trigger"],
        },
        {
          // 「跳躍回転体当たり＆重力岩破壊」：乱戦ダメージ修正+240（「—」ではないため発生）。
          // 対象は「敵視:最大」のPCが存在するエリア全員（対象エリアが同数の場合は前衛固定）と
          // いう、PC個人ではなくエリア単位で決まる対象規則のため、既存6種のtargetRule.kindの
          // いずれにも該当せずtargetRuleは省略する（aggro_area_target_manual、strong_type|
          // loathed_demon「転移＆杖撃」と同種の判断）。特殊能力「重力岩破壊」を効果発揮
          // （gravity_rock_break_trigger）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 240 },
          conditions: ["aggro_area_target_manual", "gravity_rock_break_trigger"],
        },
        {
          // 「尻尾薙ぎ払い」：乱戦ダメージ修正+180（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。次のアクションフェイズ終了までエネミーを
          // 「HP価値:+20（最大100）」する（enemy_hp_value_buff）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「ハサミ振り回し＆重力岩生成」：乱戦ダメージ修正－180、乱戦ダメージは2回発生する。
          // 「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。特殊能力
          // 「重力岩生成」を効果発揮（gravity_rock_generate_trigger）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -180, repeat: 2 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["gravity_rock_generate_trigger"],
        },
        {
          // 「重力雷落とし」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】＋「魔:1D」を与える——
          // 「PC人数」はパーティ人数に依存する可変値のため、既存のrepeat/rotate機構（固定回数
          // 専用）は使わずconditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。
          rollMin: 5,
          rollMax: 5,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「重力操作＆重力岩生成」：乱戦ダメージ修正+120＋「魔:2D」（mod欄の固定値、骰子では
          // ないためelementAccum）。乱戦ダメージはPC全員を対象とする（本文に明記）。この乱戦
          // ダメージに対してガード不可（no_guard）。特殊能力「重力岩生成」を効果発揮
          // （gravity_rock_generate_trigger）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 120, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "allPCs" },
          conditions: ["no_guard", "gravity_rock_generate_trigger"],
        },
      ],
    },
    // 劇本5「夜之強敵決定表」1日目（fields_data_1.js:487-491）のうち今回追加する1体：王族の幽鬼
    // （familyId:grafted、enemyId:royal_wraith）。同じ行に列挙される百足のデーモン／戦場の宿将／
    // ティビアの呼び舟は既存の centipede_demon|duke_freydia|tibias_summoning_boat 各エントリで
    // 劇本2/3構造化済み、公のフレイディアも同様に構造化済みのため、いずれも本タスクの対象外
    // （task-2-brief.md参照）。2日目の坩堝の騎士／神肌の使徒たち／死儀礼の鳥も既存対応済みのため
    // 対象外。
    //
    // 【special フィールドについて（rows[]には含めずここに完全記録し、GM手動対応とする）】
    // - 〔亡者特効〕公開情報。このエネミーは「死に生きる者」である（亡者特効が有効）。出目に
    //   関係なく常時有効な受動的特性のため、行動テーブルの行としては構造化しない。
    // - 〔弱点:回復〕いずれかのPCが前衛エリアで「HP回復:□以上」を伴う「祈祷」を使用した場合、
    //   そのアクションはこのエネミーに追加効果として「◆」（【追加効果】文脈の◆＝1 Guard
    //   Reduction、CLAUDE.md §18）を与える。トリガーがPC側の行動でありエネミーの出目テーブルに
    //   存在しないため、rows[]には含めずここに記録する。
    // - 〔転移（条件発揮）〕次のアクションフェイズ開始時、すべてのPCはスタミナダイスの出目に
    //   かかわらず、後衛に配置される。本文中で「転移」を明記する行（roll 2「回転殴り＆転移」、
    //   roll 4「叩きつけ＆転移」）でのみ発揮されるため、既存タグforce_back_row_next_phaseとして
    //   該当行のconditionsにのみ記録する（他行では付与しない）。
    "grafted|royal_wraith": {
      rows: [
        {
          // 「猛追」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果（PC人数+1
          // 回実行）：「敵視:1以上」のPC1体に【個別ダメージ:120】＋「猛毒:1」（固定値、骰子では
          // ない）を与える——「PC人数+1」はパーティ人数に依存する可変値であり固定回数のリテラル値
          // ではないため、既存のrepeat/rotate機構（固定回数専用）は使わず、conditionsとコメントで
          // GM手動処理に委ねる（Global Constraint 7、grafted_lord|斧連続攻撃と同種の判断）。
          rollMin: 1,
          rollMax: 1,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「回転殴り＆転移」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 特殊能力「転移」（次のアクションフェイズ開始時、PC全員がスタミナダイスの出目に
          // かかわらず後衛に配置される＝force_back_row_next_phase）を効果発揮。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「毒吐き」：乱戦ダメージ修正－120＋「猛毒:1D」（mod欄の固定値、骰子ではないため
          // ailmentAccum、本文に乱戦ダメージの対象明記なし＝既定ルール＝前衛均等割り）。個別
          // ダメージ180＋「猛毒:1D」は「敵視:最大」のPC1体に別枠で発生（grafted_lord|吐き出しの
          // 「呪死」二重発生と同型構造）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: -120, ailmentAccum: [{ label: "猛毒", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "猛毒", amount: 1 }] }],
        },
        {
          // 「叩きつけ＆転移」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次の
          // アクションフェイズ開始時に獲得するスタミナダイスが1個減少する（HP損害を伴わないため
          // conditionsのみ）。特殊能力「転移」（force_back_row_next_phase）を効果発揮。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase", "force_back_row_next_phase"],
        },
        {
          // 「爆発光弾」：乱戦ダメージ修正±0＋「聖:1D」（mod欄の固定値、骰子ではないため
          // elementAccum、本文に乱戦ダメージの対象明記なし＝既定ルール＝前衛均等割り）。個別
          // ダメージ180＋「聖:1D」は「敵視:1以上」のPC全員に別枠で発生（grafted_lord|地擦り
          // 斬撃＆体当たりと同型の二重発生構造）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "聖", amount: 1 }] }],
        },
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
      ],
    },
    // 劇本6「夜之強敵決定表」2日目（fields_data_1.js:503-506）のうち今回追加する2体：
    // 冷たい谷の踊り子（familyId:warrior_swordsman）、無名の王（familyId:cavalry）。同じ行に
    // 列挙される忌み鬼／僻地の宿将／ノクスの竜人兵、および1日目の鈴玉狩り／貪食ドラゴン／
    // 夜の騎兵たち／英雄のガーゴイル／ミミズ顔たち／百足のデーモンはすべて既存対応済みのため
    // 対象外（task-5-brief.md参照）。
    //
    // 【special フィールドについて（rows[]には含めずここに完全記録し、GM手動対応とする）】
    // - 〔HP価値:+20〕このエネミーを常に「HP価値:+20（最大100）」する（恒常的なベース値補正で
    //   あり、出目に紐づく行動ではないためrows[]には構造化しない）。
    // - 〔行動激化〕「体勢崩し」が発生した後は、戦闘終了まで、アクション決定を「1D」ではなく
    //   「1D+2」で行う——ガードブレイク依存の行動激化のため、既存のrollBonusAfterGuardBreak
    //   機構（demihuman_beastfolk_club|demihuman_queen_swordmaster等と同型）でそのまま表現できる
    //   （Global Constraint 7）。rollMin/rollMaxが6を超える行（6~8）は通常時（1D6=1〜6）には
    //   到達せず、体勢崩し後（1D6+2=3〜8）にのみ到達する。
    "warrior_swordsman|cold_valley_dancer": {
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「叩きつけ＆火走り」：乱戦ダメージ修正±0（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別効果：【個別ダメージ:120】＋「炎:1D」
          // （ダイス、固定値化しない）は「敵視:1以上」のPC全員に別枠で発生。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "炎", amount: 1 }] },
          ],
        },
        {
          // 「掴みかかり」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ300は
          // 「敵視:最大」のPC1体に。この効果に対してガード不可（no_guard）。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「炎爆発」：乱戦ダメージ修正±0＋「炎:2D」（mod欄のダイス表記、固定値化せずダイス数のみ
          // elementAccumで構造化。乱戦ダメージの対象明記なし＝既定ルール＝前衛均等割り）。本文は
          // 別途「「敵視:最大」のPC1体に「炎:1D」を与える」と明記しており、これは乱戦ダメージの
          // 対象（前衛均等割り）とは異なる集団（敵視最大の1体のみ）への蓄積のみの効果（HP損害を
          // 伴わない）のため、groupDamage.elementAccumにもindividualDamage（HP損害amountが必須）
          // にも構造化できない（accum_target_mismatch_manual、Global Constraint 6）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「双剣叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // mod欄の「魔:1D」＋「炎:1D」（ダイス、固定値化しない）は乱戦ダメージの対象にそのまま
          // 付随させる。
          rollMin: 5,
          rollMax: 5,
          groupDamage: {
            modifier: 180,
            elementAccum: [
              { label: "魔", amount: 1 },
              { label: "炎", amount: 1 },
            ],
          },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「双剣の舞」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数+1回実行）：「敵視:1以上」のPC1体に【個別ダメージ:60】＋「魔:1D」＋「炎:1D」を
          // 与える——「PC人数+1」はパーティ人数に依存する可変値であり固定回数のリテラル値では
          // ないため、既存のrepeat/rotate機構（固定回数専用）は使わず、conditionsとコメントでGM
          // 手動処理に委ねる（Global Constraint 7）。rollMin/rollMax（6~8）は体勢崩し後
          // （rollBonusAfterGuardBreak:2）にのみ到達する。
          rollMin: 6,
          rollMax: 8,
          conditions: ["variable_repeat_manual"],
        },
      ],
    },
    // 【special フィールドについて（rows[]には含めずここに完全記録し、GM手動対応とする）】
    // - 〔竜特効〕公開情報。このエネミーは「竜」として扱う（竜特効の対象である）。出目に関係なく
    //   常時有効な受動的特性のため、行動テーブルの行としては構造化しない。
    // - 〔モブ1追加〕戦闘開始時、HP枠に「モブ1」を追加し、このエネミーを「撃破ルーン:+1」する。
    //   このモブHPはL補を問わず「最大HP:PC人数×4」である。出目テーブルの行ではなく戦闘開始時の
    //   セットアップ処理のため、rows[]には構造化しない。
    // - 〔王の威光〕モブHPが0以下になると、戦闘終了まで、このエネミーは特殊能力「竜特効」を失い、
    //   アクション決定は「1D」ではなく「1D+6」で行う——【task-5-brief.mdの注意点】この行動激化の
    //   発動条件は「体勢崩し」ではなく「モブHPが0以下になること」であり、Global Constraint 7の
    //   rollBonusAfterGuardBreak（体勢崩し依存専用の機構）をそのまま流用すると発動条件を誤って
    //   実装することになるため、rollBonusAfterGuardBreakは使わない（トップレベルフィールドを
    //   新設もしない）。この特殊能力が発動して初めて到達可能になる行（roll 7~8／9~10／11~12）には
    //   conditions:["mob_hp_trigger_manual"]を付与し、コメントで発動条件全文を記録してGM手動で
    //   モブHPが0以下になったタイミングを確認したうえで1D+6に切り替えるトリガーとする。
    "cavalry|unnamed_king": {
      rows: [
        {
          // 「滞空ブレス＆雷の槍」：乱戦ダメージ修正±0＋「炎:4」（mod欄の固定値、骰子ではない。
          // 乱戦ダメージの対象明記なし＝既定ルール＝前衛均等割り）。個別効果：【個別ダメージ:240】
          // ＋「雷:4」（固定値、骰子ではない）は「敵視:最大」のPC1体に別枠で発生。mod欄が「炎」、
          // 個別効果が「雷」で属性・数値とも一致しないため、独立した効果としてそれぞれ構造化する
          // （本文の記載どおり転記。原文の属性表記の食い違いは規則書側の記述であり、本タスクでは
          // 数値・属性名を一切変更せずそのまま反映する）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 4 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 240, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "雷", amount: 4 }] },
          ],
        },
        {
          // 「騎乗薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「扇形ブレス＆叩きつけ」：乱戦ダメージはすべてのPCを対象とする（本文に明記）。mod欄の
          // 「炎:3」（固定値、骰子ではない）はこの乱戦ダメージの対象に付随。個別ダメージ300は
          // 「敵視:最大」のPC1体に別枠で発生。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120, elementAccum: [{ label: "炎", amount: 3 }] },
          targetRule: { kind: "allPCs" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「地を這う嵐＆剣槍突き刺し」：乱戦ダメージ修正+120（「—」ではないため発生、本文に
          // 乱戦ダメージの対象明記なし）。既定ルール（前衛均等割り）。個別ダメージ360＋「雷:2」
          // （固定値、骰子ではない）は「敵視:最大」のPC1体に別枠で発生。この個別効果に対して
          // ガード不可（no_guard）。この行は特殊能力「王の威光」（モブHP0以下）発動後の
          // 1D+6でのみ到達する（mob_hp_trigger_manual、上記specialコメント参照）。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 360, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "雷", amount: 2 }] }],
          conditions: ["no_guard", "mob_hp_trigger_manual"],
        },
        {
          // 「雷光剣槍＆落雷」：乱戦ダメージ修正±0＋「雷:4」（mod欄の固定値、骰子ではない。乱戦
          // ダメージの対象明記なし＝既定ルール＝前衛均等割り）。個別効果はPC全員が判定
          // （11|運試し）を行い、失敗したPCに【個別ダメージ:240】＋「雷:3」（固定値、骰子では
          // ない）を与える——mod欄の「雷:4」と個別効果の「雷:3」は数値が一致しないため独立した
          // 効果として扱い、mod欄側はgroupDamage.elementAccumに付随させる。個別効果は判定失敗時に
          // 【個別ダメージ】と属性蓄積の両方を伴うため、savingThrow.onFailは既存実装（night.js）が
          // onFail.amountしか読まずelementAccumを一切反映せず、蓄積部分が黙って欠落し誤解を招く。
          // よってsavingThrow自体を使わず、判定・ダメージ・蓄積のすべてをコメントに記載してGM
          // 手動処理に委ねる（saving_throw_damage_and_ailment_manual、Global Constraint 9）。
          // この行は特殊能力「王の威光」発動後の1D+6でのみ到達する（mob_hp_trigger_manual）。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { modifier: 0, elementAccum: [{ label: "雷", amount: 4 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["saving_throw_damage_and_ailment_manual", "mob_hp_trigger_manual"],
        },
        {
          // 「剣槍叩きつけ＆雷光地走り」：乱戦ダメージはPC全員を対象とする（本文に明記）。加えて
          // 「敵視:1以上」のPC全員は「乱戦ダメージ:2人分」を割り振られる——対象範囲自体はPC全員
          // だが、その中で敵視1以上の部分集合のみ2倍の重み付けを受けるという加重分配であり、
          // 既存6種のtargetRule.kindのいずれにも正確には該当しない（allPCsは均等割りが前提）。
          // 数値を捏造しないため、targetRuleは対象範囲が一致するallPCsに留め、加重の詳細は
          // conditionsで記録してGMが本文どおり手動で再分配する（manual_weighted_split_aggro_double、
          // boss_auto_gm_data.js「edele」の「突進」と同種の判断。本行は前衛限定の記載が無い点が
          // 異なるためタグ名から「front」を外す）。このダメージを回避するPCは、支払った
          // ダイスコストの値を半分（端数切り捨て、最低値1）として扱う
          // （reducible_by_stamina_dice）。この行は特殊能力「王の威光」発動後の1D+6でのみ到達する
          // （mob_hp_trigger_manual）。
          rollMin: 11,
          rollMax: 12,
          groupDamage: { modifier: 240 },
          targetRule: { kind: "allPCs" },
          conditions: ["manual_weighted_split_aggro_double", "reducible_by_stamina_dice", "mob_hp_trigger_manual"],
        },
      ],
    },
    // 【special フィールドについて（rows[]には含めずここに完全記録し、GM手動対応とする）】
    // - 〔2回行動〕このエネミーは1回のディフェンスフェイズに「1D（傷ついたデーモン）」と
    //   「1D+6（うろ底のデーモン）」で、2回のアクション決定を行い、その双方を実行する。下記rowsは
    //   1〜12の統一表になっているため、新規のdual-roll機構は追加せず、既存の擲骰オーバーレイUIへ
    //   「1回目は出目そのまま（1〜6）」「2回目は出目+6した値（7〜12）」を2回連続で入力する運用で
    //   両方の結果を得る（GM手動で2回操作、新規の状態管理機構は追加しない）。
    // - 〔行動激化〕このエネミーは「体勢崩し」が発生せず、代わりに戦闘終了まで特殊能力「2回行動」を
    //   失う。このとき、PCは相談して任意で「1D（傷ついたデーモン）」か「1D+6（うろ底のデーモン）」
    //   のいずれか一方の「生き残った側」を選んで記録し、以降は戦闘終了まで、生き残った側の
    //   アクションを「総合ダメージ:+300／個別ダメージ:+120」して決定する——ターンをまたぐ状態遷移で
    //   rowsモデルでは表現不可のため、GM手動運用とする（新規の状態管理機構は追加しない）。
    "death_bird_raven|wounded_demon": {
      rows: [
        {
          // 「炎爪ひっかき」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // mod欄の「炎:1D」（固定値、骰子ではないためelementAccum、Global Constraint 2）は
          // この乱戦ダメージに付随。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -300, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「跳躍叩きつけ」：乱戦ダメージ修正－480、対象明記無しのため既定ルール（前衛均等割り）。
          // 個別効果：「敵視:最大」のPC1体に【個別ダメージ:60】＋「炎:1D」（固定値のため
          // elementAccum）を別枠で与える。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -480 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "炎", amount: 1 }] },
          ],
        },
        {
          // 「火球」：乱戦ダメージ修正が「—」のため発生しない。個別効果（PC人数回実行）：
          // 「敵視:1以上」のPC1体に【個別ダメージ:60】＋「炎:2D」を与える——「PC人数」はパーティ
          // 人数に依存する可変値であり固定回数のリテラル値ではないため、既存のrepeat/rotate機構
          // （固定回数専用）は使わず、conditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。
          rollMin: 5,
          rollMax: 6,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「毒爪ひっかき」：前衛の中で「敵視:最大」のPC全員に「乱戦ダメージ:3人分」（本文に明記）。
          // mod欄の「猛毒:1D」（固定値、骰子ではないためelementAccum）はこの乱戦ダメージに付随
          // （出目1~2「炎爪ひっかき」と同型の「－N＆「属性:1D」」構文のため、同様にelementAccumへ
          // 構造化して一貫させる）。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: -420, elementAccum: [{ label: "猛毒", amount: 1 }] },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「跳躍叩きつけ」：乱戦ダメージ修正－600、対象明記無しのため既定ルール（前衛均等割り）。
          // 次のアクションフェイズ開始時、PC全員はスタミナダイスの出目にかかわらず後衛に配置される
          // （force_back_row_next_phase）。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { modifier: -600 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「毒のブレス」：乱戦ダメージ修正が「—」のため発生しない。個別効果：PC全員が判定
          // （11|フィジカル）を行い、失敗したPCに【個別ダメージ:60】＋「猛毒:2D」を与える。
          // 2026-08-24のTask3拡張によりsavingThrow.onFail.elementAccumがnight.js側
          // （queueAttributeAccum呼び出し、cavalry|unnamed_king等の既存事例）で読まれるように
          // なっているため、「猛毒:2D」（固定値、骰子ではないためelementAccum）もonFailへ構造化して
          // 自動反映する。
          rollMin: 11,
          rollMax: 12,
          savingThrow: {
            stat: "physical",
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 60, elementAccum: [{ label: "猛毒", amount: 2 }] },
          },
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
