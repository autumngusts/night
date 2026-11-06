// 大名幸村（yukimura）：規則與模擬（類倖存者）。只有「房主／單機」跑這裡的 step()；其他連線玩家只看快照。
// 狀態 s 是純 JSON（可序列化，房主斷線時新房主從最後一份完整狀態接手）。
// 主要流程：step(s, dt) → 計時／關卡特色／出怪 → 玩家（移動、武器、拾取、復活）→ 敵人（追擊、遠程、衝鋒、首領招式）
//          → 投射物／區域／預警 → 經驗與升級（三選一）→ 勝敗。
// 2026-11-05 依使用者需求新增。
(function () {
  "use strict";

  var D = window.PriTestYukimuraData;
  var TK = window.PriTestYukimuraTenka || null;   // 新模式「天下布武」的資料（yukimura_tenka.js）
  var AR = D.ARENA;
  var MAX_E = 240, MAX_G = 320;

  // ---------------- 亂數（狀態裡只存整數種子）----------------
  function rnd(s) {
    var a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(s, n) { return Math.floor(rnd(s) * n); }
  function pick(s, arr) { return arr[rint(s, arr.length)]; }
  function wpick(s, list, wf) {
    var tot = 0, i;
    for (i = 0; i < list.length; i++) tot += wf(list[i]);
    var r = rnd(s) * tot;
    for (i = 0; i < list.length; i++) { r -= wf(list[i]); if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function nid(s) { return ++s.nid; }

  // ---------------- 建立一局 ----------------
  // cfg：{ stage, map, diff, dur（秒）, seed }
  function create(cfg) {
    var st = D.STAGES[cfg.stage] || D.STAGES[0];
    var s = {
      v: 1, rs: (cfg.seed || (Date.now() & 0x7fffffff)) | 0, t: 0, stage: cfg.stage | 0,
      map: cfg.map === undefined || cfg.map < 0 ? st.maps[0] : cfg.map, diff: D.DIFFS[cfg.diff] ? cfg.diff : "normal",
      dur: cfg.dur || 900, ph: "play", P: {}, gone: {}, E: [], S: [], B: [], G: [], D: [], Z: [], W: [], fx: [], nid: 0,
      kills: 0, spawnAcc: 0, mids: [0, 0], boss: 0, bossName: null, fe: { on: 0, t: 0, k: st.feat, wx: 0, wz: 0, next: 40 },
      ev: { lantern: 8, warashi: 50, special: 20 }, freeze: 0, rivers: [], msg: []
    };
    // 新模式「天下布武」：天命、軍令、逆鱗（cfg.mode === "tenka"）
    if (cfg.mode === "tenka" && TK) {
      s.mode = "tenka"; s.heat = clamp(cfg.heat | 0, 0, TK.HEAT_MAX); s.arcT = [0, 0]; s.q = null; s.qNext = 70; s.qN = 0;
    }
    if (st.feat === "river" || D.MAPS[s.map].river) {
      var nr = Math.max(D.MAPS[s.map].river || 0, st.feat === "river" ? 2 : 0);
      for (var i = 0; i < nr; i++) s.rivers.push({ x: (rnd(s) - 0.5) * AR, z: (rnd(s) - 0.5) * AR, a: rnd(s) * Math.PI, w: 3 + rnd(s) * 1.5 });
    }
    return s;
  }

  // ---------------- 玩家 ----------------
  function addPlayer(s, pid, name, dm, meta) {
    if (s.P[pid]) return s.P[pid];
    if (s.gone[pid]) {   // 中途退出後再回來：恢復原本的角色
      var back = s.gone[pid];
      delete s.gone[pid];
      back.iv = 3; back.down = 0;
      if (back.hp <= 0) back.hp = back.mhp * 0.5;
      s.P[pid] = back;
      msg(s, "join", pid, back.name);
      return back;
    }
    var d = D.DAIMYO[dm] || D.DAIMYO[0];
    var ang = rnd(s) * Math.PI * 2, others = Object.keys(s.P).map(function (k) { return s.P[k]; });
    var cx = 0, cz = 0;
    if (others.length) { cx = others[0].x; cz = others[0].z; }
    meta = meta || {};
    var P = {
      pid: pid, name: String(name || "").slice(0, 16), dm: d.i, x: cx + Math.cos(ang) * 2, z: cz + Math.sin(ang) * 2, fx: 0, fz: 1, mvx: 0, mvz: 0,
      hp: 100, mhp: 100, lv: 1, xp: 0, xn: xpNeed(1), W: [], A: [], down: 0, rv: 0, iv: 3, buf: {}, ult: 0, opts: null, optT: 0, pend: 0,
      kills: 0, dmg: 0, gold: 0, meta: meta, rr: (meta.reroll | 0), rev: (meta.revive | 0), st: null, sp: 4.2, joinT: s.t, chestN: 0
    };
    P.W.push(newW(d.start));
    if (s.mode === "tenka") tenkaInitPlayer(s, P);
    s.P[pid] = P;
    calcStats(P, s);
    P.hp = P.mhp;
    // 中途加入：依隊伍平均等級補發升級次數（照樣三選一）
    if (others.length) {
      var avg = 0;
      others.forEach(function (o) { avg += o.lv; });
      avg = Math.floor(avg / others.length);
      if (avg > 3) { P.pend = avg - 3; P.lv = avg - 2; P.xn = xpNeed(P.lv); }
      msg(s, "join", pid, P.name);
    }
    return P;
  }
  function removePlayer(s, pid) {
    var P = s.P[pid];
    if (!P) return;
    P.opts = null;
    s.gone[pid] = P;
    delete s.P[pid];
    msg(s, "leave", pid, P.name);
  }
  function players(s) { return Object.keys(s.P).sort().map(function (k) { return s.P[k]; }); }
  function alive(s) { return players(s).filter(function (P) { return !P.down; }); }
  function newW(id) { return { id: id, lv: 1, cd: 0.5, evo: 0, ot: 0, ft: 0, tk: 0, mods: [] }; }
  // ---------------- 武器搭配與秘傳 ----------------
  function ownedArch(P) { var o = {}; P.W.forEach(function (w) { o[D.ARCHES[D.WEAPONS[w.id].a].k] = 1; }); return o; }
  function synergies(P) { var o = ownedArch(P); return D.SYNERGY.filter(function (y) { return o[y.a] && o[y.b]; }); }
  // 這把武器實際有效的秘傳：自己學的＋搭配給的
  function weaponMods(P, w) {
    var list = (w.mods || []).slice(), ak = D.ARCHES[D.WEAPONS[w.id].a].k;
    synergies(P).forEach(function (y) { if (y.give && y.a === ak && list.indexOf(y.give) < 0) list.push(y.give); });
    return list;
  }
  function xpNeed(lv) { return Math.round(5 + lv * 5.5 + Math.max(0, lv - 20) * 9 + Math.max(0, lv - 40) * 16); }
  function msg(s, k, pid, a, b, c) { s.msg.push({ id: nid(s), k: k, p: pid, a: a, b: b, c: c, t: s.t }); if (s.msg.length > 12) s.msg.shift(); }

  // ---------------- 能力計算 ----------------
  function baseStats() {
    return { might: 1, area: 1, cdr: 0, amount: 0, dur: 1, speed: 1, pspd: 1, maxHp: 100, regen: 0, armor: 0, magnet: 1, luck: 1, growth: 1, greed: 1, crit: 0.05, critDmg: 1.5, steal: 0, thorns: 0, knock: 1, elem: 1 };
  }
  function prefCounts(P) {
    var c = {};
    P.W.forEach(function (w) { var p = D.VARIANTS[D.WEAPONS[w.id].v].pref; c[p] = (c[p] || 0) + 1; });
    P.A.forEach(function (a) { var p = D.ACCS[a.id].pref; c[p] = (c[p] || 0) + 1; });
    return c;
  }
  // 地緣：同一縣的武器＋飾品湊 3 件／5 件，得到該縣的加成
  function prefBonus(P) {
    var c = prefCounts(P), out = [];
    Object.keys(c).forEach(function (p) {
      var n = c[p], pr = D.PREFS[p];
      if (!pr || n < 3) return;
      out.push({ p: p, n: n, tier: n >= 5 ? 2 : 1, b: n >= 5 ? [[pr.bonus[0][0], pr.bonus[0][1] * 1.5], pr.bonus[1]] : [pr.bonus[0]] });
    });
    return out;
  }
  function calcStats(P, s) {
    var o = baseStats();
    function add(k, v) {
      if (k === "maxHp" || k === "regen" || k === "armor" || k === "amount" || k === "steal" || k === "thorns") o[k] += v;
      else if (k === "cdr" || k === "crit") o[k] += v;
      else if (k === "critDmg") o[k] += v;
      else o[k] += v;
    }
    var d = D.DAIMYO[P.dm];
    add(d.trait[0], d.trait[1]);
    D.META.forEach(function (m) { var lv = (P.meta && P.meta[m.k]) | 0; if (lv && m.k !== "revive" && m.k !== "reroll") add(m.k, m.v * lv); });
    P.A.forEach(function (a) { var x = D.accStats(a.id, a.lv); Object.keys(x).forEach(function (k) { add(k, x[k]); }); });
    prefBonus(P).forEach(function (pb) { pb.b.forEach(function (b) { add(b[0], b[1]); }); });
    synergies(P).forEach(function (y) { (y.st || []).forEach(function (b) { add(b[0], b[1]); }); });
    var tenka = s && s.mode === "tenka" && TK;
    if (tenka) {
      TK.applyStats(P, add);
      P.tkf = TK.flags(P);
      if (P.tkf.a_ougon) o.might += Math.max(0, o.greed - 1) * 0.5;
      if (P.tkf.a_bushin) { var wl = 0; P.W.forEach(function (w) { wl += w.lv + (w.evo ? 2 : 0); }); o.might += 0.015 * wl; }
      if (P.tkf.a_ikki) o.maxHp *= 0.7;
      if (P.tkf.a_chikei) o.regen = 0;
    } else P.tkf = null;
    var buf = P.buf || {};
    if (buf.might > 0) o.might += 0.4;
    if (buf.speed > 0) o.speed += 0.35;
    if (buf.armor > 0) o.armor += 6;
    if (buf.kek > 0) o.armor += 10;
    if (buf.muso > 0) o.might += 1;
    if (buf.kaze > 0) o.speed += 0.8;
    if (buf.luck > 0) o.luck += 0.5;
    if (P.jin) { o.might += 0.08 * P.jin; o.armor += P.jin; }
    o.cdr = Math.min(0.6, o.cdr);
    o.amount = Math.floor(o.amount + 1e-6);
    P.st = o;
    var oldMax = P.mhp;
    P.mhp = Math.round(o.maxHp);
    if (oldMax && P.mhp > oldMax) P.hp += P.mhp - oldMax;
    P.hp = Math.min(P.hp, P.mhp);
    return o;
  }
  // 武器的實際數值
  function wParams(P, w) {
    var W = D.WEAPONS[w.id], a = D.ARCHES[W.a], v = D.VARIANTS[W.v], m = v.m, st = P.st || baseStats();
    var p = { dmg: a.b.dmg, cd: a.b.cd, area: a.b.area || 1, n: a.b.n || 1, spd: a.b.spd || 10, pierce: a.b.pierce || 0, dur: a.b.dur || 1, knock: 1, crit: 0, gold: 0, st: v.st || null, kind: a.kind, vis: a.k };
    if (m.dmg) p.dmg *= m.dmg;
    if (m.cd) p.cd *= m.cd;
    if (m.area) p.area *= m.area;
    if (m.n) p.n += m.n;
    if (m.spd) p.spd *= m.spd;
    if (m.pierce) p.pierce += m.pierce;
    if (m.dur) p.dur *= m.dur;
    if (m.knock) p.knock *= m.knock;
    if (m.crit) p.crit += m.crit;
    if (m.gold) p.gold = 1;
    for (var l = 2; l <= w.lv; l++) {
      var g = D.WLV[l];
      if (g.n) p.n += g.n;
      if (g.dmg) p.dmg *= 1 + g.dmg;
      if (g.area) p.area *= 1 + g.area;
      if (g.cd) p.cd *= 1 + g.cd;
    }
    if (w.evo) { p.dmg *= 1.7; p.n += 1; p.area *= 1.2; p.cd *= 0.85; p.pierce += 2; }
    // 秘傳
    p.mods = weaponMods(P, w);
    p.mods.forEach(function (m) {
      if (m === "kyodai") { p.area *= 1.5; p.dmg *= 1.1; p.cd *= 1.15; }
      else if (m === "shippu") { p.cd *= 0.72; p.dmg *= 0.85; }
      else if (m === "kantsu") { p.pierce += 3; p.spd *= 1.2; }
      else if (D.MOD_ST[m]) { if (!p.st) p.st = D.MOD_ST[m]; else if (p.st !== D.MOD_ST[m]) p.st2 = D.MOD_ST[m]; }
    });
    // 單發型（太刀、長槍、薙刀、鎖鎌、法螺貝、陣太鼓、破魔矢、騎馬）的「數量」限制在 3 以內，多的轉成傷害
    var capN = { slash: 3, thrust: 3, spin: 2, whip: 2, wave: 2, pulse: 2, beam: 3, charge: 3, aura: 1, flame: 2, zone: 4, trail: 2 }[p.kind];
    p.n += st.amount;
    if (capN && p.n > capN) { p.dmg *= 1 + 0.15 * (p.n - capN); p.n = capN; }
    p.dmg *= st.might * (1 + comboBonus(P));
    p.area *= st.area;
    p.cd *= Math.max(0.25, 1 - st.cdr);
    p.dur *= st.dur;
    p.spd *= st.pspd;
    p.knock *= st.knock;
    return p;
  }

  // 連斬加成：每 50 連斬 +5%（最多 +30%），攻擊與拾取的錢都套用
  function comboBonus(P) { return Math.min(P.tkf && P.tkf.renzan ? 0.6 : 0.3, Math.floor((P.cb || 0) / 50) * 0.05); }

  // ---------------- 升級三選一 ----------------
  function makeOpts(s, P) {
    var out = [], used = {};
    var nOpt = P.st && P.st.luck >= 1.3 ? 4 : 3;
    var wUp = P.W.map(function (w, i) { return w.lv < D.MAX_WLV ? { t: "wu", i: i, id: w.id } : null; }).filter(Boolean);
    var aUp = P.A.map(function (a, i) { return a.lv < D.MAX_ALV ? { t: "au", i: i, id: a.id } : null; }).filter(Boolean);
    var tries = 0;
    while (out.length < nOpt && tries++ < 60) {
      var r = rnd(s), o = null;
      var mUp = P.W.map(function (w, i) { return w.lv >= 3 && (w.mods || []).length < D.MAX_MOD ? i : -1; }).filter(function (i) { return i >= 0; });
      if (r < 0.34 && wUp.length) o = pick(s, wUp);
      else if (r < 0.46 && mUp.length) {
        var wi = pick(s, mUp), ww = P.W[wi], kind = D.WEAPONS[ww.id].kind, have = weaponMods(P, ww);
        var cands = Object.keys(D.MODS).filter(function (m) { return have.indexOf(m) < 0 && !(P.ban && P.ban["m" + m]) && (!D.MODS[m].proj || D.PROJ_KINDS[kind]) && (!D.MODS[m].straight || D.STRAIGHT_KINDS[kind]); });
        if (cands.length) o = { t: "m", i: wi, id: ww.id, m: pick(s, cands) };
      }
      else if (r < 0.62 && aUp.length) o = pick(s, aUp);
      else if (r < 0.82 && P.W.length < D.MAX_W) {
        // 新武器：先抽攻擊方式（避免重複），藩隨機；有地緣的話偏向同縣
        var ownedA = {}; P.W.forEach(function (w) { ownedA[D.WEAPONS[w.id].a] = 1; });
        var ai = rint(s, D.ARCHES.length);
        // 天下布武：35% 偏向已持有的流派（方便湊流派共鳴）
        if (s.mode === "tenka" && TK && rnd(s) < 0.35) {
          var sc = TK.schoolCounts(P), sks = Object.keys(sc);
          if (sks.length) {
            var pool = TK.SCHOOL[pick(s, sks)].arches.map(function (k) { for (var q = 0; q < D.ARCHES.length; q++) if (D.ARCHES[q].k === k) return q; return -1; }).filter(function (q) { return q >= 0 && !ownedA[q]; });
            if (pool.length) ai = pick(s, pool);
          }
        }
        if (ownedA[ai] || (P.ban && P.ban["a" + ai])) continue;
        var pc = prefCounts(P), vi = rint(s, D.VARIANTS.length);
        if (rnd(s) < 0.35) {
          var best = Object.keys(pc).sort(function (a, b) { return pc[b] - pc[a]; })[0];
          var cand = D.VARIANTS.map(function (v, i) { return v.pref === best ? i : -1; }).filter(function (i) { return i >= 0; });
          if (cand.length) vi = pick(s, cand);
        }
        o = { t: "w", id: ai * 10 + vi };
      } else if (P.A.length < D.MAX_A) {
        var ownedS = {}; P.A.forEach(function (a) { ownedS[D.ACCS[a.id].s] = 1; });
        var acc = wpick(s, D.ACCS, function (a) { return (P.ban && P.ban["s" + a.s] ? 0 : 1) * (ownedS[a.s] ? 0.2 : 1) * (a.r === 3 ? 0.35 * (P.st ? P.st.luck : 1) : a.r === 2 ? 0.8 : 1.4); });
        o = { t: "a", id: acc.id };
      }
      if (!o) continue;
      var key = o.t + ":" + (o.i !== undefined ? o.i : o.id) + (o.m ? ":" + o.m : "");
      if (used[key]) continue;
      used[key] = 1;
      out.push(o);
    }
    if (!out.length) out.push({ t: "heal" }, { t: "gold" });
    return out;
  }
  function applyOpt(s, P, o) {
    if (!o) return;
    if (o.t === "wu" && P.W[o.i]) P.W[o.i].lv = Math.min(D.MAX_WLV, P.W[o.i].lv + 1);
    else if (o.t === "au" && P.A[o.i]) P.A[o.i].lv = Math.min(D.MAX_ALV, P.A[o.i].lv + 1);
    else if (o.t === "w" && P.W.length < D.MAX_W) P.W.push(newW(o.id));
    else if (o.t === "a" && P.A.length < D.MAX_A) P.A.push({ id: o.id, lv: 1 });
    else if (o.t === "m" && P.W[o.i] && D.MODS[o.m]) { var ws = P.W[o.i]; ws.mods = ws.mods || []; if (ws.mods.length < D.MAX_MOD && ws.mods.indexOf(o.m) < 0) ws.mods.push(o.m); }
    else if (o.t === "heal") P.hp = Math.min(P.mhp, P.hp + 30);
    else if (o.t === "gold") P.gold += 25;
    calcStats(P, s);
  }
  function canEvolve(P, w) {
    if (w.evo || w.lv < D.MAX_WLV) return false;
    var need = D.ARCHES[D.WEAPONS[w.id].a].evo;
    return P.A.some(function (a) { return D.STATS[D.ACCS[a.id].s].k === need; });
  }
  // 寶箱：能進化就進化；不然隨機升級 1〜3 件
  function openChest(s, P, big) {
    var res = [];
    var ev = P.W.filter(function (w) { return canEvolve(P, w); });
    if (ev.length) {
      var w = ev[0];
      w.evo = 1;
      res.push({ t: "evo", id: w.id });
    }
    var n = (big ? 3 : 1 + (rnd(s) < 0.3 * P.st.luck ? 1 : 0)) + (P.tkf && P.tkf.a_tenun ? 1 : 0);
    for (var i = 0; i < n; i++) {
      var ups = [];
      P.W.forEach(function (w2, j) { if (w2.lv < D.MAX_WLV) ups.push({ t: "wu", i: j, id: w2.id }); });
      P.A.forEach(function (a, j) { if (a.lv < D.MAX_ALV) ups.push({ t: "au", i: j, id: a.id }); });
      if (!ups.length) { P.gold += 60; res.push({ t: "gold" }); continue; }
      var u = pick(s, ups);
      applyOpt(s, P, u);
      res.push(u);
    }
    var g = Math.round((40 + rint(s, 60)) * P.st.greed);
    P.gold += g;
    P.chestN++;
    calcStats(P, s);
    msg(s, "chest", P.pid, res, g);
    addFx(s, "chest", P.x, P.z, 0, 2, P.pid);
  }

  // ---------------- 特效事件（畫面用）----------------
  function addFx(s, k, x, z, a, r, o, c) {
    s.fx.push({ id: nid(s), k: k, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, a: Math.round((a || 0) * 100) / 100, r: Math.round((r || 1) * 10) / 10, o: o || "", c: c || 0, t: s.t });
  }

  // ---------------- 空間格子（敵人查詢）----------------
  var grid = null, gridT = -1;
  function buildGrid(s) {
    grid = {};
    for (var i = 0; i < s.E.length; i++) {
      var e = s.E[i];
      var k = (Math.floor(e.x / 3) + 100) * 1000 + Math.floor(e.z / 3) + 100;
      (grid[k] || (grid[k] = [])).push(e);
    }
    gridT = s.t;
  }
  function near(s, x, z, r, fn) {
    var x0 = Math.floor((x - r) / 3), x1 = Math.floor((x + r) / 3), z0 = Math.floor((z - r) / 3), z1 = Math.floor((z + r) / 3), r2 = r * r;
    for (var gx = x0; gx <= x1; gx++) for (var gz = z0; gz <= z1; gz++) {
      var c = grid[(gx + 100) * 1000 + gz + 100];
      if (!c) continue;
      for (var i = 0; i < c.length; i++) {
        var e = c[i];
        if (e.hp <= 0) continue;
        var rr = r + e.r;
        if (dist2(x, z, e.x, e.z) <= rr * rr) fn(e);
      }
    }
    return r2;
  }
  function nearest(s, x, z, maxR, skip) {
    var best = null, bd = maxR * maxR;
    for (var i = 0; i < s.E.length; i++) {
      var e = s.E[i];
      if (e.hp <= 0 || (skip && skip[e.id])) continue;
      var d = dist2(x, z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------------- 傷害 ----------------
  // 元素反應：凍結＋灼燒＝蒸氣爆發、麻痺＋凍結＝凍雷（長暈）、毒＋灼燒＝毒炎（擴散）
  function hitEnemy(s, P, e, dmg, p, kx, kz) {
    if (e.hp <= 0) return;
    var st = P ? P.st : baseStats();
    var crit = rnd(s) < st.crit + (p && p.crit || 0);
    if (crit) dmg *= st.critDmg;
    if (hasMod(p, "shokei") && e.hp < e.mhp * 0.3) dmg *= 2;
    if (P && P.tkf) dmg *= tenkaDmgMul(s, P, e, p);
    var armor = (e.armor || 0);
    dmg = Math.max(1, dmg - armor);
    if (e.boss && e.shieldT > 0) dmg *= 0.3;
    e.hp -= dmg;
    e.hf = 0.12;
    if (P) P.dmg += dmg;
    if (crit && dmg > 30) addFx(s, "crit", e.x, e.z, 0, Math.round(dmg), P ? P.pid : "");
    if (p && p.st) applyStatus(s, P, e, p.st, dmg);
    if (p && p.st2) applyStatus(s, P, e, p.st2, dmg);
    // 秘傳的連帶效果（附帶傷害不再觸發秘傳，避免連鎖無限）
    if (p && p.mods) {
      var sub = { knock: 0.5, crit: 0, st: p.st };
      if (hasMod(p, "bakuretsu") && rnd(s) < 0.25) {
        var bx = e.x, bz = e.z;
        addFx(s, "boom", bx, bz, 0, 1.6, P ? P.pid : "", 0);
        near(s, bx, bz, 1.6, function (o) { if (o !== e) hitEnemy(s, P, o, dmg * 0.5, sub); });
      }
      if (hasMod(p, "rensa") && rnd(s) < 0.3) {
        var nc = 0, cx = e.x, cz = e.z;
        near(s, cx, cz, 4, function (o) { if (o !== e && nc < 2 && o.hp > 0) { nc++; hitEnemy(s, P, o, dmg * 0.5, { knock: 0, crit: 0, st: "shock" }); addFx(s, "chain", cx, cz, Math.atan2(o.z - cz, o.x - cx), Math.sqrt(dist2(cx, cz, o.x, o.z)), P ? P.pid : ""); } });
      }
      if (hasMod(p, "kyukon") && e.hp <= 0 && P) P.hp = Math.min(P.mhp, P.hp + 1);
    }
    if (kx !== undefined && !e.boss) {
      var kn = 0.35 * (p ? p.knock : 1) / (e.r * 1.6);
      e.kx = (e.kx || 0) + kx * kn; e.kz = (e.kz || 0) + kz * kn;
    }
    if (st.steal && e.hp <= 0 && P) P.hp = Math.min(P.mhp, P.hp + st.steal * 8);
    if (P && P.tkf && !(p && p.tkSub)) tenkaOnHit(s, P, e, dmg, p, crit);
    if (e.hp <= 0) killEnemy(s, P, e, p);
  }
  function applyStatus(s, P, e, k, dmg) {
    var el = P ? P.st.elem : 1;
    var S = e.sts || (e.sts = {});
    if (k === "chill" && S.burn > 0 || k === "burn" && S.chill > 0) {
      S.chill = 0; S.burn = 0;
      addFx(s, "steam", e.x, e.z, 0, 2.2, P ? P.pid : "");
      near(s, e.x, e.z, 2.2, function (o) { if (o !== e) hitEnemy(s, P, o, dmg * 1.2 * el, null); });
      return;
    }
    if (k === "shock" && S.chill > 0 || k === "chill" && S.shock > 0) {
      S.chill = 0; S.shock = 0; e.stun = Math.max(e.stun || 0, 1.5 * el);
      addFx(s, "frostbolt", e.x, e.z, 0, 1, P ? P.pid : "");
      return;
    }
    if (k === "poison" && S.burn > 0 || k === "burn" && S.poison > 0) {
      addFx(s, "venom", e.x, e.z, 0, 2.5, P ? P.pid : "");
      var n = 0;
      near(s, e.x, e.z, 2.5, function (o) { if (o !== e && n++ < 5) { var So = o.sts || (o.sts = {}); So.poison = 3; o.pd = Math.max(o.pd || 0, dmg * 0.25 * el); } });
      S.burn = 0;
    }
    if (k === "chill") S.chill = 2 * el;
    else if (k === "shock") { S.shock = 2; if (rnd(s) < 0.2 * el * (s.wx && (s.wx.k === "rain" || s.wx.k === "storm") ? 2 : 1)) e.stun = Math.max(e.stun || 0, 0.5); }
    else if (k === "poison") { S.poison = 3 * el; e.pd = Math.max(e.pd || 0, dmg * 0.22 * el); }
    else if (k === "burn") { S.burn = 2 * el; e.bd = Math.max(e.bd || 0, dmg * 0.3 * el * (s.wx && s.wx.k === "rain" ? 0.5 : 1)); }
    e.dp = P ? P.pid : e.dp;
  }
  function killEnemy(s, P, e, p) {
    e.hp = 0;
    s.kills++;
    if (P) {
      P.kills++; P.ult = Math.min(100, P.ult + (e.boss ? 25 : e.el ? 4 : 0.9) * (P.tkf && P.tkf.s_gunryaku ? 1.5 : 1));
      P.cb = (P.cb || 0) + 1; P.cbT = 3; if (P.cb > (P.cbMax || 0)) P.cbMax = P.cb;
      if (P.cb % 100 === 0) msg(s, "combo", P.pid, P.cb);
    }
    var def = D.ENEMIES[e.k] || {};
    var sx = e.xp * (e.el ? 6 : 1);
    dropGem(s, e.x, e.z, sx);
    var luck = P ? P.st.luck : 1;
    var stg = D.STAGES[s.stage];
    var goldMul = stg.feat === "gold" ? 2 : 1;
    if ((def.f && def.f.gold) || (p && p.gold && rnd(s) < 0.25)) for (var g = 0; g < (def.f && def.f.gold ? 5 : 1); g++) dropItem(s, "coin", e.x + (rnd(s) - 0.5) * 2, e.z + (rnd(s) - 0.5) * 2, { v: 3 * goldMul });
    else if (rnd(s) < 0.012 * luck * goldMul) dropItem(s, "coin", e.x, e.z, { v: 5 * goldMul });
    if (e.bty) {
      dropItem(s, "chest", e.x, e.z, { big: 1 });
      for (var bc = 0; bc < 12; bc++) dropItem(s, "coin", e.x + (rnd(s) - 0.5) * 3, e.z + (rnd(s) - 0.5) * 3, { v: 8 });
      msg(s, "btykill", P ? P.pid : "", e.k);
    } else if (e.el) {
      if (rnd(s) < 0.5) dropItem(s, "chest", e.x, e.z, {});
      else dropFood(s, e.x, e.z);
    } else if (rnd(s) < 0.004 * luck) dropFood(s, e.x, e.z);
    if (s.mode === "tenka") tenkaOnKill(s, P, e);
    if (def.f && def.f.split && !e.small) {
      for (var i = 0; i < 2; i++) {
        var c = spawnEnemy(s, e.k, e.x + (i ? 0.6 : -0.6), e.z, 0.45);
        if (c) c.small = 1;
      }
    }
    if (e.boss) {
      addFx(s, "bossdie", e.x, e.z, 0, 4, P ? P.pid : "");
      if (e.fin) {
        s.ph = "won";
        msg(s, "won", P ? P.pid : "", e.bn);
      } else {
        dropItem(s, "chest", e.x, e.z, { big: 1 });
        for (var j = 0; j < 4; j++) dropFood(s, e.x + (rnd(s) - 0.5) * 4, e.z + (rnd(s) - 0.5) * 4);
        msg(s, "midkill", P ? P.pid : "", e.bn);
      }
    } else if (s.fx.length < 260) addFx(s, "die", e.x, e.z, 0, e.r * (e.s || 1), "", e.k === "onibi" || e.k === "kasha" ? 1 : 0);
  }
  function dropGem(s, x, z, v) {
    if (s.G.length >= MAX_G) {   // 太多就併進最近的一顆
      var g0 = s.G[rint(s, s.G.length)];
      g0.v += v;
      return;
    }
    s.G.push({ id: nid(s), x: x + (rnd(s) - 0.5) * 0.6, z: z + (rnd(s) - 0.5) * 0.6, v: v, m: "" });
  }
  function dropItem(s, k, x, z, o) {
    var d = { id: nid(s), k: k, x: clamp(x, -AR + 1, AR - 1), z: clamp(z, -AR + 1, AR - 1), m: "" };
    Object.keys(o || {}).forEach(function (kk) { d[kk] = o[kk]; });
    d.t0 = s.t;
    // 地上道具太多：先清掉最舊的錢／料理（寶箱、燈籠保留）
    if (s.D.length > 90) {
      for (var i = 0; i < s.D.length; i++) if (s.D[i].k === "coin" || s.D[i].k === "food") { s.D.splice(i, 1); break; }
    }
    s.D.push(d);
    return d;
  }
  function dropFood(s, x, z) {
    var f = wpick(s, D.FOODS.map(function (f, i) { return i; }), function (i) { return D.FOODS[i].w; });
    return dropItem(s, "food", x, z, { f: f });
  }

  // ---------------- 出怪 ----------------
  function scaleF(s) { return clamp(s.t / s.dur, 0, 1.25); }
  function spawnEnemy(s, k, x, z, scl) {
    if (s.E.length >= MAX_E + 20) return null;
    var def = D.ENEMIES[k];
    if (!def) return null;
    var n = Math.max(1, Object.keys(s.P).length), f = scaleF(s), dif = D.DIFFS[s.diff];
    var hm = s.mode === "tenka" && TK ? TK.heatMul(s.heat | 0) : null;
    var hpm = (1 + 3.2 * Math.pow(f, 1.4) + s.stage * 0.13 * Math.min(1, 0.25 + f)) * (1 + 0.4 * (n - 1)) * dif.hp * (scl || 1) * (hm ? hm.hp : 1);
    var e = {
      id: nid(s), k: k, m: def.m, x: clamp(x, -AR, AR), z: clamp(z, -AR, AR), hp: def.hp * hpm, mhp: def.hp * hpm, spd: def.spd * (0.92 + rnd(s) * 0.16),
      dmg: def.dmg * dif.dmg * (1 + f * 0.8 + s.stage * 0.08) * (hm ? hm.dmg : 1), xp: def.xp * (1 + s.stage * 0.08), r: def.r * (scl && scl < 1 ? 0.7 : 1), s: scl && scl < 1 ? 0.7 : 1,
      armor: (def.f && def.f.armor || 0) + (D.STAGES[s.stage].feat === "iron" ? 2 : 0), fly: def.f && def.f.fly ? 1 : 0, cd: 1 + rnd(s) * 2, a: 0
    };
    if (D.STAGES[s.stage].feat === "gold") e.spd *= 1.08;
    if (s.wx && s.wx.k === "fog") e.spd *= 1.1;
    s.E.push(e);
    return e;
  }
  function spawnAround(s, k, P, el) {
    var ang = rnd(s) * Math.PI * 2, r = 17 + rnd(s) * 5;
    var e = spawnEnemy(s, k, P.x + Math.cos(ang) * r, P.z + Math.sin(ang) * r);
    if (e && el) { e.el = 1; e.hp *= 6; e.mhp *= 6; e.s = 1.45; e.r *= 1.4; e.dmg *= 1.4; if (s.mode === "tenka") tenkaAffix(s, e); }
    return e;
  }
  function roster(s) {
    var st = D.STAGES[s.stage], tt = s.t * 900 / s.dur, list = st.roster[0][1];
    st.roster.forEach(function (r) { if (tt >= r[0]) list = r[1]; });
    return list;
  }
  function spawnBoss(s, key, fin) {
    var B = D.BOSSES[key];
    var ps = alive(s);
    var P = ps[0] || players(s)[0];
    if (!P) return;
    var n = Math.max(1, Object.keys(s.P).length), dif = D.DIFFS[s.diff];
    var hpm = (fin ? (1 + s.stage * 0.2) * 2 : 1 + s.stage * 0.25 + scaleF(s) * 1.5) * (1 + 0.65 * (n - 1)) * dif.hp * (s.dur < 900 ? 0.5 : 1);
    var ang = rnd(s) * Math.PI * 2;
    var e = {
      id: nid(s), k: key, m: B.m, boss: 1, fin: fin ? 1 : 0, bn: B.name, x: clamp(P.x + Math.cos(ang) * 14, -AR, AR), z: clamp(P.z + Math.sin(ang) * 14, -AR, AR),
      hp: B.hp * hpm, mhp: B.hp * hpm, spd: B.spd, dmg: B.dmg * dif.dmg, xp: fin ? 0 : 60, r: 0.5 * B.s + 0.4, s: B.s, armor: 0, cd: 3, pi: 0, a: 0, act: null
    };
    s.E.push(e);
    if (fin) { s.boss = e.id; s.bossName = B.name; }
    addFx(s, "bossin", e.x, e.z, 0, 4, "");
    msg(s, fin ? "boss" : "mid", "", B.name);
    return e;
  }
  function spawning(s, dt) {
    var ps = alive(s);
    if (!ps.length) return;
    var st = D.STAGES[s.stage], f = scaleF(s), dif = D.DIFFS[s.diff], n = Object.keys(s.P).length;
    // 中首領（1/3、2/3）與魔王（時間到）
    [1 / 3, 2 / 3].forEach(function (fr, i) {
      if (!s.mids[i] && s.t >= s.dur * fr) { s.mids[i] = 1; spawnBoss(s, st.mid[i], false); }
    });
    if (!s.boss && s.t >= s.dur) spawnBoss(s, st.boss, true);
    var rate = (0.7 + 8 * Math.pow(Math.min(f, 1), 1.2) + s.stage * 0.25 * f) * (1 + 0.45 * (n - 1)) * dif.rate;
    if (s.boss) rate *= 0.45;
    if (s.freeze > 0) rate *= 0.3;
    if (s.mode === "tenka" && TK) { rate *= TK.heatMul(s.heat | 0).rate; if (ps.some(function (q) { return q.tkf && q.tkf.a_hyakki; })) rate *= 1.35; }
    s.spawnAcc += rate * dt;
    var list = roster(s);
    while (s.spawnAcc >= 1) {
      s.spawnAcc -= 1;
      if (s.E.length >= MAX_E) { s.spawnAcc = 0; break; }
      var P = pick(s, ps);
      // 遠野：河童偏好從河邊冒出
      if (st.feat === "river" && s.rivers.length && rnd(s) < 0.3) {
        var rv = pick(s, s.rivers), off = (rnd(s) - 0.5) * 30;
        spawnEnemy(s, "kappa", rv.x + Math.cos(rv.a) * off, rv.z + Math.sin(rv.a) * off);
        continue;
      }
      spawnAround(s, pick(s, list), P, rnd(s) < 0.025 + f * 0.02);
    }
  }

  // ---------------- 關卡特色 ----------------
  function warn(s, k, x, z, r, delay, dmg, extra) {
    var w = { id: nid(s), k: k, x: clamp(x, -AR, AR), z: clamp(z, -AR, AR), r: r, t: delay, T: delay, dmg: dmg * D.DIFFS[s.diff].dmg * (1 + scaleF(s) * 0.6) };
    Object.keys(extra || {}).forEach(function (kk) { w[kk] = extra[kk]; });
    s.W.push(w);
    return w;
  }
  function stageFeature(s, dt) {
    var fe = s.fe, st = D.STAGES[s.stage], ps = alive(s);
    if (!ps.length) return;
    fe.next -= dt;
    if (fe.on) { fe.t -= dt; if (fe.t <= 0) { fe.on = 0; fe.wx = 0; fe.wz = 0; } }
    var P = pick(s, ps);
    var k = st.feat;
    if (k === "blizzard") {
      if (fe.next <= 0) { fe.on = 1; fe.t = 20; fe.next = 75; msg(s, "feat", "", "blizzard"); for (var i = 0; i < 12; i++) spawnAround(s, "yukinko", P); }
    } else if (k === "vents") {
      fe.acc = (fe.acc || 0) + dt * (1 + scaleF(s));
      if (fe.acc >= 2.4) { fe.acc = 0; warn(s, "vent", P.x + (rnd(s) - 0.5) * 16, P.z + (rnd(s) - 0.5) * 16, 1.9, 1.6, 16); }
    } else if (k === "iron") {
      if (fe.next <= 0) { fe.next = 38; var a = rnd(s) * 6.28; dropItem(s, "anvil", P.x + Math.cos(a) * 8, P.z + Math.sin(a) * 8, { hp: 3 }); }
    } else if (k === "darkness") {
      if (fe.next <= 0) {
        fe.on = 1; fe.t = 18; fe.next = 70; msg(s, "feat", "", "darkness");
        // 生剝鬼成列衝鋒（直線、不轉彎）
        var dir = rnd(s) * 6.28, cx = P.x - Math.cos(dir) * 20, cz = P.z - Math.sin(dir) * 20;
        for (var j = -4; j <= 4; j++) {
          var e = spawnEnemy(s, "namahage", cx - Math.sin(dir) * j * 1.6, cz + Math.cos(dir) * j * 1.6);
          if (e) { e.line = 1; e.lx = Math.cos(dir); e.lz = Math.sin(dir); e.spd = 6; e.life = 9; }
        }
      }
    } else if (k === "wind") {
      if (fe.next <= 0) { fe.on = 1; fe.t = 6; fe.next = 42; var wa = rnd(s) * 6.28; fe.wx = Math.cos(wa) * 3.2; fe.wz = Math.sin(wa) * 3.2; msg(s, "feat", "", "wind"); }
    } else if (k === "gunners") {
      if (fe.next <= 0) {
        fe.next = 48; msg(s, "feat", "", "gunners");
        var d2 = rnd(s) * 6.28;
        for (var q = -3; q <= 3; q++) spawnEnemy(s, "teppo", P.x + Math.cos(d2) * 14 - Math.sin(d2) * q * 1.4, P.z + Math.sin(d2) * 14 + Math.cos(d2) * q * 1.4);
      }
    } else if (k === "siege") {
      fe.acc = (fe.acc || 0) + dt * (1 + scaleF(s) * 0.8);
      if (fe.acc >= 3) { fe.acc = 0; warn(s, "cannon", P.x + (rnd(s) - 0.5) * 3, P.z + (rnd(s) - 0.5) * 3, 2.5, 1.8, 22); }
      if (fe.next <= 0) {
        fe.next = 60; msg(s, "feat", "", "siege");
        var d3 = rnd(s) * 6.28, bx = P.x + Math.cos(d3) * 18, bz = P.z + Math.sin(d3) * 18;
        for (var u = 0; u < 4; u++) for (var v = 0; v < 4; v++) spawnEnemy(s, u === 0 ? "yari" : "ashigaru", bx + (u - 1.5) * 1.2, bz + (v - 1.5) * 1.2);
      }
    } else if (k === "eruption") {
      fe.acc = (fe.acc || 0) + dt * (1 + scaleF(s));
      if (fe.acc >= 2) { fe.acc = 0; warn(s, "lava", P.x + (rnd(s) - 0.5) * 14, P.z + (rnd(s) - 0.5) * 14, 2, 1.6, 20, { pool: 5 }); }
    }
    // 遠野：座敷童子
    if (k === "river") {
      s.ev.warashi -= dt;
      if (s.ev.warashi <= 0) { s.ev.warashi = 55; var wa2 = rnd(s) * 6.28; dropItem(s, "warashi", P.x + Math.cos(wa2) * 9, P.z + Math.sin(wa2) * 9, { a: rnd(s) * 6.28, life: 25 }); msg(s, "feat", "", "warashi"); }
    }
    // 每關都有：祠（站在旁邊 3 秒得到隨機祝福）
    s.ev.hokora = (s.ev.hokora === undefined ? 70 : s.ev.hokora) - dt;
    if (s.ev.hokora <= 0) {
      s.ev.hokora = 100 + rnd(s) * 40;
      var ha = rnd(s) * 6.28;
      dropItem(s, "hokora", P.x + Math.cos(ha) * 11, P.z + Math.sin(ha) * 11, { p: 0, life: 45 });
      msg(s, "feat", "", "hokora");
    }
    // 每關都有：燈籠（打破掉料理或錢）
    s.ev.lantern -= dt;
    var nl = s.D.filter(function (d) { return d.k === "lantern"; }).length;
    if (s.ev.lantern <= 0) {
      s.ev.lantern = 14;
      if (nl < 8) { var la = rnd(s) * 6.28, lr = 9 + rnd(s) * 8; dropItem(s, "lantern", P.x + Math.cos(la) * lr, P.z + Math.sin(la) * lr, { hp: 1 }); }
    }
    // 突發事件（每關共通）：落武者（帶錢逃跑的精英）、一揆（大群）
    s.ev.special -= dt;
    if (s.ev.special <= 0) {
      s.ev.special = 95 + rnd(s) * 40;
      if (rnd(s) < 0.5) {
        var ga = spawnAround(s, "nobushi", P, true);
        if (ga) { ga.flee = 1; ga.k = "ochimusha"; ga.m = "nobushi"; ga.gold = 1; ga.life = 20; msg(s, "feat", "", "ochimusha"); }
      } else {
        msg(s, "feat", "", "ikki");
        var ia = rnd(s) * 6.28;
        for (var ii = 0; ii < 24; ii++) spawnEnemy(s, "ikki", P.x + Math.cos(ia + ii * 0.26) * 16, P.z + Math.sin(ia + ii * 0.26) * 16);
      }
    }
  }
  // ---------------- 天候（每關共通，約 2.5〜3.5 分鐘變一次，持續 60 秒）----------------
  // rain 雨：灼燒減半、麻痺暈眩機率加倍／fog 霧：視野縮小、敵人移動 +10%／storm 雷雨：天雷不斷劈向敵人，偶爾也劈到玩家附近（紅圈預警）
  var WX = ["rain", "fog", "storm"];
  function weather(s, dt) {
    var w = s.wx || (s.wx = { k: "clear", t: 0, next: 150 + rnd(s) * 60, acc: 0 });
    if (w.k !== "clear") {
      w.t -= dt;
      if (w.t <= 0) { w.k = "clear"; w.next = 150 + rnd(s) * 60; }
    } else {
      w.next -= dt;
      if (w.next <= 0) { w.k = pick(s, WX); w.t = 60; msg(s, "wx", "", w.k); }
    }
    if (w.k === "storm") {
      w.acc += dt;
      if (w.acc >= 1.2) {
        w.acc = 0;
        var ps = alive(s);
        if (!ps.length) return;
        var P = pick(s, ps);
        if (rnd(s) < 0.75) {
          var e = randomNear(s, P, 14);
          if (e) { near(s, e.x, e.z, 1.8, function (o) { hitEnemy(s, null, o, 25 * (1 + s.t / s.dur * 4), { st: "shock", knock: 0, crit: 0 }); }); addFx(s, "bolt", e.x, e.z, 0, 1.8, "", 2); }
        } else warn(s, "boss", P.x + (rnd(s) - 0.5) * 8, P.z + (rnd(s) - 0.5) * 8, 1.6, 1.4, 12);
      }
    }
  }
  // ---------------- 懸賞首：約每 2 分鐘把一個敵人標成懸賞，30 秒內打倒得到大寶箱與大量錢 ----------------
  function bounty(s, dt) {
    s.ev.bty = (s.ev.bty === undefined ? 90 : s.ev.bty) - dt;
    if (s.ev.bty > 0) return;
    s.ev.bty = 110 + rnd(s) * 40;
    var ps = alive(s);
    if (!ps.length) return;
    var e = spawnAround(s, pick(s, roster(s)), pick(s, ps), true);
    if (!e) return;
    e.bty = 1; e.hp *= 1.5; e.mhp *= 1.5; e.spd *= 1.15; e.life = 30; e.flee = 0;
    msg(s, "bounty", "", e.k);
  }
  // ---------------- 陣形：多人時 5 公尺內每有一名隊友，攻擊 +8%、防禦 +1（最多 3 人）----------------
  function formation(s) {
    var ps = alive(s);
    ps.forEach(function (P) {
      var n = 0;
      ps.forEach(function (o) { if (o !== P && dist2(o.x, o.z, P.x, P.z) < 25) n++; });
      n = Math.min(3, n);
      if ((P.jin || 0) !== n) { P.jin = n; calcStats(P, s); }
    });
  }
  function inRiver(s, x, z) {
    for (var i = 0; i < s.rivers.length; i++) {
      var r = s.rivers[i], dx = x - r.x, dz = z - r.z;
      var perp = Math.abs(-Math.sin(r.a) * dx + Math.cos(r.a) * dz);
      if (perp < r.w / 2) return true;
    }
    return false;
  }
  // 玩家這一刻的移動速度（單位/秒）；連線的其他玩家用快照裡的 sp 與 rivers 自己算
  function moveSpeed(s, P) {
    var sp = 4.2 * (P.st ? P.st.speed : 1);
    if (s.fe.k === "blizzard" && s.fe.on) sp *= 0.8;
    return sp;
  }
  function stepMove(view, P, mvx, mvz, dt, sp) {
    var len = Math.sqrt(mvx * mvx + mvz * mvz);
    if (len > 1) { mvx /= len; mvz /= len; len = 1; }
    var k = sp * (inRiver(view, P.x, P.z) ? 0.62 : 1);
    P.x += mvx * k * dt + (view.fe && view.fe.on ? view.fe.wx || 0 : 0) * dt;
    P.z += mvz * k * dt + (view.fe && view.fe.on ? view.fe.wz || 0 : 0) * dt;
    P.x = clamp(P.x, -AR + 0.5, AR - 0.5);
    P.z = clamp(P.z, -AR + 0.5, AR - 0.5);
    if (len > 0.1) { P.fx = mvx / len; P.fz = mvz / len; }
  }

  // ---------------- 武器發動 ----------------
  function fire(s, P, w, p) {
    var e, i, ang, k = p.kind, fxa = Math.atan2(P.fz, P.fx);
    // 近戰（斬、突、火炎）自動朝向攻擊範圍內最近的敵人（手機操作比較輕鬆）；沒有敵人就朝面向
    if (k === "slash" || k === "thrust" || k === "flame") {
      var ne = nearest(s, P.x, P.z, p.area * 1.3 + 1);
      if (ne) { fxa = Math.atan2(ne.z - P.z, ne.x - P.x); w.aim = fxa; }
    }
    if (k === "slash") {
      // 半月斬：正面，再來一刀在背面（n≥2）、第三刀左右
      // 飛斬：近身半月斬＋向前飛出的月牙刃（貫穿）；n≥2 背面、n≥3 側面再一道
      for (i = 0; i < p.n; i++) {
        var a = fxa + (i === 1 ? Math.PI : i === 2 ? Math.PI / 2 : 0);
        sector(s, P, P.x, P.z, a, p.area * 0.6, 1.25, p.dmg, p);
        addFx(s, "slash", P.x, P.z, a, p.area * 0.6, P.pid, w.evo ? 2 : 0);
        fly(s, P, p, a, "tachi", 13, p.area * 2.3, 0.75 * Math.sqrt(p.area / 2.6) + 0.3, null, { skipNear: p.area * 0.6 });
      }
    } else if (k === "thrust") {
      // 擲槍：槍頭向前高速飛出，貫穿一整排
      for (i = 0; i < p.n; i++) {
        var ta = fxa + (i - (p.n - 1) / 2) * 0.3;
        fly(s, P, p, ta, "yari", 24, p.area * 1.5, 0.7);
      }
    } else if (k === "spin") {
      near(s, P.x, P.z, p.area, function (e2) { var d = Math.sqrt(dist2(e2.x, e2.z, P.x, P.z)) || 1; hitEnemy(s, P, e2, p.dmg * (1 + 0.2 * (p.n - 1)), p, (e2.x - P.x) / d, (e2.z - P.z) / d); });
      addFx(s, "spin", P.x, P.z, fxa, p.area, P.pid, w.evo ? 2 : 0);
      // 看得見的旋轉刀刃（只做畫面，傷害在上面一次結算）
      for (i = 0; i < p.n; i++) s.S.push({ id: nid(s), k: "naginata", o: P.pid, x: P.x, z: P.z, a: fxa + i * Math.PI, life: 0.4, T: 0.4, mode: "spin", r0: p.area * 0.85, dmg: 0, hit: {}, p: {} });
    } else if (k === "whip") {
      // 鎖鎌：鎌刃往左右甩出再收回（去程、回程各打一次）
      for (i = 0; i < p.n; i++) {
        var side = i % 2 === 0 ? (P.fx >= 0 ? 0 : Math.PI) : (P.fx >= 0 ? Math.PI : 0);
        fly(s, P, p, side, "kusarigama", 16, p.area * 1.4, 0.9, "boom");
      }
    } else if (k === "arrow" || k === "gun" || k === "fan" || k === "bounce" || k === "homing" || k === "boomerang") {
      e = nearest(s, P.x, P.z, 16);
      var base = e ? Math.atan2(e.z - P.z, e.x - P.x) : fxa;
      if (k === "fan" || k === "boomerang") base = e && k === "boomerang" ? base : fxa;
      for (i = 0; i < p.n; i++) {
        var spread = k === "fan" ? (i - (p.n - 1) / 2) * 0.22 : k === "homing" ? (i - (p.n - 1) / 2) * 0.8 : (i - (p.n - 1) / 2) * 0.12;
        if ((k === "arrow" || k === "gun") && i > 0) {   // 多發時各自瞄不同的目標
          var e3 = randomNear(s, P, 14);
          if (e3) spread = Math.atan2(e3.z - P.z, e3.x - P.x) - base;
        }
        ang = base + spread;
        shoot(s, P, p, ang, k);
      }
    } else if (k === "bomb" || k === "cannon") {
      for (i = 0; i < p.n; i++) {
        e = k === "cannon" ? strongest(s, P, 20) : randomNear(s, P, 11);
        var tx = e ? e.x : P.x + P.fx * 6, tz = e ? e.z : P.z + P.fz * 6;
        s.S.push({ id: nid(s), k: p.vis, o: P.pid, w: w.id, x: P.x, z: P.z, sx: P.x, sz: P.z, tx: tx, tz: tz, life: k === "cannon" ? 0.9 : 0.7, T: k === "cannon" ? 0.9 : 0.7, mode: "lob", dmg: p.dmg, r: p.area, p: pack(p), a: 0 });
      }
    } else if (k === "orbit") {
      w.ot = p.dur;
    } else if (k === "aura") {
      near(s, P.x, P.z, p.area, function (e2) { hitEnemy(s, P, e2, p.dmg, p); });
    } else if (k === "lightning") {
      for (i = 0; i < p.n; i++) {
        e = randomNear(s, P, 13);
        if (!e) break;
        // 雷從天而降（0.25 秒後落地）
        s.S.push({ id: nid(s), k: "kaminari", o: P.pid, w: w.id, x: e.x, z: e.z, life: 0.25 + i * 0.06, T: 0.25, mode: "drop", dmg: p.dmg, r: p.area, p: pack(p), a: 0 });
      }
    } else if (k === "flame") {
      w.ft = p.dur;
    } else if (k === "icefall" || k === "rain") {
      for (i = 0; i < p.n; i++) {
        var ex = randomNear(s, P, k === "rain" ? p.area + 4 : 12);
        var px = ex ? ex.x : P.x + (rnd(s) - 0.5) * p.area * 2, pz = ex ? ex.z : P.z + (rnd(s) - 0.5) * p.area * 2;
        if (k === "rain") { px = P.x + (rnd(s) - 0.5) * p.area * 2; pz = P.z + (rnd(s) - 0.5) * p.area * 2; if (ex && i % 2 === 0) { px = ex.x; pz = ex.z; } }
        s.S.push({ id: nid(s), k: p.vis, o: P.pid, w: w.id, x: px, z: pz, life: 0.45 + i * 0.05, T: 0.45, mode: "drop", dmg: p.dmg, r: k === "rain" ? 1.1 * P.st.area : p.area, p: pack(p), a: 0 });
      }
    } else if (k === "wave" || k === "pulse") {
      for (i = 0; i < p.n; i++) {
        var R = p.area * (i ? 0.6 : 1);
        near(s, P.x, P.z, R, function (e2) {
          var d = Math.sqrt(dist2(e2.x, e2.z, P.x, P.z)) || 1;
          hitEnemy(s, P, e2, p.dmg, p, (e2.x - P.x) / d * (k === "wave" ? 3 : 0.5), (e2.z - P.z) / d * (k === "wave" ? 3 : 0.5));
          if (k === "pulse") e2.stun = Math.max(e2.stun || 0, 0.6 * P.st.elem);
        });
        addFx(s, k, P.x, P.z, 0, R, P.pid, w.evo ? 2 : 0);
      }
    } else if (k === "zone") {
      for (i = 0; i < p.n; i++) {
        e = randomNear(s, P, 10);
        var zx = e ? e.x : P.x + (rnd(s) - 0.5) * 6, zz = e ? e.z : P.z + (rnd(s) - 0.5) * 6;
        s.Z.push({ id: nid(s), k: "hata", o: P.pid, x: zx, z: zz, r: p.area, t: p.dur, tk: 0, dmg: p.dmg, p: pack(p), c: D.VARIANTS[D.WEAPONS[w.id].v].color });
      }
    } else if (k === "trail") {
      for (i = 0; i < p.n; i++) s.Z.push({ id: nid(s), k: "makibishi", o: P.pid, x: P.x - P.fx * 0.6 + (rnd(s) - 0.5) * i, z: P.z - P.fz * 0.6 + (rnd(s) - 0.5) * i, r: p.area, t: p.dur, tk: 0, dmg: p.dmg, p: pack(p) });
    } else if (k === "beam") {
      e = nearest(s, P.x, P.z, 18);
      var ba = e ? Math.atan2(e.z - P.z, e.x - P.x) : fxa;
      // 破魔矢：發光的箭貫穿畫面
      for (i = 0; i < p.n; i++) {
        var bb = ba + (i - (p.n - 1) / 2) * 0.5;
        fly(s, P, p, bb, "hamaya", 34, 20, p.area * 0.6 + 0.35);
      }
    } else if (k === "charge") {
      for (i = 0; i < p.n; i++) {
        var ca = rnd(s) * 6.28, ox = P.x - Math.cos(ca) * 14 + (-Math.sin(ca)) * (i - 1) * 2.5, oz = P.z - Math.sin(ca) * 14 + Math.cos(ca) * (i - 1) * 2.5;
        s.S.push({ id: nid(s), k: "kiba", o: P.pid, w: w.id, x: ox, z: oz, vx: Math.cos(ca) * p.spd, vz: Math.sin(ca) * p.spd, life: 28 / p.spd, mode: "proj", dmg: p.dmg, r: p.area, pierce: 999, hit: {}, p: pack(p), a: ca });
      }
    }
  }
  // 直線飛行、貫穿的投射物（飛斬、擲槍、鎖鎌、破魔矢）。mode "boom" 會飛回來
  function fly(s, P, p, ang, vis, spd, dist, r, mode, extra) {
    spd *= P.st ? P.st.pspd : 1;
    var life = dist / spd;
    var sh = { id: nid(s), k: vis, o: P.pid, x: P.x, z: P.z, vx: Math.cos(ang) * spd, vz: Math.sin(ang) * spd, spd: spd, life: mode === "boom" ? life * 2 : life, T: mode === "boom" ? life * 2 : life, mode: mode || "proj", dmg: p.dmg, r: r, pierce: 999, hit: {}, p: pack(p), a: ang };
    // 近身斬已經打過的敵人，飛斬就不再重複打
    if (extra && extra.skipNear) near(s, P.x, P.z, extra.skipNear, function (e) { sh.hit[e.id] = 1; });
    s.S.push(sh);
    return sh;
  }
  function pack(p) { return { st: p.st, st2: p.st2, knock: p.knock, crit: p.crit, gold: p.gold, pierce: p.pierce, n: p.n, area: p.area, mods: p.mods && p.mods.length ? p.mods : undefined }; }
  function hasMod(p, m) { return !!(p && p.mods && p.mods.indexOf(m) >= 0); }
  function shoot(s, P, p, ang, k) {
    var sh = { id: nid(s), k: p.vis, o: P.pid, x: P.x, z: P.z, vx: Math.cos(ang) * p.spd, vz: Math.sin(ang) * p.spd, life: k === "boomerang" ? 1.6 : k === "homing" ? 3 : 1.4, mode: k === "bounce" ? "bounce" : k === "homing" ? "homing" : k === "boomerang" ? "boom" : "proj", dmg: p.dmg, r: k === "gun" ? 0.35 : k === "boomerang" ? 0.8 * P.st.area : 0.45, pierce: p.pierce, hit: {}, p: pack(p), a: ang, spd: p.spd };
    if (k === "boomerang") sh.T = sh.life;
    s.S.push(sh);
  }
  function sector(s, P, x, z, a, R, half, dmg, p) {
    near(s, x, z, R, function (e) {
      var ea = Math.atan2(e.z - z, e.x - x), d = Math.abs(((ea - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d <= half || dist2(x, z, e.x, e.z) < 1) { var dd = Math.sqrt(dist2(e.x, e.z, x, z)) || 1; hitEnemy(s, P, e, dmg, p, (e.x - x) / dd, (e.z - z) / dd); }
    });
  }
  function line(s, P, x, z, dx, dz, len, wid, dmg, p) {
    near(s, x + dx * len / 2, z + dz * len / 2, len / 2 + wid, function (e) {
      var rx = e.x - x, rz = e.z - z, along = rx * dx + rz * dz, perp = Math.abs(-dz * rx + dx * rz);
      if (along >= -0.5 && along <= len && perp <= wid + e.r) hitEnemy(s, P, e, dmg, p, dx, dz);
    });
  }
  function randomNear(s, P, R) {
    var c = [];
    near(s, P.x, P.z, R, function (e) { c.push(e); });
    return c.length ? c[rint(s, c.length)] : null;
  }
  function strongest(s, P, R) {
    var best = null;
    near(s, P.x, P.z, R, function (e) { if (!best || e.hp > best.hp) best = e; });
    return best;
  }

  // ---------------- 采配（大招）----------------
  function useUlt(s, P) {
    if (!P || P.down || P.ult < 100) return false;
    P.ult = 0;
    // 采配強化：每發動 3 次升一階（最多 3 階），威力 +40%／階、持續 +30%／階
    var tier = ultTier(P), K = 1 + 0.3 * (tier - 1);
    P.ultN = (P.ultN || 0) + 1;
    if (ultTier(P) > tier) msg(s, "ultup", P.pid, ultTier(P));
    var u = D.DAIMYO[P.dm].ult, st = P.st, dmg = 60 * st.might * (1 + s.t / s.dur * 3) * (1 + 0.4 * (tier - 1));
    addFx(s, "ult", P.x, P.z, 0, 8, P.pid, 0);
    msg(s, "ult", P.pid, u);
    // 連攜：3 秒內另一名玩家也發動了采配 → 兩人之間爆發「連攜・天下無雙」
    var lu = s.lastUlt;
    if (lu && lu.p !== P.pid && s.t - lu.t < 3 && s.P[lu.p]) {
      var Q = s.P[lu.p], mx = (P.x + Q.x) / 2, mz = (P.z + Q.z) / 2;
      near(s, mx, mz, 16, function (e) { hitEnemy(s, P, e, dmg * 2.5 * (e.boss ? 0.6 : 1), { st: "burn", knock: 2, crit: 0 }); });
      [P, Q].forEach(function (o) { o.iv = Math.max(o.iv, 3); o.hp = Math.min(o.mhp, o.hp + o.mhp * 0.3); });
      addFx(s, "ult", mx, mz, 0, 16, P.pid, 0); addFx(s, "boom", mx, mz, 0, 8, P.pid, 1);
      msg(s, "renkei", P.pid, Q.pid);
      s.lastUlt = null;
    } else s.lastUlt = { p: P.pid, t: s.t };
    if (u === "toki") near(s, P.x, P.z, 14, function (e) { hitEnemy(s, P, e, dmg * (e.boss ? 1.5 : 1), null); });
    else if (u === "muso") { P.buf.muso = 6 * K; P.iv = Math.max(P.iv, 6 * K); }
    else if (u === "kaifuku") players(s).forEach(function (o) { if (!o.down) o.hp = Math.min(o.mhp, o.hp + o.mhp * 0.5); });
    else if (u === "engun") P.buf.engun = 8 * K;
    else if (u === "kaze") { P.buf.kaze = 8 * K; s.G.forEach(function (g) { g.m = P.pid; }); }
    else if (u === "jishin") near(s, P.x, P.z, 12, function (e) { e.stun = 4; hitEnemy(s, P, e, dmg * 0.5, null); });
    else if (u === "ougon") { for (var i = 0; i < 20; i++) { var a = i * 0.314; dropItem(s, "coin", P.x + Math.cos(a) * 3, P.z + Math.sin(a) * 3, { v: 6 }); dropGem(s, P.x + Math.cos(a) * 4, P.z + Math.sin(a) * 4, 5 + s.t / 30); } }
    else if (u === "kaen") P.buf.kaen = 8 * K;
    else if (u === "kori") s.freeze = 5 * K;
    else if (u === "tenrai") P.buf.tenrai = 6 * K;
    else if (u === "kekkai") players(s).forEach(function (o) { o.buf.kek = 10 * K; });
    else if (u === "kage") {   // 影分身：5 秒無敵＋四周射出 16 枚手裏劍
      P.iv = Math.max(P.iv, 5); P.buf.speed = 5;
      for (var k2 = 0; k2 < 16; k2++) s.S.push({ id: nid(s), k: "shuriken", o: P.pid, x: P.x, z: P.z, vx: Math.cos(k2 * 0.3927) * 15, vz: Math.sin(k2 * 0.3927) * 15, spd: 15, life: 1.4, mode: "bounce", dmg: dmg * 0.5, r: 0.5, pierce: 4, hit: {}, p: {}, a: 0 });
    } else if (u === "ikki") {   // 一騎討：對附近最強的敵人一記重擊
      var tg = strongest(s, P, 16);
      if (tg) { hitEnemy(s, P, tg, dmg * 6, null); addFx(s, "bolt", tg.x, tg.z, 0, 2.5, P.pid, 2); addFx(s, "boom", tg.x, tg.z, 0, 3, P.pid, 1); }
    }
    calcStats(P, s);
    return true;
  }
  function ultTier(P) { return Math.min(3, 1 + Math.floor((P.ultN || 0) / 3)); }
  function ultTick(s, P, dt) {
    var b = P.buf, dmg = 30 * P.st.might * (1 + s.t / s.dur * 3) * (1 + 0.4 * (ultTier(P) - 1));
    if (b.engun > 0) { P._eg = (P._eg || 0) + dt; if (P._eg > 0.25) { P._eg = 0; var px = P.x + (rnd(s) - 0.5) * 16, pz = P.z + (rnd(s) - 0.5) * 16; s.S.push({ id: nid(s), k: "yanoame", o: P.pid, x: px, z: pz, life: 0.4, T: 0.4, mode: "drop", dmg: dmg * 0.6, r: 1.6, p: {}, a: 0 }); } }
    if (b.kaen > 0) { P._kn = (P._kn || 0) + dt; if (P._kn > 0.3) { P._kn = 0; near(s, P.x, P.z, 4.5, function (e) { hitEnemy(s, P, e, dmg * 0.3, { st: "burn", knock: 1, crit: 0 }); }); } }
    if (b.tenrai > 0) { P._tr = (P._tr || 0) + dt; if (P._tr > 0.25) { P._tr = 0; var e = randomNear(s, P, 15); if (e) { near(s, e.x, e.z, 1.6, function (e2) { hitEnemy(s, P, e2, dmg, { st: "shock", knock: 1, crit: 0 }); }); addFx(s, "bolt", e.x, e.z, 0, 1.6, P.pid, 2); } } }
  }

  // ---------------- 新模式「天下布武」（s.mode === "tenka"；資料在 yukimura_tenka.js）----------------
  var MELEE = { slash: 1, thrust: 1, spin: 1, whip: 1, charge: 1 };
  var tkDepth = 0;   // 連帶效果的遞迴保護（附帶傷害不再觸發天命／符文效果）
  function tkTree(P) { return P.meta && P.meta.tk && P.meta.tk.tree || {}; }
  function tenkaInitPlayer(s, P) {
    var tree = tkTree(P);
    P.arc = []; P.ban = {}; P.kg = 0;
    P.arcQ = 1 + (s.arcT ? (s.arcT[0] ? 1 : 0) + (s.arcT[1] ? 1 : 0) : 0);
    P.bn = TK.treeSp(tree, "ban"); P.sk = TK.treeSp(tree, "skip");
    P.rr += TK.treeSp(tree, "rr"); P.rev += TK.treeSp(tree, "rev");
    if (TK.treeSp(tree, "startLv")) P.W[0].lv = 2;
    if (TK.treeSp(tree, "startW")) {
      var a0 = D.WEAPONS[P.W[0].id].a, ai = rint(s, D.ARCHES.length);
      if (ai === a0) ai = (ai + 1) % D.ARCHES.length;
      P.W.push(newW(ai * 10 + rint(s, D.VARIANTS.length)));
    }
  }
  // 天命選項（不重複已經選過的）
  function arcOpts(s, P) {
    var n = 3 + Math.min(1, TK.treeSp(tkTree(P), "arcN"));
    var pool = TK.ARCANA.filter(function (a) { return (P.arc || []).indexOf(a.k) < 0; }).map(function (a) { return a.k; });
    var out = [];
    while (out.length < n && pool.length) out.push({ t: "arc", k: pool.splice(rint(s, pool.length), 1)[0] });
    if (!out.length) { P.arcQ = 0; return null; }
    return out;
  }
  function banish(s, P, i) {
    if (!P.opts || !(P.bn > 0)) return false;
    var o = P.opts[i];
    if (!o || o.t === "arc") return false;
    var key = o.t === "w" ? "a" + D.WEAPONS[o.id].a : o.t === "a" ? "s" + D.ACCS[o.id].s : o.t === "m" ? "m" + o.m : null;
    if (!key) return false;
    P.ban = P.ban || {};
    P.ban[key] = 1; P.bn--;
    P.opts = makeOpts(s, P); P.optT = 0;
    msg(s, "ban", P.pid, o);
    return true;
  }
  function skipOpt(s, P) {
    if (!P.opts || !(P.sk > 0) || (P.opts[0] && P.opts[0].t === "arc")) return false;
    P.sk--; P.opts = null; P.pend = Math.max(0, P.pend - 1);
    P.gold += 15 * P.st.greed; P.hp = Math.min(P.mhp, P.hp + 15); P.iv = Math.max(P.iv, 1);
    return true;
  }
  function awardKg(s, n, show) {
    players(s).forEach(function (Q) { Q.kg = (Q.kg || 0) + n * (Q.tkf && Q.tkf.a_hyakki ? 1.3 : 1); });
    if (show) msg(s, "kg", "", n);
  }
  function tenkaDmgMul(s, P, e, p) {
    var f = P.tkf, m = 1, hpf = clamp(P.hp / (P.mhp || 1), 0, 1);
    if (f.a_kajiba) m *= 1 + 0.8 * (1 - hpf);
    if (f.haisui && hpf < 0.4) m *= 1.35;
    if (P._still) { if (f.a_fudo) m *= 1.4; if (f.fudo) m *= 1.15; } else if (f.a_fuurin) m *= 1.15;
    var S = e.sts;
    if (S) {
      if (f.a_hyogoku && S.chill > 0) m *= 1.3;
      if (f.s_tenko && (S.chill > 0 || S.burn > 0 || S.poison > 0 || S.shock > 0)) m *= 1.25;
    }
    // 劍豪滿階：近戰命中 20% 追加一道斬擊（直接算進這一擊）
    if (f.s_ken && p && MELEE[p.kind] && !tkDepth && rnd(s) < 0.2) { m *= 1.5; if (s.fx.length < 260) addFx(s, "slash", e.x, e.z, rnd(s) * 6.28, 1.2, P.pid); }
    return m;
  }
  function tenkaOnHit(s, P, e, dmg, p, crit) {
    if (tkDepth) return;
    var f = P.tkf, sub = { tkSub: 1, knock: 0, crit: 0 };
    tkDepth++;
    if (e.hp > 0) {
      if (f.doku && rnd(s) < 0.15) applyStatus(s, P, e, "poison", dmg);
      if (f.honoo && rnd(s) < 0.15) applyStatus(s, P, e, "burn", dmg);
      if (f.a_hyogoku && rnd(s) < 0.25) applyStatus(s, P, e, "chill", dmg);
      if (f.a_ruten && rnd(s) < 0.15) applyStatus(s, P, e, pick(s, ["chill", "burn", "poison", "shock"]), dmg);
    }
    if (f.rai && crit && rnd(s) < 0.25) {
      var ex = e.x, ez = e.z;
      addFx(s, "bolt", ex, ez, 0, 1.4, P.pid, 2);
      near(s, ex, ez, 1.4, function (o) { if (o !== e && o.hp > 0) hitEnemy(s, P, o, dmg * 0.6, sub); });
    }
    tkDepth--;
  }
  function tenkaOnKill(s, P, e) {
    if (e.el) {
      questProgress(s, "elite", 1);
      if (rnd(s) < 0.3) awardKg(s, 1, false);
      var eb = P ? TK.treeSp(tkTree(P), "elite") : 0;
      if (eb && rnd(s) < 0.1 * eb) dropItem(s, "chest", e.x + 0.8, e.z, {});
      if (e.af === "split") for (var i = 0; i < 3; i++) { var c = spawnEnemy(s, e.k, e.x + Math.cos(i * 2.1) * 0.8, e.z + Math.sin(i * 2.1) * 0.8, 0.6); if (c) c.small = 1; }
      if (e.af === "blast") warn(s, "blast", e.x, e.z, 2.6, 0.9, e.dmg * 1.2);
    }
    if (e.bty) awardKg(s, 5, true);
    if (e.boss) awardKg(s, e.fin ? 20 : 8, true);
    questProgress(s, "kill", 1);
    if (!P || !P.tkf) return;
    if (P.tkf.a_bakuen && !e.boss && !tkDepth && rnd(s) < 0.3) {
      tkDepth++;
      var bd = 10 * P.st.might * (1 + s.t / s.dur * 2) + e.mhp * 0.15, bx = e.x, bz = e.z;
      if (s.fx.length < 260) addFx(s, "boom", bx, bz, 0, 2.2, P.pid, 1);
      near(s, bx, bz, 2.2, function (o) { if (o !== e && o.hp > 0) hitEnemy(s, P, o, bd * (o.boss ? 0.3 : 1), { tkSub: 1, knock: 1, crit: 0, st: "burn" }); });
      tkDepth--;
    }
    if (P.tkf.kyuu) { P._kq = (P._kq || 0) + 1; if (P._kq >= 40) { P._kq = 0; P.hp = Math.min(P.mhp, P.hp + 6); } }
    if (P.tkf.s_nin && rnd(s) < 0.1 && P.W.length) pick(s, P.W).cd = 0;
  }
  function tenkaAffix(s, e) {
    var a = pick(s, TK.AFFIX).k;
    e.af = a;
    if (a === "swift") e.spd *= 1.45;
    else if (a === "iron") { e.armor += 5; e.hp *= 1.3; e.mhp *= 1.3; }
  }
  // 軍令：約每 90〜130 秒一道，限時完成得到軍功與寶箱
  function sumGold(s) { var g = 0; players(s).forEach(function (P) { g += P.gold; }); return g / Math.max(1, players(s).length); }
  function questProgress(s, k, n) { if (s.q && s.q.k === k) s.q.h += n; }
  function questEnd(s, ok) {
    var q = s.q;
    s.q = null;
    s.qNext = s.t + 90 + rnd(s) * 40;
    if (q.k === "rescue") s.D = s.D.filter(function (d) { return d.id !== q.did; });
    if (!ok) { msg(s, "qng", "", q.k, q.img); return; }
    s.qN++;
    var base = (6 + s.stage) * (q.k === "rescue" ? 1.5 : 1);
    if (q.k === "rescue") {   // 救出村姑：全隊回復 30%，記進救出名單
      s.saved = s.saved || [];
      s.saved.push(q.img);
      players(s).forEach(function (P) { if (!P.down) P.hp = Math.min(P.mhp, P.hp + P.mhp * 0.3); });
      msg(s, "rescued", "", q.img);
      addFx(s, "revive", q.x, q.z, 0, 2.5, "");
    }
    players(s).forEach(function (P) {
      var r = base * (1 + 0.3 * TK.treeSp(tkTree(P), "quest"));
      P.kg = (P.kg || 0) + r * (P.tkf && P.tkf.a_hyakki ? 1.3 : 1);
      if (!P.down) dropItem(s, "chest", P.x + 1.2, P.z, {});
    });
    msg(s, "qok", "", q.k, base);
  }
  // 救出令：在某位玩家 22〜28 公尺外放一位村姑，周圍一圈敵人
  function startRescue(s, q) {
    var ps = alive(s), P = ps.length ? pick(s, ps) : players(s)[0];
    var a = rnd(s) * Math.PI * 2, r = 22 + rnd(s) * 6;
    var x = clamp(P.x + Math.cos(a) * r, -AR + 4, AR - 4), z = clamp(P.z + Math.sin(a) * r, -AR + 4, AR - 4);
    q.img = rint(s, TK.MUSUME_N); q.hp = 100; q.x = x; q.z = z;
    var g = dropItem(s, "musume", x, z, { p: 0, hp: 100, img: q.img, a: rnd(s) * 6.28 });
    q.did = g.id;
    var list = roster(s);
    for (var i = 0; i < 9; i++) { var b = i * 0.698; spawnEnemy(s, pick(s, list), x + Math.cos(b) * 4.5, z + Math.sin(b) * 4.5); }
  }
  function questTick(s, dt) {
    var q = s.q;
    if (q) {
      q.T -= dt;
      if (q.k === "nohit") {
        if (players(s).some(function (P) { return P._hitT !== undefined && P._hitT > q.t0; })) { questEnd(s, false); return; }
        q.h = Math.min(q.n, s.t - q.t0);
        if (q.T <= 0) questEnd(s, true);
        return;
      }
      if (q.k === "rescue") {
        var g = null;
        for (var gi = 0; gi < s.D.length; gi++) if (s.D[gi].id === q.did) g = s.D[gi];
        if (!g) { questEnd(s, false); return; }
        var ps = alive(s), near2 = ps.some(function (P) { return dist2(P.x, P.z, g.x, g.z) < 2.4 * 2.4; });
        g.p = near2 ? g.p + dt : Math.max(0, g.p - dt * 0.5);
        // 貼在她身邊的敵人會傷害她
        var foes = 0;
        for (var ei = 0; ei < s.E.length && foes < 6; ei++) { var en = s.E[ei]; if (en.hp > 0 && dist2(en.x, en.z, g.x, g.z) < 2.2 * 2.2) foes++; }
        g.hp -= foes * 2.2 * dt;
        q.h = g.p; q.hp = Math.max(0, Math.round(g.hp));
        if (g.p >= q.n) { questEnd(s, true); return; }
        if (g.hp <= 0 || q.T <= 0) { addFx(s, "down", g.x, g.z, 0, 1.5, ""); questEnd(s, false); }
        return;
      }
      if (q.k === "gold") q.h = sumGold(s) - q.g0;
      if (q.h >= q.n) { questEnd(s, true); return; }
      if (q.T <= 0) questEnd(s, false);
      return;
    }
    if (s.t < s.qNext || s.boss || s.t > s.dur - 20) return;
    var k = pick(s, ["kill", "kill", "elite", "nohit", "gold", "rescue", "rescue"]);
    var n = k === "kill" ? Math.round(40 + s.t / 6) : k === "elite" ? 2 : k === "nohit" ? 20 : k === "rescue" ? 4 : Math.round(50 + s.t / 6);
    s.q = { k: k, n: n, h: 0, T: k === "nohit" ? 20 : k === "rescue" ? 55 : 45, t0: s.t, g0: sumGold(s) };
    if (k === "rescue") startRescue(s, s.q);
    msg(s, "qnew", "", k, n, s.q.img);
  }
  function tenkaTick(s, dt) {
    // 天命：第 1/3、2/3 再選一張
    [1 / 3, 2 / 3].forEach(function (fr, i) {
      if (!s.arcT[i] && s.t >= s.dur * fr) { s.arcT[i] = 1; players(s).forEach(function (P) { P.arcQ = (P.arcQ | 0) + 1; }); msg(s, "arcq", "", ""); }
    });
    players(s).forEach(function (P) {
      var mv = P._px === undefined ? 0 : Math.abs(P.x - P._px) + Math.abs(P.z - P._pz);
      P._px = P.x; P._pz = P.z;
      P._stillT = mv < 0.002 ? (P._stillT || 0) + dt : 0;
      P._still = P._stillT > 0.25 ? 1 : 0;
      if (!P.tkf || P.down) return;
      if (P.tkf.a_tenpen) {
        P._tp = (P._tp || 0) + dt;
        if (P._tp >= 6) {
          P._tp = 0;
          var dm = 22 * P.st.might * (1 + s.t / s.dur * 3);
          for (var k = 0; k < 6; k++) {
            var e = randomNear(s, P, 14);
            if (!e) break;
            addFx(s, "bolt", e.x, e.z, 0, 1.4, P.pid, 2);
            hitEnemy(s, P, e, dm * (e.boss ? 0.5 : 1), { tkSub: 1, st: "shock", knock: 1, crit: 0 });
          }
        }
      }
      if (P.tkf.s_onmyo) {
        P._barC = (P._barC || 0) + dt;
        if (P._barC >= 12) { P._barC = 0; P._bar = 3; addFx(s, "revive", P.x, P.z, 0, 1.6, P.pid); }
      }
      if (P._bar > 0) P._bar -= dt;
    });
    for (var i = 0; i < s.E.length; i++) { var en = s.E[i]; if (en.af === "regen" && en.hp > 0) en.hp = Math.min(en.mhp, en.hp + en.mhp * 0.025 * dt); }
    questTick(s, dt);
  }

  // ---------------- 主迴圈 ----------------
  function step(s, dt) {
    if (s.ph !== "play") return;
    var ps = players(s);
    if (!ps.length) return;
    // 單機有人在選升級時整局暫停（連線不暫停，選擇中的人無敵）
    var solo = ps.length === 1 && s.solo;
    if (solo && ps[0].opts) return;
    s.t += dt;
    if (s.freeze > 0) s.freeze -= dt;
    buildGrid(s);
    stageFeature(s, dt);
    weather(s, dt);
    bounty(s, dt);
    formation(s);
    if (s.mode === "tenka") tenkaTick(s, dt);
    spawning(s, dt);
    ps.forEach(function (P) { stepPlayer(s, P, dt); });
    buildGrid(s);
    stepShots(s, dt);
    stepZones(s, dt);
    stepEnemies(s, dt);
    stepWarns(s, dt);
    stepBullets(s, dt);
    stepPickups(s, dt);
    s.E = s.E.filter(function (e) { return e.hp > 0 && !(e.life !== undefined && e.life <= 0); });
    var cut = s.t - 1.2;
    if (s.fx.length && s.fx[0].t < cut) s.fx = s.fx.filter(function (f) { return f.t >= cut; });
    if (s.fx.length > 320) s.fx.splice(0, s.fx.length - 320);
    // 全滅判定
    if (ps.every(function (P) { return P.down; })) { s.ph = "lost"; msg(s, "lost", "", ""); }
  }

  function stepPlayer(s, P, dt) {
    Object.keys(P.buf).forEach(function (k) {
      if (P.buf[k] > 0) { P.buf[k] -= dt; if (P.buf[k] <= 0) { P.buf[k] = 0; calcStats(P, s); } }
    });
    if (!P.st) calcStats(P, s);
    if (P.iv > 0) P.iv -= dt;
    if (P.cbT > 0) { P.cbT -= dt; if (P.cbT <= 0) P.cb = 0; }
    if (P.down) {
      // 隊友站在旁邊 3 秒就能扶起
      var helper = players(s).some(function (o) { return o !== P && !o.down && dist2(o.x, o.z, P.x, P.z) < 2.5 * 2.5; });
      P.rv = helper ? P.rv + dt : Math.max(0, P.rv - dt * 0.5);
      if (P.rv >= 3) { P.down = 0; P.rv = 0; P.hp = P.mhp * 0.4; P.iv = 2; msg(s, "revive", P.pid, P.name); addFx(s, "revive", P.x, P.z, 0, 2, P.pid); }
      return;
    }
    P.sp = moveSpeed(s, P);
    // 2026-11-06 修正：有升級選項（或待選次數）時不能移動自己的角色（連線時遊戲不暫停，原本仍會照搖桿移動）
    if (P.local && !P.opts && !(P.pend > 0) && !(P.arcQ > 0)) stepMove(s, P, P.mvx, P.mvz, dt, P.sp);
    // 升級選項：有待選次數就出三選一；連線中 15 秒沒選就自動選第一個
    if (P.arcQ > 0 && !P.opts) { P.opts = arcOpts(s, P); P.optT = 0; pushAway(s, P, 2.8); }
    if (P.pend > 0 && !P.opts) { P.opts = makeOpts(s, P); P.optT = 0; pushAway(s, P, 2.8); }
    if (P.opts) {
      P.optT += dt;
      if (P.optT > 15) choose(s, P, 0);
      P.iv = Math.max(P.iv, 0.2);
    }
    if (P.st.regen > 0) P.hp = Math.min(P.mhp, P.hp + P.st.regen * dt);
    ultTick(s, P, dt);
    for (var i = 0; i < P.W.length; i++) {
      var w = P.W[i], p = wParams(P, w);
      if (p.kind === "orbit") orbitTick(s, P, w, p, dt);
      if (p.kind === "flame") flameTick(s, P, w, p, dt);
      w.cd -= dt;
      if (w.cd <= 0) {
        w.cd = p.cd + (p.kind === "orbit" ? p.dur : p.kind === "flame" ? p.dur : 0);
        fire(s, P, w, p);
        if (hasMod(p, "nitou") && p.kind !== "orbit" && p.kind !== "flame") w.dbl = 0.2;
      }
      // 二連：0.2 秒後再發動一次（威力 70%）
      if (w.dbl > 0) { w.dbl -= dt; if (w.dbl <= 0) { w.dbl = 0; p.dmg *= 0.7; fire(s, P, w, p); } }
    }
  }
  function orbitTick(s, P, w, p, dt) {
    if (w.ot <= 0) return;
    w.ot -= dt;
    w.tk -= dt;
    if (w.tk > 0) return;
    w.tk = 0.15;
    for (var i = 0; i < p.n; i++) {
      var a = s.t * 3.2 + i * Math.PI * 2 / p.n, ox = P.x + Math.cos(a) * p.area, oz = P.z + Math.sin(a) * p.area;
      near(s, ox, oz, 0.7, function (e) {
        if ((e._oh || 0) > s.t) return;
        e._oh = s.t + 0.35;
        hitEnemy(s, P, e, p.dmg, p, Math.cos(a), Math.sin(a));
      });
    }
  }
  function flameTick(s, P, w, p, dt) {
    if (w.ft <= 0) return;
    w.ft -= dt;
    w.tk -= dt;
    if (w.tk > 0) return;
    w.tk = 0.2;
    var a = w.aim !== undefined ? w.aim : Math.atan2(P.fz, P.fx);
    for (var i = 0; i < p.n; i++) sector(s, P, P.x, P.z, a + (i ? Math.PI : 0), p.area, 0.5, p.dmg, p);
  }

  function stepShots(s, dt) {
    var keep = [];
    for (var i = 0; i < s.S.length; i++) {
      var sh = s.S[i], P = s.P[sh.o] || s.gone[sh.o];
      sh.life -= dt;
      if (!P) continue;
      var st = sh.p || {};
      if (sh.mode === "lob") {
        var f = 1 - sh.life / sh.T;
        sh.x = sh.sx + (sh.tx - sh.sx) * f; sh.z = sh.sz + (sh.tz - sh.sz) * f; sh.h = Math.sin(Math.min(1, f) * Math.PI) * 3;
        if (sh.life <= 0) {
          near(s, sh.tx, sh.tz, sh.r, function (e) { var d = Math.sqrt(dist2(e.x, e.z, sh.tx, sh.tz)) || 1; hitEnemy(s, P, e, sh.dmg, st, (e.x - sh.tx) / d, (e.z - sh.tz) / d); });
          addFx(s, "boom", sh.tx, sh.tz, 0, sh.r, sh.o, sh.k === "ozutsu" ? 1 : 0);
          continue;
        }
      } else if (sh.mode === "drop") {
        if (sh.life <= 0) {
          near(s, sh.x, sh.z, sh.r, function (e) { hitEnemy(s, P, e, sh.dmg, st); });
          addFx(s, sh.k === "tsurara" ? "ice" : sh.k === "kaminari" ? "bolt" : "arrowhit", sh.x, sh.z, 0, sh.r, sh.o);
          continue;
        }
      } else if (sh.mode === "spin") {
        if (sh.life <= 0) continue;
        sh.a += dt * 16;
        sh.x = P.x + Math.cos(sh.a) * sh.r0; sh.z = P.z + Math.sin(sh.a) * sh.r0;
      } else {
        if (sh.life <= 0) continue;
        if (sh.mode === "proj" && hasMod(sh.p, "tsuibi")) {   // 秘傳・追尾
          var tg2 = nearest(s, sh.x, sh.z, 8, sh.hit);
          if (tg2) {
            var sp2 = Math.sqrt(sh.vx * sh.vx + sh.vz * sh.vz) || 1, ta2 = Math.atan2(tg2.z - sh.z, tg2.x - sh.x), ca2 = Math.atan2(sh.vz, sh.vx), da2 = ((ta2 - ca2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            ca2 += clamp(da2, -4 * dt, 4 * dt);
            sh.vx = Math.cos(ca2) * sp2; sh.vz = Math.sin(ca2) * sp2;
          }
        }
        if (sh.mode === "homing") {
          var tg = nearest(s, sh.x, sh.z, 9, sh.hit);
          if (tg) {
            var ta = Math.atan2(tg.z - sh.z, tg.x - sh.x), ca = Math.atan2(sh.vz, sh.vx), da = ((ta - ca + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            ca += clamp(da, -6 * dt, 6 * dt);
            sh.vx = Math.cos(ca) * sh.spd; sh.vz = Math.sin(ca) * sh.spd;
          }
        } else if (sh.mode === "boom" && sh.life < sh.T / 2) {
          var bx = P.x - sh.x, bz = P.z - sh.z, bd = Math.sqrt(bx * bx + bz * bz) || 1;
          sh.vx = bx / bd * sh.spd * 1.2; sh.vz = bz / bd * sh.spd * 1.2;
          if (bd < 0.8) continue;
          if (sh.retHit !== 1) { sh.hit = {}; sh.retHit = 1; }
        }
        sh.x += sh.vx * dt; sh.z += sh.vz * dt;
        if (sh.mode !== "boom" || sh.k !== "kusarigama") sh.a = Math.atan2(sh.vz, sh.vx);
        else sh.a += dt * 14;
        if (Math.abs(sh.x) > AR + 6 || Math.abs(sh.z) > AR + 6) continue;
        var dead = false;
        near(s, sh.x, sh.z, sh.r, function (e) {
          if (dead || sh.hit[e.id]) return;
          sh.hit[e.id] = 1;
          var sp = Math.sqrt(sh.vx * sh.vx + sh.vz * sh.vz) || 1;
          hitEnemy(s, P, e, sh.dmg, st, sh.vx / sp, sh.vz / sp);
          // 秘傳・分裂：第一次命中後分成左右兩發
          if (hasMod(st, "bunretsu") && !sh.child && !sh.split) {
            sh.split = 1;
            var a0 = Math.atan2(sh.vz, sh.vx);
            [-0.5, 0.5].forEach(function (da) {
              var ch = { id: nid(s), k: sh.k, o: sh.o, x: sh.x, z: sh.z, vx: Math.cos(a0 + da) * sp, vz: Math.sin(a0 + da) * sp, spd: sp, life: 0.6, mode: "proj", dmg: sh.dmg * 0.6, r: sh.r, pierce: 0, hit: {}, p: st, a: a0 + da, child: 1 };
              ch.hit[e.id] = 1;
              s.S.push(ch);
            });
          }
          if (sh.mode === "bounce") {
            var nx = nearest(s, sh.x, sh.z, 8, sh.hit);
            if (nx && sh.pierce > 0) { sh.pierce--; var na = Math.atan2(nx.z - sh.z, nx.x - sh.x); sh.vx = Math.cos(na) * sh.spd; sh.vz = Math.sin(na) * sh.spd; sh.life = Math.max(sh.life, 0.8); }
            else dead = true;
          } else if (sh.pierce-- <= 0) dead = true;
        });
        if (dead) continue;
      }
      keep.push(sh);
    }
    s.S = keep;
  }
  function stepZones(s, dt) {
    s.Z = s.Z.filter(function (z) {
      z.t -= dt;
      if (z.t <= 0) return false;
      if (z.k === "pool") return true;   // 熔岩池（傷害玩家，在 stepWarns 處理）
      var P = s.P[z.o] || s.gone[z.o];
      z.tk -= dt;
      if (z.tk <= 0 && P) {
        z.tk = 0.5;
        var hit = false;
        near(s, z.x, z.z, z.r, function (e) { hitEnemy(s, P, e, z.dmg, z.p); hit = true; });
        if (z.k === "makibishi" && hit) z.t = Math.min(z.t, 0.6);
      }
      return true;
    });
  }

  function hurtPlayer(s, P, dmg, src) {
    if (P.down || P.iv > 0) return;
    var d = Math.max(1, dmg - P.st.armor - (P.tkf ? (P._still ? (P.tkf.fudo ? 3 : 0) + (P.tkf.a_fudo ? 4 : 0) : 0) : 0));
    if (P.tkf) { if (P._bar > 0) d *= 0.5; P._hitT = s.t; }
    P.hp -= d;
    P.iv = 0.45;
    if (src && P.st.thorns > 0 && src.hp > 0) hitEnemy(s, P, src, P.st.thorns, null);
    if (P.hp <= 0) {
      if (P.rev > 0) { P.rev--; P.hp = P.mhp * 0.5; P.iv = 3; addFx(s, "revive", P.x, P.z, 0, 3, P.pid); msg(s, "kage", P.pid, P.name); near(s, P.x, P.z, 6, function (e) { var dd = Math.sqrt(dist2(e.x, e.z, P.x, P.z)) || 1; e.kx = (e.x - P.x) / dd * 3; e.kz = (e.z - P.z) / dd * 3; }); return; }
      P.hp = 0; P.down = 1; P.rv = 0; P.opts = null;
      msg(s, "down", P.pid, P.name);
      addFx(s, "down", P.x, P.z, 0, 2, P.pid);
    }
  }

  function stepEnemies(s, dt) {
    var ps = alive(s), all = players(s);
    var tgts = ps.filter(function (P) { return !P.afk; });
    if (!tgts.length) tgts = ps;
    var frozen = s.freeze > 0;
    for (var i = 0; i < s.E.length; i++) {
      var e = s.E[i];
      if (e.hp <= 0) continue;
      if (e.hf > 0) e.hf -= dt;
      // 異常狀態
      var S = e.sts;
      if (S) {
        var P0 = s.P[e.dp];
        if (S.poison > 0) { S.poison -= dt; e._dt = (e._dt || 0) + dt; }
        if (S.burn > 0) { S.burn -= dt; e._dt = (e._dt || 0) + dt; }
        if (e._dt >= 0.5) { e._dt = 0; var dd = (S.poison > 0 ? e.pd || 0 : 0) + (S.burn > 0 ? e.bd || 0 : 0); if (dd > 0) { e.hp -= dd; if (P0) P0.dmg += dd; if (e.hp <= 0) { killEnemy(s, P0, e, null); continue; } } }
        if (S.chill > 0) S.chill -= dt;
        if (S.shock > 0) S.shock -= dt;
      }
      if (e.life !== undefined) { e.life -= dt; if (e.life <= 0) continue; }
      if (e.kx || e.kz) { e.x += e.kx * dt * 8; e.z += e.kz * dt * 8; e.kx *= Math.pow(0.02, dt); e.kz *= Math.pow(0.02, dt); if (Math.abs(e.kx) < 0.01) e.kx = 0; if (Math.abs(e.kz) < 0.01) e.kz = 0; }
      if (frozen && !e.boss) continue;
      if (e.stun > 0) { e.stun -= dt; continue; }
      // 目標：最近的活著的玩家
      var T = null, td = 1e9;
      for (var j = 0; j < tgts.length; j++) { var d2 = dist2(e.x, e.z, tgts[j].x, tgts[j].z); if (d2 < td) { td = d2; T = tgts[j]; } }
      if (!T) { T = all[0]; td = T ? dist2(e.x, e.z, T.x, T.z) : 1e9; }
      if (!T) continue;
      var tdist = Math.sqrt(td);
      var spd = e.spd * (S && S.chill > 0 ? 0.5 : 1) * (frozen ? 0.3 : 1);
      var dx = (T.x - e.x) / (tdist || 1), dz = (T.z - e.z) / (tdist || 1);
      if (e.line) { dx = e.lx; dz = e.lz; }
      if (e.flee) { dx = -dx; dz = -dz; spd *= 1.1; }
      if (e.boss) { bossAI(s, e, T, tdist, dt); continue; }
      if (T.opts && !e.line) {   // 目標正在選升級：保持一小步距離
        var keep = 2.6 + e.r;
        if (tdist < keep) { dx = -dx; dz = -dz; spd *= 0.6; } else if (tdist < keep + 0.6) spd = 0;
      }
      var def = D.ENEMIES[e.k] || {}, f = def.f || {};
      // 衝鋒：蓄力 0.6 秒後三倍速衝 0.7 秒
      if (f.charge) {
        e.cd -= dt;
        if (e.ch > 0) { e.ch -= dt; if (e.ch <= 0.7) spd *= 3.2; else spd *= 0.1; dx = e.cx; dz = e.cz; }
        else if (e.cd <= 0 && tdist < 9) { e.cd = 4 + rnd(s) * 2; e.ch = 1.3; e.cx = dx; e.cz = dz; }
      }
      // 遠程：保持距離並射擊
      if (f.ranged) {
        e.cd -= dt;
        if (tdist < 7) spd *= -0.4; else if (tdist < 11) spd *= 0.2;
        if (e.cd <= 0 && tdist < 13) {
          e.cd = 2.6 + rnd(s) * 1.4;
          var ba = Math.atan2(T.z - e.z, T.x - e.x);
          s.B.push({ id: nid(s), x: e.x, z: e.z, vx: Math.cos(ba) * 9, vz: Math.sin(ba) * 9, life: 2, dmg: e.dmg * 0.9, k: e.k === "gama" ? "spit" : "ball" });
        }
      }
      e.x += dx * spd * dt; e.z += dz * spd * dt;
      e.a = Math.atan2(dz, dx);
      // 互相推開（飛行與幽靈除外）
      if (!e.fly && !(f.ghost)) {
        near(s, e.x, e.z, e.r, function (o) {
          if (o === e || o.fly || o.boss) return;
          var ox = e.x - o.x, oz = e.z - o.z, od = Math.sqrt(ox * ox + oz * oz) || 0.01, ov = e.r + o.r - od;
          if (ov > 0) { e.x += ox / od * ov * 0.5; e.z += oz / od * ov * 0.5; }
        });
      }
      e.x = clamp(e.x, -AR - 4, AR + 4); e.z = clamp(e.z, -AR - 4, AR + 4);
      // 碰觸傷害
      for (var q = 0; q < ps.length; q++) {
        var P = ps[q], rr = e.r + (P.local || s.solo ? 0.45 : 0.3);
        if (dist2(e.x, e.z, P.x, P.z) < rr * rr) hurtPlayer(s, P, e.dmg, e);
      }
      // 太遠的小兵重新放到玩家附近（避免被甩開後永遠追不上）
      if (td > 32 * 32 && !e.el && !e.line && ps.length) {
        var Pn = pick(s, ps), ang = rnd(s) * 6.28;
        e.x = Pn.x + Math.cos(ang) * 18; e.z = Pn.z + Math.sin(ang) * 18;
      }
    }
  }
  function bossAI(s, e, T, td, dt) {
    var B = D.BOSSES[e.k];
    var enr = s.t > s.dur + 180 ? 1.5 : 1;
    if (e.shieldT > 0) e.shieldT -= dt;
    if (e.act) {
      var A = e.act;
      A.t -= dt;
      if (A.k === "charge") {
        if (A.t < 0.9) { e.x += A.dx * e.spd * 4.2 * dt; e.z += A.dz * e.spd * 4.2 * dt; }
      }
      if (A.t <= 0) e.act = null;
    } else {
      var dx = (T.x - e.x) / (td || 1), dz = (T.z - e.z) / (td || 1);
      if (td > 3) { e.x += dx * e.spd * enr * dt; e.z += dz * e.spd * enr * dt; }
      e.a = Math.atan2(dz, dx);
      e.cd -= dt * enr;
      if (e.cd <= 0) {
        var k = B.pat[e.pi % B.pat.length];
        e.pi++;
        e.cd = 3.2 - Math.min(1.2, s.stage * 0.1);
        var ps = alive(s);
        if (k === "charge") { e.act = { k: "charge", t: 1.7, dx: dx, dz: dz }; addFx(s, "warnline", e.x, e.z, Math.atan2(dz, dx), 14, "", 0); }
        else if (k === "ring") { var n = 18 + s.stage * 2; for (var i = 0; i < n; i++) { var a = i * Math.PI * 2 / n + rnd(s); s.B.push({ id: nid(s), x: e.x, z: e.z, vx: Math.cos(a) * 7, vz: Math.sin(a) * 7, life: 3, dmg: e.dmg * 0.6, k: "orb" }); } }
        else if (k === "aim") { var ba = Math.atan2(T.z - e.z, T.x - e.x); for (var b = -2; b <= 2; b++) s.B.push({ id: nid(s), x: e.x, z: e.z, vx: Math.cos(ba + b * 0.16) * 11, vz: Math.sin(ba + b * 0.16) * 11, life: 2.4, dmg: e.dmg * 0.6, k: "orb" }); }
        else if (k === "slam") ps.forEach(function (P) { warn(s, "boss", P.x, P.z, 3, 1.3, e.dmg); });
        else if (k === "summon") { var ro = roster(s); for (var m = 0; m < 6 + s.stage; m++) { var sa = m * 0.9; spawnEnemy(s, pick(s, ro), e.x + Math.cos(sa) * 3, e.z + Math.sin(sa) * 3); } e.shieldT = 3; }
        else if (k === "rain") ps.forEach(function (P) { for (var r = 0; r < 5; r++) warn(s, "boss", P.x + (rnd(s) - 0.5) * 12, P.z + (rnd(s) - 0.5) * 12, 2.2, 1.4 + r * 0.15, e.dmg * 0.8); });
        else if (k === "nova") { warn(s, "nova", e.x, e.z, 7.5, 1.8, e.dmg * 1.2); e.act = { k: "hold", t: 1.8 }; }
      }
    }
    e.x = clamp(e.x, -AR, AR); e.z = clamp(e.z, -AR, AR);
    alive(s).forEach(function (P) { var rr = e.r + 0.45; if (dist2(e.x, e.z, P.x, P.z) < rr * rr) hurtPlayer(s, P, e.dmg, e); });
  }
  function stepWarns(s, dt) {
    var ps = alive(s);
    s.W = s.W.filter(function (w) {
      w.t -= dt;
      if (w.t > 0) return true;
      ps.forEach(function (P) { if (dist2(P.x, P.z, w.x, w.z) < w.r * w.r) hurtPlayer(s, P, w.dmg, null); });
      addFx(s, w.k === "vent" ? "vent" : w.k === "lava" ? "lava" : "blast", w.x, w.z, 0, w.r, "");
      if (w.pool) s.Z.push({ id: nid(s), k: "pool", o: "", x: w.x, z: w.z, r: w.r * 0.9, t: w.pool, tk: 0, dmg: w.dmg * 0.3 });
      return false;
    });
    s.Z.forEach(function (z) {
      if (z.k !== "pool") return;
      z.tk -= dt;
      if (z.tk > 0) return;
      z.tk = 0.5;
      ps.forEach(function (P) { if (dist2(P.x, P.z, z.x, z.z) < z.r * z.r) hurtPlayer(s, P, z.dmg, null); });
    });
  }
  function stepBullets(s, dt) {
    var ps = alive(s);
    s.B = s.B.filter(function (b) {
      b.life -= dt;
      if (b.life <= 0) return false;
      if (s.freeze > 0) return true;
      b.x += b.vx * dt; b.z += b.vz * dt;
      for (var i = 0; i < ps.length; i++) {
        var br = ps[i].local || s.solo ? 0.55 : 0.4;
        if (dist2(b.x, b.z, ps[i].x, ps[i].z) < br * br) { hurtPlayer(s, ps[i], b.dmg, null); return false; }
      }
      return true;
    });
  }
  function stepPickups(s, dt) {
    var ps = alive(s);
    if (!ps.length) return;
    // 經驗珠：在拾取範圍內就飛向玩家；全隊共享經驗
    var gainXp = 0;
    s.G = s.G.filter(function (g) {
      var T = g.m ? s.P[g.m] : null;
      if (T && T.down) T = null;
      if (!T) {
        for (var i = 0; i < ps.length; i++) {
          var R = 2.3 * ps[i].st.magnet;
          if (dist2(g.x, g.z, ps[i].x, ps[i].z) < R * R) { T = ps[i]; g.m = T.pid; break; }
        }
      }
      if (!T) return true;
      var dx = T.x - g.x, dz = T.z - g.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.6) { gainXp += g.v; return false; }
      var sp = Math.max(9, 16 - d) * dt;
      g.x += dx / d * Math.min(sp, d); g.z += dz / d * Math.min(sp, d);
      return true;
    });
    if (gainXp > 0) players(s).forEach(function (P) { gainExp(s, P, gainXp); });
    // 道具
    s.D = s.D.filter(function (d) {
      if (d.k === "warashi") {
        d.life -= dt; if (d.life <= 0) return false;
        d.a += (rnd(s) - 0.5) * dt * 2; d.x = clamp(d.x + Math.cos(d.a) * 1.5 * dt, -AR, AR); d.z = clamp(d.z + Math.sin(d.a) * 1.5 * dt, -AR, AR);
      }
      if (d.k === "hokora") {
        d.life -= dt;
        if (d.life <= 0) return false;
        var pr = null;
        for (var h = 0; h < ps.length; h++) if (dist2(d.x, d.z, ps[h].x, ps[h].z) < 2.4 * 2.4) pr = ps[h];
        d.p = pr ? d.p + dt : Math.max(0, d.p - dt * 0.5);
        if (d.p < 3) return true;
        bless(s, pr);
        addFx(s, "pick", d.x, d.z, 0, 2, pr.pid, 3);
        return false;
      }
      if (d.k === "musume") return true;   // 救出令的村姑：由 questTick 處理
      if (d.k === "lantern" || d.k === "anvil") {
        // 被武器打到才會壞：用附近的投射物／近戰特效判定太麻煩，改成「玩家靠近 1.2 以內或被範圍攻擊波及」
        var hitBy = null;
        for (var i = 0; i < ps.length; i++) if (dist2(d.x, d.z, ps[i].x, ps[i].z) < 1.6 * 1.6) hitBy = ps[i];
        if (!hitBy) return true;
        d.hp -= dt * 4;
        if (d.hp > 0) return true;
        addFx(s, "break", d.x, d.z, 0, 1, hitBy.pid);
        if (d.k === "anvil") dropItem(s, "chest", d.x, d.z, {});
        else if (rnd(s) < 0.65) dropFood(s, d.x, d.z);
        else dropItem(s, "coin", d.x, d.z, { v: 8 });
        return false;
      }
      var T = null;
      for (var j = 0; j < ps.length; j++) {
        var R = d.k === "coin" ? 2.3 * ps[j].st.magnet : 1.1;
        if (dist2(d.x, d.z, ps[j].x, ps[j].z) < R * R) { T = ps[j]; break; }
      }
      if (!T) return true;
      if (d.k === "coin") {
        var dx = T.x - d.x, dz = T.z - d.z, dd = Math.sqrt(dx * dx + dz * dz);
        if (dd > 0.6) { d.x += dx / dd * 12 * dt; d.z += dz / dd * 12 * dt; return true; }
        players(s).forEach(function (P) { P.gold += d.v * P.st.greed * (1 + comboBonus(T)); });
        return false;
      }
      pickup(s, T, d);
      return false;
    });
  }
  var BLESS = ["might", "speed", "magnet", "heal", "ult", "gold", "inv", "luck"];
  function bless(s, P) {
    var b = pick(s, BLESS);
    if (b === "might") P.buf.might = 30;
    else if (b === "speed") P.buf.speed = 30;
    else if (b === "magnet") s.G.forEach(function (g) { g.m = P.pid; });
    else if (b === "heal") players(s).forEach(function (o) { if (!o.down) o.hp = o.mhp; });
    else if (b === "ult") P.ult = Math.min(100, P.ult + 50);
    else if (b === "gold") players(s).forEach(function (o) { o.gold += 60 * o.st.greed; });
    else if (b === "inv") P.iv = Math.max(P.iv, 8);
    else if (b === "luck") P.buf.luck = 40;
    calcStats(P, s);
    msg(s, "bless", P.pid, b);
  }
  function gainExp(s, P, v) {
    if (P.down) v *= 0.5;
    P.xp += v * P.st.growth;
    while (P.xp >= P.xn) {
      P.xp -= P.xn;
      P.lv++;
      P.xn = xpNeed(P.lv);
      P.pend++;
      addFx(s, "lvl", P.x, P.z, 0, 2, P.pid);
    }
  }
  function pickup(s, P, d) {
    if (d.k === "chest") { openChest(s, P, d.big); return; }
    if (d.k === "warashi") {
      P.buf.luck = 30; P.hp = P.mhp; P.ult = Math.min(100, P.ult + 30);
      calcStats(P, s);
      msg(s, "warashi", P.pid, P.name);
      addFx(s, "pick", d.x, d.z, 0, 1.5, P.pid, 3);
      return;
    }
    if (d.k !== "food") return;
    var f = D.FOODS[d.f], e = f.e;
    if (e.heal) P.hp = Math.min(P.mhp, P.hp + e.heal);
    if (e.full) P.hp = P.mhp;
    if (e.magnet) s.G.forEach(function (g) { g.m = P.pid; });
    if (e.inv) P.iv = Math.max(P.iv, e.inv);
    if (e.speed) P.buf.speed = e.speed;
    if (e.might) P.buf.might = e.might;
    if (e.armor) P.buf.armor = e.armor;
    if (e.freeze) s.freeze = Math.max(s.freeze, e.freeze);
    if (e.nuke) { near(s, P.x, P.z, 16, function (en) { hitEnemy(s, P, en, e.nuke * (1 + s.t / s.dur * 3) * (en.boss ? 0.3 : 1), null); }); addFx(s, "boom", P.x, P.z, 0, 10, P.pid, 1); }
    if (e.gold) players(s).forEach(function (o) { o.gold += e.gold * o.st.greed; });
    if (e.xp) players(s).forEach(function (o) { gainExp(s, o, e.xp * (1 + s.t / 120)); });
    if (e.ult) P.ult = Math.min(100, P.ult + e.ult);
    calcStats(P, s);
    msg(s, "food", P.pid, d.f);
    addFx(s, "pick", d.x, d.z, 0, 1, P.pid, 1);
  }

  // ---------------- 意圖（玩家操作）----------------
  // 選升級時把貼在身邊的敵人推到 R 以外（單機暫停時也不會一解除就被圍毆）
  function pushAway(s, P, R) {
    for (var i = 0; i < s.E.length; i++) {
      var e = s.E[i];
      if (e.boss || e.hp <= 0) continue;
      var dx = e.x - P.x, dz = e.z - P.z, d = Math.sqrt(dx * dx + dz * dz);
      var need = R + e.r;
      if (d >= need) continue;
      if (d < 0.01) { var a = rnd(s) * 6.28; dx = Math.cos(a); dz = Math.sin(a); d = 1; }
      e.x = P.x + dx / d * need; e.z = P.z + dz / d * need;
    }
  }
  function choose(s, P, i) {
    if (!P || !P.opts) return false;
    var o = P.opts[i] || P.opts[0];
    if (o && o.t === "arc") {   // 天命：不消耗升級次數
      P.arc = P.arc || [];
      if (P.arc.indexOf(o.k) < 0) P.arc.push(o.k);
      P.arcQ = Math.max(0, (P.arcQ | 0) - 1);
      P.opts = null; P.iv = Math.max(P.iv, 1);
      calcStats(P, s);
      msg(s, "arc", P.pid, o.k);
      return true;
    }
    applyOpt(s, P, o);
    P.opts = null;
    P.iv = Math.max(P.iv, 1);   // 選完再無敵 1 秒
    P.pend = Math.max(0, P.pend - 1);
    msg(s, "pick", P.pid, o);
    return true;
  }
  function applyIntent(s, pid, it) {
    var P = s.P[pid];
    if (!P || !it) return false;
    if (it.t === "pick") return choose(s, P, it.i | 0);
    if (it.t === "reroll") { if (P.opts && P.rr > 0) { P.rr--; P.opts = P.opts[0] && P.opts[0].t === "arc" ? arcOpts(s, P) : makeOpts(s, P); P.optT = 0; return true; } return false; }
    if (it.t === "banish") return banish(s, P, it.i | 0);
    if (it.t === "skip") return skipOpt(s, P);
    if (it.t === "ult") return useUlt(s, P);
    return false;
  }

  // ---------------- 快照（連線廣播用，數值壓縮）----------------
  function r1(v) { return Math.round(v * 10) / 10; }
  function snap(s) {
    var o = { md: s.mode || undefined, ht: s.heat || undefined, q: s.q ? { k: s.q.k, n: s.q.n, h: s.q.k === "rescue" ? r1(s.q.h) : Math.floor(s.q.h), T: r1(s.q.T), hp: s.q.hp, img: s.q.img } : undefined, sv: s.saved && s.saved.length ? s.saved : undefined, t: r1(s.t), ph: s.ph, st: s.stage, mp: s.map, du: s.dur, df: s.diff, k: s.kills, fz: s.freeze > 0 ? 1 : 0, fe: { on: s.fe.on, k: s.fe.k, wx: s.fe.wx, wz: s.fe.wz }, wx: s.wx ? s.wx.k : "clear", rv: s.rivers, P: {}, E: [], S: [], B: [], G: [], D: [], Z: [], W: [], fx: packFx(s), msg: s.msg.slice(-8), bn: s.bossName };
    players(s).forEach(function (P) {
      o.P[P.pid] = {
        n: P.name, dm: P.dm, x: r1(P.x), z: r1(P.z), fx: Math.round(P.fx * 100) / 100, fz: Math.round(P.fz * 100) / 100, hp: Math.ceil(P.hp), mh: P.mhp, lv: P.lv, xp: Math.round(P.xp), xn: P.xn,
        dn: P.down, rv: r1(P.rv), iv: P.iv > 0 ? 1 : 0, u: Math.floor(P.ult), sp: r1(P.sp), g: Math.floor(P.gold), kl: P.kills, dg: Math.round(P.dmg), rr: P.rr, re: P.rev, cb: P.cb || 0, cm: P.cbMax || 0, jn: P.jin || 0, af: P.afk ? 1 : 0,
        un: P.ultN || 0, kg: P.kg ? Math.round(P.kg * 10) / 10 : undefined, ac: P.arc && P.arc.length ? P.arc : undefined, aq: P.arcQ || undefined, bn: P.bn || undefined, sk: P.sk || undefined,
        W: P.W.map(function (w) { return [w.id, w.lv, w.evo, w.ot > 0 ? 1 : 0, w.ft > 0 ? 1 : 0, (w.mods || []).join(",")]; }), A: P.A.map(function (a) { return [a.id, a.lv]; }),
        op: P.opts, pe: P.pend, bf: Object.keys(P.buf).filter(function (k) { return P.buf[k] > 0; }), m: P.meta
      };
    });
    var bossE = null;
    var pl = players(s);
    function seen(x, z, R) { for (var i = 0; i < pl.length; i++) if (Math.abs(pl[i].x - x) < R && Math.abs(pl[i].z - z) < R * 0.85) return true; return false; }
    s.E.forEach(function (e) {
      if (!e.boss && !e.bty && !seen(e.x, e.z, 32)) return;   // 看不到的小兵不送
      o.E.push(e.id, EKI[e.k] === undefined ? 0 : EKI[e.k], r1(e.x), r1(e.z), Math.round(e.hp / e.mhp * 100), (e.el ? 1 : 0) | (e.boss ? 2 : 0) | (e.hf > 0 ? 4 : 0) | (e.sts && e.sts.chill > 0 ? 8 : 0) | (e.sts && e.sts.burn > 0 ? 16 : 0) | (e.sts && e.sts.poison > 0 ? 32 : 0) | (e.stun > 0 ? 64 : 0) | (e.small ? 128 : 0) | (e.bty ? 256 : 0));
      if (e.boss && e.fin) bossE = e;
    });
    if (bossE) o.bh = Math.round(bossE.hp / bossE.mhp * 1000) / 1000;
    s.E.forEach(function (e) { if (e.boss && !e.fin) o.mb = Math.round(e.hp / e.mhp * 1000) / 1000, o.mbn = e.bn; });
    s.S.forEach(function (sh) { if (!seen(sh.x, sh.z, 32)) return; o.S.push(sh.id, SKI[sh.k] === undefined ? 0 : SKI[sh.k], r1(sh.x), r1(sh.z), Math.round((sh.a || 0) * 10) / 10, r1(sh.h || 0), sh.mode === "drop" ? r1(Math.max(0, sh.life)) : -1); });
    s.B.forEach(function (b) { o.B.push(b.id, r1(b.x), r1(b.z), b.k === "orb" ? 1 : 0); });
    var gn = 0;
    for (var gi = s.G.length - 1; gi >= 0 && gn < 140; gi--) { var gg = s.G[gi]; if (seen(gg.x, gg.z, 26)) { gn++; o.G.push(gg.id, Math.round(gg.x * 2), Math.round(gg.z * 2), gg.v >= 20 ? 2 : gg.v >= 5 ? 1 : 0); } }
    s.D.forEach(function (d) { o.D.push(d.id, DK.indexOf(d.k), r1(d.x), r1(d.z), d.k === "food" ? d.f : d.k === "hokora" ? Math.round(d.p * 10) : d.k === "musume" ? d.img : d.big ? 1 : 0); });
    s.Z.forEach(function (z) { o.Z.push({ id: z.id, k: z.k, x: r1(z.x), z: r1(z.z), r: r1(z.r), t: r1(z.t), c: z.c }); });
    s.W.forEach(function (w) { o.W.push({ id: w.id, k: w.k, x: r1(w.x), z: r1(w.z), r: r1(w.r), p: Math.round((1 - w.t / w.T) * 100) / 100 }); });
    return o;
  }
  // 快照裡敵人種類、投射物外觀用編號（字串太占頻寬）
  var EK = Object.keys(D.ENEMIES).concat(Object.keys(D.BOSSES), ["ochimusha"]), EKI = {};
  EK.forEach(function (k, i) { EKI[k] = i; });
  var SK = D.ARCHES.map(function (a) { return a.k; }), SKI = {};
  SK.forEach(function (k, i) { SKI[k] = i; });
  var DK = ["coin", "food", "chest", "lantern", "anvil", "warashi", "hokora", "musume"];
  var FXK = ["chain", "slash", "thrust", "spin", "whip", "bolt", "beam", "wave", "pulse", "boom", "steam", "frostbolt", "venom", "crit", "die", "bossdie", "bossin", "chest", "lvl", "ult", "revive", "down", "pick", "break", "vent", "lava", "blast", "ice", "arrowhit", "warnline"];
  var FXI = {}; FXK.forEach(function (k, i) { FXI[k] = i; });
  // 只送最近 0.7 秒的特效（畫面依 id 只播一次）
  function packFx(s) {
    var out = [], cut = Math.max(s.t - 0.6, (s._snapT || 0) - 0.08), pl = players(s);
    s._snapT = s.t;
    for (var i = Math.max(0, s.fx.length - 140); i < s.fx.length; i++) {
      var f = s.fx[i];
      if (f.t < cut) continue;
      var vis = false;
      for (var j = 0; j < pl.length; j++) if (Math.abs(pl[j].x - f.x) < 34 && Math.abs(pl[j].z - f.z) < 30) { vis = true; break; }
      if (!vis) continue;
      out.push(f.id, FXI[f.k] === undefined ? FXI.die : FXI[f.k], f.x, f.z, f.a, f.r, f.o, f.c);
    }
    return out;
  }
  function unpackFx(a) {
    var out = [];
    for (var i = 0; i + 7 < a.length; i += 8) out.push({ id: a[i], k: FXK[a[i + 1]], x: a[i + 2], z: a[i + 3], a: a[i + 4], r: a[i + 5], o: a[i + 6], c: a[i + 7] });
    return out;
  }
  // 把快照轉成畫面用的「view」（與房主的 s 同一種欄位名稱，畫面程式只寫一套）
  function unsnap(o) {
    var v = { mode: o.md, heat: o.ht | 0, q: o.q || null, saved: o.sv || [], t: o.t, ph: o.ph, stage: o.st, map: o.mp, dur: o.du, diff: o.df, kills: o.k, freeze: o.fz, fe: o.fe || {}, wx: { k: o.wx || "clear" }, rivers: o.rv || [], P: {}, E: [], S: [], B: [], G: [], D: [], Z: o.Z || [], W: o.W || [], fx: unpackFx(o.fx || []), msg: o.msg || [], bossName: o.bn, bh: o.bh, mb: o.mb, mbn: o.mbn };
    Object.keys(o.P || {}).forEach(function (pid) {
      var p = o.P[pid];
      v.P[pid] = {
        pid: pid, name: p.n, dm: p.dm, x: p.x, z: p.z, fx: p.fx, fz: p.fz, hp: p.hp, mhp: p.mh, lv: p.lv, xp: p.xp, xn: p.xn, down: p.dn, rv: p.rv, iv: p.iv, ult: p.u, sp: p.sp, gold: p.g, kills: p.kl, dmg: p.dg, rr: p.rr, rev: p.re, cb: p.cb, cbMax: p.cm, jin: p.jn || 0, afk: p.af || 0,
        ultN: p.un || 0, kg: p.kg || 0, arc: p.ac || [], arcQ: p.aq || 0, bn: p.bn || 0, sk: p.sk || 0,
        W: (p.W || []).map(function (w) { return { id: w[0], lv: w[1], evo: w[2], ot: w[3], ft: w[4], mods: w[5] ? String(w[5]).split(",") : [] }; }), A: (p.A || []).map(function (a) { return { id: a[0], lv: a[1] }; }),
        opts: p.op || null, pend: p.pe, buf: (p.bf || []).reduce(function (m, k) { m[k] = 1; return m; }, {}), meta: p.m || {}
      };
      calcStats(v.P[pid], v);
    });
    var E = o.E || [], i;
    for (i = 0; i + 5 < E.length; i += 6) {
      var fl = E[i + 5];
      var ek = EK[E[i + 1]] || "ashigaru";
      v.E.push({ id: E[i], k: ek, m: ek === "ochimusha" ? "nobushi" : (D.ENEMIES[ek] || D.BOSSES[ek] || {}).m || "ashigaru", x: E[i + 2], z: E[i + 3], hpf: E[i + 4] / 100, el: fl & 1, boss: fl & 2 ? 1 : 0, hf: fl & 4 ? 0.1 : 0, sf: fl, bty: fl & 256 ? 1 : 0, s: fl & 2 ? (D.BOSSES[ek] || {}).s || 2 : fl & 1 ? 1.45 : fl & 128 ? 0.7 : 1 });
    }
    var S = o.S || [];
    for (i = 0; i < S.length; i += 7) v.S.push({ id: S[i], k: SK[S[i + 1]], x: S[i + 2], z: S[i + 3], a: S[i + 4], h: S[i + 5], dl: S[i + 6] });
    var B = o.B || [];
    for (i = 0; i < B.length; i += 4) v.B.push({ id: B[i], x: B[i + 1], z: B[i + 2], k: B[i + 3] ? "orb" : "ball" });
    var Dd = o.D || [];
    for (i = 0; i + 4 < Dd.length; i += 5) v.D.push({ id: Dd[i], k: DK[Dd[i + 1]], x: Dd[i + 2], z: Dd[i + 3], f: Dd[i + 4], big: Dd[i + 4], img: Dd[i + 4], p: DK[Dd[i + 1]] === "hokora" ? Dd[i + 4] / 10 : 0 });
    var G = o.G || [];
    for (i = 0; i < G.length; i += 4) v.G.push({ id: G[i], x: G[i + 1] / 2, z: G[i + 2] / 2, v: G[i + 3] === 2 ? 20 : G[i + 3] === 1 ? 5 : 1 });
    return v;
  }
  function serialize(s) { return JSON.stringify(s); }
  function deserialize(j) { try { var s = JSON.parse(j); return s && s.v === 1 ? s : null; } catch (e) { return null; } }

  window.PriTestYukimuraCore = {
    create: create, addPlayer: addPlayer, removePlayer: removePlayer, step: step, applyIntent: applyIntent, players: players,
    calcStats: calcStats, comboBonus: comboBonus, synergies: synergies, weaponMods: weaponMods, ultTier: ultTier, wParams: wParams, prefBonus: prefBonus, prefCounts: prefCounts, canEvolve: canEvolve, moveSpeed: moveSpeed, stepMove: stepMove, inRiver: inRiver,
    snap: snap, unsnap: unsnap, serialize: serialize, deserialize: deserialize, xpNeed: xpNeed, baseStats: baseStats,
    schoolTiers: TK ? TK.schoolTiers : function () { return {}; },
    _rnd: rnd
  };
})();
