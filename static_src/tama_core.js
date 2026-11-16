// 百鬼轉珠（tama）：規則核心。盤面（生成、消除判定、落下、連鎖）、傷害／回復計算、回合進行、技能、成長。
// 不碰 DOM，也不讀寫 localStorage；畫面（tama_board.js／tama.js）只呼叫這裡的函式並依回傳的事件演出。
// 規則依據 docs/tama_game_design.md（§3 轉珠、§4 傷害、§5 隊伍、§6 妖怪、§7 成長）。
// 瀏覽器掛在 window.PriTestTamaCore；Node 測試（tools/tama_check/）用 require 載入。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestTamaData || (typeof require === "function" ? require("./tama_data.js") : null);

  var ROWS = 5, COLS = 6;
  var BASE_TIME_MS = 5000;     // §3 轉珠時間 5 秒
  var JAM = "jam";

  // ---------------- 亂數（可指定種子，方便重現與測試） ----------------
  function makeRng(seed) {
    var a = (seed == null ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function randomOrb(rng) { return pick(rng, D.ORBS); }

  // ---------------- 盤面 ----------------
  function emptyBoard() {
    var b = [];
    for (var r = 0; r < ROWS; r++) { b.push([]); for (var c = 0; c < COLS; c++) b[r].push(null); }
    return b;
  }
  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

  // 開局／重組：逐格填色，避開會和左邊兩格或上面兩格形成 3 連的顏色（§3-1）
  function newBoard(rng) {
    var b = emptyBoard();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var ban = {};
        if (c >= 2 && b[r][c - 1] === b[r][c - 2]) ban[b[r][c - 1]] = 1;
        if (r >= 2 && b[r - 1][c] === b[r - 2][c]) ban[b[r - 1][c]] = 1;
        var opts = D.ORBS.filter(function (o) { return !ban[o]; });
        b[r][c] = pick(rng, opts);
      }
    }
    return b;
  }

  // 找出所有被消除的組（§3-4）：先標記直／橫 3 連以上的格子，再把同色相鄰的標記格合併為一組
  function findGroups(b) {
    var mark = [], r, c, k;
    for (r = 0; r < ROWS; r++) { mark.push([]); for (c = 0; c < COLS; c++) mark[r].push(false); }
    for (r = 0; r < ROWS; r++) {
      c = 0;
      while (c < COLS) {
        k = c;
        while (k + 1 < COLS && b[r][c] && b[r][k + 1] === b[r][c]) k++;
        if (b[r][c] && k - c + 1 >= 3) for (var x = c; x <= k; x++) mark[r][x] = true;
        c = k + 1;
      }
    }
    for (c = 0; c < COLS; c++) {
      r = 0;
      while (r < ROWS) {
        k = r;
        while (k + 1 < ROWS && b[r][c] && b[k + 1][c] === b[r][c]) k++;
        if (b[r][c] && k - r + 1 >= 3) for (var y = r; y <= k; y++) mark[y][c] = true;
        r = k + 1;
      }
    }
    var seen = [], groups = [];
    for (r = 0; r < ROWS; r++) { seen.push([]); for (c = 0; c < COLS; c++) seen[r].push(false); }
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (!mark[r][c] || seen[r][c]) continue;
        var color = b[r][c], cells = [], stack = [[r, c]];
        seen[r][c] = true;
        while (stack.length) {
          var p = stack.pop();
          cells.push(p);
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
            var nr = p[0] + d[0], nc = p[1] + d[1];
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
            if (seen[nr][nc] || !mark[nr][nc] || b[nr][nc] !== color) return;
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          });
        }
        groups.push({ color: color, cells: cells, count: cells.length });
      }
    }
    return groups;
  }

  function clearGroups(b, groups) {
    var nb = cloneBoard(b);
    groups.forEach(function (g) { g.cells.forEach(function (p) { nb[p[0]][p[1]] = null; }); });
    return nb;
  }

  // 落下與補珠：回傳新盤面與每顆珠的移動（新珠的 from 為負數列，代表從盤面上方掉下）
  function drop(b, rng) {
    var nb = emptyBoard(), falls = [];
    for (var c = 0; c < COLS; c++) {
      var dest = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) {
        if (b[r][c] == null) continue;
        nb[dest][c] = b[r][c];
        if (dest !== r) falls.push({ c: c, from: r, to: dest, color: b[r][c] });
        dest--;
      }
      var k = 1;
      for (var y = dest; y >= 0; y--) {
        var o = randomOrb(rng);
        nb[y][c] = o;
        falls.push({ c: c, from: -k, to: y, color: o, fresh: true });
        k++;
      }
    }
    return { board: nb, falls: falls };
  }

  // 放手後的完整結算（含天降連鎖）。steps 供畫面逐段演出。
  function resolve(b, rng) {
    var steps = [], all = [], cur = b, guard = 0;
    while (guard++ < 50) {
      var g = findGroups(cur);
      if (!g.length) break;
      var cleared = clearGroups(cur, g);
      var d = drop(cleared, rng);
      steps.push({ groups: g, cleared: cleared, falls: d.falls, board: d.board });
      all = all.concat(g);
      cur = d.board;
    }
    return { steps: steps, groups: all, board: cur };
  }

  // ---------------- 角色能力與成長（§5） ----------------
  function heroStats(id, lv) {
    var h = D.HERO_BY_ID[id], base = D.BASE[h.rarity], k = 1 + 0.06 * ((lv || 1) - 1);
    return { hp: Math.round(base.hp * k), atk: Math.round(base.atk * k), rcv: Math.round(base.rcv * k) };
  }
  function expToNext(lv) { return 40 * lv; }
  // entry = { lv, exp }（exp 為目前等級內累積）；回傳升了幾級
  function gainExp(entry, amount) {
    var ups = 0;
    entry.exp = (entry.exp || 0) + amount;
    while (entry.lv < D.MAX_LV && entry.exp >= expToNext(entry.lv)) {
      entry.exp -= expToNext(entry.lv);
      entry.lv++;
      ups++;
    }
    if (entry.lv >= D.MAX_LV) entry.exp = 0;
    return ups;
  }

  // ---------------- 隊長技能（§5） ----------------
  function leaderSkills(state) { var h = D.HERO_BY_ID[state.members[0].id]; return h ? h.ls : []; }
  function leaderAtkMult(ls, attr, combos) {
    var m = 1;
    ls.forEach(function (s) {
      if (s.t === "atk" && s.attr === attr) m *= s.m;
      if (s.t === "combo" && combos >= s.min && (!s.attr || s.attr === attr)) m *= s.m;
    });
    return m;
  }
  function leaderSum(ls, t, key) {
    var v = 0;
    ls.forEach(function (s) { if (s.t === t) v += s[key]; });
    return v;
  }

  // §2 屬性相剋
  var BEATS = { fire: "wood", wood: "water", water: "fire", light: "dark", dark: "light" };
  function advantage(atk, def) {
    if (BEATS[atk] === def) return 2;
    if (BEATS[def] === atk && atk !== "light" && atk !== "dark") return 0.5;
    return 1;
  }

  // ---------------- 戰鬥 ----------------
  function spawnWave(state) {
    var st = state.stage, keys = st.waves[state.waveIdx];
    state.enemies = keys.map(function (key) {
      var e = D.ENEMIES[key], f = st.f;
      var hp = Math.round(e.hp * f);
      return { key: key, attr: e.attr, hp: hp, hpMax: hp, atk: Math.round(e.atk * f), def: Math.round(e.def * f),
        cd: e.cd, cdMax: e.cd, sp: e.sp || null, boss: !!e.boss, acts: 0 };
    });
    state.target = null;
  }

  // team = [{ id, lv }]，第 1 位是隊長
  function createBattle(stageId, team, seed) {
    var rng = makeRng(seed);
    var state = {
      stage: D.STAGE_BY_ID[stageId], waveIdx: 0, enemies: [], target: null,
      members: team.map(function (t) {
        var h = D.HERO_BY_ID[t.id], s = heroStats(t.id, t.lv);
        return { id: t.id, attr: h.attr, lv: t.lv, hp: s.hp, atk: s.atk, rcv: s.rcv, cd: h.as.cd, cdMax: h.as.cd };
      }),
      buffs: [], turn: 0, over: null, rng: rng, board: newBoard(rng)
    };
    var ls = leaderSkills(state), hpMult = 1;
    ls.forEach(function (s) { if (s.t === "hp") hpMult *= s.m; });
    state.hpMax = Math.round(state.members.reduce(function (a, m) { return a + m.hp; }, 0) * hpMult);
    state.hp = state.hpMax;
    state.rcvSum = state.members.reduce(function (a, m) { return a + m.rcv; }, 0);
    spawnWave(state);
    return state;
  }

  function moveTimeMs(state) {
    var s = leaderSum(leaderSkills(state), "time", "s");
    state.buffs.forEach(function (b) { if (b.t === "time") s += b.s; });
    return BASE_TIME_MS + s * 1000;
  }
  function buffAtkMult(state, attr) {
    var m = 1;
    state.buffs.forEach(function (b) { if (b.t === "buff" && b.attr === attr) m *= b.m; });
    return m;
  }
  function aliveIdx(state) {
    var out = [];
    state.enemies.forEach(function (e, i) { if (e.hp > 0) out.push(i); });
    return out;
  }
  function currentTarget(state) {
    if (state.target != null && state.enemies[state.target] && state.enemies[state.target].hp > 0) return state.target;
    var a = aliveIdx(state);
    return a.length ? a[0] : -1;
  }
  function setTarget(state, idx) {
    if (state.enemies[idx] && state.enemies[idx].hp > 0) state.target = (state.target === idx ? null : idx);
  }
  function hitEnemy(state, ei, raw, attr, events, m) {
    var e = state.enemies[ei];
    var dmg = Math.max(1, Math.floor(raw * advantage(attr, e.attr)) - e.def);
    e.hp = Math.max(0, e.hp - dmg);
    events.push({ t: "hit", m: m, e: ei, dmg: dmg, attr: attr, adv: advantage(attr, e.attr) });
    if (e.hp <= 0) events.push({ t: "kill", e: ei });
  }

  // §4：計算每位成員本回合的傷害（不套用到妖怪），供演出與測試
  function computeAttack(state, groups) {
    var combos = groups.length, comboMult = combos ? 1 + 0.25 * (combos - 1) : 0;
    var ls = leaderSkills(state);
    var out = state.members.map(function (m) {
      var mine = groups.filter(function (g) { return g.color === m.attr; });
      if (!mine.length) return { raw: 0, aoe: false };
      var base = 0, aoe = false;
      mine.forEach(function (g) { base += m.atk * (1 + 0.25 * (g.count - 3)); if (g.count >= 5) aoe = true; });
      return { raw: base * comboMult * leaderAtkMult(ls, m.attr, combos) * buffAtkMult(state, m.attr), aoe: aoe };
    });
    var hearts = 0;
    groups.forEach(function (g) { if (g.color === "heart") hearts += 1 + 0.25 * (g.count - 3); });
    return { combos: combos, comboMult: comboMult, members: out, heal: Math.floor(hearts * state.rcvSum * comboMult) };
  }

  function heal(state, amount, events, src) {
    var before = state.hp;
    state.hp = Math.min(state.hpMax, state.hp + Math.max(0, Math.floor(amount)));
    if (state.hp > before) events.push({ t: "heal", amount: state.hp - before, src: src });
  }

  // 打倒整波後：進下一波或勝利。回傳 true 表示這一波已清空。
  function checkWave(state, events) {
    if (aliveIdx(state).length) return false;
    if (state.waveIdx + 1 < state.stage.waves.length) {
      state.waveIdx++;
      spawnWave(state);
      events.push({ t: "wave", wave: state.waveIdx });
    } else {
      state.over = "win";
      events.push({ t: "win" });
    }
    return true;
  }

  function endTurn(state) {
    state.members.forEach(function (m) { if (m.cd > 0) m.cd--; });
    state.buffs.forEach(function (b) { b.turns--; });
    state.buffs = state.buffs.filter(function (b) { return b.turns > 0; });
    state.turn++;
  }

  function damageTaken(state, raw) {
    var k = 1 - leaderSum(leaderSkills(state), "guard", "p");
    state.buffs.forEach(function (b) { if (b.t === "shield") k *= 1 - b.p; });
    return Math.max(0, Math.floor(raw * k));
  }

  // 妖怪行動（§6）
  function enemyPhase(state, events) {
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.hp <= 0) continue;
      e.cd--;
      if (e.cd > 0) continue;
      e.cd = e.cdMax;
      e.acts++;
      var raw = e.atk, kind = "attack";
      if (e.sp && e.sp.t === "enrage" && e.hp < e.hpMax / 2) raw *= 1.5;
      if (e.sp && e.sp.t === "heavy" && e.acts % 3 === 0) { raw *= 2; kind = "heavy"; }
      if (e.sp && e.sp.t === "jam") {
        var cells = [], r, c;
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (state.board[r][c] !== JAM) cells.push([r, c]);
        var hit = [];
        for (var k = 0; k < e.sp.n && cells.length; k++) {
          var p = cells.splice(Math.floor(state.rng() * cells.length), 1)[0];
          state.board[p[0]][p[1]] = JAM;
          hit.push(p);
        }
        events.push({ t: "jam", e: i, cells: hit });
        raw *= 0.5;
        kind = "jam";
      }
      var dmg = damageTaken(state, raw);
      state.hp = Math.max(0, state.hp - dmg);
      events.push({ t: "attack", e: i, dmg: dmg, kind: kind });
      if (state.hp <= 0) { state.over = "lose"; events.push({ t: "lose" }); return; }
    }
  }

  // 一個玩家回合：groups 為本回合（含天降）全部消除組。回傳依序發生的事件。
  function playerTurn(state, groups) {
    var events = [];
    if (state.over) return events;
    var atk = computeAttack(state, groups);
    events.push({ t: "combo", combos: atk.combos });
    state.members.forEach(function (m, i) {
      var a = atk.members[i];
      if (!a.raw) return;
      if (a.aoe) {
        aliveIdx(state).forEach(function (ei) { hitEnemy(state, ei, a.raw, m.attr, events, i); });
      } else {
        var ti = currentTarget(state);
        if (ti >= 0) hitEnemy(state, ti, a.raw, m.attr, events, i);
      }
    });
    heal(state, atk.heal, events, "heart");
    var regen = leaderSum(leaderSkills(state), "regen", "p");
    if (regen) heal(state, state.hpMax * regen, events, "regen");
    if (!checkWave(state, events)) enemyPhase(state, events);
    endTurn(state);
    return events;
  }

  // 主動技能（§5）。不算一回合。回傳 { ok, events, board: 是否改了盤面 }
  function useSkill(state, i) {
    var m = state.members[i], events = [], boardChanged = false;
    if (!m || m.cd > 0 || state.over) return { ok: false, events: events };
    var s = D.HERO_BY_ID[m.id].as, r, c, cells = [];
    switch (s.t) {
      case "convert":
      case "jamheal":
        var from = s.t === "convert" ? s.from : JAM, to = s.t === "convert" ? s.to : "heart";
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (state.board[r][c] === from) { state.board[r][c] = to; cells.push([r, c]); }
        events.push({ t: "convert", cells: cells, to: to });
        boardChanged = true;
        if (s.t === "jamheal") heal(state, state.hpMax * s.p, events, "skill");
        break;
      case "refresh":
        state.board = newBoard(state.rng);
        events.push({ t: "refresh" });
        boardChanged = true;
        break;
      case "delay":
        aliveIdx(state).forEach(function (ei) { state.enemies[ei].cd += s.n; });
        events.push({ t: "delay", n: s.n });
        break;
      case "nuke":
        var ti = currentTarget(state);
        if (ti >= 0) hitEnemy(state, ti, m.atk * s.m, m.attr, events, i);
        checkWave(state, events);
        break;
      case "buff":
      case "time":
      case "shield":
        state.buffs.push({ t: s.t, attr: s.attr, m: s.m, s: s.s, p: s.p, turns: s.turns });
        events.push({ t: "buff", kind: s.t });
        break;
      case "heal":
        heal(state, state.hpMax * s.p, events, "skill");
        break;
    }
    m.cd = m.cdMax;
    return { ok: true, events: events, board: boardChanged };
  }

  var api = {
    ROWS: ROWS, COLS: COLS, JAM: JAM, BASE_TIME_MS: BASE_TIME_MS,
    makeRng: makeRng, newBoard: newBoard, cloneBoard: cloneBoard, findGroups: findGroups,
    clearGroups: clearGroups, drop: drop, resolve: resolve,
    heroStats: heroStats, expToNext: expToNext, gainExp: gainExp, advantage: advantage,
    createBattle: createBattle, moveTimeMs: moveTimeMs, computeAttack: computeAttack,
    playerTurn: playerTurn, useSkill: useSkill, setTarget: setTarget, currentTarget: currentTarget
  };
  root.PriTestTamaCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
