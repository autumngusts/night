// 射彈宇宙（shedan）：遠征（肉鴿層）規則核心。地圖產生、節點結算、戰鬥配置（敵人、場地機關、精英）、
// 獎勵抽選、補給站、休息、漂流者、異常訊號、隊伍 HP 換算。不碰 DOM 與物理，最終移植成 Go（RMD 伺服器權威亂數）。
// 所有亂數都由「局種子＋節點 id」衍生，同一局同一個節點永遠得到相同結果。規則依據 docs/shedan_game_design.md §6、§11、§11.1。
// 瀏覽器掛在 window.PriTestShedanRun；Node 測試用 require 載入。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var Rng = root.PriTestShedanRng || (typeof require === "function" ? require("./shedan_rng.js") : null);
  var K = D.C;

  var LAYERS = 7;
  var COLS = 4;
  var NODE_WEIGHTS = { battle: 45, elite: 12, drifter: 10, shop: 10, event: 15, rest: 8 };
  var ENERGY = { battle: 30, elite: 60, boss: 100 };
  var PRICE = { common: 80, rare: 120, legendary: 150 };
  var REPAIR_COST = 50, REPAIR_PCT = 0.3, REST_PCT = 0.3;
  var DRIFTER_ENERGY = 40, DRIFTER_HP = 0.15;
  var ELITE_TRAITS = ["shield", "haste", "split", "regen"];
  var RARITY_W = { normal: { common: 70, rare: 25, legendary: 5 }, elite: { common: 0, rare: 80, legendary: 20 }, shop: { common: 60, rare: 30, legendary: 10 } };

  function rngFor(run, key) { return Rng.make(Rng.hashStr(run.seed + ":" + key)); }
  function weighted(rng, w) {
    var keys = Object.keys(w).filter(function (k) { return w[k] > 0; });
    var total = keys.reduce(function (s, k) { return s + w[k]; }, 0), x = rng() * total;
    for (var i = 0; i < keys.length; i++) { x -= w[keys[i]]; if (x < 0) return keys[i]; }
    return keys[keys.length - 1];
  }

  // ---------------- 地圖（§11.1） ----------------
  function genMap(rng, sector, drifterBoost) {
    var layers = [];
    for (var L = 1; L <= LAYERS; L++) {
      var n = Rng.int(rng, 2, 4);
      var cols = Rng.shuffle(rng, [0, 1, 2, 3]).slice(0, n).sort();
      layers.push(cols.map(function (c, i) { return { id: sector + "-" + L + "-" + i, layer: L, col: c, type: null, next: [], prev: [] }; }));
    }
    var boss = { id: sector + "-boss", layer: LAYERS + 1, col: 1.5, type: "boss", next: [], prev: [] };
    // 連線：每個節點連到下一層欄位最近的節點，50% 再連一個相鄰的；沒有入線的節點補一條
    for (var l = 0; l < LAYERS - 1; l++) {
      var cur = layers[l], nxt = layers[l + 1];
      cur.forEach(function (a) {
        var sorted = nxt.slice().sort(function (p, q) { return Math.abs(p.col - a.col) - Math.abs(q.col - a.col); });
        link(a, sorted[0]);
        if (sorted[1] && Math.abs(sorted[1].col - a.col) <= 1.5 && rng() < 0.5) link(a, sorted[1]);
      });
      nxt.forEach(function (b2) {
        if (b2.prev.length) return;
        var near = cur.slice().sort(function (p, q) { return Math.abs(p.col - b2.col) - Math.abs(q.col - b2.col); })[0];
        link(near, b2);
      });
    }
    layers[LAYERS - 1].forEach(function (a) { link(a, boss); });
    // 種類
    var w = {};
    Object.keys(NODE_WEIGHTS).forEach(function (k) { w[k] = NODE_WEIGHTS[k]; });
    if (drifterBoost) w.drifter *= 2;
    layers.forEach(function (layer, li) {
      var L = li + 1;
      layer.forEach(function (nd) {
        if (L === 1) { nd.type = "battle"; return; }
        var ww = {};
        Object.keys(w).forEach(function (k) { ww[k] = w[k]; });
        if (L <= 2) ww.elite = 0;
        nd.type = weighted(rng, ww);
      });
      if (L === 4 && !layer.some(function (nd) { return nd.type === "rest"; })) layer[Math.floor(rng() * layer.length)].type = "rest";
    });
    // 同一條路不連續兩個補給站
    layers.forEach(function (layer) {
      layer.forEach(function (nd) {
        if (nd.type === "shop" && nd.prev.some(function (p) { return p.type === "shop"; })) nd.type = "battle";
      });
    });
    var nodes = [];
    layers.forEach(function (layer) { layer.forEach(function (nd) { nodes.push(nd); }); });
    nodes.push(boss);
    // 序列化成 id（不留物件循環參照）
    return {
      sector: sector, bossId: boss.id,
      nodes: nodes.map(function (nd) {
        return { id: nd.id, layer: nd.layer, col: nd.col, type: nd.type, next: nd.next.map(function (x) { return x.id; }), prev: nd.prev.map(function (x) { return x.id; }) };
      })
    };
    function link(a, b3) { if (a.next.indexOf(b3) < 0) { a.next.push(b3); b3.prev.push(a); } }
  }

  // ---------------- 戰鬥配置（敵人、場地機關、精英） ----------------
  // 依星區抽敵（§6.1）：浮游孢子 2～3 隻成群、雙子球／引力雙星成對、寄生藤貼在宿主旁、巨蟒留身體空間。
  // 星蝕使徒只以精英出現。boss = Boss 戰時本體與部位佔用的區域。
  function genEnemies(rng, sector, count, boss) {
    var pool = D.ENEMIES.filter(function (e) { return e.sector === sector && e.trait !== "eclipse"; });
    var list = [], large = 0;
    while (list.length < count) {
      var def = Rng.pick(rng, pool);
      if (def.size === "l" && large >= 1) continue;
      if (def.size === "l") large++;
      var n = def.trait === "swarm" ? Rng.int(rng, 2, 3) : (def.trait === "linked" || def.trait === "binary") ? 2 : 1;
      for (var k = 0; k < n; k++) list.push(def);
    }
    var placed = [];
    var taken = boss ? [{ x: K.FIELD_W / 2, y: 240, r: 220 }] : [];
    D.HERO_POS.forEach(function (p) { taken.push({ x: p.x, y: p.y, r: K.HERO_R }); });
    function free(x, y, r) {
      return placed.concat(taken).every(function (p) { var dx = p.x - x, dy = p.y - y; return Math.sqrt(dx * dx + dy * dy) > p.r + r + 26; });
    }
    var parasites = [];
    list.forEach(function (def) {
      if (def.trait === "parasite") { parasites.push(def); return; }
      var r = D.SIZE_R[def.size];
      for (var tries = 0; tries < 300; tries++) {
        var serp = def.trait === "serpent";
        var x = Rng.int(rng, r + 20, K.FIELD_W - r - 20), y = Rng.int(rng, 110, serp ? 500 : 620);
        var ok = free(x, y, r) && (!serp || [76, 122, 168].every(function (dy) { return free(x, y + dy, 22); }));
        if (ok) {
          placed.push({ def: def, x: x, y: y, r: r });
          if (serp) [76, 122, 168].forEach(function (dy) { taken.push({ x: x, y: y + dy, r: 22 }); });
          return;
        }
      }
    });
    parasites.forEach(function (def) {
      var r = D.SIZE_R[def.size];
      var hosts = placed.filter(function (p) { return p.def.trait !== "parasite"; });
      for (var tries = 0; tries < 60 && hosts.length; tries++) {
        var h = Rng.pick(rng, hosts), a = rng() * Math.PI * 2, d = h.r + r + 4;
        var x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
        if (x < r + 10 || x > K.FIELD_W - r - 10 || y < 90 || y > 680) continue;
        var ok = placed.concat(taken).every(function (p) { return p === h || Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)) > p.r + r + 4; });
        if (ok) { placed.push({ def: def, x: x, y: y, r: r }); return; }
      }
    });
    return placed;
  }

  // 場地機關（§8.1）：星點 4～6（＋星座套裝）；50% 引力井（30% 黑洞）；60% 小行星 2～3（＋碎片套裝）；微型奇點 +1 井
  function genField(rng, occupied, mods) {
    mods = mods || {};
    var taken = occupied.map(function (e) { return { x: e.x, y: e.y, r: e.r }; });
    D.HERO_POS.forEach(function (p) { taken.push({ x: p.x, y: p.y, r: K.HERO_R }); });
    function place(r, y0, y1) {
      for (var i = 0; i < 300; i++) {
        var x = Rng.int(rng, r + 20, K.FIELD_W - r - 20), y = Rng.int(rng, y0, y1);
        var ok = taken.every(function (o) { var dx = o.x - x, dy = o.y - y; return Math.sqrt(dx * dx + dy * dy) > o.r + r + K.FIELD_GAP; });
        if (ok) { taken.push({ x: x, y: y, r: r }); return { x: x, y: y }; }
      }
      return null;
    }
    var field = { stars: [], wells: [], rocks: [] };
    var wells = (rng() < 0.5 ? 1 : 0) + (mods.startWell ? 1 : 0);
    for (var w = 0; w < wells; w++) {
      var hole = rng() < 0.3;
      var g = place(hole ? K.HOLE_R + 10 : 50, 180, 620);
      if (g) field.wells.push({ x: g.x, y: g.y, radius: K.WELL_R * (1 + (mods.wellRadius || 0)), hole: hole });
    }
    var rocks = (rng() < 0.6 ? Rng.int(rng, 2, 3) : 0) + (mods.startRocks || 0);
    for (var k = 0; k < rocks; k++) { var rk = place(K.ROCK_R, 130, 700); if (rk) field.rocks.push(rk); }
    var stars = Rng.int(rng, K.STAR_MIN, K.STAR_MAX) + (mods.starsExtra || 0);
    for (var s = 0; s < stars; s++) { var st = place(12, 90, 740); if (st) field.stars.push(st); }
    return field;
  }

  // 一場戰鬥的配置。opts = {sector, boss: bossId|null, elite: bool, mods}
  function genBattle(rng, opts) {
    var boss = opts.boss ? D.BOSS_BY_ID[opts.boss] : null;
    var enemies = genEnemies(rng, opts.sector, boss ? 2 : Rng.int(rng, 4, 6), boss);
    if (opts.elite && enemies.length) {
      // 精英：把其中一隻換成精英（星區 3 可能是星蝕使徒）
      var idx = Math.floor(rng() * enemies.length);
      if (opts.sector === 3 && rng() < 0.35) {
        var ap = D.ENEMY_BY_ID.eclipse_apostle;
        enemies[idx] = { def: ap, x: enemies[idx].x, y: enemies[idx].y, r: D.SIZE_R[ap.size] };
      }
      enemies[idx].elite = Rng.pick(rng, ELITE_TRAITS);
    }
    var occupied = enemies.slice();
    if (boss) occupied.push({ x: K.FIELD_W / 2, y: 240, r: 200 });
    return { enemies: enemies, field: genField(rng, occupied, opts.mods), boss: boss ? boss.id : null };
  }

  // ---------------- 一局 ----------------
  function heroBaseHp(ids) { return ids.reduce(function (s, id) { return s + D.HERO_BY_ID[id].hp; }, 0); }
  function mods(run) { return D.computeMods(run.relics); }
  function calcMaxHp(run) {
    var m = mods(run);
    return Math.max(1, Math.round(heroBaseHp(run.heroes) * (1 + (m.hpMaxMult || 0) + run.maxHpAdj)));
  }
  // 最大 HP 變動時，目前 HP 依比例換算
  function recalcHp(run) {
    var newMax = calcMaxHp(run);
    if (newMax !== run.hpMax) {
      run.hp = Math.max(1, Math.round(run.hp * newMax / run.hpMax));
      run.hpMax = newMax;
    }
    run.hp = Math.min(run.hp, run.hpMax);
  }

  // opts = {seed, heroes:[id×4], pool:[可救援的角色 id]（省略＝全部）, relics:[起始遺物]}
  function create(opts) {
    var run = {
      seed: String(opts.seed), heroes: opts.heroes.slice(0, 4), relics: (opts.relics || []).slice(),
      pool: opts.pool || D.HEROES.map(function (h) { return h.id; }),
      sector: 1, maps: {}, nodeId: null, visited: [], energy: 0, maxHpAdj: 0,
      gaugeMinus: {}, flags: { fullGauge: false, lifePodUsed: false, drifterBoost: false },
      nodeData: {}, pendingChoices: null, state: "map",
      stats: { nodes: 0, damage: 0, maxChain: 0, bosses: 0, battles: 0 }
    };
    run.hpMax = heroBaseHp(run.heroes);
    run.hp = run.hpMax;
    recalcHp(run);
    run.hp = run.hpMax;
    run.maps[1] = genMap(rngFor(run, "map1"), 1, false);
    return run;
  }
  function mapOf(run) { return run.maps[run.sector]; }
  function nodeOf(run, id) {
    var m = mapOf(run);
    for (var i = 0; i < m.nodes.length; i++) if (m.nodes[i].id === id) return m.nodes[i];
    return null;
  }
  function current(run) { return run.nodeId ? nodeOf(run, run.nodeId) : null; }
  // 現在可以前往的節點
  function reachable(run) {
    if (run.state !== "map") return [];
    var cur = current(run);
    if (!cur) return mapOf(run).nodes.filter(function (n) { return n.layer === 1; }).map(function (n) { return n.id; });
    return cur.next.slice();
  }
  // 地圖上要不要顯示節點種類（兩層以後要探測雷達）
  function typeVisible(run, node) {
    var cur = current(run), L = cur ? cur.layer : 0;
    return node.layer <= L + 2 || node.type === "boss" || !!mods(run).radar;
  }

  function enter(run, id) {
    if (reachable(run).indexOf(id) < 0) throw new Error("unreachable " + id);
    run.nodeId = id;
    run.visited.push(id);
    run.stats.nodes++;
    run.state = "node";
    var node = nodeOf(run, id);
    var rng = rngFor(run, "node:" + id);
    var data = { type: node.type };
    if (node.type === "battle" || node.type === "elite" || node.type === "boss") {
      var boss = node.type === "boss" ? D.BOSSES[run.sector - 1].id : null;
      data.battle = genBattle(rng, { sector: run.sector, boss: boss, elite: node.type === "elite", mods: mods(run) });
      data.battle.seed = Rng.hashStr(run.seed + ":battle:" + id);
    } else if (node.type === "shop") {
      data.shop = { items: rollRelics(run, rng, RARITY_W.shop, 3).map(function (rid) { return { id: rid, price: price(run, rid), sold: false }; }), repaired: false };
    } else if (node.type === "drifter") {
      var cand = run.pool.filter(function (h) { return run.heroes.indexOf(h) < 0; });
      data.drifter = cand.length ? Rng.pick(rng, cand) : null;
    } else if (node.type === "event") {
      data.event = Rng.pick(rng, D.EVENTS).id;
    }
    run.nodeData[id] = data;
    return node;
  }
  function data(run) { return run.nodeData[run.nodeId]; }

  // 戰鬥用的設定：交給 Combat.create
  function battleSetup(run) {
    var d = data(run), m = mods(run);
    var gaugeMinus = {};
    run.heroes.forEach(function (id) { gaugeMinus[id] = (run.gaugeMinus[id] || 0) + (m.gaugeMaxMinus || 0); });
    var s = {
      heroes: run.heroes.map(function (id) { return D.HERO_BY_ID[id]; }),
      enemies: d.battle.enemies, field: d.battle.field, boss: d.battle.boss, seed: d.battle.seed,
      mods: m, hp: run.hp, hpMax: run.hpMax, gaugeMinus: gaugeMinus, fullGauge: run.flags.fullGauge,
      lifePodUsed: run.flags.lifePodUsed
    };
    run.flags.fullGauge = false;
    return s;
  }

  // 戰鬥結束。result = {win, hp, damage, maxChain, lifePodUsed}
  function finishBattle(run, result) {
    var node = current(run), m = mods(run);
    run.stats.battles++;
    run.stats.damage += result.damage || 0;
    run.stats.maxChain = Math.max(run.stats.maxChain, result.maxChain || 0);
    if (result.lifePodUsed) run.flags.lifePodUsed = true;
    if (!result.win) { run.hp = 0; run.state = "lost"; return { energy: 0, choices: [] }; }
    run.hp = Math.min(run.hpMax, Math.max(1, Math.round(result.hp + run.hpMax * (m.healOnWin || 0))));
    var energy = Math.round(ENERGY[node.type === "boss" ? "boss" : node.type === "elite" ? "elite" : "battle"] * (1 + (m.energyMult || 0)));
    if (node.type === "elite") energy += m.eliteBounty || 0;
    run.energy += energy;
    var rng = rngFor(run, "reward:" + node.id);
    var w = node.type === "battle" ? RARITY_W.normal : RARITY_W.elite;
    var choices = rollRelics(run, rng, w, 3 + (m.rewardChoices || 0));
    if (node.type === "boss") run.stats.bosses++;
    run.pendingChoices = choices;
    run.state = "reward";
    return { energy: energy, choices: choices };
  }

  // 遺物抽選：依稀有度權重、排除已持有、前置條件
  function rollRelics(run, rng, weights, n) {
    var owned = run.relics.slice(), out = [];
    for (var i = 0; i < n; i++) {
      var w = {};
      Object.keys(weights).forEach(function (k) { w[k] = weights[k]; });
      var pick = null;
      for (var tries = 0; tries < 4 && !pick; tries++) {
        var rar = weighted(rng, w);
        var cand = D.RELICS.filter(function (r) {
          return r.rarity === rar && owned.indexOf(r.id) < 0 && out.indexOf(r.id) < 0 && (!r.requires || owned.indexOf(r.requires) >= 0);
        });
        if (cand.length) pick = Rng.pick(rng, cand).id;
        else w[rar] = 0;
      }
      if (pick) out.push(pick);
    }
    return out;
  }

  // 選獎勵（null = 跳過）。Boss 打完就進下一星區（星區 3 → 通關）
  function takeRelic(run, id) {
    if (run.state !== "reward") throw new Error("no reward");
    if (id) {
      if ((run.pendingChoices || []).indexOf(id) < 0) throw new Error("not offered");
      addRelic(run, id);
    }
    run.pendingChoices = null;
    var node = current(run);
    if (node.type === "boss") {
      if (run.sector >= 3) { run.state = "won"; return; }
      run.sector++;
      if (mods(run).drifterBoost) run.flags.drifterBoost = true;
      run.maps[run.sector] = genMap(rngFor(run, "map" + run.sector), run.sector, run.flags.drifterBoost);
      run.nodeId = null;
    }
    run.state = "map";
  }
  function addRelic(run, id) {
    if (run.relics.indexOf(id) >= 0) return;
    run.relics.push(id);
    recalcHp(run);
    if (mods(run).drifterBoost) run.flags.drifterBoost = true;
  }

  // ---------------- 補給站 ----------------
  function price(run, id) { return Math.round(PRICE[D.RELIC_BY_ID[id].rarity] * (1 + (mods(run).shopMult || 0))); }
  function repairCost(run) { return Math.round(REPAIR_COST * (1 + (mods(run).shopMult || 0))); }
  function buy(run, i) {
    var it = data(run).shop.items[i];
    if (!it || it.sold || run.energy < it.price || run.relics.indexOf(it.id) >= 0) return false;
    run.energy -= it.price;
    it.sold = true;
    addRelic(run, it.id);
    return true;
  }
  function repair(run) {
    var sh = data(run).shop, cost = repairCost(run);
    if (sh.repaired || run.energy < cost) return false;
    run.energy -= cost;
    sh.repaired = true;
    run.hp = Math.min(run.hpMax, run.hp + Math.round(run.hpMax * REPAIR_PCT));
    return true;
  }

  // ---------------- 休息 ----------------
  function rest(run, kind, heroIndex) {
    if (kind === "heal") {
      run.hp = Math.min(run.hpMax, run.hp + Math.round(run.hpMax * REST_PCT * (1 + (mods(run).restBonus || 0))));
    } else {
      var id = run.heroes[heroIndex];
      var cur = run.gaugeMinus[id] || 0;
      var maxMinus = D.HERO_BY_ID[id].gauge - 8;
      run.gaugeMinus[id] = Math.min(maxMinus, cur + 5);
    }
    leave(run);
  }

  // ---------------- 漂流者 ----------------
  function drifterCost(run, pay) { return pay === "energy" ? DRIFTER_ENERGY : Math.round(run.hp * DRIFTER_HP); }
  function canRescue(run, pay) {
    var d = data(run);
    if (!d.drifter) return false;
    return pay === "energy" ? run.energy >= DRIFTER_ENERGY : run.hp > drifterCost(run, "hp");
  }
  // replaceIndex = null 時只救不換
  function rescue(run, pay, replaceIndex) {
    if (!canRescue(run, pay)) return false;
    if (pay === "energy") run.energy -= DRIFTER_ENERGY; else run.hp -= drifterCost(run, "hp");
    if (replaceIndex != null) {
      run.heroes[replaceIndex] = data(run).drifter;
      recalcHp(run);
    }
    leave(run);
    return true;
  }

  // ---------------- 異常訊號 ----------------
  function eventOf(run) { var id = data(run).event; return D.EVENTS.filter(function (e) { return e.id === id; })[0]; }
  function canChoose(run, opt) { var fx = eventOf(run)[opt].fx; return !fx.cost || run.energy >= fx.cost; }
  function choose(run, opt) {
    var e = eventOf(run), fx = e[opt].fx, m = mods(run);
    if (!canChoose(run, opt)) return null;
    var rng = rngFor(run, "event:" + run.nodeId);
    var out = { relic: null, hp: 0, energy: 0, maxHp: 0 };
    var neg = function (v) { return v < 0 && m.scavenger ? v / 2 : v; };
    if (fx.cost) { run.energy -= fx.cost; out.energy -= fx.cost; }
    if (fx.energy) { run.energy += fx.energy; out.energy += fx.energy; }
    var hpPct = fx.hpPct || 0;
    if (fx.gamble) { if (rng() < 0.5) fx = { relic: "common" }; else hpPct = -0.1; }
    if (fx.relic) {
      var w = {}; w[fx.relic] = 1;
      var got = rollRelics(run, rng, w, 1)[0];
      if (got) { addRelic(run, got); out.relic = got; }
    }
    if (fx.maxHpPct) {
      run.maxHpAdj += neg(fx.maxHpPct);
      var before = run.hpMax;
      recalcHp(run);
      out.maxHp = run.hpMax - before;
    }
    if (hpPct) {
      var d = Math.round(run.hpMax * neg(hpPct));
      var h0 = run.hp;
      run.hp = Math.max(1, Math.min(run.hpMax, run.hp + d));
      out.hp = run.hp - h0;
    }
    if (fx.fullGauge) run.flags.fullGauge = true;
    leave(run);
    return out;
  }

  // 非戰鬥節點結束，回到地圖
  function leave(run) { if (run.state === "node") run.state = "map"; }

  // 分數（§12）：抵達節點數 ×100 ＋ 總傷害 ÷100 ＋ 最大連爆 ×200 ＋ 剩餘 HP% ×10 ＋ 通關 1000
  function score(run) {
    var s = run.stats;
    return s.nodes * 100 + Math.floor(s.damage / 100) + s.maxChain * 200 + Math.round(100 * run.hp / run.hpMax) * 10 + (run.state === "won" ? 1000 : 0);
  }

  var api = {
    create: create, genMap: genMap, genBattle: genBattle, genEnemies: genEnemies, genField: genField,
    mapOf: mapOf, nodeOf: nodeOf, current: current, reachable: reachable, typeVisible: typeVisible, enter: enter, data: data,
    battleSetup: battleSetup, finishBattle: finishBattle, takeRelic: takeRelic, rollRelics: rollRelics, addRelic: addRelic,
    price: price, repairCost: repairCost, buy: buy, repair: repair, rest: rest, drifterCost: drifterCost, canRescue: canRescue,
    rescue: rescue, eventOf: eventOf, canChoose: canChoose, choose: choose, leave: leave, score: score, mods: mods, calcMaxHp: calcMaxHp,
    LAYERS: LAYERS, ELITE_TRAITS: ELITE_TRAITS
  };
  root.PriTestShedanRun = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
