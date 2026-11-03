// 繩文帝國（jomon）：遊戲引擎 —— state、即時模擬（採集、村民生產、自然增加、建造、研究、訓練、升時代）、
// 自動戰鬥結算（遠征 NPC 與村子被襲擊）、市集、存讀檔與離線收益。畫面在 jomon.js，3D 場景在 jomon_scene3d.js。
// 規則總覽見 docs/jomon_game_design.md；調整數值時請一併更新該文件。
(function () {
  "use strict";

  var D = window.PriTestJomonData;

  // ---------------- 常數 ----------------

  var STATE_VERSION = 1;
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
  var TC_CYCLE = 4; // 村落中心每 4 秒生產一輪（每輪數量依時代）
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
  var RETREAT_FRAC = 0.25; // 進攻方剩不到 25% 而對方還有 35% 以上就撤退
  var SIEGE_FORT_SHARE = 5; // 攻城兵器佔全軍 20% 即完全抵銷城塞防禦
  var TARGET_LEVEL_ARMY = 1.5;
  var TARGET_LEVEL_LOOT = 1.4;
  var TARGET_RECOVER = 0.005; // 未被攻下的目標每秒恢復 0.5% 兵力
  var RAID_GRACE = 300; // 升上彌生時代後 300 秒內不會被襲擊
  var RAID_MIN = 200;
  var RAID_MAX = 380;
  var RAID_WARN = 45; // 來襲預警秒數
  var RAID_LOOT = 0.15; // 被攻破時損失 15% 資源
  var RAID_KILL = 0.03; // 被攻破時額外損失 3% 村民
  var MARKET_FEE = 0.3;
  var TRADE_INCOME = 0.01; // 交易收入：每人每秒 0.01 金 × 交易加成（需有市集）
  var OFFLINE_MAX = 3600; // 離線收益最多計算 1 小時（不會被襲擊）
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

  function newState(difficulty) {
    var b = {};
    D.BUILDINGS.forEach(function (bd) {
      b[bd.id] = 0;
    });
    b.house = 2;
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
      targets[tg.id] = { level: 0, cooldown: 0, strength: 1, wins: 0 };
    });
    return {
      version: STATE_VERSION,
      difficulty: DIFFICULTY[difficulty] ? difficulty : "normal",
      time: 0,
      age: 0,
      civ: null,
      landmarks: [],
      res: { food: 250, wood: 200, stone: 100, gold: 0 },
      villagers: 5,
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
      raid: null,
      nextRaid: null,
      stats: { kills: 0, conquests: 0, raidsWon: 0, raidsLost: 0, peakPop: 5, lost: 0, captives: 0 },
      log: [],
      reports: [],
      victory: null,
      lastSave: Date.now(),
      speed: 1,
      paused: false,
    };
  }

  function log(state, key, params, kind) {
    state.logSeq = (state.logSeq || 0) + 1;
    state.log.unshift({ id: state.logSeq, t: state.time, key: key, params: params || {}, kind: kind || "info" });
    if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
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

  function ageData(state) {
    return D.AGES[state.age];
  }

  function gatherMul(state, m, r) {
    return 1 + mod(m, "gather." + r) + mod(m, "gather.all") + state.age * AGE_GATHER_BONUS;
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
      keys(ex.army).forEach(function (c) {
        n += ex.army[c];
      });
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

  // 每秒收支（不含村民生產的花費）
  function rates(state, m) {
    m = m || mods(state);
    var w = workers(state);
    var caps = campCaps(state, m);
    var effFood = efficiency(w.food, caps.food);
    var effWood = efficiency(w.wood, caps.wood);
    var effMine = efficiency(w.stone + w.gold, caps.mine);
    var farmers = Math.min(w.food, caps.paddy);
    var food = (farmers * GATHER_BASE.food * PADDY_MUL * (1 + mod(m, "paddy")) + (w.food - farmers) * GATHER_BASE.food) * effFood * gatherMul(state, m, "food");
    var wood = w.wood * GATHER_BASE.wood * effWood * gatherMul(state, m, "wood");
    var stone = w.stone * GATHER_BASE.stone * effMine * gatherMul(state, m, "stone");
    var gold = w.gold * GATHER_BASE.gold * effMine * gatherMul(state, m, "gold");
    var upkeep = (state.villagers + soldiersHome(state)) * UPKEEP * (1 + UPKEEP_AGE * state.age);
    var trade = state.buildings.market > 0 ? population(state) * TRADE_INCOME * mod(m, "tradeIncome") : 0;
    return {
      gross: { food: food, wood: wood, stone: stone, gold: gold + trade },
      net: { food: food - upkeep, wood: wood, stone: stone, gold: gold + trade },
      upkeep: upkeep,
      trade: trade,
      workers: w,
      caps: caps,
      eff: { food: effFood, wood: effWood, stone: effMine, gold: effMine },
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
  function addCost(a, b, n) {
    var out = {};
    keys(a).forEach(function (r) {
      out[r] = a[r];
    });
    keys(b).forEach(function (r) {
      out[r] = (out[r] || 0) + b[r] * (n || 1);
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
  // 最多買得起幾份
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
    var total = bd.time * (1 + Math.log(n) / Math.LN10 * 0.6);
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

  function techCost(state, id, m) {
    m = m || mods(state);
    var tc = D.tech(id);
    return scaleCost(tc.cost, Math.max(0.3, 1 + mod(m, "techCost")));
  }
  function techAvailable(state, id) {
    var tc = D.tech(id);
    if (!tc || state.techs[id]) return false;
    if (tc.civ && tc.civ !== state.civ) return false;
    if (state.age < tc.age) return false;
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
    var total = D.tech(id).time / (1 + mod(m, "researchSpeed"));
    state.researching.push({ id: id, t: total, total: total });
    return true;
  }

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
      atk: u.atk * k * (1 + mod(m, "atk.all") + mod(m, "atk." + u.base)),
      hp: u.hp * k * (1 + mod(m, "hp.all") + mod(m, "hp." + u.base)),
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
    return (state.buildings[u.building] * batch * (1 + mod(m, "trainSpeed"))) / TRAIN_CYCLE;
  }
  function villagerRate(state, m) {
    m = m || mods(state);
    return (state.buildings.tc * ageData(state).tcBatch * (1 + mod(m, "tcSpeed"))) / TC_CYCLE;
  }
  function villagerCost(state) {
    return Math.round(VILLAGER_COST * (1 + VILLAGER_AGE_COST * state.age));
  }
  function birthRate(state, m) {
    m = m || mods(state);
    return population(state) * BIRTH_RATE * (1 + mod(m, "birth"));
  }

  // ---------------- 戰鬥 ----------------

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

  // A 進攻 B。opt.fort：B 的城塞防禦（A 的傷害 ÷(1+有效 fort)）
  function battle(A, B, opt) {
    opt = opt || {};
    var fort = opt.fort || 0;
    var siege = 0;
    A.forEach(function (g) {
      if (g.base === "siege") siege += g.n;
    });
    var aTotal = alive(A);
    var effFort = fort * Math.max(0, 1 - (aTotal > 0 ? siege / aTotal : 0) * SIEGE_FORT_SHARE);
    var rounds = [];
    var winner = null;
    var retreated = false;
    for (var r = 0; r < BATTLE_MAX_ROUNDS; r++) {
      var dToB = dealDamage(A, B, 1 / (1 + effFort));
      var dToA = dealDamage(B, A, 1);
      // 攻城兵器不吃城塞減傷：補回差額
      if (effFort > 0) {
        var extra = dealDamage(
          A.filter(function (g) {
            return g.base === "siege";
          }),
          B,
          1 - 1 / (1 + effFort)
        );
        extra.forEach(function (v, i) {
          dToB[i] += v;
        });
      }
      B.forEach(function (g, i) {
        if (!g.immortal) g.n = Math.max(0, g.n - dToB[i] / g.hp);
      });
      A.forEach(function (g, i) {
        if (!g.immortal) g.n = Math.max(0, g.n - dToA[i] / g.hp);
      });
      A.forEach(function (g) {
        if (g.n < 0.5) g.n = 0;
      });
      B.forEach(function (g) {
        if (g.n < 0.5) g.n = 0;
      });
      rounds.push({ a: alive(A), b: alive(B) });
      var aa = alive(A);
      var bb = alive(B);
      if (bb <= 0) {
        winner = "A";
        break;
      }
      if (aa <= 0) {
        winner = "B";
        break;
      }
      if (aa / Math.max(1, total0(A)) < RETREAT_FRAC && bb / Math.max(1, total0(B)) > 0.35) {
        winner = "B";
        retreated = true;
        break;
      }
    }
    if (!winner) winner = alive(A) / Math.max(1, total0(A)) >= alive(B) / Math.max(1, total0(B)) ? "A" : "B";
    if (winner === "A" && !retreated && alive(B) > 0) {
      // 回合用盡：守方殘兵潰散
      B.forEach(function (g) {
        if (!g.immortal) g.n = 0;
      });
    }
    if (winner === "B" && !retreated && alive(A) > 0) retreated = true;
    A.forEach(function (g) {
      g.n = Math.round(g.n);
    });
    B.forEach(function (g) {
      g.n = Math.round(g.n);
    });
    return { winner: winner, rounds: rounds, retreated: retreated };
  }

  function summarize(groups) {
    var out = {};
    groups.forEach(function (g) {
      if (g.immortal) return;
      out[g.cls] = { start: g.n0, end: g.n };
    });
    return out;
  }

  // ---------------- 遠征 ----------------

  function targetState(state, id) {
    return state.targets[id] || (state.targets[id] = { level: 0, cooldown: 0, strength: 1, wins: 0 });
  }
  function targetAvailable(state, id) {
    var tg = D.target(id);
    var ts = targetState(state, id);
    return state.age >= tg.age && ts.cooldown <= 0;
  }
  function targetArmyMul(state, id) {
    var ts = targetState(state, id);
    return Math.pow(TARGET_LEVEL_ARMY, ts.level) * ts.strength * DIFFICULTY[state.difficulty].enemy;
  }
  function targetArmy(state, id) {
    var tg = D.target(id);
    var k = targetArmyMul(state, id);
    var out = {};
    keys(tg.army).forEach(function (c) {
      out[c] = Math.max(1, Math.round(tg.army[c] * k));
    });
    return out;
  }
  function targetReward(state, id, m) {
    m = m || mods(state);
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
    var tg = D.target(id);
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
    return tg.dist * k;
  }

  // 預估勝率（以目前兵力跑一次確定性模擬）
  function previewBattle(state, id, army) {
    var tg = D.target(id);
    var m = mods(state);
    var A = playerGroups(state, army, m, 1);
    var B = enemyGroups(targetArmy(state, id), tg.tier, tg.statMul, 1);
    if (!A.length) return null;
    var res = battle(A, B, { fort: tg.fort });
    var lost = 0;
    var sent = 0;
    A.forEach(function (g) {
      lost += g.n0 - g.n;
      sent += g.n0;
    });
    return { win: res.winner === "A", lost: lost, sent: sent, rounds: res.rounds.length };
  }

  function sendExpedition(state, id, army) {
    if (!targetAvailable(state, id)) return false;
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
        return ex.target === id && ex.phase === "go";
      })
    )
      return false;
    keys(clean).forEach(function (c) {
      state.soldiers[c] -= clean[c];
    });
    var total = travelTime(state, id, clean);
    var angle = expeditionAngle(id);
    state.expeditions.push({ id: state.nextExpeditionId++, target: id, army: clean, sent: clean, phase: "go", t: total, total: total, angle: angle, report: null });
    log(state, "jm_log_expedition_sent", { target: D.target(id).name, n: sumArmy(clean) }, "war");
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

  function resolveExpedition(state, ex) {
    var tg = D.target(ex.target);
    var m = mods(state);
    var A = playerGroups(state, ex.army, m, 1);
    var B = enemyGroups(targetArmy(state, ex.target), tg.tier, tg.statMul, 1);
    var res = battle(A, B, { fort: tg.fort });
    var survivors = {};
    A.forEach(function (g) {
      survivors[g.cls] = g.n;
    });
    var enemyStart = 0;
    var enemyEnd = 0;
    B.forEach(function (g) {
      enemyStart += g.n0;
      enemyEnd += g.n;
    });
    var killed = enemyStart - enemyEnd;
    var ts = targetState(state, ex.target);
    var report = {
      kind: "expedition",
      target: ex.target,
      name: tg.name,
      win: res.winner === "A",
      retreated: res.retreated,
      rounds: res.rounds,
      mine: summarize(A),
      theirs: summarize(B),
      reward: {},
      captives: 0,
      level: ts.level,
      time: state.time,
    };
    state.stats.kills += killed;
    var lost = sumArmy(ex.army) - sumArmy(survivors);
    state.stats.lost += lost;
    if (report.win) {
      report.reward = targetReward(state, ex.target, m);
      report.captives = Math.floor(killed * tg.captives);
      ts.level += 1;
      ts.wins += 1;
      ts.strength = 1;
      ts.cooldown = tg.cooldown;
      state.stats.conquests += 1;
    } else {
      // 沒打下來：守方的損耗保留，之後慢慢恢復
      ts.strength = clamp(ts.strength * (enemyEnd / Math.max(1, enemyStart)), 0.2, 1);
    }
    ex.army = survivors;
    ex.report = report;
    ex.phase = "back";
    ex.t = ex.total;
    pushReport(state, report);
    log(state, report.win ? "jm_log_expedition_win" : "jm_log_expedition_lose", { target: tg.name, lost: lost, killed: killed }, report.win ? "good" : "bad");
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
      log(state, "jm_log_expedition_return_win", { target: rp.name, n: sumArmy(ex.army), captives: joined, lostCaptives: rp.captives - joined }, "good");
    } else {
      log(state, "jm_log_expedition_return", { target: D.target(ex.target).name, n: sumArmy(ex.army) }, "info");
    }
  }

  function pushReport(state, report) {
    state.reports.unshift(report);
    if (state.reports.length > REPORT_MAX) state.reports.length = REPORT_MAX;
  }

  // ---------------- 襲擊 ----------------

  function scheduleRaid(state, first) {
    var span = RAID_MIN + rand() * (RAID_MAX - RAID_MIN);
    state.nextRaid = (first ? RAID_GRACE : 0) + span;
  }

  function startRaid(state) {
    var pop = population(state);
    var frac = Math.min(0.1, 0.05 + state.stats.raidsWon * 0.005);
    var size = Math.max(4, Math.round(pop * frac * DIFFICULTY[state.difficulty].raid));
    var classes = D.UNIT_CLASSES.filter(function (c) {
      return D.UNITS[c].age <= state.age && c !== "siege";
    });
    var army = {};
    var weights = classes.map(function () {
      return 0.3 + rand();
    });
    var wsum = weights.reduce(function (a, b) {
      return a + b;
    }, 0);
    classes.forEach(function (c, i) {
      var n = Math.round((size * weights[i]) / wsum);
      if (n > 0) army[c] = n;
    });
    state.raid = { t: RAID_WARN, total: RAID_WARN, army: army, name: D.RAIDERS[state.age] || D.RAIDERS[0], angle: Math.PI * (0.6 + rand() * 1.0), tier: state.age };
    log(state, "jm_log_raid_warning", { name: state.raid.name, n: sumArmy(army), s: RAID_WARN }, "bad");
  }

  function resolveRaid(state) {
    var rd = state.raid;
    var m = mods(state);
    var defMul = 1 + state.wallLevel * WALL_DEF + mod(m, "defense");
    var home = {};
    keys(state.soldiers).forEach(function (c) {
      if (state.soldiers[c] > 0) home[c] = state.soldiers[c];
    });
    var defenders = playerGroups(state, home, m, defMul);
    var militiaN = Math.floor(state.villagers * MILITIA_SHARE);
    var k = 1 + UNIT_AGE_STAT * state.age;
    if (militiaN > 0) {
      defenders.push({ cls: "militia", base: "militia", n: militiaN, n0: militiaN, atk: D.SPECIAL_UNITS.militia.atk * k, hp: D.SPECIAL_UNITS.militia.hp * k * defMul });
    }
    var towers = state.buildings.tower * TOWER_ARCHERS + state.buildings.tc * TC_ARCHERS;
    if (towers > 0) {
      var arch = unitStats(state, "archer", m);
      defenders.push({ cls: "tower", base: "tower", n: towers, n0: towers, atk: arch.atk, hp: 1, immortal: true });
    }
    var raiders = enemyGroups(rd.army, rd.tier, 1, 1);
    var res = battle(raiders, defenders, { fort: 0 });
    var win = res.winner === "B";
    var lostSoldiers = 0;
    defenders.forEach(function (g) {
      if (g.immortal) return;
      var lostN = g.n0 - g.n;
      if (g.cls === "militia") {
        state.villagers = Math.max(0, state.villagers - lostN);
        state.stats.lost += lostN;
      } else {
        state.soldiers[g.cls] = Math.max(0, state.soldiers[g.cls] - lostN);
        lostSoldiers += lostN;
      }
    });
    state.stats.lost += lostSoldiers;
    var raidKilled = 0;
    raiders.forEach(function (g) {
      raidKilled += g.n0 - g.n;
    });
    state.stats.kills += raidKilled;
    var report = { kind: "raid", name: rd.name, win: win, retreated: res.retreated, rounds: res.rounds, mine: summarize(defenders), theirs: summarize(raiders), reward: {}, lostRes: {}, lostVillagers: 0, time: state.time };
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
    state.raid = null;
    scheduleRaid(state, false);
    return report;
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
    var m = mods(state);
    state.time += dt;

    // 採集與消耗
    var rt = rates(state, m);
    D.RESOURCES.forEach(function (r) {
      state.res[r] += rt.net[r] * dt;
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
      }
    }

    // 研究
    for (var j = state.researching.length - 1; j >= 0; j--) {
      var rs = state.researching[j];
      rs.t -= dt;
      if (rs.t <= 0) {
        state.techs[rs.id] = true;
        state.researching.splice(j, 1);
        log(state, "jm_log_tech", { name: D.tech(rs.id).name }, "good");
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
        if (state.age === 1) scheduleRaid(state, true);
        if (state.age === D.AGES.length - 1 && !state.victory) state.victory = { time: state.time };
        state.justAged = true;
      }
    }

    // 遠征
    for (var k = state.expeditions.length - 1; k >= 0; k--) {
      var ex = state.expeditions[k];
      ex.t -= dt;
      if (ex.t <= 0) {
        if (ex.phase === "go") {
          resolveExpedition(state, ex);
          state.newReport = true;
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
    if (!opts.noRaid && state.age >= 1) {
      if (state.raid) {
        state.raid.t -= dt;
        if (state.raid.t <= 0) {
          resolveRaid(state);
          state.newReport = true;
        }
      } else {
        if (state.nextRaid == null) scheduleRaid(state, true);
        state.nextRaid -= dt;
        if (state.nextRaid <= 0) startRaid(state);
      }
    }

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
    if (!s || typeof s !== "object" || s.version !== STATE_VERSION) return null;
    var fresh = newState(s.difficulty);
    keys(fresh).forEach(function (k) {
      if (s[k] === undefined) s[k] = fresh[k];
    });
    keys(fresh.buildings).forEach(function (k) {
      if (s.buildings[k] === undefined) s.buildings[k] = 0;
    });
    keys(fresh.soldiers).forEach(function (k) {
      if (s.soldiers[k] === undefined) s.soldiers[k] = 0;
      if (s.trainQueue[k] === undefined) s.trainQueue[k] = 0;
    });
    D.TARGETS.forEach(function (tg) {
      if (!s.targets[tg.id]) s.targets[tg.id] = { level: 0, cooldown: 0, strength: 1, wins: 0 };
    });
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

  // 離線收益：以 1 倍速、每步 1 秒模擬，不會被襲擊
  function catchUp(state) {
    var elapsed = (Date.now() - (state.lastSave || Date.now())) / 1000;
    if (state.paused || elapsed < 30) return null;
    elapsed = Math.min(OFFLINE_MAX, elapsed);
    var before = { pop: population(state), res: {} };
    D.RESOURCES.forEach(function (r) {
      before.res[r] = state.res[r];
    });
    var steps = Math.floor(elapsed);
    for (var i = 0; i < steps; i++) step(state, 1, { noRaid: true, silent: true });
    var out = { seconds: steps, pop: population(state) - before.pop, res: {} };
    D.RESOURCES.forEach(function (r) {
      out.res[r] = state.res[r] - before.res[r];
    });
    return out;
  }

  window.PriTestJomonCore = {
    SAVE_KEY: SAVE_KEY,
    VILLAGER_COST: VILLAGER_COST,
    villagerCost: villagerCost,
    DIFFICULTY: DIFFICULTY,
    TOWER_ARCHERS: TOWER_ARCHERS,
    WALL_DEF: WALL_DEF,
    newState: newState,
    load: load,
    save: save,
    clearSave: clearSave,
    catchUp: catchUp,
    step: step,
    mods: mods,
    mod: mod,
    rates: rates,
    population: population,
    housing: housing,
    room: room,
    soldiersHome: soldiersHome,
    soldiersAway: soldiersAway,
    villagerRate: villagerRate,
    birthRate: birthRate,
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
    maxAffordable: maxAffordable,
    targetAvailable: targetAvailable,
    targetState: targetState,
    targetArmy: targetArmy,
    targetReward: targetReward,
    travelTime: travelTime,
    previewBattle: previewBattle,
    sendExpedition: sendExpedition,
    sumArmy: sumArmy,
    marketFee: marketFee,
    tradeQuote: tradeQuote,
    trade: trade,
    log: log,
  };
})();
