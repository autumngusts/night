// 魔法變色龍（mahou）：規則與狀態機（純資料，不碰 DOM）。
// 連線時只有房主跑 applyIntent／tick 並廣播；本機輪流（同一台裝置）時直接在本地跑。
//
// 座標：照片高度＝1、寬度＝ar（照片長寬比）。小人物 fig = { x, y, s（大小）, r（旋轉角度）, f（左右翻轉）, p（動作 id）, e（眼睛 id） }。
// 小人物本身的座標單位見 mahou_data.js 的 BONE（站立全高約 124），fig.s＝1 時全高約為照片高度的 FIG_H。
//
// 一回合：photo（出題者上傳照片／選場景）→ hide（躲藏者擺放並上色）→ seek（鬼點照片找人）→ result → 下一回合或 end。
// 模式：
//   normal：鬼固定 K 人（輪流），第一個鬼出照片；被任一隻鬼找到就算被找到。
//   infect：一開始 1 隻鬼；被找到的人立刻變成鬼（有自己的失誤次數），一起找剩下的人。
//   sync  ：出照片的人輪流；所有人一起躲、再一起找（各找各的，找不到自己）。
(function () {
  "use strict";

  var D = window.PriTestMahouData;
  var FIG_H = 0.2;           // fig.s = 1 時小人物高度佔照片高度的比例
  var STAND_H = 124;
  var S_MIN = 0.5, S_MAX = 1.8;
  var HIT_TOL = 3;           // 命中判定的寬容（小人物自己的單位）

  // ---------------- 骨架幾何 ----------------
  function dir(a) { var r = a * Math.PI / 180; return [Math.sin(r), -Math.cos(r)]; }
  function add(p, d, len) { return [p[0] + d[0] * len, p[1] + d[1] * len]; }
  var POSE_BY_ID = {};
  D.POSES.forEach(function (p) { POSE_BY_ID[p.id] = p; });
  var skelCache = {};

  // 回傳 { segs: [{ a, b, r, part }], head: { x, y, r }, eyes: [[x, y], [x, y]], ha（頭的朝向角度）, box: [x0, y0, x1, y1] }，已以外框中心置中
  function skeleton(poseId) {
    if (skelCache[poseId]) return skelCache[poseId];
    var P = POSE_BY_ID[poseId] || D.POSES[0], a = P.a, B = D.BONE, R = D.RADIUS;
    var pelvis = [0, 0];
    var td = dir(a[0]);
    var neck = add(pelvis, td, B.torso);
    var side = [-td[1], td[0]];               // 軀幹的「右側」方向（站立時＝+x）
    var ha = a[0] + a[1];
    var head = add(neck, dir(ha), B.neck + B.head);
    var sh = add(neck, td, -4);
    var lsh = add(sh, side, -8), rsh = add(sh, side, 8);
    var lhip = add(pelvis, side, -5), rhip = add(pelvis, side, 5);
    var lel = add(lsh, dir(a[2]), B.upper), lha = add(lel, dir(a[3]), B.fore);
    var rel = add(rsh, dir(a[4]), B.upper), rha = add(rel, dir(a[5]), B.fore);
    var lkn = add(lhip, dir(a[6]), B.thigh), lft = add(lkn, dir(a[7]), B.shin);
    var rkn = add(rhip, dir(a[8]), B.thigh), rft = add(rkn, dir(a[9]), B.shin);
    var segs = [
      { a: pelvis, b: neck, r: R.torso, part: "torso" },
      { a: lsh, b: lel, r: R.arm, part: "arm" }, { a: lel, b: lha, r: R.arm, part: "arm" },
      { a: rsh, b: rel, r: R.arm, part: "arm" }, { a: rel, b: rha, r: R.arm, part: "arm" },
      { a: lhip, b: lkn, r: R.leg, part: "leg" }, { a: lkn, b: lft, r: R.leg, part: "leg" },
      { a: rhip, b: rkn, r: R.leg, part: "leg" }, { a: rkn, b: rft, r: R.leg, part: "leg" }
    ];
    var x0 = head[0] - B.head, y0 = head[1] - B.head, x1 = head[0] + B.head, y1 = head[1] + B.head;
    segs.forEach(function (s) {
      [s.a, s.b].forEach(function (p) { x0 = Math.min(x0, p[0] - s.r); y0 = Math.min(y0, p[1] - s.r); x1 = Math.max(x1, p[0] + s.r); y1 = Math.max(y1, p[1] + s.r); });
    });
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    function c(p) { return [p[0] - cx, p[1] - cy]; }
    segs.forEach(function (s) { s.a = c(s.a); s.b = c(s.b); });
    var hc = c(head), hd = dir(ha), hs = [-hd[1], hd[0]];
    var eb = add(hc, hd, 1.5);
    var out = {
      segs: segs, head: { x: hc[0], y: hc[1], r: B.head }, ha: ha,
      eyes: [add(eb, hs, -4.6), add(eb, hs, 4.6)],
      box: [x0 - cx, y0 - cy, x1 - cx, y1 - cy]
    };
    skelCache[poseId] = out;
    return out;
  }

  function distSeg(px, py, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = a[0] + dx * t - px, qy = a[1] + dy * t - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  function figK(fig) { return clamp(fig.s, S_MIN, S_MAX) * FIG_H / STAND_H; }
  // 照片座標 → 小人物座標
  function toLocal(fig, x, y) {
    var k = figK(fig), dx = (x - fig.x) / k, dy = (y - fig.y) / k;
    var r = -(fig.r || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var lx = dx * c - dy * s, ly = dx * s + dy * c;
    if (fig.f) lx = -lx;
    return [lx, ly];
  }
  function toPhoto(fig, lx, ly) {
    var k = figK(fig);
    if (fig.f) lx = -lx;
    var r = (fig.r || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [fig.x + (lx * c - ly * s) * k, fig.y + (lx * s + ly * c) * k];
  }
  function inside(sk, lx, ly, tol) {
    tol = tol || 0;
    var h = sk.head, hx = lx - h.x, hy = ly - h.y;
    if (hx * hx + hy * hy <= (h.r + tol) * (h.r + tol)) return true;
    for (var i = 0; i < sk.segs.length; i++) { var g = sk.segs[i]; if (distSeg(lx, ly, g.a, g.b) <= g.r + tol) return true; }
    return false;
  }
  function hitFig(fig, x, y, tol) {
    if (!fig) return false;
    var l = toLocal(fig, x, y);
    return inside(skeleton(fig.p), l[0], l[1], tol === undefined ? HIT_TOL : tol);
  }

  // ---------------- 工具 ----------------
  function clamp(v, a, b) { v = Number(v); if (!isFinite(v)) v = a; return Math.max(a, Math.min(b, v)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pick(list, v, d) { return list.indexOf(v) >= 0 ? v : d; }
  function newSeed() { return (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0xffff)) >>> 0 || 1; }

  function normCfg(c) {
    c = c || {};
    var modeIds = D.MODES.map(function (m) { return m.id; });
    return {
      mode: pick(modeIds, c.mode, "normal"),
      draw: pick(D.DRAW_TIMES, Number(c.draw), 180),
      seek: pick(D.SEEK_TIMES, Number(c.seek), 90),
      miss: pick(D.MISS_LIMITS, Number(c.miss), 3),
      seekers: Math.round(clamp(c.seekers || 1, 1, D.MAX_PLAYERS - 1)),
      rounds: pick(D.ROUNDS, Number(c.rounds), 0),
      clone: c.clone !== false
    };
  }
  function normFig(f, ar) {
    if (!f || typeof f !== "object") return null;
    var poseIds = D.POSES.map(function (p) { return p.id; }), eyeIds = D.EYES.map(function (e) { return e.id; });
    return {
      x: clamp(f.x, 0, ar || 2), y: clamp(f.y, 0, 1), s: clamp(f.s, S_MIN, S_MAX),
      r: Math.round(clamp(f.r || 0, -180, 180)), f: !!f.f,
      p: pick(poseIds, f.p, "stand"), e: pick(eyeIds, f.e, "round")
    };
  }
  function defaultFig(ar, seedIdx) {
    var n = seedIdx || 0;
    return { x: ar * (0.2 + ((n * 0.37) % 0.6)), y: 0.45 + ((n * 0.23) % 0.3), s: 1, r: 0, f: false, p: D.POSES[n % D.POSES.length].id, e: "round" };
  }

  // ---------------- 一局 ----------------
  // opts: { cfg, players: [{ pid, name }], local, now }
  function newGame(opts) {
    var s = {
      v: 1, cfg: normCfg(opts.cfg), local: !!opts.local,
      order: [], names: {}, scores: {}, act: [],
      round: 0, total: 0, phase: "photo", ph: "", photo: null,
      hide: {}, seek: {}, q: [], qr: false, dl: 0, t0: 0, rs0: {}, res: null, log: [], ev: 0
    };
    (opts.players || []).forEach(function (p) { addPlayer(s, p.pid, p.name); });
    startRound(s, opts.now || Date.now(), opts.active);
    return s;
  }
  function addPlayer(s, pid, name) {
    if (!pid || s.order.indexOf(pid) >= 0) { if (pid && name) s.names[pid] = String(name).slice(0, 16); return false; }
    if (s.order.length >= D.MAX_PLAYERS) return false;
    s.order.push(pid);
    s.names[pid] = String(name || "").slice(0, 16);
    s.scores[pid] = s.scores[pid] || 0;
    return true;
  }
  function seekerCount(s, n) { return Math.max(1, Math.min(s.cfg.seekers, n - 1)); }
  function totalRounds(s) {
    var n = Math.max(2, s.order.length);
    if (s.cfg.rounds) return s.cfg.rounds;
    if (s.cfg.mode === "normal") return Math.ceil(n / seekerCount(s, n));
    return n;
  }
  function log(s, k, a, b, extra) {
    s.ev++;
    var e = { n: s.ev, k: k, a: a || "", b: b || "" };
    if (extra) Object.keys(extra).forEach(function (x) { e[x] = extra[x]; });
    s.log.push(e);
    if (s.log.length > 30) s.log.splice(0, s.log.length - 30);
  }

  // active：本回合在線的玩家（連線時由房主傳入；沒傳就是全部）
  function startRound(s, now, active) {
    s.round++;
    s.total = totalRounds(s);
    var act = s.order.filter(function (p) { return !active || active.indexOf(p) >= 0; });
    if (act.length < 2) act = s.order.slice();
    s.act = act;
    var n = act.length, r = s.round - 1, mode = s.cfg.mode;
    var seekers = [];
    if (mode === "normal") {
      var K = seekerCount(s, n), st = (r * K) % n;
      for (var i = 0; i < K; i++) seekers.push(act[(st + i) % n]);
      s.ph = seekers[0];
    } else if (mode === "infect") {
      seekers = [act[r % n]];
      s.ph = seekers[0];
    } else {
      seekers = act.slice();
      s.ph = act[r % n];
    }
    s.seek = {};
    seekers.forEach(function (p) { s.seek[p] = { miss: 0, out: false, finds: 0, inf: false }; });
    s.hide = {};
    act.forEach(function (p) { if (mode === "sync" || !s.seek[p]) s.hide[p] = { fig: null, done: false, found: {}, camo: -1 }; });
    s.photo = null;
    s.phase = "photo";
    s.q = []; s.qr = false; s.dl = 0; s.t0 = now;
    s.res = null;
    s.rs0 = clone(s.scores);
    log(s, "round", s.ph, "", { r: s.round });
  }

  function hiders(s) { return Object.keys(s.hide).filter(function (p) { return !s.hide[p].skip; }); }
  function zOrder(s) { return s.order.filter(function (p) { return s.hide[p] && !s.hide[p].skip && s.hide[p].fig; }); }
  function isFound(s, h, seeker) {
    var f = s.hide[h] && s.hide[h].found;
    if (!f) return false;
    if (s.cfg.mode === "sync") return !!f[seeker];
    return Object.keys(f).length > 0;
  }
  // 這隻鬼還能找的人
  function targetsFor(s, seeker) {
    return zOrder(s).filter(function (h) { return h !== seeker && !isFound(s, h, seeker); });
  }
  function seekerList(s) { return s.order.filter(function (p) { return s.seek[p]; }); }
  function currentTurn(s) { return s.local ? (s.q[0] || "") : ""; }

  function enterHide(s, now) {
    s.phase = "hide";
    s.t0 = now;
    if (s.local) {
      s.q = s.order.filter(function (p) { return s.hide[p]; });
      s.qr = false; s.dl = 0;
    } else s.dl = s.cfg.draw ? now + s.cfg.draw * 1000 : 0;
    log(s, "hide", s.ph);
  }
  function enterSeek(s, now) {
    Object.keys(s.hide).forEach(function (p) { if (!s.hide[p].fig) s.hide[p].skip = true; });
    s.phase = "seek";
    s.t0 = now;
    if (!hiders(s).length) { enterResult(s, now); return; }
    if (s.local) { s.q = seekerList(s); s.qr = false; s.dl = 0; }
    else s.dl = s.cfg.seek ? now + s.cfg.seek * 1000 : 0;
    log(s, "seek", "");
  }
  function enterResult(s, now) {
    var mode = s.cfg.mode;
    var seekers = seekerList(s);
    var rows = [];
    s.order.forEach(function (p) {
      var h = s.hide[p], k = s.seek[p];
      if (!h && !k) return;
      var row = { pid: p, seeker: !!k, inf: !!(k && k.inf), hid: !!(h && !h.skip), found: false, by: [], finds: k ? k.finds : 0, miss: k ? k.miss : 0, camo: h ? h.camo : -1, bonus: 0 };
      if (row.hid) {
        row.by = Object.keys(h.found);
        if (mode === "sync") {
          var miss = seekers.filter(function (q) { return q !== p && !h.found[q]; }).length;
          row.bonus = miss * D.SCORE.syncEach;
          row.found = row.by.length > 0;
        } else {
          row.found = row.by.length > 0;
          if (!row.found) row.bonus = D.SCORE.survive;
        }
        s.scores[p] = (s.scores[p] || 0) + row.bonus;
      }
      rows.push(row);
    });
    rows.forEach(function (r) { r.delta = (s.scores[r.pid] || 0) - (s.rs0[r.pid] || 0); });
    s.res = rows;
    s.phase = "result";
    s.q = []; s.qr = false; s.dl = 0; s.t0 = now;
    log(s, "result", "");
  }
  function nextRound(s, now, active) {
    if (s.round >= s.total) { s.phase = "end"; s.dl = 0; s.t0 = now; log(s, "end", ""); return; }
    startRound(s, now, active);
  }

  // 本機輪流：目前這一位結束 → 換下一位
  function shiftTurn(s, now) {
    s.q.shift();
    s.qr = false; s.dl = 0;
    if (s.phase === "hide") { if (!s.q.length) enterSeek(s, now); }
    else if (s.phase === "seek") {
      while (s.q.length && (s.seek[s.q[0]].out || !targetsFor(s, s.q[0]).length)) s.q.shift();
      if (!s.q.length || allFound(s)) enterResult(s, now);
    }
  }
  function allFound(s) {
    var hs = zOrder(s);
    if (s.cfg.mode === "sync") return seekerList(s).every(function (k) { return !targetsFor(s, k).length; });
    return hs.every(function (h) { return isFound(s, h); });
  }
  function checkSeekEnd(s, now) {
    if (s.phase !== "seek") return;
    if (s.local) {
      var cur = s.q[0];
      if (allFound(s)) { enterResult(s, now); return; }
      if (cur && (s.seek[cur].out || !targetsFor(s, cur).length)) shiftTurn(s, now);
      return;
    }
    if (allFound(s)) { enterResult(s, now); return; }
    var active = seekerList(s).filter(function (k) { return !s.seek[k].out && targetsFor(s, k).length; });
    if (!active.length) enterResult(s, now);
  }

  function doTap(s, pid, x, y, now) {
    var k = s.seek[pid];
    if (!k || k.out) return false;
    var ar = s.photo ? s.photo.ar : 1.5;
    x = clamp(x, 0, ar); y = clamp(y, 0, 1);
    var cands = targetsFor(s, pid);
    var hit = "";
    for (var i = cands.length - 1; i >= 0; i--) { if (hitFig(s.hide[cands[i]].fig, x, y)) { hit = cands[i]; break; } }
    if (hit) {
      s.hide[hit].found[pid] = now;
      k.finds++;
      var gain = D.SCORE.find;
      if (s.cfg.seek && now - (s.local ? (s.qt || s.t0) : s.t0) < s.cfg.seek * 1000 / 3) gain += D.SCORE.quickBonus;
      s.scores[pid] = (s.scores[pid] || 0) + gain;
      log(s, "found", pid, hit, { x: x, y: y, g: gain });
      if (s.cfg.mode === "infect" && !s.seek[hit] && targetsFor(s, hit).length) {
        s.seek[hit] = { miss: 0, out: false, finds: 0, inf: true };
        if (s.local) s.q.push(hit);
        log(s, "infect", hit, pid);
      }
    } else {
      k.miss++;
      log(s, "miss", pid, "", { x: x, y: y });
      if (s.cfg.miss && k.miss >= s.cfg.miss) { k.out = true; log(s, "out", pid); }
    }
    checkSeekEnd(s, now);
    return true;
  }

  // 意圖：{ a: 動作, ... }。opts.admin＝房主／本機（可強制推進）。回傳是否有改變。
  function applyIntent(s, pid, it, now, opts) {
    if (!s || !it || typeof it !== "object") return false;
    opts = opts || {};
    now = now || Date.now();
    var admin = !!opts.admin;
    var a = it.a;
    if (a === "join") { var ok = addPlayer(s, pid, it.name); if (ok) { s.total = totalRounds(s); log(s, "join", pid); } return ok; }
    if (a === "name") { if (s.names[pid] === undefined) return false; s.names[pid] = String(it.name || "").slice(0, 16); return true; }
    if (s.local) pid = it.as || pid;   // 本機輪流：由畫面指定是誰在操作
    if (a === "photo") {
      if (s.phase !== "photo" || (pid !== s.ph && !admin)) return false;
      var ar = clamp(it.ar || 1.5, 0.4, 2.6);
      if (it.k === "scene") s.photo = { k: "scene", id: String(it.id || D.SCENES[0].id), seed: Math.floor(Number(it.seed) || 1), ar: ar };
      else s.photo = { k: "img", rev: Math.floor(Number(it.rev) || 1), ar: ar };
      log(s, "photo", s.ph);
      enterHide(s, now);
      return true;
    }
    if (a === "turn") {   // 本機：輪到的人按了「我準備好了」
      if (!s.local || !s.q.length || s.qr) return false;
      s.qr = true; s.qt = now;
      var sec = s.phase === "hide" ? s.cfg.draw : s.phase === "seek" ? s.cfg.seek : 0;
      s.dl = sec ? now + sec * 1000 : 0;
      return true;
    }
    if (a === "fig") {
      if (s.phase !== "hide" || !s.hide[pid]) return false;
      if (s.local && (s.q[0] !== pid || !s.qr)) return false;
      var h = s.hide[pid];
      if (it.fig) { var f = normFig(it.fig, s.photo ? s.photo.ar : 2); if (f) h.fig = f; }
      if (typeof it.camo === "number") h.camo = Math.round(clamp(it.camo, 0, 100));
      if (it.done !== undefined) h.done = !!it.done && !!h.fig;
      if (h.done) {
        if (s.local) shiftTurn(s, now);
        else if (Object.keys(s.hide).every(function (p) { return s.hide[p].done; })) enterSeek(s, now);
      }
      return true;
    }
    if (a === "tap") {
      if (s.phase !== "seek") return false;
      if (s.local && (s.q[0] !== pid || !s.qr)) return false;
      return doTap(s, pid, Number(it.x), Number(it.y), now);
    }
    if (a === "giveup") {
      if (s.phase !== "seek" || !s.seek[pid] || s.seek[pid].out) return false;
      if (s.local && s.q[0] !== pid) return false;
      s.seek[pid].out = true;
      log(s, "giveup", pid);
      if (s.local) shiftTurn(s, now); else checkSeekEnd(s, now);
      return true;
    }
    if (a === "next") {   // 房主：推進到下一階段（照片沒出→隨機場景；躲藏／尋找→提前結束；結果→下一回合）
      if (!admin) return false;
      if (s.phase === "photo") {
        var sc = D.SCENES[Math.floor(Math.random() * D.SCENES.length)];
        s.photo = { k: "scene", id: sc.id, seed: newSeed(), ar: 1.5 };
        enterHide(s, now);
      } else if (s.phase === "hide") enterSeek(s, now);
      else if (s.phase === "seek") enterResult(s, now);
      else if (s.phase === "result") nextRound(s, now, it.active);
      else return false;
      return true;
    }
    return false;
  }

  // 時間到的處理。回傳是否有改變。
  function tick(s, now) {
    if (!s || !s.dl || now < s.dl) return false;
    if (s.phase === "hide") {
      if (s.local) shiftTurn(s, now);
      else enterSeek(s, now);
      return true;
    }
    if (s.phase === "seek") {
      if (s.local) {
        var cur = s.q[0];
        if (cur && s.seek[cur]) { s.seek[cur].out = true; log(s, "timeout", cur); }
        shiftTurn(s, now);
      } else { log(s, "timeout", ""); enterResult(s, now); }
      return true;
    }
    s.dl = 0;
    return true;
  }

  function serialize(s) { return JSON.stringify(s); }
  function restore(json) {
    var s = null;
    try { s = typeof json === "string" ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!s || s.v !== 1 || !Array.isArray(s.order)) return null;
    s.cfg = normCfg(s.cfg);
    return s;
  }
  function ranking(s) {
    return s.order.slice().sort(function (a, b) { return ((s.scores[b] || 0) - (s.scores[a] || 0)) || (s.order.indexOf(a) - s.order.indexOf(b)); });
  }
  function roleOf(s, pid) {
    var seeker = !!s.seek[pid], hider = !!(s.hide[pid] && !s.hide[pid].skip);
    if (s.cfg.mode === "sync") return "both";
    if (seeker) return "seeker";
    if (hider) return "hider";
    return "none";
  }

  window.PriTestMahouCore = {
    FIG_H: FIG_H, STAND_H: STAND_H, S_MIN: S_MIN, S_MAX: S_MAX, HIT_TOL: HIT_TOL,
    skeleton: skeleton, inside: inside, toLocal: toLocal, toPhoto: toPhoto, figK: figK, hitFig: hitFig,
    normCfg: normCfg, normFig: normFig, defaultFig: defaultFig, newSeed: newSeed,
    newGame: newGame, applyIntent: applyIntent, tick: tick, serialize: serialize, restore: restore,
    totalRounds: totalRounds, targetsFor: targetsFor, isFound: isFound, seekerList: seekerList, zOrder: zOrder,
    currentTurn: currentTurn, ranking: ranking, roleOf: roleOf, clone: clone
  };
})();
