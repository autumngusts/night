// 繩文帝國（jomon）：「世界」規則 —— AI 勢力（成長、襲擊來源、本拠攻略與滅國）、外交（朝貢停戰、議和）、
// 時代事件（抉擇與效果）、任務（自動判定與獎勵）。由 jomon_core.js 的 step() 以 hook 呼叫。
// 資料在 jomon_world_data.js；說明見 docs/jomon_game_design.md §13〜§17。
(function () {
  "use strict";

  var D = window.PriTestJomonData;
  var WD = window.PriTestJomonWorldData;
  function Core() {
    return window.PriTestJomonCore;
  }

  // ---------------- 常數 ----------------

  var GROWTH = 0.02 / 60; // 勢力強度每秒成長（每分鐘 +0.02，× 難度）
  var STRENGTH_MAX = 3;
  var STRENGTH_MIN = 0.25;
  var CAPITAL_HP = 3; // 本拠要攻下 3 次才會滅國
  var CAPITAL_ARMY = 0.1; // 本拠兵力＝人口 × 10% × 強度 × 難度
  var CAPITAL_FORT = 0.4; // ＋ 0.04 × 時代
  var TRUCE_TIME = 480; // 朝貢換來 480 秒停戰
  var PEACE_TIME = 900; // 和約 900 秒
  var PEACE_RELATION = 50; // 關係 ≥ 50 才能議和
  var RELATION_DECAY = 0.2 / 60; // 關係每秒往 0 回歸
  var FIRST_EVENT = 150;
  var EVENT_MIN = 200;
  var EVENT_MAX = 420;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function keys(o) {
    return Object.keys(o || {});
  }

  // ---------------- 初始化與存檔升級 ----------------

  function freshFaction() {
    return { strength: 1, relation: 0, truceUntil: 0, peaceUntil: 0, capitalHp: CAPITAL_HP, destroyed: false, wins: 0, mix: null };
  }
  function init(state) {
    state.factions = {};
    WD.FACTIONS.forEach(function (f) {
      state.factions[f.id] = freshFaction();
    });
    state.nextEvent = FIRST_EVENT;
    state.quests = {};
  }
  function migrate(state) {
    if (!state.factions) state.factions = {};
    WD.FACTIONS.forEach(function (f) {
      if (!state.factions[f.id]) state.factions[f.id] = freshFaction();
    });
    if (state.nextEvent == null) state.nextEvent = FIRST_EVENT;
    if (!state.quests) state.quests = {};
    if (!state.eventsSeen) state.eventsSeen = {};
  }

  // ---------------- 勢力 ----------------

  function fs(state, fid) {
    return state.factions[fid] || (state.factions[fid] = freshFaction());
  }
  function factionIdOf(objId) {
    return objId.slice(4);
  }
  function present(state, fid) {
    var f = WD.faction(fid);
    return !!f && state.age >= f.appearAge && !fs(state, fid).destroyed;
  }
  function atTruce(state, fid) {
    return state.time < fs(state, fid).truceUntil;
  }
  function atPeace(state, fid) {
    return state.time < fs(state, fid).peaceUntil;
  }
  function relationState(state, fid) {
    var f = fs(state, fid);
    if (f.destroyed) return "destroyed";
    if (atPeace(state, fid)) return "peace";
    if (atTruce(state, fid)) return "truce";
    return "hostile";
  }

  function availableClasses(state) {
    return D.UNIT_CLASSES.filter(function (c) {
      return D.UNITS[c].age <= state.age;
    });
  }

  function capitalSize(state, fid) {
    var f = fs(state, fid);
    var pop = Core().population(state);
    return Math.max(20, Math.round(pop * CAPITAL_ARMY * f.strength * Core().DIFFICULTY[state.difficulty].enemy * (1 + (CAPITAL_HP - f.capitalHp) * 0.15)));
  }

  function armyFromMix(state, size, mix, roll) {
    var classes = availableClasses(state).filter(function (c) {
      return (mix[c] || 0) > 0;
    });
    if (!classes.length) classes = ["spear"];
    var w = classes.map(function (c) {
      return (mix[c] || 0.5) * (roll && roll[c] ? roll[c] : 1);
    });
    var sum = w.reduce(function (a, b) {
      return a + b;
    }, 0);
    var out = {};
    classes.forEach(function (c, i) {
      var n = Math.round((size * w[i]) / sum);
      if (n > 0) out[c] = n;
    });
    return out;
  }

  function rollFactionMix(f) {
    var r = {};
    keys(f.mix).forEach(function (c) {
      r[c] = 0.5 + Math.random() * 1.1;
    });
    return r;
  }

  function nominalArmy(state, objId) {
    var fid = factionIdOf(objId);
    return armyFromMix(state, capitalSize(state, fid), WD.faction(fid).mix, null);
  }
  function factionArmy(state, objId) {
    var fid = factionIdOf(objId);
    var f = fs(state, fid);
    var def = WD.faction(fid);
    if (!f.mix) f.mix = rollFactionMix(def);
    return armyFromMix(state, capitalSize(state, fid), def.mix, f.mix);
  }

  function factionReward(state, objId, m) {
    var fid = factionIdOf(objId);
    var f = fs(state, fid);
    var k = D.AGES[state.age].capMult * 500 * (1 + Core().mod(m, "loot")) * Core().DIFFICULTY[state.difficulty].loot * (f.capitalHp <= 1 ? 2 : 1);
    var out = { food: Math.round(k * 2), wood: Math.round(k), stone: Math.round(k * 0.6) };
    if (state.age >= D.GOLD_AGE) out.gold = Math.round(k * 0.6);
    return out;
  }

  function objective(state, objId) {
    var fid = factionIdOf(objId);
    var def = WD.faction(fid);
    if (!def) return null;
    var f = fs(state, fid);
    return {
      id: objId,
      kind: "faction",
      faction: fid,
      name: def.name,
      icon: def.icon,
      desc: def.desc,
      dist: def.dist,
      tier: state.age,
      fort: CAPITAL_FORT + 0.04 * state.age,
      statMul: 1,
      captives: 0.3,
      level: f.wins,
      angle: def.angle,
      available: present(state, fid),
    };
  }

  // 出征時打破停戰／和約
  function onAttack(state, fid) {
    var f = fs(state, fid);
    if (atTruce(state, fid) || atPeace(state, fid)) {
      f.truceUntil = 0;
      f.peaceUntil = 0;
      f.relation = clamp(f.relation - 40, -100, 100);
      Core().log(state, "jm_log_treaty_broken", { name: WD.faction(fid).name }, "bad");
    }
  }

  function onCapitalBattle(state, objId, win, report, killed, enemyStart, enemyEnd, m) {
    var fid = factionIdOf(objId);
    var f = fs(state, fid);
    var def = WD.faction(fid);
    var out = null;
    if (win) {
      report.reward = factionReward(state, objId, m);
      report.captives = Math.floor(killed * 0.3);
      f.capitalHp -= 1;
      f.wins += 1;
      f.strength = Math.max(STRENGTH_MIN, f.strength * 0.55);
      f.mix = rollFactionMix(def);
      gainRelation(state, fid, 25, m);
      state.stats.conquests += 1;
      if (f.capitalHp <= 0) {
        f.destroyed = true;
        state.stats.destroyed += 1;
        report.destroyed = true;
        report.territory = def.territory.name;
        out = { territory: { id: "fac_" + fid, resource: def.territory.resource, richness: def.territory.richness, name: def.territory.name, angle: def.angle } };
        Core().log(state, "jm_log_faction_destroyed", { name: def.name }, "age");
      } else {
        Core().log(state, "jm_log_capital_hit", { name: def.name, n: f.capitalHp }, "good");
      }
    } else {
      f.strength = clamp(f.strength * (0.7 + 0.3 * (enemyEnd / Math.max(1, enemyStart))), STRENGTH_MIN, STRENGTH_MAX);
      f.relation = clamp(f.relation - 10, -100, 100);
    }
    return out;
  }

  function gainRelation(state, fid, n, m) {
    m = m || Core().mods(state);
    var f = fs(state, fid);
    var k = n > 0 ? 1 + Core().mod(m, "relation") : 1;
    f.relation = clamp(f.relation + n * k, -100, 100);
  }

  function pickRaider(state) {
    var cands = WD.FACTIONS.filter(function (def) {
      return present(state, def.id) && !atTruce(state, def.id) && !atPeace(state, def.id);
    });
    if (!cands.length) return null;
    var total = 0;
    cands.forEach(function (def) {
      total += fs(state, def.id).strength;
    });
    var r = Math.random() * total;
    var pick = cands[0];
    for (var i = 0; i < cands.length; i++) {
      r -= fs(state, cands[i].id).strength;
      if (r <= 0) {
        pick = cands[i];
        break;
      }
    }
    return { faction: pick.id, name: pick.name, angle: pick.angle + (Math.random() - 0.5) * 0.5, mult: fs(state, pick.id).strength, mix: pick.mix };
  }

  function onRaidResult(state, fid, won) {
    var f = fs(state, fid);
    if (won) {
      f.strength = Math.max(STRENGTH_MIN, f.strength * 0.92);
      gainRelation(state, fid, 10);
    } else {
      f.strength = Math.min(STRENGTH_MAX, f.strength * 1.05);
    }
  }

  // ---- 外交 ----

  function tributeCost(state, fid) {
    var m = Core().mods(state);
    var k = D.AGES[state.age].capMult * fs(state, fid).strength * Math.max(0.3, 1 + Core().mod(m, "tribute"));
    var c = { food: Math.round(350 * k) };
    if (state.age >= D.GOLD_AGE) c.gold = Math.round(120 * k);
    else c.wood = Math.round(150 * k);
    return c;
  }
  function peaceCost(state, fid) {
    var c = Core().scaleCost(tributeCost(state, fid), 0.5);
    return c;
  }
  function canTribute(state, fid) {
    return present(state, fid) && !atPeace(state, fid) && Core().canAfford(state, tributeCost(state, fid));
  }
  function tribute(state, fid) {
    if (!canTribute(state, fid)) return false;
    var f = fs(state, fid);
    Core().pay(state, tributeCost(state, fid));
    f.truceUntil = Math.max(f.truceUntil, state.time) + TRUCE_TIME;
    gainRelation(state, fid, 5);
    state.stats.peace += 1;
    Core().log(state, "jm_log_tribute", { name: WD.faction(fid).name, s: TRUCE_TIME }, "good");
    return true;
  }
  function canPeace(state, fid) {
    return present(state, fid) && fs(state, fid).relation >= PEACE_RELATION && Core().canAfford(state, peaceCost(state, fid));
  }
  function makePeace(state, fid) {
    if (!canPeace(state, fid)) return false;
    var f = fs(state, fid);
    Core().pay(state, peaceCost(state, fid));
    f.peaceUntil = Math.max(f.peaceUntil, state.time) + PEACE_TIME;
    state.stats.peace += 1;
    Core().log(state, "jm_log_peace", { name: WD.faction(fid).name, s: PEACE_TIME }, "good");
    return true;
  }

  // ---------------- 事件 ----------------

  function eligibleEvents(state) {
    return WD.EVENTS.filter(function (e) {
      return state.age >= e.minAge && state.age <= e.maxAge && !(e.once && state.eventsSeen[e.id]);
    });
  }

  function incomeAmount(state, r, sec) {
    var rt = Core().rates(state);
    var base = Math.max(rt.gross[r], 30 * D.AGES[state.age].capMult / 10);
    return Math.round(base * sec);
  }

  function effectCost(state, eff) {
    var c = {};
    keys(eff.cost).forEach(function (r) {
      c[r] = incomeAmount(state, r, eff.cost[r]);
    });
    return c;
  }
  function canChoose(state, idx) {
    var ev = state.event && WD.event(state.event.id);
    if (!ev || !ev.choices[idx]) return false;
    var eff = ev.choices[idx].effect;
    return !eff.cost || Core().canAfford(state, effectCost(state, eff));
  }

  function applyEffect(state, eff, evId, out) {
    var C = Core();
    if (eff.cost) C.pay(state, effectCost(state, eff));
    keys(eff.res).forEach(function (r) {
      var v = incomeAmount(state, r, Math.abs(eff.res[r]));
      state.res[r] = Math.max(0, state.res[r] + (eff.res[r] < 0 ? -v : v));
      out.push(["res", r, eff.res[r] < 0 ? -v : v]);
    });
    if (eff.mods) C.addTimedMods(state, evId, eff.mods, eff.dur || 120);
    if (eff.villagers) {
      var dv = Math.round(state.villagers * eff.villagers);
      if (dv > 0) dv = Math.min(dv, C.room(state));
      state.villagers = Math.max(1, state.villagers + dv);
      out.push(["villagers", dv]);
    }
    if (eff.soldiers) {
      keys(state.soldiers).forEach(function (c) {
        state.soldiers[c] = Math.max(0, Math.round(state.soldiers[c] * (1 + eff.soldiers)));
      });
    }
    if (eff.houses) {
      var dh = Math.round(state.buildings.house * eff.houses);
      state.buildings.house = Math.max(1, state.buildings.house + dh);
      out.push(["houses", dh]);
    }
    keys(eff.deposit).forEach(function (r) {
      state.deposits[r] = clamp(state.deposits[r] * (1 + eff.deposit[r]), 0, 1);
    });
    keys(eff.rich).forEach(function (r) {
      C.addRichness(state, r, eff.rich[r], null);
    });
    if (eff.relation) {
      WD.FACTIONS.forEach(function (def) {
        if (present(state, def.id)) gainRelation(state, def.id, eff.relation);
      });
    }
    if (eff.truce) {
      WD.FACTIONS.forEach(function (def) {
        var f = fs(state, def.id);
        f.truceUntil = Math.max(f.truceUntil, state.time) + eff.truce;
      });
    }
    if (eff.raid) {
      state.pendingRaid = { t: eff.raid.delay, name: eff.raid.name, mult: eff.raid.mult, angle: 0.1, mix: { infantry: 1.2, archer: 1.3, cavalry: 0.6, siege: 0.3 } };
    }
    if (eff.chance) {
      var ok = Math.random() < eff.chance.p;
      out.push(["chance", ok]);
      applyEffect(state, ok ? eff.chance.yes : eff.chance.no, evId, out);
    }
  }

  function chooseEvent(state, idx) {
    if (!canChoose(state, idx)) return null;
    var ev = WD.event(state.event.id);
    var out = [];
    applyEffect(state, ev.choices[idx].effect, ev.id, out);
    state.eventsSeen[ev.id] = (state.eventsSeen[ev.id] || 0) + 1;
    state.event = null;
    Core().log(state, "jm_log_event", { title: ev.title, choice: ev.choices[idx].label }, "info");
    var lucky = out.filter(function (o) {
      return o[0] === "chance";
    })[0];
    return { lucky: lucky ? lucky[1] : null, out: out };
  }

  // ---------------- 任務 ----------------

  function questValue(state, q) {
    switch (q.type) {
      case "houses":
        return state.buildings.house;
      case "pop":
        return Core().population(state);
      case "tc":
        return state.buildings.tc;
      case "techs":
        return keys(state.techs).length;
      case "conquer":
        return state.targets[q.param] ? state.targets[q.param].wins : 0;
      case "soldiers":
        return Core().soldiersHome(state) + Core().soldiersAway(state);
      case "age":
        return state.age;
      case "paddy":
        return state.buildings.paddy;
      case "territories":
        return state.territories.length;
      case "raidsWon":
        return state.stats.raidsWon;
      case "scouted":
        return state.stats.scouted;
      case "peace":
        return state.stats.peace;
      case "destroyed":
        return state.stats.destroyed;
      case "wall":
        return state.wallLevel;
      default:
        return 0;
    }
  }
  function questNeed(q) {
    return q.type === "conquer" ? 1 : q.param;
  }
  function questReward(q) {
    var k = WD.QUEST_SCALE[q.age] || 1;
    var out = {};
    keys(q.reward).forEach(function (r) {
      out[r] = q.reward[r] * k;
    });
    return out;
  }
  function activeQuests(state, n) {
    var out = [];
    for (var i = 0; i < WD.QUESTS.length && out.length < n; i++) {
      if (!state.quests[WD.QUESTS[i].id]) out.push(WD.QUESTS[i]);
    }
    return out;
  }

  function checkQuests(state) {
    WD.QUESTS.forEach(function (q) {
      if (state.quests[q.id]) return;
      if (questValue(state, q) < questNeed(q)) return;
      state.quests[q.id] = true;
      var rw = questReward(q);
      keys(rw).forEach(function (r) {
        state.res[r] += rw[r];
      });
      Core().log(state, "jm_log_quest", { name: "jm_quest_" + q.id }, "good");
      Core().pushFx(state, { kind: "quest" });
    });
  }

  // ---------------- 每步 ----------------

  function step(state, dt, opts) {
    var diff = Core().DIFFICULTY[state.difficulty].enemy;
    WD.FACTIONS.forEach(function (def) {
      if (!present(state, def.id)) return;
      var f = fs(state, def.id);
      var peaceful = atPeace(state, def.id) || atTruce(state, def.id);
      f.strength = Math.min(STRENGTH_MAX, f.strength + GROWTH * diff * (peaceful ? 0.4 : 1) * dt);
      if (f.relation > 0) f.relation = Math.max(0, f.relation - RELATION_DECAY * dt);
      else if (f.relation < 0) f.relation = Math.min(0, f.relation + RELATION_DECAY * dt);
    });
    // 事件
    if (!opts.offline && !state.event) {
      state.nextEvent -= dt;
      if (state.nextEvent <= 0) {
        var list = eligibleEvents(state);
        if (list.length) {
          var ev = list[Math.floor(Math.random() * list.length)];
          state.event = { id: ev.id, t: state.time };
        }
        state.nextEvent = EVENT_MIN + Math.random() * (EVENT_MAX - EVENT_MIN);
      }
    }
    // 任務（每秒檢查一次）
    state.questAcc = (state.questAcc || 0) + dt;
    if (state.questAcc >= 1) {
      state.questAcc = 0;
      checkQuests(state);
    }
  }

  window.PriTestJomonWorld = {
    TRUCE_TIME: TRUCE_TIME,
    PEACE_TIME: PEACE_TIME,
    PEACE_RELATION: PEACE_RELATION,
    init: init,
    migrate: migrate,
    step: step,
    objective: objective,
    nominalArmy: nominalArmy,
    factionArmy: factionArmy,
    factionReward: factionReward,
    onAttack: onAttack,
    onCapitalBattle: onCapitalBattle,
    pickRaider: pickRaider,
    onRaidResult: onRaidResult,
    factionState: fs,
    present: present,
    relationState: relationState,
    capitalSize: capitalSize,
    tributeCost: tributeCost,
    peaceCost: peaceCost,
    canTribute: canTribute,
    tribute: tribute,
    canPeace: canPeace,
    makePeace: makePeace,
    canChoose: canChoose,
    chooseEvent: chooseEvent,
    effectCost: effectCost,
    questValue: questValue,
    questNeed: questNeed,
    questReward: questReward,
    activeQuests: activeQuests,
  };
})();
