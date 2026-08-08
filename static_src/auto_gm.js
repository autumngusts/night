(function () {
  // 自動化GM Phase 1: 敵の行動ロール・対象選定・ダメージ算出を行う読み取り＋計算専用モジュール。
  // state（c.hp.current、saveState等）への書き込みは一切行わない——night.js側が唯一の書き手
  // であり続ける（game_storage.jsと同じ立ち位置の独立モジュール）。

  var EnemyAutoGmData = window.PriTestEnemyAutoGmData;
  var Enemies = window.PriTestEnemies;

  function parseSelectedEnemyKey(key) {
    // state.battle.selectedEnemyIdsのキー形式 "familyId|enemyId|level" をパースする。
    var parts = String(key || "").split("|");
    return { familyId: parts[0], enemyId: parts[1], level: parseInt(parts[2], 10) || 1 };
  }

  function isStructured(enemyKey) {
    var parsed = parseSelectedEnemyKey(enemyKey);
    return !!EnemyAutoGmData.get(parsed.familyId, parsed.enemyId);
  }

  function findStructuredRow(rows, rollValue) {
    for (var i = 0; i < rows.length; i++) {
      if (rollValue >= rows[i].rollMin && rollValue <= rows[i].rollMax) return { row: rows[i], index: i };
    }
    return null;
  }

  // 敵の行動をロール（1D6）し、構造化データがあれば一致した行を、常に元のactions配列の該当行
  // （表示用のroll/name/note、常に真実の情報源）を返す。構造化データが無ければnullを返す。
  function rollEnemyAction(enemyKey) {
    var parsed = parseSelectedEnemyKey(enemyKey);
    var enemyInfo = Enemies.get(parsed.familyId, parsed.enemyId);
    var structured = EnemyAutoGmData.get(parsed.familyId, parsed.enemyId);
    if (!enemyInfo || !structured) return null;
    var rollValue = 1 + Math.floor(Math.random() * 6);
    var match = findStructuredRow(structured.rows, rollValue);
    var originalRow = match && enemyInfo.enemy.actions[match.index] ? enemyInfo.enemy.actions[match.index] : null;
    return {
      enemyKey: enemyKey,
      familyId: parsed.familyId,
      enemyId: parsed.enemyId,
      level: parsed.level,
      enemyName: Enemies.localizedText(enemyInfo.enemy.name),
      familyBase: enemyInfo.familyBase,
      rollValue: rollValue,
      structuredRow: match ? match.row : null,
      originalRow: originalRow,
    };
  }

  // rollEffects.enemy_damage（Time Loss側の骰效果、tier0-4）を「亂戰＋tier*60／個別＋tier*20」
  // という規則書記載の固定値に変換する（roll_effect_enemy_damage_tier1〜4のi18n文言と一致させた
  // 数値、site_src/i18n_data_zh.py参照）。
  function timeLossGroupBonus(rollEffects) {
    return ((rollEffects && rollEffects.enemy_damage) || 0) * 60;
  }

  function timeLossIndividualBonus(rollEffects) {
    return ((rollEffects && rollEffects.enemy_damage) || 0) * 20;
  }

  // 最終「乱戰傷害」＝ family.base[level].dmg（規則書のレベル別基準値）
  //                 ＋ groupDamage.modifier（この行動固有の修正値）
  //                 ＋ Time Loss側の骰效果（rollEffects.enemy_damage）
  //                 ＋ state.battle.enemyDmgOverride（PC技能による減少・敵人特殊行動による増加、
  //                    睡眠トリガー等で既に累積されている値、night.js側から解決済みの数値で渡す）
  // 内訳を返すことで、GMが確定前に「なぜこの数字になったか」を検証できるようにする。
  // groupDamage.repeat（例：「乱戦ダメージは2回発生する」）が指定されている場合、
  // 1回分（base+modifier+timeLoss+override）をrepeat回分まとめた合計を返す——本文が
  // 「同じ乱戦ダメージがN回発生する」という意味で、1回ごとに毎回Time Loss/その他調整も
  // 乗るという解釈（this行動が発生させる「亂戰傷害」という値そのものがN回発生するため）。
  function computeGroupDamage(rollResult, rollEffects, enemyDmgOverride) {
    if (!rollResult || !rollResult.structuredRow || !rollResult.structuredRow.groupDamage) return null;
    var baseEntry = (rollResult.familyBase || []).filter(function (b) {
      return b.level === rollResult.level;
    })[0];
    var base = baseEntry ? baseEntry.dmg : 0;
    var modifier = rollResult.structuredRow.groupDamage.modifier;
    var timeLoss = timeLossGroupBonus(rollEffects);
    var override = enemyDmgOverride || 0;
    var repeat = rollResult.structuredRow.groupDamage.repeat || 1;
    var perHit = base + modifier + timeLoss + override;
    return {
      total: perHit * repeat,
      base: base,
      modifier: modifier,
      timeLoss: timeLoss,
      override: override,
      repeat: repeat,
      perHit: perHit,
    };
  }

  // 個別ダメージ＝ 元の固定値（enemy_auto_gm_data.jsのamount）＋ Time Loss側の骰效果
  // （個別分はrollEffects.enemy_damage * 20）。enemyDmgOverrideは「亂戰傷害」専用のため
  // 個別ダメージには適用しない（既存コードの命名・コメントに合わせた解釈）。
  function computeIndividualDamage(entry, rollEffects) {
    var timeLoss = timeLossIndividualBonus(rollEffects);
    return { total: entry.amount + timeLoss, base: entry.amount, timeLoss: timeLoss };
  }

  // targetRuleを実際のbattle状態（front/back/aggro）に照らして対象PCのroster配列indexへ解決する。
  // fallback（例："front"）は、本来の条件に該当するPCが1人もいない場合に本文が明記している
  // 代替対象（例：「対象となるPCが1人もいない場合は、通常どおり、前衛が対象となる」）を表す。
  function resolveTargets(targetRule, battleState, rosterCount) {
    if (!targetRule || !battleState) return [];
    var candidates = [];
    for (var i = 0; i < rosterCount; i++) {
      var aggro = (battleState.aggro && battleState.aggro[i]) || 0;
      var front = !!(battleState.front && battleState.front[i]);
      if (targetRule.kind === "frontAggroAtLeast1All") {
        if (front && aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "aggroAtLeast1All") {
        if (aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "aggroMax") {
        candidates.push(i);
      } else if (targetRule.kind === "allPCs") {
        candidates.push(i);
      }
    }
    if (targetRule.kind === "aggroMax" && candidates.length) {
      var maxAggro = Math.max.apply(
        null,
        candidates.map(function (i) {
          return (battleState.aggro && battleState.aggro[i]) || 0;
        })
      );
      candidates = candidates.filter(function (i) {
        return ((battleState.aggro && battleState.aggro[i]) || 0) === maxAggro;
      });
    }
    if (!candidates.length && targetRule.fallback === "front") {
      for (var j = 0; j < rosterCount; j++) {
        if (battleState.front && battleState.front[j]) candidates.push(j);
      }
    }
    return candidates;
  }

  window.PriTestAutoGm = {
    isStructured: isStructured,
    rollEnemyAction: rollEnemyAction,
    computeGroupDamage: computeGroupDamage,
    computeIndividualDamage: computeIndividualDamage,
    resolveTargets: resolveTargets,
  };
})();
