// 令和之野望（reiwa）：遊戲引擎（state 初始化、回合制行動、內政／外交／伐掠戰鬥、簡易 AI、存讀檔）。
// 畫面渲染與事件綁定在 reiwa.js；靜態資料（地圖／勢力／武將／兵種）在 reiwa_data.js。
(function () {
  "use strict";

  var D = window.PriTestReiwaData;

  var TROOPS_PER_KOKU = 8;
  var CASUALTY_RATE = 0.18;
  var GENERAL_APTITUDE_BONUS = 1.25;
  var DEFENSE_LEVEL_REDUCTION = 0.08;
  var DEFENSE_LEVEL_MAX = 3;
  var PLUNDER_RATE = 0.5;
  var PLAYER_ACTION_POINTS = 3;
  var AI_ACTIONS_PER_TURN = 2;
  var AI_ATTACK_RATIO = 1.15;
  var AI_MIN_ATTACK_FORCE = 30;
  var AI_COMMIT_FRACTION = 0.7;

  var DEVELOP_COST_GOLD = 40;
  var DEVELOP_KOKUDAKA_GAIN = 6;
  var FORTIFY_COST_GOLD = 50;
  var RECRUIT_GOLD_PER_UNIT = 3;
  var RECRUIT_FOOD_PER_UNIT = 2;
  var RECRUIT_MAX_PER_ACTION = 60;

  var SAVE_KEY = "pritest-reiwa-save";

  function totalTroops(troops) {
    var sum = 0;
    D.TROOP_ORDER.forEach(function (t) {
      sum += troops[t] || 0;
    });
    return sum;
  }

  function emptyTroops() {
    var o = {};
    D.TROOP_ORDER.forEach(function (t) {
      o[t] = 0;
    });
    return o;
  }

  function getNodeMaxTroops(node) {
    return Math.round(node.kokudaka * TROOPS_PER_KOKU);
  }

  function relationKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function getRelation(state, a, b) {
    if (a === b) return 100;
    return state.relations[relationKey(a, b)] || 0;
  }

  function setRelation(state, a, b, value) {
    if (a === b) return;
    state.relations[relationKey(a, b)] = Math.max(-100, Math.min(100, value));
  }

  function isAllied(state, a, b) {
    return state.factions[a].alliances.indexOf(b) !== -1;
  }

  // ---- 初始化 ----

  function createInitialState(playerFactionId) {
    var state = {
      version: 1,
      turn: 1,
      playerFaction: playerFactionId,
      actionPoints: PLAYER_ACTION_POINTS,
      actionPointsMax: PLAYER_ACTION_POINTS,
      factions: {},
      nodes: {},
      generalStatus: {},
      relations: {},
      log: [],
      _ai: null,
      _pendingAiAttack: null,
      gameOver: null,
    };

    D.FACTION_ORDER.forEach(function (fid) {
      state.factions[fid] = {
        id: fid,
        alive: true,
        gold: 150,
        food: 150,
        alliances: [],
      };
      D.generalsOfFaction(fid).forEach(function (g) {
        state.generalStatus[g.id] = { committedTurn: null };
      });
    });

    D.NODES.forEach(function (node) {
      var kokudaka = D.KOKUDAKA_BY_PROFILE[node.profile];
      var weights = D.PROFILE_WEIGHTS[node.profile];
      var maxTroops = Math.round(kokudaka * TROOPS_PER_KOKU);
      var weightSum = weights.reduce(function (a, b) {
        return a + b;
      }, 0);
      var troops = emptyTroops();
      D.TROOP_ORDER.forEach(function (t, i) {
        troops[t] = Math.round((maxTroops * weights[i]) / weightSum);
      });
      state.nodes[node.id] = {
        id: node.id,
        owner: node.faction,
        kokudaka: kokudaka,
        defenseLevel: node.profile === "capital" ? 1 : 0,
        troops: troops,
      };
    });

    pushLog(state, "rw_log_game_start", { faction: playerFactionId });
    return state;
  }

  function pushLog(state, key, params) {
    state.log.push({ turn: state.turn, key: key, params: params || {} });
    if (state.log.length > 200) state.log.shift();
  }

  // ---- 共用查詢 ----

  function ownedNodes(state, factionId) {
    return D.NODES.filter(function (n) {
      return state.nodes[n.id].owner === factionId;
    });
  }

  function availableGenerals(state, factionId) {
    return D.generalsOfFaction(factionId).filter(function (g) {
      return state.generalStatus[g.id].committedTurn !== state.turn;
    });
  }

  function canInvade(state, factionId, sourceNodeId, targetNodeId) {
    var src = state.nodes[sourceNodeId];
    var tgt = state.nodes[targetNodeId];
    if (!src || !tgt) return false;
    if (src.owner !== factionId) return false;
    if (tgt.owner === factionId) return false;
    if (isAllied(state, factionId, tgt.owner)) return false;
    return D.neighborsOf(sourceNodeId).indexOf(targetNodeId) !== -1;
  }

  function cappedSlotAmounts(slots, pool) {
    // 把每格指派的數量限制在來源部隊目前擁有的數量以內
    var used = {};
    return slots.map(function (slot) {
      if (!slot || !slot.type || !slot.amount) return { type: null, amount: 0 };
      var already = used[slot.type] || 0;
      var avail = Math.max(0, (pool[slot.type] || 0) - already);
      var amount = Math.max(0, Math.min(slot.amount, avail));
      used[slot.type] = already + amount;
      return { type: slot.type, amount: amount };
    });
  }

  // ---- 戰鬥結算 ----

  function resolveBattleCore(state, ctx) {
    var attackerNode = state.nodes[ctx.sourceNodeId];
    var defenderNode = state.nodes[ctx.targetNodeId];
    var attackerGeneral = ctx.attackerGeneralId ? D.generalById(ctx.attackerGeneralId) : null;
    var defenderGeneral = ctx.defenderGeneralId ? D.generalById(ctx.defenderGeneralId) : null;

    var attackerSlots = cappedSlotAmounts(ctx.attackerSlots, attackerNode.troops);
    var defenderSlots = cappedSlotAmounts(ctx.defenderSlots, defenderNode.troops);

    var defenseMul = 1 - Math.min(defenderNode.defenseLevel, DEFENSE_LEVEL_MAX) * DEFENSE_LEVEL_REDUCTION;
    var rounds = [];
    var attackerLossByType = emptyTroops();
    var defenderLossByType = emptyTroops();

    for (var i = 0; i < 5; i++) {
      var aSlot = attackerSlots[i] || { type: null, amount: 0 };
      var dSlot = defenderSlots[i] || { type: null, amount: 0 };
      if (!aSlot.type && !dSlot.type) continue;

      var mulA = aSlot.type && dSlot.type ? D.matchupMultiplier(aSlot.type, dSlot.type) : 1;
      var mulD = aSlot.type && dSlot.type ? D.matchupMultiplier(dSlot.type, aSlot.type) : 1;
      if (attackerGeneral && attackerGeneral.aptitude === aSlot.type) mulA *= GENERAL_APTITUDE_BONUS;
      if (defenderGeneral && defenderGeneral.aptitude === dSlot.type) mulD *= GENERAL_APTITUDE_BONUS;

      var powerA = aSlot.amount * mulA * defenseMul;
      var powerD = dSlot.amount * mulD;

      var lossD = Math.min(dSlot.amount, Math.round(powerA * CASUALTY_RATE));
      var lossA = Math.min(aSlot.amount, Math.round(powerD * CASUALTY_RATE));

      if (aSlot.type) attackerLossByType[aSlot.type] += lossA;
      if (dSlot.type) defenderLossByType[dSlot.type] += lossD;

      rounds.push({
        slot: i,
        attackerType: aSlot.type,
        attackerAmount: aSlot.amount,
        defenderType: dSlot.type,
        defenderAmount: dSlot.amount,
        attackerLoss: lossA,
        defenderLoss: lossD,
      });
    }

    // 套用損耗：攻方損耗從出征部隊扣除（倖存者歸還來源城），守方損耗直接扣在守城部隊上
    attackerSlots.forEach(function (slot) {
      if (!slot.type) return;
      attackerNode.troops[slot.type] = Math.max(0, attackerNode.troops[slot.type] - attackerLossByType[slot.type]);
    });
    // 逐格計算倖存數（避免同類型多格相加誤差）
    var survivorsByType = emptyTroops();
    attackerSlots.forEach(function (slot, idx) {
      if (!slot.type) return;
      var r = rounds.filter(function (rr) {
        return rr.slot === idx;
      })[0];
      survivorsByType[slot.type] += slot.amount - (r ? r.attackerLoss : 0);
    });

    defenderSlots.forEach(function (slot) {
      if (!slot.type) return;
      defenderNode.troops[slot.type] = Math.max(0, defenderNode.troops[slot.type] - defenderLossByType[slot.type]);
    });

    var attackerRemainingTotal = totalTroops(survivorsByType);
    var defenderNodeRemainingTotal = totalTroops(defenderNode.troops);

    var captured = attackerRemainingTotal > 0 && attackerRemainingTotal > defenderNodeRemainingTotal;
    var plunderGold = Math.round(totalTroops(defenderLossByType) * PLUNDER_RATE);

    if (captured) {
      var newTroops = emptyTroops();
      D.TROOP_ORDER.forEach(function (t) {
        newTroops[t] = survivorsByType[t];
      });
      defenderNode.troops = newTroops;
      defenderNode.owner = ctx.attackerFaction;
      defenderNode.defenseLevel = 0;
    } else {
      // 攻方倖存部隊撤回來源城
      D.TROOP_ORDER.forEach(function (t) {
        attackerNode.troops[t] += survivorsByType[t];
      });
    }

    if (state.factions[ctx.attackerFaction]) {
      state.factions[ctx.attackerFaction].gold += plunderGold;
    }

    checkFactionAlive(state, ctx.defenderFaction);

    return {
      attackerFaction: ctx.attackerFaction,
      defenderFaction: ctx.defenderFaction,
      sourceNodeId: ctx.sourceNodeId,
      targetNodeId: ctx.targetNodeId,
      rounds: rounds,
      captured: captured,
      plunderGold: plunderGold,
      attackerRemainingTotal: attackerRemainingTotal,
      defenderNodeRemainingTotal: defenderNodeRemainingTotal,
    };
  }

  function checkFactionAlive(state, factionId) {
    var f = state.factions[factionId];
    if (!f || !f.alive) return;
    if (ownedNodes(state, factionId).length === 0) {
      f.alive = false;
      pushLog(state, "rw_log_faction_eliminated", { faction: factionId });
    }
  }

  function logBattleResult(state, report) {
    pushLog(state, report.captured ? "rw_log_invade_capture" : "rw_log_invade_repelled", {
      attacker: report.attackerFaction,
      defender: report.defenderFaction,
      node: report.targetNodeId,
      gold: report.plunderGold,
    });
  }

  // 玩家發起伐掠（守方一定是 AI，自動產生守備指派）
  function invade(state, params) {
    var sourceNode = state.nodes[params.sourceNodeId];
    var targetNode = state.nodes[params.targetNodeId];
    var defenderSlots = aiAutoDefenseSlots(targetNode);
    if (params.generalId) {
      state.generalStatus[params.generalId].committedTurn = state.turn;
    }
    var report = resolveBattleCore(state, {
      attackerFaction: params.attackerFaction,
      defenderFaction: targetNode.owner,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      attackerSlots: params.slots,
      attackerGeneralId: params.generalId || null,
      defenderSlots: defenderSlots,
      defenderGeneralId: null,
    });
    logBattleResult(state, report);
    return report;
  }

  function playerInvade(state, params) {
    if (state.actionPoints <= 0) return null;
    if (!canInvade(state, state.playerFaction, params.sourceNodeId, params.targetNodeId)) return null;
    state.actionPoints -= 1;
    return invade(state, {
      attackerFaction: state.playerFaction,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      slots: params.slots,
      generalId: params.generalId,
    });
  }

  function resolvePlayerDefense(state, defenderSlots, defenderGeneralId) {
    var pending = state._pendingAiAttack;
    if (!pending) return null;
    state._pendingAiAttack = null;
    if (defenderGeneralId) {
      state.generalStatus[defenderGeneralId].committedTurn = state.turn;
    }
    var report = resolveBattleCore(state, {
      attackerFaction: pending.attackerFaction,
      defenderFaction: state.playerFaction,
      sourceNodeId: pending.sourceNodeId,
      targetNodeId: pending.targetNodeId,
      attackerSlots: pending.slots,
      attackerGeneralId: pending.generalId || null,
      defenderSlots: defenderSlots,
      defenderGeneralId: defenderGeneralId || null,
    });
    logBattleResult(state, report);
    return report;
  }

  // ---- 內政 ----

  function playerDevelop(state, nodeId) {
    if (state.actionPoints <= 0) return false;
    var node = state.nodes[nodeId];
    var faction = state.factions[state.playerFaction];
    if (!node || node.owner !== state.playerFaction) return false;
    if (faction.gold < DEVELOP_COST_GOLD) return false;
    faction.gold -= DEVELOP_COST_GOLD;
    node.kokudaka += DEVELOP_KOKUDAKA_GAIN;
    state.actionPoints -= 1;
    pushLog(state, "rw_log_domestic_develop", { faction: state.playerFaction, node: nodeId });
    return true;
  }

  function playerFortify(state, nodeId) {
    if (state.actionPoints <= 0) return false;
    var node = state.nodes[nodeId];
    var faction = state.factions[state.playerFaction];
    if (!node || node.owner !== state.playerFaction) return false;
    if (node.defenseLevel >= DEFENSE_LEVEL_MAX) return false;
    if (faction.gold < FORTIFY_COST_GOLD) return false;
    faction.gold -= FORTIFY_COST_GOLD;
    node.defenseLevel += 1;
    state.actionPoints -= 1;
    pushLog(state, "rw_log_domestic_fortify", { faction: state.playerFaction, node: nodeId });
    return true;
  }

  function playerRecruit(state, nodeId, troopType, amount) {
    if (state.actionPoints <= 0) return false;
    var node = state.nodes[nodeId];
    var faction = state.factions[state.playerFaction];
    if (!node || node.owner !== state.playerFaction) return false;
    if (D.TROOP_ORDER.indexOf(troopType) === -1) return false;
    var room = getNodeMaxTroops(node) - totalTroops(node.troops);
    var n = Math.max(0, Math.min(amount, room, RECRUIT_MAX_PER_ACTION));
    if (n <= 0) return false;
    var goldCost = n * RECRUIT_GOLD_PER_UNIT;
    var foodCost = n * RECRUIT_FOOD_PER_UNIT;
    if (faction.gold < goldCost || faction.food < foodCost) return false;
    faction.gold -= goldCost;
    faction.food -= foodCost;
    node.troops[troopType] += n;
    state.actionPoints -= 1;
    pushLog(state, "rw_log_domestic_recruit", { faction: state.playerFaction, node: nodeId, amount: n });
    return true;
  }

  // ---- 外交 ----

  function diplomacySuccessChance(state, from, to, base) {
    var relation = getRelation(state, from, to);
    return Math.max(0.05, Math.min(0.95, base + relation / 200));
  }

  function playerProposeAlliance(state, targetFaction) {
    if (state.actionPoints <= 0) return null;
    var from = state.playerFaction;
    if (isAllied(state, from, targetFaction)) return null;
    var chance = diplomacySuccessChance(state, from, targetFaction, 0.3);
    var success = Math.random() < chance;
    state.actionPoints -= 1;
    if (success) {
      state.factions[from].alliances.push(targetFaction);
      state.factions[targetFaction].alliances.push(from);
      setRelation(state, from, targetFaction, 60);
      pushLog(state, "rw_log_diplomacy_alliance_success", { from: from, to: targetFaction });
    } else {
      setRelation(state, from, targetFaction, getRelation(state, from, targetFaction) + 5);
      pushLog(state, "rw_log_diplomacy_alliance_fail", { from: from, to: targetFaction });
    }
    return success;
  }

  function playerProposeCeasefire(state, targetFaction) {
    if (state.actionPoints <= 0) return null;
    var from = state.playerFaction;
    var chance = diplomacySuccessChance(state, from, targetFaction, 0.45);
    var success = Math.random() < chance;
    state.actionPoints -= 1;
    if (success) {
      setRelation(state, from, targetFaction, Math.max(20, getRelation(state, from, targetFaction)));
      pushLog(state, "rw_log_diplomacy_ceasefire_success", { from: from, to: targetFaction });
    } else {
      pushLog(state, "rw_log_diplomacy_ceasefire_fail", { from: from, to: targetFaction });
    }
    return success;
  }

  function playerProvoke(state, targetA, targetB) {
    if (state.actionPoints <= 0) return null;
    var from = state.playerFaction;
    var chance = diplomacySuccessChance(state, from, targetA, 0.4);
    var success = Math.random() < chance;
    state.actionPoints -= 1;
    if (success) {
      setRelation(state, targetA, targetB, getRelation(state, targetA, targetB) - 40);
      pushLog(state, "rw_log_diplomacy_provoke_success", { from: from, a: targetA, b: targetB });
    } else {
      pushLog(state, "rw_log_diplomacy_provoke_fail", { from: from, a: targetA, b: targetB });
    }
    return success;
  }

  // ---- AI ----

  function aiAutoDefenseSlots(node) {
    var types = D.TROOP_ORDER.slice().sort(function (a, b) {
      return (node.troops[b] || 0) - (node.troops[a] || 0);
    });
    return types.slice(0, 5).map(function (t) {
      return { type: t, amount: node.troops[t] || 0 };
    });
  }

  function aiAutoAttackSlots(node, fraction) {
    var types = D.TROOP_ORDER.slice().sort(function (a, b) {
      return (node.troops[b] || 0) - (node.troops[a] || 0);
    });
    return types.slice(0, 5).map(function (t) {
      return { type: t, amount: Math.floor((node.troops[t] || 0) * fraction) };
    });
  }

  function findAiInvasionTarget(state, factionId) {
    var best = null;
    ownedNodes(state, factionId).forEach(function (srcNode) {
      var src = state.nodes[srcNode.id];
      var srcPower = totalTroops(src.troops);
      if (srcPower < AI_MIN_ATTACK_FORCE) return;
      D.neighborsOf(srcNode.id).forEach(function (nbId) {
        var tgt = state.nodes[nbId];
        if (tgt.owner === factionId) return;
        if (isAllied(state, factionId, tgt.owner)) return;
        var tgtPower = totalTroops(tgt.troops);
        var ratio = tgtPower > 0 ? srcPower / tgtPower : 99;
        if (ratio < AI_ATTACK_RATIO) return;
        if (!best || ratio > best.ratio) {
          best = { ratio: ratio, sourceNodeId: srcNode.id, targetNodeId: nbId };
        }
      });
    });
    return best;
  }

  function decideAiAction(state, factionId) {
    var faction = state.factions[factionId];
    var target = findAiInvasionTarget(state, factionId);
    if (target) {
      var srcNode = state.nodes[target.sourceNodeId];
      var slots = aiAutoAttackSlots(srcNode, AI_COMMIT_FRACTION);
      var generals = availableGenerals(state, factionId);
      var generalId = generals.length && Math.random() < 0.6 ? generals[0].id : null;
      return {
        type: "invade",
        targetOwner: state.nodes[target.targetNodeId].owner,
        pending: {
          attackerFaction: factionId,
          sourceNodeId: target.sourceNodeId,
          targetNodeId: target.targetNodeId,
          slots: slots,
          generalId: generalId,
        },
      };
    }

    var nodes = ownedNodes(state, factionId);
    if (!nodes.length) return null;

    if (faction.gold >= DEVELOP_COST_GOLD && Math.random() < 0.5) {
      var weakest = nodes.reduce(function (a, b) {
        return state.nodes[a.id].kokudaka <= state.nodes[b.id].kokudaka ? a : b;
      });
      return { type: "domestic", action: "develop", nodeId: weakest.id, factionId: factionId };
    }

    if (faction.gold >= RECRUIT_GOLD_PER_UNIT * 10) {
      var pick = nodes[Math.floor(Math.random() * nodes.length)];
      var node = state.nodes[pick.id];
      var room = getNodeMaxTroops(node) - totalTroops(node.troops);
      if (room > 10) {
        var type = D.TROOP_ORDER[Math.floor(Math.random() * D.TROOP_ORDER.length)];
        return { type: "domestic", action: "recruit", nodeId: pick.id, troopType: type, amount: Math.min(30, room), factionId: factionId };
      }
    }

    return null;
  }

  function applyAiDomesticAction(state, action) {
    var faction = state.factions[action.factionId];
    if (action.action === "develop") {
      var node = state.nodes[action.nodeId];
      if (faction.gold >= DEVELOP_COST_GOLD) {
        faction.gold -= DEVELOP_COST_GOLD;
        node.kokudaka += DEVELOP_KOKUDAKA_GAIN;
        pushLog(state, "rw_log_domestic_develop", { faction: action.factionId, node: action.nodeId });
      }
    } else if (action.action === "recruit") {
      var n2 = state.nodes[action.nodeId];
      var cost = action.amount * RECRUIT_GOLD_PER_UNIT;
      var foodCost = action.amount * RECRUIT_FOOD_PER_UNIT;
      if (faction.gold >= cost && faction.food >= foodCost) {
        faction.gold -= cost;
        faction.food -= foodCost;
        n2.troops[action.troopType] += action.amount;
        pushLog(state, "rw_log_domestic_recruit", { faction: action.factionId, node: action.nodeId, amount: action.amount });
      }
    }
  }

  function aliveAiFactions(state) {
    return D.FACTION_ORDER.filter(function (fid) {
      return fid !== state.playerFaction && state.factions[fid].alive;
    });
  }

  function beginAiPhase(state) {
    state._ai = { queue: aliveAiFactions(state), budget: 0, currentFaction: null };
    return continueAiPhase(state);
  }

  function continueAiPhase(state) {
    if (!state._ai) return { type: "turnAdvanced", turn: state.turn };
    var guard = 0;
    while (state._ai && guard < 500) {
      guard++;
      if (state._ai.budget <= 0) {
        if (!state._ai.queue.length) {
          state._ai = null;
          finishTurnTick(state);
          return { type: "turnAdvanced", turn: state.turn };
        }
        state._ai.currentFaction = state._ai.queue.shift();
        state._ai.budget = AI_ACTIONS_PER_TURN;
        if (!state.factions[state._ai.currentFaction].alive) {
          state._ai.budget = 0;
        }
        continue;
      }
      var fid = state._ai.currentFaction;
      var action = decideAiAction(state, fid);
      state._ai.budget -= 1;
      if (!action) continue;
      if (action.type === "invade") {
        if (action.targetOwner === state.playerFaction) {
          state._pendingAiAttack = action.pending;
          return { type: "needPlayerDefense", pending: action.pending };
        }
        invade(state, action.pending);
      } else if (action.type === "domestic") {
        applyAiDomesticAction(state, action);
      }
    }
    return { type: "turnAdvanced", turn: state.turn };
  }

  function finishTurnTick(state) {
    D.FACTION_ORDER.forEach(function (fid) {
      var faction = state.factions[fid];
      if (!faction.alive) return;
      var nodes = ownedNodes(state, fid);
      var income = 0;
      var foodIncome = 0;
      var troopCount = 0;
      nodes.forEach(function (n) {
        var node = state.nodes[n.id];
        income += node.kokudaka * 0.5;
        foodIncome += node.kokudaka * 0.3;
        troopCount += totalTroops(node.troops);
      });
      faction.gold += Math.round(income);
      faction.food += Math.round(foodIncome);
      var upkeep = Math.round(troopCount * 0.05);
      faction.food -= upkeep;
      if (faction.food < 0) {
        faction.food = 0;
        nodes.forEach(function (n) {
          var node = state.nodes[n.id];
          D.TROOP_ORDER.forEach(function (t) {
            node.troops[t] = Math.floor(node.troops[t] * 0.95);
          });
        });
        pushLog(state, "rw_log_starvation", { faction: fid });
      }
    });

    D.FACTION_ORDER.forEach(function (fid) {
      D.generalsOfFaction(fid).forEach(function (g) {
        state.generalStatus[g.id].committedTurn = null;
      });
    });

    state.turn += 1;
    state.actionPoints = state.actionPointsMax;

    checkGameOver(state);
  }

  function checkGameOver(state) {
    if (state.gameOver) return;
    var playerNodes = ownedNodes(state, state.playerFaction).length;
    if (playerNodes === 0) {
      state.gameOver = { result: "defeat" };
      pushLog(state, "rw_log_defeat", { faction: state.playerFaction });
      return;
    }
    if (playerNodes >= Math.ceil(D.NODES.length * 0.67)) {
      state.gameOver = { result: "victory" };
      pushLog(state, "rw_log_victory", { faction: state.playerFaction });
    }
  }

  function endPlayerTurn(state) {
    if (state.gameOver) return { type: "gameOver" };
    return beginAiPhase(state);
  }

  // ---- 存讀檔 ----

  function save(state) {
    try {
      var json = JSON.stringify(state);
      var prev = window.localStorage.getItem(SAVE_KEY);
      if (prev) window.localStorage.setItem(SAVE_KEY + "-backup", prev);
      window.localStorage.setItem(SAVE_KEY, json);
    } catch (e) {
      /* 存不了也能繼續玩，只是不會記住 */
    }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try {
      window.localStorage.removeItem(SAVE_KEY);
      window.localStorage.removeItem(SAVE_KEY + "-backup");
    } catch (e) {
      /* 忽略 */
    }
  }

  window.PriTestReiwaCore = {
    createInitialState: createInitialState,
    totalTroops: totalTroops,
    emptyTroops: emptyTroops,
    getNodeMaxTroops: getNodeMaxTroops,
    ownedNodes: ownedNodes,
    availableGenerals: availableGenerals,
    canInvade: canInvade,
    getRelation: getRelation,
    isAllied: isAllied,
    playerInvade: playerInvade,
    resolvePlayerDefense: resolvePlayerDefense,
    playerDevelop: playerDevelop,
    playerFortify: playerFortify,
    playerRecruit: playerRecruit,
    playerProposeAlliance: playerProposeAlliance,
    playerProposeCeasefire: playerProposeCeasefire,
    playerProvoke: playerProvoke,
    endPlayerTurn: endPlayerTurn,
    continueAiPhase: continueAiPhase,
    aiAutoDefenseSlots: aiAutoDefenseSlots,
    save: save,
    load: load,
    clearSave: clearSave,
    constants: {
      DEVELOP_COST_GOLD: DEVELOP_COST_GOLD,
      FORTIFY_COST_GOLD: FORTIFY_COST_GOLD,
      RECRUIT_GOLD_PER_UNIT: RECRUIT_GOLD_PER_UNIT,
      RECRUIT_FOOD_PER_UNIT: RECRUIT_FOOD_PER_UNIT,
      RECRUIT_MAX_PER_ACTION: RECRUIT_MAX_PER_ACTION,
      DEFENSE_LEVEL_MAX: DEFENSE_LEVEL_MAX,
    },
  };
})();
