// 鐵拳教育（fist）：規則引擎。純狀態操作，不碰 DOM（node 也能跑：tools/fist_check/core_check.js）。
// 設計見 docs/fist_game_design.md。
//   Core.create({ seats: [{ cls, ctrl, name } | null ×4], hostCtrl }) → 狀態
//   Core.apply(st, actor, action) → null（成功）或錯誤代碼字串
// 亂數用狀態裡的 seed（mulberry32），連線時只有房主在算，所以不需要各端一致，只是讓重現測試方便。
(function () {
  "use strict";

  var D = window.PriTestFistData;
  if (!D) return;

  // ---------------- 小工具 ----------------
  function rand(st) {
    st.seed = (st.seed + 0x6D2B79F5) | 0;
    var t = st.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function roll(st, n) { return 1 + Math.floor(rand(st) * n); }
  function pick(st, list) { return list[Math.floor(rand(st) * list.length)]; }
  function shuffle(st, list) {
    for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(rand(st) * (i + 1)); var x = list[i]; list[i] = list[j]; list[j] = x; }
    return list;
  }
  function key(x, y) { return x + "," + y; }
  function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < D.W && y < D.H; }
  function tileAt(x, y) { return inMap(x, y) ? D.TILES[y * D.W + x] : null; }
  function neighbors(x, y) {
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(function (p) { return inMap(p[0], p[1]); });
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function log(st, k, data) {
    st.logSeq += 1;
    var e = { i: st.logSeq, k: k };
    Object.keys(data || {}).forEach(function (n) { if (n !== "k" && n !== "i") e[n] = data[n]; });
    st.log.push(e);
    if (st.log.length > 120) st.log.splice(0, st.log.length - 120);
    return e;
  }

  // ---------------- 查詢 ----------------
  function teachers(st) { return st.seats.filter(Boolean); }
  function teacher(st, seat) { return st.seats[seat] || null; }
  function active(st) { return teachers(st).filter(function (h) { return !h.down; }); }
  function teachersAt(st, x, y) { return active(st).filter(function (h) { return h.x === x && h.y === y; }); }
  function bulliesAt(st, x, y) { return st.bullies.filter(function (b) { return b.x === x && b.y === y; }); }
  function victimsAt(st, x, y) { return st.victims.filter(function (v) { return v.x === x && v.y === y; }); }
  function bully(st, u) { return st.bullies.filter(function (b) { return b.u === u; })[0] || null; }
  function victim(st, u) { return st.victims.filter(function (v) { return v.u === u; })[0] || null; }
  function boss(st) { return st.bullies.filter(function (b) { return b.boss; })[0] || null; }
  function enemyDef(b) { return D.ENEMY[b.id]; }
  function hasProof(st, x, y) { return !!st.proof[key(x, y)] || !!st.rec[key(x, y)]; }
  function chapter(st) { return D.CHAPTERS[st.chapter]; }
  function nextUid(st) { st.uid += 1; return st.uid; }

  // 單人時每回合 4 AP、6 步（一個人要顧全校），2 人以上 3 AP、5 步
  function apOf(st) { return teachers(st).length === 1 ? D.AP + 1 : D.AP; }
  function stepsOf(st) { return teachers(st).length === 1 ? D.STEPS + 1 : D.STEPS; }
  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0))); }

  function walled(b) { return !!b.boss && b.wall > 0; }

  // ---------------- 建立 ----------------
  function newTeacher(seat, s) {
    var c = D.CLASS[s.cls];
    var office = D.TILE.office;
    return {
      seat: seat, cls: c.id, ctrl: s.ctrl, name: String(s.name || "").slice(0, 16),
      hp: c.hp, max: c.hp, pow: c.pow, talk: c.talk, sense: c.sense,
      ap: D.AP, steps: D.STEPS, heat: 0, heat0: 0, cd: 0, cdBase: D.SKILL_CD,
      x: office.x, y: office.y, down: 0, done: false, guard: false, perks: []
    };
  }

  function create(opts) {
    var st = {
      v: 1, seed: (opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 2147483647)) | 0,
      seats: [null, null, null, null], hostCtrl: opts.hostCtrl || null,
      chapter: 0, round: 1, phase: "story",
      dark: 0, comp: 0, evid: 0, hope: 0,
      bullies: [], victims: [], proof: {}, rec: {}, searched: {},
      perkOpts: {}, perkPicked: {}, loseWhy: null,
      log: [], logSeq: 0, uid: 0
    };
    (opts.seats || []).forEach(function (s, i) {
      if (s && D.CLASS[s.cls] && i < 4) st.seats[i] = newTeacher(i, s);
    });
    setupChapter(st);
    return st;
  }

  function setupChapter(st) {
    st.round = 1;
    st.phase = "story";
    st.bullies = [];
    st.victims = [];
    st.proof = {};
    st.rec = {};
    st.searched = {};
    st.spawnAcc = 0;
    var office = D.TILE.office;
    teachers(st).forEach(function (h) {
      h.hp = h.max; h.ap = apOf(st); h.steps = stepsOf(st); h.heat = h.heat0; h.cd = 0; h.down = 0;
      h.x = office.x; h.y = office.y; h.done = false; h.guard = false;
    });
    // 開場就有兩件事件
    spawnIncident(st);
    spawnIncident(st);
  }

  // ---------------- 生成 ----------------
  function addBully(st, id, x, y, extra) {
    var d = D.ENEMY[id];
    var b = { u: nextUid(st), id: id, hp: d.hp, max: d.hp, x: x, y: y, stun: false };
    Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; });
    st.bullies.push(b);
    return b;
  }

  function spawnIncident(st) {
    var bt = boss(st);
    var spots = D.TILES.filter(function (t) {
      if (t.type !== "blind" && t.type !== "class") return false;
      if (teachersAt(st, t.x, t.y).length || bulliesAt(st, t.x, t.y).length || victimsAt(st, t.x, t.y).length) return false;
      return !(bt && bt.x === t.x && bt.y === t.y);
    });
    if (!spots.length) return null;
    var t = pick(st, spots);
    var ch = chapter(st);
    var group = pick(st, ch.groups);
    var names = D.VICTIM_NAMES.zh.length;
    st.victims.push({ u: nextUid(st), name: Math.floor(rand(st) * names), hp: ch.victimHp, max: ch.victimHp, x: t.x, y: t.y });
    group.forEach(function (id) { addBully(st, id, t.x, t.y); });
    log(st, "spawn", { t: t.id, n: group.length });
    return t;
  }

  function spawnBoss(st) {
    var ch = chapter(st);
    var d = D.ENEMY[ch.boss];
    var t = D.TILE[d.at];
    var extra = Math.max(0, teachers(st).length - 1);
    var b = addBully(st, d.id, t.x, t.y, { boss: true, wall: d.wall + extra, wallMax: d.wall + extra });
    b.hp = b.max = d.hp + extra * 3;
    // 手下（esc）在權力者身邊站崗，不會移動
    addBully(st, d.esc, t.x, t.y, { esc: true });
    addBully(st, d.esc, t.x, t.y, { esc: true });
    log(st, "boss", { e: d.id, t: t.id });
  }

  // ---------------- 傷害 ----------------
  // 對霸凌者造成傷害；回傳實際傷害（被權力之壁擋下回傳 -1）
  function hurtBully(st, b, d, how, by) {
    if (st.bullies.indexOf(b) < 0) return 0; // 同一招打多人時，前面已經打倒權力者而清場
    if (walled(b)) return -1;
    var dmg = Math.max(0, Math.min(b.hp, d));
    b.hp -= dmg;
    if (b.hp <= 0) defeatBully(st, b, how, by);
    return dmg;
  }

  function defeatBully(st, b, how, by) {
    st.bullies = st.bullies.filter(function (x) { return x !== b; });
    log(st, "defeat", { e: b.id, how: how, s: by });
    if (how === "talk") st.hope += 1;
    if (b.boss) { clearChapter(st); return; }
    resolveTile(st, b.x, b.y);
  }

  // 一格沒有霸凌者了：學生被救出、證據標記清掉（錄音筆的格子保留）
  function resolveTile(st, x, y) {
    if (bulliesAt(st, x, y).length) return;
    victimsAt(st, x, y).forEach(function (v) {
      st.victims = st.victims.filter(function (z) { return z !== v; });
      st.hope += 1;
      st.evid += 1;
      st.dark = Math.max(0, st.dark - 1);
      teachersAt(st, x, y).forEach(function (h) { h.heat = Math.min(D.MAX_HEAT, h.heat + 1); });
      log(st, "rescue", { v: v.name });
    });
    delete st.proof[key(x, y)];
  }

  function hurtTeacher(st, h, d, src) {
    var dmg = Math.min(h.hp, d);
    h.hp -= dmg;
    log(st, "hitT", { e: src, s: h.seat, d: dmg });
    if (h.hp <= 0) {
      var n = D.TILE.nurse;
      h.down = 2; h.x = n.x; h.y = n.y; h.guard = false; h.done = true; h.ap = 0; h.steps = 0;
      st.dark += 1; // 老師倒下，學生們失去依靠
      log(st, "downT", { s: h.seat });
    }
  }

  function hurtVictim(st, v, d, src) {
    var dmg = Math.min(v.hp, d);
    v.hp -= dmg;
    st.dark += 1;
    log(st, "hitV", { e: src, v: v.name, d: dmg });
    if (v.hp <= 0) {
      st.victims = st.victims.filter(function (z) { return z !== v; });
      st.dark += 2;
      log(st, "broken", { v: v.name });
    }
  }

  function addComp(st, n) { st.comp = clamp(st.comp + n, 0, D.MAX_COMP); }
  function gainHeat(h, n) { h.heat = Math.min(D.MAX_HEAT, h.heat + n); }

  // ---------------- 行動 ----------------
  function canMoveTo(h, x, y, range) {
    return inMap(x, y) && !(h.x === x && h.y === y) && dist(h, { x: x, y: y }) <= range;
  }

  function spend(h, n) { h.ap -= n; }

  function act(st, h, a) {
    if (h.down) return "down";
    if (h.done) return "done";
    var b, d, r;
    switch (a.t) {
      // 移動不花 AP，花步數（拖曳老師到目的地；地圖全部上下左右相通，所以步數＝曼哈頓距離）
      case "move":
        if (!canMoveTo(h, a.x, a.y, h.steps)) return h.steps > 0 ? "far" : "no_steps";
        h.steps -= dist(h, { x: a.x, y: a.y });
        log(st, "move", { s: h.seat, t: tileAt(a.x, a.y).id, fx: h.x, fy: h.y });
        h.x = a.x; h.y = a.y; h.guard = false;
        return null;

      // 格鬥：畫面上即時對打（fist_fight.js），打完把結果送進來。合作遊戲，結果只做範圍檢查
      case "fight":
        if (h.ap < 1) return "no_ap";
        if (!bulliesAt(st, h.x, h.y).length) return "no_target";
        spend(h, 1);
        return fight(st, h, a.r || {});

      case "talk":
        if (h.ap < 1) return "no_ap";
        b = bully(st, a.b);
        if (!b || b.x !== h.x || b.y !== h.y) return "no_target";
        spend(h, 1);
        d = h.talk + roll(st, 3) - 1;
        if (enemyDef(b).stubborn) d = Math.ceil(d / 2);
        gainHeat(h, 1);
        if (walled(b)) { log(st, "wall", { s: h.seat, e: b.id }); return null; }
        log(st, "talk", { s: h.seat, e: b.id, d: Math.min(d, b.hp) });
        hurtBully(st, b, d, "talk", h.seat);
        return null;

      case "search":
        if (h.ap < 1) return "no_ap";
        if (!bulliesAt(st, h.x, h.y).length) return "no_target";
        if (st.searched[key(h.x, h.y)]) return "searched";
        spend(h, 1);
        st.searched[key(h.x, h.y)] = 1;
        st.proof[key(h.x, h.y)] = 1;
        r = 1 + (h.sense >= 3 && roll(st, 6) <= h.sense - 1 ? 1 : 0);
        st.evid += r;
        log(st, "search", { s: h.seat, n: r });
        return null;

      case "guard":
        if (h.ap < 1) return "no_ap";
        var vs = victimsAt(st, h.x, h.y);
        if (!vs.length) return "no_target";
        spend(h, 1);
        vs.forEach(function (v) { v.hp = Math.min(v.max, v.hp + 2); });
        h.guard = true;
        gainHeat(h, 1);
        log(st, "guard", { s: h.seat });
        return null;

      case "rest":
        if (h.ap < 1) return "no_ap";
        var tt = tileAt(h.x, h.y).type;
        if (tt !== "office" && tt !== "nurse") return "not_here";
        if (h.hp >= h.max) return "full";
        spend(h, 1);
        d = Math.min(3, h.max - h.hp);
        h.hp += d;
        log(st, "rest", { s: h.seat, n: d });
        return null;

      case "expose":
        if (h.ap < 1) return "no_ap";
        b = boss(st);
        if (!b || b.wall <= 0) return "no_target";
        var here = b.x === h.x && b.y === h.y;
        var bc = tileAt(h.x, h.y).type === "broadcast";
        if (!here && !bc) return "not_here";
        if (st.evid < 1) return "no_evid";
        spend(h, 1);
        st.evid -= 1;
        d = Math.min(b.wall, here ? 2 : 1);
        b.wall -= d;
        log(st, "expose", { s: h.seat, e: b.id, n: d, bc: !here, left: b.wall });
        return null;

      case "skill":
        if (h.ap < 1) return "no_ap";
        if (h.cd > 0) return "cooldown";
        return skill(st, h, a);

      case "ult":
        if (D.FIGHT_ULTS[D.CLASS[h.cls].ult.id]) return "in_fight";
        if (h.ap < 2) return "no_ap";
        if (h.heat < D.MAX_HEAT) return "no_heat";
        return ult(st, h);
    }
    return "bad";
  }

  // r：{ hits: [{ b: uid, d: 傷害, how: "fist"|"talk" }], taken: 老師受到的傷害, combo: 最大連段, ult: 有沒有放必殺, fist: 有沒有用拳腳打到一般霸凌者 }
  function fight(st, h, r) {
    var tx = h.x, ty = h.y;
    var c = D.CLASS[h.cls];
    var here = bulliesAt(st, tx, ty);
    var src = here[0].id;
    var ultUsed = !!r.ult && h.heat >= D.MAX_HEAT && !!D.FIGHT_ULTS[c.ult.id];
    var hits = (Array.isArray(r.hits) ? r.hits : []).map(function (x) {
      var b = x && bully(st, x.b);
      if (!b || b.x !== tx || b.y !== ty || walled(b)) return null;
      return { b: b, d: clampInt(x.d, 0, b.hp), how: x.how === "talk" && ultUsed ? "talk" : "fist" };
    }).filter(function (x) { return x && x.d > 0; });
    var fist = !!r.fist && hits.some(function (x) { return x.how === "fist" && !x.b.boss; });
    var comp = fist && !hasProof(st, tx, ty);
    var combo = clampInt(r.combo, 0, 999);
    var kos = hits.filter(function (x) { return x.d >= x.b.hp; }).length;
    var total = hits.reduce(function (n, x) { return n + x.d; }, 0);
    if (comp) addComp(st, 1);
    log(st, "fight", { s: h.seat, d: total, n: kos, combo: combo, comp: comp });
    var taken = clampInt(r.taken, 0, h.hp);
    if (ultUsed) {
      h.heat = 0;
      log(st, "ult", { s: h.seat, sk: c.ult.id });
      if (c.ult.id === "truth") addComp(st, -1);
    } else gainHeat(h, 1 + (combo >= 8 ? 1 : 0) + (kos ? 1 : 0));
    hits.forEach(function (x) { hurtBully(st, x.b, x.d, x.how, h.seat); });
    if (ultUsed && c.ult.id === "reaction") bulliesAt(st, tx, ty).forEach(function (b) { if (!b.boss) b.stun = true; });
    // 傳說特攻服：餘波打到相鄰格
    if (ultUsed && c.ult.id === "legend") {
      st.bullies.filter(function (b) { return dist(b, { x: tx, y: ty }) === 1; }).forEach(function (b) { hurtBully(st, b, 4, "fist", h.seat); });
    }
    if (taken > 0 && st.phase === "play") hurtTeacher(st, h, taken, src);
    return null;
  }

  function skill(st, h, a) {
    var c = D.CLASS[h.cls];
    var here = bulliesAt(st, h.x, h.y);
    var done = function (extra) {
      spend(h, 1); h.cd = h.cdBase;
      var e = { s: h.seat, sk: c.skill.id };
      Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
      log(st, "skill", e);
      return null;
    };
    switch (c.skill.id) {
      case "dash":
        h.steps += 4;
        return done();
      case "glare":
        if (!here.length) return "no_target";
        done();
        here.slice().forEach(function (b) { if (!b.boss) { b.stun = true; hurtBully(st, b, 1, "fist", h.seat); } });
        return null;
      case "counsel":
        var vs = st.victims.filter(function (v) { return dist(v, h) <= 1; });
        if (!vs.length) return "no_target";
        vs.forEach(function (v) { v.hp = Math.min(v.max, v.hp + 3); });
        return done({ n: vs.length });
      case "recorder":
        if (st.rec[key(h.x, h.y)]) return "searched";
        st.rec[key(h.x, h.y)] = 1;
        return done({ t: tileAt(h.x, h.y).id });
      case "cctv":
        if (!inMap(a.x, a.y) || !bulliesAt(st, a.x, a.y).some(function (b) { return !b.boss; })) return "no_target";
        st.proof[key(a.x, a.y)] = 1;
        st.evid += 1;
        return done({ t: tileAt(a.x, a.y).id });
      case "rally":
        var hs = teachersAt(st, h.x, h.y);
        hs.forEach(function (x) { x.hp = Math.min(x.max, x.hp + 2); gainHeat(x, 1); });
        return done({ n: hs.length });
    }
    return "bad";
  }

  // 地圖上放的必殺技（不打人的兩種）；打人的必殺技在格鬥畫面裡放，結果由 fight() 處理
  function ult(st, h) {
    var c = D.CLASS[h.cls];
    var fire = function () { spend(h, 2); h.heat = 0; log(st, "ult", { s: h.seat, sk: c.ult.id }); };
    switch (c.ult.id) {
      case "viral":
        fire();
        st.evid += 3;
        addComp(st, -2);
        return null;
      case "speech":
        fire();
        st.dark = Math.max(0, st.dark - 3);
        var b = boss(st);
        if (b && b.wall > 0) b.wall = Math.max(0, b.wall - 3);
        return null;
    }
    return "bad";
  }

  // ---------------- 校園階段 ----------------
  function stepToward(st, b, target) {
    var best = neighbors(b.x, b.y).filter(function (p) { return dist({ x: p[0], y: p[1] }, target) < dist(b, target); });
    if (!best.length) return;
    var p = pick(st, best);
    b.x = p[0]; b.y = p[1];
  }

  function bullyTurn(st, b) {
    if (st.bullies.indexOf(b) < 0) return;
    var d = enemyDef(b);
    if (b.stun) { b.stun = false; log(st, "stunned", { e: b.id }); return; }
    var ts = teachersAt(st, b.x, b.y);
    var vs = victimsAt(st, b.x, b.y);
    var guard = ts.filter(function (h) { return h.guard; });
    if (d.coward && ts.length && !b.esc) {
      var away = neighbors(b.x, b.y).filter(function (p) { return !teachersAt(st, p[0], p[1]).length; });
      if (away.length) {
        var from = { x: b.x, y: b.y };
        var p = pick(st, away);
        b.x = p[0]; b.y = p[1];
        log(st, "flee", { e: b.id });
        resolveTile(st, from.x, from.y);
        return;
      }
    }
    if (ts.length && (d.fierce || !vs.length)) {
      var tgt = guard[0] || ts.slice().sort(function (x, y) { return x.hp - y.hp || x.seat - y.seat; })[0];
      hurtTeacher(st, tgt, d.atk, b.id);
      return;
    }
    if (vs.length) {
      if (guard.length) { hurtTeacher(st, guard[0], d.atk, b.id); return; }
      hurtVictim(st, vs[0], d.atk, b.id);
      return;
    }
    if (b.boss || b.esc) return;
    // 沒事做：往最近的受害學生移動
    var near = st.victims.slice().sort(function (x, y) { return dist(b, x) - dist(b, y); })[0];
    if (near) stepToward(st, b, near);
  }

  function schoolPhase(st) {
    log(st, "school", { n: st.round });
    st.bullies.slice().sort(function (a, b) { return a.u - b.u; }).forEach(function (b) {
      if (st.phase === "play") bullyTurn(st, b);
    });
    if (st.phase !== "play") return;

    // 錄音筆
    Object.keys(st.rec).forEach(function (k) {
      var p = k.split(",");
      if (bulliesAt(st, +p[0], +p[1]).length) { st.evid += 1; log(st, "rec", { t: tileAt(+p[0], +p[1]).id }); }
    });
    // 霸凌者被嚇跑或移走的格子：學生被救出
    st.victims.slice().forEach(function (v) { if (st.victims.indexOf(v) >= 0) resolveTile(st, v.x, v.y); });
    // 證據標記：沒有霸凌者的格子清掉
    Object.keys(st.proof).forEach(function (k) {
      var p = k.split(",");
      if (!bulliesAt(st, +p[0], +p[1]).length) delete st.proof[k];
    });

    // 霸凌主謀叫人
    if (st.round % 2 === 0) {
      st.bullies.filter(function (b) { return enemyDef(b).summon; }).forEach(function (b) {
        if (bulliesAt(st, b.x, b.y).length < 3) { addBully(st, "lackey", b.x, b.y); log(st, "summon", { e: b.id }); }
      });
    }

    var bt = boss(st);
    if (bt) {
      // 權力者輪流施壓：奇數回合黑暗度 +1，偶數回合投訴 +1
      if (st.round % 2 === 1) st.dark += 1;
      var esc = st.bullies.filter(function (b) { return b.esc; }).length;
      if (esc < 2 && st.round % 2 === 0) { addBully(st, enemyDef(bt).esc, bt.x, bt.y, { esc: true }); log(st, "summon", { e: bt.id }); }
      if (st.round % 2 === 0) { addComp(st, 1); log(st, "pressure", { e: bt.id }); }
    }

    if (st.round + 1 === D.BOSS_ROUND && !bt) spawnBoss(st);

    // 事件發生率依人數（每回合期望件數），權力者登場後減半；小數累積到 1 才發生
    var rate = D.SPAWN_RATE[teachers(st).length] || 1;
    if (st.round + 1 >= D.BOSS_ROUND) rate /= 2;
    st.spawnAcc = (st.spawnAcc || 0) + rate;
    while (st.spawnAcc >= 1) { st.spawnAcc -= 1; spawnIncident(st); }

    if (checkLose(st)) return;
    newRound(st);
  }

  function checkLose(st) {
    st.dark = Math.min(st.dark, D.MAX_DARK);
    var why = null;
    if (st.dark >= D.MAX_DARK) why = "dark";
    else if (st.comp >= D.MAX_COMP) why = "comp";
    if (!why) return false;
    st.phase = "lose";
    st.loseWhy = why;
    log(st, "lose", { why: why });
    return true;
  }

  function newRound(st) {
    st.round += 1;
    st.searched = {};
    teachers(st).forEach(function (h) {
      h.guard = false;
      h.done = false;
      if (h.cd > 0) h.cd -= 1;
      if (h.down > 0) {
        h.down -= 1;
        if (h.down === 0) { h.hp = Math.ceil(h.max / 2); log(st, "reviveT", { s: h.seat }); }
      }
      h.ap = h.down ? 0 : apOf(st);
      h.steps = h.down ? 0 : stepsOf(st);
      if (h.down) h.done = true;
    });
    log(st, "round", { n: st.round });
    maybeSchool(st);
  }

  function maybeSchool(st) {
    if (st.phase !== "play") return;
    var left = active(st).filter(function (h) { return !h.done; });
    if (!left.length) schoolPhase(st);
  }

  // ---------------- 章節 ----------------
  function clearChapter(st) {
    st.victims.forEach(function (v) { st.hope += 1; log(st, "rescue", { v: v.name }); });
    st.victims = [];
    st.bullies = [];
    log(st, "clear", { ch: st.chapter });
    if (st.chapter >= D.CHAPTERS.length - 1) { st.phase = "win"; log(st, "win", {}); return; }
    st.phase = "perk";
    st.perkOpts = {};
    st.perkPicked = {};
    teachers(st).forEach(function (h) { st.perkOpts[h.seat] = shuffle(st, D.PERKS.slice()).slice(0, 3); });
  }

  function applyPerk(h, k) {
    if (k === "maxhp") { h.max += 3; }
    else if (k === "pow") h.pow += 1;
    else if (k === "talk") h.talk += 1;
    else if (k === "sense") h.sense += 1;
    else if (k === "cd") h.cdBase = Math.max(1, h.cdBase - 1);
    else if (k === "heat") h.heat0 = Math.min(D.MAX_HEAT, h.heat0 + 2);
    h.perks.push(k);
  }

  function nextChapter(st) {
    st.chapter += 1;
    st.dark = Math.floor(st.dark / 3);
    log(st, "chapter", { ch: st.chapter });
    setupChapter(st);
  }

  // ---------------- 對外入口 ----------------
  function apply(st, actor, a) {
    if (!st || !a || typeof a.t !== "string") return "bad";
    var h;
    if (a.t === "take") {
      h = teacher(st, a.s);
      if (!h || actor !== st.hostCtrl) return "not_yours";
      h.ctrl = actor;
      return null;
    }
    if (a.t === "go") {
      if (st.phase !== "story") return "phase";
      if (!teachers(st).some(function (x) { return x.ctrl === actor; }) && actor !== st.hostCtrl) return "not_yours";
      st.phase = "play";
      log(st, "round", { n: st.round });
      return null;
    }
    h = teacher(st, a.s);
    if (!h) return "bad";
    if (h.ctrl !== actor) return "not_yours";
    if (a.t === "perk") {
      if (st.phase !== "perk") return "phase";
      var opts = st.perkOpts[h.seat] || [];
      if (st.perkPicked[h.seat] || opts.indexOf(a.k) < 0) return "bad";
      st.perkPicked[h.seat] = a.k;
      applyPerk(h, a.k);
      log(st, "perk", { s: h.seat, pk: a.k });
      if (teachers(st).every(function (x) { return st.perkPicked[x.seat]; })) nextChapter(st);
      return null;
    }
    if (st.phase !== "play") return "phase";
    if (a.t === "end") {
      if (h.down) return "down";
      h.done = a.on !== false;
      maybeSchool(st);
      return null;
    }
    var err = act(st, h, a);
    if (err) return err;
    // 格鬥中老師倒下也會讓黑暗度上升，老師階段就要判定失敗
    if (st.phase === "play" && checkLose(st)) return null;
    if (st.phase === "play" && h.ap <= 0 && h.steps <= 0) h.done = true;
    if (st.phase === "play") maybeSchool(st);
    return null;
  }

  window.PriTestFistCore = {
    create: create, apply: apply,
    teachers: teachers, teacher: teacher, active: active,
    teachersAt: teachersAt, bulliesAt: bulliesAt, victimsAt: victimsAt,
    bully: bully, victim: victim, boss: boss, hasProof: hasProof, tileAt: tileAt,
    dist: dist, canMoveTo: canMoveTo, stepsOf: stepsOf, apOf: apOf, walled: walled, key: key
  };
})();
