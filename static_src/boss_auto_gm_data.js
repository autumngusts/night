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
  // - harmonia（救いの旗手／英雄武器の娘たち、ハルモニア）もgladiusと同型のformAware多形態
  //   ボスとして構造化済み（2026-08-27追加）。gladiusの「合体／分裂」とは異なり「第一形態／
  //   第二形態」の意味だが、state.battle.bossFormの2値（"fused"/"split"）をそのまま流用し、
  //   formLabelsで表示文言のみ上書きする。特殊能力「形態変化」（HP0到達→次アクションフェイズ
  //   開始時に第二形態へ移行）と「生きた娘」（第二形態限定、ディフェンスフェイズ開始ごとの
  //   判定）は既存のrows/state機構でカバーできないためスコープ外（GM手動処理）。
  // - 他の4体（fulghor/caligo/libra/stragedes）は、二段階ロール表（stragedes等）など固有
  //   ルールを持つため今回は対象外。
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
    "harmonia": {
      // 「救いの旗手（第一形態）／英雄武器の娘たち、ハルモニア（第二形態）」
      // （night_boss_rulebook.js:452-512）：gladiusと同型のformAware多形態ボス。ただし
      // gladiusの「合体形態／分裂形態」とは異なり、意味上は「第一形態／第二形態」。
      // state.battle.bossFormが持つ2値（既定"fused"／"split"）のうち"fused"を第一形態、
      // "split"を第二形態として内部的に流用し、formLabelsでトグルボタンの表示文言のみを
      // 上書きする（rollRangeByForm等のデータ構造・挙動はgladiusと完全に同一）。
      //
      // 特殊能力「形態変化」：HP0到達時、次のアクションフェイズ開始時に第二形態へ移行
      // （全HP行／ガード回数が最大値まで回復、PC・エネミー双方の属性／状態異常蓄積が0）。
      // この移行は「エンドフェイズ開始時」ではなく「次のアクションフェイズ開始時」だが、
      // いずれにせよターン進行をまたぐ非同期タイミングのため、gladiusと同様に自動シミュレート
      // しない。GMがフォームトグルボタンを手動で切り替える運用のまま（rowsには含めない）。
      //
      // 【対象範囲外・既知の制限】特殊能力「生きた娘」（第二形態限定。ディフェンスフェイズ
      // 開始ごとに〈11｜メンタル〉を行い、PCの半数以上が失敗した場合、そのディフェンス
      // フェイズ終了まで、エネミーを「HP価値：＋10（最大100）」し、エネミーの乱戦ダメージ／
      // 個別ダメージを「＋120」する）は、rowsが表す「1D6の出目→行動」モデルとは別の
      // 「ディフェンスフェイズ開始ごと」というトリガーのため、rowsには含めずGM手動判定に
      // 委ねる（edeleの「猛毒の吐瀉」と同種の未対応パターン）。
      formAware: true,
      formLabels: {
        fused: { ja: "第一形態", zh: "第一形態" },
        split: { ja: "第二形態", zh: "第二形態" },
      },
      rows: [
        {
          // 「個別攻撃＆散開」（第一形態のみ、出目1~2）：乱戦ダメージ600が2回発生する
          // （本文に明記、groupDamage.repeat:2）。対象の明記が無いため既定ルール
          // （前衛均等割り）。特殊能力「散開」（次のアクションフェイズ終了までエネミーに
          // 「HP価値：＋10（最大100）」）はedele/gnosterと同じ既存タグenemy_hp_value_buffで
          // 記録する。
          rollRangeByForm: { fused: { min: 1, max: 2 }, split: null },
          groupDamage: { value: 600, repeat: 2 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「集中攻撃」（第一形態のみ、出目3~4）：乱戦ダメージ列が「—」のため乱戦ダメージ
          // 無し。個別効果（2回実行）：「敵視：1以上」のPC全員に個別ダメージ300。対象が
          // 「1体」ではなく「全員」なのでtargetRuleはaggroAtLeast1All、repeat:2で対象群
          // 全員が2回分（600）を受ける（gladiusの「3連噛みつき」と同じrepeat解釈、対象が
          // 単数か複数かのみ異なる）。
          rollRangeByForm: { fused: { min: 3, max: 4 }, split: null },
          individualDamage: [{ amount: 300, repeat: 2, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「聖槍の壁」：規則書actionColumnsの「第一形態※①」＝5、「第二形態※①」＝1が
          // 同一行（同じ内容）のため、rollRangeByFormの両方に対応する範囲を設定する。
          // 「前衛の中で敵視：最大のPC全員は乱戦ダメージ：2人分を割り振られる」＝対象群が
          // 全員同じ重みのため、gladius「噛みつき」と同じくfrontAggroMaxAllのみで表現できる
          // （weightRule不要、全員同重みの均等割りと数学的に同値）。「次のアクションフェイズ
          // 終了まで、PC全員はエリア移動およびエリア移動を含むアクション（アーツを除く）を
          // 行えない」は既存の汎用state機構が無いため、conditionsにGM向けnoteとして残す。
          rollRangeByForm: { fused: { min: 5, max: 5 }, split: { min: 1, max: 1 } },
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAggroMaxAll" },
          conditions: ["area_move_lock_until_next_action_phase_manual"],
        },
        {
          // 「掴み攻撃＆散開」：規則書actionColumnsの「第一形態※①」＝6、「第二形態※①」＝2が
          // 同一行。乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果：前衛の中で
          // 「敵視：最大」のPC（本文は「1体」表記だがgladiusの「3連噛みつき」と同じ既存解釈で
          // タイなら該当者全員がヒットする、frontAggroMaxAll）に個別ダメージ360、ガード不可。
          // 特殊能力「散開」はenemy_hp_value_buffで記録する。
          rollRangeByForm: { fused: { min: 6, max: 6 }, split: { min: 2, max: 2 } },
          individualDamage: [{ amount: 360, targetRule: { kind: "frontAggroMaxAll" } }],
          conditions: ["no_guard", "enemy_hp_value_buff"],
        },
        {
          // 「瞬間移動＆乱舞」（第二形態のみ、出目3~4）：乱戦ダメージ900は後衛のPC全員が
          // 対象（本文に明記）。その中で「敵視：1以上」のPC全員は「乱戦ダメージ：2人分」を
          // 割り振られる＝基準の対象群（backAll）の中に重みの異なる2群が混在するため、
          // edeleの「突進」と同じくtargetRule.weightRuleが必要。ただしedeleのweightRule.kind
          // 「frontAggroAtLeast1」は前衛限定で、後衛PCは常にfront===falseとなり誤って全員
          // weight1になってしまうため使えない。auto_gm.jsのmatchesWeightConditionへ前衛条件を
          // 課さない新種別「aggroAtLeast1」を追加した（既存のfrontAggroAtLeast1の挙動は
          // 変更していない）。「次のアクションフェイズ開始時、対象PCが獲得するスタミナ
          // ダイスが1個減少する」はenemy_auto_gm_data.jsの既存タグ
          // stamina_dice_reduction_next_phaseを再利用してGM向けnoteとして残す。
          rollRangeByForm: { fused: null, split: { min: 3, max: 4 } },
          groupDamage: { value: 900 },
          targetRule: { kind: "backAll", weightRule: { kind: "aggroAtLeast1", weight: 2 } },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「一斉射撃＆散開」（第二形態のみ、出目5~6）：乱戦ダメージ1200はPC全員が対象
          // （本文に明記、allPCs）。個別効果：「敵視：最大」のPC全員（前衛/後衛を問わない
          // ためfrontAggroMaxAllではなくaggroMax）に個別ダメージ300。特殊能力「散開」は
          // enemy_hp_value_buffで記録する。
          rollRangeByForm: { fused: null, split: { min: 5, max: 6 } },
          groupDamage: { value: 1200 },
          targetRule: { kind: "allPCs" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["enemy_hp_value_buff"],
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
