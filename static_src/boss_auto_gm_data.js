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
  // - edele（夜の爵、エデレ／劇本2）・gnoster（夜の識、グノスター／劇本3）も単一形態＋
  //   rollBonusAfterGuardBreak方式（demihuman_queen_swordmasterと同型）で構造化済み。
  //   いずれも「■」（規則書のcontext依存プレースホルダー、docs/CLAUDE.md §17-19参照）で
  //   表記されたHP損害行、および複数PCに異なる対象で複数回発生する乱戦ダメージ（gnoster出目8）
  //   など、既存のtargetRule語彙で表現できない箇所は数値を捏造せず、groupDamage/
  //   individualDamageを設定しないままGM手動判定に委ねている（詳細は各エントリのコメント参照）。
  // - 他の5体（fulghor/harmonia/caligo/libra/stragedes）は、多形態（harmonia等）や
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
      // 「夜の爵、エデレ」（劇本2「咬噬之顎」）：単一形態。特殊能力「行動激化」（體勢崩し発生後、
      // 戦闘終了まで「1D」ではなく「1D＋4」で判定）はdemihuman_queen_swordmasterと同型
      // （rollBonusAfterGuardBreak:4、出目レンジは1D6=1~6の範囲を+4シフトした5~10まで対応）。
      //
      // 【対象範囲外・既知の制限】特殊能力「猛毒の吐瀉」（PCが「状態異常：猛毒」でHP損害を
      // 与えた瞬間、そのターンの防禦フェイズは1Dを振らず自動的に「毒吐き」を強制実行する。
      // 「体勢崩し」発生後は無効）は、通常の出目テーブルの外側で発生する条件付き強制行動のため、
      // 既存のrollMin/rollMax機構では表現できない（demihuman_queen_swordmasterの「棄杖＆流星擊」
      // と同種の未対応パターン）。GMが「状態異常：猛毒」でのHP損害発生を確認した回だけ、下記
      // rows未収録の「毒吐き」（乱戦ダメージ840＆「猛毒：2D」、対象は「敵視：1以上」全員、
      // 該当者無しなら前衛、ガード不可、次アクションフェイズ終了までHP価値－10・最低10）を
      // 手動適用すること。
      rollBonusAfterGuardBreak: 4,
      rows: [
        {
          // 「噛みつき」：「敵視：1以上」で前衛のPC全員に「乱戦ダメージ：3人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「突進」：乱戦ダメージの基本対象はPC全員（前後衛問わず）だが、「敵視：1以上」の
          // 前衛のPCだけ「乱戦ダメージ：2人分」の重み付けを受ける複合ルール。既存のtargetRule
          // 語彙（allPCs／frontAggroAtLeast1All等）はいずれか一方のみしか表現できず、重み付き
          // 混合を表す機構が無いため、targetRuleは設定せず合計傷害値のみ算出し、実際の配分は
          // GMが本文を見て手動で振り分ける（数値を捏造しない、既存のloathed_demon出目1と同種の
          // 扱い）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { value: 1260 },
        },
        {
          // 「拘束噛みつき」：乱戦ダメージは「敵視：最大」のPC1体のみが対象、ガード不可。次の
          // アクションフェイズ終了まで、エネミーに「HP価値：－10（最低10）」する
          // （enemy_hp_value_buffの逆方向のため新設タグenemy_hp_value_debuffを使用、既存の
          // buffタグ同様、記録用のみで現時点ではコードから消費されない）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { value: 600 },
          targetRule: { kind: "aggroMax" },
          conditions: ["no_guard", "enemy_hp_value_debuff"],
        },
        {
          // 「雷噛みつき」：乱戦ダメージ修正の対象明記が本文に無いため既定ルール（前衛均等割り）。
          // 「雷：2D」は属性ダイスのため従来通りGM手動反映（elementAccumはダイスでなく固定値の
          // 場合のみ使用する既存ルール）。次のアクションフェイズ終了まで、エネミーに
          // 「HP価値：＋10（最高100）」する。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「地擦り雷光」：乱戦ダメージの対象明記が本文に無いため既定ルール（前衛均等割り）。
          // 個別効果：「敵視：1以上」で前衛のPC全員に個別ダメージ240（「雷：1D」は属性ダイスの
          // ためGM手動反映）。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { value: 600 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "frontAggroAtLeast1All" } }],
        },
      ],
    },
    "gnoster": {
      // 「夜の識、グノスター」（劇本3「知性之蟲」）：単一形態。特殊能力「行動激化」（體勢崩し
      // 発生後、戦闘終了まで「1D」ではなく「1D＋2」で判定）はmarisと同型
      // （rollBonusAfterGuardBreak:2、出目レンジは1D6=1~6を+2シフトした3~8まで対応。
      // 出目7・8はいずれも體勢崩し後のみ到達）。
      //
      // 【対象範囲外・既知の制限】
      // - 出目5「叫び＆滞空」：HP損害が「■×4」「■×2」表記（規則書のcontext依存プレースホルダー、
      //   docs/CLAUDE.md §19「■は自行発明してはいけない」に該当）のため、groupDamage・
      //   individualDamageともに設定せず、GM手動判定に委ねる（rollMin/rollMaxのみ記録）。
      // - 出目8「合体突進」：乱戦ダメージ360が前衛全員→後衛全員→「敵視：1以上」全員の3回、
      //   それぞれ異なる対象で発生する複合ルール。既存のgroupDamage.repeatは「同一対象へのN回」
      //   専用のため対応できず、targetRuleは設定せず単発分の数値のみ記録する（GMが本文の3対象へ
      //   手動で3回適用する、数値を捏造しない）。
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「押しつぶし＆毒牙の鱗粉」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果：
          // 「敵視：最大」のPC1体に個別ダメージ120（「猛毒：2D」は属性ダイスのためGM手動反映）。
          rollMin: 1,
          rollMax: 1,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「連続挟み込み＆誘導弾」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果
          // （PC人数回実行、既存の「PC人数回実行」解釈を踏襲）：「敵視：1以上」で前衛のPC全員に
          // 個別ダメージ180。個別効果：「敵視：最大」のPC1体に個別ダメージ120（「魔：1D」は
          // 属性ダイスのためGM手動反映）。
          rollMin: 2,
          rollMax: 2,
          individualDamage: [
            { amount: 180, targetRule: { kind: "frontAggroAtLeast1All" } },
            { amount: 120, targetRule: { kind: "aggroMax" } },
          ],
        },
        {
          // 「瓦礫隆起＆掴み攻撃」：乱戦ダメージの対象明記が本文に無いため既定ルール
          // （前衛均等割り）。個別ダメージ240を「敵視：最大」のPC1体に、ガード不可
          // （「猛毒：2D」は属性ダイスのためGM手動反映）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { value: 1020 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「硬化＆魔力弾の雨」：乱戦ダメージの対象明記が本文に無いため既定ルール（前衛均等割り）。
          // 個別効果は判定（敵視:1以上→目標12／それ以外→目標10、運試し）、失敗者に個別ダメージ240
          // （「魔：2D」は属性ダイスのためGM手動反映）。次のアクションフェイズ終了まで、
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
            onFail: { amount: 240 },
          },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「叫び＆滞空」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果のHP損害が
          // 「■×4」「■×2」表記（規則書のcontext依存プレースホルダー、数値を自行発明しない）
          // のため、individualDamageは設定せずGM手動判定に委ねる（後衛全員への「猛毒：1D」＋
          // 次アクションフェイズ開始時スタミナダイス1個減少も同様に手動反映）。
          rollMin: 5,
          rollMax: 5,
        },
        {
          // 「潜航＆毒液」：乱戦ダメージの対象が「敵視：最大の人数が多いエリア（前衛/後衛、
          // 同数ならランダム）」という複合条件で、既存のtargetRule語彙に一致するものが無いため
          // targetRuleは設定せず合計傷害値のみ算出する（GMが本文を見て手動で対象エリアを判定・
          // 振り分ける、数値を捏造しない）。個別効果（対象にならなかったPC全員に「猛毒：1D」）は
          // HP損害を伴わないためindividualDamageは設定しない。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { value: 900 },
        },
        {
          // 「光の柱＆毒まき散らし」：乱戦ダメージは「敵視：最大」のPC1体のみが対象
          // （「魔：2D」は属性ダイスのためGM手動反映）。個別効果（乱戦ダメージの対象にならなかった
          // PC全員に個別ダメージ120＋猛毒）は「対象以外全員」という既存のtargetRule語彙に無い
          // 複合条件のため、individualDamageは設定せずGM手動判定に委ねる。出目7・8は體勢崩し後
          // （1D6+2＝3~8）のみ到達。
          rollMin: 7,
          rollMax: 7,
          groupDamage: { value: 600 },
          targetRule: { kind: "aggroMax" },
        },
        {
          // 「合体突進」：乱戦ダメージ360が前衛全員→後衛全員→「敵視：1以上」全員の3回、それぞれ
          // 異なる対象で発生する複合ルール（「魔：1D」は属性ダイスのためGM手動反映）。既存の
          // groupDamage.repeatは同一対象へのN回専用のため対応できず、targetRuleは設定せず
          // 単発分の数値のみ記録する（GMが本文の3対象へ手動で3回適用する）。
          rollMin: 8,
          rollMax: 8,
          groupDamage: { value: 360 },
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
