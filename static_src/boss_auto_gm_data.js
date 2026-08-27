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
  // - edele（夜の爵、エデレ）・gnoster（夜の識、グノスター）・caligo（夜の霞、カリゴ）・
  //   fulghor（夜光の騎士、フルゴール）も単一形態＋rollBonusAfterGuardBreak方式（maris/gladiusと
  //   同型）で構造化済み（edele/gnosterは2026-08-24、caligo/fulghorは2026-08-26追加）。
  // - libra（夜の魔、リブラ）も単一形態だが「行動激化」を持たないためrollBonusAfterGuardBreak
  //   なしで構造化済み（2026-08-26追加、詳細はDATA.libraの先頭コメント参照）。
  // - harmonia（救いの旗手／英雄武器の娘たち、ハルモニア）・stragedes（反逆のストラゲス／衝動の
  //   ストラゲス）もgladiusと同型のformAware多形態ボスとして構造化済み（2026-08-27追加）。
  //   gladiusの「合体／分裂」とは異なり「第一形態／第二形態」の意味だが、state.battle.bossForm
  //   の2値（"fused"/"split"）をそのまま流用し、formLabelsで表示文言のみ上書きする。特殊能力
  //   「形態変化」（HP0到達→次アクションフェイズ開始時に第二形態へ移行）、harmoniaの「生きた娘」、
  //   stragedesの「亡者召喚」「モブ自壊」「瓦礫生成」は既存のrows/state機構でカバーできない
  //   ためスコープ外（GM手動処理）。
  // - nameless（夜の輪郭／夜の王、ナメレス）も同型のformAware多形態ボスとして構造化済み
  //   （2026-08-27追加、night_bosses.js名簿には未掲載だが劇本10「night_aspect」の実際のボス、
  //   ユーザー確認済みでスコープに含む）。特殊能力「追加効果」（2D6×9列のadditionalEffectTable
  //   を参照し、蓄積する属性／状態異常を決定する）は、このボス専用の新規ロール表であり既存の
  //   elementAccum/ailmentAccum（属性が本文に既に確定している場合の固定値表記）とは前提が異なる
  //   （どの属性／状態異常になるかは判定するまで不明）ため、本Taskでは自動解決ロジックを追加せず、
  //   該当行はconditionsで"additional_effect_table_manual"を記録し、GMが規則書パネル
  //   （night_rulebook.jsが既にboss.additionalEffectTableを表示する）を参照して手動で2D6を
  //   振る運用とした（night_gm_flow.jsの強敵決定表と同型の2D6×N列だが、あちらはシナリオ開始時の
  //   1回限りの選択、こちらは戦闘中に何度も参照され得る上に集計結果を「どのPCに」「どれだけ」
  //   蓄積するかの結線がnight.js側に必要になるため、単純な流用ではなく新規のstate書き込み経路の
  //   追加が必要になり、本Taskの「読み取り専用オーバーレイ＋計算専用関数」というスコープを
  //   超えると判断した）。
  // - 夜王9体＋nameless、計10体すべてが構造化完了（2026-08-27）。
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
    "fulghor": {
      // 「夜光の騎士、フルゴール」（night_boss_rulebook.js:339-396）：単一形態。特殊能力
      // 「行動激化」（體勢崩し発生後、戦闘終了まで「1D」ではなく「1D＋2」で判定）は
      // rollBonusAfterGuardBreak:2（gnosterと同型、出目レンジは1D6=1~6を+2シフトした3~8まで
      // 対応、出目7・8はいずれも體勢崩し後のみ到達）。
      //
      // 【対象範囲外・既知の制限】
      // - 特殊能力「疾走」（次のアクションフェイズ開始時、「最も大きい出目のスタミナダイスが
      //   2つ以下」のPCが後衛に配置される）：既存のforce_back_row_next_phase機構は「PC全員が
      //   骰目に関わらず後衛へ強制配置される」場合専用（死儀礼の鳥「飛び退き」等）で、対象が
      //   PCごとのスタミナダイス出目条件で絞り込まれる本能力とは条件が異なるため転用できない。
      //   新規state機構は追加せず、conditions:["speed_backrow_note"]としてGM向けnoteに留める。
      // - 特殊能力「回避困難」（対象の個別ダメージを回避するPCは、支払ったダイスコストを半分
      //   （端数切り捨て、最低1）として扱う）：PC側の回避処理ロジックの話でGM自動化の対象外。
      //   本文にこの特殊能力の適用が明記されている出目4・5の該当individualDamageに
      //   conditions:["dodge_difficult_note"]のタグのみ記録する。
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「風起こし＆疾走」：乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）。
          // 個別効果：「敵視：最大」のPC1体に個別ダメージ240。特殊能力「疾走」の効果発揮
          // （conditionsのみ、上記【対象範囲外】参照）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { value: 1260 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["speed_backrow_note"],
        },
        {
          // 「両刃剣乱舞」：乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）。
          // 個別効果（2回実行）：乱戦ダメージの対象となった、前衛で「敵視：1」以上のPC1体
          // （対象不特定）に個別ダメージ180。strong_type|divine_skin_apostles「連続突き」等と
          // 同型のdistribution:"rotate"（ユーザー確認済みルール＝候補の中で輪流受傷、最初の
          // 対象はランダム）で構造化する。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 180, repeat: 2, distribution: "rotate", targetRule: { kind: "frontAggroAtLeast1All" } },
          ],
          conditions: ["speed_backrow_note"],
        },
        {
          // 「突進斬り上げ＆疾走」：乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）。
          // 「乱戦ダメージを与える前に、敵視：1以上のPC全員は任意のスタミナダイス1個を消費する」
          // はPCが消費するダイスを選択するPC側処理のため自動化せずconditionsのみ。特殊能力
          // 「疾走」の効果発揮（conditionsのみ）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { value: 960 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_die_cost_note", "speed_backrow_note"],
        },
        {
          // 「追尾する光の雨」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果：PC全員に
          // 個別ダメージ180＋「聖：2」（本文の「聖：2」は□ではなく固定数値表記のためelementAccum
          // 固定値2）。個別効果：「敵視：1以上」のPC全員に個別ダメージ180＋「聖：2」。いずれも
          // 特殊能力「回避困難」を適用（conditionsのみ、上記【対象範囲外】参照）。
          rollMin: 4,
          rollMax: 4,
          individualDamage: [
            { amount: 180, targetRule: { kind: "allPCs" }, elementAccum: [{ label: "聖", amount: 2 }] },
            { amount: 180, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "聖", amount: 2 }] },
          ],
          conditions: ["dodge_difficult_note"],
        },
        {
          // 「聖槍爆発」：乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）、mod欄の
          // 「聖：1D」はTask1裁定によりelementAccum固定値1。個別効果：「敵視：1以上」のPC全員に
          // 個別ダメージ300＋「聖：1D」（固定値1）、特殊能力「回避困難」を適用（conditionsのみ）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { value: 1080, elementAccum: [{ label: "聖", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 300, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "聖", amount: 1 }] },
          ],
          conditions: ["dodge_difficult_note"],
        },
        {
          // 「連続突進＆疾走」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果：
          // 「敵視：1以上」のPC全員に個別ダメージ240。個別効果：「敵視：最大」のPC全員に
          // 個別ダメージ240（2つのindividualDamageエントリ、両集団が重複する場合はどちらも
          // 適用されうる＝既存gnoster等と同型の挙動）。特殊能力「疾走」の効果発揮
          // （conditionsのみ）。
          rollMin: 6,
          rollMax: 6,
          individualDamage: [
            { amount: 240, targetRule: { kind: "aggroAtLeast1All" } },
            { amount: 240, targetRule: { kind: "aggroMax" } },
          ],
          conditions: ["speed_backrow_note"],
        },
        {
          // 「腕乱舞」：乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）。個別効果の
          // 「HP損害：■■」（CLAUDE.md §19のcontext依存プレースホルダー）は自力で数値化せず、
          // GMが規則書本文（自動的にaction logへ表示される原文）を確認して手動処理する
          // （対象自体は「敵視：最大」のPC全員でtargetRule上は機械的に決まるが、■の数値未確定
          // のためindividualDamageは設定しない）。
          rollMin: 7,
          rollMax: 7,
          groupDamage: { value: 1200 },
          targetRule: { kind: "frontAll" },
          conditions: ["unknown_hp_damage_manual_aggro_max_all"],
        },
        {
          // 「腕叩きつけ」：乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）。個別効果：
          // 「敵視：1以上」のPC全員が〈11｜フィジカル〉判定（savingThrow、targetFilterで
          // 敵視：1以上のみに絞り込み、目標値は常に11のためtargetByConditionは"default"1件のみ）、
          // 失敗者に個別ダメージ180。判定失敗PCの「次のアクションフェイズ開始時獲得スタミナ
          // ダイス1個減少」は既存の汎用state機構が無いためconditionsのみ（GM向けnote）。
          rollMin: 8,
          rollMax: 8,
          groupDamage: { value: 1320 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "physical",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 180 },
          },
          conditions: ["stamina_die_reduction_next_phase_note"],
        },
      ],
    },
    "caligo": {
      // 「夜の霞、カリゴ」（劇本4、night_boss_rulebook.js:397-451）：単一形態（sizeはLL、HP3分割
      // だが本モジュールのスコープはGM→PCダメージ算出のみのためHP分割ロジックは対象外）。特殊能力
      // 「行動激化」（體勢崩し発生後、戦闘終了まで「1D」ではなく「1D＋2」で判定）は
      // rollBonusAfterGuardBreak:2（maris/gnosterと同型、出目レンジは1D6=1~6を+2シフトした3~8まで
      // 対応、出目7・8はいずれも體勢崩し後のみ到達）。
      //
      // 【特殊能力「氷霜の戦場」の扱い】〔条件発揮〕前衛のPC全員は「凍傷：1D」を受ける（固定値1、
      // Task1裁定）。この対象（前衛PC全員、敵視を問わない）は各行の乱戦ダメージ対象（多くは
      // 「敵視:1以上」の前衛等、より狭い集団）と一致しないため、gnoster「潜航＆毒液」等と同じ
      // 「対象集団の不一致」型の扱いとし、本文に「特殊能力『氷霜の戦場』の効果発揮」と明記されて
      // いる行にのみconditions:["special_icy_battlefield"]を付与し、実際の凍傷付与はGM手動で反映
      // する（各行自身の乱戦ダメージに付随する凍傷値——例：出目1の「凍傷:2」——は従来通り
      // groupDamage.ailmentAccumへ含める。これは氷霜の戦場とは別の、乱戦ダメージ本体に明記された
      // 蓄積である）。
      //
      // 【特殊能力「竜特攻」の扱い】公開情報「このエネミーは『竜』として扱う」は、night_gm_flow.js
      // 側の公開情報特殊能力表示の対象だが、本ボスにはenemy.special相当のテキストが無いため本
      // モジュールのスコープ外（GMが規則書パネルを直接参照する）。
      //
      // 【対象範囲外・既知の制限】
      // - 出目5「氷嵐＆氷霜」：「乱戦ダメージから『HP損害：■（1点）以上』を被ったPCは次アクション
      //   フェイズ開始時に前衛強制配置＋エリア移動不可」は■を含む条件付き効果のため自動化せず、
      //   conditionsへnoteとして記録するのみ（CLAUDE.md §19、■は自力で数値化しない）。
      // - 出目6「広範囲氷柱落とし」：このディフェンスフェイズは行動せず、次のディフェンスフェイズ
      //   開始時に後衛PC全員へ個別ダメージ420＋「凍傷：2D」（固定値2）を与えてから改めてアクション
      //   決定をやり直す、というターンをまたぐ特殊な発動タイミングのため自動化困難。ただし
      //   rowsから出目6を完全に省くと、night.js側のhandleAutoGmRollClick（result.structuredRowが
      //   nullの場合に.conditionsへ直接アクセスする箇所）が出目6ロール時にTypeErrorで例外を送出
      //   してしまう（全ボスの出目レンジが1D6＋rollBonusAfterGuardBreakの範囲を欠けなくカバー
      //   している前提の既存実装のため）。そのため「rowsに含めない」という当初の想定を文字通りには
      //   実装せず、gnoster出目5「叫び＆滞空」と同型の「rollMin/rollMaxのみ登録しgroupDamage／
      //   individualDamage／savingThrowは一切設定しない（conditionsのみ）」行としてrowsに含める
      //   ことでクラッシュを回避しつつ、自動化される数値は一切追加していない（下記rows参照）。
      // - 出目8「空中連続突進」：個別ダメージのrepeat+distribution:"rotate"パターン（既存の
      //   「対象PC1体（不特定）＋N回実行」規約）に付随する「凍傷：2」は、night.js側の
      //   distribution==="rotate"分岐がqueueAttributeAccumを呼んでいない（既存のenemy_auto_gm_data.js
      //   のrotateエントリにも前例が無い＝この構造では属性/状態異常蓄積を運べない）ため、
      //   ailmentAccumをentryへ設定しても静かに無視されてしまう。誤解を招く設定はせずconditionsへ
      //   noteとして記録しGM手動反映に委ねる。
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「尻尾叩きつけ＆氷霜」：「敵視：1以上」で前衛のPC全員は「乱戦ダメージ：2人分」を
          // 割り振られる（本文に明記）。特殊能力「氷霜の戦場」の効果発揮（上記コメント参照、前衛
          // 全員への凍傷:1Dは対象集団が異なるためconditionsのみ）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { value: 1080, ailmentAccum: [{ label: "凍傷", amount: 2 }] },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["special_icy_battlefield"],
        },
        {
          // 「前方ブレス」：乱戦ダメージはPC全員を対象とする（本文に明記）。個別効果：「敵視：最大」
          // のPC1体に追加ダメージ240＋「凍傷：2」。氷霜の戦場の効果発揮の記載は無い。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { value: 960, ailmentAccum: [{ label: "凍傷", amount: 2 }] },
          targetRule: { kind: "allPCs" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "凍傷", amount: 2 }] }],
        },
        {
          // 「足元ブレス＆氷霜」：乱戦ダメージの対象明記が本文に無いため既定ルール（前衛均等割り）。
          // ガード不可。次のアクションフェイズ終了まで、エネミーに「HP価値：＋10（最大100）」する。
          // 特殊能力「氷霜の戦場」の効果発揮。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { value: 900, ailmentAccum: [{ label: "凍傷", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard", "enemy_hp_value_buff", "special_icy_battlefield"],
        },
        {
          // 「とびかかり＆氷霜」：乱戦ダメージは「敵視：最大」のPCが多いエリアのPC全員を対象とする
          // （前衛/後衛が同数ならランダム）。gnoster「潜航＆毒液」で新設したtargetRule.kind
          // 「majorityAreaAggroMax」を再利用する。本文はさらに「『敵視：最大』のPC全員は乱戦ダメージ
          // ：2人分を割り振られる」と加重を指定しているが、majorityAreaAggroMaxはエリア内全員を
          // 均等割りする既存実装（weightRuleは同エリア内の敵視最大／非最大の区別に対応していない）
          // のため、この2人分加重は自動化せず均等割りに留める。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { value: 1140 },
          targetRule: { kind: "majorityAreaAggroMax" },
          conditions: ["special_icy_battlefield"],
        },
        {
          // 「氷嵐＆氷霜」：乱戦ダメージの対象明記が本文に無いため既定ルール（前衛均等割り）。
          // 「乱戦ダメージからHP損害：■（1点）以上を被ったPCは次アクションフェイズ前衛強制配置＋
          // エリア移動不可」は■を含むため自動化せずconditionsへ本文をそのままnoteとして記録する。
          // 特殊能力「氷霜の戦場」の効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { value: 1080, ailmentAccum: [{ label: "凍傷", amount: 4 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["special_icy_battlefield", "front_lock_on_hp_damage_manual"],
        },
        {
          // 「広範囲氷柱落とし」：上記ヘッダコメント【対象範囲外・既知の制限】参照。ターンをまたぐ
          // 特殊な発動タイミングのため自動化せず、rollMin/rollMaxのみ登録してnight.js側のクラッシュ
          // を回避する（groupDamage／individualDamage／savingThrowは一切設定しない）。本文：
          // 「このディフェンスフェイズで、このエネミーはアクションを行わない。次のディフェンス
          // フェイズの開始時、後衛のPC全員に【個別ダメージ：420】＋『凍傷：2D』（固定値2、Task1
          // 裁定）を与え、その後、このエネミーのアクション決定を行い、それを実行する。このとき
          // 『広範囲氷柱落とし』になりそうな場合、アクション決定をやり直す。」
          rollMin: 6,
          rollMax: 6,
          conditions: ["cross_phase_manual_action_skip"],
        },
        {
          // 「広範囲冷風＆氷霜」：乱戦ダメージ「—」のためgroupDamage無し。個別効果はgnoster
          // 「硬化＆魔力弾の雨」と同型のsavingThrow（敵視:1以上→目標12／それ以外→目標10、
          // 運試し=luck、全PCプール対象のためtargetFilterは指定しない）、失敗者に個別ダメージ300＋
          // 「凍傷：3」。「次のアクションフェイズ開始時獲得スタミナダイス2個減少」はHP損害を伴わず
          // savingThrow.onFailの構造（amountのみ）では表現できないためconditionsへnoteのみ。特殊
          // 能力「氷霜の戦場」の効果発揮。
          rollMin: 7,
          rollMax: 7,
          savingThrow: {
            stat: "luck",
            targetByCondition: [
              { condition: { kind: "aggroAtLeast1" }, target: 12 },
              { condition: { kind: "default" }, target: 10 },
            ],
            onFail: { amount: 300, ailmentAccum: [{ label: "凍傷", amount: 3 }] },
          },
          conditions: ["special_icy_battlefield", "stamina_dice_reduction_next_phase"],
        },
        {
          // 「空中連続突進」：乱戦ダメージ「—」のためgroupDamage無し。個別効果（3回実行）：
          // 「敵視：1以上」のPC1体（対象不特定）に個別ダメージ300、既存の「対象PC1体（不特定）＋
          // N回実行」規約（distribution:"rotate"）で自動化する。付随する「凍傷：2」はrotate分岐が
          // 属性/状態異常蓄積を運べない既存実装の制約のため自動化せずconditionsへnote（上記
          // ヘッダコメント参照）。次のアクションフェイズ開始時、PC全員はスタミナダイスの出目に
          // 関わらず後衛に配置される＝既存のforce_back_row_next_phaseタグ（night.js側で実行時に
          // 消費される）で処理する。
          rollMin: 8,
          rollMax: 8,
          individualDamage: [{ amount: 300, repeat: 3, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["force_back_row_next_phase", "rotate_ailment_manual_note"],
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
    "stragedes": {
      // 「反逆のストラゲス（第一形態）／衝動のストラゲス（第二形態）」（night_boss_rulebook.js:513-578）：
      // gladiusと同型の合体/分裂ではなく「第一形態→第二形態」の一方向遷移だが、行動決定表が
      // 形態ごとに完全に別（第一形態専用の出目1~6、第二形態専用の出目1~6）という点はgladiusの
      // rollRangeByFormパターンと同一構造のため、内部的にform "fused"＝第一形態／"split"＝
      // 第二形態として流用し、formLabels（Task 0で汎用化）でボタン文言のみ「第一形態」
      // 「第二形態」に上書きする。形態移行トリガー自体（HP「0」到達→次アクションフェイズ開始時に
      // 移行）は自動シミュレートせず、gladius同様GMがstate.battle.bossFormを手動トグルする運用。
      //
      // 【対象範囲外・既知の制限（specialsのうち3つ）】
      // - 特殊能力「亡者召喚」（HP枠にモブHPを追加、最大HP＝PC人数×3、既存モブHPがあれば
      //   最下行に追加）：既存のモブHP自動追加関数 addAutoMobHpRow（night.js内、
      //   night_gm_flow.jsのresolveAndAddCombatEnemies＝戦闘開始時の雑兵検出フローからのみ
      //   呼ばれる、window.PriTestNightCore等へは公開されておらず擲骰オーバーレイ
      //   （handleAutoGmRollClick／auto_gm.js）から呼び出せる汎用機構ではないことを確認した。
      //   無理に新規配線を作らず、該当行のconditionsに"mob_summon_manual"を記録し、GMが規則書
      //   本文（originalRow.note、既に進度版へ表示される）を見て手動でモブHP行を追加する運用とする。
      // - 特殊能力「モブ自壊」（エンドフェイズ開始時、モブHP存在時に「モブ損害：■×PC人数」＋
      //   PC全員に同値の「腐敗」）：エンドフェイズ起点の非同期処理かつ■を含むため、rowsには含めず
      //   このコメントに規則書原文の要旨のみ記録する（自動化対象外）。
      // - 特殊能力「瓦礫生成」（第二形態移行時に前衛エリアへ「瓦礫」生成、以後ディフェンス時に
      //   任意PC1人がHP価値+20／腐敗2を選択可）：形態遷移自体が手動運用のため、この特殊能力も
      //   自動化対象外（GMが規則書パネルを見て手動運用）。
      formAware: true,
      formLabels: {
        fused: { ja: "第一形態", zh: "第一形態" },
        split: { ja: "第二形態", zh: "第二形態" },
      },
      rows: [
        {
          // 第一形態出目1~2「横薙ぎ連打」：「敵視：1以上」で前衛のPC全員に「乱戦ダメージ：2人分」を
          // 割り振り（frontAggroAtLeast1Allの既定分配ロジックに一致）、かつ「乱戦ダメージは2回発生する」
          // 明記のためgroupDamage.repeat:2（maris出目8「渦潮」と同型の解釈）。
          rollRangeByForm: { fused: { min: 1, max: 2 }, split: null },
          groupDamage: { value: 780, repeat: 2 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 第一形態出目3~4「腐敗飛散＆亡者召喚」：乱戦ダメージ列「—」のため乱戦ダメージ無し。
          // 個別効果：「敵視：1以上」PC1体に個別ダメージ240＋「腐敗：3」を「PC人数」回行う——
          // gnoster「連続挟み込み＆誘導弾」で採用した「PC人数回実行＝対象全員に1回ずつ」の
          // 既存解釈を踏襲し、targetRule.aggroAtLeast1Allで「敵視：1以上」の対象全員に1回ずつ
          // 個別ダメージを与える形で構造化する（本文の「1体」表記は輪流受傷ではなく対象群全体を
          // 指すものとして扱う、gnosterと同じ裁定）。「腐敗：3」は固定値のためailmentAccum:3。
          // 特殊能力「亡者召喚」はモブHP追加の汎用機構が無いためconditionsのみ（GM手動）。
          rollRangeByForm: { fused: { min: 3, max: 4 }, split: null },
          individualDamage: [
            { amount: 240, targetRule: { kind: "aggroAtLeast1All" }, ailmentAccum: [{ label: "腐敗", amount: 3 }] },
          ],
          conditions: ["mob_summon_manual"],
        },
        {
          // 第一形態出目5「叩きつけ＆引き寄せ」：乱戦ダメージ1080の対象明記が本文に無いため、
          // 他ボス（maris/gnoster/gladius）と同じ既定ルール（前衛均等割り＝frontAll）を採用する。
          // 個別効果（「敵視：最大」PC全員が次アクションフェイズ開始時獲得スタミナダイス2個減少）は
          // HP損害を伴わない状態効果のためconditionsのみ（GM手動）。
          rollRangeByForm: { fused: { min: 5, max: 5 }, split: null },
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_aggro_max_manual"],
        },
        {
          // 第一形態出目6「腐敗地割れ＆亡者召喚」：乱戦ダメージはPC全員が対象（本文に明記、
          // allPCs）。「腐敗：1D」はTask1裁定によりailmentAccum固定値1。特殊能力「亡者召喚」は
          // 出目3~4と同様conditionsのみ（GM手動）。
          rollRangeByForm: { fused: { min: 6, max: 6 }, split: null },
          groupDamage: { value: 1200, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          targetRule: { kind: "allPCs" },
          conditions: ["mob_summon_manual"],
        },
        {
          // 第二形態出目1~2「柱張り付き＆突進」：乱戦ダメージ1080の対象明記が本文に無いため
          // frontAll既定ルール。回避時ダイスコスト半減はダイス消費ルールでHP損害を伴わないため
          // conditionsのみ。次アクションフェイズ終了までエネミーに「HP価値：＋10（最大100）」は
          // edeleと同じenemy_hp_value_buffタグを再利用（記録用のみ、コードから消費されない）。
          rollRangeByForm: { fused: null, split: { min: 1, max: 2 } },
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAll" },
          conditions: ["evasion_dice_cost_half_manual", "enemy_hp_value_buff"],
        },
        {
          // 第二形態出目3~4「腐敗散弾＆跳躍叩きつけ」：乱戦ダメージの対象明記が本文に無いため
          // frontAll既定ルール、「腐敗：2」は固定値のためgroupDamage.ailmentAccum:2。
          // 個別効果：「敵視：1以上」PC全員に個別ダメージ180＋「腐敗：1D」（Task1裁定によりailmentAccum
          // 固定値1）、対象は前後衛を問わないためaggroAtLeast1All（frontAggroAtLeast1Allではない、
          // 本文に「前衛」の限定が無いことを確認済み）。
          rollRangeByForm: { fused: null, split: { min: 3, max: 4 } },
          groupDamage: { value: 840, ailmentAccum: [{ label: "腐敗", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 180, targetRule: { kind: "aggroAtLeast1All" }, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          ],
        },
        {
          // 第二形態出目5「咆哮＆腐敗噴出」：乱戦ダメージ列「—」のため乱戦ダメージ無し。
          // 個別効果①（前衛PC全員「HP損害：■■■」、スタミナダイス消費で■軽減可）はCLAUDE.md §19の
          // 文脈依存プレースホルダーのため自動計算せず、conditionsに記録してGM手動（originalRow.noteの
          // 規則書本文で確認可能）。個別効果②（「敵視：最大」PC1体に個別ダメージ180＋「腐敗：2」）は
          // 数値が確定しているためindividualDamageで構造化する。
          rollRangeByForm: { fused: null, split: { min: 5, max: 5 } },
          individualDamage: [
            { amount: 180, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "腐敗", amount: 2 }] },
          ],
          conditions: ["unknown_hp_damage_manual_front_all"],
        },
        {
          // 第二形態出目6「薙ぎ払い＆腐敗地割れ」：乱戦ダメージの対象明記が本文に無いためfrontAll
          // 既定ルール、「腐敗：2」は固定値のためgroupDamage.ailmentAccum:2。個別効果はgnoster
          // 「硬化＆魔力弾の雨」と同型のsavingThrow（敵視:1以上→目標12／それ以外→目標10、運試し=luck）、
          // 失敗者に個別ダメージ120＋「腐敗：1D」（Task1裁定によりonFail.ailmentAccum固定値1）。
          rollRangeByForm: { fused: null, split: { min: 6, max: 6 } },
          groupDamage: { value: 1080, ailmentAccum: [{ label: "腐敗", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "luck",
            targetByCondition: [
              { condition: { kind: "aggroAtLeast1" }, target: 12 },
              { condition: { kind: "default" }, target: 10 },
            ],
            onFail: { amount: 120, ailmentAccum: [{ label: "腐敗", amount: 1 }] },
          },
        },
      ],
    },
    "nameless": {
      // 「夜の輪郭（第一形態）／夜の王、ナメレス（第二形態）」（劇本10「night_aspect」、
      // night_boss_rulebook.js:579-655）。第一形態⇔第二形態の2形態を持つformAwareボス
      // （gladiusと同型）。第一形態を内部形態id "fused"、第二形態を内部形態id "split" として
      // 扱い、formLabelsで表示ラベルのみ「第一形態／第二形態」に上書きする（gladiusの
      // 「合体形態／分裂形態」という既定ラベルとは意味が異なるため）。
      //
      // 【出目対応（night_boss_rulebook.js:648-654を直接確認、非対称構造に注意）】
      // 第一形態：1~2, 3~4, 5, 6 の4行で1~6を完全カバー。
      // 第二形態：3~4, 5~6 の2行のみ（1~2に対応する行は規則書上「—」で存在しない）。
      // 形態移行自体（「エンドフェイズ開始時」の非同期タイミング）は自動化せず、gladiusと同じく
      // GMがstate.battle.bossFormを手動トグルする運用。
      //
      // 【対象範囲外・既知の制限】
      // - 特殊能力「属性による弱体」（エネミーが「属性：聖」で属性損害を受けた場合、エンド
      //   フェイズまで「乱戦ダメージ：－120」「個別ダメージ：－60」）：PC側の属性ダメージ判定に
      //   依存する反応効果で、night.js側はエネミーへの属性別ダメージ発生を個別に追跡していない
      //   ため既存機構では自動化できない（edeleの「猛毒の吐瀉」と同種の未対応パターン）。GMが
      //   エネミーが「聖」属性損害を受けた事実を確認した場合、下記rows未収録のこの反応効果を
      //   手動で乱戦/個別ダメージから減算すること。
      // - 特殊能力「浮遊」の「次のアクションフェイズ終了まで、エネミーに『HP価値：＋10
      //   （最大100）』」は、浮遊が発揮される各行（下記rowsの該当行）でconditions:
      //   ["enemy_hp_value_buff"]として記録（edele/gnosterの既存タグを再利用、実際の
      //   HP-value反映はGMが#battle-guard-calc-block側で手動調整）。
      // - 特殊能力「浮遊」のうち「このエネミーが『第二形態』に移行したターンのアクション
      //   フェイズでは、PCは『アタック／夜渡りスキル／アーツ／装備品スキル』以外の行動を
      //   実行できない」は、"形態移行が発生したターン"という一時的な状態をnight.js側が
      //   追跡していないため自動化できない。GMが形態移行の当該ターンにのみ手動でPCの行動を
      //   制限すること。
      // - 特殊能力「浮遊」のうち「このエネミーが『第二形態』に移行したターンのディフェンス
      //   フェイズでは、このエネミーはアクション決定の1Dを振らず、自動的に『属性爆発＆浮遊』を
      //   行う」は、出目に紐づかない強制発動（libraの特殊トリガー行と同種の未対応パターン）
      //   のため、あえてrowsには含めない（rollMin/rollMax・rollRangeByFormのどの範囲にも
      //   対応させると、通常の1D6判定でも同じ行に到達し得てしまい、強制発動と通常判定の区別が
      //   つかなくなるため）。GMは第二形態移行ターンのディフェンスフェイズでは1Dを振らず、
      //   下記rows中の「属性爆発＆浮遊」（第二形態3~4行）の内容を直接適用すること。
      // - 特殊能力「追加効果」＋additionalEffectTable：ファイル冒頭コメント参照。該当行では
      //   conditions: ["additional_effect_table_manual"] のみを記録し、実際の2D6判定と
      //   属性／状態異常の決定・蓄積はGMが規則書パネルを見ながら手動で行う。
      formAware: true,
      formLabels: {
        fused: { ja: "第一形態", zh: "第一形態" },
        split: { ja: "第二形態", zh: "第二形態" },
      },
      rows: [
        {
          // 「直剣突き＆大剣薙ぎ払い」（第一形態のみ、出目1~2）：前衛の中で「敵視：最大」の
          // PC全員が「乱戦ダメージ：3人分」を割り振られる（本文に明記、gladius/edele/marisと
          // 同じ規約で本文の数値は既にN人分込みの合計値）。対象は「前衛かつ敵視最大」なので
          // 既存のfrontAggroMaxAll（前衛の中で敵視最大の全員）で表現する。
          rollRangeByForm: { fused: { min: 1, max: 2 }, split: null },
          groupDamage: { value: 1200 },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「2連斬り＆魔力の刃」（第一形態のみ、出目3~4）：乱戦ダメージの対象明記が本文に
          // 無いため既定ルール（前衛均等割り）。「魔：2」は本文がダイス表記（ND）ではなく
          // 直接の確定値「2」のため、そのままelementAccum固定値2として扱う（Task1裁定の
          // 「Xd＝固定値」変換すら不要な、既に確定値の表記）。個別効果（2回実行）：
          // 「敵視：1以上」のPC1体（不特定・輪流）に個別ダメージ240
          // （distribution:"rotate"、既存のenemy_auto_gm_data.jsと同型パターン）。
          rollRangeByForm: { fused: { min: 3, max: 4 }, split: null },
          groupDamage: { value: 1080, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「咆哮4連斬り」（第一形態のみ、出目5）：乱戦ダメージ列が「—」のため乱戦ダメージ無し。
          // 個別効果（4回実行）：「敵視：1以上」のPC1体（不特定・輪流）に個別ダメージ180は
          // 確定値のため自動計算するが、付随する「※追加効果：1D」（どの属性/状態異常が
          // 蓄積するかは規則書のadditionalEffectTableを2D6で参照するまで不明）は自動化せず
          // conditionsに記録し、GMが規則書パネルを見ながら手動決定する。
          rollRangeByForm: { fused: { min: 5, max: 5 }, split: null },
          individualDamage: [{ amount: 180, repeat: 4, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["additional_effect_table_manual"],
        },
        {
          // 「とびかかり＆光波2連」（第一形態のみ、出目6）：乱戦ダメージの対象明記が本文に
          // 無いため既定ルール（前衛均等割り）。乱戦ダメージに付随する「追加効果：2D」は
          // additionalEffectTableを2回参照する必要があるためconditionsに記録しGM手動。
          // 個別効果：「敵視：1以上」のPC全員に個別ダメージ300＋「魔：4」（確定値のため
          // elementAccum固定値4として自動計算、追加効果とは無関係の別表記）。
          rollRangeByForm: { fused: { min: 6, max: 6 }, split: null },
          groupDamage: { value: 1200 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 300, targetRule: { kind: "aggroAtLeast1All" }, elementAccum: [{ label: "魔", amount: 4 }] },
          ],
          conditions: ["additional_effect_table_manual"],
        },
        {
          // 「属性爆発＆浮遊」（第二形態のみ、出目3~4）：乱戦ダメージはPC全員が対象、2回発生し
          // 2回目は「敵視：1以上」のPC全員が対象——gnosterの「合体突進」と同型の
          // groupDamage.sequenceで自動化する。乱戦ダメージに付随する「追加効果：2D」は
          // additionalEffectTable参照のためconditionsに記録しGM手動。特殊能力「浮遊」の
          // 効果発揮（次アクションフェイズ終了までHP価値＋10）もconditionsに記録
          // （edele/gnosterの既存enemy_hp_value_buffタグを再利用）。
          rollRangeByForm: { fused: null, split: { min: 3, max: 4 } },
          groupDamage: {
            value: 600,
            sequence: [{ targetRule: { kind: "allPCs" } }, { targetRule: { kind: "aggroAtLeast1All" } }],
          },
          conditions: ["additional_effect_table_manual", "enemy_hp_value_buff"],
        },
        {
          // 「属性剣乱舞＆浮遊」（第二形態のみ、出目5~6）：乱戦ダメージの対象明記が本文に無い
          // ため既定ルール（前衛均等割り）。乱戦ダメージに付随する「追加効果：1D」は
          // additionalEffectTable参照のためconditionsに記録しGM手動。個別効果（「敵視：1以上」
          // 全員は目標12、それ以外は目標10の運試し、失敗者に「HP損害：■■」＋「※追加効果：
          // 1D」）は、失敗時HP損害が「■■」（CLAUDE.md §19のcontext依存プレースホルダー）で
          // 自動計算できる確定値が無いため、gnosterのsavingThrow機構（onFail.amountが必須）を
          // 使わず、判定自体を含めてconditionsのみに留める（GMが目標12/10の運試しを実際に
          // 振り、失敗者へ■■のHP損害と追加効果決定表参照を手動で適用する）。特殊能力「浮遊」の
          // 効果発揮もconditionsに記録。
          rollRangeByForm: { fused: null, split: { min: 5, max: 6 } },
          groupDamage: { value: 900 },
          targetRule: { kind: "frontAll" },
          conditions: ["additional_effect_table_manual", "unknown_hp_damage_manual", "enemy_hp_value_buff"],
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
