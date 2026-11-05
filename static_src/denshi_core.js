// 電子守衛（denshi）：規則與模擬。純資料、不碰畫面；單機與連線房主都用同一份。
//
// 格子座標 (x, y)：x 0..W-1（左＝入口側、右＝核心側）、y 0..H-1。格子中心在 (x+0.5, y+0.5)。
// 地形 ter[i]：'.' 空地、'#' 晶片（擋路）、'S' 入口、'K' 核心、'b' 匯流排、'c' 散熱鰭片、'f' 光纖、
//              'v' 輸送帶（可走不可蓋）、'x' 壞軌（擋路不可蓋）
// 地基 fo[i]＝放置者 pid（"" 沒有）、fm[i]＝特殊格（sc／cap／fan／au／""）。地基擋路，砲塔只能蓋在地基上。
// 地面敵人沿著「到核心的距離場」（BFS）走；放方塊時必須保留每個入口到核心的路。飛行敵人直線飛。
// 以 "_" 開頭的欄位是快取，不存檔、不連線廣播。
(function () {
  "use strict";

  var D = window.PriTestDenshiData;
  var W = D.W, H = D.H, N = W * H;
  var BIG = 1e9;
  var DIRS = [[1, 0], [0, 1], [0, -1], [-1, 0]];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function idx(x, y) { return y * W + x; }
  // 這張地圖有沒有某種機制（本身的主題，或無盡模式混進來的）
  function has(s, id) { return s.theme === id || (!!s.mix && s.mix.indexOf(id) >= 0); }
  function inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

  // ---------------- 亂數（mulberry32，狀態存在 s.rs 以便存檔／接手） ----------------
  function rngNext(o) {
    o.rs = (o.rs + 0x6D2B79F5) >>> 0;
    var t = o.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(o, n) { return Math.floor(rngNext(o) * n); }
  function pickW(o, list, wf) {
    var tot = 0, i;
    for (i = 0; i < list.length; i++) tot += wf(list[i]);
    var r = rngNext(o) * tot;
    for (i = 0; i < list.length; i++) { r -= wf(list[i]); if (r < 0) return list[i]; }
    return list[list.length - 1];
  }
  function newSeed() { return (Math.floor(Math.random() * 4294967295) >>> 0) || 1; }

  // ---------------- 地形與距離場 ----------------
  function walkable(s, i) { var t = s.ter[i]; return t !== "#" && t !== "x" && !s.fo[i]; }
  function buildableTer(t) { return t === "." || t === "b" || t === "c" || t === "f" || t === "p"; }

  function distField(s) {
    if (s._d && s._dv === s.gv) return s._d;
    var d = new Array(N), q = [], h = 0, i;
    for (i = 0; i < N; i++) d[i] = BIG;
    var c = idx(s.core[0], s.core[1]);
    d[c] = 0; q.push(c);
    while (h < q.length) {
      var cur = q[h++], cx = cur % W, cy = (cur - cx) / W;
      for (var k = 0; k < 4; k++) {
        var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (!inb(nx, ny)) continue;
        var ni = idx(nx, ny);
        if (d[ni] !== BIG || !walkable(s, ni)) continue;
        d[ni] = d[cur] + 1;
        q.push(ni);
      }
    }
    s._d = d; s._dv = s.gv;
    return d;
  }
  function touched(s) { s.gv = (s.gv || 0) + 1; }
  function pathOk(s) {
    var d = distField(s), i;
    for (i = 0; i < s.spawns.length; i++) if (d[idx(s.spawns[i][0], s.spawns[i][1])] >= BIG) return false;
    for (i = 0; i < s.enemies.length; i++) {
      var e = s.enemies[i];
      if (!e.fly && !e.dead && d[idx(e.nx, e.ny)] >= BIG) return false;
    }
    return true;
  }
  // 從某格往核心走一步（距離場遞減；平手時沿用目前方向）
  function nextCell(s, x, y, pdx, pdy) {
    var d = distField(s), best = null, bd = d[idx(x, y)];
    for (var k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1], nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      var v = d[idx(nx, ny)];
      if (v < bd || (best && v === bd && dx === pdx && dy === pdy)) { bd = v; best = [nx, ny]; }
    }
    return best;
  }
  // 入口到核心的路徑（畫面顯示用）
  function pathFrom(s, sx, sy) {
    var out = [[sx, sy]], x = sx, y = sy, guard = 0, pdx = 1, pdy = 0;
    while (!(x === s.core[0] && y === s.core[1]) && guard++ < N) {
      var n = nextCell(s, x, y, pdx, pdy);
      if (!n) break;
      pdx = n[0] - x; pdy = n[1] - y; x = n[0]; y = n[1];
      out.push([x, y]);
    }
    return out;
  }

  function genMap(s, theme) {
    var ter = [], i, x, y;
    for (i = 0; i < N; i++) ter.push(".");
    s.ter = ter; s.fo = []; s.fm = [];
    for (i = 0; i < N; i++) { s.fo.push(""); s.fm.push(""); }
    s.gv = 1;
    var cy = 3 + rint(s, 6);
    s.core = [W - 1, cy];
    ter[idx(W - 1, cy)] = "K";
    var nsp = theme === "fiber" ? 3 : (rngNext(s) < 0.5 ? 1 : 2), rows;
    if (nsp === 1) rows = [2 + rint(s, 8)];
    else if (nsp === 2) rows = [1 + rint(s, 4), 7 + rint(s, 4)];
    else rows = [1 + rint(s, 2), 5 + rint(s, 2), 9 + rint(s, 2)];
    s.spawns = rows.map(function (r) { ter[idx(0, r)] = "S"; return [0, r]; });

    function near(x0, y0, r) {
      if (Math.abs(x0 - s.core[0]) + Math.abs(y0 - s.core[1]) <= r + 1) return true;
      return s.spawns.some(function (p) { return Math.abs(x0 - p[0]) + Math.abs(y0 - p[1]) <= r; });
    }
    var k;
    if (theme === "mobo") {
      var r1 = 2 + rint(s, 3), r2 = r1 + 4 + rint(s, 3);
      [r1, Math.min(H - 2, r2)].forEach(function (ry) { for (x = 2; x < W - 2; x++) if (ter[idx(x, ry)] === ".") ter[idx(x, ry)] = "b"; });
    } else if (theme === "heat") {
      var cols = [4 + rint(s, 3), 9 + rint(s, 3), 14 + rint(s, 3)];
      cols.forEach(function (cx) { var y0 = rint(s, 5), len = 5 + rint(s, 4); for (y = y0; y < Math.min(H, y0 + len); y++) if (ter[idx(cx, y)] === ".") ter[idx(cx, y)] = "c"; });
    } else if (theme === "fab") {
      var nb = 2 + rint(s, 2);
      for (k = 0; k < nb; k++) {
        var by = 1 + rint(s, H - 2), bx = 3 + rint(s, 6), bl = 5 + rint(s, 5);
        for (x = bx; x < Math.min(W - 3, bx + bl); x++) if (ter[idx(x, by)] === ".") ter[idx(x, by)] = "v";
      }
    } else if (theme === "fiber") {
      for (k = 0; k < 2; k++) {
        x = 3 + rint(s, 4); y = 1 + rint(s, H - 2);
        for (var st = 0; st < 16; st++) {
          if (inb(x, y) && ter[idx(x, y)] === ".") ter[idx(x, y)] = "f";
          if (rngNext(s) < 0.7) x++; else y += rngNext(s) < 0.5 ? -1 : 1;
          x = clamp(x, 1, W - 3); y = clamp(y, 0, H - 1);
        }
      }
    }
    // 電源排針：地基連成一片接上排針（或核心、匯流排）就通電，整片砲塔得到電路網加成
    var npin = 2 + rint(s, 2), pt = 0;
    while (npin > 0 && pt++ < 60) {
      var px = 4 + rint(s, W - 8), py = 1 + rint(s, H - 2), pi = idx(px, py);
      if (ter[pi] !== "." || near(px, py, 2)) continue;
      ter[pi] = "p"; npin--;
    }
    // 晶片／電容（障礙）
    var shapes = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0]]];
    var want = 7 + rint(s, 5), tries = 0, placed = 0;
    while (placed < want && tries++ < 200) {
      var sh = shapes[rint(s, shapes.length)], ox = 1 + rint(s, W - 3), oy = rint(s, H);
      var cells = sh.map(function (c) { return [ox + c[0], oy + c[1]]; });
      if (!cells.every(function (c) { return inb(c[0], c[1]) && ter[idx(c[0], c[1])] === "." && !near(c[0], c[1], 1); })) continue;
      cells.forEach(function (c) { ter[idx(c[0], c[1])] = "#"; });
      touched(s);
      s.enemies = [];
      if (!pathOk(s)) { cells.forEach(function (c) { ter[idx(c[0], c[1])] = "."; }); touched(s); continue; }
      placed++;
    }
    if (theme === "ram") flipBits(s, 5, 0);
    touched(s);
  }

  // 記憶體陣列：壞軌出現／修復
  function flipBits(s, add, fix) {
    var i, list = [];
    for (i = 0; i < N; i++) if (s.ter[i] === "x") list.push(i);
    for (i = 0; i < fix && list.length; i++) { var j = list.splice(rint(s, list.length), 1)[0]; s.ter[j] = "."; }
    var tries = 0, n = 0;
    while (n < add && tries++ < 80) {
      var c = rint(s, N);
      if (s.ter[c] !== "." || s.fo[c] || occupied(s, c)) continue;
      s.ter[c] = "x"; touched(s);
      if (!pathOk(s)) { s.ter[c] = "."; touched(s); continue; }
      n++;
    }
    touched(s);
  }
  function occupied(s, i) {
    var x = i % W, y = (i - x) / W;
    return s.enemies.some(function (e) {
      return !e.dead && !e.fly && ((Math.floor(e.x) === x && Math.floor(e.y) === y) || (e.nx === x && e.ny === y));
    });
  }

  // ---------------- 地基方塊 ----------------
  function rotCells(cells, r) {
    var out = cells.map(function (c) { return [c[0], c[1]]; });
    for (var k = 0; k < (r % 4 + 4) % 4; k++) out = out.map(function (c) { return [-c[1], c[0]]; });
    var mx = Math.min.apply(null, out.map(function (c) { return c[0]; })), my = Math.min.apply(null, out.map(function (c) { return c[1]; }));
    return out.map(function (c) { return [c[0] - mx, c[1] - my]; });
  }
  // 方塊轉了 r 次、以中心格對準 (ax, ay) 時實際占用的格子（每格附帶特殊格 mod）
  function pieceCells(p, r, ax, ay) {
    var rc = rotCells(p.c, r), cx = 0, cy = 0;
    rc.forEach(function (c) { cx += c[0]; cy += c[1]; });
    cx /= rc.length; cy /= rc.length;
    var pv = 0, bd = BIG;
    rc.forEach(function (c, i) { var dd = (c[0] - cx) * (c[0] - cx) + (c[1] - cy) * (c[1] - cy); if (dd < bd - 1e-9) { bd = dd; pv = i; } });
    return rc.map(function (c, i) { return { x: ax - rc[pv][0] + c[0], y: ay - rc[pv][1] + c[1], m: (p.m && p.m[i]) || "" }; });
  }
  function newPiece(s) {
    var pool = D.PIECES.filter(function (p) { return !p.lock || (s.unl && s.unl[p.lock]); });
    var def = pickW(s, pool, function (p) { return p.w; });
    var p = { k: def.id, c: def.cells.map(function (c) { return [c[0], c[1]]; }), m: {} };
    var r = rngNext(s), nm = r < 0.1 ? 2 : r < 0.5 ? 1 : 0;
    var mk = ["sc", "sc", "sc", "cap", "cap", "cap", "fan", "fan", "fan", "au"];
    if (s.unl && s.unl.gnd) mk.push("gnd", "gnd");
    if (s.unl && s.unl.qb) mk.push("qb", "qb");
    for (var k = 0; k < nm; k++) p.m[rint(s, p.c.length)] = mk[rint(s, mk.length)];
    return p;
  }
  function checkPlace(s, cells) {
    var i, c;
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (!inb(c.x, c.y)) return "out";
      var ci = idx(c.x, c.y);
      if (!buildableTer(s.ter[ci]) || s.fo[ci]) return "blocked";
      if (occupied(s, ci)) return "enemy";
    }
    // 暫時放上去檢查路徑，檢查完還原（連同距離場快取，畫面每影格預覽也不會一直重算路徑）
    var gv0 = s.gv, d0 = s._d, dv0 = s._dv;
    cells.forEach(function (c) { s.fo[idx(c.x, c.y)] = "?"; });
    touched(s);
    var ok = pathOk(s);
    cells.forEach(function (c) { s.fo[idx(c.x, c.y)] = ""; });
    s.gv = gv0; s._d = d0; s._dv = dv0;
    return ok ? "" : "path";
  }

  // ---------------- 新遊戲 ----------------
  // opts：{ seed, mode: "random"|"campaign", map（地圖索引；random 模式 -1＝隨機主題）, waves（20／30／0＝無盡）, diff, players: [{pid, name}] }
  function newGame(opts) {
    var s = {
      v: 1, seed: (opts.seed >>> 0) || 1, mode: opts.mode || "random", waves: opts.waves === 0 ? 0 : (opts.waves || 30),
      diff: D.DIFFS[opts.diff] ? opts.diff : "normal", phase: "build", wave: 0, time: 0, wt: 0, wq: [],
      towers: [], enemies: [], proj: [], fx: [], fxId: 0, tid: 0, eid: 0,
      hp: 20, mhp: 20, players: {}, order: [], auto: false, autoT: 0, speed: 1, end: null,
      kills: 0, leaks: 0, m: { volt: 1, surgeU: 0, surgeT: 0, res: { kin: 0, en: 0 }, wd: { kin: 0, en: 0 }, boltT: 0 },
      unl: opts.unl || {}, mix: [], daily: opts.daily || "", rec: { boss: {}, evo: {}, combo: {}, skills: 0, net: 0 }
    };
    s.rs = s.seed;
    var mi = opts.map;
    if (!(mi >= 0 && mi < D.MAPS.length)) mi = rint(s, D.MAPS.length);
    s.map = mi;
    s.theme = D.MAPS[mi].id;
    genMap(s, s.theme);
    (opts.players || [{ pid: "me", name: "" }]).forEach(function (p) { addPlayer(s, p.pid, p.name, p.role); });
    return s;
  }
  function addPlayer(s, pid, name, role) {
    if (s.players[pid]) { if (name) s.players[pid].name = String(name).slice(0, 16); return; }
    var ci = s.order.length % D.PLAYER_COLORS.length;
    var cash = Math.round((s.wave ? 160 + 35 * s.wave : 260) * D.DIFFS[s.diff].cash) + (s.unl && s.unl.cash ? 60 : 0);
    s.players[pid] = {
      name: String(name || "").slice(0, 16), ci: ci, cash: cash, pieces: [], bought: 0, ready: false, dmg: 0, kills: 0,
      role: D.ROLES[role] ? role : "general", cd: { emp: 0, oc: 0, fix: 0 }, ocU: 0, skillN: 0
    };
    s.order.push(pid);
    s.players[pid].pieces.push(newPiece(s));
    if (!s.wave) s.players[pid].pieces.push(newPiece(s));
  }

  // ---------------- 波次 ----------------
  function hpMul(s, w) {
    var m = 1 + 0.12 * (w - 1) + 0.006 * (w - 1) * (w - 1);
    if (w > 30) m *= Math.pow(1.05, w - 30);
    return m * D.DIFFS[s.diff].hp * (1 + 0.6 * (s.order.length - 1));
  }
  function bossOf(w) {
    if (D.BOSS_BY_WAVE[w]) return D.BOSS_BY_WAVE[w];
    if (w > 30 && w % 10 === 0) return ["kernel", "daemon", "singularity"][(w / 10) % 3];
    return null;
  }
  // 同一個種子＋波數一定產生同一波（可以先預告下一波）
  function genWave(s, w) {
    var o = { rs: (s.seed ^ Math.imul(w, 0x9E3779B1)) >>> 0 };
    var list = [], boss = bossOf(w), hm = hpMul(s, w), t = 0.5;
    var budget = Math.round(6 + 3.2 * w + 0.12 * w * w);
    if (boss) {
      var bm = D.DIFFS[s.diff].hp * (1 + 0.6 * (s.order.length - 1)) * (w > 30 ? hpMul(s, w) / hpMul(s, 30) : 1);
      list.push({ t: 6, ty: boss, sp: rint(o, s.spawns.length), hm: bm });
      budget = Math.round(budget * 0.5);
    }
    var types = Object.keys(D.ENEMIES).filter(function (k) { var e = D.ENEMIES[k]; return !e.boss && e.from <= w; });
    var groups = w === 1 ? 1 : 1 + (w >= 4 ? 1 : 0) + (w >= 12 ? 1 : 0) + (w >= 22 ? 1 : 0);
    var act = activeSpawns(s, w);
    for (var g = 0; g < groups; g++) {
      var ty = w === 1 ? "bit" : types[rint(o, types.length)], def = D.ENEMIES[ty];
      // 飛行單位不會單獨成一波（第 8 波以前）、也只占一部分預算，免得只蓋地面砲塔就整波漏光
      if (def.fly && (groups === 1 || w < 8) && g === 0) { ty = types[rint(o, types.length - 1)]; if (D.ENEMIES[ty].fly) ty = "bit"; def = D.ENEMIES[ty]; }
      var cnt = Math.max(1, Math.floor(budget / groups / def.cost * (def.fly ? 0.6 : 1)));
      var gap = clamp(0.62 / def.spd, 0.3, 1.1), sp = act[rint(o, act.length)];
      for (var k = 0; k < cnt; k++) list.push({ t: t + k * gap, ty: ty, sp: sp, hm: hm });
      t += cnt * gap + 1.6;
    }
    list.sort(function (a, b) { return a.t - b.t; });
    return list;
  }
  function activeSpawns(s, w) {
    if (s.theme !== "fiber") return s.spawns.map(function (_, i) { return i; });
    var a = [(w - 1) % 3];
    if (w >= 10) a.push(w % 3);
    return a;
  }
  // 這一波會用到哪些入口（畫面上預告）
  function waveSpawns(s, w) {
    var used = {};
    genWave(s, w).forEach(function (q) { if (!D.ENEMIES[q.ty].fly || D.ENEMIES[q.ty].boss) used[q.sp] = 1; else used[q.sp] = used[q.sp] || 2; });
    return used;
  }
  function wavePreview(s, w) {
    var cnt = {};
    genWave(s, w).forEach(function (q) { cnt[q.ty] = (cnt[q.ty] || 0) + 1; });
    return cnt;
  }

  function spawnEnemy(s, ty, sp, hm, at) {
    var def = D.ENEMIES[ty], w = Math.max(1, s.wave);
    var e = {
      id: ++s.eid, ty: ty, hp: def.hp * hm, mhp: def.hp * hm, sh: (def.shield || 0) * hm, msh: (def.shield || 0) * hm,
      spd: def.spd, ar: (def.armor || 0) + (def.armor ? Math.floor(w / 10) : 0), fly: !!def.fly, boss: !!def.boss,
      rew: Math.round(def.bounty * (1 + 0.025 * (w - 1)) * D.DIFFS[s.diff].cash), lk: def.leak || 1,
      slowA: 0, slowU: 0, stunU: 0, revU: 0, empU: 0, ab: 0, hm: hm, pdx: 1, pdy: 0
    };
    if (at) { e.x = at.x; e.y = at.y; e.nx = at.nx; e.ny = at.ny; }
    else { var p = s.spawns[sp] || s.spawns[0]; e.x = p[0] + 0.5; e.y = p[1] + 0.5; e.nx = p[0]; e.ny = p[1]; }
    s.enemies.push(e);
    return e;
  }

  function startWave(s) {
    if (s.phase !== "build" || s.end) return;
    s.wave++;
    s.phase = "wave";
    s.wq = genWave(s, s.wave);
    s.wt = 0;
    s.autoT = 0;
    s.order.forEach(function (pid) { s.players[pid].ready = false; });
    if (has(s, "psu")) { var vs = [0.8, 0.9, 1, 1, 1.1, 1.25]; s.m.volt = vs[rint(s, vs.length)]; s.m.surgeT = 0; }
    if (has(s, "ram") && s.wave > 1) flipBits(s, 3, 2);
    fx(s, { k: "wave", w: s.wave });
  }
  function endWave(s) {
    var w = s.wave, cm = D.DIFFS[s.diff].cash;
    s.order.forEach(function (pid) { s.players[pid].cash += Math.round((20 + 2 * w) * cm); });
    s.towers.forEach(function (tw) {
      if (!D.TOWERS[tw.ty].lv[tw.lv].income || !s.players[tw.o]) return;
      s.players[tw.o].cash += Math.round(stats(s, tw).income);
    });
    if (has(s, "aicore")) {
      var wd = s.m.wd, hi = wd.kin >= wd.en ? "kin" : "en", lo = hi === "kin" ? "en" : "kin";
      if (wd.kin + wd.en > 0) { s.m.res[hi] = Math.min(0.6, s.m.res[hi] + 0.15); s.m.res[lo] = Math.max(0, s.m.res[lo] - 0.1); }
      s.m.wd = { kin: 0, en: 0 };
    }
    s.proj = [];
    if (s.waves && w >= s.waves) { finish(s, true); return; }
    s.phase = "build";
    s.order.forEach(function (pid) {
      var p = s.players[pid], n = p.role === "engineer" && w % 3 === 0 ? 2 : 1;
      for (var k = 0; k < n; k++) { if (p.pieces.length < 3) p.pieces.push(newPiece(s)); else p.cash += 25; }
    });
    // 無盡模式：每 10 波混入一種別張地圖的機制
    if (!s.waves && w % 10 === 0) {
      var pool = D.MIXABLE.filter(function (id) { return id !== s.theme && s.mix.indexOf(id) < 0; });
      if (pool.length) { var mx = pool[rint(s, pool.length)]; s.mix.push(mx); fx(s, { k: "mix", id: mx }); }
    }
    if (s.auto) s.autoT = 6;
    fx(s, { k: "clear", w: w });
  }
  function finish(s, win) {
    var tk = s.kills;
    s.end = { win: !!win, wave: s.wave, score: Math.round(s.wave * 120 + (win ? s.hp * 50 : 0) + tk * 3) };
    s.phase = "over";
  }

  // ---------------- 砲塔數值 ----------------
  // 砲塔格子索引（組合技／支援砲塔每次查鄰格，不能每次線性掃描）；砲塔增減時 s.tv 會變
  function towerAt(s, x, y) {
    if (!inb(x, y)) return null;
    if (!s._tg || s._tgv !== s.tv || s._tgn !== s.towers.length) {
      var g = new Array(N);
      for (var i = 0; i < s.towers.length; i++) g[idx(s.towers[i].x, s.towers[i].y)] = s.towers[i];
      s._tg = g; s._tgv = s.tv; s._tgn = s.towers.length;
    }
    return s._tg[idx(x, y)] || null;
  }
  function towerById(s, id) {
    for (var i = 0; i < s.towers.length; i++) if (s.towers[i].id === id) return s.towers[i];
    return null;
  }
  function stats(s, tw) {
    var def = D.TOWERS[tw.ty], b = def.lv[tw.lv], st = {}, k;
    for (k in b) if (b.hasOwnProperty(k)) st[k] = b[k];
    var dm = 1, rm = 1, ra = 0, see = false;
    var ci = idx(tw.x, tw.y), mod = s.fm[ci], ter = s.ter[ci];
    if (mod === "sc") dm += 0.25;
    if (mod === "cap") ra += 0.6;
    if (mod === "fan") rm += 0.25;
    if (ter === "b" && has(s, "mobo")) rm += 0.25;
    if (ter === "f" && has(s, "fiber")) ra += 0.8;
    var buff = 0, rbuff = 0, rateB = 0;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var o = towerAt(s, tw.x + dx, tw.y + dy);
      if (!o || D.TOWERS[o.ty].kind !== "support") continue;
      var ob = D.TOWERS[o.ty].lv[o.lv], op = s.players[o.o], pm = op && op.role === "power" ? 1.5 : 1;
      buff += (ob.buff || 0) * pm; rbuff += (ob.rbuff || 0) * pm; rateB += (ob.rateBuff || 0) * pm;
      if (ob.see) see = true;
    }
    dm += Math.min(0.9, buff); ra += Math.min(2.4, rbuff); rm += Math.min(0.3, rateB);
    var nb = netBonus(s, tw);
    if (nb > 0) { dm += nb; rm += 0.05; }
    st.net = nb;
    var owner = s.players[tw.o];
    if (owner && owner.role === "gunner") dm += 0.15;
    if (owner && owner.ocU > s.time) rm += 0.5;
    st.combos = [];
    combosOf(s, tw).forEach(function (x) {
      var e = x.side === "a" ? x.c.ea : x.c.eb;
      st.combos.push(x.c.id);
      if (s.rec) s.rec.combo[x.c.id] = 1;
      if (e.dm) dm += e.dm;
      if (e.rm) rm += e.rm;
      if (e.ra) ra += e.ra;
      if (e.chain && st.chain) st.chain += e.chain;
      if (e.pierce && st.pierce) st.pierce += e.pierce;
      if (e.stun && st.stun) st.stun += e.stun;
      if (e.splash && st.splash) st.splash += e.splash;
      if (e.refract) st.refract = e.refract;
      if (e.rampM && st.ramp) st.ramp *= e.rampM;
      if (e.income && st.income) st.income *= 1 + e.income;
    });
    if (st.income && owner && owner.role === "power") st.income *= 2;
    if (has(s, "psu")) dm *= s.m.volt * (s.m.surgeU > s.time ? 1.5 : 1);
    if (tw.chg > s.time) dm *= 2;
    st.dmg = (st.dmg || 0) * dm;
    st.rate = (st.rate || 1) * rm;
    st.range = (st.range || 0) + (st.range ? ra : 0);
    st.see = see || !!st.reveal;
    st.dm = dm; st.rm = rm; st.ra = ra;
    return st;
  }
  // 模擬用：同一座砲塔的數值每 0.25 秒（或砲塔／地基變動時）才重算一次
  function stepStats(s, tw) {
    var key = (s.tv || 0) + "|" + s.gv + "|" + Math.floor(s.time * 4) + "|" + tw.ty + tw.lv;
    if (tw._sk !== key) { tw._st = stats(s, tw); tw._sk = key; }
    return tw._st;
  }
  function spentOn(tw) {
    var def = D.TOWERS[tw.ty];
    return tw.spent || def.cost;
  }
  function refundOf(s, tw) { return Math.round(spentOn(tw) * (s.fm[idx(tw.x, tw.y)] === "au" ? 1 : 0.7)); }
  function upgradeCost(tw, p) { var lv = D.TOWERS[tw.ty].lv[tw.lv + 1]; return lv ? Math.round(lv.c * (p && p.role === "gunner" ? 0.9 : 1)) : 0; }
  function evoCost(to, p) { return Math.round(D.TOWERS[to].cost * (p && p.role === "gunner" ? 0.9 : 1)); }
  function rerollCost(p) { return p && p.role === "engineer" ? 5 : 15; }
  function skillCd(s, p, k) { return D.SKILLS[k].cd * (p.role === "general" ? 0.75 : 1) * (s.unl && s.unl.skill ? 0.85 : 1); }
  function grounded(s, tw) { return s.fm[idx(tw.x, tw.y)] === "gnd"; }
  function offline(s, tw) { return !grounded(s, tw) && (tw.dis > s.time || jammed(s, tw)); }

  // ---------------- 電路網（同一個玩家相連的地基；接上排針／匯流排／核心就通電） ----------------
  function nets(s) {
    if (s._n && s._nv === s.gv) return s._n;
    var comp = new Array(N), info = [], i, k;
    for (i = 0; i < N; i++) comp[i] = -1;
    var cIdx = idx(s.core[0], s.core[1]);
    for (i = 0; i < N; i++) {
      if (!s.fo[i] || comp[i] >= 0) continue;
      var id = info.length, q = [i], h = 0, own = s.fo[i], pw = false;
      comp[i] = id;
      while (h < q.length) {
        var c = q[h++], cx = c % W, cy = (c - cx) / W;
        if (s.ter[c] === "p" || s.ter[c] === "b") pw = true;
        for (k = 0; k < 4; k++) {
          var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
          if (!inb(nx, ny)) continue;
          var ni = idx(nx, ny);
          if (ni === cIdx || s.ter[ni] === "p") pw = true;
          if (s.fo[ni] === own && comp[ni] < 0) { comp[ni] = id; q.push(ni); }
        }
      }
      info.push({ size: q.length, pw: pw, o: own });
      if (pw && s.rec && q.length > s.rec.net) s.rec.net = q.length;
    }
    s._n = { comp: comp, info: info }; s._nv = s.gv;
    return s._n;
  }
  function netBonus(s, tw) {
    var n = nets(s), c = n.comp[idx(tw.x, tw.y)];
    if (c < 0 || !n.info[c].pw) return 0;
    var p = s.players[tw.o];
    return Math.min(0.3, 0.015 * n.info[c].size) * (p && p.role === "power" ? 1.5 : 1);
  }
  // 這座砲塔觸發中的組合技（回傳 [{ c: 組合, side: "a"|"b" }]）
  function combosOf(s, tw) {
    var out = [];
    D.COMBOS.forEach(function (cb) {
      var inA = cb.a.indexOf(tw.ty) >= 0, inB = cb.b.indexOf(tw.ty) >= 0;
      if (!inA && !inB) return;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var o = towerAt(s, tw.x + dx, tw.y + dy);
        if (!o) continue;
        if (inA && cb.b.indexOf(o.ty) >= 0) { out.push({ c: cb, side: "a", with: o.id }); return; }
        if (inB && cb.a.indexOf(o.ty) >= 0) { out.push({ c: cb, side: "b", with: o.id }); return; }
      }
    });
    return out;
  }

  // ---------------- 傷害 ----------------
  function fx(s, o) {
    o.id = ++s.fxId; o.t = s.time;
    s.fx.push(o);
  }
  function hurt(s, e, amt, dtype, tw, shieldMul) {
    if (e.dead || amt <= 0) return;
    if (has(s, "aicore")) amt *= 1 - (s.m.res[dtype] || 0);
    if (has(s, "quantum") && tw && rngNext(s) < 0.15) amt *= 2;
    if (tw && s.fm[idx(tw.x, tw.y)] === "qb" && rngNext(s) < 0.15) amt *= 3;
    var dealt = 0;
    if (e.sh > 0) {
      var mul = shieldMul || (dtype === "en" ? 1.5 : 1), ab = Math.min(e.sh, amt * mul);
      e.sh -= ab; amt -= ab / mul; dealt += ab / mul;
    }
    if (amt > 0 && dtype === "kin" && e.ar) amt = Math.max(amt * 0.3, amt - e.ar);
    e.hp -= amt; dealt += amt;
    s.m.wd[dtype] = (s.m.wd[dtype] || 0) + dealt;
    if (tw) { tw.dmg = (tw.dmg || 0) + dealt; var p = s.players[tw.o]; if (p) p.dmg += dealt; }
    if (e.hp <= 0) kill(s, e, tw);
  }
  function kill(s, e, tw) {
    e.dead = true;
    s.kills++;
    var n = s.order.length || 1, share = Math.ceil(e.rew / n);
    s.order.forEach(function (pid) { s.players[pid].cash += share; });
    if (tw) {
      tw.kills = (tw.kills || 0) + 1;
      var p = s.players[tw.o];
      if (p) p.kills++;
      if (s.fm[idx(tw.x, tw.y)] === "au" && p) p.cash += 2;
    }
    fx(s, { k: "die", x: e.x, y: e.y, ty: e.ty, b: e.boss ? 1 : 0, f: e.fly ? 1 : 0 });
    var def = D.ENEMIES[e.ty];
    if (def.boss && s.rec) s.rec.boss[e.ty] = 1;
    if (def.splitInto) {
      for (var q = 0; q < 3; q++) spawnEnemy(s, def.splitInto, 0, e.hm, { x: e.x + Math.cos(q * 2.1) * 0.4, y: e.y + Math.sin(q * 2.1) * 0.4, nx: e.nx, ny: e.ny });
      fx(s, { k: "split", x: e.x, y: e.y });
    }
    if (def.split) for (var k = 0; k < def.split; k++) {
      var c = spawnEnemy(s, "bit", 0, e.hm * 0.8, { x: e.x + (k ? 0.15 : -0.15), y: e.y, nx: e.nx, ny: e.ny });
      c.rew = Math.max(1, Math.round(c.rew / 2));
    }
  }
  function slow(e, a, t, now) {
    if (e.boss) a *= 0.5;
    if (a >= e.slowA || e.slowU < now) e.slowA = a;
    e.slowU = Math.max(e.slowU, now + t);
  }

  // ---------------- 模擬 ----------------
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function remain(s, e) {
    if (e.fly) return Math.sqrt(dist2(e.x, e.y, s.core[0] + 0.5, s.core[1] + 0.5));
    var d = distField(s)[idx(e.nx, e.ny)];
    return (d >= BIG ? 99 : d) + Math.sqrt(dist2(e.x, e.y, e.nx + 0.5, e.ny + 0.5));
  }
  function visibleTo(s, e, tx, ty, range, see) {
    if (!D.ENEMIES[e.ty].stealth || see || e.revU > s.time) return true;
    return dist2(e.x, e.y, tx, ty) <= range * range * 0.25;
  }
  function inRange(s, tw, st, airOk) {
    var cx = tw.x + 0.5, cy = tw.y + 0.5, r2 = st.range * st.range, out = [];
    for (var i = 0; i < s.enemies.length; i++) {
      var e = s.enemies[i];
      if (e.dead || (e.fly && !airOk)) continue;
      if (dist2(e.x, e.y, cx, cy) > r2) continue;
      if (!visibleTo(s, e, cx, cy, st.range, st.see)) continue;
      out.push(e);
    }
    return out;
  }
  function pickTarget(s, tw, list) {
    var mode = tw.mode || "first", best = null, bv = 0;
    list.forEach(function (e) {
      var v;
      if (mode === "strong") v = -(e.hp + e.sh);
      else if (mode === "last") v = -remain(s, e);
      else if (mode === "near") v = dist2(e.x, e.y, tw.x + 0.5, tw.y + 0.5);
      else v = remain(s, e);
      if (!best || v < bv) { best = e; bv = v; }
    });
    return best;
  }

  function jammed(s, tw) {
    if (!has(s, "antenna") || s.phase !== "wave") return false;
    return Math.abs(tw.x + 0.5 - jamX(s)) < 1.5;
  }
  function jamX(s) { var p = 15; return ((s.wt % p) / p) * (W + 6) - 3; }

  function towerStep(s, tw, dt) {
    var def = D.TOWERS[tw.ty];
    if (def.kind === "support" || def.kind === "eco") return;
    if (has(s, "heat")) {
      var cool = s.ter[idx(tw.x, tw.y)] === "c" ? 3 : 1;
      tw.heat = Math.max(0, (tw.heat || 0) - 0.12 * cool * dt);
      if (tw.oh && tw.heat <= 0.3) tw.oh = 0;
    }
    tw.bt = 0; tw.bt2 = 0;
    if (tw.oh || offline(s, tw)) { tw.held = 0; return; }
    var ocOn = s.players[tw.o] && s.players[tw.o].ocU > s.time;
    var st = stepStats(s, tw), cx = tw.x + 0.5, cy = tw.y + 0.5;
    var air = def.air;
    if (def.kind === "aura") {
      inRange(s, tw, st, true).forEach(function (e) {
        slow(e, st.slow, 0.25, s.time);
        e.revU = s.time + 0.3;
        if (e.sh > 0) e.sh = Math.max(0, e.sh - st.drain * dt);
      });
      tw.ang = (tw.ang || 0) + dt;
      return;
    }
    if (def.kind === "beam") {
      var cand = inRange(s, tw, st, air), cur = null;
      if (tw.tg) for (var i = 0; i < cand.length; i++) if (cand[i].id === tw.tg) cur = cand[i];
      if (!cur) { cur = pickTarget(s, tw, cand); tw.held = 0; }
      if (!cur) { tw.tg = 0; return; }
      tw.tg = cur.id; tw.bt = cur.id;
      tw.held = (tw.held || 0) + dt;
      tw.ang = Math.atan2(cur.y - cy, cur.x - cx);
      var bd = st.dmg * dt * (1 + Math.min(st.rampMax, st.ramp * tw.held));
      hurt(s, cur, bd, def.dtype, tw);
      if (st.refract) {
        // 光束折射：打到離目標最近的另一個敵人
        var r2 = null, rd = 2.6 * 2.6;
        for (var ri = 0; ri < s.enemies.length; ri++) { var ro = s.enemies[ri]; if (ro === cur || ro.dead) continue; var d2r = dist2(ro.x, ro.y, cur.x, cur.y); if (d2r < rd) { rd = d2r; r2 = ro; } }
        if (r2) { tw.bt2 = r2.id; hurt(s, r2, bd * st.refract, def.dtype, tw); }
      }
      if (has(s, "heat") && !ocOn) heatUp(tw, dt * 0.16);
      return;
    }
    tw.cd = (tw.cd || 0) - dt;
    if (tw.cd > 0) return;
    var list = inRange(s, tw, st, air);
    if (!list.length) { tw.cd = 0; return; }
    var tg = pickTarget(s, tw, list);
    tw.ang = Math.atan2(tg.y - cy, tg.x - cx);
    tw.cd = 1 / st.rate;
    if (has(s, "heat") && !ocOn) heatUp(tw, def.kind === "bullet" && st.rate > 2 ? 0.045 : 0.09);
    if (def.kind === "bullet") {
      var dmg = st.dmg;
      if (st.ramp) {
        if (tw.tg === tg.id) tw.held = Math.min(st.rampMax, (tw.held || 0) + st.ramp); else tw.held = 0;
        tw.tg = tg.id;
        dmg *= 1 + tw.held;
      }
      var sp = def.fast ? 22 : 11, d = Math.sqrt(dist2(cx, cy, tg.x, tg.y));
      s.proj.push({ k: "b", x: cx, y: cy, tg: tg.id, sp: sp, dmg: dmg, dt: def.dtype, tw: tw.id });
      fx(s, { k: "shot", tw: tw.id, x: cx, y: cy, e: tg.id, d: d / sp, ty: tw.ty });
    } else if (def.kind === "shell" || def.kind === "spray") {
      var tx = tg.x, ty = tg.y, dd = Math.sqrt(dist2(cx, cy, tx, ty)), ssp = def.kind === "spray" ? 9 : 6;
      s.proj.push({ k: "s", x: cx, y: cy, tx: tx, ty: ty, sp: ssp, dmg: st.dmg, dt: def.dtype, tw: tw.id, r: st.splash, sl: st.slow || 0, slT: st.slowT || 0, stun: st.stun || 0, shm: st.shieldMul || 0, air: air });
      fx(s, { k: def.kind === "spray" ? "spray" : "shell", tw: tw.id, x: cx, y: cy, tx: tx, ty: ty, d: dd / ssp, r: st.splash, ty2: tw.ty });
    } else if (def.kind === "rail") {
      var ang = tw.ang, ex = cx + Math.cos(ang) * st.range, ey = cy + Math.sin(ang) * st.range;
      var hits = [];
      s.enemies.forEach(function (e) {
        if (e.dead || (e.fly && !air)) return;
        var px = e.x - cx, py = e.y - cy, along = px * Math.cos(ang) + py * Math.sin(ang);
        if (along < 0 || along > st.range) return;
        var perp = Math.abs(-px * Math.sin(ang) + py * Math.cos(ang));
        if (perp < 0.45 && visibleTo(s, e, cx, cy, st.range, st.see)) hits.push({ e: e, a: along });
      });
      hits.sort(function (a, b) { return a.a - b.a; });
      hits.slice(0, st.pierce).forEach(function (h) { hurt(s, h.e, st.dmg, def.dtype, tw); });
      fx(s, { k: "rail", tw: tw.id, x: cx, y: cy, tx: ex, ty: ey, ty2: tw.ty });
    } else if (def.kind === "chain") {
      var pts = [[cx, cy]], hit = {}, cur2 = tg, dm2 = st.dmg;
      for (var j = 0; j < st.chain && cur2; j++) {
        hit[cur2.id] = 1;
        pts.push([cur2.x, cur2.y]);
        hurt(s, cur2, dm2, def.dtype, tw);
        dm2 *= 0.85;
        var nb = null, nd = 1.7 * 1.7;
        for (var q = 0; q < s.enemies.length; q++) {
          var o = s.enemies[q];
          if (o.dead || hit[o.id]) continue;
          var d2 = dist2(o.x, o.y, cur2.x, cur2.y);
          if (d2 < nd) { nd = d2; nb = o; }
        }
        cur2 = nb;
      }
      fx(s, { k: "chain", tw: tw.id, p: pts.map(function (p) { return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]; }) });
    } else if (def.kind === "pulse") {
      inRange(s, tw, st, true).forEach(function (e) { e.revU = s.time + 1.5; hurt(s, e, st.dmg, def.dtype, tw); });
      fx(s, { k: "pulse", tw: tw.id, x: cx, y: cy, r: st.range });
    } else if (def.kind === "freeze") {
      list.sort(function (a, b) { return remain(s, a) - remain(s, b); });
      var ids = [];
      list.slice(0, st.freezeN).forEach(function (e) {
        e.stunU = Math.max(e.stunU, s.time + st.freezeT * (e.boss ? 0.4 : 1));
        ids.push(e.id);
        hurt(s, e, st.dmg, def.dtype, tw);
      });
      fx(s, { k: "freeze", tw: tw.id, x: cx, y: cy, e: ids });
    }
  }
  function heatUp(tw, a) { tw.heat = (tw.heat || 0) + a; if (tw.heat >= 1) { tw.heat = 1; tw.oh = 1; } }

  function projStep(s, dt) {
    var keep = [];
    s.proj.forEach(function (p) {
      var tw = towerById(s, p.tw);
      if (p.k === "b") {
        var e = null;
        for (var i = 0; i < s.enemies.length; i++) if (s.enemies[i].id === p.tg) { e = s.enemies[i]; break; }
        if (!e || e.dead) return;
        var dx = e.x - p.x, dy = e.y - p.y, d = Math.sqrt(dx * dx + dy * dy), mv = p.sp * dt;
        if (d <= mv + 0.1) { hurt(s, e, p.dmg, p.dt, tw); return; }
        p.x += dx / d * mv; p.y += dy / d * mv;
        keep.push(p);
      } else {
        var ex = p.tx - p.x, ey = p.ty - p.y, dd = Math.sqrt(ex * ex + ey * ey), m2 = p.sp * dt;
        if (dd > m2) { p.x += ex / dd * m2; p.y += ey / dd * m2; keep.push(p); return; }
        var r2 = p.r * p.r;
        s.enemies.forEach(function (o) {
          if (o.dead || (o.fly && !p.air)) return;
          if (dist2(o.x, o.y, p.tx, p.ty) > r2) return;
          if (p.sl) slow(o, p.sl, p.slT, s.time);
          if (p.stun) o.stunU = Math.max(o.stunU, s.time + p.stun * (o.boss ? 0.3 : 1));
          if (p.shm) o.empU = s.time + 3;
          hurt(s, o, p.dmg, p.dt, tw, p.shm);
        });
        fx(s, { k: "boom", x: p.tx, y: p.ty, r: p.r, ty: tw ? tw.ty : "" });
      }
    });
    s.proj = keep;
  }

  function enemyStep(s, e, dt) {
    var def = D.ENEMIES[e.ty];
    if (e.stunU > s.time) return;
    // 特殊能力
    e.ab += dt;
    if (def.heal && e.empU <= s.time && e.ab >= 1) {
      e.ab = 0;
      s.enemies.forEach(function (o) { if (o !== e && !o.dead && dist2(o.x, o.y, e.x, e.y) < 2.25) o.hp = Math.min(o.mhp, o.hp + o.mhp * def.heal); });
      fx(s, { k: "heal", x: e.x, y: e.y });
    }
    if (def.summon && e.ab >= def.summon) {
      e.ab = 0;
      for (var k = 0; k < 2; k++) { var c = spawnEnemy(s, "drone", 0, e.hm * 0.35, { x: e.x, y: e.y + (k ? 0.3 : -0.3), nx: e.nx, ny: e.ny }); c.rew = 2; }
      fx(s, { k: "summon", x: e.x, y: e.y });
    }
    if (def.phases) {
      e.ph = e.ph || 1;
      if (e.ph === 1 && e.hp < e.mhp * 0.66) {
        e.ph = 2; e.sh = Math.max(e.sh, e.msh * 0.6);
        for (var t2 = 0; t2 < 4; t2++) spawnEnemy(s, "trojan", 0, e.hm * 0.5, { x: e.x, y: e.y, nx: e.nx, ny: e.ny });
        fx(s, { k: "phase", n: 2, x: e.x, y: e.y });
      } else if (e.ph === 2 && e.hp < e.mhp * 0.33) {
        e.ph = 3; e.spd *= 1.5;
        fx(s, { k: "phase", n: 3, x: e.x, y: e.y });
      }
    }
    var empEvery = def.emp ? (e.ph === 3 ? 4 : e.ph === 2 ? 6 : def.emp) : 0;
    if (empEvery && e.ab >= empEvery) {
      e.ab = 0;
      s.towers.forEach(function (tw) { if (!grounded(s, tw) && dist2(tw.x + 0.5, tw.y + 0.5, e.x, e.y) < 6.25) tw.dis = s.time + 2; });
      fx(s, { k: "emp", x: e.x, y: e.y, r: 2.5 });
    }
    // 吞噬地基（核心恐慌；奇異點第三階段）
    var eatEvery = def.eat || (e.ph === 3 ? 4 : 0);
    if (eatEvery && !e.fly) {
      e.eatT = (e.eatT || 0) + dt;
      if (e.eatT >= eatEvery) { e.eatT = 0; eatAround(s, e); }
    }
    var sp = e.spd * (e.slowU > s.time ? 1 - e.slowA : 1);
    if (e.fly) {
      var cx = s.core[0] + 0.5, cy = s.core[1] + 0.5, dx = cx - e.x, dy = cy - e.y, d = Math.sqrt(dx * dx + dy * dy), mv = sp * dt;
      if (d <= mv) { leak(s, e); return; }
      e.x += dx / d * mv; e.y += dy / d * mv;
      return;
    }
    var ci = idx(Math.floor(e.x), Math.floor(e.y));
    if (s.ter[ci] === "v") sp *= 1.7;
    var move = sp * dt, guard = 0;
    while (move > 0 && guard++ < 6) {
      var tx = e.nx + 0.5, ty = e.ny + 0.5, ddx = tx - e.x, ddy = ty - e.y, dd = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dd > move) { e.x += ddx / dd * move; e.y += ddy / dd * move; break; }
      e.x = tx; e.y = ty; move -= dd;
      if (e.nx === s.core[0] && e.ny === s.core[1]) { leak(s, e); return; }
      var n = nextCell(s, e.nx, e.ny, e.pdx, e.pdy);
      if (!n) break;
      e.pdx = n[0] - e.nx; e.pdy = n[1] - e.ny;
      e.nx = n[0]; e.ny = n[1];
    }
    if (has(s, "quantum") && rngNext(s) < 0.035 * dt * 1) {
      // 量子穿隧：往前跳 2 格
      var x = e.nx, y = e.ny, ok = true;
      for (var j = 0; j < 2; j++) {
        if (x === s.core[0] && y === s.core[1]) { ok = false; break; }
        var m = nextCell(s, x, y, e.pdx, e.pdy);
        if (!m) { ok = false; break; }
        x = m[0]; y = m[1];
      }
      if (ok && !(x === s.core[0] && y === s.core[1])) {
        fx(s, { k: "tunnel", x: e.x, y: e.y, tx: x + 0.5, ty: y + 0.5 });
        e.x = x + 0.5; e.y = y + 0.5;
        var m2 = nextCell(s, x, y, e.pdx, e.pdy);
        if (m2) { e.nx = m2[0]; e.ny = m2[1]; } else { e.nx = x; e.ny = y; }
      }
    }
  }
  function eatAround(s, e) {
    var cx = Math.floor(e.x), cy = Math.floor(e.y), cand = [], busy = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var x = cx + dx, y = cy + dy;
      if (!inb(x, y) || !s.fo[idx(x, y)]) continue;
      var tw = towerAt(s, x, y);
      if (tw) busy.push(tw); else cand.push([x, y]);
    }
    if (cand.length) {
      var c = cand[rint(s, cand.length)], ci = idx(c[0], c[1]);
      s.fo[ci] = ""; s.fm[ci] = "";
      touched(s);
      fx(s, { k: "eat", x: c[0] + 0.5, y: c[1] + 0.5 });
    } else if (busy.length) {
      busy.forEach(function (tw) { if (!grounded(s, tw)) tw.dis = s.time + 3; });
      fx(s, { k: "emp", x: e.x, y: e.y, r: 1.5 });
    }
  }
  function leak(s, e) {
    e.dead = true;
    s.leaks++;
    s.hp = Math.max(0, s.hp - e.lk);
    fx(s, { k: "leak", n: e.lk });
    if (s.hp <= 0) finish(s, false);
  }

  function mapStep(s, dt) {
    if (has(s, "psu")) {
      s.m.surgeT += dt;
      if (s.m.surgeT >= 20) { s.m.surgeT = 0; s.m.surgeU = s.time + 3; fx(s, { k: "surge" }); }
    } else if (has(s, "grid")) {
      s.m.boltT += dt;
      if (s.m.boltT >= 4) {
        s.m.boltT = 0;
        var bx, by, r = rngNext(s);
        if (r < 0.3 && s.towers.length) { var tw = s.towers[rint(s, s.towers.length)]; bx = tw.x + 0.5; by = tw.y + 0.5; }
        else if (r < 0.75 && s.enemies.length) { var e = s.enemies[rint(s, s.enemies.length)]; bx = e.x; by = e.y; }
        else { bx = rint(s, W) + 0.5; by = rint(s, H) + 0.5; }
        var hit = towerAt(s, Math.floor(bx), Math.floor(by));
        if (hit) { if (hit.ty === "tesla") hit.chg = s.time + 5; else if (!grounded(s, hit)) hit.dis = s.time + 2; }
        var dmg = 30 * hpMul(s, s.wave) / D.DIFFS[s.diff].hp;
        s.enemies.forEach(function (o) { if (!o.dead && dist2(o.x, o.y, bx, by) <= 1.1) hurt(s, o, dmg, "en", null); });
        fx(s, { k: "bolt", x: bx, y: by, tw: hit ? hit.id : 0 });
      }
    }
  }

  // 每一格模擬（dt 秒）
  function step(s, dt) {
    if (s.end) return;
    if (s.phase === "build") {
      if (s.auto && s.autoT > 0) { s.autoT -= dt; if (s.autoT <= 0) startWave(s); }
      return;
    }
    s.time += dt; s.wt += dt;
    while (s.wq.length && s.wq[0].t <= s.wt) {
      var q = s.wq.shift();
      spawnEnemy(s, q.ty, q.sp, q.hm);
    }
    mapStep(s, dt);
    var i;
    for (i = 0; i < s.enemies.length; i++) if (!s.enemies[i].dead) enemyStep(s, s.enemies[i], dt);
    if (s.end) return;
    for (i = 0; i < s.towers.length; i++) towerStep(s, s.towers[i], dt);
    projStep(s, dt);
    s.enemies = s.enemies.filter(function (e) { return !e.dead; });
    var cut = s.time - 0.8;
    if (s.fx.length && s.fx[0].t < cut) s.fx = s.fx.filter(function (f) { return f.t >= cut; });
    if (s.phase === "wave" && !s.wq.length && !s.enemies.length && !s.end) endWave(s);
  }

  // ---------------- 意圖（玩家操作；單機直接套用，連線由房主套用） ----------------
  function applyIntent(s, pid, it) {
    if (!it || !it.a) return false;
    if (it.a === "join") { addPlayer(s, pid, it.name, it.role); return true; }
    var p = s.players[pid];
    if (!p || s.end) return false;
    var tw, cost;
    switch (it.a) {
      case "place": {
        var pc = p.pieces[it.i];
        if (!pc) return false;
        var cells = pieceCells(pc, it.r | 0, it.x | 0, it.y | 0);
        if (checkPlace(s, cells)) return false;
        cells.forEach(function (c) { var ci = idx(c.x, c.y); s.fo[ci] = pid; s.fm[ci] = c.m; });
        touched(s);
        p.pieces.splice(it.i, 1);
        fx(s, { k: "place", c: cells.map(function (c) { return [c.x, c.y]; }) });
        return true;
      }
      case "build": {
        var def = D.TOWERS[it.t], bi = idx(it.x | 0, it.y | 0);
        if (!def || def.cat === "evo" || !inb(it.x, it.y) || !s.fo[bi] || towerAt(s, it.x, it.y) || p.cash < def.cost) return false;
        p.cash -= def.cost;
        s.tv = (s.tv || 0) + 1;
        s.towers.push({ id: ++s.tid, ty: it.t, x: it.x | 0, y: it.y | 0, lv: 0, o: pid, spent: def.cost, cd: 0, mode: "first", dmg: 0, kills: 0, heat: 0, ang: Math.PI });
        fx(s, { k: "build", x: it.x + 0.5, y: it.y + 0.5 });
        return true;
      }
      case "up": {
        tw = towerById(s, it.id);
        if (!tw || tw.o !== pid) return false;
        cost = upgradeCost(tw, p);
        if (!cost || p.cash < cost) return false;
        p.cash -= cost; tw.spent += cost; tw.lv++;
        fx(s, { k: "up", x: tw.x + 0.5, y: tw.y + 0.5 });
        return true;
      }
      case "evo": {
        tw = towerById(s, it.id);
        var bd = tw && D.TOWERS[tw.ty], to = D.TOWERS[it.to];
        if (!tw || tw.o !== pid || !bd || bd.cat !== "base" || tw.lv !== bd.lv.length - 1 || !to || bd.evo.indexOf(it.to) < 0) return false;
        cost = evoCost(it.to, p);
        if (p.cash < cost) return false;
        s.tv = (s.tv || 0) + 1;
        p.cash -= cost; tw.spent += cost; tw.ty = it.to; tw.lv = 0; tw.held = 0; tw.tg = 0;
        if (s.rec) s.rec.evo[it.to] = 1;
        fx(s, { k: "evo", x: tw.x + 0.5, y: tw.y + 0.5 });
        return true;
      }
      case "sell": {
        tw = towerById(s, it.id);
        if (!tw || tw.o !== pid) return false;
        p.cash += refundOf(s, tw);
        s.tv = (s.tv || 0) + 1;
        s.towers.splice(s.towers.indexOf(tw), 1);
        fx(s, { k: "sell", x: tw.x + 0.5, y: tw.y + 0.5 });
        return true;
      }
      case "mode": {
        tw = towerById(s, it.id);
        if (!tw || ["first", "last", "strong", "near"].indexOf(it.m) < 0) return false;
        tw.mode = it.m;
        return true;
      }
      case "buy": {
        cost = buyCost(p);
        if (p.pieces.length >= 3 || p.cash < cost) return false;
        p.cash -= cost; p.bought++;
        p.pieces.push(newPiece(s));
        return true;
      }
      case "reroll": {
        if (!p.pieces[it.i] || p.cash < rerollCost(p)) return false;
        p.cash -= rerollCost(p);
        p.pieces[it.i] = newPiece(s);
        return true;
      }
      case "drop": {
        if (!p.pieces[it.i]) return false;
        p.pieces.splice(it.i, 1);
        p.cash += 10;
        return true;
      }
      case "ready": {
        p.ready = !!it.v;
        if (s.phase === "build" && s.order.every(function (k) { return s.players[k].ready; })) startWave(s);
        return true;
      }
      case "auto": { s.auto = !!it.v; if (s.auto && s.phase === "build") s.autoT = 6; return true; }
      case "name": { p.name = String(it.name || "").slice(0, 16); return true; }
      case "role": {
        if (s.wave > 0 || !D.ROLES[it.r]) return false;
        p.role = it.r;
        return true;
      }
      case "skill": {
        var sk = D.SKILLS[it.k];
        if (!sk || s.phase !== "wave" || (p.cd[it.k] || 0) > s.time) return false;
        p.cd[it.k] = s.time + skillCd(s, p, it.k);
        p.skillN = (p.skillN || 0) + 1;
        if (s.rec) s.rec.skills = Math.max(s.rec.skills, p.skillN);
        if (it.k === "emp") s.enemies.forEach(function (e) { e.sh *= 0.4; e.stunU = Math.max(e.stunU, s.time + (e.boss ? 0.5 : 1.5)); });
        else if (it.k === "oc") p.ocU = s.time + 8;
        else if (it.k === "fix") s.hp = Math.min(s.mhp, s.hp + 3);
        fx(s, { k: "skill", s: it.k, o: pid });
        return true;
      }
    }
    return false;
  }
  function buyCost(p) { return Math.round((40 + 20 * (p.bought || 0)) * (p.role === "engineer" ? 0.5 : 1)); }

  // 存檔／廣播：去掉 "_" 快取與飛行中的彈丸（彈丸只影響數十毫秒，接手時重新開火即可）
  function serialize(s, keepProj) {
    return JSON.stringify(s, function (k, v) {
      if (k.charAt(0) === "_") return undefined;
      if (k === "proj" && !keepProj) return [];
      if (typeof v === "number" && !Number.isInteger(v)) return Math.round(v * 1000) / 1000;
      return v;
    });
  }
  function restore(json) {
    var s = typeof json === "string" ? JSON.parse(json) : json;
    if (!s || s.v !== 1 || !s.ter) return null;
    s.mix = s.mix || []; s.unl = s.unl || {}; s.rec = s.rec || { boss: {}, evo: {}, combo: {}, skills: 0, net: 0 };
    Object.keys(s.players || {}).forEach(function (k) { var p = s.players[k]; p.role = p.role || "general"; p.cd = p.cd || { emp: 0, oc: 0, fix: 0 }; p.ocU = p.ocU || 0; });
    s.proj = s.proj || [];
    s.fx = s.fx || [];
    return s;
  }

  window.PriTestDenshiCore = {
    W: W, H: H, idx: idx, inb: inb, clamp: clamp, newSeed: newSeed, newGame: newGame, step: step, applyIntent: applyIntent,
    serialize: serialize, restore: restore, distField: distField, pathFrom: pathFrom, pieceCells: pieceCells, rotCells: rotCells,
    checkPlace: checkPlace, stats: stats, towerAt: towerAt, towerById: towerById, refundOf: refundOf, upgradeCost: upgradeCost,
    buyCost: buyCost, wavePreview: wavePreview, waveSpawns: waveSpawns, activeSpawns: activeSpawns, jamX: jamX, jammed: jammed, bossOf: bossOf,
    addPlayer: addPlayer, BIG: BIG, has: has, nets: nets, combosOf: combosOf, evoCost: evoCost, rerollCost: rerollCost,
    skillCd: skillCd, offline: offline, grounded: grounded
  };
})();
