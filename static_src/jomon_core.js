// 繩文帝國（jomon）：遊戲引擎 —— state、即時模擬（採集、資源儲量、村民生產、自然增加、建造、研究、訓練、升時代）、
// 即時戰鬥（遠征與防衛，每 0.8 秒一回合，可切換戰術）、偵察情報、市集、存讀檔與離線收益。
// AI 勢力、外交、時代事件、任務在 jomon_world.js（以 hook 方式接進 step()）；畫面在 jomon.js，3D 在 jomon_scene3d.js／jomon_battle3d.js。
// 規則總覽見 docs/jomon_game_design.md；調整數值時請一併更新該文件。
(function () {
  "use strict";

  var D = window.PriTestJomonData;
  var WD = window.PriTestJomonWorldData;

  function W() {
    return window.PriTestJomonWorld || null;
  }

  // ---------------- 常數 ----------------

  var STATE_VERSION = 2; // v2：即時戰鬥、資源儲量、領地、勢力、事件、任務、偵察（2026-11-03）
  var SAVE_KEY = "pritest-jomon-save";

  var GATHER_BASE = { food: 0.6, wood: 0.5, stone: 0.35, gold: 0.35 }; // 每名村民每秒
  var AGE_GATHER_BONUS = 0.04; // 每個時代全資源採集 +4%（工具進步）
  var PADDY_MUL = 1.5; // 水田工作者的食物採集倍率
  var PADDY_WORKERS = 4; // 每塊水田可容納的工作者（× 容量倍率）
  var CAMP_WORKERS = 15; // 每座集散地可容納的採集者（× 容量倍率）
  var TC_CAMP_WORKERS = 10; // 村落中心兼任每種資源集散地的容量（× 容量倍率）
  var OVER_CAP_EFF = 0.35; // 超過集散地容量的採集者效率
  var UPKEEP = 0.08; // 每人每秒消耗食物（在村裡的村民與士兵；× (1 + 0.25 × 時代)，生活水準提高）
  var UPKEEP_AGE = 0.25;
  var VILLAGER_COST = 50; // 食物（× (1 + 0.6 × 時代)）
  var VILLAGER_AGE_COST = 0.6;
  var TC_CYCLE = 4; // 村落中心每 4 秒生產一輪（繩文時代 2.5 秒，見 AGES[].tcCycle）
  var TC_HOUSING = 20; // 村落中心人口上限（× 容量倍率）
  var BIRTH_RATE = 0.0004; // 自然增加：每秒人口的 0.04%（有空房、食物 > 100 時）
  var STARVE_RATE = 0.004; // 缺糧時每秒流失 0.4% 村民
  var TRAIN_CYCLE = 6; // 兵營每 6 秒訓練一輪
  var UNIT_AGE_STAT = 0.3; // 每個時代兵種攻擊／HP +30%
  var UNIT_AGE_COST = 0.25; // 每個時代兵種費用 +25%
  var WALL_DEF = 0.2; // 每級柵：守備 HP +20%
  var MILITIA_SHARE = 0.08; // 被襲擊時 8% 村民拿起武器
  var TOWER_ARCHERS = 3; // 每座望樓相當於 3 名不會陣亡的弓兵
  var TC_ARCHERS = 2; // 每座村落中心相當於 2 名
  var BATTLE_RATE = 0.2; // 每回合造成的傷害比例
  var BATTLE_MAX_ROUNDS = 40;
  var ROUND_TIME = 0.8; // 即時戰鬥：每回合 0.8 秒（遊戲時間）
  var RALLY_ROUNDS = 5; // 鼓舞：5 回合內攻擊 +40%（每場一次）
  var RALLY_ATK = 0.4;
  var RETREAT_LOSS = 0.1; // 主動撤退時殘兵再損失 10%
  var RETREAT_FRAC = 0.25; // 進攻方剩不到 25% 而對方還有 35% 以上就自動撤退
  var SIEGE_FORT_SHARE = 5; // 攻城兵器佔全軍 20% 即完全抵銷城塞防禦
  var STANCES = {
    normal: { atk: 1, taken: 1 },
    charge: { atk: 1.3, taken: 1.25 },
    hold: { atk: 0.75, taken: 0.7 },
  };
  var TARGET_LEVEL_ARMY = 1.5;
  var TARGET_LEVEL_LOOT = 1.4;
  var TARGET_RECOVER = 0.005; // 未被攻下的目標每秒恢復 0.5% 兵力
  var INTEL_TTL = 300; // 偵察情報有效 300 秒（目標等級改變就失效）
  var SCOUT_TIME = 0.5; // 偵察時間＝單程距離 × 0.5 ×（1 ＋ 偵察加成）
  var RAID_GRACE = 300; // 升上彌生時代後 300 秒內不會被襲擊
  var RAID_MIN = 200;
  var RAID_MAX = 380;
  var RAID_WARN = 45; // 來襲預警秒數
  var RAID_LOOT = 0.15; // 被攻破時損失 15% 資源
  var RAID_KILL = 0.03; // 被攻破時額外損失 3% 村民
  var MARKET_FEE = 0.3;
  var TRADE_INCOME = 0.01; // 交易收入：每人每秒 0.01 金 × 交易加成（需有市集）
  var OFFLINE_MAX = 3600; // 離線收益最多計算 1 小時（不會被襲擊，也不會發生事件）
  var LOG_MAX = 80;
  var REPORT_MAX = 12;

  var DIFFICULTY = {
    easy: { enemy: 0.7, raid: 0.6, loot: 1.2 },
    normal: { enemy: 1, raid: 1, loot: 1 },
    hard: { enemy: 1.35, raid: 1.4, loot: 0.9 },
  };

  // ---------------- 小工具 ----------------

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function rand() {
    return Math.random();
  }
  function keys(o) {
    return Object.keys(o || {});
  }

  // ---------------- state ----------------

  function freshTarget() {
    return { level: 0, cooldown: 0, strength: 1, wins: 0, mix: null };
  }

  function newState(difficulty) {
    var b = {};
    D.BUILDINGS.forEach(function (bd) {
      b[bd.id] = 0;
    });
    b.house = 3;
    b.tc = 1;
    b.foodcamp = 1;
    b.woodcamp = 1;
    var soldiers = {};
    var queue = {};
    D.UNIT_CLASSES.concat(["unique"]).forEach(function (c) {
      soldiers[c] = 0;
      queue[c] = 0;
    });
    var targets = {};
    D.TARGETS.forEach(function (tg) {
      targets[tg.id] = freshTarget();
    });
    var s = {
      version: STATE_VERSION,
      difficulty: DIFFICULTY[difficulty] ? difficulty : "normal",
      time: 0,
      age: 0,
      civ: null,
      landmarks: [],
      res: { food: 300, wood: 250, stone: 100, gold: 0 },
      villagers: 8,
      alloc: { food: 60, wood: 30, stone: 10, gold: 0 },
      autoVillagers: true,
      vilAcc: 0,
      birthAcc: 0,
      starveAcc: 0,
      buildings: b,
      constructing: [],
      wallLevel: 0,
      wallBuild: null,
      soldiers: soldiers,
      trainQueue: queue,
      trainAcc: {},
      techs: {},
      researching: [],
      ageUp: null,
      expeditions: [],
      nextExpeditionId: 1,
      targets: targets,
      intel: {},
      scouts: [],
      deposits: { food: 1, wood: 1, stone: 1, gold: 1 }, // 剩餘比例（0〜1）
      rich: { food: 0, wood: 0, stone: 0, gold: 0 }, // 事件給的家鄉儲量加成
      territories: [],
      timedMods: [],
      raid: null,
      nextRaid: null,
      pendingRaid: null,
      factions: {},
      event: null,
      nextEvent: null,
      eventsSeen: {},
      quests: {},
      stats: { kills: 0, conquests: 0, raidsWon: 0, raidsLost: 0, peakPop: 8, lost: 0, captives: 0, scouted: 0, peace: 0, destroyed: 0 },
      log: [],
      reports: [],
      victory: null,
      lastSave: Date.now(),
      speed: 1,
      paused: false,
      fx: [],
    };
    if (W()) W().init(s);
    return s;
  }

  function log(state, key, params, kind) {
    state.logSeq = (state.logSeq || 0) + 1;
    state.log.unshift({ id: state.logSeq, t: state.time, key: key, params: params || {}, kind: kind || "info" });
    if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
  }

  // 3D 畫面的一次性特效（研究完成、佔領領地……）：jomon.js 取走後交給場景
  function pushFx(state, fx) {
    if (!state.fx) state.fx = [];
    state.fx.push(fx);
    if (state.fx.length > 10) state.fx.shift();
  }

  // ---------------- 加成 ----------------

  function modSources(state) {
    var list = [];
    keys(state.techs).forEach(function (id) {
      var tc = D.tech(id);
      if (tc) list.push(tc.mods);
    });
    state.landmarks.forEach(function (id) {
      var lm = D.landmark(id);
      if (lm) list.push(lm.mods);
    });
    var cv = state.civ && D.civ(state.civ);
    if (cv) list.push(cv.mods);
    (state.timedMods || []).forEach(function (tm) {
      list.push(tm.mods);
    });
    return list;
  }

  function mods(state) {
    var out = {};
    modSources(state).forEach(function (m) {
      keys(m).forEach(function (k) {
        out[k] = (out[k] || 0) + m[k];
      });
    });
    return out;
  }
  function mod(m, k) {
    return m[k] || 0;
  }

  function addTimedMods(state, id, m, dur) {
    state.timedMods.push({ id: id, mods: m, t: dur, total: dur });
  }

  function ageData(state) {
    return D.AGES[state.age];
  }

  function gatherMul(state, m, r) {
    return Math.max(0.1, 1 + mod(m, "gather." + r) + mod(m, "gather.all") + state.age * AGE_GATHER_BONUS);
  }

  // ---------------- 人口 ----------------

  function soldiersHome(state) {
    var n = 0;
    keys(state.soldiers).forEach(function (c) {
      n += state.soldiers[c];
    });
    return n;
  }
  function soldiersAway(state) {
    var n = 0;
    state.expeditions.forEach(function (ex) {
      n += sumArmy(ex.army);
    });
    return n;
  }
  function population(state) {
    return state.villagers + soldiersHome(state) + soldiersAway(state);
  }
  function housing(state, m) {
    m = m || mods(state);
    var a = ageData(state);
    var houses = state.buildings.house * a.houseCap * (1 + mod(m, "housing"));
    var tcs = state.buildings.tc * TC_HOUSING * a.capMult;
    return Math.floor(houses + tcs);
  }
  function room(state, m) {
    return Math.max(0, housing(state, m) - population(state));
  }

  // ---------------- 資源儲量與領地 ----------------

  function richness(state, r) {
    var n = 1 + (state.rich[r] || 0);
    state.territories.forEach(function (t) {
      if (t.resource === r) n += t.richness;
    });
    return n;
  }
  // 儲量與再生隨時代成長：× 容量倍率^1.25（新工具能開採更深、更遠的資源）
  function depositScale(state) {
    return Math.pow(ageData(state).capMult, 1.25);
  }
  function depositMax(state, r) {
    return WD.DEPOSITS[r].base * depositScale(state) * richness(state, r);
  }
  function depositRegen(state, r, m) {
    m = m || mods(state);
    return WD.DEPOSITS[r].regen * depositScale(state) * richness(state, r) * (1 + mod(m, "regen"));
  }
  function depositEff(state, r) {
    var f = state.deposits[r];
    if (f >= 0.05) return 1;
    return WD.DEPLETED_EFF + (1 - WD.DEPLETED_EFF) * (Math.max(0, f) / 0.05);
  }
  function depositInfo(state, r, m) {
    var max = depositMax(state, r);
    return { frac: state.deposits[r], amount: state.deposits[r] * max, max: max, regen: depositRegen(state, r, m), eff: depositEff(state, r) };
  }
  // 增加某資源的儲量來源（領地、事件），保持「已用掉的量」不變，新來源是滿的
  function addRichness(state, r, add, territory) {
    var oldMax = depositMax(state, r);
    var amt = state.deposits[r] * oldMax;
    if (territory) state.territories.push(territory);
    else state.rich[r] = (state.rich[r] || 0) + add;
    var newMax = depositMax(state, r);
    state.deposits[r] = clamp((amt + (newMax - oldMax)) / newMax, 0, 1);
  }
  function addTerritory(state, t) {
    if (
      state.territories.some(function (x) {
        return x.id === t.id;
      })
    )
      return false;
    addRichness(state, t.resource, t.richness, { id: t.id, resource: t.resource, richness: t.richness, name: t.name, angle: t.angle });
    log(state, "jm_log_territory", { name: t.name, res: "jm_res_" + t.resource }, "good");
    pushFx(state, { kind: "territory", angle: t.angle || 0 });
    return true;
  }

  // ---------------- 採集 ----------------

  function workers(state) {
    var al = state.alloc;
    var useGold = state.age >= D.GOLD_AGE;
    var w = { food: al.food, wood: al.wood, stone: al.stone, gold: useGold ? al.gold : 0 };
    var sum = w.food + w.wood + w.stone + w.gold;
    var out = { food: 0, wood: 0, stone: 0, gold: 0 };
    if (sum <= 0) return out;
    D.RESOURCES.forEach(function (r) {
      out[r] = (state.villagers * w[r]) / sum;
    });
    return out;
  }

  function efficiency(workersN, cap) {
    if (workersN <= cap || workersN <= 0) return 1;
    return (cap + (workersN - cap) * OVER_CAP_EFF) / workersN;
  }

  function campCaps(state, m) {
    var a = ageData(state);
    var k = a.capMult * (1 + mod(m, "campCap"));
    var tc = state.buildings.tc * TC_CAMP_WORKERS;
    return {
      food: (state.buildings.foodcamp * CAMP_WORKERS + tc) * k,
      wood: (state.buildings.woodcamp * CAMP_WORKERS + tc) * k,
      mine: (state.buildings.minecamp * CAMP_WORKERS + tc) * k,
      paddy: state.buildings.paddy * PADDY_WORKERS * a.capMult * (1 + mod(m, "paddyCap")),
    };
  }

  // 每秒收支（不含村民生產的花費）。draw＝從儲量取走的量（水田的食物不消耗儲量）
  function rates(state, m) {
    m = m || mods(state);
    var w = workers(state);
    var caps = campCaps(state, m);
    var effFood = efficiency(w.food, caps.food);
    var effWood = efficiency(w.wood, caps.wood);
    var effMine = efficiency(w.stone + w.gold, caps.mine);
    var dep = { food: depositEff(state, "food"), wood: depositEff(state, "wood"), stone: depositEff(state, "stone"), gold: depositEff(state, "gold") };
    var farmers = Math.min(w.food, caps.paddy);
    var paddyFood = farmers * GATHER_BASE.food * PADDY_MUL * (1 + mod(m, "paddy")) * effFood * gatherMul(state, m, "food");
    var forageFood = (w.food - farmers) * GATHER_BASE.food * effFood * gatherMul(state, m, "food") * dep.food;
    var wood = w.wood * GATHER_BASE.wood * effWood * gatherMul(state, m, "wood") * dep.wood;
    var stone = w.stone * GATHER_BASE.stone * effMine * gatherMul(state, m, "stone") * dep.stone;
    var gold = w.gold * GATHER_BASE.gold * effMine * gatherMul(state, m, "gold") * dep.gold;
    var food = paddyFood + forageFood;
    var upkeep = (state.villagers + soldiersHome(state)) * UPKEEP * (1 + UPKEEP_AGE * state.age);
    var trade = state.buildings.market > 0 ? population(state) * TRADE_INCOME * mod(m, "tradeIncome") : 0;
    var drawK = Math.max(0.2, 1 + mod(m, "depletion"));
    return {
      gross: { food: food, wood: wood, stone: stone, gold: gold + trade },
      net: { food: food - upkeep, wood: wood, stone: stone, gold: gold + trade },
      draw: { food: forageFood * drawK, wood: wood * drawK, stone: stone * drawK, gold: gold * drawK },
      upkeep: upkeep,
      trade: trade,
      workers: w,
      caps: caps,
      eff: { food: effFood, wood: effWood, stone: effMine, gold: effMine },
      depEff: dep,
      farmers: farmers,
    };
  }

  // ---------------- 費用 ----------------

  function scaleCost(cost, mul) {
    var out = {};
    keys(cost).forEach(function (r) {
      out[r] = Math.ceil(cost[r] * mul);
    });
    return out;
  }
  function canAfford(state, cost) {
    return keys(cost).every(function (r) {
      return state.res[r] >= cost[r] - 1e-9;
    });
  }
  function pay(state, cost) {
    keys(cost).forEach(function (r) {
      state.res[r] -= cost[r];
    });
  }
  function maxAffordable(state, cost) {
    var n = Infinity;
    keys(cost).forEach(function (r) {
      if (cost[r] > 0) n = Math.min(n, Math.floor(state.res[r] / cost[r]));
    });
    return n === Infinity ? 0 : n;
  }

  function buildingCost(state, id) {
    var bd = D.building(id);
    return scaleCost(bd.cost, 1 + bd.costGrowth * state.age);
  }
  function buildingCount(state, id) {
    var n = state.buildings[id] || 0;
    state.constructing.forEach(function (c) {
      if (c.id === id) n += c.n;
    });
    return n;
  }
  function buildingLimit(state, id) {
    var bd = D.building(id);
    if (id === "tc") return ageData(state).maxTC;
    if (bd.max) return bd.max;
    return Infinity;
  }
  function canBuild(state, id) {
    var bd = D.building(id);
    return !!bd && state.age >= bd.age && buildingCount(state, id) < buildingLimit(state, id);
  }
  function build(state, id, n) {
    if (!canBuild(state, id)) return 0;
    var cost = buildingCost(state, id);
    n = Math.min(n, maxAffordable(state, cost), buildingLimit(state, id) - buildingCount(state, id));
    n = Math.floor(n);
    if (n <= 0) return 0;
    pay(state, scaleCost(cost, n));
    var bd = D.building(id);
    var total = bd.time * (1 + (Math.log(n) / Math.LN10) * 0.6);
    state.constructing.push({ id: id, n: n, t: total, total: total });
    return n;
  }

  function wallCost(state) {
    var next = D.WALL_LEVELS[state.wallLevel + 1];
    return next ? next.cost : null;
  }
  function canWall(state) {
    var next = D.WALL_LEVELS[state.wallLevel + 1];
    return !!next && !state.wallBuild && state.age >= next.age && canAfford(state, next.cost);
  }
  function buildWall(state) {
    if (!canWall(state)) return false;
    var next = D.WALL_LEVELS[state.wallLevel + 1];
    pay(state, next.cost);
    var total = 25 + state.wallLevel * 15;
    state.wallBuild = { t: total, total: total };
    return true;
  }

  // ---------------- 研究 ----------------

  function techCost(state, id, m) {
    m = m || mods(state);
    var tc = D.tech(id);
    return scaleCost(tc.cost, Math.max(0.3, 1 + mod(m, "techCost")));
  }
  // 互斥分支：同組已研究（或研究中）的那一項
  function groupTaken(state, group) {
    if (!group) return null;
    var hit = null;
    D.TECHS.forEach(function (tc) {
      if (tc.group !== group) return;
      if (
        state.techs[tc.id] ||
        state.researching.some(function (r) {
          return r.id === tc.id;
        })
      )
        hit = tc.id;
    });
    return hit;
  }
  function techAvailable(state, id) {
    var tc = D.tech(id);
    if (!tc || state.techs[id]) return false;
    if (tc.civ && tc.civ !== state.civ) return false;
    if (state.age < tc.age) return false;
    if (tc.group && groupTaken(state, tc.group)) return false;
    return !state.researching.some(function (r) {
      return r.id === id;
    });
  }
  function research(state, id) {
    if (!techAvailable(state, id)) return false;
    var m = mods(state);
    var cost = techCost(state, id, m);
    if (!canAfford(state, cost)) return false;
    pay(state, cost);
    var total = D.tech(id).time / Math.max(0.2, 1 + mod(m, "researchSpeed"));
    state.researching.push({ id: id, t: total, total: total });
    return true;
  }

  // 研究完成時的特效位置類別（依加成鍵判斷）
  function techFxKind(tc) {
    var ks = keys(tc.mods).join(" ");
    if (/gather\.food|paddy|birth/.test(ks)) return "food";
    if (/gather\.wood|regen/.test(ks)) return "wood";
    if (/gather\.stone|gather\.gold|depletion/.test(ks)) return "mine";
    if (/atk|hp\.|trainSpeed/.test(ks)) return "army";
    if (/defense/.test(ks)) return "wall";
    if (/housing/.test(ks)) return "house";
    return "tc";
  }

  // ---------------- 升時代 ----------------

  function ageUpCost(state, m) {
    m = m || mods(state);
    var a = ageData(state);
    if (!a.cost) return null;
    return scaleCost(a.cost, Math.max(0.4, 1 + mod(m, "ageCost")));
  }
  function ageUpStatus(state) {
    var a = ageData(state);
    if (!a.popToNext) return { ok: false, final: true };
    var cost = ageUpCost(state);
    var pop = population(state);
    return {
      ok: !state.ageUp && pop >= a.popToNext && canAfford(state, cost),
      popOk: pop >= a.popToNext,
      costOk: canAfford(state, cost),
      busy: !!state.ageUp,
      pop: pop,
      need: a.popToNext,
      cost: cost,
      needCiv: state.age + 1 === D.CIV_AGE,
      nextId: D.AGES[state.age + 1].id,
    };
  }
  function startAgeUp(state, landmarkId, civId) {
    var st = ageUpStatus(state);
    if (!st.ok) return false;
    var opts = D.LANDMARKS[st.nextId] || [];
    if (
      !opts.some(function (l) {
        return l.id === landmarkId;
      })
    )
      return false;
    if (st.needCiv && !D.civ(civId)) return false;
    pay(state, st.cost);
    var total = ageData(state).time;
    state.ageUp = { t: total, total: total, landmark: landmarkId, civ: st.needCiv ? civId : null };
    return true;
  }

  // ---------------- 兵種 ----------------

  function unitDef(state, cls) {
    if (cls === "unique") {
      var cv = state.civ && D.civ(state.civ);
      if (!cv) return null;
      var base = D.UNITS[cv.unique.base];
      return { cls: "unique", base: base.id, building: base.building, age: D.CIV_AGE, atk: base.atk * cv.unique.atkMul, hp: base.hp * cv.unique.hpMul, cost: scaleCost(base.cost, cv.unique.costMul), icon: cv.unique.icon, name: cv.unique.name, extraCounters: cv.unique.extraCounters || null, note: cv.unique.note };
    }
    var u = D.UNITS[cls];
    return { cls: cls, base: cls, building: u.building, age: u.age, atk: u.atk, hp: u.hp, cost: u.cost, icon: u.icon, name: u.names[state.age] || u.names[0], extraCounters: null, note: u.note };
  }
  function unitCost(state, cls) {
    var u = unitDef(state, cls);
    if (!u) return null;
    var cost = scaleCost(u.cost, 1 + UNIT_AGE_COST * state.age);
    // 古墳時代起，槍兵、劍兵等近戰兵也需要少量金（鐵製武器）；弓兵不需要
    if (state.age >= D.GOLD_AGE && !cost.gold && u.base !== "archer") cost.gold = Math.ceil(10 * (1 + UNIT_AGE_COST * state.age));
    return cost;
  }
  function unitStats(state, cls, m) {
    m = m || mods(state);
    var u = unitDef(state, cls);
    var k = 1 + UNIT_AGE_STAT * state.age;
    return {
      atk: u.atk * k * Math.max(0.1, 1 + mod(m, "atk.all") + mod(m, "atk." + u.base)),
      hp: u.hp * k * Math.max(0.1, 1 + mod(m, "hp.all") + mod(m, "hp." + u.base)),
    };
  }
  function canTrain(state, cls) {
    var u = unitDef(state, cls);
    return !!u && state.age >= u.age && state.buildings[u.building] > 0;
  }
  function train(state, cls, n) {
    if (!canTrain(state, cls)) return 0;
    var cost = unitCost(state, cls);
    n = Math.floor(Math.min(n, maxAffordable(state, cost)));
    if (n <= 0) return 0;
    pay(state, scaleCost(cost, n));
    state.trainQueue[cls] = (state.trainQueue[cls] || 0) + n;
    return n;
  }
  function cancelTrain(state, cls) {
    var n = state.trainQueue[cls] || 0;
    if (n <= 0) return 0;
    var cost = unitCost(state, cls);
    keys(cost).forEach(function (r) {
      state.res[r] += cost[r] * n;
    });
    state.trainQueue[cls] = 0;
    state.trainAcc[cls] = 0;
    return n;
  }
  function trainRate(state, cls, m) {
    m = m || mods(state);
    var u = unitDef(state, cls);
    if (!u) return 0;
    var batch = Math.max(1, ageData(state).tcBatch / 2);
    return (state.buildings[u.building] * batch * Math.max(0.1, 1 + mod(m, "trainSpeed"))) / TRAIN_CYCLE;
  }
  function villagerRate(state, m) {
    m = m || mods(state);
    var a = ageData(state);
    return (state.buildings.tc * a.tcBatch * Math.max(0.1, 1 + mod(m, "tcSpeed"))) / (a.tcCycle || TC_CYCLE);
  }
  function villagerCost(state) {
    return Math.round(VILLAGER_COST * (1 + VILLAGER_AGE_COST * state.age));
  }
  function birthRate(state, m) {
    m = m || mods(state);
    return population(state) * BIRTH_RATE * Math.max(0, 1 + mod(m, "birth"));
  }

  // ---------------- 戰鬥（即時：每回合 ROUND_TIME 秒） ----------------

  function counterMul(group, targetCls) {
    var table = D.COUNTERS[group.base] || {};
    var v = table[targetCls] || 1;
    if (group.extraCounters && group.extraCounters[targetCls]) v *= group.extraCounters[targetCls];
    return v;
  }

  function playerGroups(state, army, m, hpMul) {
    var out = [];
    keys(army).forEach(function (cls) {
      if (!army[cls]) return;
      var u = unitDef(state, cls);
      if (!u) return;
      var s = unitStats(state, cls, m);
      out.push({ cls: cls, base: u.base, n: army[cls], n0: army[cls], atk: s.atk, hp: s.hp * (hpMul || 1), extraCounters: u.extraCounters });
    });
    return out;
  }

  function enemyGroups(army, tier, statMul, countMul) {
    var out = [];
    keys(army).forEach(function (cls) {
      if (!army[cls]) return;
      var n = Math.max(1, Math.round(army[cls] * countMul));
      var u = D.UNITS[cls] || D.SPECIAL_UNITS[cls];
      var k = (1 + UNIT_AGE_STAT * tier) * statMul;
      out.push({ cls: cls, base: cls, n: n, n0: n, atk: u.atk * k, hp: u.hp * k });
    });
    return out;
  }

  function alive(groups) {
    var n = 0;
    groups.forEach(function (g) {
      if (!g.immortal) n += g.n;
    });
    return n;
  }
  function total0(groups) {
    var n = 0;
    groups.forEach(function (g) {
      if (!g.immortal) n += g.n0;
    });
    return n;
  }

  function dealDamage(src, dst, mul) {
    var dmg = dst.map(function () {
      return 0;
    });
    var weightTotal = 0;
    dst.forEach(function (g) {
      if (!g.immortal && g.n > 0) weightTotal += g.n;
    });
    if (weightTotal <= 0) return dmg;
    src.forEach(function (g) {
      if (g.n <= 0) return;
      var out = g.n * g.atk * BATTLE_RATE * mul;
      dst.forEach(function (t, i) {
        if (t.immortal || t.n <= 0) return;
        dmg[i] += out * (t.n / weightTotal) * counterMul(g, t.base);
      });
    });
    return dmg;
  }

  // A 進攻 B。opt.fort：B 的城塞；opt.player：玩家是哪一方（"A"／"B"／null），戰術只影響玩家那方
  function createBattle(A, B, opt) {
    opt = opt || {};
    var siege = 0;
    A.forEach(function (g) {
      if (g.base === "siege") siege += g.n;
    });
    var aTotal = alive(A);
    var fort = opt.fort || 0;
    return {
      A: A,
      B: B,
      fort: fort,
      effFort: fort * Math.max(0, 1 - (aTotal > 0 ? siege / aTotal : 0) * SIEGE_FORT_SHARE),
      player: opt.player || null,
      round: 0,
      acc: 0,
      stance: opt.player === "B" ? "hold" : "normal",
      rally: 0,
      rallyUsed: false,
      over: false,
      winner: null,
      retreated: false,
      hist: [{ a: alive(A), b: alive(B) }],
      events: [],
    };
  }

  function battleRound(bt) {
    if (bt.over) return;
    var st = STANCES[bt.stance] || STANCES.normal;
    var rallyMul = bt.rally > 0 ? 1 + RALLY_ATK : 1;
    var aAtk = bt.player === "A" ? st.atk * rallyMul : 1;
    var bAtk = bt.player === "B" ? st.atk * rallyMul : 1;
    var aTaken = bt.player === "A" ? st.taken : 1;
    var bTaken = bt.player === "B" ? st.taken : 1;
    var dToB = dealDamage(bt.A, bt.B, aAtk / (1 + bt.effFort));
    var dToA = dealDamage(bt.B, bt.A, bAtk);
    if (bt.effFort > 0) {
      // 攻城兵器不吃城塞減傷：補回差額
      var extra = dealDamage(
        bt.A.filter(function (g) {
          return g.base === "siege";
        }),
        bt.B,
        aAtk * (1 - 1 / (1 + bt.effFort))
      );
      extra.forEach(function (v, i) {
        dToB[i] += v;
      });
    }
    bt.B.forEach(function (g, i) {
      if (!g.immortal) g.n = Math.max(0, g.n - (dToB[i] * bTaken) / g.hp);
    });
    bt.A.forEach(function (g, i) {
      if (!g.immortal) g.n = Math.max(0, g.n - (dToA[i] * aTaken) / g.hp);
    });
    bt.A.forEach(function (g) {
      if (g.n < 0.5) g.n = 0;
    });
    bt.B.forEach(function (g) {
      if (g.n < 0.5) g.n = 0;
    });
    if (bt.rally > 0) bt.rally -= 1;
    bt.round += 1;
    var aa = alive(bt.A);
    var bb = alive(bt.B);
    bt.hist.push({ a: aa, b: bb });
    if (bb <= 0) return endBattle(bt, "A", false);
    if (aa <= 0) return endBattle(bt, "B", false);
    if (aa / Math.max(1, total0(bt.A)) < RETREAT_FRAC && bb / Math.max(1, total0(bt.B)) > 0.35) return endBattle(bt, "B", true);
    if (bt.round >= BATTLE_MAX_ROUNDS) {
      var w = aa / Math.max(1, total0(bt.A)) >= bb / Math.max(1, total0(bt.B)) ? "A" : "B";
      return endBattle(bt, w, w === "B");
    }
  }

  function endBattle(bt, winner, retreated) {
    bt.over = true;
    bt.winner = winner;
    bt.retreated = !!retreated;
    if (winner === "A") {
      // 守方殘兵潰散
      bt.B.forEach(function (g) {
        if (!g.immortal) g.n = 0;
      });
    }
    bt.A.forEach(function (g) {
      g.n = Math.round(g.n);
    });
    bt.B.forEach(function (g) {
      g.n = Math.round(g.n);
    });
  }

  // 玩家主動撤退（只有進攻方能撤）
  function retreatBattle(bt) {
    if (bt.over || bt.player !== "A") return false;
    bt.A.forEach(function (g) {
      g.n = g.n * (1 - RETREAT_LOSS);
    });
    endBattle(bt, "B", true);
    bt.manualRetreat = true;
    return true;
  }

  function runBattle(bt) {
    while (!bt.over) battleRound(bt);
    return bt;
  }

  // 推進即時戰鬥；回傳是否剛結束
  function advanceBattle(bt, dt) {
    if (bt.over) return false;
    bt.acc += dt;
    while (bt.acc >= ROUND_TIME && !bt.over) {
      bt.acc -= ROUND_TIME;
      battleRound(bt);
    }
    return bt.over;
  }

  function summarize(groups) {
    var out = {};
    groups.forEach(function (g) {
      if (g.immortal) return;
      out[g.cls] = { start: g.n0, end: g.n };
    });
    return out;
  }

  // ---------------- 討伐目標與「目標」介面 ----------------
  // 目標可以是 D.TARGETS 的 NPC，或 jomon_world.js 提供的勢力本拠（id 以 "fac_" 開頭）。

  function targetState(state, id) {
    return state.targets[id] || (state.targets[id] = freshTarget());
  }

  // 每次等級變化時重新擲一次兵種比例（偵察才知道）
  function rollMix(tg) {
    var mix = {};
    keys(tg.army).forEach(function (c) {
      mix[c] = 0.5 + rand() * 1.1;
    });
    return mix;
  }

  function objective(state, id) {
    if (id.indexOf("fac_") === 0) return W() ? W().objective(state, id) : null;
    var tg = D.target(id);
    if (!tg) return null;
    var ts = targetState(state, id);
    return {
      id: id,
      kind: "target",
      name: tg.name,
      icon: tg.icon,
      desc: tg.desc,
      dist: tg.dist,
      tier: tg.tier,
      fort: tg.fort,
      statMul: tg.statMul,
      captives: tg.captives,
      level: ts.level,
      angle: expeditionAngle(id),
      available: state.age >= tg.age && ts.cooldown <= 0,
    };
  }

  function targetAvailable(state, id) {
    var o = objective(state, id);
    return !!o && o.available;
  }

  // 名目兵力（不含隨機比例；沒偵察時玩家看到的推測）
  function nominalArmy(state, id) {
    if (id.indexOf("fac_") === 0) return W().nominalArmy(state, id);
    var tg = D.target(id);
    var ts = targetState(state, id);
    var k = Math.pow(TARGET_LEVEL_ARMY, ts.level) * DIFFICULTY[state.difficulty].enemy;
    var out = {};
    keys(tg.army).forEach(function (c) {
      out[c] = Math.max(1, Math.round(tg.army[c] * k));
    });
    return out;
  }

  // 實際兵力
  function targetArmy(state, id) {
    if (id.indexOf("fac_") === 0) return W().factionArmy(state, id);
    var tg = D.target(id);
    var ts = targetState(state, id);
    if (!ts.mix) ts.mix = rollMix(tg);
    var k = Math.pow(TARGET_LEVEL_ARMY, ts.level) * ts.strength * DIFFICULTY[state.difficulty].enemy;
    // 比例變化但總數維持
    var wsum = 0;
    var msum = 0;
    keys(tg.army).forEach(function (c) {
      wsum += tg.army[c];
      msum += tg.army[c] * ts.mix[c];
    });
    var norm = msum > 0 ? wsum / msum : 1;
    var out = {};
    keys(tg.army).forEach(function (c) {
      out[c] = Math.max(1, Math.round(tg.army[c] * ts.mix[c] * norm * k));
    });
    return out;
  }

  function targetReward(state, id, m) {
    m = m || mods(state);
    if (id.indexOf("fac_") === 0) return W().factionReward(state, id, m);
    var tg = D.target(id);
    var ts = targetState(state, id);
    var k = Math.pow(TARGET_LEVEL_LOOT, ts.level) * (1 + mod(m, "loot")) * DIFFICULTY[state.difficulty].loot;
    var out = {};
    keys(tg.reward).forEach(function (r) {
      if (r === "gold" && state.age < D.GOLD_AGE) return;
      out[r] = Math.round(tg.reward[r] * k);
    });
    return out;
  }

  function travelTime(state, id, army, m) {
    m = m || mods(state);
    var o = objective(state, id);
    var k = Math.max(0.3, 1 + mod(m, "travel"));
    var onlyCav = true;
    var any = false;
    keys(army).forEach(function (c) {
      if (!army[c]) return;
      any = true;
      var u = unitDef(state, c);
      if (!u || u.base !== "cavalry") onlyCav = false;
    });
    if (any && onlyCav) k *= 0.75;
    return o.dist * k;
  }

  // ---- 偵察 ----

  function intelValid(state, id) {
    var it = state.intel[id];
    if (!it) return false;
    if (state.time - it.t > INTEL_TTL) return false;
    var o = objective(state, id);
    return !!o && it.level === o.level;
  }
  function knownArmy(state, id) {
    return intelValid(state, id) ? state.intel[id].army : null;
  }
  function scoutCost(state) {
    var k = ageData(state).capMult;
    var c = { food: Math.round(60 * k) };
    if (state.age >= D.GOLD_AGE) c.gold = Math.round(25 * k);
    return c;
  }
  function scoutTime(state, id, m) {
    m = m || mods(state);
    var o = objective(state, id);
    return o.dist * SCOUT_TIME * Math.max(0.2, 1 + mod(m, "scout"));
  }
  function scouting(state, id) {
    return state.scouts.some(function (s) {
      return s.id === id;
    });
  }
  function scout(state, id) {
    var o = objective(state, id);
    if (!o || scouting(state, id)) return false;
    var cost = scoutCost(state);
    if (!canAfford(state, cost)) return false;
    pay(state, cost);
    var total = scoutTime(state, id);
    state.scouts.push({ id: id, t: total, total: total, angle: o.angle });
    return true;
  }
  function finishScout(state, sc) {
    var o = objective(state, sc.id);
    if (!o) return;
    state.intel[sc.id] = { t: state.time, level: o.level, army: targetArmy(state, sc.id) };
    state.stats.scouted += 1;
    log(state, "jm_log_scouted", { target: o.name }, "war");
  }

  // 預估勝負：有情報用真實兵力，沒有就用名目兵力（estimate=true）
  function previewBattle(state, id, army) {
    var o = objective(state, id);
    if (!o) return null;
    var m = mods(state);
    var A = playerGroups(state, army, m, 1);
    if (!A.length) return null;
    var known = knownArmy(state, id);
    var enemy = known || nominalArmy(state, id);
    var B = enemyGroups(enemy, o.tier, o.statMul || 1, known ? 1 : o.kind === "target" ? targetState(state, id).strength : 1);
    var bt = runBattle(createBattle(A, B, { fort: o.fort, player: "A" }));
    var lost = 0;
    var sent = 0;
    A.forEach(function (g) {
      lost += g.n0 - g.n;
      sent += g.n0;
    });
    return { win: bt.winner === "A", lost: lost, sent: sent, rounds: bt.round, estimate: !known };
  }

  // ---- 遠征 ----

  function sendExpedition(state, id, army) {
    if (!targetAvailable(state, id)) return false;
    // 村子正在防衛戰時，留守的兵不能離開
    if (state.raid && state.raid.phase === "battle") return false;
    var clean = {};
    var any = false;
    keys(army).forEach(function (c) {
      var n = Math.floor(Math.min(army[c] || 0, state.soldiers[c] || 0));
      if (n > 0) {
        clean[c] = n;
        any = true;
      }
    });
    if (!any) return false;
    if (
      state.expeditions.some(function (ex) {
        return ex.target === id && ex.phase !== "back";
      })
    )
      return false;
    keys(clean).forEach(function (c) {
      state.soldiers[c] -= clean[c];
    });
    var o = objective(state, id);
    if (o.kind === "faction") W().onAttack(state, o.faction);
    var total = travelTime(state, id, clean);
    state.expeditions.push({ id: state.nextExpeditionId++, target: id, army: clean, sent: clean, phase: "go", t: total, total: total, angle: o.angle, report: null, battle: null });
    log(state, "jm_log_expedition_sent", { target: o.name, n: sumArmy(clean) }, "war");
    return true;
  }

  function expeditionAngle(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    // 遠征往西、北、南方向出發（東邊是海）
    return Math.PI * 0.55 + ((h % 1000) / 1000) * Math.PI * 1.1;
  }

  function sumArmy(a) {
    var n = 0;
    keys(a).forEach(function (c) {
      n += a[c] || 0;
    });
    return n;
  }

  // 抵達：開始即時戰鬥
  function startExpeditionBattle(state, ex) {
    var o = objective(state, ex.target);
    var m = mods(state);
    var A = playerGroups(state, ex.army, m, 1);
    var B = enemyGroups(targetArmy(state, ex.target), o.tier, o.statMul || 1, 1);
    ex.phase = "battle";
    ex.battle = createBattle(A, B, { fort: o.fort, player: "A" });
    ex.battle.terrain = o.fort > 0.45 ? "fort" : o.fort > 0 ? "palisade" : o.kind === "faction" ? "fort" : "field";
    ex.battle.title = o.name;
    ex.battle.tier = o.tier;
    log(state, "jm_log_battle_start", { target: o.name }, "war");
  }

  function finishExpeditionBattle(state, ex) {
    var bt = ex.battle;
    var o = objective(state, ex.target);
    var m = mods(state);
    var survivors = {};
    bt.A.forEach(function (g) {
      survivors[g.cls] = g.n;
    });
    var enemyStart = 0;
    var enemyEnd = 0;
    bt.B.forEach(function (g) {
      enemyStart += g.n0;
      enemyEnd += g.n;
    });
    var killed = enemyStart - enemyEnd;
    var win = bt.winner === "A";
    var report = {
      kind: "expedition",
      target: ex.target,
      name: o.name,
      tier: o.tier,
      win: win,
      retreated: bt.retreated,
      rounds: bt.hist,
      mine: summarize(bt.A),
      theirs: summarize(bt.B),
      reward: {},
      captives: 0,
      level: o.level,
      time: state.time,
    };
    state.stats.kills += killed;
    var lost = sumArmy(ex.army) - sumArmy(survivors);
    state.stats.lost += lost;
    if (o.kind === "faction") {
      var fr = W().onCapitalBattle(state, ex.target, win, report, killed, enemyStart, enemyEnd, m);
      if (fr && fr.territory) ex.territory = fr.territory;
    } else {
      var tg = D.target(ex.target);
      var ts = targetState(state, ex.target);
      if (win) {
        report.reward = targetReward(state, ex.target, m);
        report.captives = Math.floor(killed * tg.captives);
        ts.level += 1;
        ts.wins += 1;
        ts.strength = 1;
        ts.cooldown = tg.cooldown;
        ts.mix = rollMix(tg);
        state.stats.conquests += 1;
        if (tg.territory && ts.wins === 1) {
          report.territory = tg.territory.name;
          ex.territory = { id: tg.id, resource: tg.territory.resource, richness: tg.territory.richness, name: tg.territory.name, angle: ex.angle };
        }
      } else {
        ts.strength = clamp(ts.strength * (enemyEnd / Math.max(1, enemyStart)), 0.2, 1);
      }
    }
    ex.army = survivors;
    ex.report = report;
    ex.phase = "back";
    ex.t = ex.total;
    pushReport(state, report);
    log(state, win ? "jm_log_expedition_win" : "jm_log_expedition_lose", { target: o.name, lost: lost, killed: killed }, win ? "good" : "bad");
  }

  function returnExpedition(state, ex) {
    keys(ex.army).forEach(function (c) {
      state.soldiers[c] = (state.soldiers[c] || 0) + ex.army[c];
    });
    var rp = ex.report;
    if (rp && rp.win) {
      keys(rp.reward).forEach(function (r) {
        state.res[r] += rp.reward[r];
      });
      var space = room(state);
      var joined = Math.min(rp.captives, space);
      state.villagers += joined;
      state.stats.captives += joined;
      rp.captivesJoined = joined;
      log(state, "jm_log_expedition_return_win", { target: rp.name, n: sumArmy(ex.army), captives: joined }, "good");
      if (ex.territory) addTerritory(state, ex.territory);
    } else {
      log(state, "jm_log_expedition_return", { target: rp ? rp.name : "", n: sumArmy(ex.army) }, "info");
    }
  }

  function pushReport(state, report) {
    state.reports.unshift(report);
    if (state.reports.length > REPORT_MAX) state.reports.length = REPORT_MAX;
  }

  // ---------------- 襲擊（來源由 jomon_world.js 的勢力決定） ----------------

  function scheduleRaid(state, first) {
    var span = RAID_MIN + rand() * (RAID_MAX - RAID_MIN);
    state.nextRaid = (first ? RAID_GRACE : 0) + span;
  }

  // src：{ faction, name, angle, mult, mix }
  function startRaid(state, src) {
    var pop = population(state);
    var frac = Math.min(0.1, 0.05 + state.stats.raidsWon * 0.005);
    var size = Math.max(4, Math.round(pop * frac * DIFFICULTY[state.difficulty].raid * (src.mult || 1)));
    var classes = D.UNIT_CLASSES.filter(function (c) {
      return D.UNITS[c].age <= state.age && (c !== "siege" || (src.mix && src.mix.siege));
    });
    var army = {};
    var weights = classes.map(function (c) {
      return (src.mix && src.mix[c] != null ? src.mix[c] : 1) * (0.5 + rand());
    });
    var wsum = weights.reduce(function (a, b) {
      return a + b;
    }, 0);
    classes.forEach(function (c, i) {
      var n = Math.round((size * weights[i]) / wsum);
      if (n > 0) army[c] = n;
    });
    state.raid = { phase: "warn", t: RAID_WARN, total: RAID_WARN, army: army, name: src.name, faction: src.faction || null, angle: src.angle != null ? src.angle : Math.PI * (0.6 + rand()), tier: state.age, battle: null };
    log(state, "jm_log_raid_warning", { name: src.name, n: sumArmy(army), s: RAID_WARN }, "bad");
  }

  function defenderGroups(state, m) {
    var defMul = 1 + state.wallLevel * WALL_DEF + mod(m, "defense");
    var home = {};
    keys(state.soldiers).forEach(function (c) {
      if (state.soldiers[c] > 0) home[c] = state.soldiers[c];
    });
    var defenders = playerGroups(state, home, m, defMul);
    var militiaN = Math.floor(state.villagers * MILITIA_SHARE);
    var k = 1 + UNIT_AGE_STAT * state.age;
    if (militiaN > 0) defenders.push({ cls: "militia", base: "militia", n: militiaN, n0: militiaN, atk: D.SPECIAL_UNITS.militia.atk * k, hp: D.SPECIAL_UNITS.militia.hp * k * defMul });
    var towers = state.buildings.tower * TOWER_ARCHERS + state.buildings.tc * TC_ARCHERS;
    if (towers > 0) {
      var arch = unitStats(state, "archer", m);
      defenders.push({ cls: "tower", base: "tower", n: towers, n0: towers, atk: arch.atk, hp: 1, immortal: true });
    }
    return defenders;
  }

  function startRaidBattle(state) {
    var rd = state.raid;
    var m = mods(state);
    var raiders = enemyGroups(rd.army, rd.tier, 1, 1);
    rd.phase = "battle";
    rd.battle = createBattle(raiders, defenderGroups(state, m), { fort: 0, player: "B" });
    rd.battle.terrain = "village";
    rd.battle.title = rd.name;
    rd.battle.tier = rd.tier;
    log(state, "jm_log_raid_battle", { name: rd.name }, "bad");
  }

  function finishRaid(state) {
    var rd = state.raid;
    var bt = rd.battle;
    var win = bt.winner === "B";
    var lostSoldiers = 0;
    bt.B.forEach(function (g) {
      if (g.immortal) return;
      var lostN = g.n0 - g.n;
      if (g.cls === "militia") {
        state.villagers = Math.max(1, state.villagers - lostN);
        state.stats.lost += lostN;
      } else {
        // 戰鬥期間士兵可能已經出征：只扣在村的人數
        state.soldiers[g.cls] = Math.max(0, (state.soldiers[g.cls] || 0) - lostN);
        lostSoldiers += lostN;
      }
    });
    state.stats.lost += lostSoldiers;
    var raidKilled = 0;
    bt.A.forEach(function (g) {
      raidKilled += g.n0 - g.n;
    });
    state.stats.kills += raidKilled;
    var report = { kind: "raid", name: rd.name, tier: rd.tier, win: win, retreated: bt.retreated, rounds: bt.hist, mine: summarize(bt.B), theirs: summarize(bt.A), reward: {}, lostRes: {}, lostVillagers: 0, time: state.time };
    if (win) {
      state.stats.raidsWon += 1;
      var bounty = Math.round(raidKilled * 6 * (1 + state.age));
      report.reward = { food: bounty, wood: bounty };
      state.res.food += bounty;
      state.res.wood += bounty;
      log(state, "jm_log_raid_won", { name: rd.name, killed: raidKilled }, "good");
    } else {
      state.stats.raidsLost += 1;
      D.RESOURCES.forEach(function (r) {
        var l = Math.floor(state.res[r] * RAID_LOOT);
        state.res[r] -= l;
        report.lostRes[r] = l;
      });
      var kill = Math.max(1, Math.floor(state.villagers * RAID_KILL));
      state.villagers = Math.max(1, state.villagers - kill);
      state.stats.lost += kill;
      report.lostVillagers = kill;
      log(state, "jm_log_raid_lost", { name: rd.name, v: kill }, "bad");
    }
    pushReport(state, report);
    if (W() && rd.faction) W().onRaidResult(state, rd.faction, win);
    state.raid = null;
    scheduleRaid(state, false);
    return report;
  }

  // ---------------- 戰鬥操作（給畫面用） ----------------

  // ref：{ kind: "exp", id } 或 { kind: "raid" }
  function findBattle(state, ref) {
    if (!ref) return null;
    if (ref.kind === "raid") return state.raid && state.raid.battle ? state.raid.battle : null;
    for (var i = 0; i < state.expeditions.length; i++) {
      var ex = state.expeditions[i];
      if (ex.id === ref.id && ex.phase === "battle") return ex.battle;
    }
    return null;
  }
  function activeBattles(state) {
    var out = [];
    state.expeditions.forEach(function (ex) {
      if (ex.phase === "battle" && ex.battle) out.push({ kind: "exp", id: ex.id, battle: ex.battle });
    });
    if (state.raid && state.raid.battle) out.push({ kind: "raid", battle: state.raid.battle });
    return out;
  }
  function setStance(state, ref, stance) {
    var bt = findBattle(state, ref);
    if (!bt || bt.over || !STANCES[stance]) return false;
    bt.stance = stance;
    return true;
  }
  function rally(state, ref) {
    var bt = findBattle(state, ref);
    if (!bt || bt.over || bt.rallyUsed) return false;
    bt.rallyUsed = true;
    bt.rally = RALLY_ROUNDS;
    return true;
  }
  function retreat(state, ref) {
    var bt = findBattle(state, ref);
    return !!bt && retreatBattle(bt);
  }

  // ---------------- 市集 ----------------

  function marketFee(state, m) {
    m = m || mods(state);
    return clamp(MARKET_FEE * (1 + mod(m, "marketFee")), 0.03, 0.9);
  }
  function tradeQuote(state, from, to, amount) {
    var fee = marketFee(state);
    return Math.floor(((amount * D.RESOURCE_VALUE[from]) / D.RESOURCE_VALUE[to]) * (1 - fee));
  }
  function trade(state, from, to, amount) {
    if (state.buildings.market <= 0 || from === to) return 0;
    if (to === "gold" && state.age < D.GOLD_AGE) return 0;
    amount = Math.floor(Math.min(amount, state.res[from]));
    if (amount <= 0) return 0;
    var got = tradeQuote(state, from, to, amount);
    state.res[from] -= amount;
    state.res[to] += got;
    return got;
  }

  // ---------------- 模擬 ----------------

  function step(state, dt, opts) {
    opts = opts || {};
    // 事件等待玩家抉擇時暫停（離線補算不會產生事件）
    if (state.event && !opts.offline) return;
    var m = mods(state);
    state.time += dt;

    // 限時加成
    for (var tmi = state.timedMods.length - 1; tmi >= 0; tmi--) {
      state.timedMods[tmi].t -= dt;
      if (state.timedMods[tmi].t <= 0) state.timedMods.splice(tmi, 1);
    }

    // 採集與消耗、資源儲量
    var rt = rates(state, m);
    D.RESOURCES.forEach(function (r) {
      state.res[r] += rt.net[r] * dt;
      var max = depositMax(state, r);
      var f = state.deposits[r] - (rt.draw[r] * dt) / max + (depositRegen(state, r, m) * dt) / max;
      state.deposits[r] = clamp(f, 0, 1);
    });
    state.starving = false;
    if (state.res.food < 0) {
      state.res.food = 0;
      state.starving = true;
      state.starveAcc += state.villagers * STARVE_RATE * dt + 0.05 * dt;
      var lose = Math.floor(state.starveAcc);
      if (lose > 0) {
        state.starveAcc -= lose;
        lose = Math.min(lose, Math.max(0, state.villagers - 1));
        state.villagers -= lose;
        state.stats.lost += lose;
      }
    }

    // 村民生產
    var space = room(state, m);
    var vCost = villagerCost(state);
    if (state.autoVillagers && space > 0 && state.res.food >= vCost) {
      state.vilAcc += villagerRate(state, m) * dt;
      var make = Math.floor(state.vilAcc);
      if (make > 0) {
        var n = Math.min(make, space, Math.floor(state.res.food / vCost));
        state.vilAcc -= make;
        if (n > 0) {
          state.villagers += n;
          state.res.food -= n * vCost;
          space -= n;
        }
      }
    } else {
      state.vilAcc = Math.min(state.vilAcc, 1);
    }

    // 自然增加
    if (space > 0 && state.res.food > 100 && !state.starving) {
      state.birthAcc += birthRate(state, m) * dt;
      var born = Math.floor(state.birthAcc);
      if (born > 0) {
        state.birthAcc -= born;
        born = Math.min(born, space);
        state.villagers += born;
        space -= born;
      }
    }

    // 訓練
    D.UNIT_CLASSES.concat(["unique"]).forEach(function (cls) {
      var q = state.trainQueue[cls] || 0;
      if (q <= 0) return;
      if (space <= 0) return;
      state.trainAcc[cls] = (state.trainAcc[cls] || 0) + trainRate(state, cls, m) * dt;
      var done = Math.min(Math.floor(state.trainAcc[cls]), q, space);
      if (done > 0) {
        state.trainAcc[cls] -= done;
        state.trainQueue[cls] -= done;
        state.soldiers[cls] = (state.soldiers[cls] || 0) + done;
        space -= done;
      }
      if (state.trainQueue[cls] <= 0) state.trainAcc[cls] = 0;
    });

    // 建造
    for (var i = state.constructing.length - 1; i >= 0; i--) {
      var c = state.constructing[i];
      c.t -= dt;
      if (c.t <= 0) {
        state.buildings[c.id] += c.n;
        state.constructing.splice(i, 1);
        if (!opts.silent) log(state, "jm_log_built", { name: D.building(c.id).name, n: c.n }, "info");
      }
    }
    if (state.wallBuild) {
      state.wallBuild.t -= dt;
      if (state.wallBuild.t <= 0) {
        state.wallBuild = null;
        state.wallLevel += 1;
        log(state, "jm_log_wall", { name: D.WALL_LEVELS[state.wallLevel].name }, "good");
        pushFx(state, { kind: "wall" });
      }
    }

    // 研究
    for (var j = state.researching.length - 1; j >= 0; j--) {
      var rs = state.researching[j];
      rs.t -= dt;
      if (rs.t <= 0) {
        state.techs[rs.id] = true;
        state.researching.splice(j, 1);
        var tdef = D.tech(rs.id);
        log(state, "jm_log_tech", { name: tdef.name }, "good");
        pushFx(state, { kind: "tech", at: techFxKind(tdef), tech: rs.id });
      }
    }

    // 升時代
    if (state.ageUp) {
      state.ageUp.t -= dt;
      if (state.ageUp.t <= 0) {
        var au = state.ageUp;
        state.ageUp = null;
        state.age += 1;
        state.landmarks.push(au.landmark);
        if (au.civ) {
          state.civ = au.civ;
          log(state, "jm_log_civ", { name: D.civ(au.civ).name }, "good");
        }
        log(state, "jm_log_age", { name: D.AGES[state.age].name, landmark: D.landmark(au.landmark).name }, "age");
        pushFx(state, { kind: "age" });
        if (state.age === 1) scheduleRaid(state, true);
        if (state.age === D.AGES.length - 1 && !state.victory) state.victory = { time: state.time };
        state.justAged = true;
      }
    }

    // 偵察
    for (var si = state.scouts.length - 1; si >= 0; si--) {
      var sc = state.scouts[si];
      sc.t -= dt;
      if (sc.t <= 0) {
        state.scouts.splice(si, 1);
        finishScout(state, sc);
      }
    }

    // 遠征：行軍 → 即時戰鬥 → 歸途
    for (var k = state.expeditions.length - 1; k >= 0; k--) {
      var ex = state.expeditions[k];
      if (ex.phase === "battle") {
        if (advanceBattle(ex.battle, dt)) {
          finishExpeditionBattle(state, ex);
          state.newReport = true;
        }
        continue;
      }
      ex.t -= dt;
      if (ex.t <= 0) {
        if (ex.phase === "go") {
          if (objective(state, ex.target)) startExpeditionBattle(state, ex);
          else {
            ex.phase = "back";
            ex.t = ex.total;
          }
        } else {
          returnExpedition(state, ex);
          state.expeditions.splice(k, 1);
        }
      }
    }

    // 目標冷卻與恢復
    keys(state.targets).forEach(function (id) {
      var ts = state.targets[id];
      if (ts.cooldown > 0) ts.cooldown = Math.max(0, ts.cooldown - dt);
      if (ts.strength < 1) ts.strength = Math.min(1, ts.strength + TARGET_RECOVER * dt);
    });

    // 襲擊
    if (state.raid) {
      if (state.raid.phase === "battle") {
        if (advanceBattle(state.raid.battle, dt)) {
          finishRaid(state);
          state.newReport = true;
        }
      } else {
        state.raid.t -= dt;
        if (state.raid.t <= 0) startRaidBattle(state);
      }
    } else if (!opts.noRaid) {
      if (state.pendingRaid) {
        // 事件預告的大規模襲擊
        state.pendingRaid.t -= dt;
        if (state.pendingRaid.t <= 0) {
          var pr = state.pendingRaid;
          state.pendingRaid = null;
          startRaid(state, pr);
        }
      } else if (state.age >= 1) {
        if (state.nextRaid == null) scheduleRaid(state, true);
        state.nextRaid -= dt;
        if (state.nextRaid <= 0) {
          var src = W() ? W().pickRaider(state) : { name: D.RAIDERS[state.age], mult: 1 };
          if (src) startRaid(state, src);
          else scheduleRaid(state, false);
        }
      }
    }

    // 勢力、事件、任務
    if (W()) W().step(state, dt, opts);

    var pop = population(state);
    if (pop > state.stats.peakPop) state.stats.peakPop = pop;
  }

  // ---------------- 存讀檔 ----------------

  function save(state) {
    state.lastSave = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 儲存失敗（私密模式等）時忽略 */
    }
  }

  function migrate(s) {
    if (!s || typeof s !== "object") return null;
    if (s.version === 1) {
      // v1 → v2：舊的瞬間結算遠征直接改成「已打完、回程中」；襲擊改成預警階段
      s.expeditions = (s.expeditions || []).filter(function (ex) {
        return ex.phase === "go" || ex.phase === "back";
      });
      if (s.raid) s.raid.phase = "warn";
      s.version = 2;
    }
    if (s.version !== STATE_VERSION) return null;
    var fresh = newState(s.difficulty);
    keys(fresh).forEach(function (k) {
      if (s[k] === undefined) s[k] = fresh[k];
    });
    keys(fresh.stats).forEach(function (k) {
      if (s.stats[k] === undefined) s.stats[k] = 0;
    });
    keys(fresh.buildings).forEach(function (k) {
      if (s.buildings[k] === undefined) s.buildings[k] = 0;
    });
    keys(fresh.soldiers).forEach(function (k) {
      if (s.soldiers[k] === undefined) s.soldiers[k] = 0;
      if (s.trainQueue[k] === undefined) s.trainQueue[k] = 0;
    });
    D.TARGETS.forEach(function (tg) {
      if (!s.targets[tg.id]) s.targets[tg.id] = freshTarget();
    });
    if (W()) W().migrate(s);
    return s;
  }

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) return null;
    try {
      return migrate(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  // 離線收益：以 1 倍速、每步 1 秒模擬，不會被襲擊、不會發生事件（戰鬥照常自動進行）
  function catchUp(state) {
    var elapsed = (Date.now() - (state.lastSave || Date.now())) / 1000;
    if (state.paused || state.event || elapsed < 30) return null;
    elapsed = Math.min(OFFLINE_MAX, elapsed);
    var before = { pop: population(state), res: {} };
    D.RESOURCES.forEach(function (r) {
      before.res[r] = state.res[r];
    });
    var steps = Math.floor(elapsed);
    for (var i = 0; i < steps; i++) step(state, 1, { noRaid: true, silent: true, offline: true });
    var out = { seconds: steps, pop: population(state) - before.pop, res: {} };
    D.RESOURCES.forEach(function (r) {
      out.res[r] = state.res[r] - before.res[r];
    });
    return out;
  }

  window.PriTestJomonCore = {
    SAVE_KEY: SAVE_KEY,
    VILLAGER_COST: VILLAGER_COST,
    DIFFICULTY: DIFFICULTY,
    TOWER_ARCHERS: TOWER_ARCHERS,
    WALL_DEF: WALL_DEF,
    MILITIA_SHARE: MILITIA_SHARE,
    ROUND_TIME: ROUND_TIME,
    BATTLE_MAX_ROUNDS: BATTLE_MAX_ROUNDS,
    INTEL_TTL: INTEL_TTL,
    STANCES: STANCES,
    newState: newState,
    load: load,
    save: save,
    clearSave: clearSave,
    catchUp: catchUp,
    step: step,
    mods: mods,
    mod: mod,
    addTimedMods: addTimedMods,
    rates: rates,
    population: population,
    housing: housing,
    room: room,
    soldiersHome: soldiersHome,
    soldiersAway: soldiersAway,
    villagerRate: villagerRate,
    villagerCost: villagerCost,
    birthRate: birthRate,
    depositInfo: depositInfo,
    addRichness: addRichness,
    addTerritory: addTerritory,
    buildingCost: buildingCost,
    buildingCount: buildingCount,
    buildingLimit: buildingLimit,
    canBuild: canBuild,
    build: build,
    wallCost: wallCost,
    canWall: canWall,
    buildWall: buildWall,
    techCost: techCost,
    techAvailable: techAvailable,
    groupTaken: groupTaken,
    research: research,
    ageUpStatus: ageUpStatus,
    startAgeUp: startAgeUp,
    unitDef: unitDef,
    unitCost: unitCost,
    unitStats: unitStats,
    canTrain: canTrain,
    train: train,
    cancelTrain: cancelTrain,
    trainRate: trainRate,
    canAfford: canAfford,
    pay: pay,
    scaleCost: scaleCost,
    maxAffordable: maxAffordable,
    objective: objective,
    targetAvailable: targetAvailable,
    targetState: targetState,
    targetArmy: targetArmy,
    nominalArmy: nominalArmy,
    targetReward: targetReward,
    travelTime: travelTime,
    intelValid: intelValid,
    knownArmy: knownArmy,
    scoutCost: scoutCost,
    scoutTime: scoutTime,
    scouting: scouting,
    scout: scout,
    previewBattle: previewBattle,
    sendExpedition: sendExpedition,
    sumArmy: sumArmy,
    enemyGroups: enemyGroups,
    createBattle: createBattle,
    runBattle: runBattle,
    findBattle: findBattle,
    activeBattles: activeBattles,
    setStance: setStance,
    rally: rally,
    retreat: retreat,
    startRaid: startRaid,
    marketFee: marketFee,
    tradeQuote: tradeQuote,
    trade: trade,
    log: log,
    pushFx: pushFx,
  };
})();
