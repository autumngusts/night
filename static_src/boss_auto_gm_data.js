(function () {
  // 自動化GM 試作：夜の王（night_boss_rulebook.jsのBOSSES）用の構造化オーバーレイ。
  // enemy_auto_gm_data.jsと同じ加算的オーバーレイ設計だが、データ形状は異なる：
  //
  // - 通常エネミーとは違い、夜の王は全員level:16固定でレベル別基準値テーブルが無い。
  //   actionColumnsの「乱戦ダメージ」列がそのまま最終値のため、groupDamage.value（直接値）
  //   を使う（通常エネミーのgroupDamage.modifier＝base+modifierとは異なる、auto_gm.js側で
  //   value/modifierどちらが指定されているかで自動判別する）。
  // - キーは "boss|<bossId>"（night_boss_rulebook.jsのBOSSES[].idと一致）。
  //
  // 【現時点の対象範囲・既知の制限】
  // シナリオ1「三首獸」の夜の王は「gladius（夜の獣、グラディウス）」。加えて、構造が最も
  // 単純な「maris（深海の夜、マリス）」も試作として出目1〜8（全行）を構造化済み。
  // - maris出目7〜8は特殊能力「行動激化」（體勢崩し発生後、以後は戦闘終了まで「1D」ではなく
  //   「1D＋2」で判定する）でのみ到達する。night.js側のstate.battle.guardBroken（HP行の
  //   いずれかが最初に0へ到達した瞬間trueになる持続フラグ）とrollBonusAfterGuardBreakで対応。
  // - gladiusは合体形態／分裂形態の2形態を持つため、rollRangeByForm（form別の出目範囲）で
  //   判定するformAwareボスとして構造化した。分裂形態時のHP3分割・体勢崩し不発生などの
  //   PC→敵ダメージ側の処理はスコープ外（本機能はGM→PCダメージ算出のみが対象）。形態移行は
  //   「エンドフェイズ開始時」という非同期タイミングのため自動シミュレートせず、GM手動トグルで
  //   state.battle.bossFormを切り替える運用とした。
  // - edele（夜の爵、エデレ）・gnoster（夜の識、グノスター）も単一形態＋
  //   rollBonusAfterGuardBreak方式（maris/gladiusと同型）で構造化済み（2026-08-24追加）。
  // - libra（夜の魔、リブラ）も単一形態だが「行動激化」を持たないためrollBonusAfterGuardBreak
  //   なしで構造化済み（2026-08-26追加、詳細はDATA.libraの先頭コメント参照）。
  // - 他の4体（fulghor/harmonia/caligo/stragedes）は、多形態（harmonia等）や
  //   二段階ロール表（stragedes等）など固有ルールを持つため今回は対象外。
  var DATA = {
    "maris": {
      // 特殊能力「行動激化」：體勢崩潰（体勢崩し）発生後、戦闘終了まで行動決定を「1D」ではなく
      // 「1D＋2」で行う（night.js側のstate.battle.guardBrokenフラグをauto_gm.jsが参照して
      // 実装、通常の1D6では出目7〜8に到達しないため、この機構が無いと出目7〜8の行は永遠に
      // 到達不可能だった）。
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「回転突進＆滞空」：「敵視：1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 特殊能力「滞空」（次の行動フェイズ、PC全員が出目に関わらず後衛配置＋エリア移動消耗3）
          // はconditionsのみ（GM手動反映）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["special_levitate"],
        },
        {
          // 「回転突進＆藻種の萌芽」：同上の対象規則。特殊能力「藻種の萌芽」（結束階段でモブHP回復
          // ＋PC全員に睡眠1Dの半分）はconditionsのみ。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["special_algae_sprout"],
        },
        {
          // 「水しぶき＆魔力の泡」：対象の明記が無いため既定ルール（前衛均等割り）。個別効果は
          // 睡眠のみ（HP損害を伴わないためindividualDamage無し）。特殊能力「魔力の泡」
          // （PC協議で1名選出しHP損害■＋睡眠1）はconditionsのみ。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { value: 780 },
          targetRule: { kind: "frontAll" },
          conditions: ["special_magic_bubble"],
        },
        {
          // 「水しぶき＆藻種の萌芽」：同上の対象規則。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { value: 780 },
          targetRule: { kind: "frontAll" },
          conditions: ["special_algae_sprout"],
        },
        {
          // 「広範囲睡眠攻撃＆滞空」：対象の明記が無いため既定ルール（前衛均等割り）。
          // 「乱戦ダメージでHP損害■以上を被ったPCは同数の睡眠を受ける」は自動判定できないため
          // conditionsのみ。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { value: 1020 },
          targetRule: { kind: "frontAll" },
          conditions: ["special_levitate", "sleep_on_damage"],
        },
        {
          // 「広範囲睡眠攻撃＆魔力の泡」：同上の対象規則。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { value: 1020 },
          targetRule: { kind: "frontAll" },
          conditions: ["special_magic_bubble", "sleep_on_damage"],
        },
        {
          // 「滞空＆魔力の泡＆藻種の萌芽」（體勢崩潰後のみ到達）：対象の明記が無いため既定ルール。
          rollMin: 7,
          rollMax: 7,
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAll" },
          conditions: ["special_levitate", "special_magic_bubble", "special_algae_sprout"],
        },
        {
          // 「渦潮」（體勢崩潰後のみ到達）：「敵視：1以上」のPC全員が対象、対象0人なら前衛が
          // 対象（fallback）。乱戦ダメージは2回発生（本文に明記、groupDamage.repeat:2）。
          // 睡眠1Dは属性ダイスのためconditionsのみ（GM手動反映）。
          rollMin: 8,
          rollMax: 8,
          groupDamage: { value: 420, repeat: 2 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
          conditions: ["sleep_1d"],
        },
      ],
    },
    "gladius": {
      // 「夜の獣、グラディウス」：合体形態(LL)／分裂形態(L・3体分裂)の2形態を持つ多形態ボス。
      // 出目の意味が形態ごとに異なる（actionColumns[0]=合体形態欄, [1]=分裂形態欄）ため、
      // rollMin/rollMaxではなくrollRangeByForm（form別の出目範囲、無ければnull＝その形態では
      // 到達不可）で判定する。現在の形態はstate.battle.bossForm（既定"fused"）で保持し、GMが
      // 手動でトグルする（形態移行は「エンドフェイズ開始時」という非同期タイミングのため自動
      // シミュレートしない）。
      //
      // 【対象範囲外・既知の制限】分裂形態時のHP3分割・体勢崩し不発生などのPC→敵ダメージ側の
      // 処理はauto_gmのスコープ外（本機能はGM→PCの乱戦/個別ダメージ算出のみを対象とする）。
      formAware: true,
      rows: [
        {
          // 「噛みつき」（合体形態のみ、出目1~2）：「敵視：1以上」で前衛のPC全員は
          // 「乱戦ダメージ：2人分」を割り振られる（本文に明記）。
          rollRangeByForm: { fused: { min: 1, max: 2 }, split: null },
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「鎖剣振り回し」（合体形態のみ、出目3）：乱戦ダメージの対象明記が無いため既定ルール
          // （前衛均等割り）。個別効果：「敵視：最大」のPC1体に個別ダメージ300。
          rollRangeByForm: { fused: { min: 3, max: 3 }, split: null },
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「炎のブレス」（合体形態のみ、出目4）：乱戦ダメージの対象明記が無いため既定ルール。
          // 個別効果：「敵視：1以上」で前衛のPC全員に個別ダメージ180＋「炎：1D」（属性ダイスは
          // 従来通り手動反映）。
          rollRangeByForm: { fused: { min: 4, max: 4 }, split: null },
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "frontAggroAtLeast1All" } }],
        },
        {
          // 「炎突進＆形態変化」：合体形態の出目5~6、または分裂形態の出目1~2のどちらでも到達。
          // 乱戦ダメージの対象明記が無いため既定ルール。特殊能力「形態変化」はGMが手動で
          // フォームトグルを切り替える（conditionsは記録用のマーカーのみ）。
          rollRangeByForm: { fused: { min: 5, max: 6 }, split: { min: 1, max: 2 } },
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAll" },
          conditions: ["form_change_at_end_phase"],
        },
        {
          // 「3連噛みつき」（分裂形態のみ、出目3~4）：乱戦ダメージ列が「—」のため乱戦ダメージ無し。
          // 個別効果（3回実行）：「敵視：最大」のPC1体に個別ダメージ120＋「炎：1D」。対象が
          // 明示的に「敵視：最大」（曖昧な「1名・輪流」ではない）なのでaggroMax＋repeat:3で
          // 同一PCへの連続ヒットとして扱う。
          rollRangeByForm: { fused: null, split: { min: 3, max: 4 } },
          individualDamage: [{ amount: 120, repeat: 3, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「炎連弾」（分裂形態のみ、出目5~6）：乱戦ダメージの対象明記が無いため既定ルール。
          // 個別効果：「敵視：1以上」のPC全員に個別ダメージ180＋「炎：1D」。
          rollRangeByForm: { fused: null, split: { min: 5, max: 6 } },
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
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
          // 「猛毒：1D」）はHP損害を伴わないため引き続きconditions
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
    "libra": {
      // 「夜の魔、リブラ」（night_boss_rulebook.js:281-338）：単一形態。特殊能力「行動激化」を
      // 持たないため、rollBonusAfterGuardBreakは設定しない（他の夜の王と異なる点、Task3裁定）。
      // 出目1~6の標準6行＋出目なしの特殊トリガー2行のみで構成される。
      //
      // 【対象範囲外・既知の制限】以下の3つの特殊能力は、モブHP「滞留魔法陣」の有無で次の
      // ディフェンスフェイズの行動が無条件に決まる（1Dを振らない）という、既存のrowsベースの
      // 出目決定モデルと根本的に異なる制御フローのため、rowsには含めずGM向けに全文記録するに
      // 留める（gladiusの分裂/合体のような既存機構への統合は本Taskの範囲外——将来的な拡張候補）：
      //
      // ・「発狂の種」：次のアクションフェイズ終了まで、PCが行えるアクションに「種拾い」を
      //   追加する。「種拾い」（コスト：1）自身の「状態異常蓄積値：発狂」を「1」減少させ
      //   「HP回復：□」を適用する。このアクションは後衛のみで実行可能。
      // ・「モブHP『滞留魔法陣』の扱い」：モブHP「滞留魔法陣」は、通常のモブHPの扱いと異なり、
      //   PCが総合ダメージを与える際、モブHPから損害を与えるか、モブHPを無視して本体HPに損害を
      //   与えるかを選択できる（総合ダメージを与える際、PC全員で相談して決定する）。
      // ・「魔法陣滞留による行動内容指定」：アクション「結跏趺坐＆滞留魔法陣生成」が行われた後、
      //   次のターンの通常のアクション決定を行わず、この特殊能力の効果に従う。ディフェンス
      //   フェイズ開始時に「モブHP（滞留魔法陣）」が「現在HP：□（1）以上」の場合、アクション
      //   決定の1Dを振らず、自動的に「逃れ得ぬ発狂の瞳＆発狂の種」を行う。ディフェンスフェイズ
      //   開始時に「モブHP（滞留魔法陣）」が存在しない（HP0点の）場合も1Dを振らず、自動的に
      //   「両腕連続叩きつけ」を行う。
      //
      // 上記に連動する、出目に紐づかない特殊トリガー行2つ（rows外、gnosterの「毒吐き」と同じ
      // 扱い）：
      // ・「両腕連続叩きつけ」：個別効果（3回実行）：「敵視：1以上」のPC1体に
      //   【個別ダメージ：240】＋「状態異常：発狂」を与える。
      // ・「逃れ得ぬ発狂の瞳＆発狂の種」：乱戦ダメージ780＆「発狂：2」、前衛の中で
      //   「敵視：最大」のPC全員は「乱戦ダメージ：3人分」を割り振られる。個別効果：PC全員は
      //   〈13｜メンタル〉で達成し、失敗したPCは、目標値に対し不足した値と同じ数の蓄積数の
      //   「発狂」を被り、モブHP「滞留魔法陣」の現在HPが「0」点になり消失する。特殊能力
      //   「発狂の種」の効果発揮。
      //
      // 【出目5「狂乱の雲」のsavingThrow拡張】従来のsavingThrow（gnoster等）は「失敗時のみ効果」
      // のonFailしか持たなかったが、本行は成功/失敗どちらも異なる蓄積（発狂1D/2D）を受けるため、
      // onPassフィールドを新設した（auto_gm.js自体は無変更——resolveSavingThrowは元々passed
      // 真偽を返すだけで、onFail/onPassの適用はnight.js側の消費コードが行っていたため、
      // night.js側でr.passed分岐をonPassにも対応させるだけで済んだ、Task3裁定）。
      rows: [
        {
          // 「錫杖振り回し」：前衛の中で「敵視：最大」のPC全員は「乱戦ダメージ：2人分」を
          // 割り振られる（本文に明記）。既存kind"frontAggroMaxAll"（坩堝の騎士「薙ぎ払い」等と
          // 同型）で対応。「発狂：1D」はTask1裁定によりailmentAccum固定値1。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { value: 960, ailmentAccum: [{ label: "発狂", amount: 1 }] },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「転移＆錫杖薙ぎ払い」：gnoster「潜航＆毒液」と同型のmajorityAreaAggroMax
          // （「敵視：最大」のPCが多いエリア全員、同数ならランダム）。「発狂：2」は固定値。
          // 次のアクションフェイズ終了までエネミーに「HP価値：＋10（最大100）」する。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { value: 1080, ailmentAccum: [{ label: "発狂", amount: 2 }] },
          targetRule: { kind: "majorityAreaAggroMax" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「発狂のつぶて＆発狂の種」：「敵視：1以上」のPC全員が対象、対象0人なら前衛が対象
          // （fallback、maris「渦潮」と同型）。「発狂：1D」は固定値1。特殊能力「発狂の種」の
          // 効果発揮はモブ機構と連動するためconditionsのみ（自動化しない）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { value: 720, ailmentAccum: [{ label: "発狂", amount: 1 }] },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
          conditions: ["special_madness_seed"],
        },
        {
          // 「転移＆魔法陣展開＆発狂の種」：対象の明記が無いため乱戦ダメージは既定ルール
          // （前衛均等割り）。「発狂：2」は固定値。個別効果：「敵視：1以上」PCのみが対象の
          // 〈11｜運試し〉（targetFilter:aggroAtLeast1で絞り込み）、失敗者に個別ダメージ180＋
          // 「発狂：1D」（固定値1）。次のアクションフェイズ終了までエネミーに
          // 「HP価値：＋10（最大100）」する。特殊能力「発狂の種」の効果発揮はconditionsのみ。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { value: 840, ailmentAccum: [{ label: "発狂", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "luck",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 180, ailmentAccum: [{ label: "発狂", amount: 1 }] },
          },
          conditions: ["enemy_hp_value_buff", "special_madness_seed"],
        },
        {
          // 「狂乱の雲」：乱戦ダメージは対象の明記が無いため既定ルール（前衛均等割り）。
          // 「発狂：2」は固定値。個別効果はsavingThrow（敵視:1以上→目標12／それ以外→目標10、
          // メンタル、全PCプール対象のためtargetFilterは指定しない、gnoster「硬化＆魔力弾の雨」
          // と同型のtargetByCondition）。成功/失敗どちらも異なる蓄積を受けるため、onFail
          // （「発狂：2D」固定値2）に加えて本Taskで新設したonPass（「発狂：1D」固定値1）を使う
          // （どちらもHP損害を伴わないためamountは指定しない＝night.js側は個別ダメージ入力欄
          // への書き込みをスキップし、ailmentAccumのみキューする）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { value: 960, ailmentAccum: [{ label: "発狂", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "mental",
            targetByCondition: [
              { condition: { kind: "aggroAtLeast1" }, target: 12 },
              { condition: { kind: "default" }, target: 10 },
            ],
            onPass: { ailmentAccum: [{ label: "発狂", amount: 1 }] },
            onFail: { ailmentAccum: [{ label: "発狂", amount: 2 }] },
          },
        },
        {
          // 「結跏趺坐＆滞留魔法陣生成＆発狂の種」：乱戦ダメージは対象の明記が無いため既定ルール
          // （前衛均等割り）。「発狂：3」は固定値。HP枠へのモブ「滞留魔法陣」追加／回復
          // （最大HP：PC人数×2、レベル補正の影響を受けない）は、enemy_auto_gm_data.js側にも
          // 対応するモブHP自動追加パターンが見当たらないため、GM向けconditionsのみに留める
          // （このアクションが行われた後は特殊能力「魔法陣滞留による行動内容指定」に従い、
          // 次のディフェンスフェイズは1Dを振らず強制的にrows外の2つのトリガー行のどちらかが
          // 発動する——上記ヘッダーコメント参照）。特殊能力「発狂の種」の効果発揮はconditions
          // のみ。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { value: 960, ailmentAccum: [{ label: "発狂", amount: 3 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["mob_hp_stagnation_circle_add_manual", "special_madness_seed"],
        },
      ],
    },
  };

  function get(bossId) {
    return DATA[bossId] || null;
  }

  window.PriTestBossAutoGmData = {
    get: get,
  };
})();
