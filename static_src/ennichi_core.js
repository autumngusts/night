// ============================================================================
// 緣日樂園：核心規則（純函式；狀態 s 可 JSON 化）。
//   新局、亂數、地圖與建造（組裝期）、倉庫、市場（Task 3）、工房（Task 4）、改裝（Task 5）、
//   日循環與 applyIntent／tick（Task 11）、存檔。客人在 ennichi_sim.js、murmur 在 ennichi_murmur.js、繪馬在 ennichi_wish.js。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData;
  var M = D.MAP;

  // ---- 亂數（mulberry32；狀態存在 s.rs，存檔後可重播）
  function rnd(s) {
    s.rs = (s.rs + 0x6D2B79F5) | 0;
    var t = s.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(s, n) { return Math.floor(rnd(s) * n); }
  function pickW(s, list) {
    var r = rnd(s), acc = 0;
    for (var i = 0; i < list.length; i++) { acc += list[i].w; if (r < acc) return list[i]; }
    return list[list.length - 1];
  }

  // ---- 地圖
  function ti(x, y) { return y * M.W + x; }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < M.W && y < M.H; }
  function isPath(s, x, y) { return inMap(x, y) && s.tiles[ti(x, y)] === 1; }
  function entranceOf(st) {
    var b = D.BUILD[st.type];
    if (st.type === "shrine") return { x: st.x - 1, y: M.GATE.y }; // 本殿的入口在參道盡頭
    return { x: st.x + Math.floor(b.w / 2), y: st.y + b.h };
  }
  function popLevel(s) {
    var lv = 1;
    for (var i = 0; i < D.POP_LEVELS.length; i++) if (s.rep >= D.POP_LEVELS[i]) lv = i + 1;
    return lv;
  }
  function machineSlots(s) { return D.MACHINE_SLOTS + (popLevel(s) - 1) * D.MACHINE_SLOTS_PER_LV; }
  function weatherOf(s, day) { return s.weather[day] || "sun"; }

  // ---- 倉庫
  function wareTotal(s) { var n = 0; for (var k in s.ware) n += s.ware[k]; return n; }
  function have(s, map) { for (var k in map) if ((s.ware[k] || 0) < map[k]) return false; return true; }
  function take(s, map) { for (var k in map) { s.ware[k] = (s.ware[k] || 0) - map[k]; if (!s.ware[k]) delete s.ware[k]; } }
  function give(s, map) { for (var k in map) if (map[k] > 0) s.ware[k] = (s.ware[k] || 0) + map[k]; }
  function one(k, n) { var o = {}; o[k] = n; return o; }

  function shuffled(s, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rint(s, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function newGame(opt) {
    var s = {
      v: 1, seed: opt.seed | 0, rs: opt.seed | 0,
      day: 1, phase: "plan", min: D.DAY_START, cash: D.START_CASH, rep: 0, fee: D.ENTRY_FEE,
      tiles: [], occ: [], structs: {}, nextId: 1, mapVer: 1,
      ware: {}, machines: [], guests: [], nextGid: 1,
      weather: [], wishes: [], nextWish: 1,
      dirt: 0, today: null, history: [], photos: [],
    };
    for (var i = 0; i < M.W * M.H; i++) { s.tiles.push(0); s.occ.push(0); }
    for (var x = 0; x < M.SHRINE.x; x++) s.tiles[ti(x, M.GATE.y)] = 1;
    place(s, "shrine", M.SHRINE.x, M.SHRINE.y);
    give(s, D.START_WARE);
    D.START_MACHINES.forEach(function (m) {
      var rid = null;
      for (var r in D.RECIPES) if (D.RECIPES[r].m === m) { rid = r; break; }
      s.machines.push({ type: m, rid: rid, t: null });
    });
    var wl = Object.keys(D.WEATHER).map(function (k) { return { id: k, w: D.WEATHER[k].w }; });
    s.weather.push("sun");
    for (var d = 1; d <= D.SEASON_DAYS; d++) s.weather.push(pickW(s, wl).id);
    s.photos = shuffled(s, D.PHOTOS);
    return s;
  }

  function place(s, type, x, y) {
    var b = D.BUILD[type], sid = s.nextId++;
    s.structs[sid] = {
      id: sid, type: type, x: x, y: y, wear: 0, broken: false, price: b.price || 0, q: [], riders: [], t: 0, fixes: 0,
      build: b.days || 0, mods: {}, ticket: false, link: null, waitSum: 0, waitN: 0, lastWait: 0,
    };
    for (var yy = y; yy < y + b.h; yy++) for (var xx = x; xx < x + b.w; xx++) s.occ[ti(xx, yy)] = sid;
    s.mapVer++;
    return sid;
  }

  function nearRide(s, pos) {
    var best = 0, bd = 1e9;
    for (var k in s.structs) {
      var st = s.structs[k];
      if (D.BUILD[st.type].kind !== "ride") continue;
      var e = entranceOf(st), d = Math.abs(e.x - pos.x) + Math.abs(e.y - pos.y);
      if (d <= D.QSTALL_RANGE && d < bd) { bd = d; best = st.id; }
    }
    return best;
  }

  function canBuild(s, type, x, y) {
    var b = D.BUILD[type];
    if (!b || type === "shrine") return { ok: false, err: "bounds" };
    if (s.phase !== "plan") return { ok: false, err: "phase" };
    if (popLevel(s) < b.lv) return { ok: false, err: "level" };
    if (!inMap(x, y) || !inMap(x + b.w - 1, y + b.h - 1)) return { ok: false, err: "bounds" };
    if (x + b.w > M.UNLOCK_X) return { ok: false, err: "locked" };
    for (var yy = y; yy < y + b.h; yy++) for (var xx = x; xx < x + b.w; xx++) {
      if (s.occ[ti(xx, yy)] || s.tiles[ti(xx, yy)] === 1) return { ok: false, err: "occupied" };
    }
    var e = { x: x + Math.floor(b.w / 2), y: y + b.h };
    if (!isPath(s, e.x, e.y) || s.occ[ti(e.x, e.y)]) return { ok: false, err: "entrance" };
    if (b.kind === "qstall" && !nearRide(s, e)) return { ok: false, err: "noride" };
    if (!have(s, b.parts)) return { ok: false, err: "parts" };
    if (s.cash < b.cash) return { ok: false, err: "cash" };
    return { ok: true, err: null };
  }

  function build(s, type, x, y) {
    var c = canBuild(s, type, x, y);
    if (!c.ok) return c;
    var b = D.BUILD[type];
    take(s, b.parts);
    s.cash -= b.cash;
    var sid = place(s, type, x, y);
    if (b.kind === "qstall") s.structs[sid].link = nearRide(s, entranceOf(s.structs[sid]));
    return { ok: true, err: null, sid: sid };
  }

  function demolish(s, sid) {
    var st = s.structs[sid];
    if (!st || st.type === "shrine" || s.phase !== "plan") return false;
    var b = D.BUILD[st.type];
    for (var yy = st.y; yy < st.y + b.h; yy++) for (var xx = st.x; xx < st.x + b.w; xx++) s.occ[ti(xx, yy)] = 0;
    s.cash += Math.floor(b.cash * D.REFUND);
    if (st.build > 0) for (var k in b.parts) give(s, one(k, Math.floor(b.parts[k] * D.REFUND)));
    delete s.structs[sid];
    for (var j in s.structs) if (s.structs[j].link === sid) s.structs[j].link = null;
    s.mapVer++;
    return true;
  }

  function isEntranceTile(s, x, y) {
    for (var k in s.structs) { var e = entranceOf(s.structs[k]); if (e.x === x && e.y === y) return true; }
    return false;
  }

  function setPath(s, x, y, on) {
    if (s.phase !== "plan" || !inMap(x, y) || x >= M.UNLOCK_X) return false;
    var i = ti(x, y);
    if (s.occ[i]) return false;
    if (on) {
      if (s.tiles[i] === 1 || s.cash < D.PATH_COST) return false;
      s.tiles[i] = 1; s.cash -= D.PATH_COST;
    } else {
      if (s.tiles[i] !== 1 || isEntranceTile(s, x, y) || (y === M.GATE.y && x === M.GATE.x)) return false;
      s.tiles[i] = 0;
    }
    s.mapVer++;
    return true;
  }

  function buy(s, item, n) {
    var it = D.ITEMS[item];
    if (!it || it.kind !== "mat" || n <= 0 || s.phase !== "plan") return false;
    if (s.cash < it.buy * n || wareTotal(s) + n > D.WARE_CAP) return false;
    s.cash -= it.buy * n;
    give(s, one(item, n));
    return true;
  }

  function addMachine(s, type) {
    var m = D.MACHINES[type];
    if (!m || s.phase !== "plan" || s.machines.length >= machineSlots(s) || s.cash < m.cost) return false;
    s.cash -= m.cost;
    s.machines.push({ type: type, rid: null, t: null });
    return true;
  }

  function setRecipe(s, mi, rid) {
    var m = s.machines[mi], r = D.RECIPES[rid];
    if (!m || !r || r.m !== m.type) return false;
    m.rid = rid; m.t = null;
    return true;
  }

  function setPrice(s, sid, price) {
    var st = s.structs[sid];
    if (!st || D.BUILD[st.type].kind !== "ride" || price < 0 || price > 2000) return false;
    st.price = Math.round(price / 10) * 10;
    return true;
  }

  function setFee(s, fee) {
    if (s.phase !== "plan" || fee < 0 || fee > 2000) return false;
    s.fee = Math.round(fee / 10) * 10;
    return true;
  }

  // ---- 工房：每遊戲分鐘一次。每台機器每分鐘只做一件事（待機→取料開工／加工中→推進、完成產出）
  function workshopStep(s) {
    s.machines.forEach(function (m) {
      var r = m.rid && D.RECIPES[m.rid];
      if (!r) return;
      if (m.t === null) {
        var inN = 0, outN = 0, k;
        for (k in r.in) inN += r.in[k];
        for (k in r.out) outN += r.out[k];
        if (have(s, r.in) && wareTotal(s) - inN + outN <= D.WARE_CAP) { take(s, r.in); m.t = 0; }
        return;
      }
      m.t++;
      if (m.t >= r.t) {
        give(s, r.out);
        if (s.today) for (var o in r.out) s.today.made[o] = (s.today.made[o] || 0) + r.out[o];
        m.t = null;
      }
    });
  }

  // ---- 改裝：大型設施的改裝槽（規格 §4.6）
  function effStats(st) {
    var b = D.BUILD[st.type];
    var e = { thrill: b.thrill || 0, charm: b.charm || 0, photo: b.photo || 0, price: st.price || 0, wearMul: 1 };
    for (var sl in st.mods) {
      var f = b.slots[sl].eff;
      for (var k in f) {
        if (k === "wearMul") e.wearMul *= f[k];
        else e[k] += f[k];
      }
    }
    return e;
  }

  function upgrade(s, sid, slot) {
    var st = s.structs[sid], b = st && D.BUILD[st.type], sl = b && b.slots && b.slots[slot];
    if (!sl || s.phase !== "plan" || st.build > 0 || st.mods[slot]) return false;
    var need = one(sl.mod, sl.n);
    if (!have(s, need)) return false;
    take(s, need);
    st.mods[slot] = 1;
    return true;
  }

  // ---- 日循環
  function openDay(s) {
    if (s.phase !== "plan") return false;
    var Sim = window.PriTestEnnichiSim, w = weatherOf(s, s.day);
    s.phase = "open"; s.min = D.DAY_START; s.guests = [];
    s.today = {
      guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, sales: {},
      spawn: Sim.spawnSchedule(s), murmurs: [], topics: {}, weather: w, closed: Sim.closedFor(s, w), wishesDone: 0,
    };
    return true;
  }

  function tick(s, n) {
    var Sim = window.PriTestEnnichiSim;
    for (var i = 0; i < n && s.phase === "open"; i++) {
      Sim.step(s);
      workshopStep(s);
      s.min++;
      if ((s.min >= D.DAY_END && !s.guests.length && !s.today.spawn.length) || s.min >= D.DAY_END + 90) closeDay(s);
    }
  }

  function closeDay(s) {
    var t = s.today;
    s.guests.forEach(function (g) { t.hapSum += g.hap; t.hapN++; t.left++; });
    s.guests = [];
    var avg = t.hapN ? Math.round(t.hapSum / t.hapN) : 0;
    var delta = Math.round((avg - 55) * t.hapN / 40) + t.sns;
    s.rep = Math.max(0, s.rep + delta);
    for (var k in s.structs) {
      var st = s.structs[k];
      st.lastWait = st.waitN ? Math.round(st.waitSum / st.waitN) : 0;
      st.waitSum = 0; st.waitN = 0; st.q = []; st.riders = []; st.t = 0;
      if (st.build > 0) st.build--;
    }
    var Wish = window.PriTestEnnichiWish, Murmur = window.PriTestEnnichiMurmur;
    if (Wish) { Wish.check(s); Wish.expire(s); }
    var sum = { day: s.day, guests: t.guests, rev: t.rev + t.fees, avgHap: avg, repDelta: delta, sns: t.sns, weather: t.weather, wishesDone: t.wishesDone, topTopics: Murmur ? Murmur.topTopics(s, 3) : [] };
    s.history.push(sum);
    s.dirt = 0;
    s.phase = "close";
    return sum;
  }

  function repair(s, sid) {
    var st = s.structs[sid];
    if (!st || s.phase !== "plan") return false;
    var b = D.BUILD[st.type];
    if (b.kind !== "ride" || (!st.broken && !st.wear) || !have(s, b.fix)) return false;
    take(s, b.fix);
    st.wear = 0; st.broken = false; st.fixes++;
    return true;
  }

  function nextDay(s) {
    if (s.phase !== "close") return false;
    s.day++;
    s.phase = s.day > D.SEASON_DAYS ? "season" : "plan";
    s.min = D.DAY_START;
    return true;
  }

  function seasonResult(s) {
    var g = 0, rev = 0, hs = 0, wishes = 0;
    s.history.forEach(function (h) { g += h.guests; rev += h.rev; hs += h.avgHap * h.guests; wishes += h.wishesDone; });
    return { guests: g, rev: rev, avgHap: g ? Math.round(hs / g) : 0, rep: s.rep, level: popLevel(s), wishes: wishes };
  }

  function applyIntent(s, it) {
    var ok, Wish = window.PriTestEnnichiWish;
    switch (it && it.a) {
      case "build": var r = build(s, it.type, it.x, it.y); if (r.ok && Wish) Wish.check(s); return r;
      case "demolish": ok = demolish(s, it.sid); break;
      case "path": ok = setPath(s, it.x, it.y, !!it.on); break;
      case "buy": ok = buy(s, it.item, it.n); break;
      case "machine": ok = addMachine(s, it.type); break;
      case "recipe": ok = setRecipe(s, it.mi, it.rid); break;
      case "price": ok = setPrice(s, it.sid, it.price); break;
      case "fee": ok = setFee(s, it.fee); break;
      case "repair": ok = repair(s, it.sid); break;
      case "upgrade": ok = upgrade(s, it.sid, it.slot); if (ok && Wish) Wish.check(s); break;
      case "ticket": ok = setTicket(s, it.sid, it.on); break;
      case "open": ok = openDay(s); break;
      case "next": ok = nextDay(s); break;
      default: return { ok: false, err: "unknown" };
    }
    return { ok: ok, err: ok ? null : "rejected" };
  }

  function serialize(s) { return JSON.stringify(s); }
  function restore(str) {
    try { var s = JSON.parse(str); return s && s.v === 1 ? s : null; } catch (e) { return null; }
  }

  function setTicket(s, sid, on) {
    var st = s.structs[sid];
    if (!st || D.BUILD[st.type].kind !== "ride") return false;
    st.ticket = !!on;
    return true;
  }

  window.PriTestEnnichiCore = {
    rnd: rnd, rint: rint, pickW: pickW, ti: ti, inMap: inMap, isPath: isPath, entranceOf: entranceOf,
    popLevel: popLevel, machineSlots: machineSlots, weatherOf: weatherOf,
    wareTotal: wareTotal, have: have, take: take, give: give, nearRide: nearRide,
    newGame: newGame, canBuild: canBuild, build: build, demolish: demolish, setPath: setPath, setTicket: setTicket,
    buy: buy, addMachine: addMachine, setRecipe: setRecipe, setPrice: setPrice, setFee: setFee,
    workshopStep: workshopStep, effStats: effStats, upgrade: upgrade,
    openDay: openDay, tick: tick, closeDay: closeDay, repair: repair, nextDay: nextDay, seasonResult: seasonResult, applyIntent: applyIntent,
    serialize: serialize, restore: restore,
  };
})();
