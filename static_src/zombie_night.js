// 末日據點（zombie）：夜晚防守的模擬（不碰 DOM）。即時 3D 與「自動結算」共用同一個模擬：
//   - 自動結算＝不下任何指令、直接跑到天亮；即時＝畫面每 0.1 秒推進一步，玩家的點擊變成指令。
//   - 連線合作：只有房主跑模擬，其他人送指令、看房主廣播的快照（zombie_net.js）。
//   - 固定步長 DT＋自己的亂數（mulberry32），同一份 setup＋同一串指令＝同一個結果。
//
// 據點：邊長 2H 的方形圍牆，每邊 4 段（共 16 段，0〜3 北、4〜7 東、8〜11 南、12〜15 西），中央是核心建築（半徑 CORE_R）。
// 殭屍從半徑 SPAWN_R 的圓周出現，走向最近的牆段 → 打牆 → 牆破了就進來打核心。核心歸零＝據點陷落。
// 守衛站在哨位自動射擊（用彈藥；沒彈藥只能近身打牆邊的殭屍）。玩家指令：射擊、修牆、燃燒瓶、噪音誘餌。
(function () {
  "use strict";

  var D = window.PriTestZombieData;
  var DT = 0.1, H = 12, SEG_N = 16, SEG_LEN = 6, CORE_R = 3, SPAWN_R = 34;
  var TYPES = ["walker", "runner", "brute", "screamer", "mutant"];
  var CMD_CD = { shoot: 0.4, repair: 0.6, fire: 1, decoy: 1 };
  var MELEE_R = 11, REPAIR_HP = 15, FIRE_R = 3.6, FIRE_T = 7, FIRE_DPS = 5, DECOY_R = 26, DECOY_T = 10;

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // 牆段 i：中心 (x, z)、外側法線 (nx, nz)、沿牆方向 (tx, tz)
  function seg(i) {
    var side = Math.floor(i / 4), k = i % 4, along = -H + SEG_LEN / 2 + k * SEG_LEN;
    if (side === 0) return { x: along, z: -H, nx: 0, nz: -1, tx: 1, tz: 0 };
    if (side === 1) return { x: H, z: along, nx: 1, nz: 0, tx: 0, tz: 1 };
    if (side === 2) return { x: -along, z: H, nx: 0, nz: 1, tx: -1, tz: 0 };
    return { x: -H, z: -along, nx: -1, nz: 0, tx: 0, tz: -1 };
  }
  var SEGS = [];
  for (var si = 0; si < SEG_N; si++) SEGS.push(seg(si));
  // 點 (x, z) 在牆外的距離（在牆內＝負）
  function outside(x, z) { return Math.max(Math.abs(x), Math.abs(z)) - H; }
  // 離 (x, z) 最近的牆段
  function nearestSeg(x, z) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < SEG_N; i++) { var s = SEGS[i], dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  // 哨位（依瞭望台等級）：0＝4 個角落、1＝＋2 個邊中央、2＝4 角＋4 邊中央
  var CORNERS = [[-H + 0.8, -H + 0.8], [H - 0.8, H - 0.8], [H - 0.8, -H + 0.8], [-H + 0.8, H - 0.8]];
  var MIDS = [[0, -H + 0.8], [H - 0.8, 0], [0, H - 0.8], [-H + 0.8, 0]];
  function posts(tower) {
    var n = [4, 6, 8][clamp(tower | 0, 0, 2)], all = CORNERS.concat(MIDS);
    return all.slice(0, n);
  }

  // setup（由 zombie_core.js 的 nightSetup 產生，純 JSON）：
  //   { seed, n, mix: { walker: 0.6, ... }, spd, accMod, walls: [16], wallMax, core, coreMax, tower, traps, wire,
  //     guards: [{ sid, name, acc, cd, dmg, mdmg, sniper }], ammo, mats, molotov, decoy, spawnDur, limit, bitey }
  function create(setup) {
    var r = rng(setup.seed);
    var P = posts(setup.tower);
    var sim = {
      setup: setup, t: 0, step: 0, done: false, overrun: false,
      walls: setup.walls.slice(), wallMax: setup.wallMax, core: setup.core, coreMax: setup.coreMax,
      ammo: setup.ammo, mats: setup.mats, molotov: setup.molotov, decoy: setup.decoy,
      zs: [], nextId: 1, fires: [], decoys: [], fx: [], ev: [], kills: 0, coreDmg: 0, shots: 0, hits: 0,
      ammoUsed: 0, matsUsed: 0, molUsed: 0, decoyUsed: 0, extra: 0, breaches: {},
      posts: P, guards: [], cds: {}, spawns: []
    };
    // 守衛：依戰鬥力排好，前 P.length 個上哨位
    (setup.guards || []).slice(0, P.length).forEach(function (g, i) {
      sim.guards.push({ sid: g.sid, name: g.name, x: P[i][0], z: P[i][1], acc: g.acc, cd: g.cd, dmg: g.dmg, mdmg: g.mdmg, sniper: !!g.sniper, timer: r() * g.cd, aim: null });
    });
    // 沒排到哨位的人守在核心旁邊，打衝進來的殭屍
    sim.reserve = (setup.guards || []).slice(P.length).map(function (g, i) {
      var a = i * 2.1;
      return { sid: g.sid, x: Math.cos(a) * (CORE_R + 1.2), z: Math.sin(a) * (CORE_R + 1.2), mdmg: g.mdmg, timer: r() };
    });
    // 出現排程：一波 3〜6 隻從同一個方向來
    var n = setup.n, at = 2, types = [];
    var mix = setup.mix, keys = TYPES.filter(function (k) { return mix[k] > 0; }), tot = 0;
    keys.forEach(function (k) { tot += mix[k]; });
    for (var i = 0; i < n; i++) {
      var x = r() * tot, ty = keys[keys.length - 1];
      for (var j = 0; j < keys.length; j++) { x -= mix[keys[j]]; if (x < 0) { ty = keys[j]; break; } }
      types.push(ty);
    }
    var gap = (setup.spawnDur - 2) / Math.max(1, n);
    while (types.length) {
      var size = Math.min(types.length, 3 + Math.floor(r() * 4)), ang = r() * Math.PI * 2;
      for (var k = 0; k < size; k++) sim.spawns.push({ t: at + k * 0.35, type: types.shift(), ang: ang + (r() - 0.5) * 0.5 });
      at += gap * size;
    }
    sim.spawns.sort(function (a, b) { return a.t - b.t; });
    sim.total = sim.spawns.length;

    function fx(o) { o.t = sim.t; sim.fx.push(o); if (sim.fx.length > 80) sim.fx.splice(0, sim.fx.length - 80); }
    function event(k, p) { sim.ev.push({ t: Math.round(sim.t * 10) / 10, k: k, p: p || null }); }

    function spawn(type, ang) {
      var Z = D.ZOMBIES[type], x = Math.cos(ang) * SPAWN_R, z = Math.sin(ang) * SPAWN_R;
      var hp = Z.hp * (setup.hpMult || 1);
      var zb = { id: sim.nextId++, type: type, x: x, z: z, hp: hp, max: hp, spd: Z.spd * (0.88 + r() * 0.24) * (setup.spd || 1), st: "out", seg: -1, off: (r() - 0.5) * 4.2, scream: 3 + r() * 4 };
      retarget(zb);
      sim.zs.push(zb);
    }
    function retarget(zb) {
      var s = nearestSeg(zb.x, zb.z), S = SEGS[s];
      zb.seg = s;
      zb.tx = S.x + S.tx * zb.off + S.nx * 0.6;
      zb.tz = S.z + S.tz * zb.off + S.nz * 0.6;
    }
    function kill(zb, by) {
      if (zb.dead) return;
      zb.dead = true; sim.kills++;
      fx({ k: "die", x: zb.x, z: zb.z, ty: zb.type });
      if (zb.type === "brute" || zb.type === "mutant" || zb.type === "screamer") event("kill_" + zb.type, { by: by || "" });
    }
    function hurt(zb, dmg, by) {
      if (zb.dead) return;
      zb.hp -= dmg;
      if (zb.hp <= 0) kill(zb, by);
    }
    // close＝只找在打牆或已經衝進來的
    function nearestZombie(x, z, range, close) {
      var best = null, bd = range * range;
      for (var i = 0; i < sim.zs.length; i++) {
        var zb = sim.zs[i];
        if (zb.dead || (close && zb.st === "out") || (close === "in" && zb.st !== "in")) continue;
        var dx = zb.x - x, dz = zb.z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = zb; }
      }
      return best;
    }
    function useAmmo(sniper) {
      if (sim.ammo <= 0) return false;
      if (sniper && r() < 0.25) return true;
      sim.ammo--; sim.ammoUsed++;
      return true;
    }

    // 指令：{ a: "shoot", id } | { a: "repair", seg } | { a: "fire", x, z } | { a: "decoy", x, z }；pid＝下指令的玩家（各自冷卻）
    sim.cmd = function (pid, c) {
      if (sim.done || !c) return false;
      var key = pid + ":" + c.a, cd = CMD_CD[c.a];
      if (cd === undefined || (sim.cds[key] || 0) > sim.t) return false;
      if (c.a === "shoot") {
        var zb = null;
        for (var i = 0; i < sim.zs.length; i++) if (sim.zs[i].id === c.id && !sim.zs[i].dead) zb = sim.zs[i];
        if (!zb || !useAmmo(false)) return false;
        sim.shots++;
        var dodge = (D.ZOMBIES[zb.type].dodge || 0) * 0.5, hit = r() < clamp(0.9 + setup.accMod - dodge, 0.3, 0.97);
        fx({ k: "shot", x1: 0, z1: 0, y1: 4, x2: zb.x, z2: zb.z, hit: hit ? 1 : 0, p: pid });
        if (hit) { sim.hits++; hurt(zb, 4, pid); }
      } else if (c.a === "repair") {
        var s = c.seg | 0;
        if (s < 0 || s >= SEG_N || sim.mats <= 0 || sim.walls[s] >= sim.wallMax) return false;
        sim.mats--; sim.matsUsed++;
        sim.walls[s] = Math.min(sim.wallMax, sim.walls[s] + REPAIR_HP);
        fx({ k: "repair", s: s, p: pid });
      } else if (c.a === "fire") {
        if (sim.molotov <= 0 || !isFinite(c.x) || !isFinite(c.z)) return false;
        sim.molotov--; sim.molUsed++;
        sim.fires.push({ x: clamp(c.x, -SPAWN_R, SPAWN_R), z: clamp(c.z, -SPAWN_R, SPAWN_R), until: sim.t + FIRE_T });
        fx({ k: "fire", x: c.x, z: c.z, p: pid });
      } else if (c.a === "decoy") {
        if (sim.decoy <= 0 || !isFinite(c.x) || !isFinite(c.z)) return false;
        sim.decoy--; sim.decoyUsed++;
        sim.decoys.push({ x: clamp(c.x, -SPAWN_R, SPAWN_R), z: clamp(c.z, -SPAWN_R, SPAWN_R), until: sim.t + DECOY_T });
        fx({ k: "decoy", x: c.x, z: c.z, p: pid });
      }
      sim.cds[key] = sim.t + cd;
      return true;
    };

    sim.tick = function () {
      if (sim.done) return;
      var t = sim.t;
      while (sim.spawns.length && sim.spawns[0].t <= t) { var sp = sim.spawns.shift(); spawn(sp.type, sp.ang); }
      sim.fires = sim.fires.filter(function (f) { return f.until > t; });
      sim.decoys = sim.decoys.filter(function (d) { return d.until > t; });
      var dec = sim.decoys.length ? sim.decoys[sim.decoys.length - 1] : null;
      // 殭屍
      for (var i = 0; i < sim.zs.length; i++) {
        var zb = sim.zs[i];
        if (zb.dead) continue;
        var Z = D.ZOMBIES[zb.type], spd = zb.spd, out = outside(zb.x, zb.z);
        if (out > 0 && out < 5 && setup.wire) spd *= 1 - 0.22 * setup.wire;
        if (out > 0 && out < 3 && setup.traps) hurt(zb, setup.traps * 0.9 * DT, "trap");
        for (var f = 0; f < sim.fires.length; f++) {
          var F = sim.fires[f], fdx = zb.x - F.x, fdz = zb.z - F.z;
          if (fdx * fdx + fdz * fdz < FIRE_R * FIRE_R) { hurt(zb, FIRE_DPS * DT, "fire"); spd *= 0.7; }
        }
        if (zb.dead) continue;
        // 尖叫者：靠近據點後每 7 秒叫來 2 隻殭屍（上限 14 隻）
        if (zb.type === "screamer" && out < 12) {
          zb.scream -= DT;
          if (zb.scream <= 0 && sim.extra < 14) {
            zb.scream = 7; sim.extra += 2;
            var a0 = Math.atan2(zb.z, zb.x);
            sim.spawns.push({ t: t + 0.5, type: "walker", ang: a0 + 0.4 }, { t: t + 0.9, type: "walker", ang: a0 - 0.4 });
            sim.spawns.sort(function (a, b) { return a.t - b.t; });
            sim.total += 2;
            fx({ k: "scream", x: zb.x, z: zb.z });
            event("scream");
          }
        }
        if (zb.st === "out") {
          var tx = zb.tx, tz = zb.tz;
          if (dec) {
            var ddx = dec.x - zb.x, ddz = dec.z - zb.z;
            if (ddx * ddx + ddz * ddz < DECOY_R * DECOY_R) { tx = dec.x + zb.off * 0.4; tz = dec.z + zb.off * 0.3; }
          } else if (zb.lured) { zb.lured = false; retarget(zb); tx = zb.tx; tz = zb.tz; }
          if (dec && tx === dec.x + zb.off * 0.4) zb.lured = true;
          var dx = tx - zb.x, dz = tz - zb.z, d = Math.sqrt(dx * dx + dz * dz);
          if (d < 0.25) { if (!zb.lured) zb.st = "wall"; }
          else { var m = Math.min(d, spd * DT); zb.x += dx / d * m; zb.z += dz / d * m; }
        } else if (zb.st === "wall") {
          if (sim.walls[zb.seg] > 0) {
            sim.walls[zb.seg] = Math.max(0, sim.walls[zb.seg] - Z.dps * DT);
            if (sim.walls[zb.seg] <= 0 && !sim.breaches[zb.seg]) { sim.breaches[zb.seg] = 1; event("breach", { s: zb.seg }); fx({ k: "breach", s: zb.seg }); }
          } else zb.st = "in";
        } else if (zb.st === "in") {
          var cdx = -zb.x, cdz = -zb.z, cd2 = Math.sqrt(cdx * cdx + cdz * cdz);
          if (cd2 > CORE_R + 0.4) { var m2 = Math.min(cd2 - CORE_R, spd * DT); zb.x += cdx / cd2 * m2; zb.z += cdz / cd2 * m2; }
          else {
            var dmg = Z.dps * DT;
            sim.core = Math.max(0, sim.core - dmg); sim.coreDmg += dmg;
            if (Math.floor((sim.coreDmg - dmg) / 10) !== Math.floor(sim.coreDmg / 10)) fx({ k: "corehit", x: zb.x, z: zb.z });
          }
        }
      }
      // 守衛：牆邊（MELEE_R 內）有在打牆的殭屍就近身打（省子彈），否則射程內最近的開槍
      var range = 16 + (setup.tower | 0) * 3;   // 四個角落的哨位就能涵蓋整圈圍牆外側
      for (var g = 0; g < sim.guards.length; g++) {
        var G = sim.guards[g];
        G.timer -= DT;
        if (G.timer > 0) continue;
        // 衝進據點的殭屍：守衛下哨位去打（距離不限）；否則打牆邊 MELEE_R 內的
        var inside = nearestZombie(G.x, G.z, 40, "in"), mel = inside || nearestZombie(G.x, G.z, MELEE_R, true);
        if (mel) {
          G.aim = mel.id;
          hurt(mel, G.mdmg * (inside ? 0.6 : 1), "g");   // 下哨位跑過去打，比較慢也比較弱
          fx({ k: "melee", x: mel.x, z: mel.z, g: g });
          G.timer = inside ? 1.6 : 1.1;
          continue;
        }
        var tgt = nearestZombie(G.x, G.z, range);
        if (!tgt) { G.timer = 0.2; G.aim = null; continue; }
        G.aim = tgt.id;
        if (useAmmo(G.sniper)) {
          sim.shots++;
          var dg = D.ZOMBIES[tgt.type].dodge || 0, ok = r() < clamp(G.acc + setup.accMod - dg, 0.1, 0.95);
          fx({ k: "shot", x1: G.x, z1: G.z, y1: 3, x2: tgt.x, z2: tgt.z, hit: ok ? 1 : 0 });
          if (ok) { sim.hits++; hurt(tgt, G.dmg, "g"); }
          G.timer = G.cd;
        } else G.timer = 0.3;
      }
      // 核心旁的預備隊
      for (var q = 0; q < sim.reserve.length; q++) {
        var R = sim.reserve[q];
        R.timer -= DT;
        if (R.timer > 0) continue;
        var zr = nearestZombie(R.x, R.z, 6.5, true);
        if (zr) { hurt(zr, R.mdmg, "g"); fx({ k: "melee", x: zr.x, z: zr.z }); R.timer = 1.1; } else R.timer = 0.3;
      }
      sim.zs = sim.zs.filter(function (zb) { return !zb.dead; });
      sim.t = Math.round((t + DT) * 1000) / 1000; sim.step++;
      if (sim.core <= 0) { sim.done = true; sim.overrun = true; event("overrun"); return; }
      var calm = !sim.spawns.length && !sim.zs.length && sim.t >= 6;
      if (calm || sim.t >= setup.limit) {
        sim.done = true;
        event(calm ? "cleared" : "dawn", { left: sim.zs.length });
      }
    };
    // 一直跑到天亮（自動結算）
    sim.runToEnd = function () { var guard = 0; while (!sim.done && guard++ < 20000) sim.tick(); return sim.result(); };
    sim.result = function () {
      return {
        walls: sim.walls.map(function (w) { return Math.round(w * 10) / 10; }), core: Math.round(sim.core * 10) / 10, coreDmg: Math.round(sim.coreDmg),
        ammoUsed: sim.ammoUsed, matsUsed: sim.matsUsed, molUsed: sim.molUsed, decoyUsed: sim.decoyUsed,
        kills: sim.kills, total: sim.total, shots: sim.shots, hits: sim.hits, overrun: sim.overrun, left: sim.zs.length,
        breaches: Object.keys(sim.breaches).length, t: sim.t, ev: sim.ev.slice(-40)
      };
    };
    // 快照（連線廣播用，數字縮小成整數）
    sim.snap = function (since) {
      var fxs = sim.fx.filter(function (f) { return f.t > (since || -1); });
      return {
        t: sim.t, c: Math.round(sim.core), cm: sim.coreMax, a: sim.ammo, m: sim.mats, mo: sim.molotov, de: sim.decoy, k: sim.kills, tot: sim.total,
        w: sim.walls.map(function (w) { return Math.round(w); }), wm: sim.wallMax,
        z: sim.zs.map(function (zb) { return [zb.id, TYPES.indexOf(zb.type), Math.round(zb.x * 10), Math.round(zb.z * 10), Math.round(zb.hp / zb.max * 100), zb.st === "wall" ? 1 : zb.st === "in" ? 2 : 0]; }),
        g: sim.guards.map(function (G) { return G.aim || 0; }),
        f: sim.fires.map(function (F) { return [Math.round(F.x * 10), Math.round(F.z * 10)]; }),
        d: sim.decoys.map(function (F) { return [Math.round(F.x * 10), Math.round(F.z * 10)]; }),
        fx: fxs, done: sim.done ? 1 : 0, ov: sim.overrun ? 1 : 0
      };
    };
    return sim;
  }

  window.PriTestZombieNight = {
    DT: DT, H: H, SEG_N: SEG_N, SEG_LEN: SEG_LEN, CORE_R: CORE_R, SPAWN_R: SPAWN_R, TYPES: TYPES, SEGS: SEGS, CMD_CD: CMD_CD, FIRE_R: FIRE_R, DECOY_R: DECOY_R,
    create: create, posts: posts, nearestSeg: nearestSeg, outside: outside, rng: rng
  };
})();
