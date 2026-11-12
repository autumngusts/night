// ============================================================================
// 緣日樂園：客人模擬（固定步長，1 次 = 1 遊戲分鐘；只用 Core.rnd 取亂數，可重播）。
//   生成、需求、尋路（步道上的距離場）、選目的地（Task 6）
//   排隊、搭乘、攤位、設施、故障、髒亂、離場、step（Task 7）；天氣（Task 8）；排隊屋台、整理券（Task 9）
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore, M = D.MAP;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var cache = { ver: -1, s: null, f: {} };

  function targetOf(s, key) {
    if (key === "gate") return M.GATE;
    var st = s.structs[key];
    return st ? Core.entranceOf(st) : null;
  }

  // 從目標格沿步道做 BFS；客人往距離較小的鄰格走就會到達
  function distField(s, key) {
    if (cache.s !== s || cache.ver !== s.mapVer) cache = { ver: s.mapVer, s: s, f: {} };
    if (cache.f[key]) return cache.f[key];
    var f = new Int16Array(M.W * M.H);
    for (var i = 0; i < f.length; i++) f[i] = -1;
    var t = targetOf(s, key);
    if (t && Core.isPath(s, t.x, t.y)) {
      var qx = [t.x], qy = [t.y], h = 0;
      f[Core.ti(t.x, t.y)] = 0;
      while (h < qx.length) {
        var x = qx[h], y = qy[h++], d = f[Core.ti(x, y)];
        for (var k = 0; k < 4; k++) {
          var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
          if (Core.isPath(s, nx, ny) && f[Core.ti(nx, ny)] < 0) { f[Core.ti(nx, ny)] = d + 1; qx.push(nx); qy.push(ny); }
        }
      }
    }
    cache.f[key] = f;
    return f;
  }

  function isWeekend(day) { var w = day % 7; return w === 6 || w === 0; }
  function arrivals(s) {
    var w = D.WEATHER[Core.weatherOf(s, s.day)];
    return Math.round((30 + s.rep * 0.6) * (isWeekend(s.day) ? 1.8 : 1) * w.arrive);
  }
  function spawnSchedule(s) {
    var n = arrivals(s), out = [];
    for (var i = 0; i < n; i++) out.push(D.DAY_START + Core.rint(s, D.LAST_ENTRY - D.DAY_START + 1));
    return out.sort(function (a, b) { return a - b; });
  }

  function spawn(s) {
    var gt = Core.pickW(s, D.GUESTS), id = s.nextGid++;
    var g = {
      id: id, type: gt.id, outfit: Core.rint(s, D.OUTFITS), photo: s.photos[id % s.photos.length],
      x: M.GATE.x, y: M.GATE.y, state: "walk", sid: null,
      need: { fun: Core.rint(s, 30), hunger: Core.rint(s, 30), thirst: Core.rint(s, 30), toilet: Core.rint(s, 30), fatigue: Core.rint(s, 30), dry: 0 },
      hap: 60, cash: gt.cash[0] + Core.rint(s, gt.cash[1] - gt.cash[0] + 1), patience: gt.patience,
      wait: 0, t: 0, leaving: false, spent: 0, rides: 0, kasa: false, ticket: null,
      skip: 0 // 下車後暫停選目的地的剩餘分鐘數
    };
    s.cash += s.fee; g.cash -= s.fee;
    if (s.today) { s.today.fees += s.fee; s.today.guests++; }
    s.guests.push(g);
    return g;
  }

  function kindOf(st) {
    var b = D.BUILD[st.type];
    if (b.kind === "stall") {
      var it = D.ITEMS[b.sells[0]];
      if (it.kind === "food" || it.kind === "drink") return it.kind;
      return it.umbrella ? "kasa" : "goods";
    }
    if (b.kind === "facility") return b.serves;
    return b.kind;
  }

  function guestType(g) { for (var i = 0; i < D.GUESTS.length; i++) if (D.GUESTS[i].id === g.type) return D.GUESTS[i]; return D.GUESTS[0]; }

  function prefScore(g, st) {
    var b = D.BUILD[st.type], p = guestType(g).pref;
    if (b.kind === "ride" || b.kind === "shrine") {
      var e = Core.effStats(st);
      return (e.thrill * p.thrill + e.charm * p.charm + e.photo * p.photo) / 3;
    }
    if (kindOf(st) === "goods") return 0.5 + p.photo;
    return 1;
  }

  function urgentNeed(g) {
    var best = "fun", v = -1;
    for (var k in g.need) if (g.need[k] > v) { v = g.need[k]; best = k; }
    return v < 30 ? "fun" : best;
  }

  function isOpen(s, st) {
    return st.build === 0 && !st.broken && !(s.today && s.today.closed.indexOf(st.type) >= 0);
  }

  function choose(s, g) {
    var need = urgentNeed(g), kinds = D.NEED_TO[need], best = null, bestScore = -1e9;
    for (var k in s.structs) {
      var st = s.structs[k];
      if (!isOpen(s, st) || kinds.indexOf(kindOf(st)) < 0) continue;
      if (g.ticket && g.ticket.sid === st.id && s.min < g.ticket.at) continue; // 持票者未到時間不可再選該設施
      var d = distField(s, k)[Core.ti(g.x, g.y)];
      if (d < 0) continue;
      var score = prefScore(g, st) * 50 - d * 1.5 - st.q.length * 3 + Core.rnd(s) * 10;
      if (score > bestScore) { bestScore = score; best = st.id; }
    }
    if (!best && need === "dry" && Core.rnd(s) < 0.3) mm(s, g, "complaint", "rain", {});
    if (need === "fun" && s.today && s.today.closed.length && Core.rnd(s) < 0.1) {
      var ct = s.today.closed[Core.rint(s, s.today.closed.length)];
      for (var j in s.structs) if (s.structs[j].type === ct) { mm(s, g, "complaint", "wind", { ride: D.BUILD[ct].name }); break; }
    }
    return best;
  }

  function moveToward(s, g, key) {
    var f = distField(s, key);
    for (var step = 0; step < D.GUEST_SPEED; step++) {
      var d = f[Core.ti(g.x, g.y)];
      if (d === 0) return true;
      if (d < 0) return false;
      for (var k = 0; k < 4; k++) {
        var nx = g.x + DIRS[k][0], ny = g.y + DIRS[k][1];
        if (Core.inMap(nx, ny) && f[Core.ti(nx, ny)] === d - 1) { g.x = nx; g.y = ny; break; }
      }
    }
    return f[Core.ti(g.x, g.y)] === 0;
  }

  function weatherNow(s) { return D.WEATHER[s.today ? s.today.weather : Core.weatherOf(s, s.day)] || D.WEATHER.sun; }

  function closedFor(s, weatherId) {
    var w = D.WEATHER[weatherId], out = [];
    if (w && w.stop) for (var t in D.BUILD) if (D.BUILD[t].wind) out.push(t);
    return out;
  }

  function needsTick(s, g) {
    var w = weatherNow(s);
    for (var k in D.NEED_RATE) {
      var r = D.NEED_RATE[k];
      if (k === "thirst") r *= w.thirst;
      if (k === "hunger") r *= w.hunger;
      g.need[k] = Math.min(100, g.need[k] + r);
    }
    if (g.state === "walk") {
      g.need.fatigue = Math.min(100, g.need.fatigue + 0.05);
      if (w.wet && !g.kasa) g.need.dry = Math.min(100, g.need.dry + 0.6);
    }
    if (g.need.dry > 50) g.hap -= 0.03;
    g.hap = Math.max(0, Math.min(100, g.hap - s.dirt * 0.002));
  }

  function chance(s, p) { return Core.rnd(s) < p; }
  function mm(s, g, type, topic, ctx) { if (window.PriTestEnnichiMurmur) window.PriTestEnnichiMurmur.say(s, g, type, topic, ctx); }
  function byId(s, gid) { for (var i = 0; i < s.guests.length; i++) if (s.guests[i].id === gid) return s.guests[i]; return null; }
  function clampHap(g) { g.hap = Math.max(0, Math.min(100, g.hap)); }
  function shrineId(s) { for (var k in s.structs) if (s.structs[k].type === "shrine") return s.structs[k].id; return null; }

  function nearTrash(s, x, y) {
    for (var k in s.structs) {
      var st = s.structs[k];
      if (st.type === "trash" && st.build === 0 && Math.abs(st.x - x) + Math.abs(st.y - y) <= 5) return true;
    }
    return false;
  }

  function decoJoy(s, g) {
    var j = 0;
    for (var k in s.structs) {
      var st = s.structs[k], b = D.BUILD[st.type];
      if (b.kind === "deco" && Math.abs(st.x - g.x) <= 2 && Math.abs(st.y - g.y) <= 2) j += b.joy;
    }
    return j;
  }

  // 賣一件商品（攤位與排隊屋台共用）；回傳賣出的商品 id 或 null
  function sellOne(s, g, list) {
    for (var i = 0; i < list.length; i++) {
      var id = list[i], it = D.ITEMS[id];
      if ((s.ware[id] || 0) < 1 || g.cash < it.sell) continue;
      s.ware[id]--; if (!s.ware[id]) delete s.ware[id];
      g.cash -= it.sell; g.spent += it.sell; s.cash += it.sell; s.today.rev += it.sell;
      s.today.sales[id] = (s.today.sales[id] || 0) + 1;
      for (var n in it.fill || {}) g.need[n] = Math.max(0, g.need[n] - it.fill[n]);
      if (it.umbrella) g.kasa = true;
      g.hap += 3 + (it.joy || 0); clampHap(g);
      return id;
    }
    return null;
  }

  function buyAt(s, g, st) {
    var b = D.BUILD[st.type], id = sellOne(s, g, b.sells);
    if (!id) {
      g.hap -= 5; clampHap(g);
      if (chance(s, 0.3)) mm(s, g, "complaint", "soldout", { food: D.ITEMS[b.sells[0]].name });
      return;
    }
    var it = D.ITEMS[id];
    if (it.umbrella && chance(s, 0.3)) mm(s, g, "impression", "kasa", {});
    if (it.kind === "goods" && g.type === "photo" && chance(s, 0.3)) { mm(s, g, "sns", "goods", { item: it.name }); s.today.sns++; }
    if (it.kind === "food" || it.kind === "drink") {
      var e = Core.entranceOf(st);
      if (!nearTrash(s, e.x, e.y)) { s.dirt += 1; if (chance(s, 0.2)) mm(s, g, "complaint", "litter", {}); }
    }
  }

  function arrive(s, g) {
    var st = s.structs[g.sid];
    if (!st || !isOpen(s, st)) { g.sid = null; return; }
    var k = kindOf(st);
    if (k === "ride") {
      var rb = D.BUILD[st.type];
      if (g.ticket && g.ticket.sid === st.id && s.min >= g.ticket.at) {
        st.q.unshift(g.id); g.ticket = null; g.state = "queue"; g.wait = 0;
        return;
      }
      if (st.ticket && !g.ticket && st.q.length >= rb.cap * D.TICKET_FACTOR) {
        g.ticket = { sid: st.id, at: s.min + Math.ceil(st.q.length / rb.cap) * rb.cycle };
        g.sid = null;
        if (chance(s, 0.2)) mm(s, g, "impression", "ticket", {});
        return;
      }
      if (g.ticket && g.ticket.sid === st.id) g.ticket = null; // 提早到：照一般排隊，票作廢
      st.q.push(g.id); g.state = "queue"; g.wait = 0;
      return;
    }
    if (k === "shrine") {
      g.need.fun = Math.max(0, g.need.fun - 20); g.hap += 3; clampHap(g);
      if (chance(s, 0.2)) mm(s, g, "impression", "shrine", {});
    } else if (k === "food" || k === "drink" || k === "goods" || k === "kasa") buyAt(s, g, st);
    else if (k === "fatigue" || k === "shelter") { g.state = "rest"; g.t = D.BUILD[st.type].time; return; }
    else if (k === "toilet") { g.state = "toilet"; g.t = D.BUILD[st.type].time; return; }
    g.sid = null;
  }

  function breakDown(s, st) {
    st.broken = true;
    var b = D.BUILD[st.type];
    st.q.concat(st.riders).forEach(function (gid) {
      var g = byId(s, gid);
      if (!g) return;
      g.state = "walk"; g.sid = null; g.hap -= 6; clampHap(g);
      if (chance(s, 0.5)) mm(s, g, "complaint", "broken", { ride: b.name });
    });
    st.q = []; st.riders = []; st.t = 0;
  }

  function rideStep(s, st) {
    var b = D.BUILD[st.type];
    if (!isOpen(s, st)) return;
    var e = Core.effStats(st);
    if (st.t > 0) {
      st.t--;
      if (st.t > 0) return;
      st.riders.forEach(function (gid) {
        var g = byId(s, gid);
        if (!g) return;
        var p = prefScore(g, st);
        g.need.fun = Math.max(0, g.need.fun - 45 - 10 * p);
        g.hap += 6 + 8 * p - 4 * Math.min(1, g.wait / g.patience); clampHap(g);
        g.rides++; g.state = "walk"; g.sid = null; g.skip = 1; // 下車這一分鐘不立刻重選（否則同一分鐘又排回同一設施）
        if (chance(s, 0.25)) mm(s, g, "impression", st.type, { ride: b.name });
        if (g.type === "photo" && e.photo >= 2 && g.hap > 75 && chance(s, 0.3)) { mm(s, g, "sns", "photo", { ride: b.name }); s.today.sns++; }
      });
      st.riders = [];
      st.wear += b.wear * e.wearMul;
      if (st.wear >= 100) { breakDown(s, st); return; }
    }
    if (!st.riders.length && st.q.length) {
      while (st.q.length && st.riders.length < b.cap) {
        var g = byId(s, st.q.shift());
        if (!g) continue;
        if (g.cash < e.price) {
          g.state = "walk"; g.sid = null; g.hap -= 4; clampHap(g);
          if (chance(s, 0.3)) mm(s, g, "complaint", "expensive", { ride: b.name });
          continue;
        }
        g.cash -= e.price; g.spent += e.price; s.cash += e.price; s.today.rev += e.price;
        st.waitSum += g.wait; st.waitN++;
        g.state = "ride"; st.riders.push(g.id);
      }
      if (st.riders.length) st.t = b.cycle;
    }
  }

  function finishGuest(s, g) {
    s.today.hapSum += g.hap; s.today.hapN++; s.today.left++;
    if (g.hap >= 80 && chance(s, 0.15)) mm(s, g, "recommend", "recommend", {});
  }

  function leaveQueue(s, g) {
    var st = s.structs[g.sid];
    if (st) st.q = st.q.filter(function (x) { return x !== g.id; });
  }

  function guestStep(s, g) {
    needsTick(s, g);
    if (!g.leaving && (s.min >= D.DAY_END || g.hap < 15 || g.need.fatigue >= 100 || g.cash < 100)) {
      g.leaving = true;
      if (g.state === "queue") { leaveQueue(s, g); g.state = "walk"; }
    }
    if (g.state === "queue") {
      g.wait++;
      if (g.wait > g.patience) {
        var st = s.structs[g.sid];
        leaveQueue(s, g);
        g.state = "walk"; g.sid = null; g.hap -= 8; clampHap(g);
        if (chance(s, 0.4)) mm(s, g, "complaint", "queue", { ride: st ? D.BUILD[st.type].name : null });
      }
      return;
    }
    if (g.state === "ride") return;
    if (g.state === "rest" || g.state === "toilet") {
      if (--g.t <= 0) {
        if (g.state === "rest") { g.need.fatigue = 0; g.need.dry = 0; } else g.need.toilet = 0;
        g.hap += 2; clampHap(g); g.state = "walk"; g.sid = null;
      }
      return;
    }
    g.hap += decoJoy(s, g); clampHap(g);
    if (g.leaving) {
      if (moveToward(s, g, "gate")) g.state = "leave";
      return;
    }
    if (g.skip > 0) { g.skip--; return; }
    if (g.ticket) {
      var tr = s.structs[g.ticket.sid];
      if (!tr || !isOpen(s, tr)) g.ticket = null; // 設施已拆除／故障／停駛：票作廢
      else if (s.min >= g.ticket.at) g.sid = g.ticket.sid;
    }
    if (!g.sid) {
      g.sid = choose(s, g);
      if (!g.sid) {
        var need = urgentNeed(g);
        if (g.need[need] >= 70) { g.hap -= 3; clampHap(g); if (chance(s, 0.3)) mm(s, g, "need", need, {}); }
        g.sid = shrineId(s); // 沒得選就去參拜
      }
    }
    if (g.sid && moveToward(s, g, g.sid)) arrive(s, g);
  }

  function qstallStep(s, st) {
    var ride = st.link && s.structs[st.link];
    if (st.build > 0 || !ride || !isOpen(s, ride)) return;
    var b = D.BUILD[st.type];
    ride.q.forEach(function (gid) {
      var g = byId(s, gid);
      if (!g || (g.need.hunger <= 40 && g.need.thirst <= 40) || !chance(s, 0.1)) return;
      var order = b.sells.slice().sort(function (a, c) {
        function v(id) { var f = D.ITEMS[id].fill || {}; return (f.thirst || 0) * g.need.thirst + (f.hunger || 0) * g.need.hunger; }
        return v(c) - v(a);
      });
      if (sellOne(s, g, order)) {
        g.patience += 5; g.hap += 2; clampHap(g);
        if (chance(s, 0.1)) mm(s, g, "impression", "qstall", {});
      }
    });
  }

  // 一遊戲分鐘：生客 → 遊樂設施運轉 → 客人行動 → 移除離場者
  function step(s) {
    while (s.today.spawn.length && s.today.spawn[0] <= s.min) { s.today.spawn.shift(); spawn(s); }
    var k;
    for (k in s.structs) if (D.BUILD[s.structs[k].type].kind === "ride") rideStep(s, s.structs[k]);
    for (k in s.structs) if (D.BUILD[s.structs[k].type].kind === "qstall") qstallStep(s, s.structs[k]);
    s.guests.forEach(function (g) { guestStep(s, g); });
    s.guests = s.guests.filter(function (g) {
      if (g.state !== "leave") return true;
      finishGuest(s, g);
      return false;
    });
  }

  window.PriTestEnnichiSim = {
    distField: distField, isWeekend: isWeekend, arrivals: arrivals, spawnSchedule: spawnSchedule, spawn: spawn,
    kindOf: kindOf, guestType: guestType, prefScore: prefScore, urgentNeed: urgentNeed, isOpen: isOpen,
    choose: choose, moveToward: moveToward, needsTick: needsTick, weatherNow: weatherNow, closedFor: closedFor,
    step: step, rideStep: rideStep, buyAt: buyAt, arrive: arrive, breakDown: breakDown, byId: byId, chance: chance, mm: mm,
    qstallStep: qstallStep, clampHap: clampHap, guestStep: guestStep, finishGuest: finishGuest
  };
})();
