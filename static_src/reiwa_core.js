// 令和之野望（reiwa）：遊戲引擎（state 初始化、回合制行動、內政／外交／偵察／調兵／圍城／伐掠戰鬥、
// 季節與隨機事件、AI、存讀檔）。畫面在 reiwa.js，美術在 reiwa_art.js，靜態資料在 reiwa_data.js。
// 規則總覽見 docs/reiwa_game_design.md；調整數值時請一併更新該文件。
(function () {
  "use strict";

  var D = window.PriTestReiwaData;

  // ---------------- 常數 ----------------

  var STATE_VERSION = 2;
  var SAVE_KEY = "pritest-reiwa-save";

  var TROOPS_PER_KOKU = 8;
  var CASUALTY_RATE = 0.18;
  var GENERAL_APTITUDE_BONUS = 1.25;
  var DEFENSE_LEVEL_REDUCTION = 0.08;
  var DEFENSE_LEVEL_MAX = 3;
  var CAPITAL_DEFENSE_BONUS = 1; // 本城築城上限 +1
  var MOUNTAIN_DEFEND_MUL = 1.15; // 山城守方戰力
  var COASTAL_TYPE_MUL = 1.2; // 沿海城池：水軍與弓兵（雙方）戰力
  var RESERVE_POWER = 0.6; // 沒有上陣的城兵（預備隊）迎擊時的戰力比例
  var RETREAT_LOSS_RATIO = 1.4; // 開啟「劣勢撤退」時，打完 2 陣以上且己方累計損耗 > 對方 ×1.4 就撤退
  var PLUNDER_RATE = 0.5;
  var CAPTURED_DEFENDER_RETREAT_KEEP = 0.7; // 城被攻陷時，守方殘兵撤到相鄰己方城的存活比例
  var RETREAT_OVERFLOW = 1.5; // 撤退可暫時超編到上限的 1.5 倍（超編時無法徵兵）
  var NATURAL_REGEN = 0.025; // 每回合自然募兵：未被圍、兵糧未斷的城補充上限的 2.5%
  var OFFER_COOLDOWN = 5; // 玩家拒絕提案後，該勢力 5 回合內不再提出同類提案

  var COMMAND_NO_GENERAL = 250; // 不派武將時的帶兵上限
  var COMMAND_BASE = 150; // 有武將：150 + 統率 × 60
  var COMMAND_PER_LEADERSHIP = 60;

  var DEVELOP_COST_GOLD = 40;
  var FORTIFY_COST_GOLD = 50;
  var RECRUIT_GOLD_PER_UNIT = 3;
  var RECRUIT_FOOD_PER_UNIT = 2;
  var RECRUIT_MAX_PER_ACTION = 60;
  var SCOUT_COST_GOLD = 20;

  var GOLD_PER_KOKU = 0.5;
  var FOOD_PER_KOKU_SEASON = 0.1; // 春夏冬每回合
  var FOOD_PER_KOKU_HARVEST = 1.1; // 秋收
  var UPKEEP_PER_TROOP = 0.04;
  var STARVATION_LOSS = 0.05;
  var INITIAL_FOOD_PER_KOKU = 0.9;

  var ALLIANCE_TURNS = 10;
  var TRUCE_TURNS = 6;
  var ATTACK_RELATION_PENALTY = 20;
  var BREAK_PACT_PENALTY = 50;
  var BREAK_PACT_REPUTATION = 10;

  var SIEGE_ATTRITION = 0.08;
  var SIEGE_FOOD_COST = 15;
  var SIEGE_MIN_FORCE = 100;

  var RONIN_HIRE_COST = 60;
  var RONIN_CHANCE = 0.25;
  var WORLD_EVENT_CHANCE = 0.4;
  var MERCHANT_COST = 100;
  var MERCHANT_AMOUNT = 40;

  var AI_MIN_ATTACK_FORCE = 60;
  var TIMED_TURN_LIMIT = 40;

  // 合戰戰術：deal＝造成傷害倍率、take＝承受傷害倍率
  var TACTICS = {
    normal: { deal: 1, take: 1 },
    assault: { deal: 1.3, take: 1.25 },
    hold: { deal: 0.75, take: 0.65 },
  };
  var TACTIC_ORDER = ["normal", "assault", "hold"];

  // AI 性格：
  //   attackMargin   預估攻陷後「攻方倖存 ≥ 守方殘兵 × 此值」才出兵
  //   commitFraction 出征時從駐軍帶走的比例（仍受武將帶兵上限限制）
  //   defenseCommit  守城時上陣比例（其餘留作預備隊）
  //   tactics        戰術機率；retreat 開啟劣勢撤退的機率；siege 圍城傾向；breakChance 破盟傾向
  var TEMPERAMENT_PROFILES = {
    aggressive: { attackMargin: 1.05, commitFraction: 0.85, defenseCommit: 1, allianceChance: 0.1, provokeChance: 0.12, developBias: 0.35, tactics: { assault: 0.5, hold: 0.1 }, retreat: 0.1, siege: 0.15, breakChance: 0.05, winterAttack: true },
    balanced: { attackMargin: 1.15, commitFraction: 0.75, defenseCommit: 0.9, allianceChance: 0.18, provokeChance: 0.08, developBias: 0.45, tactics: { assault: 0.25, hold: 0.2 }, retreat: 0.5, siege: 0.25, breakChance: 0.02, winterAttack: false },
    cautious: { attackMargin: 1.3, commitFraction: 0.65, defenseCommit: 0.8, allianceChance: 0.3, provokeChance: 0.05, developBias: 0.55, tactics: { assault: 0.1, hold: 0.5 }, retreat: 0.9, siege: 0.35, breakChance: 0, winterAttack: false },
    diplomatic: { attackMargin: 1.25, commitFraction: 0.7, defenseCommit: 0.9, allianceChance: 0.35, provokeChance: 0.15, developBias: 0.5, tactics: { assault: 0.2, hold: 0.25 }, retreat: 0.7, siege: 0.25, breakChance: 0.01, winterAttack: false },
  };

  function temperamentOf(factionId) {
    var f = D.factionById(factionId);
    return TEMPERAMENT_PROFILES[(f && f.temperament) || "balanced"] || TEMPERAMENT_PROFILES.balanced;
  }

  function traitOf(factionId) {
    var f = D.factionById(factionId);
    return (f && f.trait) || {};
  }

  // ---------------- 共用工具 ----------------

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 同一回合、同一座城的亂數固定：AI 守備編成在偵察時與實際開戰時一致
  function rngFor(state, salt) {
    return makeRng(hashStr(String(state.seed) + "|" + state.turn + "|" + salt));
  }

  function sumObj(o) {
    var s = 0;
    Object.keys(o || {}).forEach(function (k) {
      s += o[k] || 0;
    });
    return s;
  }

  function totalTroops(troops) {
    var sum = 0;
    D.TROOP_ORDER.forEach(function (t) {
      sum += (troops && troops[t]) || 0;
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

  function copyTroops(troops) {
    var o = {};
    Object.keys(troops).forEach(function (k) {
      o[k] = troops[k];
    });
    return o;
  }

  // 依比例從 pool 取出 amount 名（不修改 pool）
  function takeProportional(pool, amount) {
    var keys = Object.keys(pool);
    var taken = {};
    keys.forEach(function (k) {
      taken[k] = 0;
    });
    var tot = sumObj(pool);
    var want = Math.min(Math.max(0, Math.floor(amount)), tot);
    if (tot <= 0 || want <= 0) return taken;
    keys.forEach(function (k) {
      taken[k] = Math.floor(((pool[k] || 0) * want) / tot);
    });
    var rem = want - sumObj(taken);
    var sorted = keys.slice().sort(function (a, b) {
      return (pool[b] || 0) - (pool[a] || 0);
    });
    var guard = 0;
    while (rem > 0 && guard < 100) {
      guard++;
      sorted.forEach(function (k) {
        if (rem > 0 && (pool[k] || 0) - taken[k] > 0) {
          taken[k] += 1;
          rem -= 1;
        }
      });
    }
    return taken;
  }

  function approxTroops(n) {
    if (n <= 0) return 0;
    return Math.max(50, Math.round(n / 50) * 50);
  }

  function getNodeMaxTroops(node) {
    return Math.round(node.kokudaka * TROOPS_PER_KOKU);
  }

  function maxDefenseLevel(nodeId) {
    var def = D.nodeById(nodeId);
    return DEFENSE_LEVEL_MAX + (def && def.profile === "capital" ? CAPITAL_DEFENSE_BONUS : 0);
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
    state.relations[relationKey(a, b)] = clamp(Math.round(value), -100, 100);
  }

  function addRelation(state, a, b, delta) {
    setRelation(state, a, b, getRelation(state, a, b) + delta);
  }

  function pactOf(state, a, b) {
    var p = state.pacts[relationKey(a, b)];
    return p && p.until >= state.turn ? p : null;
  }

  function isAllied(state, a, b) {
    var p = pactOf(state, a, b);
    return !!p && p.type === "alliance";
  }

  function hasPact(state, a, b) {
    return !!pactOf(state, a, b);
  }

  function seasonOf(state) {
    return (state.startSeason + state.turn - 1) % 4;
  }

  function yearOf(state) {
    return state.startYear + Math.floor((state.startSeason + state.turn - 1) / 4);
  }

  function victoryTarget() {
    return Math.ceil((D.NODES.length * 2) / 3);
  }

  function pushLog(state, key, params) {
    var entry = { turn: state.turn, key: key, params: params || {} };
    state.log.push(entry);
    if (state.log.length > 200) state.log.shift();
    if (state.turnReport && state.turnReport.open) state.turnReport.items.push(entry);
  }

  // ---------------- 武將 ----------------

  function generalDef(gid) {
    return D.generalById(gid);
  }

  function generalState(state, gid) {
    return state.generals[gid] || null;
  }

  function factionGenerals(state, factionId) {
    return Object.keys(state.generals)
      .filter(function (gid) {
        var g = state.generals[gid];
        return g.faction === factionId && g.status === "active";
      })
      .map(generalDef);
  }

  function availableGenerals(state, factionId) {
    return factionGenerals(state, factionId).filter(function (g) {
      return state.generals[g.id].committedTurn !== state.turn;
    });
  }

  function bestStat(state, factionId, stat) {
    var best = 0;
    factionGenerals(state, factionId).forEach(function (g) {
      best = Math.max(best, g.stats[stat]);
    });
    return best;
  }

  // 知略：偵察、外交、離間成功率；沒有武將視為知略 4
  function strategyBonus(state, factionId) {
    var s = bestStat(state, factionId, "strategy") || 4;
    return (s - 5) * 0.04;
  }

  // 政治：開發收益（沒有武將 +4，政治 5 → +6，政治 9 → +8）
  function developGain(state, factionId) {
    var p = bestStat(state, factionId, "politics");
    return p ? 3 + Math.round(p * 0.6) : 4;
  }

  // 統率：帶兵上限
  function commandCap(gid) {
    var g = gid ? generalDef(gid) : null;
    return g ? COMMAND_BASE + g.stats.leadership * COMMAND_PER_LEADERSHIP : COMMAND_NO_GENERAL;
  }

  function commitGeneral(state, gid) {
    if (gid && state.generals[gid]) state.generals[gid].committedTurn = state.turn;
  }

  // ---------------- 初始化與存檔遷移 ----------------

  function createInitialState(playerFactionId, opts) {
    opts = opts || {};
    var sc = D.SCENARIOS[opts.scenario] || D.SCENARIOS.s1585;
    var diff = D.DIFFICULTIES[opts.difficulty] || D.DIFFICULTIES.normal;
    var absent = sc.absent || [];
    var eliminated = sc.eliminated || [];
    var state = {
      version: STATE_VERSION,
      scenario: sc.id,
      difficulty: diff.id,
      victoryMode: opts.victoryMode === "timed" ? "timed" : "conquest",
      turnLimit: TIMED_TURN_LIMIT,
      startYear: sc.startYear,
      startSeason: sc.startSeason,
      seed: String(Math.floor(Math.random() * 1e9)),
      turn: 1,
      playerFaction: playerFactionId,
      actionPoints: diff.playerAp,
      actionPointsMax: diff.playerAp,
      factions: {},
      nodes: {},
      generals: {},
      relations: {},
      pacts: {},
      intel: {},
      sieges: {},
      pendingEvents: [],
      eventSeq: 0,
      offerCooldown: {},
      turnReport: null,
      log: [],
      _ai: null,
      _pendingAiAttack: null,
      gameOver: null,
    };

    D.FACTION_ORDER.forEach(function (fid) {
      var present = absent.indexOf(fid) === -1;
      var alive = present && eliminated.indexOf(fid) === -1;
      state.factions[fid] = { id: fid, alive: alive, present: present, gold: 150, food: 0 };
      if (!present) return;
      D.FACTIONS[fid].generals.forEach(function (gid) {
        state.generals[gid] = alive
          ? { faction: fid, status: "active", committedTurn: null }
          : { faction: null, status: "ronin", committedTurn: null, hidden: true };
      });
    });
    D.RONIN_ORDER.forEach(function (gid) {
      state.generals[gid] = { faction: null, status: "ronin", committedTurn: null, hidden: true };
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
        owner: sc.ownerOverrides[node.id] || node.faction,
        kokudaka: kokudaka,
        defenseLevel: node.profile === "capital" ? 1 : 0,
        troops: troops,
      };
    });

    D.FACTION_ORDER.forEach(function (fid) {
      var koku = ownedNodes(state, fid).reduce(function (s, n) {
        return s + state.nodes[n.id].kokudaka;
      }, 0);
      state.factions[fid].food = Math.round(koku * INITIAL_FOOD_PER_KOKU);
    });

    Object.keys(sc.relations || {}).forEach(function (k) {
      var parts = k.split("|");
      setRelation(state, parts[0], parts[1], sc.relations[k]);
    });

    pushLog(state, "rw_log_game_start", { faction: playerFactionId });
    return state;
  }

  // v1 存檔（第一版）→ v2：補上新欄位，同盟轉成有期限的盟約
  function migrate(state) {
    if (!state || typeof state !== "object") return null;
    if (state.version === STATE_VERSION) return state;
    if (state.version !== 1) return null;
    state.version = STATE_VERSION;
    state.scenario = "s1585";
    state.difficulty = "normal";
    state.victoryMode = "conquest";
    state.turnLimit = TIMED_TURN_LIMIT;
    state.startYear = 1585;
    state.startSeason = 0;
    state.seed = String(Math.floor(Math.random() * 1e9));
    state.generals = {};
    D.FACTION_ORDER.forEach(function (fid) {
      if (!state.factions[fid]) {
        state.factions[fid] = { id: fid, alive: false, present: false, gold: 0, food: 0, alliances: [] };
        return;
      }
      state.factions[fid].present = true;
      D.FACTIONS[fid].generals.forEach(function (gid) {
        state.generals[gid] = state.factions[fid].alive
          ? { faction: fid, status: "active", committedTurn: null }
          : { faction: null, status: "ronin", committedTurn: null, hidden: false };
      });
    });
    D.RONIN_ORDER.forEach(function (gid) {
      state.generals[gid] = { faction: null, status: "ronin", committedTurn: null, hidden: true };
    });
    state.pacts = {};
    D.FACTION_ORDER.forEach(function (fid) {
      (state.factions[fid].alliances || []).forEach(function (other) {
        state.pacts[relationKey(fid, other)] = { type: "alliance", until: state.turn + ALLIANCE_TURNS };
      });
      delete state.factions[fid].alliances;
    });
    delete state.generalStatus;
    state.intel = {};
    state.sieges = {};
    state.pendingEvents = [];
    state.eventSeq = 0;
    state.turnReport = null;
    state._ai = null;
    state._pendingAiAttack = null;
    return state;
  }

  // ---------------- 查詢 ----------------

  function ownedNodes(state, factionId) {
    return D.NODES.filter(function (n) {
      return state.nodes[n.id].owner === factionId;
    });
  }

  function factionTotalPower(state, factionId) {
    return ownedNodes(state, factionId).reduce(function (sum, n) {
      return sum + totalTroops(state.nodes[n.id].troops);
    }, 0);
  }

  function isBesieged(state, nodeId) {
    return !!state.sieges[nodeId];
  }

  function siegeTurns(state, nodeId) {
    var s = state.sieges[nodeId];
    return s ? state.turn - s.since : 0;
  }

  function hostileTo(state, factionId, otherId) {
    return otherId !== factionId && !hasPact(state, factionId, otherId);
  }

  function canInvade(state, factionId, sourceNodeId, targetNodeId) {
    var src = state.nodes[sourceNodeId];
    var tgt = state.nodes[targetNodeId];
    if (!src || !tgt) return false;
    if (src.owner !== factionId || tgt.owner === factionId) return false;
    if (hasPact(state, factionId, tgt.owner)) return false;
    return D.neighborsOf(sourceNodeId).indexOf(targetNodeId) !== -1;
  }

  function adjacentToFaction(state, nodeId, factionId) {
    return D.neighborsOf(nodeId).some(function (nb) {
      return state.nodes[nb].owner === factionId;
    });
  }

  function dominantType(troops) {
    var best = null;
    D.TROOP_ORDER.forEach(function (t) {
      if ((troops[t] || 0) > 0 && (!best || troops[t] > troops[best])) best = t;
    });
    return best;
  }

  // ---------------- 守備編成（AI） ----------------

  function pickTactic(weights, rnd) {
    var r = rnd();
    if (r < weights.assault) return "assault";
    if (r < weights.assault + weights.hold) return "hold";
    return "normal";
  }

  // AI 守城編成：取兵力前 5 的兵種，依當回合的固定亂數打亂順序；保守型只上陣八成、其餘留作預備隊
  function aiDefenseFormation(state, nodeId) {
    var node = state.nodes[nodeId];
    var prof = temperamentOf(node.owner);
    var rnd = rngFor(state, "def:" + nodeId);
    var types = D.TROOP_ORDER.filter(function (t) {
      return (node.troops[t] || 0) > 0;
    })
      .sort(function (a, b) {
        return node.troops[b] - node.troops[a];
      })
      .slice(0, 5);
    for (var i = types.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = types[i];
      types[i] = types[j];
      types[j] = tmp;
    }
    return types.map(function (t) {
      return { type: t, amount: Math.floor(node.troops[t] * prof.defenseCommit), tactic: pickTactic(prof.tactics, rnd) };
    });
  }

  function aiPickGeneral(state, factionId, slots) {
    var gens = availableGenerals(state, factionId);
    if (!gens.length) return null;
    var types = slots
      .filter(function (s) {
        return s.type;
      })
      .map(function (s) {
        return s.type;
      });
    var matching = gens.filter(function (g) {
      return types.indexOf(g.aptitude) !== -1;
    });
    var pool = matching.length ? matching : gens;
    return pool.slice().sort(function (a, b) {
      return b.stats.leadership - a.stats.leadership;
    })[0].id;
  }

  // ---------------- 戰鬥（純計算，不改 state） ----------------

  function capSlots(slots, pool, cap) {
    var used = {};
    var total = 0;
    var out = [];
    for (var i = 0; i < 5; i++) {
      var s = (slots || [])[i];
      var tactic = s && TACTICS[s.tactic] ? s.tactic : "normal";
      if (!s || !s.type || !(s.amount > 0) || pool[s.type] === undefined) {
        out.push({ type: null, amount: 0, tactic: tactic });
        continue;
      }
      var already = used[s.type] || 0;
      var amt = Math.max(0, Math.min(Math.floor(s.amount), (pool[s.type] || 0) - already, cap - total));
      used[s.type] = already + amt;
      total += amt;
      out.push({ type: amt > 0 ? s.type : null, amount: amt, tactic: tactic });
    }
    return out;
  }

  function aptitudeMul(g, type) {
    return g && g.aptitude === type ? GENERAL_APTITUDE_BONUS : 1;
  }

  function valorMul(g) {
    return g ? 1 + (g.stats.valor - 5) * 0.03 : 1;
  }

  function leadershipTake(g) {
    return g ? 1 - (g.stats.leadership - 5) * 0.03 : 1;
  }

  function terrainTypeMul(profile, type) {
    return profile === "coastal" && (type === "navy" || type === "archer") ? COASTAL_TYPE_MUL : 1;
  }

  function traitPowerMul(factionId, type, role, roundIdx, profile) {
    var tr = traitOf(factionId);
    var m = 1;
    if (type && tr.powerMul && tr.powerMul[type]) m *= tr.powerMul[type];
    if (role === "atk" && roundIdx === 0 && tr.firstRoundAttackMul) m *= tr.firstRoundAttackMul;
    if (role === "def" && tr.defendMul) m *= tr.defendMul;
    if (role === "def" && profile === "mountain" && tr.mountainDefendMul) m *= tr.mountainDefendMul;
    return m;
  }

  // input：{ attackerFaction, defenderFaction, profile, region, season, defenseLevel, besiegedTurns,
  //          attackerSlots, defenderSlots（皆已 capSlots）, garrison（守城全部駐軍）, attackerGeneral, defenderGeneral, retreat }
  function computeBattle(input) {
    var reserve = copyTroops(input.garrison);
    input.defenderSlots.forEach(function (s) {
      if (s.type) reserve[s.type] = Math.max(0, (reserve[s.type] || 0) - s.amount);
    });
    var effDefense = Math.max(0, input.defenseLevel - (input.besiegedTurns >= 2 ? 1 : 0));
    var wallMul = 1 - effDefense * DEFENSE_LEVEL_REDUCTION;
    var winterMul = input.season === 3 ? D.WINTER_ATTACK_MUL[input.region] || 1 : 1;
    var mountainMul = input.profile === "mountain" ? MOUNTAIN_DEFEND_MUL : 1;
    var aG = input.attackerGeneral;
    var dG = input.defenderGeneral;
    var atkF = input.attackerFaction;
    var defF = input.defenderFaction;

    var rounds = [];
    var attackerLossBySlot = [0, 0, 0, 0, 0];
    var defenderLoss = {};
    Object.keys(input.garrison).forEach(function (k) {
      defenderLoss[k] = 0;
    });
    var cumA = 0;
    var cumD = 0;
    var fought = 0;
    var retreated = false;

    for (var i = 0; i < 5; i++) {
      var a = input.attackerSlots[i];
      var d = input.defenderSlots[i];
      if (!a.type && !d.type) continue;
      if (retreated) break;
      var r = {
        slot: i,
        attackerType: a.type,
        attackerAmount: a.amount,
        attackerTactic: a.tactic,
        defenderType: d.type,
        defenderAmount: d.amount,
        defenderTactic: d.tactic,
        attackerLoss: 0,
        defenderLoss: 0,
        reserve: false,
        edge: 0,
      };
      if (a.type) {
        var aBase = aptitudeMul(aG, a.type) * valorMul(aG) * traitPowerMul(atkF, a.type, "atk", i, input.profile) * terrainTypeMul(input.profile, a.type) * wallMul * winterMul * TACTICS[a.tactic].deal;
        if (d.type) {
          var mA = D.matchupMultiplier(a.type, d.type);
          var mD = D.matchupMultiplier(d.type, a.type);
          r.edge = mA > 1 ? 1 : mA < 1 ? -1 : 0;
          var pA = a.amount * mA * aBase;
          var pD = d.amount * mD * aptitudeMul(dG, d.type) * valorMul(dG) * traitPowerMul(defF, d.type, "def", i, input.profile) * terrainTypeMul(input.profile, d.type) * mountainMul * TACTICS[d.tactic].deal;
          r.defenderLoss = Math.min(d.amount, Math.round(pA * CASUALTY_RATE * TACTICS[d.tactic].take * leadershipTake(dG)));
          r.attackerLoss = Math.min(a.amount, Math.round(pD * CASUALTY_RATE * TACTICS[a.tactic].take * leadershipTake(aG)));
          defenderLoss[d.type] = (defenderLoss[d.type] || 0) + r.defenderLoss;
        } else {
          // 守方這一格空著：攻方衝向城內預備隊，預備隊以六成戰力迎擊；沒有預備隊時無人抵抗
          var resTotal = sumObj(reserve);
          if (resTotal > 0) {
            var engaged = Math.min(resTotal, a.amount);
            r.reserve = true;
            r.defenderAmount = engaged;
            r.defenderTactic = "normal";
            var pA2 = a.amount * aBase;
            var pD2 = engaged * RESERVE_POWER * valorMul(dG) * traitPowerMul(defF, null, "def", i, input.profile) * mountainMul;
            var dLoss = Math.min(engaged, Math.round(pA2 * CASUALTY_RATE * leadershipTake(dG)));
            r.attackerLoss = Math.min(a.amount, Math.round(pD2 * CASUALTY_RATE * TACTICS[a.tactic].take * leadershipTake(aG)));
            var taken = takeProportional(reserve, dLoss);
            Object.keys(taken).forEach(function (k) {
              reserve[k] -= taken[k];
              defenderLoss[k] = (defenderLoss[k] || 0) + taken[k];
            });
            r.defenderLoss = sumObj(taken);
          }
        }
      }
      attackerLossBySlot[i] = r.attackerLoss;
      cumA += r.attackerLoss;
      cumD += r.defenderLoss;
      if (a.type) fought++;
      rounds.push(r);
      if (input.retreat && fought >= 2 && cumA > 0 && cumA > cumD * RETREAT_LOSS_RATIO) {
        var moreAhead = false;
        for (var k = i + 1; k < 5; k++) if (input.attackerSlots[k].type) moreAhead = true;
        if (moreAhead) {
          retreated = true;
          r.retreatAfter = true;
        }
      }
    }

    var survivors = emptyTroops();
    input.attackerSlots.forEach(function (s, idx) {
      if (s.type) survivors[s.type] += s.amount - attackerLossBySlot[idx];
    });
    var attackerRemainingTotal = totalTroops(survivors);
    var defenderRemainingTotal = sumObj(input.garrison) - sumObj(defenderLoss);
    var captured = !retreated && attackerRemainingTotal > 0 && attackerRemainingTotal > defenderRemainingTotal;
    return {
      rounds: rounds,
      attackerLossBySlot: attackerLossBySlot,
      attackerSurvivorsByType: survivors,
      defenderLossByType: defenderLoss,
      attackerRemainingTotal: attackerRemainingTotal,
      defenderRemainingTotal: defenderRemainingTotal,
      attackerLossTotal: cumA,
      defenderLossTotal: sumObj(defenderLoss),
      captured: captured,
      retreated: retreated,
      plunderGold: Math.round(sumObj(defenderLoss) * PLUNDER_RATE),
    };
  }

  function battleInput(state, p) {
    var tgt = state.nodes[p.targetNodeId];
    var def = D.nodeById(p.targetNodeId);
    return {
      attackerFaction: p.attackerFaction,
      defenderFaction: tgt.owner,
      profile: def.profile,
      region: def.region,
      season: seasonOf(state),
      defenseLevel: tgt.defenseLevel,
      besiegedTurns: state.sieges[p.targetNodeId] && state.sieges[p.targetNodeId].faction === p.attackerFaction ? siegeTurns(state, p.targetNodeId) : 0,
      attackerSlots: p.attackerSlots,
      defenderSlots: p.defenderSlots,
      garrison: p.garrison || tgt.troops,
      attackerGeneral: p.attackerGeneralId ? generalDef(p.attackerGeneralId) : null,
      defenderGeneral: p.defenderGeneralId ? generalDef(p.defenderGeneralId) : null,
      retreat: !!p.retreat,
    };
  }

  // ---------------- 戰鬥套用 ----------------

  function setGeneralFree(state, gid, originFaction) {
    var g = state.generals[gid];
    if (originFaction && state.factions[originFaction] && state.factions[originFaction].alive) {
      g.faction = originFaction;
      g.status = "active";
    } else {
      g.faction = null;
      g.status = "ronin";
      g.hidden = false;
    }
    g.captor = null;
  }

  function handleCapture(state, gid, captor, origin) {
    var g = state.generals[gid];
    g.status = "captive";
    g.captor = captor;
    g.faction = null;
    pushLog(state, "rw_log_general_captured", { general: gid, faction: captor });
    if (captor === state.playerFaction) {
      pushEvent(state, { type: "captive", generalId: gid, origin: origin });
      return;
    }
    if (Math.random() < 0.4) {
      g.status = "active";
      g.faction = captor;
      g.captor = null;
      pushLog(state, "rw_log_general_recruited", { general: gid, faction: captor });
    } else {
      setGeneralFree(state, gid, origin);
      pushLog(state, "rw_log_general_released", { general: gid, faction: captor });
    }
  }

  function rollGeneralFate(state, gid, captor, origin, deathChance, captureChance, fates) {
    if (!gid || !state.generals[gid]) return;
    var r = Math.random();
    if (r < deathChance) {
      state.generals[gid].status = "dead";
      state.generals[gid].faction = null;
      pushLog(state, "rw_log_general_dead", { general: gid });
      fates.push({ generalId: gid, fate: "dead" });
    } else if (r < deathChance + captureChance) {
      handleCapture(state, gid, captor, origin);
      fates.push({ generalId: gid, fate: "captive", captor: captor });
    }
  }

  function clearSiegesTouching(state, nodeId) {
    delete state.sieges[nodeId];
    Object.keys(state.sieges).forEach(function (tid) {
      if (state.sieges[tid].sourceNodeId === nodeId) delete state.sieges[tid];
    });
  }

  // p：{ attackerFaction, sourceNodeId, targetNodeId, attackerSlots, defenderSlots, attackerGeneralId, defenderGeneralId, retreat }
  function executeBattle(state, p) {
    var src = state.nodes[p.sourceNodeId];
    var tgt = state.nodes[p.targetNodeId];
    var atkF = p.attackerFaction;
    var defF = tgt.owner;
    var res = computeBattle(battleInput(state, p));

    commitGeneral(state, p.attackerGeneralId);
    commitGeneral(state, p.defenderGeneralId);

    // 出征部隊離開來源城（修正舊版只扣損耗、倖存者被重複計算的問題）
    p.attackerSlots.forEach(function (s) {
      if (s.type) src.troops[s.type] = Math.max(0, src.troops[s.type] - s.amount);
    });
    D.TROOP_ORDER.forEach(function (t) {
      tgt.troops[t] = Math.max(0, tgt.troops[t] - (res.defenderLossByType[t] || 0));
    });

    var retreatNodeId = null;
    var retreatAmount = 0;
    if (res.captured) {
      // 守方殘兵撤往相鄰的己方城（三成在撤退中散失），沒有可撤之處就潰散
      var leftovers = copyTroops(tgt.troops);
      var best = null;
      D.neighborsOf(p.targetNodeId).forEach(function (nb) {
        var n = state.nodes[nb];
        if (n.owner !== defF) return;
        var room = Math.floor(getNodeMaxTroops(n) * RETREAT_OVERFLOW) - totalTroops(n.troops);
        if (room > 0 && (!best || room > best.room)) best = { id: nb, room: room };
      });
      if (best) {
        var keep = {};
        D.TROOP_ORDER.forEach(function (t) {
          keep[t] = Math.floor(leftovers[t] * CAPTURED_DEFENDER_RETREAT_KEEP);
        });
        var moved = takeProportional(keep, best.room);
        D.TROOP_ORDER.forEach(function (t) {
          state.nodes[best.id].troops[t] += moved[t];
        });
        retreatNodeId = best.id;
        retreatAmount = totalTroops(moved);
      }
      tgt.troops = copyTroops(res.attackerSurvivorsByType);
      tgt.owner = atkF;
      tgt.defenseLevel = Math.max(0, tgt.defenseLevel - 1);
      delete state.intel[p.targetNodeId];
      clearSiegesTouching(state, p.targetNodeId);
    } else {
      D.TROOP_ORDER.forEach(function (t) {
        src.troops[t] += res.attackerSurvivorsByType[t];
      });
    }

    if (state.factions[atkF]) state.factions[atkF].gold += res.plunderGold;
    addRelation(state, atkF, defF, -ATTACK_RELATION_PENALTY);

    var fates = [];
    if (res.captured) rollGeneralFate(state, p.defenderGeneralId, atkF, defF, 0.06, 0.3, fates);
    else rollGeneralFate(state, p.attackerGeneralId, defF, atkF, 0.04, 0.12, fates);

    pushLog(state, res.retreated ? "rw_log_invade_retreat" : res.captured ? "rw_log_invade_capture" : "rw_log_invade_repelled", {
      attacker: atkF,
      defender: defF,
      node: p.targetNodeId,
      gold: res.plunderGold,
    });
    if (state.turnReport && state.turnReport.open) {
      state.turnReport.arrows.push({ from: p.sourceNodeId, to: p.targetNodeId, faction: atkF, captured: res.captured });
    }

    checkFactionAlive(state, defF);
    checkGameOver(state);

    return {
      attackerFaction: atkF,
      defenderFaction: defF,
      sourceNodeId: p.sourceNodeId,
      targetNodeId: p.targetNodeId,
      rounds: res.rounds,
      captured: res.captured,
      retreated: res.retreated,
      plunderGold: res.plunderGold,
      attackerRemainingTotal: res.attackerRemainingTotal,
      defenderNodeRemainingTotal: res.defenderRemainingTotal,
      attackerGeneralId: p.attackerGeneralId || null,
      defenderGeneralId: p.defenderGeneralId || null,
      generalFates: fates,
      defenderRetreatNodeId: retreatNodeId,
      defenderRetreatAmount: retreatAmount,
    };
  }

  function checkFactionAlive(state, factionId) {
    var f = state.factions[factionId];
    if (!f || !f.alive) return;
    if (ownedNodes(state, factionId).length > 0) return;
    f.alive = false;
    Object.keys(state.generals).forEach(function (gid) {
      var g = state.generals[gid];
      if (g.faction === factionId && g.status === "active") {
        g.faction = null;
        g.status = "ronin";
        g.hidden = false;
      }
    });
    Object.keys(state.pacts).forEach(function (k) {
      if (k.split("|").indexOf(factionId) !== -1) delete state.pacts[k];
    });
    Object.keys(state.sieges).forEach(function (tid) {
      if (state.sieges[tid].faction === factionId) delete state.sieges[tid];
    });
    pushLog(state, "rw_log_faction_eliminated", { faction: factionId });
  }

  // 攻守雙方的伐掠（AI 守方自動編成）
  function invadeAgainstAi(state, params) {
    var tgt = state.nodes[params.targetNodeId];
    var defSlots = capSlots(aiDefenseFormation(state, params.targetNodeId), tgt.troops, Infinity);
    var defGeneralId = aiPickGeneral(state, tgt.owner, defSlots);
    return executeBattle(state, {
      attackerFaction: params.attackerFaction,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      attackerSlots: params.slots,
      defenderSlots: defSlots,
      attackerGeneralId: params.generalId || null,
      defenderGeneralId: defGeneralId,
      retreat: params.retreat,
    });
  }

  function playerInvade(state, params) {
    if (state.actionPoints <= 0 || state.gameOver) return null;
    if (!canInvade(state, state.playerFaction, params.sourceNodeId, params.targetNodeId)) return null;
    if (params.generalId && availableGenerals(state, state.playerFaction).map(function (g) { return g.id; }).indexOf(params.generalId) === -1) return null;
    var slots = capSlots(params.slots, state.nodes[params.sourceNodeId].troops, commandCap(params.generalId));
    state.actionPoints -= 1;
    return invadeAgainstAi(state, {
      attackerFaction: state.playerFaction,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      slots: slots,
      generalId: params.generalId,
      retreat: params.retreat,
    });
  }

  // 出陣前預估：有本回合偵察情報時用實際守備編成（戰鬥結算是確定性的，預估即實際結果）；
  // 沒有情報時以概數兵力、未知兵種（無相剋）估算
  function estimateInvade(state, params) {
    var tgt = state.nodes[params.targetNodeId];
    var slots = capSlots(params.slots, state.nodes[params.sourceNodeId].troops, commandCap(params.generalId));
    var intel = nodeIntel(state, params.targetNodeId);
    var p = {
      attackerFaction: state.playerFaction,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      attackerSlots: slots,
      attackerGeneralId: params.generalId || null,
      retreat: params.retreat,
    };
    if (intel.full) {
      p.defenderSlots = capSlots(intel.formation, tgt.troops, Infinity);
      p.defenderGeneralId = intel.generalId;
    } else {
      var guess = { unknown: intel.approxTotal };
      var per = Math.floor((intel.approxTotal * 0.9) / 5);
      p.garrison = guess;
      p.defenderSlots = capSlots(
        [0, 1, 2, 3, 4].map(function () {
          return { type: "unknown", amount: per, tactic: "normal" };
        }),
        guess,
        Infinity
      );
      p.defenderGeneralId = null;
    }
    var res = computeBattle(battleInput(state, p));
    var margin = res.attackerRemainingTotal / Math.max(1, res.defenderRemainingTotal);
    var chance;
    if (intel.full) chance = res.captured ? "certain" : "fail";
    else if (!res.captured) chance = "low";
    else chance = margin >= 1.3 ? "high" : "mid";
    return {
      basis: intel.full ? "intel" : "guess",
      chance: chance,
      attackerLoss: res.attackerLossTotal,
      defenderLoss: res.defenderLossTotal,
      attackerRemaining: res.attackerRemainingTotal,
      defenderRemaining: res.defenderRemainingTotal,
      retreated: res.retreated,
      committed: slots.reduce(function (s, x) {
        return s + x.amount;
      }, 0),
      cap: commandCap(params.generalId),
    };
  }

  function resolvePlayerDefense(state, defenderSlots, defenderGeneralId) {
    var pending = state._pendingAiAttack;
    if (!pending) return null;
    state._pendingAiAttack = null;
    var tgt = state.nodes[pending.targetNodeId];
    var src = state.nodes[pending.sourceNodeId];
    if (!src || src.owner !== pending.attackerFaction || tgt.owner !== state.playerFaction) return null;
    var defSlots = capSlots(defenderSlots, tgt.troops, Infinity);
    var atkSlots = capSlots(pending.slots, src.troops, commandCap(pending.generalId));
    return executeBattle(state, {
      attackerFaction: pending.attackerFaction,
      sourceNodeId: pending.sourceNodeId,
      targetNodeId: pending.targetNodeId,
      attackerSlots: atkSlots,
      defenderSlots: defSlots,
      attackerGeneralId: pending.generalId || null,
      defenderGeneralId: defenderGeneralId || null,
      retreat: pending.retreat,
    });
  }

  // 守城視窗用：來襲部隊的概況（兵種不透露順序與各格數量）
  function pendingAttackInfo(state) {
    var p = state._pendingAiAttack;
    if (!p) return null;
    var types = [];
    var total = 0;
    p.slots.forEach(function (s) {
      if (!s.type) return;
      total += s.amount;
      if (types.indexOf(s.type) === -1) types.push(s.type);
    });
    types.sort(function (a, b) {
      return D.TROOP_ORDER.indexOf(a) - D.TROOP_ORDER.indexOf(b);
    });
    return { attackerFaction: p.attackerFaction, sourceNodeId: p.sourceNodeId, targetNodeId: p.targetNodeId, generalId: p.generalId || null, approxTotal: approxTroops(total), types: types };
  }

  // ---------------- 情報與偵察 ----------------

  // 玩家眼中的城池情報：己方與同盟城完整可見；敵城只有兵力概數與主力兵種，本回合偵察成功後才看得到完整駐軍與守備編成
  function nodeIntel(state, nodeId) {
    var node = state.nodes[nodeId];
    var total = totalTroops(node.troops);
    var own = node.owner === state.playerFaction || isAllied(state, state.playerFaction, node.owner);
    var it = state.intel[nodeId];
    var fresh = !!(it && it.turn === state.turn);
    if (own) return { full: true, own: true, troops: node.troops, approxTotal: total, mainType: dominantType(node.troops), formation: null, generalId: null };
    var formation = fresh ? aiDefenseFormation(state, nodeId) : null;
    return {
      full: fresh,
      own: false,
      troops: fresh ? node.troops : null,
      approxTotal: fresh ? total : approxTroops(total),
      mainType: dominantType(node.troops),
      formation: formation,
      generalId: fresh ? aiPickGeneral(state, node.owner, capSlots(formation, node.troops, Infinity)) : null,
    };
  }

  function scoutChance(state, factionId) {
    return clamp(0.55 + strategyBonus(state, factionId) + (traitOf(factionId).schemeBonus || 0), 0.1, 0.95);
  }

  function playerScout(state, nodeId) {
    var node = state.nodes[nodeId];
    var f = state.factions[state.playerFaction];
    if (state.actionPoints <= 0 || !node || node.owner === state.playerFaction) return null;
    if (f.gold < SCOUT_COST_GOLD) return null;
    if (!adjacentToFaction(state, nodeId, state.playerFaction)) return null;
    f.gold -= SCOUT_COST_GOLD;
    state.actionPoints -= 1;
    var ok = Math.random() < scoutChance(state, state.playerFaction);
    if (ok) state.intel[nodeId] = { turn: state.turn };
    pushLog(state, ok ? "rw_log_scout_success" : "rw_log_scout_fail", { faction: state.playerFaction, node: nodeId });
    return ok;
  }

  // ---------------- 內政 ----------------

  function recruitUnitGold(factionId, type) {
    var disc = (traitOf(factionId).recruitDiscount || {})[type] || 0;
    return Math.max(1, RECRUIT_GOLD_PER_UNIT - disc);
  }

  function playerDevelop(state, nodeId) {
    var node = state.nodes[nodeId];
    var faction = state.factions[state.playerFaction];
    if (state.actionPoints <= 0 || !node || node.owner !== state.playerFaction) return false;
    if (faction.gold < DEVELOP_COST_GOLD) return false;
    faction.gold -= DEVELOP_COST_GOLD;
    node.kokudaka += developGain(state, state.playerFaction);
    state.actionPoints -= 1;
    pushLog(state, "rw_log_domestic_develop", { faction: state.playerFaction, node: nodeId });
    return true;
  }

  function playerFortify(state, nodeId) {
    var node = state.nodes[nodeId];
    var faction = state.factions[state.playerFaction];
    if (state.actionPoints <= 0 || !node || node.owner !== state.playerFaction) return false;
    if (node.defenseLevel >= maxDefenseLevel(nodeId) || faction.gold < FORTIFY_COST_GOLD) return false;
    faction.gold -= FORTIFY_COST_GOLD;
    node.defenseLevel += 1;
    state.actionPoints -= 1;
    pushLog(state, "rw_log_domestic_fortify", { faction: state.playerFaction, node: nodeId });
    return true;
  }

  function recruitInto(state, factionId, nodeId, troopType, amount) {
    var node = state.nodes[nodeId];
    var faction = state.factions[factionId];
    if (!node || node.owner !== factionId || D.TROOP_ORDER.indexOf(troopType) === -1) return 0;
    if (isBesieged(state, nodeId)) return 0;
    var room = getNodeMaxTroops(node) - totalTroops(node.troops);
    var unitGold = recruitUnitGold(factionId, troopType);
    var n = Math.max(0, Math.min(Math.floor(amount), room, RECRUIT_MAX_PER_ACTION, Math.floor(faction.gold / unitGold), Math.floor(faction.food / RECRUIT_FOOD_PER_UNIT)));
    if (n <= 0) return 0;
    faction.gold -= n * unitGold;
    faction.food -= n * RECRUIT_FOOD_PER_UNIT;
    node.troops[troopType] += n;
    pushLog(state, "rw_log_domestic_recruit", { faction: factionId, node: nodeId, amount: n });
    return n;
  }

  function playerRecruit(state, nodeId, troopType, amount) {
    if (state.actionPoints <= 0) return false;
    var n = recruitInto(state, state.playerFaction, nodeId, troopType, amount);
    if (n <= 0) return false;
    state.actionPoints -= 1;
    return true;
  }

  // ---------------- 調兵 ----------------

  function transferTroops(state, factionId, fromId, toId, troops) {
    var from = state.nodes[fromId];
    var to = state.nodes[toId];
    if (!from || !to || from.owner !== factionId || to.owner !== factionId || fromId === toId) return 0;
    if (D.neighborsOf(fromId).indexOf(toId) === -1 || isBesieged(state, toId)) return 0;
    var room = getNodeMaxTroops(to) - totalTroops(to.troops);
    var moved = 0;
    D.TROOP_ORDER.forEach(function (t) {
      var n = Math.max(0, Math.min(Math.floor((troops && troops[t]) || 0), from.troops[t], room - moved));
      from.troops[t] -= n;
      to.troops[t] += n;
      moved += n;
    });
    if (moved > 0) pushLog(state, "rw_log_transfer", { faction: factionId, from: fromId, to: toId, amount: moved });
    return moved;
  }

  function playerTransfer(state, fromId, toId, troops) {
    if (state.actionPoints <= 0) return 0;
    var moved = transferTroops(state, state.playerFaction, fromId, toId, troops);
    if (moved > 0) state.actionPoints -= 1;
    return moved;
  }

  // ---------------- 圍城 ----------------

  function canSiege(state, factionId, sourceId, targetId) {
    if (!canInvade(state, factionId, sourceId, targetId)) return false;
    if (state.sieges[targetId] || isBesieged(state, sourceId)) return false;
    return totalTroops(state.nodes[sourceId].troops) >= SIEGE_MIN_FORCE;
  }

  function startSiege(state, factionId, sourceId, targetId) {
    state.sieges[targetId] = { faction: factionId, sourceNodeId: sourceId, since: state.turn };
    addRelation(state, factionId, state.nodes[targetId].owner, -10);
    pushLog(state, "rw_log_siege_start", { faction: factionId, node: targetId, defender: state.nodes[targetId].owner });
  }

  function playerSiege(state, sourceId, targetId) {
    if (state.actionPoints <= 0 || !canSiege(state, state.playerFaction, sourceId, targetId)) return false;
    state.actionPoints -= 1;
    startSiege(state, state.playerFaction, sourceId, targetId);
    return true;
  }

  function playerLiftSiege(state, targetId) {
    var s = state.sieges[targetId];
    if (!s || s.faction !== state.playerFaction) return false;
    delete state.sieges[targetId];
    pushLog(state, "rw_log_siege_lifted", { faction: state.playerFaction, node: targetId });
    return true;
  }

  function tickSieges(state) {
    Object.keys(state.sieges).forEach(function (tid) {
      var s = state.sieges[tid];
      var tgt = state.nodes[tid];
      var src = state.nodes[s.sourceNodeId];
      var valid =
        state.factions[s.faction] &&
        state.factions[s.faction].alive &&
        src.owner === s.faction &&
        tgt.owner !== s.faction &&
        !hasPact(state, s.faction, tgt.owner) &&
        totalTroops(src.troops) >= SIEGE_MIN_FORCE / 2;
      if (!valid) {
        delete state.sieges[tid];
        pushLog(state, "rw_log_siege_lifted", { faction: s.faction, node: tid });
        return;
      }
      D.TROOP_ORDER.forEach(function (t) {
        tgt.troops[t] = Math.floor(tgt.troops[t] * (1 - SIEGE_ATTRITION));
      });
      var f = state.factions[s.faction];
      f.food = Math.max(0, f.food - SIEGE_FOOD_COST);
      pushLog(state, "rw_log_siege_attrition", { faction: s.faction, node: tid, defender: tgt.owner });
    });
  }

  // ---------------- 外交 ----------------

  function schemeChance(state, from, to, base) {
    return clamp(base + getRelation(state, from, to) / 200 + strategyBonus(state, from) + (traitOf(from).schemeBonus || 0), 0.05, 0.95);
  }

  function formPact(state, a, b, type, turns) {
    state.pacts[relationKey(a, b)] = { type: type, until: state.turn + turns };
  }

  function pushEvent(state, ev) {
    state.eventSeq = (state.eventSeq || 0) + 1;
    ev.id = state.eventSeq;
    state.pendingEvents.push(ev);
  }

  function setOfferCooldown(state, fid) {
    if (!state.offerCooldown) state.offerCooldown = {};
    state.offerCooldown[fid] = state.turn + OFFER_COOLDOWN;
  }

  function canOfferPlayer(state, type, fid) {
    return !hasPendingEvent(state, type, fid) && !(state.offerCooldown && state.offerCooldown[fid] > state.turn);
  }

  function hasPendingEvent(state, type, from) {
    return state.pendingEvents.some(function (e) {
      return e.type === type && e.from === from;
    });
  }

  function resolveAllianceProposal(state, from, to) {
    var renewing = isAllied(state, from, to);
    var ok = Math.random() < schemeChance(state, from, to, renewing ? 0.5 : 0.3);
    if (ok) {
      formPact(state, from, to, "alliance", ALLIANCE_TURNS);
      setRelation(state, from, to, Math.max(60, getRelation(state, from, to)));
      pushLog(state, renewing ? "rw_log_diplomacy_alliance_renew" : "rw_log_diplomacy_alliance_success", { from: from, to: to });
    } else {
      addRelation(state, from, to, 5);
      pushLog(state, "rw_log_diplomacy_alliance_fail", { from: from, to: to });
    }
    return ok;
  }

  function resolveTruceProposal(state, from, to) {
    if (isAllied(state, from, to)) return false;
    var ok = Math.random() < schemeChance(state, from, to, 0.45);
    if (ok) {
      formPact(state, from, to, "truce", TRUCE_TURNS);
      setRelation(state, from, to, Math.max(20, getRelation(state, from, to)));
      pushLog(state, "rw_log_diplomacy_ceasefire_success", { from: from, to: to });
    } else {
      pushLog(state, "rw_log_diplomacy_ceasefire_fail", { from: from, to: to });
    }
    return ok;
  }

  function resolveProvoke(state, from, targetA, targetB) {
    var ok = Math.random() < schemeChance(state, from, targetA, 0.4);
    if (ok) {
      addRelation(state, targetA, targetB, -40);
      pushLog(state, "rw_log_diplomacy_provoke_success", { from: from, a: targetA, b: targetB });
    } else {
      pushLog(state, "rw_log_diplomacy_provoke_fail", { from: from, a: targetA, b: targetB });
    }
    return ok;
  }

  function breakPact(state, from, to) {
    var p = pactOf(state, from, to);
    if (!p) return false;
    delete state.pacts[relationKey(from, to)];
    addRelation(state, from, to, -BREAK_PACT_PENALTY);
    D.FACTION_ORDER.forEach(function (fid) {
      if (fid !== from && fid !== to && state.factions[fid].alive) addRelation(state, from, fid, -BREAK_PACT_REPUTATION);
    });
    pushLog(state, "rw_log_diplomacy_break", { from: from, to: to });
    return true;
  }

  // 援軍：同盟從與我方相鄰的城撥出兩成五兵力（最多 150）到我方相鄰城
  function resolveReinforcement(state, from, ally) {
    if (!isAllied(state, from, ally)) return 0;
    var ok = Math.random() < schemeChance(state, from, ally, 0.35);
    if (!ok) {
      addRelation(state, from, ally, -5);
      pushLog(state, "rw_log_reinforce_fail", { from: from, to: ally });
      return 0;
    }
    var best = null;
    ownedNodes(state, ally).forEach(function (nd) {
      D.neighborsOf(nd.id).forEach(function (nb) {
        var dest = state.nodes[nb];
        if (dest.owner !== from || isBesieged(state, nb)) return;
        var room = getNodeMaxTroops(dest) - totalTroops(dest.troops);
        var srcTotal = totalTroops(state.nodes[nd.id].troops);
        if (room <= 0 || srcTotal <= 0) return;
        if (!best || srcTotal > best.srcTotal) best = { src: nd.id, dest: nb, room: room, srcTotal: srcTotal };
      });
    });
    if (!best) {
      pushLog(state, "rw_log_reinforce_fail", { from: from, to: ally });
      return 0;
    }
    var send = Math.min(150, Math.floor(best.srcTotal * 0.25), best.room);
    var moved = takeProportional(state.nodes[best.src].troops, send);
    D.TROOP_ORDER.forEach(function (t) {
      state.nodes[best.src].troops[t] -= moved[t];
      state.nodes[best.dest].troops[t] += moved[t];
    });
    addRelation(state, from, ally, -10);
    pushLog(state, "rw_log_reinforce_success", { from: from, to: ally, node: best.dest, amount: totalTroops(moved) });
    return totalTroops(moved);
  }

  function spendAp(state) {
    if (state.actionPoints <= 0 || state.gameOver) return false;
    state.actionPoints -= 1;
    return true;
  }

  function playerProposeAlliance(state, targetFaction) {
    if (!spendAp(state)) return null;
    return resolveAllianceProposal(state, state.playerFaction, targetFaction);
  }

  function playerProposeCeasefire(state, targetFaction) {
    if (isAllied(state, state.playerFaction, targetFaction) || !spendAp(state)) return null;
    return resolveTruceProposal(state, state.playerFaction, targetFaction);
  }

  function playerProvoke(state, targetA, targetB) {
    if (!spendAp(state)) return null;
    return resolveProvoke(state, state.playerFaction, targetA, targetB);
  }

  function playerBreakPact(state, targetFaction) {
    if (!hasPact(state, state.playerFaction, targetFaction) || !spendAp(state)) return false;
    return breakPact(state, state.playerFaction, targetFaction);
  }

  function playerRequestReinforcement(state, ally) {
    if (!isAllied(state, state.playerFaction, ally) || !spendAp(state)) return null;
    return resolveReinforcement(state, state.playerFaction, ally);
  }

  // ---------------- 事件（需要玩家決定的） ----------------

  function offerRoninToAi(state, gid) {
    var candidates = D.FACTION_ORDER.filter(function (fid) {
      return fid !== state.playerFaction && state.factions[fid].alive && state.factions[fid].gold >= RONIN_HIRE_COST;
    });
    if (!candidates.length) return;
    var fid = candidates[Math.floor(Math.random() * candidates.length)];
    state.factions[fid].gold -= RONIN_HIRE_COST;
    state.generals[gid].faction = fid;
    state.generals[gid].status = "active";
    pushLog(state, "rw_log_ronin_hired", { general: gid, faction: fid });
  }

  // choice 依事件類型：allianceOffer/truceOffer：accept|decline；captive：recruit|release|execute；ronin/merchant：accept|decline
  function resolveEvent(state, eventId, choice) {
    var idx = -1;
    state.pendingEvents.forEach(function (e, i) {
      if (e.id === eventId) idx = i;
    });
    if (idx === -1) return null;
    var ev = state.pendingEvents.splice(idx, 1)[0];
    var me = state.playerFaction;
    var result = { ok: true };
    if (ev.type === "allianceOffer") {
      if (choice === "accept" && state.factions[ev.from].alive) {
        formPact(state, me, ev.from, "alliance", ALLIANCE_TURNS);
        setRelation(state, me, ev.from, Math.max(60, getRelation(state, me, ev.from)));
        pushLog(state, "rw_log_diplomacy_alliance_success", { from: ev.from, to: me });
      } else {
        addRelation(state, me, ev.from, -5);
        setOfferCooldown(state, ev.from);
        pushLog(state, "rw_log_offer_declined", { from: ev.from, to: me });
      }
    } else if (ev.type === "truceOffer") {
      if (choice === "accept" && state.factions[ev.from].alive && !hasPact(state, me, ev.from)) {
        formPact(state, me, ev.from, "truce", TRUCE_TURNS);
        setRelation(state, me, ev.from, Math.max(20, getRelation(state, me, ev.from)));
        pushLog(state, "rw_log_diplomacy_ceasefire_success", { from: ev.from, to: me });
      } else {
        setOfferCooldown(state, ev.from);
        pushLog(state, "rw_log_offer_declined", { from: ev.from, to: me });
      }
    } else if (ev.type === "captive") {
      var g = state.generals[ev.generalId];
      if (!g || g.status !== "captive") return result;
      if (choice === "recruit") {
        if (Math.random() < 0.45 + strategyBonus(state, me)) {
          g.status = "active";
          g.faction = me;
          g.captor = null;
          pushLog(state, "rw_log_general_recruited", { general: ev.generalId, faction: me });
        } else {
          setGeneralFree(state, ev.generalId, ev.origin);
          pushLog(state, "rw_log_general_refused", { general: ev.generalId, faction: me });
          result.ok = false;
        }
      } else if (choice === "execute") {
        g.status = "dead";
        g.faction = null;
        g.captor = null;
        if (ev.origin) addRelation(state, me, ev.origin, -30);
        D.FACTION_ORDER.forEach(function (fid) {
          if (fid !== me && fid !== ev.origin && state.factions[fid].alive) addRelation(state, me, fid, -5);
        });
        pushLog(state, "rw_log_general_executed", { general: ev.generalId, faction: me });
      } else {
        setGeneralFree(state, ev.generalId, ev.origin);
        if (ev.origin) addRelation(state, me, ev.origin, 15);
        pushLog(state, "rw_log_general_released", { general: ev.generalId, faction: me });
      }
    } else if (ev.type === "ronin") {
      var rg = state.generals[ev.generalId];
      if (choice === "accept" && rg && rg.status === "ronin" && state.factions[me].gold >= ev.cost) {
        state.factions[me].gold -= ev.cost;
        rg.faction = me;
        rg.status = "active";
        pushLog(state, "rw_log_ronin_hired", { general: ev.generalId, faction: me });
      } else {
        if (choice === "accept") result.ok = false;
        offerRoninToAi(state, ev.generalId);
      }
    } else if (ev.type === "merchant") {
      var node = state.nodes[ev.nodeId];
      if (choice === "accept" && node.owner === me && state.factions[me].gold >= ev.cost) {
        var room = getNodeMaxTroops(node) - totalTroops(node.troops);
        var n = Math.max(0, Math.min(ev.amount, room));
        state.factions[me].gold -= ev.cost;
        node.troops.gun += n;
        pushLog(state, "rw_log_event_merchant_buy", { faction: me, node: ev.nodeId, amount: n });
      } else if (choice === "accept") {
        result.ok = false;
      }
    }
    checkGameOver(state);
    return result;
  }

  // ---------------- AI ----------------

  function aiAttackSlots(state, srcNodeId, commit, prof) {
    var node = state.nodes[srcNodeId];
    var types = D.TROOP_ORDER.filter(function (t) {
      return node.troops[t] > 0;
    })
      .sort(function (a, b) {
        return node.troops[b] - node.troops[a];
      })
      .slice(0, 5);
    var pool = {};
    types.forEach(function (t) {
      pool[t] = node.troops[t];
    });
    var take = takeProportional(pool, commit);
    return types.map(function (t) {
      return { type: t, amount: take[t], tactic: pickTactic(prof.tactics, Math.random) };
    });
  }

  // 依「預估攻陷後的兵力優勢 × 目標價值 × 風險 × 關係」評分，取最高分（AI 只知道對方總兵力與兵種構成，不知道守備順序）
  function findBestAiTarget(state, factionId, prof) {
    var best = null;
    var ownTotalPower = factionTotalPower(state, factionId);
    var gens = availableGenerals(state, factionId);
    var bestLeader = gens.slice().sort(function (a, b) {
      return b.stats.leadership - a.stats.leadership;
    })[0];
    ownedNodes(state, factionId).forEach(function (srcDef) {
      var src = state.nodes[srcDef.id];
      var srcPower = totalTroops(src.troops);
      if (srcPower < AI_MIN_ATTACK_FORCE || isBesieged(state, srcDef.id)) return;
      var commit = Math.min(Math.floor(srcPower * prof.commitFraction), commandCap(bestLeader ? bestLeader.id : null));
      D.neighborsOf(srcDef.id).forEach(function (nbId) {
        var tgt = state.nodes[nbId];
        if (!hostileTo(state, factionId, tgt.owner)) return;
        var slots = capSlots(aiAttackSlots(state, srcDef.id, commit, prof), src.troops, commit);
        var gid = aiPickGeneral(state, factionId, slots);
        var guess = {};
        var guessSlots = [];
        D.TROOP_ORDER.filter(function (t) {
          return tgt.troops[t] > 0;
        })
          .sort(function (a, b) {
            return tgt.troops[b] - tgt.troops[a];
          })
          .slice(0, 5)
          .forEach(function (t, i) {
            guessSlots.push({ type: "u" + i, amount: Math.floor(tgt.troops[t] * 0.9), tactic: "normal" });
            guess["u" + i] = tgt.troops[t];
          });
        guess.rest = totalTroops(tgt.troops) - sumObj(guess);
        var est = computeBattle(
          battleInput(state, {
            attackerFaction: factionId,
            sourceNodeId: srcDef.id,
            targetNodeId: nbId,
            attackerSlots: slots,
            defenderSlots: capSlots(guessSlots, guess, Infinity),
            garrison: guess,
            attackerGeneralId: gid,
            defenderGeneralId: null,
            retreat: false,
          })
        );
        if (!est.captured || est.attackerRemainingTotal < est.defenderRemainingTotal * prof.attackMargin) return;
        var ownerPower = factionTotalPower(state, tgt.owner);
        var riskPenalty = ownerPower > ownTotalPower * 1.6 ? 0.55 : 1;
        var valueScore = 0.6 + 0.4 * Math.min(2, tgt.kokudaka / 70);
        var relationFactor = 1 - getRelation(state, factionId, tgt.owner) / 200;
        var besiegedBonus = state.sieges[nbId] && state.sieges[nbId].faction === factionId ? 1.3 : 1;
        var score = (est.attackerRemainingTotal / Math.max(1, est.defenderRemainingTotal)) * valueScore * riskPenalty * relationFactor * besiegedBonus;
        if (!best || score > best.score) best = { score: score, sourceNodeId: srcDef.id, targetNodeId: nbId, slots: slots, generalId: gid };
      });
    });
    return best;
  }

  function findThreatenedBorderNode(state, factionId) {
    var best = null;
    ownedNodes(state, factionId).forEach(function (nodeDef) {
      var node = state.nodes[nodeDef.id];
      var ownPower = totalTroops(node.troops);
      D.neighborsOf(nodeDef.id).forEach(function (nbId) {
        var nb = state.nodes[nbId];
        if (!hostileTo(state, factionId, nb.owner)) return;
        var nbPower = totalTroops(nb.troops);
        if (nbPower <= ownPower * 1.1) return;
        var urgency = nbPower / Math.max(1, ownPower);
        if (!best || urgency > best.urgency) best = { urgency: urgency, nodeId: nodeDef.id, byFaction: nb.owner };
      });
    });
    return best;
  }

  function recruitTypeFor(state, factionId, nodeId) {
    var node = state.nodes[nodeId];
    var threatDominant = null;
    D.neighborsOf(nodeId).forEach(function (nbId) {
      if (threatDominant) return;
      var nb = state.nodes[nbId];
      if (!hostileTo(state, factionId, nb.owner)) return;
      threatDominant = dominantType(nb.troops);
    });
    if (threatDominant) {
      var counter = D.TROOP_ORDER.filter(function (tid) {
        return D.troopType(tid).beats === threatDominant;
      })[0];
      if (counter) return counter;
    }
    return D.TROOP_ORDER.slice().sort(function (a, b) {
      return (node.troops[a] || 0) - (node.troops[b] || 0);
    })[0];
  }

  function isFrontline(state, factionId, nodeId) {
    return D.neighborsOf(nodeId).some(function (nb) {
      return hostileTo(state, factionId, state.nodes[nb].owner);
    });
  }

  // 後方兵力調往相鄰前線
  function findAiTransfer(state, factionId) {
    var best = null;
    ownedNodes(state, factionId).forEach(function (nd) {
      if (isFrontline(state, factionId, nd.id)) return;
      var src = state.nodes[nd.id];
      var srcTotal = totalTroops(src.troops);
      if (srcTotal < getNodeMaxTroops(src) * 0.35) return;
      D.neighborsOf(nd.id).forEach(function (nb) {
        var dest = state.nodes[nb];
        if (dest.owner !== factionId || !isFrontline(state, factionId, nb) || isBesieged(state, nb)) return;
        var room = getNodeMaxTroops(dest) - totalTroops(dest.troops);
        if (room < 30) return;
        var amount = Math.min(Math.floor(srcTotal * 0.6), room);
        if (!best || amount > best.amount) best = { from: nd.id, to: nb, amount: amount };
      });
    });
    return best;
  }

  function findAiSiegeTarget(state, factionId) {
    var best = null;
    ownedNodes(state, factionId).forEach(function (nd) {
      var srcTotal = totalTroops(state.nodes[nd.id].troops);
      if (srcTotal < SIEGE_MIN_FORCE * 1.5) return;
      D.neighborsOf(nd.id).forEach(function (nb) {
        if (!canSiege(state, factionId, nd.id, nb)) return;
        var tgtTotal = totalTroops(state.nodes[nb].troops);
        if (srcTotal < tgtTotal * 0.8) return;
        var score = state.nodes[nb].kokudaka / Math.max(1, tgtTotal);
        if (!best || score > best.score) best = { score: score, from: nd.id, to: nb };
      });
    });
    return best;
  }

  function neighborFactions(state, factionId) {
    var set = {};
    ownedNodes(state, factionId).forEach(function (nd) {
      D.neighborsOf(nd.id).forEach(function (nb) {
        var o = state.nodes[nb].owner;
        if (o !== factionId && state.factions[o].alive) set[o] = true;
      });
    });
    return Object.keys(set);
  }

  function decideAiAction(state, factionId) {
    var faction = state.factions[factionId];
    var prof = temperamentOf(factionId);
    var nodes = ownedNodes(state, factionId);
    if (!nodes.length) return null;
    var me = state.playerFaction;

    // 1）外交：提議同盟（對玩家是可拒絕的事件）
    if (Math.random() < prof.allianceChance * 0.5) {
      var cands = neighborFactions(state, factionId).filter(function (fid) {
        return !hasPact(state, factionId, fid) && getRelation(state, factionId, fid) >= -10;
      });
      if (cands.length) return { type: "alliance", from: factionId, to: cands[Math.floor(Math.random() * cands.length)] };
    }
    // 1b）被更強鄰國壓迫時求和
    var threatened = findThreatenedBorderNode(state, factionId);
    if (threatened && threatened.urgency > 1.5 && Math.random() < 0.15 && getRelation(state, factionId, threatened.byFaction) > -40) {
      return { type: "truce", from: factionId, to: threatened.byFaction };
    }
    // 1c）破盟：好戰型對相鄰的弱小盟友
    if (Math.random() < prof.breakChance) {
      var own = factionTotalPower(state, factionId);
      var victim = neighborFactions(state, factionId).filter(function (fid) {
        return isAllied(state, factionId, fid) && factionTotalPower(state, fid) < own * 0.6 && getRelation(state, factionId, fid) < 40;
      })[0];
      if (victim) return { type: "break", from: factionId, to: victim };
    }

    // 2）軍事（冬季非好戰型多半按兵不動）
    var winterHold = seasonOf(state) === 3 && !prof.winterAttack && Math.random() < 0.7;
    if (!winterHold) {
      var target = findBestAiTarget(state, factionId, prof);
      if (target) {
        return {
          type: "invade",
          targetOwner: state.nodes[target.targetNodeId].owner,
          pending: {
            attackerFaction: factionId,
            sourceNodeId: target.sourceNodeId,
            targetNodeId: target.targetNodeId,
            slots: target.slots,
            generalId: target.generalId,
            retreat: Math.random() < prof.retreat,
          },
        };
      }
      if (Math.random() < prof.siege) {
        var siege = findAiSiegeTarget(state, factionId);
        if (siege) return { type: "siege", factionId: factionId, from: siege.from, to: siege.to };
      }
    }

    // 3）調兵：後方 → 前線
    var tr = findAiTransfer(state, factionId);
    if (tr && Math.random() < 0.5) return { type: "transfer", factionId: factionId, from: tr.from, to: tr.to, amount: tr.amount };

    // 4）防禦：邊境受威脅時築城或徵兵
    if (threatened) {
      var tNode = state.nodes[threatened.nodeId];
      if (faction.gold >= FORTIFY_COST_GOLD && tNode.defenseLevel < maxDefenseLevel(threatened.nodeId) && Math.random() < 0.6) {
        return { type: "domestic", action: "fortify", nodeId: threatened.nodeId, factionId: factionId };
      }
      var tRoom = getNodeMaxTroops(tNode) - totalTroops(tNode.troops);
      if (tRoom > 10 && faction.gold >= RECRUIT_GOLD_PER_UNIT * 10 && !isBesieged(state, threatened.nodeId)) {
        return { type: "domestic", action: "recruit", nodeId: threatened.nodeId, troopType: recruitTypeFor(state, factionId, threatened.nodeId), amount: Math.min(30, tRoom), factionId: factionId };
      }
    }

    // 5）內政
    if (faction.gold >= DEVELOP_COST_GOLD && Math.random() < prof.developBias) {
      var weakest = nodes.reduce(function (a, b) {
        return state.nodes[a.id].kokudaka <= state.nodes[b.id].kokudaka ? a : b;
      });
      return { type: "domestic", action: "develop", nodeId: weakest.id, factionId: factionId };
    }
    if (faction.gold >= RECRUIT_GOLD_PER_UNIT * 10 && faction.food > 60) {
      var pick = nodes[Math.floor(Math.random() * nodes.length)];
      var node = state.nodes[pick.id];
      var room = getNodeMaxTroops(node) - totalTroops(node.troops);
      if (room > 10) {
        return { type: "domestic", action: "recruit", nodeId: pick.id, troopType: recruitTypeFor(state, factionId, pick.id), amount: Math.min(30, room), factionId: factionId };
      }
    }
    return null;
  }

  function applyAiDomesticAction(state, action) {
    var faction = state.factions[action.factionId];
    if (action.action === "develop") {
      if (faction.gold >= DEVELOP_COST_GOLD) {
        faction.gold -= DEVELOP_COST_GOLD;
        state.nodes[action.nodeId].kokudaka += developGain(state, action.factionId);
        pushLog(state, "rw_log_domestic_develop", { faction: action.factionId, node: action.nodeId });
      }
    } else if (action.action === "fortify") {
      var n3 = state.nodes[action.nodeId];
      if (faction.gold >= FORTIFY_COST_GOLD && n3.defenseLevel < maxDefenseLevel(action.nodeId)) {
        faction.gold -= FORTIFY_COST_GOLD;
        n3.defenseLevel += 1;
        pushLog(state, "rw_log_domestic_fortify", { faction: action.factionId, node: action.nodeId });
      }
    } else if (action.action === "recruit") {
      recruitInto(state, action.factionId, action.nodeId, action.troopType, action.amount);
    }
  }

  function aliveAiFactions(state) {
    return D.FACTION_ORDER.filter(function (fid) {
      return fid !== state.playerFaction && state.factions[fid].alive;
    });
  }

  function beginAiPhase(state) {
    state.turnReport = { turn: state.turn, open: true, items: [], arrows: [] };
    state._ai = { queue: aliveAiFactions(state), budget: 0, currentFaction: null };
    return continueAiPhase(state);
  }

  function continueAiPhase(state) {
    if (state.gameOver) {
      state._ai = null;
      if (state.turnReport) state.turnReport.open = false;
      return { type: "gameOver" };
    }
    if (!state._ai) return { type: "turnAdvanced", turn: state.turn };
    var diff = D.DIFFICULTIES[state.difficulty] || D.DIFFICULTIES.normal;
    var guard = 0;
    while (state._ai && guard < 500) {
      guard++;
      if (state.gameOver) {
        state._ai = null;
        state.turnReport.open = false;
        return { type: "gameOver" };
      }
      if (state._ai.budget <= 0) {
        if (!state._ai.queue.length) {
          state._ai = null;
          finishTurnTick(state);
          return state.gameOver ? { type: "gameOver" } : { type: "turnAdvanced", turn: state.turn };
        }
        state._ai.currentFaction = state._ai.queue.shift();
        state._ai.budget = state.factions[state._ai.currentFaction].alive ? diff.aiActions : 0;
        continue;
      }
      var fid = state._ai.currentFaction;
      var action = decideAiAction(state, fid);
      state._ai.budget -= 1;
      if (!action) continue;
      if (action.type === "invade") {
        if (action.targetOwner === state.playerFaction) {
          // AI 出征武將在送出攻擊時就標記為本回合已出陣（修正同一武將一回合出征兩次）
          commitGeneral(state, action.pending.generalId);
          state._pendingAiAttack = action.pending;
          return { type: "needPlayerDefense", pending: action.pending };
        }
        commitGeneral(state, action.pending.generalId);
        invadeAgainstAi(state, action.pending);
      } else if (action.type === "domestic") {
        applyAiDomesticAction(state, action);
      } else if (action.type === "alliance") {
        if (action.to === state.playerFaction) {
          if (canOfferPlayer(state, "allianceOffer", action.from)) {
            pushEvent(state, { type: "allianceOffer", from: action.from });
            pushLog(state, "rw_log_offer_alliance", { from: action.from, to: action.to });
          }
        } else {
          resolveAllianceProposal(state, action.from, action.to);
        }
      } else if (action.type === "truce") {
        if (action.to === state.playerFaction) {
          if (canOfferPlayer(state, "truceOffer", action.from)) {
            pushEvent(state, { type: "truceOffer", from: action.from });
            pushLog(state, "rw_log_offer_truce", { from: action.from, to: action.to });
          }
        } else {
          resolveTruceProposal(state, action.from, action.to);
        }
      } else if (action.type === "break") {
        breakPact(state, action.from, action.to);
      } else if (action.type === "siege") {
        startSiege(state, action.factionId, action.from, action.to);
      } else if (action.type === "transfer") {
        var srcNode = state.nodes[action.from];
        transferTroops(state, action.factionId, action.from, action.to, takeProportional(srcNode.troops, action.amount));
      }
    }
    return { type: "turnAdvanced", turn: state.turn };
  }

  // ---------------- 回合結束 ----------------

  function randomPick(list) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  function scaleTroops(node, mul) {
    D.TROOP_ORDER.forEach(function (t) {
      node.troops[t] = Math.floor(node.troops[t] * mul);
    });
  }

  function tickEconomy(state) {
    var season = seasonOf(state);
    var diff = D.DIFFICULTIES[state.difficulty] || D.DIFFICULTIES.normal;
    D.FACTION_ORDER.forEach(function (fid) {
      var faction = state.factions[fid];
      if (!faction.alive) return;
      var tr = traitOf(fid);
      var income = 0;
      var koku = 0;
      var troopCount = 0;
      ownedNodes(state, fid).forEach(function (nd) {
        var node = state.nodes[nd.id];
        koku += node.kokudaka;
        income += node.kokudaka * GOLD_PER_KOKU * (nd.profile === "coastal" && tr.coastalGoldMul ? tr.coastalGoldMul : 1);
        troopCount += totalTroops(node.troops);
      });
      var mul = fid === state.playerFaction ? 1 : diff.aiIncomeMul;
      faction.gold += Math.round(income * mul);
      var food = season === 2 ? koku * FOOD_PER_KOKU_HARVEST * (tr.harvestMul || 1) : koku * FOOD_PER_KOKU_SEASON;
      faction.food += Math.round(food * mul);
      if (season === 2 && fid === state.playerFaction) pushLog(state, "rw_log_harvest", { faction: fid, amount: Math.round(food) });
      faction.food -= Math.round(troopCount * UPKEEP_PER_TROOP);
      if (faction.food > 0) {
        ownedNodes(state, fid).forEach(function (nd) {
          if (isBesieged(state, nd.id)) return;
          var node = state.nodes[nd.id];
          var cap = getNodeMaxTroops(node);
          var add = Math.min(Math.round(cap * NATURAL_REGEN), cap - totalTroops(node.troops));
          if (add <= 0) return;
          var w = D.PROFILE_WEIGHTS[nd.profile];
          var pool = {};
          D.TROOP_ORDER.forEach(function (t, i) {
            pool[t] = Math.round(w[i] * 100);
          });
          var got = takeProportional(pool, add);
          D.TROOP_ORDER.forEach(function (t) {
            node.troops[t] += got[t];
          });
        });
      }
      if (faction.food < 0) {
        faction.food = 0;
        ownedNodes(state, fid).forEach(function (nd) {
          scaleTroops(state.nodes[nd.id], 1 - STARVATION_LOSS);
        });
        pushLog(state, "rw_log_starvation", { faction: fid });
      }
    });
  }

  function tickWorldEvents(state) {
    // 浪人出現
    var ronins = Object.keys(state.generals).filter(function (gid) {
      return state.generals[gid].status === "ronin";
    });
    if (ronins.length && Math.random() < RONIN_CHANCE && !hasPendingEvent(state, "ronin", undefined)) {
      var gid = randomPick(ronins);
      state.generals[gid].hidden = false;
      pushLog(state, "rw_log_ronin_appear", { general: gid });
      if (state.factions[state.playerFaction].gold >= RONIN_HIRE_COST) pushEvent(state, { type: "ronin", generalId: gid, cost: RONIN_HIRE_COST });
      else offerRoninToAi(state, gid);
    }

    if (Math.random() >= WORLD_EVENT_CHANCE) return;
    var season = seasonOf(state);
    var kinds = ["uprising", "quake", "horses", "merchant", "bounty"];
    var kind = randomPick(kinds);
    var allNodes = D.NODES.map(function (n) {
      return n.id;
    });
    if (kind === "bounty") {
      var fid = randomPick(aliveAiFactions(state).concat([state.playerFaction]));
      var koku = ownedNodes(state, fid).reduce(function (s, n) {
        return s + state.nodes[n.id].kokudaka;
      }, 0);
      var amt = Math.round(koku * (season === 2 ? 0.4 : 0.25));
      state.factions[fid].food += amt;
      pushLog(state, "rw_log_event_bounty", { faction: fid, amount: amt });
    } else if (kind === "uprising") {
      var starving = allNodes.filter(function (id) {
        return state.factions[state.nodes[id].owner].food === 0;
      });
      var nid = randomPick(starving.length ? starving : allNodes);
      var node = state.nodes[nid];
      scaleTroops(node, 0.9);
      node.kokudaka = Math.max(20, node.kokudaka - 3);
      pushLog(state, "rw_log_event_uprising", { faction: node.owner, node: nid });
    } else if (kind === "quake") {
      var qid = randomPick(allNodes);
      var qn = state.nodes[qid];
      if (qn.defenseLevel > 0) qn.defenseLevel -= 1;
      scaleTroops(qn, 0.95);
      pushLog(state, "rw_log_event_quake", { faction: qn.owner, node: qid });
    } else if (kind === "horses") {
      var hid = randomPick(
        D.NODES.filter(function (n) {
          return n.region === "iwate" || n.region === "aomori";
        }).map(function (n) {
          return n.id;
        })
      );
      var hn = state.nodes[hid];
      var hroom = getNodeMaxTroops(hn) - totalTroops(hn.troops);
      var h = Math.max(0, Math.min(20, hroom));
      hn.troops.cavalry += h;
      pushLog(state, "rw_log_event_horses", { faction: hn.owner, node: hid, amount: h });
    } else if (kind === "merchant") {
      var mid = randomPick(
        D.NODES.filter(function (n) {
          return n.profile === "coastal";
        }).map(function (n) {
          return n.id;
        })
      );
      var mn = state.nodes[mid];
      pushLog(state, "rw_log_event_merchant", { faction: mn.owner, node: mid });
      if (mn.owner === state.playerFaction) {
        pushEvent(state, { type: "merchant", nodeId: mid, amount: MERCHANT_AMOUNT, cost: MERCHANT_COST });
      } else if (state.factions[mn.owner].gold >= MERCHANT_COST) {
        var mroom = getNodeMaxTroops(mn) - totalTroops(mn.troops);
        state.factions[mn.owner].gold -= MERCHANT_COST;
        mn.troops.gun += Math.max(0, Math.min(MERCHANT_AMOUNT, mroom));
      }
    }
  }

  function tickDiplomacy(state) {
    Object.keys(state.pacts).forEach(function (k) {
      var p = state.pacts[k];
      if (p.until <= state.turn) {
        var parts = k.split("|");
        delete state.pacts[k];
        pushLog(state, p.type === "alliance" ? "rw_log_pact_expired_alliance" : "rw_log_pact_expired_truce", { from: parts[0], to: parts[1] });
      }
    });
    Object.keys(state.relations).forEach(function (k) {
      var parts = k.split("|");
      var v = state.relations[k];
      if (isAllied(state, parts[0], parts[1])) state.relations[k] = Math.min(100, v + 2);
      else if (v > 0) state.relations[k] = v - 1;
      else if (v < 0) state.relations[k] = v + 1;
    });
  }

  function finishTurnTick(state) {
    tickSieges(state);
    tickEconomy(state);
    tickWorldEvents(state);
    tickDiplomacy(state);
    D.FACTION_ORDER.forEach(function (fid) {
      checkFactionAlive(state, fid);
    });
    state.turn += 1;
    state.actionPoints = state.actionPointsMax;
    Object.keys(state.intel).forEach(function (nid) {
      if (state.intel[nid].turn < state.turn - 1) delete state.intel[nid];
    });
    if (state.turnReport) state.turnReport.open = false;
    checkGameOver(state);
  }

  function nodeCounts(state) {
    var counts = {};
    D.NODES.forEach(function (n) {
      var o = state.nodes[n.id].owner;
      counts[o] = (counts[o] || 0) + 1;
    });
    return counts;
  }

  function checkGameOver(state) {
    if (state.gameOver) return;
    var counts = nodeCounts(state);
    var mine = counts[state.playerFaction] || 0;
    if (mine === 0) {
      state.gameOver = { result: "defeat", reason: "eliminated" };
      pushLog(state, "rw_log_defeat", { faction: state.playerFaction });
      return;
    }
    if (mine >= victoryTarget()) {
      state.gameOver = { result: "victory", reason: "conquest" };
      pushLog(state, "rw_log_victory", { faction: state.playerFaction });
      return;
    }
    if (state.victoryMode === "timed" && state.turn > state.turnLimit) {
      var maxOther = 0;
      Object.keys(counts).forEach(function (fid) {
        if (fid !== state.playerFaction) maxOther = Math.max(maxOther, counts[fid]);
      });
      var won = mine >= maxOther;
      state.gameOver = { result: won ? "victory" : "defeat", reason: "timeup" };
      pushLog(state, won ? "rw_log_victory_timed" : "rw_log_defeat_timed", { faction: state.playerFaction });
    }
  }

  function endPlayerTurn(state) {
    if (state.gameOver) return { type: "gameOver" };
    return beginAiPhase(state);
  }

  // ---------------- 存讀檔 ----------------

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
      return raw ? migrate(JSON.parse(raw)) : null;
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
    migrate: migrate,
    totalTroops: totalTroops,
    emptyTroops: emptyTroops,
    approxTroops: approxTroops,
    getNodeMaxTroops: getNodeMaxTroops,
    maxDefenseLevel: maxDefenseLevel,
    ownedNodes: ownedNodes,
    nodeCounts: nodeCounts,
    victoryTarget: victoryTarget,
    seasonOf: seasonOf,
    yearOf: yearOf,
    generalState: generalState,
    factionGenerals: factionGenerals,
    availableGenerals: availableGenerals,
    commandCap: commandCap,
    developGain: developGain,
    scoutChance: scoutChance,
    recruitUnitGold: recruitUnitGold,
    canInvade: canInvade,
    canSiege: canSiege,
    isBesieged: isBesieged,
    siegeTurns: siegeTurns,
    getRelation: getRelation,
    isAllied: isAllied,
    hasPact: hasPact,
    pactOf: pactOf,
    nodeIntel: nodeIntel,
    pendingAttackInfo: pendingAttackInfo,
    estimateInvade: estimateInvade,
    schemeChance: schemeChance,
    computeBattle: computeBattle,
    playerInvade: playerInvade,
    resolvePlayerDefense: resolvePlayerDefense,
    playerDevelop: playerDevelop,
    playerFortify: playerFortify,
    playerRecruit: playerRecruit,
    playerTransfer: playerTransfer,
    playerScout: playerScout,
    playerSiege: playerSiege,
    playerLiftSiege: playerLiftSiege,
    playerProposeAlliance: playerProposeAlliance,
    playerProposeCeasefire: playerProposeCeasefire,
    playerProvoke: playerProvoke,
    playerBreakPact: playerBreakPact,
    playerRequestReinforcement: playerRequestReinforcement,
    resolveEvent: resolveEvent,
    endPlayerTurn: endPlayerTurn,
    continueAiPhase: continueAiPhase,
    aiDefenseFormation: aiDefenseFormation,
    save: save,
    load: load,
    clearSave: clearSave,
    TACTIC_ORDER: TACTIC_ORDER,
    constants: {
      DEVELOP_COST_GOLD: DEVELOP_COST_GOLD,
      FORTIFY_COST_GOLD: FORTIFY_COST_GOLD,
      RECRUIT_GOLD_PER_UNIT: RECRUIT_GOLD_PER_UNIT,
      RECRUIT_FOOD_PER_UNIT: RECRUIT_FOOD_PER_UNIT,
      RECRUIT_MAX_PER_ACTION: RECRUIT_MAX_PER_ACTION,
      DEFENSE_LEVEL_MAX: DEFENSE_LEVEL_MAX,
      SCOUT_COST_GOLD: SCOUT_COST_GOLD,
      SIEGE_MIN_FORCE: SIEGE_MIN_FORCE,
      ALLIANCE_TURNS: ALLIANCE_TURNS,
      TRUCE_TURNS: TRUCE_TURNS,
      RONIN_HIRE_COST: RONIN_HIRE_COST,
      COMMAND_NO_GENERAL: COMMAND_NO_GENERAL,
    },
  };
})();
