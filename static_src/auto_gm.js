(function () {
  // 自動化GM Phase 1: 敵の行動ロール・対象選定・ダメージ算出を行う読み取り＋計算専用モジュール。
  // state（c.hp.current、saveState等）への書き込みは一切行わない——night.js側が唯一の書き手
  // であり続ける（game_storage.jsと同じ立ち位置の独立モジュール）。

  var EnemyAutoGmData = window.PriTestEnemyAutoGmData;
  var Enemies = window.PriTestEnemies;
  var BossAutoGmData = window.PriTestBossAutoGmData;
  var BossRulebook = window.PriTestBossRulebook;

  // state.battle.selectedEnemyIdsのキー形式 "familyId|enemyId|level" をパースする。
  function parseSelectedEnemyKey(key) {
    var parts = String(key || "").split("|");
    return { familyId: parts[0], enemyId: parts[1], level: parseInt(parts[2], 10) || 1 };
  }

  // 夜の王用のキー形式 "boss|<bossId>"（night_boss_rulebook.jsのBOSSES[].idと一致）。
  // 通常エネミーの"familyId|enemyId|level"とは別の意味を持つため、"boss|"プレフィックスで
  // 明確に区別する。
  function isBossKey(key) {
    return String(key || "").indexOf("boss|") === 0;
  }

  function parseBossKey(key) {
    return { bossId: String(key || "").slice("boss|".length) };
  }

  function isStructured(key) {
    if (isBossKey(key)) {
      if (!BossAutoGmData) return false;
      return !!BossAutoGmData.get(parseBossKey(key).bossId);
    }
    var parsed = parseSelectedEnemyKey(key);
    return !!EnemyAutoGmData.get(parsed.familyId, parsed.enemyId);
  }

  // キーからボス構造化データ（BossAutoGmData.get()の返り値）を取得する。
  // 通常エネミーのkey（"familyId|enemyId|level"形式）が渡された場合はnullを返す
  // （現状の用途はボスのformLabels等の取得のみのため、通常エネミー側の構造化データ取得は対象外）。
  function getStructuredData(key) {
    if (!isBossKey(key) || !BossAutoGmData) return null;
    return BossAutoGmData.get(parseBossKey(key).bossId) || null;
  }

  // 現在選択中のキーが多形態（グラディウス等、structured.formAware===true）かどうかを返す。
  // night.js側が形態トグルUI（合体形態／分裂形態の切替ボタン）を表示すべきか判定するために使う。
  function isFormAware(key) {
    var structured = getStructuredData(key);
    return !!(structured && structured.formAware);
  }

  function findStructuredRow(rows, rollValue) {
    for (var i = 0; i < rows.length; i++) {
      if (rollValue >= rows[i].rollMin && rollValue <= rows[i].rollMax) return { row: rows[i], index: i };
    }
    return null;
  }

  // 多形態の夜の王（グラディウス等）用：rowsの各要素がrollMin/rollMaxではなく
  // rollRangeByForm: { <formId>: {min,max} | null } を持つ場合に、現在の形態(form)に対応する
  // 範囲とrollValueを照合する（その形態では出現しない行はnullで表現）。
  function findStructuredRowByForm(rows, rollValue, form) {
    for (var i = 0; i < rows.length; i++) {
      var range = rows[i].rollRangeByForm && rows[i].rollRangeByForm[form];
      if (range && rollValue >= range.min && rollValue <= range.max) return { row: rows[i], index: i };
    }
    return null;
  }

  // 夜の王のactionColumns（列見出し、ボスごとに列構成が異なる）から、指定した見出し文言に
  // 一致する列のインデックスを探す。「アクション名」列と「注釈」列の位置はボスによって異なる
  // ため（例：マリスは4列でindex1/3、グラディウスは形態列が2つ増えてindex2/4）、決め打ちせず
  // 動的に解決する。
  function findBossColumnIndex(actionColumns, zhLabel, jaLabel) {
    for (var i = 0; i < actionColumns.length; i++) {
      var col = actionColumns[i];
      if ((col.zh && col.zh === zhLabel) || (col.ja && col.ja === jaLabel)) return i;
    }
    return -1;
  }

  // 敵／夜の王の行動をロール（通常1D6）し、構造化データがあれば一致した行を、常に元の
  // actions配列の該当行（表示用のroll/name/note、常に真実の情報源）を返す。構造化データが
  // 無ければnullを返す。
  //
  // structured.rollOverride === "halfIfNoMobs"（坩堝の騎士の特殊能力「坩堝の双璧」用）：
  // ユーザー確認済みルール：「戦闘開始時に雑兵の有無を確認し、以後は戦闘終了まで継続する」
  // ——雑兵が途中で全滅してmobHpRowsから消えても、最初に確認した判定を使い続ける。
  // battleState.autoGmMobPresentSnapshot[enemyKey]に既存のスナップショットがあればそれを使い、
  // 無ければ現在のmobHpRowsから新規判定してresult.mobPresentSnapshotへ返す
  // （このモジュールはstateを直接書き換えないため、night.js側がresult.mobPresentSnapshotを
  // 見て初回のみstate.battle.autoGmMobPresentSnapshotへ永続化する）。
  function rollEnemyAction(enemyKey, battleState) {
    var isBoss = isBossKey(enemyKey);
    var enemyName, familyBase, structured, actions, level;
    if (isBoss) {
      var bossParsed = parseBossKey(enemyKey);
      var bossInfo = BossRulebook ? BossRulebook.get(bossParsed.bossId) : null;
      structured = BossAutoGmData ? BossAutoGmData.get(bossParsed.bossId) : null;
      if (!bossInfo || !structured) return null;
      enemyName = Enemies.localizedText(bossInfo.name);
      familyBase = null;
      actions = null; // 夜の王のactionsは位置配列（roll/name/dmg/note）のため、rollEnemyAction内では使わない
      level = bossInfo.level || 16;
    } else {
      var parsed = parseSelectedEnemyKey(enemyKey);
      var enemyInfo = Enemies.get(parsed.familyId, parsed.enemyId);
      structured = EnemyAutoGmData.get(parsed.familyId, parsed.enemyId);
      if (!enemyInfo || !structured) return null;
      enemyName = Enemies.localizedText(enemyInfo.enemy.name);
      familyBase = enemyInfo.familyBase;
      actions = enemyInfo.enemy.actions;
      level = parsed.level;
    }

    var rollValue;
    var mobPresentSnapshot = null;
    if (structured.rollOverride === "halfIfNoMobs") {
      var existing =
        battleState && battleState.autoGmMobPresentSnapshot ? battleState.autoGmMobPresentSnapshot[enemyKey] : undefined;
      var mobPresent =
        typeof existing === "boolean" ? existing : !!(battleState && battleState.mobHpRows && battleState.mobHpRows.length > 0);
      mobPresentSnapshot = mobPresent;
      var rawRoll = 1 + Math.floor(Math.random() * 6);
      rollValue = mobPresent ? rawRoll : Math.max(1, Math.floor(rawRoll / 2));
    } else {
      rollValue = 1 + Math.floor(Math.random() * 6);
    }

    // マリスの特殊能力「行動激化」のような「體勢崩潰（体勢崩し）発生後、戦闘終了まで
    // 行動決定が1Dではなく1D＋Nで行われる」ルール用（structured.rollBonusAfterGuardBreak、
    // ユーザー確認済み：battleState.guardBroken＝どのHP行でも最初に0へ到達した瞬間trueになる
    // 戦闘終了までの持続フラグ、night.js側で管理）。halfIfNoMobsとは同時使用されない前提。
    if (structured.rollBonusAfterGuardBreak && battleState && battleState.guardBroken) {
      rollValue += structured.rollBonusAfterGuardBreak;
    }

    // グラディウスのような多形態ボス（structured.formAware===true）は、現在の形態
    // （battleState.bossForm、既定"fused"）に応じて別々の出目範囲を持つ行を照合する。
    var currentForm = (battleState && battleState.bossForm) || "fused";
    var match = structured.formAware
      ? findStructuredRowByForm(structured.rows, rollValue, currentForm)
      : findStructuredRow(structured.rows, rollValue);
    var originalRow = null;
    if (match) {
      if (isBoss) {
        var bossData = BossRulebook.get(parseBossKey(enemyKey).bossId);
        var rawRow = bossData.actions[match.index];
        var nameIdx = findBossColumnIndex(bossData.actionColumns, "招式名稱", "アクション名");
        var noteIdx = findBossColumnIndex(bossData.actionColumns, "備註", "注釈");
        originalRow = {
          name: nameIdx !== -1 ? rawRow[nameIdx] : rawRow[rawRow.length - 2],
          note: noteIdx !== -1 ? rawRow[noteIdx] : rawRow[rawRow.length - 1],
        };
      } else {
        originalRow = actions[match.index] || null;
      }
    }
    return {
      enemyKey: enemyKey,
      isBoss: isBoss,
      level: level,
      enemyName: enemyName,
      familyBase: familyBase,
      rollValue: rollValue,
      currentForm: structured.formAware ? currentForm : null,
      mobPresentSnapshot: mobPresentSnapshot,
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

  // 最終「乱戰傷害」＝ base（＋Time Loss＋override、下記）。
  // 通常エネミー：base = family.base[level].dmg（規則書のレベル別基準値）＋groupDamage.modifier
  //   （この行動固有の修正値）。
  // 夜の王：actionColumnsの「乱戦ダメージ」列がそのまま最終値のため、groupDamage.value（直接値）
  //   をbaseとして使う（modifierによる加算は行わない）——rollResult.isBossで判別する。
  //                 ＋ Time Loss側の骰效果（rollEffects.enemy_damage）
  //                 ＋ state.battle.enemyDmgOverride（PC技能による減少・敵人特殊行動による増加、
  //                    睡眠トリガー等で既に累積されている値、night.js側から解決済みの数値で渡す）
  // 内訳を返すことで、GMが確定前に「なぜこの数字になったか」を検証できるようにする。
  // groupDamage.repeat（例：「乱戦ダメージは2回発生する」）が指定されている場合、
  // 1回分（base+timeLoss+override）をrepeat回分まとめた合計を返す——本文が
  // 「同じ乱戦ダメージがN回発生する」という意味で、1回ごとに毎回Time Loss/その他調整も
  // 乗るという解釈（this行動が発生させる「亂戰傷害」という値そのものがN回発生するため）。
  function computeGroupDamage(rollResult, rollEffects, enemyDmgOverride) {
    if (!rollResult || !rollResult.structuredRow || !rollResult.structuredRow.groupDamage) return null;
    var gd = rollResult.structuredRow.groupDamage;
    var base, modifier;
    if (rollResult.isBoss) {
      base = gd.value || 0;
      modifier = 0;
    } else {
      var baseEntry = (rollResult.familyBase || []).filter(function (b) {
        return b.level === rollResult.level;
      })[0];
      base = baseEntry ? baseEntry.dmg : 0;
      modifier = gd.modifier || 0;
    }
    var timeLoss = timeLossGroupBonus(rollEffects);
    var override = enemyDmgOverride || 0;
    var repeat = gd.repeat || 1;
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

  // 個別ダメージ＝ (元の固定値（enemy_auto_gm_data.jsのamount）＋ Time Loss側の骰效果
  // （個別分はrollEffects.enemy_damage * 20）) × repeat（例：「2回実行」）。
  // enemyDmgOverrideは「亂戰傷害」専用のため個別ダメージには適用しない
  // （既存コードの命名・コメントに合わせた解釈）。groupDamage.repeatと同じ設計判断
  // （1回分にTime Lossも乗せてからrepeat回分をまとめる）。
  function computeIndividualDamage(entry, rollEffects) {
    var timeLoss = timeLossIndividualBonus(rollEffects);
    var repeat = entry.repeat || 1;
    var perHit = entry.amount + timeLoss;
    return { total: perHit * repeat, base: entry.amount, timeLoss: timeLoss, repeat: repeat, perHit: perHit };
  }

  // 「亂戰傷害：N人份」の加重配分（ユーザー確認済みルール）：
  // 「N人份」と明記された対象は重みN、それ以外の（同じ攻撃で別条件により対象になった）PCは
  // 重み1として、傷害池を「合計重み」で割った単位値に各自の重みを掛けて配分する
  // （例：480の傷害池、重み2の対象1人＋重み1の対象1人＝合計重み3、480/3×2=320／480/3×1=160）。
  //
  // 現時点で保持している構造化データは全対象が同一targetRuleから解決される「単一重みグループ」
  // のみ（例: liege_army「群がる」は対象PC全員が同じく「2人份」）。この場合は数学的に
  // 「重みが全員同じなら均等割りと同じ」（n×w／(n×w)＝1／n）ため、targetRule.perPersonShare
  // は現状ドキュメント目的のみで、実際の配分は対象人数での均等割りとして計算する。
  // 将来、異なる重みの対象グループが同時に発生する行が出てきた場合は、
  // groupDamage.targetRule を配列化する等の拡張が必要になる（今は使用例が無いため未実装）。
  function splitGroupShares(total, targetCount) {
    if (!targetCount) return [];
    var share = total / targetCount;
    var shares = [];
    for (var i = 0; i < targetCount; i++) shares.push(share);
    return shares;
  }

  // 「乱戦ダメージはPC全員が対象、ただし◯◯条件を満たすPCはn人分の加重を受ける」パターン
  // （edele「突進」等）：targetRule.weightRuleが指定されている場合、resolveTargetsで得た
  // 候補のうち、weightRule.kindの条件を満たすPCはweightRule.weight、それ以外は1として
  // 各PCの重みを返す。
  function matchesWeightCondition(kind, battleState, idx) {
    var aggro = (battleState.aggro && battleState.aggro[idx]) || 0;
    var front = !!(battleState.front && battleState.front[idx]);
    if (kind === "frontAggroAtLeast1") return front && aggro >= 1;
    // harmonia「瞬間移動＆乱舞」用：基準の対象群がbackAll（後衛のPC全員）のため、
    // frontAggroAtLeast1（前衛限定）では後衛PCは常にfront===falseとなり誤って
    // 全員weight1になってしまう。前衛／後衛を問わず「敵視：1以上」のみを条件とする
    // 種別を追加する（既存のfrontAggroAtLeast1の挙動は変更しない）。
    if (kind === "aggroAtLeast1") return aggro >= 1;
    return false;
  }

  function resolveWeightedTargets(targetRule, battleState, rosterCount) {
    var candidates = resolveTargets(targetRule, battleState, rosterCount);
    var weightRule = targetRule.weightRule;
    return candidates.map(function (idx) {
      var weight = weightRule && matchesWeightCondition(weightRule.kind, battleState, idx) ? weightRule.weight : 1;
      return { index: idx, weight: weight };
    });
  }

  // 加重版のsplitGroupShares：合計重みで傷害池を割り、各対象の重み分を掛けて配分する
  // （通常のsplitGroupSharesは全員重み1固定の特殊ケースに相当）。
  function splitGroupSharesWeighted(total, weightedTargets) {
    var totalWeight = weightedTargets.reduce(function (sum, t) {
      return sum + t.weight;
    }, 0);
    if (!totalWeight) return weightedTargets.map(function () { return 0; });
    var unit = total / totalWeight;
    return weightedTargets.map(function (t) {
      return unit * t.weight;
    });
  }

  // targetRuleを実際のbattle状態（front/back/aggro）に照らして対象PCのroster配列indexへ解決する。
  // fallback（例："front"）は、本来の条件に該当するPCが1人もいない場合に本文が明記している
  // 代替対象（例：「対象となるPCが1人もいない場合は、通常どおり、前衛が対象となる」）を表す。
  function resolveTargets(targetRule, battleState, rosterCount) {
    if (!targetRule || !battleState) return [];
    // 「敵視:最大のPCが多いエリア（前衛/後衛）全員」パターン（gnoster「潜航＆毒液」等）：
    // 他のkindのように1PCずつ判定するループでは表現できない（先に全体の敵視最大値と
    // 前衛/後衛の人数比較が必要）ため、専用の早期returnで処理する。
    if (targetRule.kind === "majorityAreaAggroMax") {
      var allAggro = [];
      for (var a = 0; a < rosterCount; a++) allAggro.push((battleState.aggro && battleState.aggro[a]) || 0);
      var maxAggroValue = allAggro.length ? Math.max.apply(null, allAggro) : 0;
      var maxAggroIdxs = [];
      for (var b = 0; b < rosterCount; b++) if (allAggro[b] === maxAggroValue) maxAggroIdxs.push(b);
      var frontCount = 0;
      var backCount = 0;
      maxAggroIdxs.forEach(function (idx) {
        if (battleState.front && battleState.front[idx]) frontCount++;
        else backCount++;
      });
      var chooseFront = frontCount === backCount ? Math.random() < 0.5 : frontCount > backCount;
      var areaResult = [];
      for (var d = 0; d < rosterCount; d++) {
        var isFrontD = !!(battleState.front && battleState.front[d]);
        if (isFrontD === chooseFront) areaResult.push(d);
      }
      return areaResult;
    }
    var candidates = [];
    for (var i = 0; i < rosterCount; i++) {
      var aggro = (battleState.aggro && battleState.aggro[i]) || 0;
      var front = !!(battleState.front && battleState.front[i]);
      if (targetRule.kind === "frontAggroAtLeast1All") {
        if (front && aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "aggroAtLeast1All") {
        if (aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "frontAll") {
        // ユーザー確認済みの既定ルール: 行動本文に亂戰傷害の分配対象が明記されていない場合、
        // 前衛の全員で均等割りする（規則書「乱戦ダメージ：n人」の一般ルールに対する既定値）。
        if (front) candidates.push(i);
      } else if (targetRule.kind === "backAll") {
        if (!front) candidates.push(i);
      } else if (targetRule.kind === "aggroMax" || targetRule.kind === "frontAggroMaxAll") {
        if (targetRule.kind === "aggroMax" || front) candidates.push(i);
      } else if (targetRule.kind === "backAll") {
        // frontAllの対称形：「乱戦ダメージは前衛ではなく後衛が対象」という本文明記のケース用
        // （例: strong_type|divine_skin_apostles「黒炎投擲」）。fallback:"front"と組み合わせて
        // 「後衛が対象、後衛不在なら前衛」を表現する。
        if (!front) candidates.push(i);
      } else if (targetRule.kind === "allPCs") {
        candidates.push(i);
      }
    }
    if ((targetRule.kind === "aggroMax" || targetRule.kind === "frontAggroMaxAll") && candidates.length) {
      // "frontAggroMaxAll"（例: 坩堝の騎士「薙ぎ払い」前衛の中で敵視最大の全員）は候補を
      // 前衛に絞った上で最大値判定する。"aggroMax"は前衛・後衛を問わず全体で最大値判定する。
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

  // individualDamage.distribution === "rotate" 用：本文が「対象PC1体（不特定）」＋
  // 「N回実行」の場合のユーザー確認済みルール——「条件を満たす対象の中で輪流受傷、最初の対象は
  // ランダム」。targetRuleで解決した候補群から、ランダムな開始位置を1つ選び、そこから
  // ラウンドロビンでrepeat回分のヒットを分配する（候補が1人しかいなければその1人が全て受ける）。
  // 戻り値: [{ index: rosterIndex, hits: N }]（PCごとの被弾回数）。
  function resolveRotatedHits(targetRule, battleState, rosterCount, repeat) {
    var candidates = resolveTargets(targetRule, battleState, rosterCount);
    if (!candidates.length) return [];
    var startOffset = Math.floor(Math.random() * candidates.length);
    var hitCounts = {};
    for (var i = 0; i < repeat; i++) {
      var idx = candidates[(startOffset + i) % candidates.length];
      hitCounts[idx] = (hitCounts[idx] || 0) + 1;
    }
    return Object.keys(hitCounts).map(function (key) {
      return { index: parseInt(key, 10), hits: hitCounts[key] };
    });
  }

  // 判定（運試し／フィジカル／メンタル）：既存の判定發生（night_floor_breakthrough.js）と
  // 同じ「type.checkValues[stat]＋遺物効果補正の個数分1D6を振り合計する」方式を再利用する
  // （加護による重骰は行わない——ユーザー確認済み：「不能做加護變更」）。targetがPCごとに
  // 条件で変わる場合（例：敵視の有無で難易度が変わる）はtargetByConditionで指定する。
  function resolveSavingThrow(savingThrow, rosterCharacters, battleState, CharacterTypes, CharacterDrawer) {
    var entered = (rosterCharacters || []).filter(function (c) {
      return c.entered;
    });
    // targetFilterが指定されている場合（例：「敵視:1以上」PCのみが判定を行う「赤雷叩きつけ」型）、
    // 条件を満たさないPCはそもそも判定対象に含めない（全PCプール前提のtargetByConditionとは
    // 別の絞り込み軸）。indexは元のentered配列上のインデックスを維持する。
    var filterKind = savingThrow.targetFilter && savingThrow.targetFilter.kind;
    var filtered = entered
      .map(function (c, idx) {
        return { c: c, idx: idx };
      })
      .filter(function (pair) {
        if (!filterKind) return true;
        var aggro = (battleState && battleState.aggro && battleState.aggro[pair.idx]) || 0;
        if (filterKind === "aggroAtLeast1") return aggro >= 1;
        return true;
      });
    return filtered.map(function (pair) {
      var c = pair.c;
      var idx = pair.idx;
      var aggro = (battleState && battleState.aggro && battleState.aggro[idx]) || 0;
      var rule = savingThrow.targetByCondition.filter(function (r) {
        if (r.condition.kind === "aggroAtLeast1") return aggro >= 1;
        return r.condition.kind === "default";
      })[0];
      var target = rule ? rule.target : savingThrow.targetByCondition[savingThrow.targetByCondition.length - 1].target;
      var type = c.typeId && CharacterTypes ? CharacterTypes.get(c.typeId) : null;
      var diceCount = type && type.checkValues ? type.checkValues[savingThrow.stat] || 0 : 0;
      var bonus = CharacterDrawer && CharacterDrawer.getCheckStatBonus ? CharacterDrawer.getCheckStatBonus(c, savingThrow.stat) : 0;
      diceCount = Math.max(0, diceCount + bonus);
      var dice = [];
      for (var i = 0; i < diceCount; i++) dice.push(1 + Math.floor(Math.random() * 6));
      var sum = dice.reduce(function (a, b) {
        return a + b;
      }, 0);
      var passed = sum >= target;
      return {
        index: idx,
        name: c.name,
        dice: dice,
        sum: sum,
        target: target,
        passed: passed,
      };
    });
  }

  window.PriTestAutoGm = {
    isStructured: isStructured,
    isFormAware: isFormAware,
    getStructuredData: getStructuredData,
    rollEnemyAction: rollEnemyAction,
    computeGroupDamage: computeGroupDamage,
    splitGroupShares: splitGroupShares,
    resolveWeightedTargets: resolveWeightedTargets,
    splitGroupSharesWeighted: splitGroupSharesWeighted,
    computeIndividualDamage: computeIndividualDamage,
    resolveTargets: resolveTargets,
    resolveRotatedHits: resolveRotatedHits,
    resolveSavingThrow: resolveSavingThrow,
  };
})();
