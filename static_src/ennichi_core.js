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
  // 世界座標：區域 a 佔第 a×H〜a×H+H−1 列（D.AREAS，規格 §6.3.1）
  function inMap(x, y) { return x >= 0 && y >= 0 && x < M.W && y < M.WH; }
  function isPath(s, x, y) { return inMap(x, y) && s.tiles[ti(x, y)] === 1; }
  function areaOf(y) { return Math.max(0, Math.min(D.AREAS.length - 1, Math.floor(y / M.H))); }
  function areaIndex(id) { for (var i = 0; i < D.AREAS.length; i++) if (D.AREAS[i].id === id) return i; return -1; }
  function areaOpen(s, a) { var ar = D.AREAS[a]; return !!(ar && s.areas && s.areas[ar.id]); }
  function gateOf(a) { return { x: M.GATE.x, y: (a || 0) * M.H + M.GATE.y }; }
  // 湖面（水樂園）：不能鋪步道，只能蓋 water 設施
  function isWater(x, y) {
    if (!inMap(x, y)) return false;
    var a = areaOf(y), lk = D.AREAS[a].lake, ly = y - a * M.H;
    return !!lk && x >= lk.x && x < lk.x + lk.w && ly >= lk.y && ly < lk.y + lk.h;
  }
  // 倉庫上限與機器槽：工廠區的倉庫棟、機器棚（完工的才算）
  function infraSum(s, key) {
    var n = 0;
    for (var k in s.structs) { var st = s.structs[k], b = D.BUILD[st.type]; if (b.kind === "infra" && !(st.build > 0)) n += b[key] || 0; }
    return n;
  }
  function wareCap(s) { return D.WARE_CAP + infraSum(s, "ware"); }
  // 方向 rot（2026-11-14，規格 §4.7）：入口朝 0 下（+y）、1 左（−x）、2 上（−y）、3 右（+x）。
  //   rot 為奇數時佔地的寬高對調；(x, y) 一律是佔地的左上角。
  function dims(type, rot) {
    var b = D.BUILD[type];
    return (rot | 0) % 2 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
  }
  function entranceAt(type, x, y, rot) {
    var d = dims(type, rot);
    switch ((rot | 0) % 4) {
      case 1: return { x: x - 1, y: y + Math.floor(d.h / 2) };
      case 2: return { x: x + Math.floor(d.w / 2), y: y - 1 };
      case 3: return { x: x + d.w, y: y + Math.floor(d.h / 2) };
      default: return { x: x + Math.floor(d.w / 2), y: y + d.h };
    }
  }
  function entranceOf(st) {
    if (st.type === "shrine") return { x: st.x - 1, y: M.GATE.y }; // 本殿的入口在參道盡頭
    return entranceAt(st.type, st.x, st.y, st.rot);
  }
  function popLevel(s) {
    var lv = 1;
    for (var i = 0; i < D.POP_LEVELS.length; i++) if (s.rep >= D.POP_LEVELS[i]) lv = i + 1;
    return lv;
  }
  function machineSlots(s) { return D.MACHINE_SLOTS + (popLevel(s) - 1) * D.MACHINE_SLOTS_PER_LV + infraSum(s, "slots"); }
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
      tiles: [], occ: [], structs: {}, nextId: 1, mapVer: 1, areas: { shrine: 1 },
      ware: {}, machines: [], guests: [], nextGid: 1,
      weather: [], wishes: [], nextWish: 1, wishesDoneTotal: 0,
      dirt: 0, today: null, history: [], photos: [],
    };
    for (var i = 0; i < M.W * M.WH; i++) { s.tiles.push(0); s.occ.push(0); }
    for (var x = 0; x < M.SHRINE.x; x++) s.tiles[ti(x, M.GATE.y)] = 1;
    place(s, "shrine", M.SHRINE.x, M.SHRINE.y);
    give(s, D.START_WARE);
    D.START_MACHINES.forEach(function (m) {
      var rid = null;
      for (var r in D.RECIPES) if (D.RECIPES[r].m === m) { rid = r; break; }
      s.machines.push({ type: m, rid: rid, t: null, limit: null });
    });
    var wl = Object.keys(D.WEATHER).map(function (k) { return { id: k, w: D.WEATHER[k].w }; });
    s.weather.push("sun");
    for (var d = 1; d <= D.SEASON_DAYS; d++) s.weather.push(pickW(s, wl).id);
    s.photos = shuffled(s, D.PHOTOS);
    return s;
  }

  function place(s, type, x, y, rot) {
    var b = D.BUILD[type], sid = s.nextId++, d = dims(type, rot);
    s.structs[sid] = {
      id: sid, type: type, x: x, y: y, wear: 0, broken: false, price: b.price || 0, q: [], riders: [], t: 0, fixes: 0,
      build: b.days || 0, mods: {}, ticket: false, link: null, waitSum: 0, waitN: 0, lastWait: 0, rot: (rot | 0) % 4,
    };
    for (var yy = y; yy < y + d.h; yy++) for (var xx = x; xx < x + d.w; xx++) s.occ[ti(xx, yy)] = sid;
    s.mapVer++;
    return sid;
  }

  function nearRide(s, pos) {
    var best = 0, bd = 1e9, a = areaOf(pos.y);
    for (var k in s.structs) {
      var st = s.structs[k];
      if (D.BUILD[st.type].kind !== "ride" || areaOf(st.y) !== a) continue;
      var e = entranceOf(st), d = Math.abs(e.x - pos.x) + Math.abs(e.y - pos.y);
      if (d <= D.QSTALL_RANGE && d < bd) { bd = d; best = st.id; }
    }
    return best;
  }

  function canBuild(s, type, x, y, rot) {
    var b = D.BUILD[type];
    if (!b || type === "shrine") return { ok: false, err: "bounds" };
    if (s.phase !== "plan") return { ok: false, err: "phase" };
    if (popLevel(s) < b.lv) return { ok: false, err: "level" };
    var d = dims(type, rot), e = entranceAt(type, x, y, rot);
    if (!inMap(x, y) || !inMap(x + d.w - 1, y + d.h - 1)) return { ok: false, err: "bounds" };
    var a = areaOf(y), ar = D.AREAS[a];
    // 本體與入口都要在同一區（入口在地圖外或別區都不行）
    if (Math.floor((y + d.h - 1) / M.H) !== a || !inMap(e.x, e.y) || Math.floor(e.y / M.H) !== a || e.y < 0) return { ok: false, err: "bounds" };
    if (!areaOpen(s, a) || x + d.w > ar.unlockX) return { ok: false, err: "locked" };
    if (b.area && b.area !== ar.id) return { ok: false, err: "area" };
    for (var yy = y; yy < y + d.h; yy++) for (var xx = x; xx < x + d.w; xx++) {
      if (s.occ[ti(xx, yy)] || s.tiles[ti(xx, yy)] === 1) return { ok: false, err: "occupied" };
      if (isWater(xx, yy) !== !!b.water) return { ok: false, err: b.water ? "needwater" : "water" };
    }
    if (!isPath(s, e.x, e.y) || s.occ[ti(e.x, e.y)]) return { ok: false, err: "entrance" };
    if (b.kind === "qstall" && !nearRide(s, e)) return { ok: false, err: "noride" };
    if (!have(s, b.parts)) return { ok: false, err: "parts" };
    if (s.cash < b.cash) return { ok: false, err: "cash" };
    return { ok: true, err: null };
  }

  function build(s, type, x, y, rot) {
    var c = canBuild(s, type, x, y, rot);
    if (!c.ok) return c;
    var b = D.BUILD[type];
    take(s, b.parts);
    s.cash -= b.cash;
    var sid = place(s, type, x, y, rot);
    if (b.kind === "qstall") s.structs[sid].link = nearRide(s, entranceOf(s.structs[sid]));
    // 新蓋遊樂設施：附近原本沒連結（設施被拆掉）的排隊屋台重新連上
    if (b.kind === "ride") for (var j in s.structs) {
      var q = s.structs[j];
      if (D.BUILD[q.type].kind === "qstall" && !q.link) q.link = nearRide(s, entranceOf(q)) || null;
    }
    return { ok: true, err: null, sid: sid };
  }

  function demolish(s, sid) {
    var st = s.structs[sid];
    if (!st || st.type === "shrine" || s.phase !== "plan") return false;
    var b = D.BUILD[st.type], d = dims(st.type, st.rot);
    for (var yy = st.y; yy < st.y + d.h; yy++) for (var xx = st.x; xx < st.x + d.w; xx++) s.occ[ti(xx, yy)] = 0;
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
    if (s.phase !== "plan" || !inMap(x, y)) return false;
    var a = areaOf(y);
    if (!areaOpen(s, a) || x >= D.AREAS[a].unlockX || isWater(x, y)) return false;
    var i = ti(x, y), g = gateOf(a);
    if (s.occ[i]) return false;
    if (on) {
      if (s.tiles[i] === 1 || s.cash < D.PATH_COST) return false;
      s.tiles[i] = 1; s.cash -= D.PATH_COST;
    } else {
      if (s.tiles[i] !== 1 || isEntranceTile(s, x, y) || (y === g.y && x === g.x)) return false;
      s.tiles[i] = 0;
    }
    s.mapVer++;
    return true;
  }

  function buy(s, item, n) {
    var it = D.ITEMS[item];
    if (!it || it.kind !== "mat" || n <= 0 || s.phase !== "plan") return false;
    if (s.cash < it.buy * n || wareTotal(s) + n > wareCap(s)) return false;
    s.cash -= it.buy * n;
    give(s, one(item, n));
    return true;
  }

  function addMachine(s, type) {
    var m = D.MACHINES[type];
    if (!m || s.phase !== "plan" || s.machines.length >= machineSlots(s) || s.cash < m.cost) return false;
    s.cash -= m.cost;
    s.machines.push({ type: type, rid: null, t: null, limit: null });
    return true;
  }

  // rid = null → 停機（回到待機）；加工中的那一批作廢
  function setRecipe(s, mi, rid) {
    var m = s.machines[mi], r = rid === null ? null : D.RECIPES[rid];
    if (!m || (rid !== null && (!r || r.m !== m.type))) return false;
    m.rid = rid; m.t = null;
    return true;
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // 庫存上限：倉庫裡該配方產物 ≥ limit 時不開新工（待機），庫存降下來再自動開工。null = 不限
  // （2026-11-13 起只接受 null 或 1〜WARE_CAP 的有限數字；0、NaN、字串一律拒絕）
  function setLimit(s, mi, n) {
    var m = s.machines[mi];
    if (!m || (n !== null && (!isNum(n) || n < 1 || n > wareCap(s)))) return false;
    m.limit = n === null ? null : Math.floor(n);
    return true;
  }
  function overLimit(s, m, r) {
    if (!m.limit) return false;
    for (var k in r.out) if ((s.ware[k] || 0) >= m.limit) return true;
    return false;
  }

  function setPrice(s, sid, price) {
    var st = s.structs[sid];
    if (!st || D.BUILD[st.type].kind !== "ride" || !isNum(price) || price < 0 || price > 2000) return false;
    st.price = Math.round(price / 10) * 10;
    return true;
  }

  function setFee(s, fee) {
    if (s.phase !== "plan" || !isNum(fee) || fee < 0 || fee > 2000) return false;
    s.fee = Math.round(fee / 10) * 10;
    return true;
  }

  // ---- 工房：每遊戲分鐘一次。每台機器每分鐘只做一件事（待機→取料開工／加工中→推進、完成產出）
  function workshopStep(s) {
    var cap = wareCap(s);
    s.machines.forEach(function (m) {
      var r = m.rid && D.RECIPES[m.rid];
      if (!r) return;
      if (m.t === null) {
        var inN = 0, outN = 0, k;
        for (k in r.in) inN += r.in[k];
        for (k in r.out) outN += r.out[k];
        if (!overLimit(s, m, r) && have(s, r.in) && wareTotal(s) - inN + outN <= cap) { take(s, r.in); m.t = 0; }
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
    if (s.phase !== "open") return null;
    var t = s.today;
    s.guests.forEach(function (g) { t.hapSum += g.hap; t.hapN++; t.left++; });
    s.guests = [];
    var avg = t.hapN ? Math.round(t.hapSum / t.hapN) : 0;
    // 口碑：以平均心情為主（不再乘來客數），加上 SNS（有上限），整體每天限制在 ±REP.dayMax
    var mood = t.hapN ? Math.round((avg - D.REP.base) * D.REP.mood) : 0;
    var delta = Math.max(-D.REP.dayMax, Math.min(D.REP.dayMax, mood + Math.min(t.sns, D.REP.snsMax)));
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

  // 解鎖區域（規格 §6.3.1）：開園前、人氣等級與資金足夠；入口那一列整列鋪好步道（湖面除外）
  function canUnlock(s, id) {
    var a = areaIndex(id), ar = D.AREAS[a];
    if (!ar || areaOpen(s, a)) return { ok: false, err: "rejected" };
    if (s.phase !== "plan") return { ok: false, err: "phase" };
    if (popLevel(s) < ar.lv) return { ok: false, err: "level" };
    if (s.cash < ar.cash) return { ok: false, err: "cash" };
    return { ok: true, err: null };
  }
  function unlockArea(s, id) {
    var c = canUnlock(s, id);
    if (!c.ok) return c;
    var a = areaIndex(id), ar = D.AREAS[a], g = gateOf(a);
    s.cash -= ar.cash;
    s.areas[id] = 1;
    for (var x = 0; x < ar.unlockX; x++) if (!isWater(x, g.y) && !s.occ[ti(x, g.y)]) s.tiles[ti(x, g.y)] = 1;
    s.mapVer++;
    return { ok: true, err: null };
  }

  function nextDay(s) {
    if (s.phase !== "close") return false;
    s.day++;
    s.phase = s.day > D.SEASON_DAYS ? "season" : "plan";
    s.min = D.DAY_START;
    return true;
  }

  function seasonResult(s) {
    var g = 0, rev = 0, hs = 0, wishes = s.wishesDoneTotal || 0;
    s.history.forEach(function (h) { g += h.guests; rev += h.rev; hs += h.avgHap * h.guests; });
    return { guests: g, rev: rev, avgHap: g ? Math.round(hs / g) : 0, rep: s.rep, level: popLevel(s), wishes: wishes };
  }

  function applyIntent(s, it) {
    var ok, Wish = window.PriTestEnnichiWish;
    switch (it && it.a) {
      case "build": var r = build(s, it.type, it.x, it.y, it.rot); if (r.ok && Wish) Wish.check(s); return r;
      case "demolish": ok = demolish(s, it.sid); break;
      case "path": ok = setPath(s, it.x, it.y, !!it.on); break;
      case "buy": ok = buy(s, it.item, it.n); break;
      case "machine": ok = addMachine(s, it.type); break;
      // recipe／limit／price／ticket 營業中也可調整（規格允許暫停設定），故不限 plan
      case "recipe": ok = setRecipe(s, it.mi, it.rid); break;
      case "limit": ok = setLimit(s, it.mi, it.n); break;
      case "price": ok = setPrice(s, it.sid, it.price); break;
      case "fee": ok = setFee(s, it.fee); break;
      case "repair": ok = repair(s, it.sid); break;
      case "upgrade": ok = upgrade(s, it.sid, it.slot); if (ok && Wish) Wish.check(s); break;
      case "ticket": ok = setTicket(s, it.sid, it.on); break;
      case "open": ok = openDay(s); break;
      case "next": ok = nextDay(s); break;
      case "area": return unlockArea(s, it.id);
      default: return { ok: false, err: "unknown" };
    }
    return { ok: ok, err: ok ? null : "rejected" };
  }

  function serialize(s) { return JSON.stringify(s); }
  function restore(str) {
    try { var s = JSON.parse(str); return s && s.v === 1 ? migrate(s) : null; } catch (e) { return null; }
  }
  // 舊存檔（只有境內一張地圖）：補齊世界大小的格子與區域旗標
  function migrate(s) {
    if (!s.areas) s.areas = { shrine: 1 };
    while (s.tiles.length < M.W * M.WH) s.tiles.push(0);
    while (s.occ.length < M.W * M.WH) s.occ.push(0);
    return s;
  }

  function setTicket(s, sid, on) {
    var st = s.structs[sid];
    if (!st || D.BUILD[st.type].kind !== "ride") return false;
    st.ticket = !!on;
    return true;
  }

  window.PriTestEnnichiCore = {
    rnd: rnd, rint: rint, pickW: pickW, ti: ti, inMap: inMap, isPath: isPath, entranceOf: entranceOf, dims: dims, entranceAt: entranceAt,
    areaOf: areaOf, areaIndex: areaIndex, areaOpen: areaOpen, gateOf: gateOf, isWater: isWater, wareCap: wareCap,
    canUnlock: canUnlock, unlockArea: unlockArea,
    popLevel: popLevel, machineSlots: machineSlots, weatherOf: weatherOf,
    wareTotal: wareTotal, have: have, take: take, give: give, nearRide: nearRide,
    newGame: newGame, canBuild: canBuild, build: build, demolish: demolish, setPath: setPath, setTicket: setTicket,
    buy: buy, addMachine: addMachine, setRecipe: setRecipe, setLimit: setLimit, setPrice: setPrice, setFee: setFee,
    workshopStep: workshopStep, effStats: effStats, upgrade: upgrade,
    openDay: openDay, tick: tick, closeDay: closeDay, repair: repair, nextDay: nextDay, seasonResult: seasonResult, applyIntent: applyIntent,
    serialize: serialize, restore: restore,
  };
})();
