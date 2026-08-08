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

  // 構造化されたgroupDamage.modifierから最終「乱戰傷害」を算出する:
  // family.base[level].dmg（規則書のレベル別基準値）＋ modifier。
  function computeGroupDamage(rollResult) {
    if (!rollResult || !rollResult.structuredRow || !rollResult.structuredRow.groupDamage) return null;
    var baseEntry = (rollResult.familyBase || []).filter(function (b) {
      return b.level === rollResult.level;
    })[0];
    var base = baseEntry ? baseEntry.dmg : 0;
    return base + rollResult.structuredRow.groupDamage.modifier;
  }

  // targetRuleを実際のbattle状態（front/back/aggro）に照らして対象PCのroster配列indexへ解決する。
  function resolveTargets(targetRule, battleState, rosterCount) {
    if (!targetRule || !battleState) return [];
    var candidates = [];
    for (var i = 0; i < rosterCount; i++) {
      var aggro = (battleState.aggro && battleState.aggro[i]) || 0;
      var front = !!(battleState.front && battleState.front[i]);
      if (targetRule.kind === "frontAggroAtLeast1All") {
        if (front && aggro >= 1) candidates.push(i);
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
    return candidates;
  }

  window.PriTestAutoGm = {
    isStructured: isStructured,
    rollEnemyAction: rollEnemyAction,
    computeGroupDamage: computeGroupDamage,
    resolveTargets: resolveTargets,
  };
})();
