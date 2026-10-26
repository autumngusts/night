// 鐵拳教育：搜打撤模式的規則引擎（即時制，純函式，不碰 DOM；node 也能跑：tools/fist_check/raid_check.js）。
// 設計見 docs/fist_raid_design.md。
//   newProfile()／loadProfile(obj)：辦公桌（局外存檔，含跨局的案件 profile.cs）
//   create(profile, { cls, take, seed })：開一局（會把帶進去的物品從倉庫拿出來，呼叫端要存檔）
//   tick(st, dt)：時間前進；st.fight 不是 null 時暫停，等 applyFight(st, 結果)
//   act(st, 操作)：玩家操作，成功回傳 null，否則回傳錯誤代碼
//   settle(profile, st)：結算到辦公桌（含案件、鑰匙、晨間傳聞），回傳摘要
// 位置一律是地點 id（fist_raid_data.js 的 TILES）；地圖是一張圖：同區上下左右相鄰＋LINKS（樓梯、門）。
// 新事件放在 st.events（畫面取走後播放演出），最近的也留在 st.log。對話只存「句型編號」，文字在 fist_raid_text.js。
(function () {
  "use strict";

  var D = window.PriTestFistData;
  var R = window.PriTestFistRaidData;
  var X = window.PriTestFistRaidText;
  if (!D || !R || !X) return;

  // ---------------- 地圖（圖） ----------------
  var ADJ = {};
  R.TILES.forEach(function (a) { ADJ[a.id] = []; });
  R.TILES.forEach(function (a) {
    R.TILES.forEach(function (b) {
      if (a.zone === b.zone && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) ADJ[a.id].push(b.id);
    });
  });
  R.LINKS.forEach(function (l) { ADJ[l[0]].push(l[1]); ADJ[l[1]].push(l[0]); });

  // 全部地點兩兩距離（不管上鎖，霸凌者判斷遠近用）
  var DIST = {};
  R.TILES.forEach(function (a) {
    var d = {}, q = [a.id];
    d[a.id] = 0;
    while (q.length) {
      var c = q.shift();
      ADJ[c].forEach(function (n) { if (d[n] === undefined) { d[n] = d[c] + 1; q.push(n); } });
    }
    DIST[a.id] = d;
  });
  function dist(a, b) { var d = DIST[a] && DIST[a][b]; return d === undefined ? 99 : d; }
  function tile(id) { return R.TILE[id] || null; }
  function adj(id) { return ADJ[id] || []; }

  // ---------------- 小工具 ----------------
  function rand(st) {
    st.rs = (st.rs + 0x6D2B79F5) | 0;
    var t = st.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(st, list) { return list[Math.floor(rand(st) * list.length)]; }
  function ri(st, n) { return Math.floor(rand(st) * n); }
  function weighted(st, table) {
    var sum = 0, i;
    for (i = 0; i < table.length; i++) sum += table[i][1];
    var r = rand(st) * sum;
    for (i = 0; i < table.length; i++) { r -= table[i][1]; if (r < 0) return table[i][0]; }
    return table[table.length - 1][0];
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function itemSize(id) { return R.ITEM[id] ? R.ITEM[id].size : 1; }
  function used(list) { return list.reduce(function (s, id) { return s + itemSize(id); }, 0); }
  function attrIds() { return R.ATTRS.map(function (a) { return a.id; }); }

  function ev(st, k, data) {
    var x = { k: k, t: Math.round(st.t * 10) / 10 };
    Object.keys(data || {}).forEach(function (n) { x[n] = data[n]; });
    st.events.push(x);
    st.log.push(x);
    if (st.log.length > 40) st.log.shift();
  }

  // ---------------- 案件（跨局的推理支線） ----------------
  // cast[i]：{ n 名字編號, grade, hair, color, glasses, acc, club, haunt, mood, role: "mm" 主謀 | "acc" 共犯 | "",
  //            know 知道主謀的哪些特徵, said 已經說過的特徵, goat 共犯拿來頂罪的替罪羊（說謊時講替罪羊的特徵） }
  // 兩名共犯講同一個替罪羊，所以假線索彼此也一致：要靠人數、被救學生與日記的真線索、說話時的破綻來判斷。
  function valIdx(id, v) { return R.ATTR[id].vals.indexOf(v); }
  function newCase(ch, seed) {
    var g = { rs: seed | 0 };
    var names = [];
    for (var i = 0; i < R.NAMES.zh.length; i++) names.push(i);
    for (var j = names.length - 1; j > 0; j--) { var k = ri(g, j + 1); var tmp = names[j]; names[j] = names[k]; names[k] = tmp; }
    var cast = [];
    for (var n = 0; n < R.CAST; n++) {
      var c = { n: names[n], role: "", mood: pick(g, X.MOODS), know: [], said: [], goat: -1 };
      R.ATTRS.forEach(function (a) { c[a.id] = pick(g, a.vals); });
      c.haunt = pick(g, R.CLUB_HAUNTS[c.club]);
      cast.push(c);
    }
    var mmI = ri(g, R.CAST);
    cast[mmI].role = "mm";
    var mm = cast[mmI];
    var rest = cast.map(function (c2, i2) { return i2; }).filter(function (i2) { return i2 !== mmI; });
    var acc1 = rest.splice(ri(g, rest.length), 1)[0], acc2 = rest.splice(ri(g, rest.length), 1)[0];
    cast[acc1].role = "acc";
    cast[acc2].role = "acc";
    var goat = rest[ri(g, rest.length)];
    cast[acc1].goat = goat;
    cast[acc2].goat = goat;
    // 主謀的外觀要能被唯一認出：有人跟主謀全部特徵都一樣就重抽那個人的髮型、配件
    cast.forEach(function (c3, i3) {
      if (i3 === mmI) return;
      var guard = 0;
      while (R.ATTRS.every(function (a) { return c3[a.id] === mm[a.id]; }) && guard++ < 30) { c3.hair = pick(g, R.ATTR.hair.vals); c3.acc = pick(g, R.ATTR.acc.vals); }
    });
    // 替罪羊至少要有 3 個特徵跟主謀不同（共犯才有謊可說）
    var gc = cast[goat], guard2 = 0;
    while (R.ATTRS.filter(function (a) { return gc[a.id] !== mm[a.id]; }).length < 3 && guard2++ < 30) {
      var ra = pick(g, R.ATTRS);
      gc[ra.id] = pick(g, ra.vals);
    }
    // 誠實的人知道的主謀特徵（約三成什麼都不知道）
    cast.forEach(function (c4) {
      if (c4.role || rand(g) < 0.3) return;
      var ids = attrIds();
      while (c4.know.length < 2) { var a = pick(g, ids); if (c4.know.indexOf(a) < 0) c4.know.push(a); }
    });
    return { v: 1, ch: ch, cast: cast, mm: mmI, notes: [], met: {}, marks: {}, refused: {}, confessed: {}, rescued: {}, broke: {},
      solved: false, raids: 0, rumors: [{ k: "start" }], hot: null };
  }
  function caseMm(cs) { return cs.cast[cs.mm]; }

  function addNote(st, s, attr, vi, how) {
    var cs = st.cs;
    if (cs.notes.some(function (n) { return n.s === s && n.a === attr && n.v === vi; })) return;
    cs.notes.push({ s: s, a: attr, v: vi, how: how, raid: cs.raids + 1 });
    ev(st, "clue", { s: s, a: attr, v: vi });
  }

  // 學生這局說的話：回傳對話結構，並把線索記進案件筆記
  // parts：["greet", mood, i] ["clue", 句型, 特徵, 值序號, 地點] ["tell", i] ["none", i] ["small", i, 地點, 社團序號] ["thanks", i] ["refuse", i]
  function chatWith(st, s) {
    var cs = st.cs, c = cs.cast[s], parts = [];
    cs.met[s] = true;
    if (cs.refused[s]) return [["refuse", ri(st, X.REFUSE.length)]];
    if (cs.rescued[s]) parts.push(["thanks", ri(st, X.THANKS.length)]);
    else parts.push(["greet", c.mood, ri(st, X.GREET[c.mood].length)]);
    if (st.talked[s] || cs.solved) {
      parts.push(["none", st.talked[s] ? 2 : ri(st, X.NONE.length)]);
      parts.push(["small", ri(st, X.SMALL.length), c.haunt, valIdx("club", c.club)]);
      return parts;
    }
    st.talked[s] = true;
    var mm = caseMm(cs);
    var attr = null, look = null, place = null;
    if (c.role === "acc") {
      var gl = cs.cast[c.goat];
      var lies = attrIds().filter(function (a) { return gl[a] !== mm[a] && c.said.indexOf(a) < 0; });
      if (lies.length) { attr = pick(st, lies); look = gl; place = gl.haunt; }
    } else if (c.role === "mm") {
      // 主謀本人：一半裝傻，一半把矛頭指向別人
      if (rand(st) < 0.5) {
        var other = pick(st, cs.cast.filter(function (x) { return !x.role; }));
        var diff = attrIds().filter(function (a) { return other[a] !== mm[a] && c.said.indexOf(a) < 0; });
        if (diff.length) { attr = pick(st, diff); look = other; place = other.haunt; }
      }
    } else {
      var know = cs.rescued[s] ? attrIds() : c.know;
      var left = know.filter(function (a) { return c.said.indexOf(a) < 0; });
      if (left.length) { attr = pick(st, left); look = mm; place = mm.haunt; }
    }
    if (attr) {
      c.said.push(attr);
      var vi = valIdx(attr, look[attr]);
      parts.push(["clue", ri(st, X.CLUE.length), attr, vi, place]);
      addNote(st, s, attr, vi, "talk");
      if (rand(st) < (c.role ? 0.55 : 0.12)) parts.push(["tell", ri(st, X.TELL.length)]);
    } else {
      parts.push(["none", ri(st, X.NONE.length)]);
      if (rand(st) < 0.6) parts.push(["small", ri(st, X.SMALL.length), c.haunt, valIdx("club", c.club)]);
    }
    return parts;
  }

  // ---------------- 辦公桌（局外） ----------------
  function newProfile() {
    var p = { v: 2, rep: 0, stash: ["bandage", "bandage"], up: { bag: 0, hp: 0, eye: 0, pocket: 0 }, ch: 0, won: false, keys: {},
      wall: { queen: 0, captain: 0, chairman: 0 }, stats: { raids: 0, extracts: 0, rescued: 0, ko: 0, best: 0, solved: 0 }, cs: null, seq: 1 };
    ensureCase(p);
    return p;
  }
  function loadProfile(o) {
    if (!o || (o.v !== 1 && o.v !== 2) || !Array.isArray(o.stash)) return newProfile();
    var p = newProfile();
    p.rep = Math.max(0, Math.floor(Number(o.rep) || 0));
    p.stash = o.stash.filter(function (id) { return R.ITEM[id] && R.ITEM[id].kind !== "token" && R.ITEM[id].kind !== "key"; });
    Object.keys(p.up).forEach(function (k) { if (o.up) p.up[k] = clamp(Math.floor(Number(o.up[k]) || 0), 0, upgrade(k).costs.length); });
    p.ch = clamp(Math.floor(Number(o.ch) || 0), 0, D.CHAPTERS.length);
    p.won = !!o.won || p.ch >= D.CHAPTERS.length;
    Object.keys(p.wall).forEach(function (k) { if (o.wall) p.wall[k] = Math.max(0, Math.floor(Number(o.wall[k]) || 0)); });
    Object.keys(p.stats).forEach(function (k) { if (o.stats) p.stats[k] = Math.max(0, Math.floor(Number(o.stats[k]) || 0)); });
    if (o.keys) Object.keys(o.keys).forEach(function (k) { if (R.ITEM[k] && R.ITEM[k].kind === "key") p.keys[k] = true; });
    p.seq = Math.max(1, Math.floor(Number(o.seq) || 1));
    p.cs = o.cs && o.cs.v === 1 && Array.isArray(o.cs.cast) && o.cs.cast.length === R.CAST ? o.cs : null;
    ensureCase(p);
    return p;
  }
  // 每章一份案件；章節換了（或還沒有）就產生新的。通關後每次破案都換新案件
  function caseCh(p) { return p.won ? 100 + p.stats.solved : p.ch; }
  function ensureCase(p) {
    var ch = caseCh(p);
    if (!p.cs || p.cs.ch !== ch) {
      p.seq += 1;
      p.cs = newCase(ch, Math.imul(p.seq, 2654435761) ^ (ch * 40503) ^ (Date.now() & 0xffff));
    }
    return p.cs;
  }
  function upgrade(id) { return R.UPGRADES.filter(function (u) { return u.id === id; })[0]; }
  function wallOf(id) { return D.ENEMY[id].wall * R.BOSS_WALL_MUL; }
  function bagMax(p) { return R.BAG + p.up.bag; }
  function stashUsed(p) { return used(p.stash); }
  function zoneOpen(keys, zid) { var z = R.ZONE[zid]; return !z.lock || !!keys[z.lock]; }

  function buy(p, id) {
    var u = upgrade(id);
    if (!u) return "bad";
    var lv = p.up[id];
    if (lv >= u.costs.length) return "max";
    if (p.rep < u.costs[lv]) return "rep";
    p.rep -= u.costs[lv];
    p.up[id] = lv + 1;
    return null;
  }
  function submit(p, i) {
    var it = R.ITEM[p.stash[i]];
    if (!it || it.kind !== "evid") return "bad";
    p.stash.splice(i, 1);
    p.rep += it.val;
    return null;
  }
  function discard(p, i) {
    if (i < 0 || i >= p.stash.length) return "bad";
    p.stash.splice(i, 1);
    return null;
  }
  // 筆記上的嫌疑標記：sus 可疑 / clear 排除 / null 取消
  function mark(p, s, m) {
    var cs = ensureCase(p);
    if (!cs.cast[s]) return "bad";
    if (m) cs.marks[s] = m; else delete cs.marks[s];
    return null;
  }

  function bossOf(p, st) {
    if (p.ch < D.CHAPTERS.length) return { id: D.CHAPTERS[p.ch].boss, dmg: p.wall[D.CHAPTERS[p.ch].boss] || 0 };
    return { id: pick(st, D.CHAPTERS).boss, dmg: 99 };
  }

  // ---------------- 一局 ----------------
  function create(p, opts) {
    var c = D.CLASS[opts.cls] || D.CLASSES[0];
    var take = (opts.take || []).slice().sort(function (a, b) { return b - a; });
    var bag = [];
    take.forEach(function (i) { if (p.stash[i] && used(bag) + itemSize(p.stash[i]) <= bagMax(p)) bag.unshift(p.stash.splice(i, 1)[0]); });
    var cs = ensureCase(p);
    var st = {
      v: 2, rs: (opts.seed || Date.now()) | 0, t: 0, phase: "raid", result: null,
      ch: Math.min(p.ch, D.CHAPTERS.length - 1), cls: c.id, keys: JSON.parse(JSON.stringify(p.keys)),
      me: { at: "office", hp: c.hp + p.up.hp * 2, max: c.hp + p.up.hp * 2, pow: c.pow, talk: c.talk, sense: c.sense,
        heat: 0, cd: 0, dash: 0, cctv: 0, path: [], mv: 0, act: null, bag: bag, bagMax: bagMax(p), eye: p.up.eye, pocket: p.up.pocket > 0 },
      alert: 0, lock: null, exits: [], spots: {}, floor: {}, seen: { office: true }, proof: {}, keySpots: {},
      bullies: [], victims: [], students: [], uid: 0, spawnT: R.SPAWN_EVERY, fight: null,
      boss: null, wallDmg: 0, events: [], log: [], dialog: null, talked: {},
      cs: JSON.parse(JSON.stringify(cs)),
      stats: { searched: 0, ko: 0, rescued: 0, comp: 0, broke: 0, wrong: 0, clues: 0 },
      out: { rescued: [], broke: [], wrong: [], confess: [], solved: false }
    };
    st.brought = bag.slice();
    // 撤離點：開放區域裡的候選隨機 2 個
    var ex = R.EXITS.filter(function (id) { return open(st, id); });
    while (st.exits.length < R.OPEN_EXITS && ex.length) st.exits.push(ex.splice(ri(st, ex.length), 1)[0]);
    // 搜索點
    R.TILES.forEach(function (t) {
      var n = R.SPOTS[t.type] || 0;
      if (!n) return;
      st.spots[t.id] = [];
      for (var i = 0; i < n; i++) st.spots[t.id].push({ n: i, done: false });
    });
    // 還沒拿到的鑰匙藏在某個搜索點
    Object.keys(R.KEY_SPOTS).forEach(function (k) {
      if (p.keys[k]) return;
      var list = R.KEY_SPOTS[k].filter(function (id) { return open(st, id) && st.spots[id]; });
      if (!list.length) return;
      var id = pick(st, list);
      st.keySpots[id] = { i: ri(st, st.spots[id].length), item: k };
    });
    // 權力者
    var b = bossOf(p, st);
    var bd = D.ENEMY[b.id];
    var bhp = Math.round(bd.hp * R.BOSS_HP_MUL);
    var bu = addBully(st, b.id, bd.at, { boss: true, hp: bhp, max: bhp, wall: Math.max(0, wallOf(b.id) - b.dmg), wallMax: wallOf(b.id), post: true });
    st.boss = bu.u;
    for (var k2 = 0; k2 < R.BOSS_ESCORTS; k2++) addBully(st, bd.esc, bd.at, { post: true });
    // 開局的事件（傳聞裡的地點一定有一起）與巡邏
    if (cs.hot && open(st, cs.hot) && !bulliesAt(st, cs.hot).length) spawnIncident(st, cs.hot);
    var guard = 0;
    while (st.victims.length < R.START_INCIDENTS && guard++ < 20) { if (!spawnIncident(st)) break; }
    for (var m = 0; m < R.START_PATROLS; m++) spawnPatrol(st);
    spawnStudents(st);
    st.events = [];
    st.log = [];
    ev(st, "start", { exits: st.exits.slice() });
    return st;
  }

  function open(st, id) { var t = tile(id); return !!t && zoneOpen(st.keys, t.zone); }
  function nextUid(st) { st.uid += 1; return st.uid; }
  function addBully(st, id, at, extra) {
    var d = D.ENEMY[id];
    var b = { u: nextUid(st), id: id, at: at, hp: d.hp, max: d.hp, stun: 0, guard: null, post: false, mt: R.PATROL_MIN + rand(st) * R.PATROL_RAND };
    Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; });
    st.bullies.push(b);
    return b;
  }
  function freeTiles(st, types) {
    return R.TILES.filter(function (t) {
      return types.indexOf(t.type) >= 0 && open(st, t.id) && t.id !== st.me.at && dist(t.id, st.me.at) > 1 &&
        !bulliesAt(st, t.id).some(function (b) { return b.post; }) && !victimsAt(st, t.id).length;
    }).map(function (t) { return t.id; });
  }
  // 受害學生是名單裡的普通學生（主謀、共犯不會）；被救出過的、心靈崩潰的不再當受害者
  function victimPool(st) {
    var cs = st.cs, busy = {};
    st.victims.forEach(function (v) { busy[v.s] = true; });
    st.students.forEach(function (x) { busy[x.s] = true; });
    return cs.cast.map(function (c, i) { return i; }).filter(function (i) { return !cs.cast[i].role && !busy[i] && !cs.rescued[i] && !cs.broke[i]; });
  }
  function spawnIncident(st, at) {
    var list = at ? [at] : freeTiles(st, ["blind", "class"]);
    var pool = victimPool(st);
    if (!list.length || !pool.length) return false;
    var where = pick(st, list);
    var ch = D.CHAPTERS[st.ch];
    var v = { u: nextUid(st), s: pick(st, pool), at: where, hp: ch.victimHp, max: ch.victimHp, follow: false, drain: 0 };
    st.victims.push(v);
    pick(st, ch.groups).forEach(function (id) { addBully(st, id, where, { guard: v.u }); });
    return true;
  }
  function patrolCount(st) { return st.bullies.filter(function (b) { return !b.post; }).length; }
  function spawnPatrol(st) {
    if (patrolCount(st) >= R.MAX_BULLIES) return;
    var list = freeTiles(st, ["blind", "class"]);
    if (!list.length) return;
    var ids = [].concat.apply([], D.CHAPTERS[st.ch].groups);
    addBully(st, pick(st, ids), pick(st, list));
  }
  function spawnStudents(st) {
    var cs = st.cs;
    var pool = cs.cast.map(function (c, i) { return i; }).filter(function (i) {
      return !cs.confessed[i] && !cs.broke[i] && !(cs.cast[i].role === "mm" && cs.solved) && !st.victims.some(function (v) { return v.s === i; });
    });
    var mmIn = pool.indexOf(cs.mm) >= 0 && rand(st) < R.MM_CHANCE;
    pool = pool.filter(function (i) { return i !== cs.mm; });
    var chosen = mmIn ? [cs.mm] : [];
    while (chosen.length < R.STUDENTS && pool.length) chosen.push(pool.splice(ri(st, pool.length), 1)[0]);
    var spots = R.TILES.filter(function (t) { return open(st, t.id) && t.type !== "office"; });
    chosen.forEach(function (i) {
      var c = cs.cast[i];
      var at = open(st, c.haunt) && rand(st) < 0.7 ? c.haunt : pick(st, spots).id;
      st.students.push({ u: nextUid(st), s: i, at: at, mt: R.STUDENT_MOVE * (0.5 + rand(st)) });
    });
  }

  function bulliesAt(st, at) { return st.bullies.filter(function (b) { return b.at === at; }); }
  function victimsAt(st, at) { return st.victims.filter(function (v) { return !v.follow && v.at === at; }); }
  function studentsAt(st, at) { return st.students.filter(function (x) { return x.at === at; }); }
  function witnesses(st) { return st.victims.filter(function (v) { return v.follow; }); }
  function bully(st, u) { return st.bullies.filter(function (b) { return b.u === u; })[0] || null; }
  function student(st, u) { return st.students.filter(function (x) { return x.u === u; })[0] || null; }
  function boss(st) { return bully(st, st.boss); }
  function here(st) { return tile(st.me.at); }
  function hereBullies(st) { return bulliesAt(st, st.me.at); }
  function visible(st, at) { return st.me.cctv > 0 || at === st.me.at || adj(st.me.at).indexOf(at) >= 0; }
  function walled(b) { return !!b.boss && b.wall > 0; }
  function isExit(st, id) { return st.exits.indexOf(id) >= 0; }
  function safe(id) { var t = tile(id); return t.type === "office" || t.type === "nurse"; }
  function stepTime(st) {
    var s = st.cls === "pe" ? R.STEP_PE : R.STEP;
    return st.me.dash > 0 ? s / 2 : s;
  }
  function searchTime(st) { return R.SEARCH * Math.max(0.4, 1 - 0.08 * (st.me.sense - 1)) * (1 - 0.15 * st.me.eye); }
  function addAlert(st, n) { st.alert = clamp(st.alert + n, 0, 100); }
  function gainHeat(st, n) { st.me.heat = Math.min(D.MAX_HEAT, st.me.heat + n); }

  // 開放區域裡的最短路線（BFS）；走不到回傳 null
  function route(st, from, to) {
    if (from === to) return [];
    if (!open(st, to)) return null;
    var prev = {}, q = [from];
    prev[from] = from;
    while (q.length) {
      var c = q.shift();
      if (c === to) break;
      adj(c).forEach(function (n) { if (prev[n] === undefined && open(st, n)) { prev[n] = c; q.push(n); } });
    }
    if (prev[to] === undefined) return null;
    var path = [], x = to;
    while (x !== from) { path.unshift(x); x = prev[x]; }
    return path;
  }

  function gain(st, id, src) {
    if (used(st.me.bag) + itemSize(id) <= st.me.bagMax) { st.me.bag.push(id); ev(st, "loot", { i: id, src: src }); return true; }
    (st.floor[st.me.at] = st.floor[st.me.at] || []).push(id);
    ev(st, "floor", { i: id, src: src });
    return false;
  }

  function end(st, why) {
    if (st.phase !== "raid") return;
    st.phase = "done";
    st.result = why;
    st.me.path = [];
    st.me.act = null;
    st.fight = null;
    ev(st, "end", { why: why });
  }
  function cancelAct(st) {
    if (st.me.act) { ev(st, "cancel", { a: st.me.act.k }); st.me.act = null; }
  }

  // ---------------- 霸凌者被打 ----------------
  function hurtBully(st, b, d, how) {
    if (walled(b)) return 0;
    d = Math.min(d, b.hp);
    b.hp -= d;
    if (b.hp <= 0) defeat(st, b, how);
    return d;
  }
  function defeat(st, b, how) {
    st.bullies = st.bullies.filter(function (x) { return x !== b; });
    st.stats.ko += 1;
    ev(st, "defeat", { e: b.id, how: how || "fist", boss: !!b.boss, mm: b.mm !== undefined ? b.mm : null });
    if (b.boss) {
      gain(st, R.BOSS_TOKEN[b.id], "boss");
      gain(st, "ledger", "boss");
      st.boss = null;
    } else if (b.mm !== undefined) {
      // 主謀倒下：案件破了（不論這局能不能撤離，消息都會傳開），權力之壁永久削弱
      st.cs.solved = true;
      st.out.solved = true;
      var bb = boss(st);
      var n = bb && walled(bb) ? Math.min(R.SOLVE_WALL, bb.wall) : 0;
      if (n) { bb.wall -= n; st.wallDmg += n; }
      ev(st, "solved", { s: b.mm, wall: n });
      gain(st, "mm_phone", "mm");
    } else if (rand(st) < R.DROP_RATE) gain(st, weighted(st, R.DROPS), "drop");
  }

  // ---------------- 抵達地點 ----------------
  function arrive(st) {
    var me = st.me;
    st.seen[me.at] = true;
    witnesses(st).forEach(function (v) { v.at = me.at; });
    hereBullies(st).forEach(function (b) { if (D.ENEMY[b.id].coward && !b.stun && !b.post) flee(st, b); });
    studentsAt(st, me.at).forEach(function (x) { st.cs.met[x.s] = true; });
    checkRescue(st);
    checkAmbush(st);
  }
  function flee(st, b) {
    var opts = adj(b.at).filter(function (n) { return n !== st.me.at && open(st, n) && !safe(n); });
    if (!opts.length) return;
    b.at = pick(st, opts);
    b.guard = null;
    ev(st, "flee", { e: b.id });
  }
  function checkRescue(st) {
    victimsAt(st, st.me.at).forEach(function (v) {
      if (bulliesAt(st, v.at).length) return;
      if (witnesses(st).length >= R.MAX_WITNESS) { if (!v.full) { v.full = true; ev(st, "full", {}); } return; }
      v.follow = true;
      st.stats.rescued += 1;
      st.out.rescued.push(v.s);
      st.cs.met[v.s] = true;
      gainHeat(st, 1);
      ev(st, "rescue", { s: v.s });
      // 被救出的學生當場說出一條真線索
      if (st.cs.solved) return;
      var mm = caseMm(st.cs);
      var c = st.cs.cast[v.s];
      var left = attrIds().filter(function (a) { return c.said.indexOf(a) < 0; });
      if (!left.length) return;
      var a = pick(st, left);
      c.said.push(a);
      var vi = valIdx(a, mm[a]);
      st.dialog = { s: v.s, parts: [["thanks", ri(st, X.THANKS.length)], ["clue", ri(st, X.CLUE.length), a, vi, mm.haunt]] };
      addNote(st, v.s, a, vi, "rescue");
    });
  }
  function checkAmbush(st) {
    if (st.fight || st.phase !== "raid") return;
    if (hereBullies(st).some(function (b) { return D.ENEMY[b.id].fierce && b.stun <= 0; })) startFight(st, true);
  }
  function startFight(st, ambush) {
    var bs = hereBullies(st);
    if (!bs.length) return;
    st.me.path = [];
    st.me.mv = 0;
    cancelAct(st);
    st.fight = { us: bs.map(function (b) { return b.u; }), ambush: !!ambush, proof: !!st.proof[st.me.at] };
    addAlert(st, R.ALERT_FIGHT);
    ev(st, "fight", { ambush: !!ambush });
  }

  // ---------------- 時間前進 ----------------
  function tick(st, dt) {
    if (st.phase !== "raid" || st.fight || !(dt > 0)) return;
    dt = Math.min(dt, 0.25);
    st.t += dt;
    var me = st.me;
    me.cd = Math.max(0, me.cd - dt);
    me.dash = Math.max(0, me.dash - dt);
    me.cctv = Math.max(0, me.cctv - dt);

    addAlert(st, R.ALERT_RATE * dt);
    if (st.alert >= 100 && !st.lock) {
      var keep = pick(st, st.exits);
      st.exits = [keep];
      st.lock = { t: R.LOCKDOWN_TIME };
      ev(st, "lock", { exit: keep });
    }
    if (st.lock) {
      st.lock.t -= dt;
      if (st.lock.t <= 0) { end(st, "trapped"); return; }
    }

    if (me.path.length) {
      me.mv += dt;
      if (me.mv >= stepTime(st)) {
        me.mv = 0;
        me.at = me.path.shift();
        ev(st, "step", {});
        arrive(st);
        if (st.fight) return;
      }
    } else if (me.act) {
      var a = me.act;
      if (a.k === "rest") {
        a.t += dt;
        while (a.t >= 1 && me.hp < me.max) { a.t -= 1; me.hp += 1; }
        if (me.hp >= me.max) { me.act = null; ev(st, "rested", {}); }
      } else {
        a.t += dt;
        if (a.t >= a.dur) { me.act = null; finishAct(st, a); if (st.phase !== "raid" || st.fight) return; }
      }
    }

    // 霸凌者
    var fast = st.alert >= R.ALERT_HIGH ? 1 / R.PATROL_FAST : 1;
    st.bullies.slice().forEach(function (b) {
      if (b.stun > 0) { b.stun = Math.max(0, b.stun - dt); if (b.stun <= 0 && b.at === me.at) checkAmbush(st); return; }
      if (b.post) return;
      if (b.guard && st.victims.some(function (v) { return v.u === b.guard && !v.follow && v.at === b.at; })) return;
      b.guard = null;
      b.mt -= dt * fast;
      if (b.mt > 0) return;
      b.mt = R.PATROL_MIN + rand(st) * R.PATROL_RAND;
      var d = D.ENEMY[b.id];
      var opts = adj(b.at).filter(function (n) { return open(st, n) && !safe(n); });
      if (!opts.length) return;
      var n;
      if (d.fierce && adj(b.at).indexOf(me.at) >= 0 && !safe(me.at)) n = me.at;
      else if (d.coward && dist(b.at, me.at) <= 1) n = opts.filter(function (o) { return dist(o, me.at) > 1; })[0] || null;
      else n = pick(st, opts);
      if (!n) return;
      b.at = n;
      if (b.at === me.at) {
        if (d.coward) flee(st, b);
        else if (d.fierce) { ev(st, "chase", { e: b.id }); checkAmbush(st); }
        else if (me.act) { ev(st, "disturb", { e: b.id }); cancelAct(st); }
      }
    });
    if (st.fight) return;

    // 一般學生慢慢走動（多半往常去的地方）；正在跟老師說話的不走
    st.students.forEach(function (x) {
      x.mt -= dt;
      if (x.mt > 0) return;
      x.mt = R.STUDENT_MOVE * (0.6 + rand(st) * 0.8);
      if (x.at === me.at && me.act && (me.act.k === "chat" || me.act.k === "accuse")) return;
      var c = st.cs.cast[x.s];
      var opts = adj(x.at).filter(function (n) { return open(st, n) && tile(n).type !== "office"; });
      if (!opts.length) return;
      var home = route(st, x.at, c.haunt);
      if (home && !home.length && rand(st) < 0.6) return;
      x.at = home && home.length && rand(st) < 0.55 ? home[0] : pick(st, opts);
      if (x.at === me.at) st.cs.met[x.s] = true;
    });

    // 受害學生
    st.victims.slice().forEach(function (v) {
      if (v.follow) return;
      if (!bulliesAt(st, v.at).some(function (b) { return b.stun <= 0; })) return;
      v.drain += dt;
      if (v.drain >= R.VICTIM_DRAIN) {
        v.drain = 0;
        v.hp -= 1;
        if (v.hp <= 0) {
          st.victims = st.victims.filter(function (x) { return x !== v; });
          addAlert(st, R.ALERT_BREAK);
          st.stats.broke += 1;
          st.out.broke.push(v.s);
          ev(st, "broke", { s: v.s });
        }
      }
    });
    checkRescue(st);

    st.spawnT -= dt;
    if (st.spawnT <= 0) {
      st.spawnT = st.alert >= R.ALERT_WARY ? R.SPAWN_EVERY_WARY : R.SPAWN_EVERY;
      spawnPatrol(st);
    }
  }

  // ---------------- 持續動作完成 ----------------
  function finishAct(st, a) {
    var me = st.me, t = here(st);
    if (a.k === "search") {
      var spot = (st.spots[t.id] || [])[a.arg];
      if (!spot || spot.done) return;
      spot.done = true;
      st.stats.searched += 1;
      addAlert(st, R.ALERT_SEARCH);
      var ks = st.keySpots[t.id];
      if (ks && ks.i === a.arg) { gain(st, ks.item, "search"); delete st.keySpots[t.id]; return; }
      var id = weighted(st, t.zone === "old" ? R.DEEP_LOOT : R.LOOT[t.type] || R.LOOT.path);
      if (!id) { ev(st, "empty", {}); return; }
      gain(st, id, "search");
      // 受害日記：寫著一條真線索
      if (id === "diary" && !st.cs.solved) {
        var mm = caseMm(st.cs);
        var at = pick(st, R.ATTRS).id;
        var vi = valIdx(at, mm[at]);
        st.dialog = { s: -1, parts: [["diary", 0, at, vi, mm.haunt]] };
        addNote(st, -1, at, vi, "diary");
      }
    } else if (a.k === "photo") {
      if (st.proof[t.id] || !hereBullies(st).length) return;
      st.proof[t.id] = true;
      ev(st, "proof", {});
      gain(st, "photo", "photo");
    } else if (a.k === "talk") {
      var b = bully(st, a.arg);
      if (!b || b.at !== me.at) return;
      if (walled(b)) { ev(st, "wall", {}); return; }
      var d = me.talk + ri(st, 3);
      if (D.ENEMY[b.id].stubborn) d = Math.max(1, Math.floor(d / 2));
      ev(st, "talk", { e: b.id, d: Math.min(d, b.hp) });
      hurtBully(st, b, d, "talk");
      gainHeat(st, 1);
    } else if (a.k === "chat") {
      var x = student(st, a.arg);
      if (!x || x.at !== me.at) return;
      st.dialog = { s: x.s, parts: chatWith(st, x.s) };
      st.stats.clues = st.cs.notes.length;
      ev(st, "chat", { s: x.s });
    } else if (a.k === "accuse") {
      accuse(st, a.arg);
    } else if (a.k === "use") {
      var i = me.bag.indexOf(a.arg);
      if (i < 0) return;
      me.bag.splice(i, 1);
      if (a.arg === "bandage") me.hp = Math.min(me.max, me.hp + 3);
      else if (a.arg === "onigiri") me.hp = Math.min(me.max, me.hp + 6);
      else if (a.arg === "drink") { me.hp = Math.min(me.max, me.hp + 1); gainHeat(st, 2); }
      else if (a.arg === "alarm") {
        hereBullies(st).forEach(function (y) { y.stun = Math.max(y.stun, R.ALARM_STUN); });
        addAlert(st, R.ALERT_ALARM);
      }
      ev(st, "use", { i: a.arg });
    } else if (a.k === "extract") {
      if (isExit(st, t.id)) end(st, "extract");
    } else if (a.k === "expose") {
      var bb = boss(st);
      var j = me.bag.indexOf(a.arg);
      if (!bb || !walled(bb) || j < 0) return;
      var it = R.ITEM[a.arg];
      var n = t.type === "broadcast" ? Math.max(1, Math.floor(it.val / 2)) : it.val;
      n = Math.min(n, bb.wall);
      me.bag.splice(j, 1);
      bb.wall -= n;
      st.wallDmg += n;
      ev(st, "expose", { n: n, left: bb.wall });
    }
  }

  // 指認：主謀＝現出原形開打；共犯＝招供一條真線索後逃走；其他人＝冤枉（投訴、察覺度大增、之後不肯作證）
  function accuse(st, u) {
    var x = student(st, u);
    if (!x || x.at !== st.me.at) return;
    var cs = st.cs, c = cs.cast[x.s];
    cs.met[x.s] = true;
    if (c.role === "mm") {
      st.students = st.students.filter(function (y) { return y !== x; });
      st.dialog = { s: x.s, parts: [["accuse", "mm", ri(st, X.ACCUSE.mm.length)]] };
      addBully(st, "ringleader", st.me.at, { hp: R.MM_HP, max: R.MM_HP, mm: x.s, post: true });
      ev(st, "reveal", { s: x.s });
      startFight(st, true);
    } else if (c.role === "acc") {
      st.students = st.students.filter(function (y) { return y !== x; });
      cs.confessed[x.s] = true;
      st.out.confess.push(x.s);
      var mm = caseMm(cs);
      var left = attrIds().filter(function (a) { return !cs.notes.some(function (n) { return n.how === "confess" && n.a === a; }); });
      var at = pick(st, left.length ? left : attrIds());
      var vi = valIdx(at, mm[at]);
      st.dialog = { s: x.s, parts: [["confess", ri(st, X.CONFESS.length), at, vi]] };
      addNote(st, x.s, at, vi, "confess");
      ev(st, "confess", { s: x.s });
    } else {
      cs.refused[x.s] = true;
      st.out.wrong.push(x.s);
      st.stats.wrong += 1;
      st.stats.comp += 1;
      addAlert(st, R.ALERT_WRONG);
      st.dialog = { s: x.s, parts: [["accuse", "wrong", ri(st, X.ACCUSE.wrong.length)]] };
      ev(st, "wrong", { s: x.s });
    }
  }

  // ---------------- 玩家操作 ----------------
  function startAct(st, k, dur, arg) {
    st.me.path = [];
    st.me.mv = 0;
    st.me.act = { k: k, t: 0, dur: dur, arg: arg };
    ev(st, "act", { a: k });
    return null;
  }

  function act(st, a) {
    if (!a || st.phase !== "raid") return "over";
    if (st.fight) return "fight";
    var me = st.me, t = here(st);
    switch (a.t) {
      case "move": {
        if (!tile(a.to)) return "bad";
        if (!open(st, a.to)) return "locked";
        // 走到一半改方向：先走完這一格再轉
        var keep = me.path.length && me.mv > 0 ? me.path[0] : null;
        var p = route(st, keep || me.at, a.to);
        if (!p) return "locked";
        me.path = (keep ? [keep] : []).concat(p);
        if (!keep) me.mv = 0;
        if (me.act) cancelAct(st);
        return null;
      }
      case "stop":
        me.path = me.path.length && me.mv > 0 ? [me.path[0]] : [];
        if (!me.path.length) me.mv = 0;
        cancelAct(st);
        return null;
      case "search": {
        var spots = st.spots[t.id] || [];
        var i = -1;
        for (var si = 0; si < spots.length && i < 0; si++) if (!spots[si].done) i = si;
        if (i < 0) return "empty";
        return startAct(st, "search", searchTime(st), i);
      }
      case "photo":
        if (!hereBullies(st).length) return "nobully";
        if (st.proof[t.id]) return "proof";
        return startAct(st, "photo", R.PHOTO);
      case "talk": {
        var b = a.b ? bully(st, a.b) : hereBullies(st).filter(function (x) { return !walled(x); })[0];
        if (!b || b.at !== me.at) return "nobully";
        if (walled(b)) return "wall";
        return startAct(st, "talk", R.TALK, b.u);
      }
      case "chat": {
        var x = student(st, a.u);
        if (!x || x.at !== me.at) return "nostudent";
        return startAct(st, "chat", R.CHAT, x.u);
      }
      case "accuse": {
        var y = student(st, a.u);
        if (!y || y.at !== me.at) return "nostudent";
        if (st.cs.solved) return "solved";
        if (st.cs.refused[y.s]) return "refused";
        return startAct(st, "accuse", 0.6, y.u);
      }
      case "fight":
        if (!hereBullies(st).length) return "nobully";
        startFight(st, false);
        return null;
      case "rest":
        if (!safe(t.id)) return "place";
        if (me.hp >= me.max) return "full";
        return startAct(st, "rest", 0);
      case "use": {
        var it = R.ITEM[a.i];
        if (!it || it.kind !== "sup" || me.bag.indexOf(a.i) < 0) return "bad";
        if (a.i === "alarm" && !hereBullies(st).length) return "nobully";
        return startAct(st, "use", R.USE, a.i);
      }
      case "extract":
        if (!isExit(st, t.id)) return "place";
        return startAct(st, "extract", R.EXTRACT);
      case "expose": {
        var bb = boss(st);
        if (!bb || !walled(bb)) return "nowall";
        if (!(t.type === "broadcast" || bb.at === me.at)) return "place";
        var ei = R.ITEM[a.i];
        if (!ei || ei.kind !== "evid" || me.bag.indexOf(a.i) < 0) return "bad";
        return startAct(st, "expose", R.EXPOSE, a.i);
      }
      case "drop": {
        var di = me.bag.indexOf(a.i);
        if (di < 0) return "bad";
        me.bag.splice(di, 1);
        (st.floor[t.id] = st.floor[t.id] || []).push(a.i);
        ev(st, "drop", { i: a.i });
        return null;
      }
      case "take": {
        var fl = st.floor[t.id] || [];
        var fi = fl.indexOf(a.i);
        if (fi < 0) return "bad";
        if (used(me.bag) + itemSize(a.i) > me.bagMax) return "bagfull";
        fl.splice(fi, 1);
        me.bag.push(a.i);
        ev(st, "loot", { i: a.i, src: "floor" });
        return null;
      }
      case "closeDialog":
        st.dialog = null;
        return null;
      case "skill":
        if (me.cd > 0) return "cd";
        return skill(st);
      case "ult":
        if (me.heat < D.MAX_HEAT) return "heat";
        if (st.cls !== "it" && st.cls !== "lit") return "fightult";
        me.heat = 0;
        if (st.cls === "it") addAlert(st, -30);
        else {
          addAlert(st, -20);
          var bs = boss(st);
          if (bs && walled(bs)) { var n = Math.min(2, bs.wall); bs.wall -= n; st.wallDmg += n; }
        }
        ev(st, "ult", { id: D.CLASS[st.cls].ult.id });
        return null;
      case "quit":
        end(st, "quit");
        return null;
    }
    return "bad";
  }

  function skill(st) {
    var me = st.me, t = here(st);
    var id = D.CLASS[st.cls].skill.id;
    var bs = hereBullies(st);
    if (id === "dash") me.dash = R.DASH_TIME;
    else if (id === "glare") {
      if (!bs.length) return "nobully";
      bs.forEach(function (b) { b.stun = Math.max(b.stun, R.GLARE_STUN); hurtBully(st, b, 1, "fist"); });
    } else if (id === "counsel") {
      var vs = st.victims.filter(function (v) { return dist(v.at, me.at) <= 1; });
      if (!vs.length) return "novictim";
      vs.forEach(function (v) { v.hp = Math.min(v.max, v.hp + 3); });
    } else if (id === "recorder") {
      if (st.proof[t.id]) return "proof";
      st.proof[t.id] = true;
      if (bs.length) gain(st, "rec", "skill");
    } else if (id === "cctv") {
      me.cctv = R.CCTV_TIME;
      st.bullies.forEach(function (b) { st.proof[b.at] = true; });
    } else if (id === "rally") {
      me.hp = Math.min(me.max, me.hp + 3);
      gainHeat(st, 1);
    }
    me.cd = R.SKILL_CD;
    ev(st, "skill", { id: id });
    return null;
  }

  // ---------------- 格鬥結果 ----------------
  // r：fist_fight.js 的 engine.result()：{ hits: [{ b, d, how }], taken, combo, ult, fist }
  function applyFight(st, r) {
    if (!st.fight) return "nofight";
    var f = st.fight, me = st.me;
    st.fight = null;
    r = r || {};
    var anyFist = false, kos = 0;
    (r.hits || []).forEach(function (h) {
      var b = bully(st, h.b);
      if (!b || f.us.indexOf(b.u) < 0) return;
      var d = Math.max(0, Math.floor(Number(h.d) || 0));
      if (h.how !== "talk" && !b.boss && b.mm === undefined && d > 0) anyFist = true;
      var before = st.bullies.length;
      hurtBully(st, b, d, h.how);
      if (st.bullies.length < before) kos += 1;
    });
    if (r.fist && anyFist && !f.proof) {
      addAlert(st, R.ALERT_COMP);
      st.stats.comp += 1;
      ev(st, "comp", {});
    }
    me.hp = Math.max(0, me.hp - Math.max(0, Math.floor(Number(r.taken) || 0)));
    if (r.ult) me.heat = 0;
    gainHeat(st, 1 + ((r.combo || 0) >= 8 ? 1 : 0) + (kos ? 1 : 0));
    ev(st, "fought", { ko: kos, taken: r.taken || 0, combo: r.combo || 0 });
    if (me.hp <= 0) { end(st, "down"); return null; }
    hereBullies(st).forEach(function (b) { b.stun = Math.max(b.stun, R.STUN); });
    checkRescue(st);
    return null;
  }

  // ---------------- 結算 ----------------
  function settle(p, st) {
    var out = { result: st.result, gained: [], lost: [], auto: 0, ch: false, won: false, rep: 0, wall: st.wallDmg, keys: [], solved: st.out.solved };
    p.stats.raids += 1;
    p.stats.ko += st.stats.ko;
    if (p.ch < D.CHAPTERS.length && st.wallDmg) {
      var cb = D.CHAPTERS[p.ch].boss;
      p.wall[cb] = Math.min(wallOf(cb), (p.wall[cb] || 0) + st.wallDmg);
    }
    // 案件：這局在校園裡發生的事都留下來（筆記、冤枉、招供、主謀倒下）——不論撤離成敗
    var cs = st.cs;
    cs.raids += 1;
    if (st.out.solved) { p.stats.solved += 1; p.rep += R.SOLVE_REP; out.rep += R.SOLVE_REP; }
    var rescued = [];
    if (st.result === "extract") {
      p.stats.extracts += 1;
      p.stats.rescued += witnesses(st).length;
      witnesses(st).forEach(function (v) { cs.rescued[v.s] = true; rescued.push(v.s); });
      var items = st.me.bag.slice();
      witnesses(st).forEach(function () { items.push("testimony"); });
      var value = 0;
      items.forEach(function (id) {
        var it = R.ITEM[id];
        if (it.kind === "token") {
          if (p.ch < D.CHAPTERS.length && D.CHAPTERS[p.ch].boss === it.boss) {
            p.ch += 1;
            out.ch = true;
            if (p.ch >= D.CHAPTERS.length) { p.won = true; out.won = true; }
          } else { p.rep += 10; out.rep += 10; }
          out.gained.push(id);
          return;
        }
        if (it.kind === "key") { p.keys[id] = true; out.keys.push(id); out.gained.push(id); return; }
        if (it.kind === "evid") value += it.val;
        if (stashUsed(p) + it.size <= R.STASH) { p.stash.push(id); out.gained.push(id); }
        else if (it.kind === "evid") { p.rep += it.val; out.auto += it.val; }
        else out.lost.push(id);
      });
      p.stats.best = Math.max(p.stats.best, value);
      out.value = value;
    } else {
      var b0 = st.me.bag[0];
      var keep = st.me.pocket && b0 && R.ITEM[b0].kind !== "token" && R.ITEM[b0].kind !== "key" ? b0 : null;
      st.me.bag.forEach(function (id, i) { if (i === 0 && keep) return; out.lost.push(id); });
      if (keep) { p.stash.push(keep); out.gained.push(keep); }
      out.witnessLost = witnesses(st).length;
      out.value = 0;
    }
    st.out.broke.forEach(function (s) { cs.broke[s] = true; });
    // 晨間傳聞：給下一局的開場（也決定下一局一定有事件的地點）
    var rumors = [];
    rescued.forEach(function (s) { rumors.push({ k: "rescued", s: s }); });
    st.out.broke.forEach(function (s) { rumors.push({ k: "broke", s: s }); });
    st.out.wrong.forEach(function (s) { rumors.push({ k: "wrong", s: s }); });
    st.out.confess.forEach(function (s) { rumors.push({ k: "confess", s: s }); });
    if (st.out.solved) rumors.push({ k: "solved", s: cs.mm });
    if (st.result === "down" || st.result === "trapped") rumors.push({ k: st.result });
    else if (st.result === "extract" && out.value) rumors.push({ k: "extract" });
    if (st.wallDmg && p.ch < D.CHAPTERS.length) rumors.push({ k: "wall", boss: D.CHAPTERS[p.ch].boss });
    out.keys.forEach(function (k) { rumors.push({ k: "key", zone: R.ITEM[k].zone }); });
    // 被救出的學生回家後想起了什麼（真線索，直接寫進筆記）
    if (!cs.solved && rescued.length) {
      var mm = caseMm(cs);
      var a0 = pick(st, R.ATTRS).id;
      var v0 = valIdx(a0, mm[a0]);
      rumors.push({ k: "hint", s: rescued[0], a: a0, v: v0 });
      if (!cs.notes.some(function (n) { return n.s === rescued[0] && n.a === a0; })) cs.notes.push({ s: rescued[0], a: a0, v: v0, how: "rumor", raid: cs.raids });
    }
    var hotList = R.TILES.filter(function (t) { return (t.type === "blind" || t.type === "class") && zoneOpen(p.keys, t.zone) && !t.id.match(/^(c2a|gym|principal)$/); });
    cs.hot = pick(st, hotList).id;
    rumors.push({ k: "hot", place: cs.hot });
    cs.rumors = rumors.slice(-6);
    p.cs = cs;
    // 章節換了、或通關後破了案：下一份案件（ensureCase 會產生）
    ensureCase(p);
    return out;
  }

  // 案件筆記：某個學生符合幾條線索（畫面顯示用；不分真假）
  function matchCount(cs, s) {
    var c = cs.cast[s];
    return cs.notes.filter(function (n) { return R.ATTR[n.a].vals[n.v] === c[n.a]; }).length;
  }

  window.PriTestFistRaidCore = {
    newProfile: newProfile, loadProfile: loadProfile, ensureCase: ensureCase, buy: buy, submit: submit, discard: discard, mark: mark,
    bagMax: bagMax, stashUsed: stashUsed, used: used, wallOf: wallOf, zoneOpen: zoneOpen, matchCount: matchCount,
    create: create, tick: tick, act: act, applyFight: applyFight, settle: settle,
    tile: tile, adj: adj, dist: dist, route: route, open: open, bulliesAt: bulliesAt, victimsAt: victimsAt, studentsAt: studentsAt, witnesses: witnesses,
    boss: boss, bully: bully, student: student, here: here, hereBullies: hereBullies, visible: visible, walled: walled, isExit: isExit, safe: safe,
    stepTime: stepTime, searchTime: searchTime
  };
})();
