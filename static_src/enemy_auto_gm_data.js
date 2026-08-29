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
    //   両方を伴うもの。本ブロック作成時点ではsavingThrow.onFailはonFail.amountしか読まず
    //   elementAccum/ailmentAccumを一切反映しないと判断し（saving_throw_ailment_only_manualと
    //   同じ理由）、savingThrow自体を使わずコメントでGM手動処理に委ねていた。
    //   【2026-08-29修正】Task6（soldier_knight|death_knight）でnight.js（約10049-10061行）を
    //   再確認したところ、savingThrow.onFailは`typeof outcomeEntry.amount === "number"`の
    //   ときのみ個別ダメージ入力欄へ書き込むが、elementAccum/ailmentAccumはonFail.amountの型に
    //   関わらず常にqueueAttributeAccumへ渡される実装であることが判明した。よって上記の
    //   「onFail.amountしか読まない」という判断は誤りであり、実際には【個別ダメージ】＋属性/
    //   状態異常蓄積の両方を伴う失敗効果もsavingThrowへ構造化可能である。ただし本ブロック内で
    //   既にこのタグを使用している箇所を今回遡って再構造化することはせず（Global Constraint 9の
    //   例外的な保守的判断は維持）、次回以降このタグの新規使用を検討する際の参考として本コメントを
    //   更新するに留める（Global Constraint 9）。
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
          // mod欄の「猛毒:1D」はこの乱戦ダメージに付随（出目1~2「炎爪ひっかき」と同型の
          // 「－N＆「属性/状態異常:1D」」構文のため、同様に本体へ構造化して一貫させる）。猛毒は
          // 状態異常（docs/enemy_damage_rules.md §7、CLAUDE.md §17分類）のためailmentAccumで
          // 構造化する（elementAccumではない）。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: -420, ailmentAccum: [{ label: "猛毒", amount: 1 }] },
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
          // 2026-08-24のTask3拡張によりsavingThrow.onFail.elementAccum/ailmentAccumがnight.js側
          // （queueAttributeAccum呼び出し、cavalry|unnamed_king等の既存事例）で読まれるように
          // なっているため、「猛毒:2D」もonFailへ構造化して自動反映する。猛毒は状態異常
          // （docs/enemy_damage_rules.md §7、CLAUDE.md §17分類）のためailmentAccumで構造化する
          // （elementAccumではない）。
          rollMin: 11,
          rollMax: 12,
          savingThrow: {
            stat: "physical",
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 60, ailmentAccum: [{ label: "猛毒", amount: 2 }] },
          },
        },
      ],
    },
    // 【special フィールドについて（rows[]には含めずここに完全記録し、GM手動対応とする）】
    // - GM運用note：このエネミーは進行中シナリオで「傷ついたデーモン＆うろ底のデーモン」を撃破した
    //   場合にのみ登場可能（シナリオ進行条件、機構化不要）。
    // - 〔依り代〕戦闘開始時、プレイヤーが進行中のシナリオで「傷ついたデーモン」と「うろ底のデーモン」
    //   のどちらを記録しているのか確認し、「うろ底のデーモン」が記録されているならアクション決定を
    //   「1D+4」で行う。既存のrollOverride: "halfIfNoMobs"は「現在の戦闘中のmobHpRowsの有無」を
    //   battleStateから自動判定できる条件だが、本行動の判定条件（進行中シナリオでどちらの敵を
    //   過去に撃破・記録したか）はstate.battle側に対応する既存フィールドが存在せず、GMがシナリオ
    //   記録を参照して手動確認する以外に判定手段が無い。新規rollOverride文字列をauto_gm.jsに
    //   追加しても、それを駆動する新規state.battleフィールドとGM向け確認UIを合わせて追加しない
    //   限り機能せず、それはauto_gm.jsの小規模な分岐追加の範囲を超える（night.js側の状態・UI
    //   変更が必要になる）。よって既存rollOverrideパターンへの機構化は行わず、コメントのみに
    //   留めてGM手動運用とする（Global Constraintsの「既存に無ければ最小限追加してよい」例外を
    //   検討したうえで、より保守的な「コメントのみ」を採用）。
    "death_bird_raven|demon_prince": {
      rows: [
        {
          // 「炎の隕石」：乱戦ダメージ修正－120（「－」ではなく数値のため必ずgroupDamageを
          // 設定、対象明記なし＝既定ルール＝前衛均等割り）。個別効果（PC人数回実行、
          // 「敵視:1以上」のPC1体に個別120＋炎1D）はmod欄の「－120＆「炎:1D」」と数値・
          // 種別が完全一致する同一効果の要約表記であり、かつ回数がPC人数依存の可変値の
          // ためGlobal Constraint 7によりrepeat/rotateを使わずconditionsで手動処理に
          // 委ねる（remote_veteran「冷気の嵐」と同様、二重計上を避けるためgroupDamage側
          // には炎:1Dを構造化せず、variable_repeat_manualの手動処理注記に炎:1Dも含める）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「浮遊火球＆突進」：乱戦ダメージ修正±0（「－」ではないため発生、対象明記なし＝
          // 既定ルール）。個別効果（PC人数+1回実行）はPC協議で任意対象・1体が「HP損害:■」＋
          // 「炎:1D」を被る——対象がPC協議による任意対象（既存targetRuleのいずれにも該当せず）、
          // かつダメージ量が■（GM運用ルールにより自動計算禁止）のため、構造化可能なフィールドが
          // 存在しない。よって「炎:1D」もelementAccumへ構造化せず、可変回数・任意対象・■の
          // すべてをconditions＋本コメントでGM手動処理に委ねる。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["variable_repeat_manual", "unknown_hp_damage_manual"],
        },
        {
          // 「跳躍叩きつけ」：「敵視:1以上」で前衛全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 次のアクションフェイズ開始時、PC全員はスタミナダイスの出目に関係なく後衛に配置される
          // （force_back_row_next_phase）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 240 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「両腕掴み」：乱戦ダメージ修正±0（対象明記なし＝既定ルール）。個別効果は「敵視:最大」
          // のPC1体に【個別ダメージ:300】を別枠で与え、この効果に対してガード不可（no_guard）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「毒の瘴気」：mod欄「＋120＆「猛毒:1D」」。乱戦ダメージ修正＋120（対象明記なし＝
          // 既定ルール）。個別効果は「敵視:1以上」のPC全員が〈11|運試し〉判定を行い（stat:
          // "luck"、既存の「運試し」使用エントリsoldier_knight|red_lion_knights等で確認済みの
          // プロパティ名）、失敗したPCに【個別ダメージ:120】＋「猛毒:1D」を与える。猛毒1Dは
          // savingThrow.onFail.ailmentAccum（night.js側のqueueAttributeAccumが読み取り自動反映、
          // 本ファイルdeath_bird_raven|wounded_demonの猛毒2D事例と同型）へ構造化する。猛毒は
          // 状態異常（docs/enemy_damage_rules.md §7、CLAUDE.md §17分類）のためailmentAccumで
          // 構造化する（elementAccumではない）。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "luck",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 120, ailmentAccum: [{ label: "猛毒", amount: 1 }] },
          },
        },
        {
          // 「熱戦爆発」：mod欄「－300＆「猛毒:1D」」。乱戦ダメージ修正－300、2回発生（repeat:2）。
          // 対象は「敵視:1以上」のPC全員（本文に明記）、対象0人の場合は通常通り前衛にフォール
          // バックする——既存resolveTargetsのtargetRule.fallback === "front"機構（auto_gm.js内、
          // 本ファイルの他多数の"aggroAtLeast1All", fallback: "front"エントリと同型）がまさに
          // この挙動を実装済みのため、そのまま再利用する。猛毒は状態異常
          // （docs/enemy_damage_rules.md §7、CLAUDE.md §17分類）のためmod欄の「猛毒:1D」は
          // groupDamage.ailmentAccumへ構造化する（elementAccumではない）。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { modifier: -300, repeat: 2, ailmentAccum: [{ label: "猛毒", amount: 1 }] },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
      ],
    },
    // 劇本8「夜之強敵決定表」出目4-6：神獣の戦士たち＋モブ2（enemies_data_3.js:504-568）。
    // resistance: 雷、size: M。
    //
    // 【special フィールドについて（rows[]には含めずここに完全記録し、GM手動対応とする）】
    // - 〔闇の中〕このエネミーを「撃破ルーン:+2」する。このエネミーは戦闘の1ターン目のみ、
    //   「HP価値:-20」され、ディフェンスフェイズにアクションせず、代わりにアクションフェイズで
    //   PCがアクションする前に（アクションフェイズ開始時のスタミナダイスを獲得し、隊列と敵視を
    //   決定した直後に）、アクション決定し実行する（1ターン目のみ、PCより先に行動し、
    //   ディフェンスフェイズに行動しない）——ターン数に依存する特殊タイミング（「戦闘1ターン目
    //   のみ」「PCより先に行動」）で、既存rows/rollOverride機構はいずれも「毎ターン同じ判定表を
    //   引く」前提のためこの種のターン依存分岐を表現できない。新規機構は追加せずGM手動運用とする。
    // - 〔闇に紛れる（条件発揮）〕すべてのPCは、次のアクションフェイズの開始時に〈11|メンタル〉を
    //   行う。失敗した場合、スタミナダイスの黒目をすべて白丸の目に変更する——既存の
    //   savingThrow機構は「このエネミーの行動が発生した直後に判定」を前提としており、「次の
    //   アクションフェイズ開始時」という遅延判定かつ「スタミナダイスの出目を書き換える」という
    //   HP損害・属性/状態異常蓄積のいずれでもない効果のため、既存フィールドに構造化できない。
    //   出目3・4のnote内で「闇に紛れる」効果発揮に触れているが、rows化はせずconditionsのコメントで
    //   言及するに留め、機構化しない（新しいstate機構は追加しない）。
    "warrior_swordsman|divine_beast_warriors": {
      rows: [
        {
          // 「円刃剣の舞」：mod「±0＆「出血:1D」」。乱戦ダメージ修正±0（対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果：「敵視:最大」のPC1体に【個別ダメージ:60】＋「出血:1D」を
          // 別枠で与える——note文言上、出血1Dは個別ダメージに付随（wounded_demon出目3-4の
          // 「跳躍叩きつけ」と同型）。出血は状態異常（docs/enemy_damage_rules.md §7、CLAUDE.md
          // §17分類）のためailmentAccumで構造化する（elementAccumではない）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "出血", amount: 1 }] },
          ],
        },
        {
          // 「短剣投擲」：mod「－60＆「出血:1D」」。乱戦ダメージの基本対象はPC全員（本文に明記）、
          // かつ「敵視:1以上」で前衛のPC全員は「乱戦ダメージ:2人分」を割り振られる混在パターン。
          // auto_gm.js resolveWeightedTargets/matchesWeightCondition（258-280行）で
          // weightRule.kind: "frontAggroAtLeast1"（前衛かつ敵視1以上のみ重み2、それ以外は重み1）が
          // 既に実装済みであること、およびresolveTargetsのtargetRule.kind: "allPCs"（344-345行）も
          // 既存対応済みであることをauto_gm.js本体で確認したうえで採用（edele「突進」等の既存
          // 使用例と同型）。individualDamageは無い（noteに個別効果の記載なし）。出血1Dは乱戦
          // ダメージに付随（ailmentAccum、docs/enemy_damage_rules.md §7分類）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -60, ailmentAccum: [{ label: "出血", amount: 1 }] },
          targetRule: { kind: "allPCs", weightRule: { kind: "frontAggroAtLeast1", weight: 2 } },
        },
        {
          // 「奇襲＆闇に紛れる」：mod「＋120＆「出血:1D」」。乱戦ダメージ修正＋120、対象明記なしの
          // ため既定ルール（前衛均等割り）。乱戦ダメージの対象になった「敵視:最大」のPC1体は
          // 〈12|メンタル〉を行い、失敗するとこの乱戦ダメージに対してディフェンス不可となる——
          // 「判定失敗時のみ特定PCが対象行動に防御不可」という条件分岐は既存savingThrow機構
          // （onFail.amount/elementAccum/ailmentAccumのみ読む）はもちろんno_guard（無条件ガード
          // 不可）でも表現できないため、新規タグ（no_evade_defense_check_manual）＋本コメントで
          // GM手動運用に委ねる。特殊能力「闇に紛れる（条件発揮）」も効果発揮するが、上記の理由で
          // rows化しない（エントリ冒頭コメント参照）。出血1Dは乱戦ダメージに付随（ailmentAccum）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 120, ailmentAccum: [{ label: "出血", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["no_evade_defense_check_manual"],
        },
        {
          // 「噛みつき＆闇に紛れる」：mod「±0」。乱戦ダメージ修正±0、対象明記なしのため既定ルール
          // （前衛均等割り）。「敵視:最大」のPC全員は、次のアクションフェイズ開始時、スタミナ
          // ダイスの出目にかかわらず後衛に配置される。
          // 【重要な範囲の注意】既存のforce_back_row_next_phase（night.js
          // 11712-11728行付近）は、フラグが立つとentered全員（rosterCharacters.filter(entered)）を
          // 無条件で次の戰鬥フェイズ開始時に後衛固定する実装（死儀礼の鳥「飛び退き」等の先例は
          // 本文上も対象が「PC全員」のため一致していた）。しかし本行動の本文が明記する対象は
          // 「敵視:最大」のPC全員のみであり、敵視最大でないPCまで後衛に固定されるのは本文と
          // 一致しない。既存機構には対象PCを限定するパラメータが無く、新規の部分適用機構を
          // 追加するのは本タスクの範囲を超えるため、force_back_row_next_phaseは使わず、
          // 新規タグforce_back_row_aggro_max_manual（本文が「敵視:最大」のみを対象とする
          // 後衛強制配置を明記しており、既存タグをそのまま使うとentered全員に誤って適用されて
          // しまうケース専用）で機構化せずGM手動運用に委ねる。行動解決時にGMが「敵視:最大」の
          // PCのみを手動で後衛へ配置すること。特殊能力「闇に紛れる（条件発揮）」も効果発揮するが、
          // エントリ冒頭コメントの理由によりrows化しない。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_aggro_max_manual"],
        },
        {
          // 「雷大剣連撃＆角降ろし」：mod「＋120＆「雷:1D」」。乱戦ダメージ修正＋120、対象明記なしの
          // ため既定ルール（前衛均等割り）。雷1Dはnote上、個別効果とは別に乱戦ダメージ本体に付随
          // （個別効果側に属性の言及なし）のためgroupDamage.elementAccumへ構造化（雷は属性、
          // docs/enemy_damage_rules.md §7分類）。個別効果：「敵視:1以上」のPC全員に
          // 【個別ダメージ:180】を与える（本文に明記された対象、既定ルールではない）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 120, elementAccum: [{ label: "雷", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「雷槍」：mod「±0」。乱戦ダメージ修正±0、対象明記なしのため既定ルール（前衛均等割り）。
          // 個別効果：「敵視:最大」のPC1体に【個別ダメージ:120】＋「雷:2D」を別枠で与える——note
          // 文言上、雷2Dは個別ダメージに付随（雷は属性のためelementAccumで構造化）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 120, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "雷", amount: 2 }] },
          ],
        },
      ],
    },
    // 劇本8「夜之強敵決定表」2日目 出目4-6：血の君主（enemies_data_3.js:1098-1164、直前の
    // fields_data_1.js:540「1-3 デーモンの王子（234頁）\n4-6 血の君主（217頁）」に対応）。
    // resistance: 炎・発狂、size: L。単一形態。特殊能力〔行動激化〕（「体勢崩し」発生後、戦闘
    // 終了まで「1D」ではなく「1D+4」で判定）はrollBonusAfterGuardBreak:4（既存1~10表がこの範囲を
    // 完全にカバーするため追加行は不要、edele/maris/gladius/fulghorと同型）。
    //
    // 【対象範囲外・既知の制限その1】特殊能力〔捧げる呪い〕：「体勢崩し」が発生した直後の
    // ディフェンスフェイズには、アクション決定の1Dを振らず、自動的に出目「—」の行「数え上げる
    // 呪い」を実行する。night_gm_flow.js／auto_gm.jsを確認したが、既存のrows／
    // rollBonusAfterGuardBreak機構はいずれも「毎回1Dを振ってrows内の該当行を引く」ことを前提と
    // しており、「体勢崩し直後の1回だけ1Dを振らず特定行を強制実行する」という条件付き上書きを
    // 表現できる構造化フィールドは存在しない。gnoster「毒吐き」（boss_auto_gm_data.js:200-206）・
    // edele「猛毒の吐瀉」（同194-206）・libra「魔法陣滞留による行動内容指定」の2トリガー行
    // （同649-679）も同種の制限のため、いずれもrows外のコメント記録のみでGM手動発動としている。
    // 本Taskもこの既存の前例（コメントのみ、rows化しない、新規state機構は追加しない）を踏襲する。
    // 「数え上げる呪い」（出目「—」、mod:「－300＆「出血:1D」」）の全文：乱戦ダメージはPC全員を
    // 対象とし、乱戦ダメージは3回発生する（規則書本文どおり。GMは〔捧げる呪い〕の発動条件
    // （直前ターンで「体勢崩し」が発生した）を確認できた回のみ、次のディフェンスフェイズで
    // この行動を手動実行し、通常のrows表からは1Dを振らないこと）。
    //
    // 【対象範囲外・既知の制限その2】特殊能力〔血の君主の歓喜〕：ディフェンスフェイズでPCが
    // 「状態異常：出血」でHP損害を受けるたびに、このエネミーの「最も現在HPが減少しているHP行」に
    // 「HP回復：□□」（□は+1換算のためHP回復2に相当。ただしCLAUDE.md §17／countHealSquares・
    // sumMaxStatDeltaFromTextはいずれもPC側の回復テキスト解析用helperであり、条件付きで自動発動
    // する「敵HP側」の回復には未接続）を適用する。auto_gm.js／night.js／enemy_auto_gm_data.jsの
    // いずれにも「PCが特定の状態異常でHP損害を受けたことを検知し、自動でエネミーHPを回復させる」
    // 機構は存在しない（night.jsはPCが受けた損害がどの属性/状態異常に由来するかを、エネミー側の
    // 自動回復トリガーとしては追跡していない）。新規のstate追跡機構を追加するのは本Taskの範囲を
    // 超えるため、GM向けに規則書の全文を記録するに留める：「ただし、このエネミーが2回以上
    // 『体勢崩し』になることはなく、モブHPには適用しない」という但し書きも含めて手動運用すること。
    "strong_type|blood_lord": {
      rollBonusAfterGuardBreak: 4,
      rows: [
        {
          // 「槍突進」（出目1~2）：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に
          // 明記、gladius/maris/edeleと同じ規約で本文の数値は既にN人分込みの合計値）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「血の飛沫」（出目3~4）：mod「－120＆「出血:1D」」。乱戦ダメージ修正－120（対象明記
          // なし＝既定ルール＝前衛均等割り）。個別効果：「敵視:1以上」のPC全員に【個別ダメージ:
          // 120】＋「出血:1D」を別枠で与える——note文言上、出血1Dは個別ダメージに付随（mod欄の
          // 数値・種別と個別効果の記述が完全に一致するため、二重計上を避けgroupDamageには付随
          // させない）。出血は状態異常（docs/enemy_damage_rules.md §7、CLAUDE.md §17分類）の
          // ためailmentAccumで構造化する（elementAccumではない）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 120, targetRule: { kind: "aggroAtLeast1All" }, ailmentAccum: [{ label: "出血", amount: 1 }] },
          ],
        },
        {
          // 「血炎の爪痕」（出目5~6）：mod「±0＆「炎:1D」＆「出血:1D」」。乱戦ダメージ修正±0
          // （対象明記なし＝既定ルール＝前衛均等割り）。個別効果：「敵視:最大」のPC1体に
          // 【個別ダメージ:180】＋「炎:1D」＋「出血:1D」を別枠で与える——mod欄の数値・種別が
          // この個別効果と完全に一致するためgroupDamageには付随させない。炎は属性
          // （elementAccum）、出血は状態異常（ailmentAccum）で構造化する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            {
              amount: 180,
              targetRule: { kind: "aggroMax" },
              elementAccum: [{ label: "炎", amount: 1 }],
              ailmentAccum: [{ label: "出血", amount: 1 }],
            },
          ],
        },
        {
          // 「血炎の槍撃＆槍の幻影」（出目7~8）：mod「±0＆「炎:1D」＆「出血:1D」」。乱戦ダメージ
          // 修正±0、「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。mod欄の
          // 「炎:1D」は本文中に矛盾する別記載が無いため既定どおりgroupDamage（乱戦ダメージ対象＝
          // frontAggroAtLeast1All）に付随させる。一方、mod欄の「出血:1D」は本文が明確に「個別
          // 効果：『1D』して、出目『1~3』なら前衛のPC全員に、『4~6』なら後衛のPC全員に、出血:1Dを
          // 与える」という、乱戦ダメージ対象（前衛かつ敵視1以上のみ）とは異なる対象集団への、
          // 二次判定（1D）で決まる別枠の状態異常蓄積のみの効果（HP損害を伴わない）と明記して
          // いるため、これをgroupDamageへ重複して付随させることはしない。この二次判定は「前衛
          // 全員 or 後衛全員のいずれか」という、既存targetRule（6種）のどれにも該当しない可変
          // ターゲットを1Dで決定する構造であり、既存のindividualDamage/repeat/rotateはいずれも
          // 固定対象・固定回数を前提とするため構造化できない。新規タグdice_branch_target_manual
          // （本ブロック専用、「1Dで対象集団自体が分岐する」ケースの記録用。既存の
          // variable_repeat_manualは「PC人数依存の可変回数」専用のタグのため意味が異なり流用
          // しない）を付与し、GM手動処理に委ねる。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["dice_branch_target_manual"],
        },
        {
          // 「血炎の飛沫」（出目9~10）：mod「－180」。乱戦ダメージ修正－180（対象明記なし＝既定
          // ルール＝前衛均等割り）。個別効果は「敵視:1以上」のPC全員が対象の判定（11|フィジカル、
          // 全PCプールではなく敵視1以上のみに絞られた部分集合、edele/nox_dragonkin_soldier系の
          // savingThrow.targetFilter: aggroAtLeast1と同型）で、失敗したPCに【個別ダメージ:120】＋
          // 「炎:1D」＋「出血:1D」を与える。savingThrow.onFail.elementAccum/ailmentAccumは
          // Task3で拡張済みでnight.js側のqueueAttributeAccumが読み取り自動反映するため
          // （enemy_auto_gm_data.js内「毒の瘴気」等の既存事例と同型）、ここに構造化する。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { modifier: -180 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "physical",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 120, elementAccum: [{ label: "炎", amount: 1 }], ailmentAccum: [{ label: "出血", amount: 1 }] },
          },
        },
      ],
    },
    "big_dog_bear|rune_bear": {
      // 特殊能力〔HP価値:+10〕：常に「HP価値:+10（最大100）」。個別roll行のconditionsは各roll行
      // 固有の効果を表すフィールドであり、この特殊能力はrollMin/rollMaxに紐づかないエントリ全体の
      // 常時効果のため、rowに紐づけるのは意味的に不正確。night.js側にエントリ全体の常時HP価値
      // バフを読み取る既存の仕組みは無いため、機構化せずGM手動運用（rows外、機構化せず）とする。
      rows: [
        {
          // 「腕振り回し」：mod: "±0"。個別効果：「敵視:1以上」のPC全員は、次のアクションフェイズに獲得するスタミナダイスが1個減少する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「のしかかり」：mod: "＋120"。この乱戦ダメージを回避するPCはダイスコストが半減する
          // （reducible_by_stamina_dice、既存タグと同じ効果）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「ベアハッグ」：mod: "—"。個別効果：「敵視:最大」のPC1体に【個別ダメージ:300】を与える。この効果に対してガード不可。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    // Task6: soldier_knight|death_knight（死の騎士、enemies_data_2.js:1264-1297確認済み）。
    //
    // 【出目1~2「瞬雷・双斧」のsavingThrow構造化について】
    // mod: "＋120＆「雷:1D」"。個別効果：PC全員は〈11|フィジカル〉を行い、失敗すると「雷:1D」を
    // 被る（HP損害を伴わないailment/element蓄積のみの失敗効果）。night.js（約10049-10061行）を
    // 確認したところ、savingThrow.onFailは`typeof outcomeEntry.amount === "number"`のときのみ
    // 個別ダメージ入力欄へ書き込み、elementAccum/ailmentAccumは`amount`の型に関わらず常に
    // queueAttributeAccumへ渡される実装であることを確認した。つまりonFailに`amount`キーを
    // 含めずelementAccumのみを指定しても、HP損害を誤って書き込むことなく蓄積のみを正しく適用
    // できる。よってGlobal Constraints文書で示された「savingThrowのonFailはamount専用のため
    // 構造化不能」という理由は現在の実装と一致しないため採用せず、savingThrowで構造化する。
    // 判定対象は「PC全員」（敵視条件の指定なし）のためtargetFilterは付与せず、resolveSavingThrow
    // の既定動作（entered全員が対象）に委ねる。
    // 2026-08-29修正：mod欄の「雷:1D」は本文中の個別判定（PC全員〈11|フィジカル〉、失敗時
    // 「雷:1D」、HP損害なし）の失敗時効果と数値・種別が完全に一致し、本文はこれ以外に乱戦
    // ダメージ側の別枠属性効果を明記していない。よって2277-2289行の解釈方針（ancient_dragon
    // 「地を這う赤雷」等の先例）に従い、mod欄の表記は当該個別効果を要約的に繰り返したものと
    // 解釈し、groupDamage.elementAccumには付随させず、savingThrow.onFail.elementAccumのみに
    // 構造化する（乱戦ダメージ対象への二重適用を回避）。旧版はgroupDamageとsavingThrow.onFailの
    // 両方に雷:1を設定しており、二重計上バグだった。
    "soldier_knight|death_knight": {
      rows: [
        {
          // 「瞬雷・双斧」：乱戦ダメージ修正＋120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別効果：PC全員が〈11|フィジカル〉を
          // 行い、失敗すると「雷:1D」（HP損害なし）。mod欄の「雷:1D」はこの個別判定失敗時効果と
          // 数値・種別が完全に一致するため二重計上を避け、groupDamageには付随させない
          // （savingThrow.onFail側のみに構造化。上記エントリ冒頭コメント参照）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "physical",
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { elementAccum: [{ label: "雷", amount: 1 }] },
          },
        },
        {
          // 「騎士の雷槍」：乱戦ダメージ修正－60（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。mod欄の「雷:2D」はgroupDamageに付随。
          // 個別効果：「敵視:1以上」のPC全員に【個別ダメージ:60】＋「雷:1D」を別枠で与える
          // （mod欄の雷2Dとは数値が異なるため別効果として個別に構造化）。この乱戦ダメージを
          // 回避するPCはダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60, elementAccum: [{ label: "雷", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "雷", amount: 1 }] },
          ],
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「薙ぎ払い＆掴み攻撃」：乱戦ダメージ修正－120（「—」ではないため発生、本文に乱戦ダメージ
          // の対象明記なし）。既定ルール（前衛均等割り）。個別効果：「敵視:最大」のPC1体に
          // 【個別ダメージ:240】を与える。この効果に対してガード不可（no_guard）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    // 劇本9「夜之強敵決定表」に登場する神獣獅子舞（familyId:rock_spirit_beast、
    // enemies_data_1.js:590-654、size:L、resistance:発狂）。Task 7 brief参照。
    //
    // 【特殊能力〔弱点:猛毒＆出血＆腐敗〕公開情報について】
    // このテキストはenemies_data_1.js:652の`special`フィールドに既存で記録されており
    // （〔弱点:◯◯〕公開情報...という形式）、night.jsの`extractWeakness`/
    // `extractPublicSpecialNames`（night.js:12815-12830付近）が既にこの`special`テキストを
    // 正規表現で解析し、敵チップの公開情報表示欄に自動反映する仕組みが存在する。これは
    // enemy_auto_gm_data.jsのスキーマとは完全に独立した既存機構であり、本エントリ側で
    // 追加のフィールドを新設する必要はない（gnoster「〔弱点:回復〕」等の先例と同様、
    // rows[]構造化の対象外。CLAUDE.md §36「不要為単一效果建立第三套特殊架構」に基づき
    // 既存のspecial表示機構をそのまま利用する）。
    //
    // 【特殊能力〔行動激化〕】「体勢崩し」発生後、戦闘終了まで行動決定を「1D」ではなく
    // 「1D+2」で行う——demihuman_beastfolk_club|demihuman_queen_swordmaster等と同型の
    // rollBonusAfterGuardBreak機構でそのまま表現できる。rollMin/rollMaxが6を超える行
    // （6~8）は通常時（1D6=1〜6）には到達せず、体勢崩し後（1D6+2=3〜8）にのみ到達する。
    //
    // 【出目8「神獣の舞」の二重計上判定について（2277-2289行の解釈方針を適用）】
    // mod: "±0＆「魔:1D」＆「雷:1D」＆「凍傷:1D」"。本文の個別効果は「敵視:最大」のPC1体に
    // 【個別ダメージ:120】＋「魔:1D」のみを明記しており、雷:1D・凍傷:1Dへの言及は個別効果側に
    // 一切無い。よって「魔:1D」はmod欄と個別効果で数値・種別が完全一致する同一効果の要約的
    // 重複と解釈し、individualDamage側にのみ構造化してgroupDamageには含めない（二重計上回避）。
    // 一方「雷:1D」「凍傷:1D」はmod欄にのみ存在し本文個別効果に対応する記載が無いため、二重
    // 適用のおそれが無い乱戦ダメージ側の独立した付随効果としてgroupDamageに構造化する
    // （凍傷は状態異常のためailmentAccum、魔・雷は属性のためelementAccum。2257行の分類基準）。
    "rock_spirit_beast|sacred_beast_lion_dance": {
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「突撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「神獣竜巻」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果：「敵視:最大」のPC全員は次の
          // アクションフェイズ開始時に獲得するスタミナダイスが2個減少する（HP損害を伴わないため
          // individualDamage無し）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「雷の槍」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:120】＋「雷:1D」を与える——
          // 「PC人数」はパーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わず
          // conditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。
          rollMin: 5,
          rollMax: 5,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「広範囲降雷」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果：
          // 「敵視:1以上」のPC全員は〈12|運試し〉、それ以外のPC全員は〈10|運試し〉を行い、
          // 失敗したPCに【個別ダメージ:180】＋「雷:2D」を与える。savingThrow.onFailは
          // amountの型に関わらずelementAccum/ailmentAccumが常にqueueAttributeAccumへ渡される
          // 実装（night.js queueAttributeAccum、soldier_knight|death_knightの2026-08-29修正
          // コメント参照）ため、amountとelementAccumを両方構造化する。
          rollMin: 6,
          rollMax: 6,
          savingThrow: {
            stat: "luck",
            targetByCondition: [
              { condition: { kind: "aggroAtLeast1" }, target: 12 },
              { condition: { kind: "default" }, target: 10 },
            ],
            onFail: { amount: 180, elementAccum: [{ label: "雷", amount: 2 }] },
          },
        },
        {
          // 「神獣霜踏み」：乱戦ダメージ修正－120＋「凍傷:2D」（本文に別途対応する個別効果の
          // 記載なし＝mod欄独自の付随効果、二重計上のおそれ無し。凍傷は状態異常のため
          // ailmentAccum）。既定ルール（前衛均等割り）。この乱戦ダメージを回避するPCは
          // ダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 7,
          rollMax: 7,
          groupDamage: { modifier: -120, ailmentAccum: [{ label: "凍傷", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「神獣の舞」：乱戦ダメージ修正±0、対象明記無しのため既定ルール（前衛均等割り）。
          // mod欄の「魔:1D」は本文個別効果（「敵視:最大」PC1体に【個別ダメージ:120】＋「魔:1D」）
          // と数値・種別が完全一致するため要約的重複と解釈し、individualDamage側にのみ構造化
          // （groupDamageには含めない、上記エントリ冒頭コメント参照）。「雷:1D」「凍傷:1D」は
          // 本文個別効果に対応する記載が無く二重適用のおそれが無いため、乱戦ダメージ側の独立した
          // 付随効果としてgroupDamageに構造化する（凍傷はailmentAccum、雷はelementAccum）。
          rollMin: 8,
          rollMax: 8,
          groupDamage: {
            modifier: 0,
            elementAccum: [{ label: "雷", amount: 1 }],
            ailmentAccum: [{ label: "凍傷", amount: 1 }],
          },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 120, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "魔", amount: 1 }] },
          ],
        },
      ],
    },
    // 劇本9「夜之強敵決定表」に登場する騎士アルトリウス（familyId:soldier_knight、
    // enemies_data_2.js:1522-1580、size:M、resistance:null）。Task 8 brief参照。
    //
    // 【特殊能力〔モブ1追加＆固定行動〕投資調査結果】
    // boss_auto_gm_data.js冒頭コメント（27-33行）で、同種の「戦闘中にモブHPを動的追加する」
    // stragedesの「亡者召喚」が「既存のrows/state機構でカバーできないためスコープ外
    // （GM手動処理）」と明記されている。auto_gm.js（86-136行）を確認したところ、
    // structured.rollOverrideは既存のmobHpRowsの有無で出目を半減する"halfIfNoMobs"
    // （坩堝の騎士用）のみが実装されており、「戦闘開始時にPC人数×2のモブHP行を新規追加する」
    // 機構や「モブHPが閾値以上なら1Dを振らず特定行を強制実行する」機構は存在しない
    // （night_gm_flow.jsの「+モブN」後綴もシナリオ開始時の遭遇テーブル表記であり、戦闘中の
    // 動的追加とは無関係）。よってstragedesと同じ結論に従い、この特殊能力はrows外の
    // コメントとして原文のみ記録し、新規state機構は追加しない（GM手動処理）。
    //
    // 〔モブ1追加＆固定行動〕戦闘開始時、HP枠に「モブ1」を追加する。このモブHPはL補を問わず
    // 「最大HP:PC人数×2」である。このエネミーのアクション決定時、「モブHP:□以上」の場合、
    // アクション決定の1Dを振らず、自動的に「影の貴人の群れ」を実行する。
    //
    // 【特殊能力〔行動激化〕】「体勢崩し」発生後、戦闘終了まで「1D」ではなく「1D+1」で行う
    // → rollBonusAfterGuardBreak: 1（既存機構をそのまま使用）。
    //
    // 【特殊能力〔深淵纏い（条件発揮）〕】PC全員は、戦闘終了まで、このエネミーの「乱戦ダメージ／
    // 個別ダメージ」を受けるごとに追加で「HP損害:■」を被り、このエネミーが「総合ダメージ」から
    // 被るHP損害を■だけ軽減する。この効果は最大で2回まで累積する。■を複数含み累積状態管理も
    // 必要な複雑効果のため、CLAUDE.md §19の原則（■は自行発明禁止）に従い数値化・状態機構の
    // 新設はせず、この能力が発揮される出目6・7にconditions: ["unknown_hp_damage_manual"]を
    // 付与し、GM手動処理に委ねる。
    //
    // 【出目「—」（モブHP依存トリガー）「影の貴人の群れ」】mod:"－120"。乱戦ダメージをガードする
    // PCはそのガードコストを+1する（例:2なら3に悪化する）。乱戦ダメージを回避するPCは、支払った
    // ダイスコストの値を半分（端数切り捨て。最低値1）として扱う（例:3で回避した場合は1で回避した
    // ことになる）。上記〔モブ1追加＆固定行動〕によりモブHP存在時のみ自動発動しうる（1Dを振らず
    // 自動実行される）die-lessな行のため、rows配列には含めずコメントとしてのみ記録する
    // （strong_type|blood_lord「数え上げる呪い」Task 4と同型の扱い）。
    "soldier_knight|knight_alutrius": {
      rollBonusAfterGuardBreak: 1,
      rows: [
        {
          // 「連撃」：mod:"－300"。乱戦ダメージが2回発生する（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「縦回転斬り」：mod:"—"のため乱戦ダメージは発生しない。個別効果（PC人数回実行）：
          // 「敵視:1以上」のPC1体に【個別ダメージ:180】を与える。「PC人数」はパーティ人数に
          // 依存する可変値のため、固定回数のrepeat/rotateは使わずconditionsでGM手動処理に
          // 委ねる（Global Constraint 7）。この個別ダメージで「HP損害:■」以上を被ったPCは
          // 次のアクションフェイズ開始時に獲得するスタミナダイスが1個減少するが、■を含むため
          // 数値化せずコメントのみ。
          rollMin: 3,
          rollMax: 4,
          conditions: ["variable_repeat_manual", "unknown_hp_damage_manual"],
        },
        {
          // 「跳躍突き刺し」：mod:"＋180"。乱戦ダメージに対してガード不可（no_guard）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard"],
        },
        {
          // 「飛び退き＆深淵纏い」：mod:"－120"。〔深淵纏い〕発揮（上記エントリ冒頭コメント参照、
          // ■を含み複雑な累積のため数値化せずunknown_hp_damage_manualのみ付与）。次の
          // アクションフェイズでPC全員がスタミナダイスの出目にかかわらず後衛に配置される
          // （force_back_row_next_phase）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase", "unknown_hp_damage_manual"],
        },
        {
          // 「咆哮連撃＆深淵纏い」：mod:"＋120"。〔深淵纏い〕発揮（■を含むため
          // unknown_hp_damage_manual）。個別効果：「敵視:最大」のPC1体に【個別ダメージ:300】を
          // 与える。
          rollMin: 7,
          rollMax: 7,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["unknown_hp_damage_manual"],
        },
      ],
    },
    // Batch D1: dragon科3体（丘陵の飛竜／山嶺の氷竜／溶岩土竜）＋tree_spirit科1体（黄金樹の化身）＋
    // death_bird_raven科1体（碩大鴉）。enemies_data_1.js:253/293/333/395/1064参照
    // （batch-D1-brief.md）。既存の同familyエントリ（dragon|great_earth_dragon/gluttonous_dragon/
    // ancient_dragon、tree_spirit|withered_tree_spirit、death_bird_raven|death_ritual_bird等）を
    // 参照し、同型の書式・タグを踏襲した。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - ice_frost_trigger（山嶺の氷竜専用）: 特殊能力「氷霜（条件発揮）」＝効果発揮後、エンド
    //   フェイズの開始時に前衛のPC全員へ「凍傷:1D」を与える、という遅延・持続効果のトリガーで
    //   あることの記録（great_earth_dragon「溶岩の滞留」＝lava_pooling_triggerと同じ設計思想。
    //   この行自身のgroupDamage/individualDamageとは発生タイミングが異なる別枠の効果のため、
    //   ailmentAccumには含めずconditionsのみで記録する）。
    "dragon|hill_wyvern": {
      rows: [
        {
          // 「尻尾振り回し」：「敵視:1以上」のPC全員が「乱戦ダメージ割合:3人分」（本文に明記、
          // 前衛限定の記載なし。dragon|ancient_dragonの同名行と完全一致するパターン）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「爪ひっかき」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者が1人もいない場合は
          // 前衛が対象（本文に明記されたフォールバック規則。ancient_dragonの同名行と完全一致）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「空中旋回＆滞空」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果は
          // PC全員が同一目標値（11|運試し）で判定し、「半数以上が失敗」という集団閾値の結果で
          // 「タイムロス」が蓄積するかどうかが決まる——savingThrowは個別PCごとの敵視分岐DCを
          // 前提とした構造のためこの集団閾値判定には対応できない。conditionsとコメントでGM手動
          // 処理に委ねる（majority_fail_time_loss_manual）。特殊能力「滞空」＝次のアクション
          // フェイズ開始時、PC全員が出目に関わらず後衛へ強制配置される
          // （force_back_row_next_phase。ancient_dragonの同名行と完全一致）。
          rollMin: 5,
          rollMax: 6,
          conditions: ["majority_fail_time_loss_manual", "force_back_row_next_phase"],
        },
      ],
    },
    "dragon|mountain_ice_dragon": {
      rows: [
        {
          // 「尻尾振り回し＆氷霜」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が
          // 無いため既定ルール（前衛均等割り）。特殊能力「氷霜」を効果発揮（ice_frost_trigger）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["ice_frost_trigger"],
        },
        {
          // 「爪ひっかき＆飛び退き」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。
          // 個別ダメージ180＋「凍傷:1D」は「敵視:最大」のPC1体に無条件で発生。特殊能力「氷霜」を
          // 効果発揮（ice_frost_trigger）。行動名に「飛び退き」とあるが、注釈本文には特殊能力
          // 「飛び退き」の効果発揮が明記されていないため、数値・効果を捏造せずタグ付けしない
          // （tibias_summoning_boatの「飛沫の一撃＆転移」と同種の判断）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            { amount: 180, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "凍傷", amount: 1 }] },
          ],
          conditions: ["ice_frost_trigger"],
        },
        {
          // 「前方ブレス」：乱戦ダメージはPC全員を対象とする（本文に明記）。mod欄の「凍傷:1D」は
          // 本文が別途対象を再指定していないため乱戦ダメージと同じ対象（PC全員）に付随する
          // （ancient_dragon「炎ブレス＆滞空」と同型）。個別効果は「敵視:最大」のPC1体に
          // 【追加ダメージ:240】＋別途「凍傷:1D」を与える——本文が「追加」と明記しており、対象・
          // 数値ともに乱戦ダメージ側（PC全員・凍傷1D）とは異なる別枠の効果のため、二重計上では
          // なく両方を構造化する（Global Constraint 5の「mod欄のXと本文個別効果のXが数値で
          // 異なる場合は独立した効果として構造化する」の解釈に基づく）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0, ailmentAccum: [{ label: "凍傷", amount: 1 }] },
          targetRule: { kind: "allPCs" },
          individualDamage: [
            { amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "凍傷", amount: 1 }] },
          ],
        },
      ],
    },
    "dragon|lava_earth_dragon": {
      rows: [
        {
          // 「武器叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果:「敵視:最大」のPC全員は次のアクションフェイズ
          // 開始時に獲得するスタミナダイスが2個減少する（HP損害を伴わないためconditionsのみ。
          // great_earth_dragonの同名行と完全一致するパターン）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「尻尾振り回し」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。乱戦ダメージを回避するPCは、支払ったダイスコストの値を
          // 半分として扱う（reducible_by_stamina_dice。great_earth_dragonの同名行と完全一致）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「溶岩吐き＆溶岩の滞留」：乱戦ダメージ修正±0＋「炎:1D」（mod欄の固定値、骰子では
          // ないためelementAccum、対象の明記が無いため既定ルール＝前衛均等割り）。個別ダメージ
          // 180は「敵視:最大」のPC1体に別枠で発生。特殊能力「溶岩の滞留」（great_earth_dragonの
          // 同名行と完全一致するパターン、lava_pooling_trigger）を効果発揮。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["lava_pooling_trigger"],
        },
      ],
    },
    "tree_spirit|golden_tree_avatar": {
      rows: [
        {
          // 「錫杖叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記。
          // withered_tree_spirit「突進」と同型のパターン）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「黄金樹の尻撃」：乱戦ダメージ修正－120＋「聖:1D」（mod欄の固定値、骰子ではないため
          // elementAccum。本文個別効果には聖の言及が一切無いため二重計上のおそれが無く、独立した
          // 付随効果としてgroupDamageに構造化する）。対象の明記が無いため既定ルール（前衛均等
          // 割り）。個別効果は「敵視:最大」のPC全員の判定（12|フィジカル）で、失敗しても
          // HP損害は発生せず次のアクションフェイズのスタミナダイス-2のみのため、savingThrow
          // （常にダメージ前提の設計）は使わずconditionsのみ記録する
          // （duke_freydia「貫く糸」と同型の判断、stamina_dice_reduction_next_phase）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「黄金の地」：乱戦ダメージ修正－180＋「聖:1D」（mod欄の固定値、骰子ではないため
          // elementAccum。対象の明記が無いため既定ルール＝前衛均等割り）。個別効果（PC人数回
          // 実行）:「敵視:1以上」のPC1体に【個別ダメージ:120】＋「聖:1D」を与える——mod欄の
          // 数値（180）と個別効果の数値（120）が一致しないため、demon_prince「炎の隕石」のような
          // 要約表記とは判断せず、それぞれ独立した効果として構造化する（2254行の解釈方針）。
          // 個別効果は対象PC1体（不特定）＋「PC人数」というパーティ人数依存の可変回数のため、
          // 固定回数のrepeat/rotateは使わずconditionsとコメントでGM手動処理に委ねる
          // （Global Constraint 7、variable_repeat_manual）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -180, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["variable_repeat_manual"],
        },
      ],
    },
    "death_bird_raven|giant_raven": {
      rows: [
        {
          // 「連続嘴突き」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）:「敵視:1以上」のPC1体に【個別ダメージ:120】を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わずconditionsと
          // コメントでGM手動処理に委ねる（Global Constraint 7）。
          rollMin: 1,
          rollMax: 2,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「跳躍踏みつけ」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果:「敵視:最大」のPC1体は次のアクションフェイズの
          // 開始時、獲得するスタミナダイスが2個減少する（HP損害を伴わないためconditionsのみ）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「噛みつき」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。この乱戦ダメージをガードするPCは、そのガードコストを+1
          // する（guard_cost_penalty、troll_dragonkin_wormface|nox_dragonkin_soldier「両腕
          // 叩きつけ」と同型）。回避するPCは、支払ったダイスコストの値を半分として扱う
          // （reducible_by_stamina_dice）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["guard_cost_penalty", "reducible_by_stamina_dice"],
        },
      ],
    },
    // Batch D2（.superpowers/sdd/2026-08-28-enemy-boss-auto-gm-phase2-phase3-plan/
    // batch-D2-brief.md参照）：rock_spirit_beast科4体（黄金カバ／暗黒の落とし子／暗黒の落とし子
    // （枯れ）／祖霊）＋rat_basilisk科2体（ユビムシたち／バジリスクたち）を追加。属性/状態異常
    // taxonomy（elementAccum＝魔/炎/雷/聖、ailmentAccum＝猛毒/腐敗/出血/凍傷/発狂/睡眠/呪死）は
    // 本ファイル冒頭付近の既存taxonomyコメントブロックに準拠。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - size_restricted_guard_break_manual: golden_hippo「大型個体」特殊能力専用。「体勢崩し」後の
    //   行動激化（1D+4）が「エネミー名:黄金カバ（大）」のサイズでのみ発揮されるという、既存の
    //   rollBonusAfterGuardBreak（体勢崩し依存のみでサイズ条件を持たない汎用機構）ではそのまま
    //   適用すると通常サイズの個体にも誤って1D+4が適用されてしまう条件のため、
    //   cavalry|unnamed_king「王の威光」（mob_hp_trigger_manual）と同型の判断で、トップレベルの
    //   rollBonusAfterGuardBreakは設定せず、この条件でのみ到達可能な行（golden_hippoのroll
    //   7~8／9~10）にのみ本タグを付与し、GMがサイズ＆体勢崩しの両条件を確認した上で手動運用する。
    "rock_spirit_beast|golden_hippo": {
      // 特殊能力（rows[]には含めずここに完全記録し、GM手動対応とする）：
      // 〔弱点:腐敗〕公開情報（209頁）。常時有効な受動的特性のため行動テーブルの行としては
      // 構造化しない。
      // 〔大型個体〕「エネミー名:黄金カバ（大）」のサイズでのみ効果発揮。「体勢崩し」になった
      // ターンのディフェンスフェイズは、アクション決定の1Dを振らず、自動的に「針降らし」
      // （－240＆「聖:1D」、乱戦ダメージは2回発生する）を行う——ロール無しの強制アクションのため
      // 既存のrollOverride/rollBonusAfterGuardBreak機構では表現できない新しいパターンとして
      // 未構造化のまま（rows外、GM手動処理、demihuman_beastfolk_club|demihuman_queen_swordmaster
      // 「棄杖＆流星撃」と同型の判断）。その後、戦闘終了まで、アクション決定は「1D」ではなく
      // 「1D+4」で行う——ただしこの1D+4化はサイズ条件（黄金カバ（大）のみ）付きであり、上記の
      // 新規タグ導入理由コメント（本ブロック冒頭）のとおりrollBonusAfterGuardBreakは設定しない。
      rows: [
        {
          // 「突進」：「敵視:1以上」のPC全員が「乱戦ダメージ割合:3人分」（本文に明記、前衛限定の
          // 記載なし、dragon|ancient_dragon「尻尾振り回し」と同型のaggroAtLeast1All）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次のアクションフェイズ開始時に
          // 獲得するスタミナダイスが1個減少する（HP損害を伴わないためconditionsのみ）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「食いつき」：乱戦ダメージ修正－120（対象明記なし＝既定ルール＝前衛均等割り）。個別
          // ダメージ300は「敵視:最大」のPC1体に別枠で発生し、この効果に対してガード不可
          // （no_guard）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「大回転突進」：乱戦ダメージ修正±0＋「聖:1D」（mod欄の固定値、骰子ではないため
          // elementAccum。本文に対応する個別効果の記載が無く二重計上のおそれ無し。対象明記なし＝
          // 既定ルール＝前衛均等割り）。「敵視:1以上」のPC全員は乱戦ダメージを回避するとき、
          // 支払ったダイスコストの値を半分として扱う（reducible_by_stamina_dice）。この行は通常
          // の1D6（1~6）には到達せず、上記特殊能力〔大型個体〕の1D+4でのみ到達する
          // （size_restricted_guard_break_manual）。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: 0, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice", "size_restricted_guard_break_manual"],
        },
        {
          // 「針飛ばし」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:120】＋「聖:1D」を与える——
          // 「PC人数」はパーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わず
          // conditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。この行も上記と同様
          // 通常の1D6には到達せず、〔大型個体〕の1D+4でのみ到達する
          // （size_restricted_guard_break_manual）。
          rollMin: 9,
          rollMax: 10,
          conditions: ["variable_repeat_manual", "size_restricted_guard_break_manual"],
        },
      ],
    },
    "rock_spirit_beast|dark_offspring": {
      // 特殊能力（rows[]には含めずここに完全記録し、GM手動対応とする）：
      // 〔隕鉄特効〕公開情報。このエネミーは「星の眷属」として扱う（隕鉄特効の対象である）。
      // 常時有効な受動的特性のため行動テーブルの行としては構造化しない。
      // 〔先制の一撃〕このエネミーを「撃破ルーン:+2」する。このエネミーは戦闘の1ターン目のみ
      // 「HP価値:-20」され、ディフェンスフェイズにアクションしない。代わりに、アクションフェイズで
      // PCがスタミナダイスを獲得し隊列と敵視を決定した直後、PCがアクション決定の1Dを振るより先に、
      // このエネミーが自動的に「魔力の閃光」を行う（この処理は1ターン目のみ）——ターンをまたぐ
      // 固定順序の自動処理であり既存のrollOverride/rollBonusAfterGuardBreak機構では表現できない
      // ため、rows外・GM手動処理とする（Global Constraint 7）。
      rows: [
        {
          // 「魔力の閃光」：乱戦ダメージ修正+120＋「魔:2D」（mod欄の固定値。対象明記なし＝既定
          // ルール＝前衛均等割り）。個別効果:「敵視:1以上」のPC全員に【個別ダメージ:180】＋
          // 「魔:1D」を別枠で与える——mod欄の魔:2と個別効果の魔:1は数値が異なるため、
          // cavalry|unnamed_king「雷光剣槍＆落雷」と同型の判断でそれぞれ独立した効果として構造化
          // する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 180, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "魔", amount: 1 }] },
          ],
        },
        {
          // 「星雲」：乱戦ダメージ修正±0＋「魔:1D」（mod欄の固定値、本文に対応する個別効果の
          // 記載が無く二重計上のおそれ無し。対象明記なし＝既定ルール＝前衛均等割り）。「敵視:1
          // 以上」のPC全員は乱戦ダメージを回避するとき、支払ったダイスコストの値を半分として
          // 扱う（reducible_by_stamina_dice）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0, elementAccum: [{ label: "魔", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「ハサミ食らいつき」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別
          // ダメージ300は「敵視:最大」のPC1体に別枠で発生し、この効果に対してガード不可
          // （no_guard）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    "rock_spirit_beast|dark_offspring_withered": {
      // 特殊能力（rows[]には含めずここに完全記録し、GM手動対応とする）：
      // 〔隕鉄特効〕公開情報。このエネミーは「星の眷属」として扱う（隕鉄特効の対象である）。
      // 常時有効な受動的特性のため行動テーブルの行としては構造化しない。
      // 〔遠距離〕アクションフェイズ開始時、PC全員はスタミナダイスの出目にかかわらず後衛に配置
      // され、エンドフェイズまで「エリア移動」のダイスコストが1から3に変更される——出目に紐づく
      // 行動ではなく常時（毎ターン）有効な受動的特性のため、行動テーブルの行としては構造化しない
      // （big_dog_bear|rune_bear「HP価値:+10」と同型の判断）。
      rows: [
        {
          // 「魔力の閃光」：乱戦ダメージ修正+120＋「魔:2D」（mod欄の固定値、本文に対応する個別
          // 効果の記載が無く二重計上のおそれ無し。対象明記なし＝既定ルール＝前衛均等割り）。
          // 「敵視:1以上」のPC全員は乱戦ダメージを回避するとき、支払ったダイスコストの値を半分
          // として扱う（reducible_by_stamina_dice）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「重力波」：乱戦ダメージ修正－300＋「魔:1D」（mod欄の固定値、本文に対応する個別効果の
          // 記載が無く二重計上のおそれ無し。対象明記なし＝既定ルール＝前衛均等割り）。乱戦
          // ダメージは2回発生する（repeat:2）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -300, repeat: 2, elementAccum: [{ label: "魔", amount: 1 }] },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「アステール・メテオ」：乱戦ダメージ修正±0＋「魔:1D」（対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果（PC人数+1回実行）：「敵視:1以上」のPC全員に【個別ダメージ:
          // 60】＋「魔:1D」を与える——「PC人数+1」はパーティ人数に依存する可変値のため、固定
          // 回数のrepeat/rotateは使わずconditionsとコメントでGM手動処理に委ねる（Global
          // Constraint 7）。mod欄の「魔:1D」は個別効果の「魔:1D」と数値・種別が完全一致するため、
          // 本ファイル冒頭の解釈方針（約2253〜2265行目、ancient_dragon「地を這う赤雷」等の先例）
          // どおり個別効果を要約的に繰り返したものと解釈し、二重計上を避けるためgroupDamage側には
          // 付随させない。【2026-08-29レビュー訂正】旧版はdeath_bird_raven|demon_prince「黄金の
          // 地」を根拠にgroupDamage.elementAccumへ構造化していたが、「黄金の地」は実際にはmod欄
          // 180と個別効果120の数値が不一致だったため独立構造化した事例であり、mod欄と個別効果が
          // 完全一致する本行とは逆のケースで根拠として誤っていた。加えてgroupDamage側の
          // targetRuleはfrontAll（敵視条件なし）のため、そのまま残すと敵視0の前衛PCにも誤って
          // 魔+1が付与され、敵視1以上のPCはGMが個別効果側で手動付与する魔+1と合わせて二重計上に
          // なる問題があった。魔:1DはPC人数+1回実行の個別効果側（GM手動処理、variable_repeat_
          // manual）に完全に委ね、groupDamageは既定ルール分のmodifier:0のみを構造化する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["variable_repeat_manual"],
        },
      ],
    },
    "rock_spirit_beast|ancestral_spirit": {
      // special: null（特殊能力なし）。
      rows: [
        {
          // 「角振り上げ」：乱戦ダメージ修正+120（対象明記なし＝既定ルール＝前衛均等割り）。
          // 個別効果:「敵視:最大」のPC全員は次のアクションフェイズ開始時に獲得するスタミナ
          // ダイスが2個減少する（HP損害を伴わないためconditionsのみ）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「霊の飛沫」：乱戦ダメージ修正±0（対象明記なし＝既定ルール＝前衛均等割り）。個別
          // 効果:「敵視:1以上」のPC全員が判定（11|フィジカル、全PCプールではなく敵視1以上のみに
          // 絞られた部分集合、soldier_knight|death_knight系のsavingThrow.targetFilter:
          // aggroAtLeast1と同型）を行い、失敗したPCに【個別ダメージ:120】＋「魔:1D」を与える。
          // mod欄の「魔:1D」はonFailの魔:1と数値・種別が完全一致するため二重計上を避け
          // groupDamageには付随させない。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "physical",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 120, elementAccum: [{ label: "魔", amount: 1 }] },
          },
        },
        {
          // 「跳躍踏みつけ」：乱戦ダメージ修正+120（対象明記なし＝既定ルール＝前衛均等割り）。
          // 次のアクションフェイズ開始時、PC全員はスタミナダイスの出目にかかわらず後衛に配置
          // される（force_back_row_next_phase）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase"],
        },
      ],
    },
    "rat_basilisk|finger_bugs": {
      // 特殊能力（rows[]には含めずここに完全記録し、GM手動対応とする）：
      // 〔のたうち回る〕このエネミーに対する「属性:炎」による属性損害を発生させたPCは、
      // 〈10|メンタル〉を行う。この行為判定に成功すると、このエネミーを「HP価値:-10（最低10）」
      // する——トリガーがPC側の任意行動（属性損害の発生）でありエネミーの出目テーブルに存在
      // しないため、rows[]には含めず、既存の対応する機構も無いためGM手動処理に委ねる（Global
      // Constraint 7）。
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記、
          // rat_basilisk|big_ratsと同一の記述）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「掴みかかり」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ
          // 240は「敵視:最大」のPC1体に別枠で発生し、この効果に対してガード不可（no_guard）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「拘束弾＆叩きつけ」：乱戦ダメージ修正+120（対象明記なし＝既定ルール＝前衛均等割り）。
          // 「敵視:最大」のPC全員は、この乱戦ダメージに対してガード不可（no_guard、
          // rock_spirit_beast|falling_star_beast「黄金ブレス」と同型——前衛均等割りの対象全員の
          // うち敵視最大の部分集合にのみ適用される）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard"],
        },
      ],
    },
    "rat_basilisk|basilisks": {
      // special: 〔弱点:出血＆凍傷＆睡眠〕公開情報（209頁）。常時有効な受動的特性のため行動
      // テーブルの行としては構造化しない。
      rows: [
        {
          // 「後ずさる」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果:PC
          // 全員（敵視条件の指定なし）は〈11|メンタル〉を行い、失敗したPCは「呪死:1D」（HP損害を
          // 伴わない）を被る。soldier_knight|death_knight「瞬雷・双斧」と同型（targetFilter無し
          // ＝全PCプール、onFailはamount無しでailmentAccumのみ、2026-08-29確認済みの
          // queueAttributeAccum実装によりamount無しでも正しく反映される）。
          rollMin: 1,
          rollMax: 2,
          savingThrow: {
            stat: "mental",
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { ailmentAccum: [{ label: "呪死", amount: 1 }] },
          },
        },
        {
          // 「範囲ブレス」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果:
          // 「敵視:1以上」のPC全員に無条件で「呪死:1D」（HP損害を伴わない）を与える——判定を
          // 伴わないためsavingThrowは使えず、individualDamageはamountが必須（未設定だと
          // Time Loss分だけ数値が個別ダメージ入力欄に書き込まれてしまい実態と異なる）のため
          // 使えない。既存のいずれの構造化フィールドにも収まらないためaccum_target_mismatch_
          // manualを流用してGM手動処理に委ねる。【2026-08-29レビュー注記】このタグの本来の定義
          // （本ファイル約1855行目付近）は「groupDamageの対象集団と属性/状態異常蓄積の対象集団が
          // 異なる」ケース専用であり、本行はmod自体が「—」でgroupDamageが最初から存在しないため
          // 厳密には定義と一致しない（旧版が根拠とした strong_type|omen_children「大刀振り回し」
          // もこのタグを使わずコメントのみで処理していた行であり、正確な前例ではなかった）。ただし
          // 「判定なし・無条件蓄積・HP損害なし」という、既存の構造化フィールド（groupDamage/
          // individualDamage/savingThrow）のいずれにも収まらない性質は共通するため、新規タグを
          // 追加せず類似ケースとして本タグを流用した（このタグはUIには表示されずGM向けドキュメント
          // 目的のみのため機能上の実害はない）。
          rollMin: 3,
          rollMax: 4,
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「飛びかかりブレス」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別
          // 効果:「敵視:最大」のPC1体は〈12|フィジカル〉を行い、失敗すると「呪死:2D」（HP損害を
          // 伴わない）を被る——判定対象が「敵視:最大」の部分集合だが、savingThrow.targetFilterは
          // aggroAtLeast1のみをサポートしaggroMaxをサポートしないため構造化できない
          // （saving_throw_ailment_only_manualでGM手動処理に委ねる）。
          rollMin: 5,
          rollMax: 6,
          conditions: ["saving_throw_ailment_only_manual"],
        },
      ],
    },

    // Batch D3: crustacean(big_crabs/big_ants) + attacker_warrior(night_assassin/
    // night_executioner/night_fallen/night_destroyer/night_blasphemer) = 7体。
    // 出典: static_src/enemies_data_2.js（crustacean:186〜295行付近、attacker_warrior:
    // 298〜517行付近）。attacker_warriorは科全体が本ブロック初対応のため、他family
    // （soldier_knight/troll_dragonkin_wormface等）で確立済みのtargetRule/conditions語彙を
    // そのまま流用する。
    "crustacean|big_crabs": {
      rows: [
        {
          // 「爪叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ120は「敵視:最大」のPC1体に別枠で発生
          // （crustacean|big_crayfish「爪突き刺し」と同型）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「泡ブレス」：乱戦ダメージ修正－120（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。この乱戦ダメージをガードするPCは、そのガードコストを
          // +1する（guard_cost_penalty、troll_dragonkin_wormface|nox_dragonkin_soldier
          // 「噛みつき」と同型）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["guard_cost_penalty"],
        },
        {
          // 「挟み込み拘束」：乱戦ダメージ修正が「—」のため発生しない。個別ダメージ240を
          // 「敵視:最大」のPC1体に、ガード不可（crustacean|big_crayfish／duke_freydiaの
          // 「挟み込み拘束」と同型）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
      ],
    },
    "crustacean|big_ants": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「脚ひっかき」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ120は「敵視:1以上」のPC全員に別枠で発生。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「蟻酸」：乱戦ダメージ修正－60（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別ダメージ180は「敵視:最大」のPC1体に、この個別ダメージを
          // 回避するPCはダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "attacker_warrior|night_assassin": {
      // special: 〔弱点:呪死〕公開情報（209頁）。night.jsのextractWeakness等の既存機構が
      // enemies_data側のspecialフィールドを直接解析して敵チップへ反映するため（3952〜3960行
      // 付近の既存注記と同型の判断）、rows[]には構造化しない。
      rows: [
        {
          // 「薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「構え斬り」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。「敵視:最大」のPC全員は、この乱戦ダメージを回避する
          // とき、支払ったダイスコストの値を半分として扱う。【判断メモ】既存の
          // reducible_by_stamina_diceタグは対象PCの部分集合（前衛均等割りの対象全員のうち
          // 敵視最大の部分集合のみ）を区別しないため厳密には対象範囲がズレるが、
          // troll_dragonkin_wormface|nox_dragonkin_soldier「噛みつき」等の既存事例（本文が
          // 「敵視:最大のPC全員」等の部分集合を回避コスト半減の対象に限定していても同タグを
          // 流用）と同じ扱いとしてそのまま流用する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「バックラーパリィ」：乱戦ダメージ修正－60（「—」ではないため発生）。対象の明記が
          // 無いため既定ルール（前衛均等割り）。個別ダメージ180は「敵視:最大」のPC1体に、加えて
          // 次のアクションフェイズ開始時のスタミナダイス-2（HP損害を伴う個別効果のため
          // individualDamageで構造化しつつ、体力骰減少はconditionsで併記）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["stamina_dice_reduction_next_phase"],
        },
      ],
    },
    "attacker_warrior|night_executioner": {
      // special: 〔弱点:呪死〕公開情報（209頁）。night.jsのextractWeakness等の既存機構が
      // enemies_data側のspecialフィールドを直接解析して敵チップへ反映するため、rows[]には
      // 構造化しない（night_assassinと同型の判断）。
      rows: [
        {
          // 「居合斬り」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「連続斬り」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）:「敵視:1以上」のPC1体に【個別ダメージ:180】を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わずconditionsと
          // コメントでGM手動処理に委ねる（Global Constraint 7、crustacean|duke_freydia
          // 「子蜘蛛の牙」と同型）。
          rollMin: 3,
          rollMax: 4,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「弾き＆妖刀解放」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。個別効果:「敵視:最大」のPC1体は次のアクション
          // フェイズ開始時に獲得するスタミナダイスが2個減少する（HP損害を伴わないため
          // individualDamageは設定せずconditionsのみ、demihuman_beastfolk_club|
          // silver_tears_people「側転回り込み」と同型）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
      ],
    },
    // 特殊能力〔耐久力〕（attacker_warrior|night_fallenのみ）：戦闘開始時、このエネミーの
    // すべての「HP行」を「最大HP:+□×5（5点増加）」する——出目テーブルの行ではなく戦闘開始時
    // のセットアップ処理であり、既存のrows[]構造（1D6の出目に対応する行動）にもenemy_auto_gm_
    // data.jsのスキーマにも対応する機構が無いため（cavalry|unnamed_king「モブ1追加」等と同型の
    // 判断）、rows[]には構造化せずこのコメントに規則書原文をそのまま記録してGM手動セットアップに
    // 委ねる。□=+1（CLAUDE.md §17.1）のため実数値は+5（Global Constraint 1：■ではなく□の
    // ため数値は確定済み、ただし反映先の機構が無いため手動運用）。
    "attacker_warrior|night_fallen": {
      // special: 〔弱点:呪死〕公開情報（209頁）。night.jsのextractWeakness等の既存機構が
      // enemies_data側のspecialフィールドを直接解析して敵チップへ反映するため、rows[]には
      // 構造化しない（night_assassinと同型の判断）。
      rows: [
        {
          // 「斧槍薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「つむじ風」：乱戦ダメージ修正－300、乱戦ダメージは2回発生する
          // （big_dog_bear|old_lions「連続噛みつき」と同型）。対象の明記が無いため既定ルール
          // （前衛均等割り）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「ハイガード＆ガードカウンター」：乱戦ダメージ修正－240（「—」ではないため発生）。
          // 乱戦ダメージは「敵視:最大」のPC1体のみを対象とし、対象となるPCが1人もいない場合は
          // 通常どおり前衛が対象となる（本文に明記、aggroMax+fallback:"front"、
          // strong_type|divine_skin_apostles「黒炎投げ」等でfallback:"front"が既に確立済みの
          // 汎用機構であることを確認済み）。次のアクションフェイズ終了までエネミーを
          // 「HP価値:+20（最大100）」する（enemy_hp_value_buff）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -240 },
          targetRule: { kind: "aggroMax", fallback: "front" },
          conditions: ["enemy_hp_value_buff"],
        },
      ],
    },
    "attacker_warrior|night_destroyer": {
      // special: 〔弱点:呪死〕公開情報（209頁）。night.jsのextractWeakness等の既存機構が
      // enemies_data側のspecialフィールドを直接解析して敵チップへ反映するため、rows[]には
      // 構造化しない（night_assassinと同型の判断）。
      rows: [
        {
          // 「我慢＆薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に
          // 明記）。次のアクションフェイズ終了までエネミーを「HP価値:+10（最大100）」する
          // （enemy_hp_value_buff）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「ジャンプ攻撃」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。個別効果:「敵視:最大」のPC1体は次のアクション
          // フェイズ開始時に獲得するスタミナダイスが2個減少する（HP損害を伴わないため
          // conditionsのみ）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「ダッシュ攻撃」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次のアクション
          // フェイズ開始時に獲得するスタミナダイスが1個減少する（HP損害を伴わないため
          // conditionsのみ）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
      ],
    },
    "attacker_warrior|night_blasphemer": {
      // special: 〔弱点:呪死〕公開情報（209頁）。night.jsのextractWeakness等の既存機構が
      // enemies_data側のspecialフィールドを直接解析して敵チップへ反映するため、rows[]には
      // 構造化しない（night_assassinと同型の判断）。
      rows: [
        {
          // 「ジャンプ攻撃」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。個別効果:「敵視:最大」のPC1体は次のアクション
          // フェイズ開始時に獲得するスタミナダイスが2個減少する（HP損害を伴わないため
          // conditionsのみ）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「ダッシュ攻撃」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次のアクション
          // フェイズ開始時に獲得するスタミナダイスが1個減少する（HP損害を伴わないため
          // conditionsのみ）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「祈りの一撃」：乱戦ダメージ修正±0＋「聖:1D」（mod欄の固定値表記、docs/
          // enemy_damage_rules.md §1.1のXd＝固定値X裁定に基づきelementAccumとして構造化。
          // 本文の個別効果側には聖への言及が一切無いため、mod欄と個別効果の数値突合の結果
          // 二重計上の懸念は無い）。対象の明記が無いため既定ルール（前衛均等割り）。次の
          // アクションフェイズ終了までエネミーを「HP価値:+20（最大100）」する
          // （enemy_hp_value_buff）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
      ],
    },

    // Batch D4: formless_other(reflection_trolls/omen/silver_drops/mud_men/miranda_flowers) = 5体。
    // 出典: static_src/enemies_data_2.js:539〜805行付近。同familyの既存エントリ
    // （man_bats:982行目付近、spider_scorpions:1167行目付近）の書式・命名を踏襲する。
    "formless_other|reflection_trolls": {
      // special:〔モブ1追加〕戦闘開始時、HP枠に「モブ1」を追加し、このエネミーを「撃破ルーン:+1」
      // する。このモブHPはL補を問わず「最大HP:PC人数×2」である。戦闘開始時トリガーのモブHP
      // 追加＋撃破ルーン増加という既存に対応する機構が無い特殊能力（Global Constraint「モブHP
      // 連動の固定行動」に該当）のため、rows[]には組み込まずGM手動運用に委ねる。
      rows: [
        {
          // 「剣薙ぎ払い」：前衛の中で「敵視:最大」のPC全員に「乱戦ダメージ:3人分」（本文に明記、
          // soldier_knight|crucible_knight「薙ぎ払い」と同型）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「突進斬り」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。「敵視:1以上」のPC全員は、この乱戦ダメージを回避する際の
          // ダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「叩きつけ衝撃波」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。この乱戦ダメージに対してガードを行ったPCは、
          // エンドフェイズまで「HP価値:-10（最低10）」になる（guard_hp_value_penalty、
          // soldier_knight|crucible_knight「坩堝の諸相・翼」と同型）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["guard_hp_value_penalty"],
        },
      ],
    },
    "formless_other|omen": {
      // special:〔耐久力〕戦闘開始時、このエネミーのすべての「HP行」を「最大HP:+□×5（5点増加）」
      // する。〔消失〕戦闘開始から3ターン目のエンドフェイズの開始時、このエネミーが消失し、戦闘は
      // 終了する（この場合撃破ルーンを得られない）。いずれも戦闘開始時／エンドフェイズ起点の自動
      // 処理であり既存に対応する機構が無いため、rows[]には組み込まずGM手動運用に委ねる。
      rows: [
        {
          // 「魔力弾」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）:「敵視:1以上」のPC1体に【個別ダメージ:120】＋「魔:1D」を与える。
          // 「PC人数回実行」はパーティ人数に依存する可変回数のため、固定回数のrepeat/rotateは
          // 使わずconditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。「魔:1D」は
          // docs/enemy_damage_rules.md §1.1のXd＝固定値X裁定により固定値1（手動反映時の参考値）。
          rollMin: 1,
          rollMax: 2,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「浮遊」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は次のアクションフェイズ開始時
          // に獲得するスタミナダイスが1個減少する（stamina_dice_reduction_next_phase）。加えて
          // PC全員（敵視条件なし、こちらは全PC対象）が次のアクションフェイズ開始時、出目に
          // 関わらず後衛に配置される（force_back_row_next_phase）。両タグは対象範囲が異なる点に
          // 注意（前者は敵視:1以上のみ、後者はPC全員）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase", "force_back_row_next_phase"],
        },
        {
          // 「大波」：乱戦ダメージ修正+120＋「魔:1D」＋「睡眠:1D」（docs/enemy_damage_rules.md
          // §1.1のXd＝固定値X裁定に基づきelementAccum/ailmentAccumとして構造化）。本文は「乱戦
          // ダメージはPC全員に与えられる」と明記するのみで、mod欄の魔/睡眠を要約し直した別枠の
          // 個別効果記述は無いため、mod欄と個別効果の数値突合の結果、二重計上の懸念は無い。
          rollMin: 5,
          rollMax: 6,
          groupDamage: {
            modifier: 120,
            elementAccum: [{ label: "魔", amount: 1 }],
            ailmentAccum: [{ label: "睡眠", amount: 1 }],
          },
          targetRule: { kind: "allPCs" },
        },
      ],
    },
    "formless_other|silver_drops": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「槍突き＆盾ガード」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。次のアクションフェイズ終了までエネミーを
          // 「HP価値:+20（最大100）」する（enemy_hp_value_buff）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「放電」：乱戦ダメージ修正－60（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員は〈11|メンタル〉を行い、
          // 失敗すると【個別ダメージ:60】＋「雷:1D」を受ける（targetFilter:aggroAtLeast1、
          // ancient_dragon「赤雷叩きつけ」と同型）。mod欄の「雷:1D」はこの個別判定の失敗時効果と
          // 数値・種別が完全一致するため二重計上を避け、groupDamageには付随させずsavingThrow.
          // onFail側のみに構造化する（本ファイル冒頭2253〜2265行目の解釈方針）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "mental",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 60, elementAccum: [{ label: "雷", amount: 1 }] },
          },
        },
      ],
    },
    "formless_other|mud_men": {
      rows: [
        {
          // 「銛突き」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「つかみかかり」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ
          // 240を「敵視:最大」のPC1体に、ガード不可（no_guard）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「神託のシャボン」：乱戦ダメージ修正±0＋「魔:1D」（「—」ではないため既定ルール＝
          // 前衛均等割りのgroupDamageは発生する）。個別効果:「敵視:1以上」のPC全員は無条件で
          // 「魔:1D」を被る（HP損害を伴わない）。mod欄の「魔:1D」は数値・種別がこの個別効果と
          // 完全一致するが、対象集団（敵視:1以上のPC全員、前衛/後衛問わず）が乱戦ダメージの対象
          // （前衛均等割り）と異なる可能性があり、かつHP損害を伴わないためgroupDamage.
          // elementAccumにもindividualDamageにも構造化できない。conditionsとコメントでGM手動
          // 処理に委ねる（accum_target_mismatch_manual、troll_dragonkin_wormface|nox_
          // dragonkin_soldier「氷槍＆飛び退き」等と同型の判断）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
      ],
    },
    "formless_other|miranda_flowers": {
      // special:〔弱点:凍傷〕公開情報（209頁）。night.jsのextractWeakness等の既存機構が
      // enemies_data側のspecialフィールドを直接解析して敵チップへ反映するため、rows[]には
      // 構造化しない（attacker_warrior|night_blasphemerと同型の判断）。
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「毒散布」：乱戦ダメージ修正－120＋「猛毒:1D」（「—」ではないため既定ルール＝前衛
          // 均等割りのgroupDamageは発生する）。個別効果:「敵視:最大」のPC1体は無条件で
          // 「猛毒:1D」を被る（HP損害を伴わない）。mod欄の「猛毒:1D」は数値・種別がこの個別効果と
          // 完全一致するが、対象（敵視:最大の1体のみ）が乱戦ダメージの対象（前衛均等割り）と
          // 異なるため、groupDamage.ailmentAccumにもindividualDamage（amountが必須）にも
          // 構造化できない。conditionsとコメントでGM手動処理に委ねる
          // （accum_target_mismatch_manual）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「光の柱」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果:
          // 「敵視:1以上」のPC全員は〈11|運試し〉を行い、失敗したPCに【個別ダメージ:120】＋
          // 「聖:1D」を与える（targetFilter:aggroAtLeast1、ancient_dragon「赤雷叩きつけ」と
          // 同型）。
          rollMin: 5,
          rollMax: 6,
          savingThrow: {
            stat: "luck",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 120, elementAccum: [{ label: "聖", amount: 1 }] },
          },
        },
      ],
    },
    // 一般エネミー科「attacker_mage」（襲撃者・魔術師系、enemies_data_2.js:808-1025）5体：
    // 夜の狩人／夜の偶像／夜の盗賊／夜の魔女／夜の虚言師。科全体が本ファイル未対応だったため、
    // mage_messenger|sinners／warrior_swordsman|divine_beast_warriors等、既存の魔法系エネミーの
    // targetRule/conditions語彙をそのまま踏襲する。resistance:呪死（各エネミーのspecialフィールド
    // 「〔弱点:呪死〕」）は既存のenemyResistanceLabels経由で自動処理されるため、rows化は不要。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - pc_hp_value_penalty_manual（夜の狩人「マーキング」専用）：「敵視:最大」のPC1体に、
    //   戦闘終了まで「HP価値:-10（最低10）」を与える（同一PCに重複しない）という、PC側の
    //   HP価値そのものを継続的に悪化させる効果の記録。既存のguard_hp_value_penalty（ガードを
    //   行ったPC限定・エンドフェイズまでの一時効果）とはトリガー条件・対象・持続期間が異なる
    //   別効果のため区別して新設する。PC側hpValue欄（#enemy-damage-modal、docs/
    //   enemy_damage_rules.md 372行目付近）を自動で書き換える機構は無いため、GMが手動で対象PCの
    //   HP価値欄を調整すること。
    // - holy_grail_flask_recovery_trigger（夜の虚言師「連続突き＆回復」専用）：特殊能力
    //   「聖杯瓶回復（条件発揮）」＝このエネミーの「最も現在HPが減少しているHP行」に
    //   「HP回復:□×PC人数」を適用する（ただし2回以上「体勢崩し」にならず、モブHPには適用
    //   しない）という、PC人数依存の可変値かつエネミー側自己回復のためHP損害系フィールドでは
    //   構造化できない条件発揮トリガーの記録（furnace_flame_triggerと同じ設計思想）。
    //
    // 【mod欄の「＆X」の帰属について】
    // 夜の偶像「光輪」・夜の盗賊「魔力の短剣」・夜の魔女「輝石のつぶて」は、mod欄の「＆X」が
    // 本文の個別ダメージ（amount有り）に数値・種別完全一致する形で付随しているため、
    // warrior_swordsman|divine_beast_warriors「円刃剣の舞」と同型でelementAccumを
    // individualDamage側にのみ構造化し、groupDamageには含めない（二重計上回避）。一方、夜の魔女
    // 「夜の彗星」・夜の虚言師「腐敗壺投げ」はmod欄の「＆X」が判定失敗時効果（savingThrow.onFail）
    // に数値・種別完全一致するため、そちらにのみ構造化する（2026-08-29のsoldier_knight|
    // death_knight修正コメントで確認済みのnight.js実装により、savingThrow.onFailはamountの
    // 有無に関わらずelementAccum/ailmentAccumを常にqueueAttributeAccumへ渡すため、
    // saving_throw_ailment_only_manual等の代替タグではなく素のsavingThrowで構造化する）。
    "attacker_mage|night_hunter": {
      rows: [
        {
          // 「射撃」：mod「±0＆「猛毒:1D」」。note「乱戦ダメージはPC全員を対象とする。
          // 「敵視:1以上」のPC全員は、「乱戦ダメージ:2人分」を割り振られる」——個別効果の記載が
          // 無いため猛毒:1Dはこの乱戦ダメージに付随する（状態異常のためailmentAccum、
          // elementAccumではない）。対象は前後衛問わずPC全員がベースで敵視1以上のみ重み2
          // （targetRule.kind:"allPCs"＋weightRule.kind:"aggroAtLeast1"、auto_gm.js
          // matchesWeightConditionで既に実装済み。warrior_swordsman|divine_beast_warriors
          // 「短剣投擲」のfrontAggroAtLeast1版と同じ機構を前衛限定なし版で使用）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0, ailmentAccum: [{ label: "猛毒", amount: 1 }] },
          targetRule: { kind: "allPCs", weightRule: { kind: "aggroAtLeast1", weight: 2 } },
        },
        {
          // 「連続射撃」：mod「—」のため乱戦ダメージは発生しない。個別効果（PC人数回実行）：
          // 「敵視:1以上」のPC1体に【個別ダメージ:120】＋「猛毒:1D」を与える——「PC人数」は
          // パーティ人数に依存する可変値であり固定回数のリテラル値ではないため、既存の
          // repeat/rotate機構（固定回数専用）は使わずconditionsとコメントでGM手動処理に委ねる
          // （Global Constraint 7）。
          rollMin: 3,
          rollMax: 4,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「マーキング」：mod「±0」（「—」ではないため乱戦ダメージも発生、対象明記なし＝
          // 既定ルール＝前衛均等割り）。個別効果:「敵視:最大」のPC1体に、戦闘終了まで
          // 「HP価値:-10（最低10）」を与える（同一PCに重複しない）——HP損害を伴わないPC側の
          // 継続的ステータス悪化のため、pc_hp_value_penalty_manualへ記録しGM手動処理に委ねる
          // （本エントリ冒頭の新規タグ解説参照）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["pc_hp_value_penalty_manual"],
        },
      ],
    },
    "attacker_mage|night_idol": {
      rows: [
        {
          // 「爪攻撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「拒絶」：乱戦ダメージ修正－120（「—」ではないため発生、対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:最大」のPC1体は次のアクションフェイズ開始時に獲得
          // するスタミナダイスが2個減少する（HP損害を伴わないためstamina_dice_reduction_
          // next_phaseのみ記録）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「光輪」：mod「±0＆「聖:1D」」。乱戦ダメージ修正±0（対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:1以上」のPC全員に【個別ダメージ:60】＋「聖:1D」を
          // 別枠で与える——note文言上、聖1Dは個別ダメージに付随（divine_beast_warriors
          // 「円刃剣の舞」と同型）ためindividualDamage側にelementAccumを構造化し、groupDamage
          // には含めない（二重計上回避）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "聖", amount: 1 }] },
          ],
        },
      ],
    },
    "attacker_mage|night_thief": {
      rows: [
        {
          // 「短剣連続攻撃」：mod「—」のため乱戦ダメージは発生しない。個別効果（PC人数+1回
          // 実行）：「敵視:1以上」のPC1体に【個別ダメージ:60】を与える——「PC人数+1」は
          // パーティ人数に依存する可変値であり固定回数のリテラル値ではないため、既存の
          // repeat/rotate機構（固定回数専用）は使わずconditionsとコメントでGM手動処理に委ねる
          // （Global Constraint 7）。
          rollMin: 1,
          rollMax: 2,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「背後致命」：mod「—」のため乱戦ダメージは発生しない。個別効果:「敵視:最大」のPC1体
          // のみが〈12|メンタル〉を行い、失敗すると「HP損害:■×4」を被る——auto_gm.jsの
          // resolveSavingThrow実装は「全PCプール（targetFilterで絞り込み可能なのはaggroAtLeast1
          // のみ）」を前提としており、「敵視:最大の1体のみが判定する」という単体対象の判定は
          // 既存savingThrow機構では表現できない。加えて失敗時ダメージが「■」（数値未確定）で
          // 数値を捏造できないため、いずれにせよ自動計算は不可。conditionsとコメントでGM手動
          // 処理に委ねる（unknown_hp_damage_manual）。
          rollMin: 3,
          rollMax: 4,
          conditions: ["unknown_hp_damage_manual"],
        },
        {
          // 「魔力の短剣」：mod「±0＆「魔:1D」」。乱戦ダメージ修正±0（対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:最大」のPC1体に【個別ダメージ:60】＋「魔:1D」を
          // 別枠で与える——note文言上、魔1Dは個別ダメージに付随（divine_beast_warriors
          // 「円刃剣の舞」と同型）ためindividualDamage側にelementAccumを構造化し、groupDamage
          // には含めない（二重計上回避）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 60, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "魔", amount: 1 }] }],
        },
      ],
    },
    "attacker_mage|night_witch": {
      rows: [
        {
          // 「輝石のつぶて」：mod「－60＆「魔:1D」」。乱戦ダメージ修正－60（「—」ではないため
          // 発生、対象明記なし＝既定ルール＝前衛均等割り）。個別効果:「敵視:1以上」のPC全員に
          // 【個別ダメージ:60】＋「魔:1D」を別枠で与える——note文言上、魔1Dは個別ダメージに
          // 付随（divine_beast_warriors「円刃剣の舞」と同型）ためindividualDamage側に
          // elementAccumを構造化し、groupDamageには含めない（二重計上回避）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "魔", amount: 1 }] },
          ],
        },
        {
          // 「夜の彗星」：mod「－120＆「魔:2D」」。乱戦ダメージはPC全員を対象とする（本文に
          // 明記）。個別効果:「敵視:1以上」のPC全員のみが〈11|運試し〉を行い（targetFilter:
          // aggroAtLeast1、ancient_dragon「赤雷叩きつけ」と同型）、失敗したPCに
          // 【個別ダメージ:120】＋「魔:2D」を与える。mod欄の「魔:2D」は数値・種別がこの判定
          // 失敗効果と完全一致するため、savingThrow.onFail側にのみ構造化し、groupDamageには
          // 含めない（二重計上回避）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "allPCs" },
          savingThrow: {
            stat: "luck",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 120, elementAccum: [{ label: "魔", amount: 2 }] },
          },
        },
        {
          // 「創星雨」：乱戦ダメージ修正－240＋「魔:1D」（mod欄の固定値表記、docs/
          // enemy_damage_rules.md §1.1のXd＝固定値X裁定に基づきelementAccumとして構造化。
          // 個別効果側に重複する記載が無いためgroupDamageへ直接付随させる）。乱戦ダメージは
          // PC全員を対象とし、乱戦ダメージは2回発生する（本文に明記）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -240, repeat: 2, elementAccum: [{ label: "魔", amount: 1 }] },
          targetRule: { kind: "allPCs" },
        },
      ],
    },
    // 〔HP価値:-10〕特殊能力（夜の魔女）：このエネミーは常に「HP価値:-10（最低10）」として
    // 扱う、戦闘開始から常時有効な受動的特性。既存のguardValueTable/enemyGuardValueForCountは
    // ロール依存の一時バフ（enemy_hp_value_buff）専用で、「常時ベースのHP価値そのものを補正
    // する」恒常的な補正値を保持するフィールドが無いため、rows化はせずGMがガード削り値計算機の
    // HP価値欄に反映する際に手動で-10（下限10）すること。
    "attacker_mage|night_liar": {
      rows: [
        {
          // 「連続突き＆回復」：乱戦ダメージ修正－60（「—」ではないため発生、対象明記なし＝
          // 既定ルール＝前衛均等割り）。個別効果:「敵視:最大」のPC1体に【個別ダメージ:120】を
          // 別枠で与える。特殊能力「聖杯瓶回復（条件発揮）」＝このエネミーの「最も現在HPが
          // 減少しているHP行」に「HP回復:□×PC人数」を適用（2回以上体勢崩しにならず、モブHPには
          // 適用しない）——PC人数依存の可変値かつエネミー側自己回復のため既存フィールドに
          // 構造化できず、holy_grail_flask_recovery_triggerで記録しGM手動処理に委ねる（本エントリ
          // 冒頭の新規タグ解説参照）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
          conditions: ["holy_grail_flask_recovery_trigger"],
        },
        {
          // 「腐敗壺投げ」：mod「－120＆「腐敗:1D」」。乱戦ダメージ修正－120（「—」ではないため
          // 発生、対象明記なし＝既定ルール＝前衛均等割り）。個別効果:PC全員（敵視条件の記載
          // なし）が〈10|運試し〉を行い、失敗したPCは「腐敗:1D」を被る（HP損害を伴わない）。
          // mod欄の「腐敗:1D」は数値・種別がこの判定失敗効果と完全一致するため、savingThrow.
          // onFail側にのみ構造化し、groupDamageには含めない（二重計上回避）。soldier_knight|
          // death_knight「後ずさる」型（2026-08-29確認済みのqueueAttributeAccum実装により、
          // onFailはamount無し・ailmentAccumのみでも正しく反映される）に倣い素のsavingThrowで
          // 構造化する。さらに次のアクションフェイズ終了まで、このエネミーを「HP価値:+20
          // （最大100）」する（enemy_hp_value_buff）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "luck",
            targetByCondition: [{ condition: { kind: "default" }, target: 10 }],
            onFail: { ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「薙ぎ払い＆高揚の香り」：mod「±0」、note無し。乱戦ダメージ修正±0（「—」ではない
          // ため発生、対象明記なし＝既定ルール＝前衛均等割り）のみ構造化する。「高揚の香り」の
          // 具体的な追加効果はenemies_data_2.js側にも本文が存在しない（note:null）ため、
          // 数値・効果を捏造せずgroupDamageのみ記録する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    // Batch D6：soldier_knight科の残る6体（enemies_data_2.js:1084-1441付近）：
    // カッコウ騎士たち／貴腐騎士／狂い火の騎士たち／火の騎士たち／メスメル兵たち／
    // レアルカリアの雑兵たち。いずれも既に多数対応済みのsoldier_knight科への追加であり、
    // 6体ともspecialフィールドを持たない（enemies_data_2.js確認済み）ため特殊能力の
    // 注記は不要。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - delayed_effect_next_phase_manual（貴腐騎士「聖槍の壁」専用）：「次のアクション
    //   フェイズ開始時が確定したとき」PC全員が「聖:1D」を被り、かつディフェンス不可という、
    //   ターンをまたぐ遅延効果（Global Constraint 6：既存に対応する機構が無い特殊能力）。
    //   現在の行動解決時に即座に適用されるindividualDamage/savingThrowでは表現できない
    //   ため、mod欄の「聖:1D」もこの遅延効果に付随するものとしてgroupDamageには含めず
    //   （二重計上回避）、本タグ＋行コメントでGM手動処理に委ねる。
    //
    // 【mod欄の「＆X」の帰属について】
    // カッコウ騎士たち「魔力の大剣＆輝剣の円陣」・貴腐騎士「腐敗の槍突き」は、mod欄の
    // 「＆X」が本文の個別ダメージ（amount有り）に数値・種別完全一致する形で付随しているため
    // individualDamage側にのみelementAccum/ailmentAccumを構造化し、groupDamageには含めない
    // （二重計上回避）。狂い火の騎士たち「狂い火」「空裂狂火」は、mod欄の「＆発狂:1D」が
    // 本文の「敵視:1以上のPC全員に発狂:1Dを与える」と数値・種別は一致するが、対象集団が
    // 乱戦ダメージの既定対象（前衛均等割り）と異なるため、soldier_knight|remote_veteran
    // 「氷嵐の剣技」と同じくaccum_target_mismatch_manualで記録する（groupDamage/
    // individualDamageのいずれにも構造化しない）。レアルカリアの雑兵たち「二連斬り＆
    // 魔術の輝剣」は、mod欄「＆魔:1D」（Xd＝固定値1、docs/enemy_damage_rules.md §1.1）と
    // 本文の「魔:2」が数値不一致（1≠2）のため同一効果とはみなさず、mod側はgroupDamageへ
    // 直接構造化し、本文側の「魔:2」（対象＝敵視1以上のPC全員、前衛均等割りと対象集団が
    // 異なる）はaccum_target_mismatch_manualで別途記録する。
    "soldier_knight|cuckoo_knights": {
      rows: [
        {
          // 「薙ぎ払い＆輝剣の円陣」：mod「－60」（＆表記なし）。乱戦ダメージ修正－60（「—」
          // ではないため発生、対象明記なし＝既定ルール＝前衛均等割り）。個別効果：
          // 「敵視:1以上」のPC全員に【個別ダメージ:60】＋「魔:1D」（Xd＝固定値1）を別枠で
          // 与える。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "魔", amount: 1 }] },
          ],
        },
        {
          // 「輝石のつぶて」：mod「—」のため乱戦ダメージは発生しない。個別効果（PC人数回
          // 実行）：「敵視:1以上」のPC1体に【個別ダメージ:120】＋「魔:1D」を与える——
          // 「PC人数」はパーティ人数に依存する可変値であり固定回数のリテラル値ではないため、
          // 既存のrepeat/rotate機構（固定回数専用）は使わず、conditionsとコメントでGM手動
          // 処理に委ねる（Global Constraint 7）。
          rollMin: 3,
          rollMax: 4,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「魔力の大剣＆輝剣の円陣」：mod「＋60＆「魔:1D」」。乱戦ダメージ修正+60
          // （「—」ではないため発生、対象明記なし＝既定ルール＝前衛均等割り）。個別効果：
          // 「敵視:1以上」のPC全員に【個別ダメージ:60】＋「魔:1D」を別枠で与える——mod欄の
          // 「魔:1D」は数値・種別がこの個別効果と完全一致するため、individualDamage側にのみ
          // elementAccumを構造化し、groupDamageには含めない（二重計上回避）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 60, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "魔", amount: 1 }] },
          ],
        },
      ],
    },
    "soldier_knight|corrupted_knight": {
      rows: [
        {
          // 「腐敗の槍突き」：mod「±0＆「腐敗:1D」」。乱戦ダメージ修正±0（「—」ではないため
          // 発生、対象明記なし＝既定ルール＝前衛均等割り）。個別効果：「敵視:最大」のPC1体に
          // 【個別ダメージ:120】＋「腐敗:1D」を別枠で与える——mod欄の「腐敗:1D」は数値・種別が
          // この個別効果と完全一致するため、individualDamage側にのみailmentAccumを構造化し、
          // groupDamageには含めない（二重計上回避）。腐敗は状態異常（CLAUDE.md §17分類）の
          // ためailmentAccumで構造化する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 120, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          ],
        },
        {
          // 「腐敗の鎌薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」
          // （本文に明記）。mod欄の「腐敗:1D」は本文に別途記載が無いため、この乱戦ダメージと
          // 同じ対象（frontAggroAtLeast1All）に付随するものとして構造化する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「聖槍の壁」：mod「＋60＆「聖:1D」」。乱戦ダメージ修正+60（「—」ではないため発生、
          // 対象明記なし＝既定ルール＝前衛均等割り）。個別効果：PC全員は、次のアクション
          // フェイズ開始時が確定したとき「聖:1D」を被る（この効果に対してディフェンス不可）
          // ——ターンをまたぐ遅延効果であり、現在の行動解決時に即座に適用される既存の
          // individualDamage/savingThrow機構では表現できないため、mod欄の「聖:1D」もこの
          // 遅延効果に付随するものとしてgroupDamageには含めず（二重計上回避）、新規タグ
          // delayed_effect_next_phase_manualとコメントでGM手動処理に委ねる
          // （Global Constraint 6）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["delayed_effect_next_phase_manual"],
        },
      ],
    },
    "soldier_knight|madfire_knights": {
      rows: [
        {
          // 「狂い火」：mod「±0＆「発狂:1D」」。乱戦ダメージ修正±0（「—」ではないため発生、
          // 対象明記なし＝既定ルール＝前衛均等割り）。本文は別途「「敵視:1以上」のPC全員に
          // 「発狂:1D」を与える」と明記しており、これは乱戦ダメージの対象（前衛均等割り）とは
          // 異なる対象集団（aggroAtLeast1All）への蓄積のみの効果（HP損害を伴わない）のため、
          // groupDamage.ailmentAccum（乱戦ダメージ対象に付随する設計）にもindividualDamage
          // （HP損害amountが必須）にも構造化できない。soldier_knight|remote_veteran
          // 「氷嵐の剣技」と同型のaccum_target_mismatch_manualでGM手動処理に委ねる
          // （Global Constraint 8）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「組みつき」：mod「—」のため乱戦ダメージは発生しない。個別効果（PC人数回実行）：
          // 「敵視:1以上」のPC1体に【個別ダメージ:240】＋「発狂:1D」を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、既存のrepeat/rotate機構（固定回数専用）は
          // 使わずconditionsとコメントでGM手動処理に委ねる（Global Constraint 7）。この効果に
          // 対してガード不可（no_guard）。
          rollMin: 3,
          rollMax: 4,
          conditions: ["variable_repeat_manual", "no_guard"],
        },
        {
          // 「空裂狂火」：mod「＋120＆「発狂:1D」」。乱戦ダメージ修正+120（「—」ではないため
          // 発生、対象明記なし＝既定ルール＝前衛均等割り）。本文の「敵視:1以上のPC全員に
          // 発狂:1Dを与える」は「狂い火」と同じく対象集団が乱戦ダメージの既定対象と異なる
          // ためaccum_target_mismatch_manualで記録する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
      ],
    },
    "soldier_knight|fire_knights": {
      rows: [
        {
          // 「火炎薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」
          // （本文に明記）。mod欄の「炎:1D」は本文に別途記載が無いため、この乱戦ダメージと
          // 同じ対象（frontAggroAtLeast1All）に付随するものとして構造化する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「薙ぎ払い＆追い縋る火」：mod「±0」（＆表記なし）。乱戦ダメージ修正±0（「—」では
          // ないため発生、対象明記なし＝既定ルール＝前衛均等割り）。個別効果（PC人数+1回
          // 実行）：「敵視:1以上」のPC全員に【個別ダメージ:60】＋「炎:1」を与える——
          // 「PC人数+1」はパーティ人数に依存する可変値であり固定回数のリテラル値ではないため、
          // 既存のrepeat/rotate機構（固定回数専用）は使わず、conditionsとコメントでGM手動
          // 処理に委ねる（Global Constraint 7）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「火炎連続突き」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に
          // 明記）。乱戦ダメージは2回発生する。mod欄の「炎:1D」は本文に別途記載が無いため、
          // この乱戦ダメージと同じ対象（frontAggroAtLeast1All）に付随するものとして構造化する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -240, repeat: 2, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
      ],
    },
    "soldier_knight|messmer_soldiers": {
      rows: [
        {
          // 「射撃攻撃」：mod「－60」（＆表記なし）。本文は「乱戦ダメージは前衛を対象と
          // せずに、後衛を対象とする。後衛にPCが1人もいない場合は、前衛が対象となる。
          // 「敵視:1以上」で後衛のPC全員は、「乱戦ダメージ:2人分」を割り振られる」と明記
          // ——基準の対象群がbackAll（後衛のPC全員、後衛不在なら前衛にfallback）で、その
          // 中に重みの異なる2群（敵視1以上＝2人分、それ以外＝1人分）が混在するため、
          // harmonia「瞬間移動＆乱舞」と同型のtargetRule.weightRule（kind:"aggroAtLeast1"、
          // 前後衛不問）をbackAll＋fallback:"front"に組み合わせて構造化する。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "backAll", fallback: "front", weightRule: { kind: "aggroAtLeast1", weight: 2 } },
        },
        {
          // 「ウォークライ＆突撃」：乱戦ダメージ修正+120（「—」ではないため発生）。乱戦
          // ダメージは「敵視:1以上」のPC全員を対象とし、対象となるPCが1人もいない場合は
          // 通常どおり前衛が対象となる（本文に明記）。加えて次のアクションフェイズ終了まで
          // エネミーを「HP価値:+10（最大100）」する（enemy_hp_value_buff）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「火の雨」：mod「±0」（＆表記なし）。乱戦ダメージ修正±0（「—」ではないため発生、
          // 対象明記なし＝既定ルール＝前衛均等割り）。個別効果（2回実行、固定回数）：
          // 「敵視:1以上」のPC1体に【個別ダメージ:120】＋「炎:1D」を与える——本文が「対象PC
          // 1体（不特定）」＋固定回数の実行を明記しているため、既存のdistribution:"rotate"
          // （輪流受傷、最初の対象はランダム）で構造化する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            {
              amount: 120,
              repeat: 2,
              distribution: "rotate",
              targetRule: { kind: "aggroAtLeast1All" },
              elementAccum: [{ label: "炎", amount: 1 }],
            },
          ],
        },
      ],
    },
    "soldier_knight|raya_lucaria_soldiers": {
      rows: [
        {
          // 「斬りかかり」：mod「±0」。本文「「敵視:1以上」のPC全員は「乱戦ダメージ割合:
          // 2人分」として数える」——soldier_knight|mausoleum_knight「切り払い＆転移」と
          // 同じく「乱戦ダメージ割合」表記も通常の「乱戦ダメージ」と同様に扱い、対象PC全員が
          // 同じ重み（2人分）のため均等割りと数学的に等価（前後衛問わずaggroAtLeast1All）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「二連斬り＆魔術の輝剣」：mod「－60＆「魔:1D」」（Xd＝固定値1）。本文「個別効果：
          // 「敵視:1以上」のPC全員に「魔:2」を与える」——mod欄の数値（1）と本文の数値（2）が
          // 一致しないため、demon_prince「炎の隕石」のような要約表記とは判断せず、それぞれ
          // 独立した効果として扱う。mod欄の「魔:1D」は本文に一致する記載が無いため、この
          // 乱戦ダメージ（対象明記なし＝既定ルール＝前衛均等割り）に直接付随させる。本文の
          // 「魔:2」は対象が「敵視:1以上」のPC全員（前衛均等割りとは異なる対象集団）への
          // 蓄積のみの効果（HP損害を伴わない）のため、accum_target_mismatch_manualで別途
          // 記録しGM手動処理に委ねる。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60, elementAccum: [{ label: "魔", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「カーリアの速剣」：乱戦ダメージ修正－120（「—」ではないため発生）。乱戦ダメージは
          // 「敵視:1以上」のPC全員を対象とし、対象となるPCが1人もいない場合は通常どおり
          // 前衛が対象となる（本文に明記）。mod欄の「魔:2D」（Xd＝固定値2）は本文に別途
          // 記載が無いため、この乱戦ダメージと同じ対象に付随するものとして構造化する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
      ],
    },
    // Batch D7: dog_wolf(2) + warrior_swordsman(1) + big_dog_bear(1)。
    // dog_wolf科は本ブロックで初対応（既存の家族guardCount/guardValueTable以外は
    // 未構造化だった）。static_src/enemies_data_3.js:33-120（dog_wolf）、474-505
    // （warrior_swordsman|exiled_soldier）、1935-1970（big_dog_bear|huge_dog）を確認済み。
    "dog_wolf|stray_dogs": {
      rows: [
        {
          // 「咬擊」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「撲擊」：乱戦ダメージ修正+120（「—」ではないため発生）、対象明記無し（本文「なし」）
          // のため既定ルール（前衛均等割り）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「迂迴」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （2回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】——本文が「対象PC1体
          // （不特定）」＋固定回数の実行を明記しているため、既存のdistribution:"rotate"
          // （輪流受傷、最初の対象はランダム）で構造化する。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [
            { amount: 180, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
        },
      ],
    },
    "dog_wolf|wolf": {
      rows: [
        {
          // 「連續咬擊」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「迂迴」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （2回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】——stray_dogs「迂迴」と
          // 同型のためdistribution:"rotate"で構造化する。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            { amount: 180, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
        },
        {
          // 「遠嚎＆齊擊」：乱戦ダメージ修正－60（「—」ではないため発生、対象明記無しのため
          // 既定ルール＝前衛均等割り）。個別効果：「敵視:最大」のPC1体に【個別ダメージ:240】。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
        },
      ],
    },
    "warrior_swordsman|exiled_soldier": {
      rows: [
        {
          // 「弩」：乱戦ダメージ修正－60。乱戦ダメージはPC全員を対象とする（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "allPCs" },
        },
        {
          // 「直劍連擊」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記無しのため既定
          // ルール＝前衛均等割り）。個別効果：「敵視:最大」のPC1体に【個別ダメージ:120】。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「斧槍橫掃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
      ],
    },
    "big_dog_bear|huge_dog": {
      rows: [
        {
          // 「咬擊」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「拘束咬擊」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果：
          // 「敵視:最大」のPC1体に【個別ダメージ:240】＋「出血:1D」（Xd＝固定値1）を与える。
          // この効果に対してガード不可（no_guard）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            { amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "出血", amount: 1 }] },
          ],
          conditions: ["no_guard"],
        },
        {
          // 「衝刺」：乱戦ダメージ修正±0（「—」ではないため発生）。乱戦ダメージは「敵視:1以上」の
          // PC全員を対象とし、対象となるPCが1人もいない場合は通常どおり前衛が対象となる（本文に
          // 明記）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
      ],
    },
    // Batch D8（strong_type科4体、cavalry科4体）。static_src/enemies_data_3.js:740〜1571を
    // 実際にReadして本文を確認したうえで構造化した。
    "strong_type|black_flame_sinners": {
      // 〔黒炎の侵蝕（条件発揮）〕このフェイズに「乱戦ダメージ／個別ダメージ」でHP損害を受けた
      // PCは「最大HP:-□（最低値1）」する。この効果は重複し、PCが「祝福での休息」を行うか
      // 「夜の強敵」を撃破するまで続く——「最大HP」への継続的な減少で対象・累積回数・累積上限を
      // 表現する既存機構が無いため（strong_type|blood_lord「酸吐き出し」等と同型）、rows内では
      // max_hp_penalty_manualのconditionsタグとコメントのみでGM手動処理に委ねる。
      rows: [
        {
          // 「薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「黒炎発火」：乱戦ダメージ修正±0＋「炎:1D」（mod欄の固定値、骰子ではないため
          // elementAccum）。対象の明記が本文に無いため既定ルール（前衛均等割り）。個別効果:
          // 「敵視:1以上」のPC全員に特殊能力「黒炎の侵蝕」を適用する——対象が乱戦ダメージの
          // 既定対象（前衛均等割り）と異なり、かつ最大HP減少という既存機構で表現できない効果の
          // ためmax_hp_penalty_manualで手動処理に委ねる。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["max_hp_penalty_manual"],
        },
        {
          // 「黒炎の扇」：乱戦ダメージ修正－240＋「炎:2」（固定値のためelementAccum）、乱戦
          // ダメージは2回発生する（本文に明記）。対象の明記が無いため既定ルール（前衛均等割り）。
          // 個別効果:「敵視:1以上」のPC全員に特殊能力「黒炎の侵蝕」を適用する（上記と同様に
          // max_hp_penalty_manual）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -240, repeat: 2, elementAccum: [{ label: "炎", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["max_hp_penalty_manual"],
        },
      ],
    },
    "strong_type|blood_demons": {
      // 〔血の霧〕エンドフェイズ開始時、前衛のPC全員は「出血:1D」を被る——エンドフェイズ起点の
      // 自動処理に対応する既存機構が無いため（Global Constraint「エンドフェイズ起点の自動処理」
      // 除外規定）、rows[]には組み込まずこのコメントに規則書原文を記録してGM手動処理に委ねる。
      rows: [
        {
          // 「飛びかかり」：乱戦ダメージ修正±0＋「出血:1D」（固定値のためailmentAccum、出血は
          // 状態異常のためailmentAccum。対象の明記が無いため既定ルール＝前衛均等割り）。個別効果：
          // 「敵視:最大」のPC全員はさらに「出血:1D」を追加で被る——乱戦ダメージの既定対象
          // （前衛均等割り）とは異なる集団（敵視:最大）への蓄積のみの付随効果でHP損害数値を
          // 伴わないため、accum_target_mismatch_manualで手動処理に委ねる。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0, ailmentAccum: [{ label: "出血", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「跳躍叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「血炎の爪痕」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:最大」のPC1体に【個別ダメージ:120】＋「炎:1D」＋
          // 「出血:1D」を与える。mod欄の「炎:1D」＆「出血:1D」は数値・種別がこの個別効果と完全
          // 一致するため、二重計上を避けgroupDamage側には付随させずindividualDamage側にのみ
          // 構造化する（troll_dragonkin_wormface|nox_dragonkin_soldier「霊炎発火」と同型）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            {
              amount: 120,
              targetRule: { kind: "aggroMax" },
              elementAccum: [{ label: "炎", amount: 1 }],
              ailmentAccum: [{ label: "出血", amount: 1 }],
            },
          ],
        },
      ],
    },
    "strong_type|tuning_demon": {
      rows: [
        {
          // 「錫杖薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「錫杖叩きつけ」：乱戦ダメージ修正＋180（「—」ではないため発生、対象明記なし＝既定
          // ルール＝前衛均等割り）。この乱戦ダメージに対してガードを行ったPCは、エンドフェイズまで
          // 「HP価値:-10（最低10）」になる（guard_hp_value_penalty、soldier_knight|crucible_
          // knight「坩堝の諸相・翼」と同型）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAll" },
          conditions: ["guard_hp_value_penalty"],
        },
        {
          // 「両腕跳躍叩きつけ」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わずconditionsで
          // GM手動処理に委ねる（Global Constraint 7）。
          rollMin: 5,
          rollMax: 6,
          conditions: ["variable_repeat_manual"],
        },
      ],
    },
    "strong_type|purple_ogre_chief": {
      rows: [
        {
          // 「飛びかかり」：乱戦ダメージ修正＋120（「—」ではないため発生、対象明記なし＝既定
          // ルール＝前衛均等割り）。個別効果：「敵視:最大」のPC1体に【個別ダメージ:180】を与える。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「跳躍叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「紫の吐息」：乱戦ダメージ修正－120＋「睡眠:2D」（mod欄の固定値、骰子ではないため
          // ailmentAccum。睡眠は状態異常のためailmentAccum）。本文（note）が無く対象の明記も
          // 無いため既定ルール（前衛均等割り）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -120, ailmentAccum: [{ label: "睡眠", amount: 2 }] },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "cavalry|royal_capital_cavalry": {
      rows: [
        {
          // 「振り下ろし」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「駆け抜け」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:最大」のPC全員は次のアクションフェイズ獲得スタミナ
          // ダイスが2個減少する——HP損害を伴わずconditionsのみ記録する
          // （stamina_dice_reduction_next_phase）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「跳躍叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記なし＝既定
          // ルール＝前衛均等割り）。個別効果:「敵視:1以上」のPC全員に【個別ダメージ:180】を
          // 与える。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "cavalry|kaiden_mercenary": {
      rows: [
        {
          // 「曲刀振り回し」：乱戦ダメージ修正＋60。本文「「敵視:最大」のPC全員は「乱戦ダメージ
          // 割合:3人分」として扱う」——対象群（敵視:最大PC全員）は全員同じ重みのため、均等割りと
          // 数学的に等価（dragon|ancient_dragon「尻尾振り回し」・soldier_knight|raya_lucaria_
          // soldiers「斬りかかり」と同型の解釈、ただし対象は敵視:1以上ではなく敵視:最大のため
          // targetRule.kind:"aggroMax"を使用）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "aggroMax" },
        },
        {
          // 「駆け抜け」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記なし＝既定ルール＝
          // 前衛均等割り）。個別効果:「敵視:最大」のPC全員は次のアクションフェイズ獲得スタミナ
          // ダイスが2個減少する（stamina_dice_reduction_next_phase）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「後足蹴り」：乱戦ダメージ修正－60（「—」ではないため発生、対象明記なし＝既定ルール＝
          // 前衛均等割り）。この乱戦ダメージをガードするPCは、そのガードコストを+1する
          // （guard_cost_penalty）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["guard_cost_penalty"],
        },
      ],
    },
    "cavalry|carian_royal_guard": {
      // 〔輝剣の円陣:X（条件発揮）〕「ランダムに選んだPC1体に、「HP損害:■」＋「魔2」を与える」
      // ことをX回（X=PC人数）繰り返す——対象がランダムな1体・回数がPC人数依存の可変値・HP損害が
      // ■（数値未確定）のすべてを兼ねるため、既存rows機構では構造化不能。variable_repeat_manual
      // ＋unknown_hp_damage_manualのconditionsとコメントでGM手動処理に委ねる（troll_dragonkin_
      // wormface|ancient_dragon「浮遊火球＆突進」と同型の判断、付随する「魔2」も個別に構造化せず
      // 手動処理注記へまとめる）。
      // 〔騎馬跳躍（条件発揮）〕次のアクションフェイズ終了まで、エネミーを「HP価値:+10（最大
      // 100）」する（enemy_hp_value_buff）。
      rows: [
        {
          // 「ローレッタの斬撃＆騎馬跳躍」：乱戦ダメージ修正－300＋「魔:1D」（mod欄の固定値、
          // 骰子ではないためelementAccum）、乱戦ダメージは2回発生する（本文に明記）。対象の明記が
          // 無いため既定ルール（前衛均等割り）。特殊能力「騎馬跳躍」（enemy_hp_value_buff）を
          // 効果発揮。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -300, repeat: 2, elementAccum: [{ label: "魔", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「ローレッタの絶技＆輝剣の円陣」：乱戦ダメージ修正±0（「—」ではないため発生、対象
          // 明記なし＝既定ルール＝前衛均等割り）。個別効果:「敵視:1以上」のPC全員に【個別
          // ダメージ:180】＋「魔:4」を与える。さらに特殊能力「輝剣の円陣:PC人数」を効果発揮
          // （上記エントリ冒頭コメント参照、variable_repeat_manual＋unknown_hp_damage_manual）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 180, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "魔", amount: 4 }] },
          ],
          conditions: ["variable_repeat_manual", "unknown_hp_damage_manual"],
        },
        {
          // 「突撃薙ぎ払い＆騎馬跳躍＆輝剣の円陣」：乱戦ダメージ修正＋120（「—」ではないため発生、
          // 対象明記なし＝既定ルール＝前衛均等割り）。特殊能力「輝剣の円陣:PC人数」
          // （variable_repeat_manual＋unknown_hp_damage_manual）と「騎馬跳躍」
          // （enemy_hp_value_buff）を効果発揮。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["variable_repeat_manual", "unknown_hp_damage_manual", "enemy_hp_value_buff"],
        },
      ],
    },
    "cavalry|dragon_tree_guard": {
      // 〔モブ1追加〕戦闘開始時、HP枠に「モブ1」を追加し、このエネミーを「撃破ルーン:+1」する。
      // このモブHPはL補を問わず「最大HP:PC人数×3」である——出目テーブルの行ではなく戦闘開始時の
      // セットアップ処理のため、rows[]には構造化しない（cavalry|unnamed_king「モブ1追加」等と
      // 同型の判断）。
      rows: [
        {
          // 「突撃指示」：乱戦ダメージ修正±0（「—」ではないため発生）。「敵視:1以上」で前衛の
          // PC全員に「乱戦ダメージ:2人分」（本文に明記）。このダメージを回避するPCは、支払った
          // ダイスコストの値を半分（端数切り捨て。最低値1）として扱う
          // （reducible_by_stamina_dice）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「大槌薙ぎ払い＆駆け抜け」：乱戦ダメージ修正＋120。前衛の中で「敵視:最大」のPC全員は
          // 「乱戦ダメージ:2人分」を割り振られる（本文に明記、frontAggroMaxAll）。特殊能力
          // 「駆け抜け」＝PC全員が次のアクションフェイズ開始時、出目にかかわらず後衛に配置される
          // （force_back_row_next_phase）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroMaxAll" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「落雷」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果（PC人数回
          // 実行）:「敵視:1以上」のPC1体に【個別ダメージ:180】＋「雷:1D」を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わずconditionsで
          // GM手動処理に委ねる（Global Constraint 7、付随する「雷:1D」も手動処理注記に含める）。
          rollMin: 3,
          rollMax: 3,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「突撃＆炎の弾丸」：乱戦ダメージ修正±0（「—」ではないため発生、対象明記なし＝既定
          // ルール＝前衛均等割り）。個別効果:「敵視:1以上」のPCすべてに【個別ダメージ:120】＋
          // 「炎:2D」（固定値のためelementAccum）を与える。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 120, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "炎", amount: 2 }] },
          ],
        },
        {
          // 「赤い雷槌＆迸る赤雷」：乱戦ダメージ修正＋120（「—」ではないため発生、対象明記なし＝
          // 既定ルール＝前衛均等割り）。個別効果:「敵視:1以上」のPC全員は〈12|運試し〉を行い、
          // 失敗したPCに【個別ダメージ:120】＋「雷:1D」を与える。mod欄の「雷:1D」はこの判定
          // 失敗時効果と数値・種別が完全一致するため二重計上を避け、groupDamageには付随させず
          // savingThrow.onFail側にのみ構造化する（ancient_dragon「赤雷叩きつけ」と同型）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "luck",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 12 }],
            onFail: { amount: 120, elementAccum: [{ label: "雷", amount: 1 }] },
          },
        },
        {
          // 「飛びかかり雷槌＆駆け抜け」：乱戦ダメージ修正－300＋「雷:1D」（mod欄の固定値、骰子
          // ではないためelementAccum）。乱戦ダメージは「敵視:1以上」のPC全員を対象とし、2回発生
          // する（本文に明記）。特殊能力「駆け抜け」（force_back_row_next_phase）を効果発揮。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: -300, repeat: 2, elementAccum: [{ label: "雷", amount: 1 }] },
          targetRule: { kind: "aggroAtLeast1All" },
          conditions: ["force_back_row_next_phase"],
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
