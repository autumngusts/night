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
      wait: 0, t: 0, leaving: false, spent: 0, rides: 0, kasa: false, ticket: null
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
      var d = distField(s, k)[Core.ti(g.x, g.y)];
      if (d < 0) continue;
      var score = prefScore(g, st) * 50 - d * 1.5 - st.q.length * 3 + Core.rnd(s) * 10;
      if (score > bestScore) { bestScore = score; best = st.id; }
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

  function needsTick(s, g) {
    for (var k in D.NEED_RATE) g.need[k] = Math.min(100, g.need[k] + D.NEED_RATE[k]);
    if (g.state === "walk") g.need.fatigue = Math.min(100, g.need.fatigue + 0.05);
    g.hap = Math.max(0, Math.min(100, g.hap - s.dirt * 0.002));
  }

  window.PriTestEnnichiSim = {
    distField: distField, isWeekend: isWeekend, arrivals: arrivals, spawnSchedule: spawnSchedule, spawn: spawn,
    kindOf: kindOf, guestType: guestType, prefScore: prefScore, urgentNeed: urgentNeed, isOpen: isOpen,
    choose: choose, moveToward: moveToward, needsTick: needsTick
  };
})();
