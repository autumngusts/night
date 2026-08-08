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
  };

  function get(familyId, enemyId) {
    return DATA[familyId + "|" + enemyId] || null;
  }

  window.PriTestEnemyAutoGmData = {
    get: get,
  };
})();
