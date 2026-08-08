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
  };

  function get(familyId, enemyId) {
    return DATA[familyId + "|" + enemyId] || null;
  }

  window.PriTestEnemyAutoGmData = {
    get: get,
  };
})();
