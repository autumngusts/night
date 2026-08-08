(function () {
  // 自動化GM Phase 1 試験対象：シナリオ1「三首獸／Tricephalos」で最頻出のsoldier_knight/liege_army
  // （君主軍たち）。enemies_data_*.js本体は書き換えず、加算的なオーバーレイとしてここに保持する。
  //
  // データ形状: "familyId|enemyId" → { rows: [...] }。rows配列は該当エネミーのactions配列と
  // 同じ並び順に対応させる運用ルール（rollMin/rollMaxは元のroll文字列の範囲と必ず一致させ、
  // 転記ミスを防ぐため目視確認のうえ追加すること）。
  //
  // groupDamage.modifier: 「亂戰傷害」の最終値は、そのエネミーのレベルに応じたfamily.base[level].dmg
  // （規則書の基礎データ表のレベル別基準値）に、この行の修正値を加算して算出する（規則書の
  // 「±0」「＋60」等の表記は基準値に対する修正、という規則に合わせた設計）。
  //
  // individualDamage: 個別ダメージが発生する行のみ設定する（無い行は省略）。
  //
  // groupDamage/individualDamageのどちらも設定しない行（例: PCへのHP損害が発生せず、敵人の
  // バフや体力骰減少などdmg以外の効果のみの行）は意図的に未構造化のまま——ロール自体は自動化
  // されるが、金額の事前入力対象が無いのが正しい状態のため、conditionsタグで内容を示すのみとする。
  var DATA = {
    "soldier_knight|liege_army": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」を割り振る。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「連続斬り」：「敵視:最大」のPC1体に個別ダメージ180（乱戦ダメージ側は修正±0＝発生無し）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「踏み込み＆盾ガード」：PCへのHP損害は発生しない（敵HP価値バフ＋次フェイズの
          // 体力骰減少のみ）。ロール自体は自動化するが、ダメージ事前入力の対象は無い。
          rollMin: 5,
          rollMax: 6,
          conditions: ["enemy_hp_value_buff", "stamina_dice_reduction_next_phase"],
        },
      ],
    },
    "big_dog_bear|old_lions": {
      rows: [
        {
          // 「連続噛みつき」：亂戰傷害は2回発生する。対象PCの指定が本文に明記されていないため
          // targetRuleは未設定のまま（算出値は表示するが、対象への事前入力は行わない
          // ——GMが対象を確認して手動で反映する）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -300, repeat: 2 },
        },
        {
          // 「飛びかかり＆翻り」：PCへのHP損害は発生しない（敵HP価値バフ＋特殊能力「翻り」のみ）。
          rollMin: 3,
          rollMax: 4,
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
          // 「駆け込み斬り」：「敵視:1以上」のPC全員（前衛限定の記載なし）に「乱戦ダメージ:2人分」。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「掴み攻撃」：「敵視:最大」のPC1体に個別ダメージ240。この効果はガード不可（表示用タグのみ、
          // 実際のガード可否判定はGM/プレイヤーの手動確認に委ねる）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「武器振り回し」：「敵視:最大」のPC1体に個別ダメージ120。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
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
