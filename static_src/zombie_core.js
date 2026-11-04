// 末日據點（zombie）：遊戲引擎——整局狀態、每日流程、探索事件、結算、感染、製作、結局、傳承。不碰 DOM。
//
// 狀態（state）是純 JSON：單機存在 localStorage；連線合作時由房主保管並廣播（zombie_net.js），
// 其他玩家只送「意圖」（intent），由房主的 applyIntent 套用。所以單機與連線走同一套規則。
// 亂數：state.rs（mulberry32 的狀態）每次抽都往前推，存檔／讀檔後接得上，同一個種子＋同樣的選擇＝同樣的發展（每日挑戰用）。
//
// 每天：plan（分配工作、選探索區域、大門口事件）→ explore（每個有派人外出的玩家各自翻事件卡）
//      → 白天的工作在進入夜晚前結算（修建、製作、治療、研究、休息）→ night（3D 即時或自動結算）
//      → dawn（吃喝、傷勢、感染倒數、士氣、背叛、新天氣、結局判定）→ 下一天 plan。
(function () {
  "use strict";

  var D = window.PriTestZombieData;
  var N = window.PriTestZombieNight;
  var C = D.C;

  var VERSION = 1;
  var MAX_HP = 10, MAX_STA = 10;
  var WALL_HP = [0, 60, 100, 150];
  var CORE_HP = 100;
  var CURE_NEED = { 10: 14, 30: 30 };
  var EVAC_DAYS = 3;

  // ---------------- 亂數 ----------------
  function rnd(s) {
    s.rs = (s.rs + 0x6d2b79f5) >>> 0;
    var t = s.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function ri(s, a, b) { return a + Math.floor(rnd(s) * (b - a + 1)); }
  function pick(s, arr) { return arr[Math.floor(rnd(s) * arr.length)]; }
  function weighted(s, table) {
    var keys = Object.keys(table), tot = 0, i;
    for (i = 0; i < keys.length; i++) tot += table[keys[i]];
    if (tot <= 0) return keys[0];
    var x = rnd(s) * tot;
    for (i = 0; i < keys.length; i++) { x -= table[keys[i]]; if (x < 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function hashStr(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  function newSeed() { return Math.floor(Math.random() * 4294967296) >>> 0; }
  // 每日挑戰：YYYYMMDD 當種子
  function dailyKey(date) {
    var d = date || new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  // ---------------- 小工具 ----------------
  function alive(s) { return s.surv.filter(function (v) { return v.alive; }); }
  function survById(s, id) { return s.surv.filter(function (v) { return v.id === id; })[0] || null; }
  function has(v, tr) { return v.traits.indexOf(tr) >= 0; }
  function anyTrait(s, tr) { return alive(s).some(function (v) { return has(v, tr); }); }
  function stat(v, k) {
    var x = v.stats[k];
    if (k === "cmb" && has(v, "coward")) x -= 1;
    if (k === "scv" && has(v, "parkour")) x += 1;
    if (k === "med" && has(v, "nurse")) x += 1;
    if (v.amp && (k === "cmb" || k === "scv")) x -= 1;
    if (v.sta < 3) x -= 1;
    return Math.max(0, x);
  }
  function weaponOf(s, v) { return v.weapon ? s.weapons.filter(function (w) { return w.uid === v.weapon; })[0] || null : null; }
  function rule(s, id) { return s.rules.indexOf(id) >= 0; }
  function progress(s) { return s.len <= 1 ? 1 : clamp((s.day - 1) / (s.len - 1), 0, 1); }
  // 日誌行：{ k: i18n 鍵, p: 參數（值可以是 C() 物件，畫面再翻譯）} 或 { c: C() }
  function line(k, p) { return { k: k, p: p || {} }; }
  function lit(c) { return { c: c }; }
  function resGain(s, k, n) {
    if (!n) return 0;
    var before = s.res[k];
    s.res[k] = Math.max(0, Math.round(before + n));
    return s.res[k] - before;
  }

  // ---------------- 倖存者 ----------------
  function makeSurvivor(s, owner, special) {
    var city = D.CITIES[s.city], used = {};
    s.surv.forEach(function (v) { used[v.name] = 1; });
    var v;
    if (special && D.SPECIALS[special]) {
      var sp = D.SPECIALS[special];
      v = { id: "v" + (s.nextId++), name: sp.name, special: special, owner: owner, job: -1, stats: JSON.parse(JSON.stringify(sp.stats)), traits: sp.traits.slice() };
      if (sp.weapon) v.weapon = addWeapon(s, sp.weapon);
    } else {
      var nm, guard = 0;
      do { nm = pick(s, city.people); guard++; } while (used[nm] && guard < 60);
      if (used[nm]) nm = nm + (s.nextId);
      var stats = {};
      D.STATS.forEach(function (k) { stats[k] = ri(s, 1, 3); });
      stats[pick(s, D.STATS)] += ri(s, 1, 2);
      var traits = [pick(s, D.TRAIT_IDS)];
      if (rnd(s) < 0.45) { var t2 = pick(s, D.TRAIT_IDS); if (traits.indexOf(t2) < 0) traits.push(t2); }
      v = { id: "v" + (s.nextId++), name: nm, owner: owner, job: ri(s, 0, D.JOBS.length - 1), stats: stats, traits: traits };
    }
    v.hp = MAX_HP; v.sta = MAX_STA; v.alive = true; v.inf = null; v.amp = false; v.assign = "rest";
    v.weapon = v.weapon || null;
    s.surv.push(v);
    return v;
  }
  function addWeapon(s, type) {
    var W = D.WEAPONS[type];
    if (!W) return null;
    var w = { uid: "w" + (s.nextId++), type: type, dur: W.dur };
    s.weapons.push(w);
    return w.uid;
  }

  // ---------------- 新遊戲 ----------------
  // o：{ seed, city: "tw"|"jp", len: 10|30, rules: [], base, daily, players: [{ pid, name, special? }] }
  function newGame(o) {
    var s = {
      v: VERSION, seed: (o.seed >>> 0) || newSeed(), rs: 0, city: D.CITIES[o.city] ? o.city : "tw", len: o.len === 30 ? 30 : 10,
      rules: (o.rules || []).filter(function (r) { return D.RULES[r]; }), base: D.BASES[o.base] ? o.base : "store", daily: o.daily || 0,
      day: 1, phase: "plan", weather: "clear", res: { food: 14, water: 14, meds: 3, ammo: 24, mats: 12, fuel: 4 },
      items: { molotov: 1, decoy: 0, serum: 0, part: 0 }, weapons: [], morale: 60, research: 0, evacIn: 0, dog: null, zeroMorale: 0,
      bld: {}, prog: {}, craftProg: {}, walls: [], core: CORE_HP,
      players: (o.players || [{ pid: "me", name: "" }]).map(function (p) { return { pid: p.pid, name: String(p.name || "").slice(0, 16) }; }),
      surv: [], plans: {}, explore: {}, gate: null, tonight: { horde: 0, heat: 0 }, districts: {}, seen: {},
      log: [], report: null, nightRes: null, stats: { kills: 0, found: 0, deaths: 0, recruits: 0, days: 0 }, end: null, nextId: 1, ack: {}
    };
    s.rs = (s.seed ^ 0x2545f491) >>> 0;
    D.BUILD_IDS.forEach(function (b) { s.bld[b] = b === "wall" ? 1 : 0; });
    var B = D.BASES[s.base];
    Object.keys(B.bld || {}).forEach(function (b) { s.bld[b] = B.bld[b]; });
    Object.keys(B.res || {}).forEach(function (k) { resGain(s, k, B.res[k]); });
    s.morale = clamp(s.morale + (B.morale || 0), 0, 100);
    var np = s.players.length;
    if (np > 1) D.RES.forEach(function (k) { s.res[k] = Math.round(s.res[k] * (1 + 0.6 * (np - 1))); });
    if (rule(s, "nomeds")) s.res.meds = 0;
    for (var i = 0; i < N.SEG_N; i++) s.walls.push(WALL_HP[s.bld.wall]);
    // 區域：每個原型一個點。同一圈的區域平均分配角度（地圖上不重疊），每圈的起始角度與順序依種子打散
    [1, 2, 3, 4].forEach(function (ring) {
      var ids = D.ARCH_IDS.filter(function (a) { return D.ARCH[a].ring === ring; });
      for (var j = ids.length - 1; j > 0; j--) { var q = Math.floor(rnd(s) * (j + 1)); var tmp = ids[j]; ids[j] = ids[q]; ids[q] = tmp; }
      var off = rnd(s) * 360;
      ids.forEach(function (a, k) { s.districts[a] = { ang: off + (k / ids.length) * 360 + (rnd(s) - 0.5) * 10, dep: 0, visits: 0 }; });
    });
    // 倖存者：單機 4 人；合作每人 3 人（4 人房 2 人）
    var per = np === 1 ? 4 : np >= 4 ? 2 : 3;
    s.players.forEach(function (p, idx) {
      var sp = (o.players && o.players[idx] && o.players[idx].special) || null;
      for (var k2 = 0; k2 < per; k2++) makeSurvivor(s, p.pid, k2 === 0 ? sp : null);
      s.plans[p.pid] = { district: "", build: "repair", craft: "", ready: false };
    });
    s.weather = rollWeather(s, true);
    s.log = [line("zm_log_day1", { city: D.CITIES[s.city].name, base: D.BASES[s.base].name })];
    return s;
  }
  function rollWeather(s, first) {
    if (first) return "clear";
    var t = {};
    Object.keys(D.WEATHERS).forEach(function (k) { t[k] = D.WEATHERS[k].w; });
    return weighted(s, t);
  }

  // ---------------- 意圖（玩家操作） ----------------
  // 回傳 true＝狀態有變（呼叫端要存檔／廣播）。不合法的意圖一律忽略。
  function applyIntent(s, pid, it) {
    if (!s || s.end || !it) return false;
    var me = s.players.filter(function (p) { return p.pid === pid; })[0];
    if (!me) return false;
    var v = it.sid ? survById(s, it.sid) : null;
    var mine = v && v.alive && v.owner === pid;
    var plan = s.plans[pid] || (s.plans[pid] = { district: "", build: "repair", craft: "", ready: false });
    switch (it.a) {
      case "assign":
        if (s.phase !== "plan" || !mine || D.DAY_JOBS.indexOf(it.job) < 0 || plan.ready) return false;
        if (it.job === "scavenge" && !canScavenge(v)) return false;
        v.assign = it.job;
        return true;
      case "district":
        if (s.phase !== "plan" || plan.ready || (it.d && !D.ARCH[it.d])) return false;
        plan.district = it.d || "";
        return true;
      case "build":
        if (s.phase !== "plan" || plan.ready || (it.b !== "repair" && !canBuild(s, it.b))) return false;
        plan.build = it.b;
        return true;
      case "craft":
        if (s.phase !== "plan" || plan.ready || (it.r && !canCraft(s, it.r))) return false;
        plan.craft = it.r || "";
        return true;
      case "equip": {
        if (!mine || s.phase === "night" || s.phase === "explore") return false;
        var w = it.w ? s.weapons.filter(function (x) { return x.uid === it.w; })[0] : null;
        if (it.w && !w) return false;
        s.surv.forEach(function (o) { if (w && o.weapon === w.uid) o.weapon = null; });
        v.weapon = w ? w.uid : null;
        return true;
      }
      case "treat":
        if (!mine || !v.inf || s.phase === "night" || s.phase === "explore") return false;
        return treat(s, v, it.how);
      case "gate":
        if (s.phase !== "plan" || !s.gate) return false;
        return answerGate(s, pid, it.c | 0);
      case "ready":
        if (s.phase === "plan") {
          if (it.v && s.gate) return false;           // 大門口的事要先處理
          plan.ready = !!it.v;
          if (allReady(s)) startExplore(s);
          return true;
        }
        if (s.phase === "dawn") {
          s.ack[pid] = true;
          if (s.players.every(function (p) { return s.ack[p.pid]; })) startDay(s);
          return true;
        }
        return false;
      case "answer":
        if (s.phase !== "explore") return false;
        return answerCard(s, pid, it.c | 0);
      default:
        return false;
    }
  }
  function canScavenge(v) { return v.alive && v.hp > 3 && v.sta >= 2; }
  function allReady(s) { return s.players.every(function (p) { return s.plans[p.pid] && s.plans[p.pid].ready; }); }
  function canBuild(s, b) {
    var B = D.BUILDINGS[b];
    if (!B || s.bld[b] >= B.max) return false;
    if (B.need && !s.bld[B.need]) return false;
    return true;
  }
  function canCraft(s, r) {
    var R = D.RECIPES[r];
    return !!R && (!R.need || !!s.bld[R.need]);
  }
  function costOk(s, cost) { return Object.keys(cost || {}).every(function (k) { return s.res[k] >= cost[k]; }); }
  function payCost(s, cost) { Object.keys(cost || {}).forEach(function (k) { resGain(s, k, -cost[k]); }); }

  // 感染處理：serum 血清／amputate 截肢／exile 讓他離開／reveal 公開（藏著的感染）
  function treat(s, v, how) {
    if (how === "serum") {
      if (s.items.serum <= 0) return false;
      s.items.serum--; v.inf = null;
      s.log.push(line("zm_log_serum", { n: v.name }));
      return true;
    }
    if (how === "amputate") {
      var doc = alive(s).filter(function (o) { return o !== v && stat(o, "med") >= 3; }).length > 0;
      if (!doc && !s.bld.infirmary) return false;
      var p = 0.6 + (s.bld.infirmary ? 0.2 : 0) + (doc ? 0.1 : 0);
      if (rnd(s) < p) {
        v.inf = null; v.amp = true; v.hp = Math.max(1, v.hp - 3);
        s.morale = clamp(s.morale - 3, 0, 100);
        s.log.push(line("zm_log_amp_ok", { n: v.name }));
      } else {
        die(s, v, "amp");
        s.log.push(line("zm_log_amp_ng", { n: v.name }));
      }
      return true;
    }
    if (how === "exile") {
      v.alive = false; v.gone = "exile";
      s.morale = clamp(s.morale - 6, 0, 100);
      s.log.push(line("zm_log_exile", { n: v.name }));
      return true;
    }
    if (how === "reveal") {
      if (!v.inf.hid) return false;
      v.inf.hid = false;
      s.morale = clamp(s.morale - 4, 0, 100);
      s.log.push(line("zm_log_reveal", { n: v.name }));
      return true;
    }
    return false;
  }
  function die(s, v, why) {
    if (!v.alive) return;
    v.alive = false; v.gone = why || "dead"; v.hp = 0;
    s.stats.deaths++;
    s.morale = clamp(s.morale - 10, 0, 100);
    if (v.weapon) v.weapon = null;
  }
  function hurtSurv(s, v, n) {
    if (!v.alive) return 0;
    var d = has(v, "tough") ? Math.max(1, n - 1) : n;
    v.hp -= d;
    if (v.hp <= 0) die(s, v, "wounds");
    return d;
  }
  function bite(s, v) {
    if (!v.alive || v.inf) return false;
    v.inf = { d: rule(s, "bitey") ? 2 : 3, hid: true };   // 一開始只有自己知道（公開與否由狗主人決定）
    return true;
  }

  // ---------------- 大門口事件 ----------------
  function answerGate(s, pid, c) {
    var e = D.EVENT_BY_ID[s.gate.id], o = e && e.ch[c];
    if (!o || !reqOk(s, null, o.req)) return false;
    var ctx = { s: s, pid: pid, team: alive(s).filter(function (v) { return v.owner === pid; }), lines: [], gate: true };
    applyEff(ctx, o.eff);
    s.log.push(line("zm_log_gate", { e: e.text, c: o.t }));
    if (o.r) s.log.push(lit(o.r));
    ctx.lines.forEach(function (l) { s.log.push(l); });
    s.gate = null;
    return true;
  }

  // ---------------- 探索 ----------------
  function teamOf(s, pid) { return alive(s).filter(function (v) { return v.owner === pid && v.assign === "scavenge" && canScavenge(v); }); }
  function startExplore(s) {
    s.phase = "explore"; s.explore = {};
    var f = progress(s);
    s.players.forEach(function (p) {
      var plan = s.plans[p.pid], team = teamOf(s, p.pid);
      if (!team.length || !plan.district) {
        team.forEach(function (v) { v.assign = "rest"; });
        return;
      }
      var A = D.ARCH[plan.district], dist = s.districts[plan.district];
      var ncards = 2 + (A.ring >= 3 ? 1 : 0), cards = [], cand = {};
      D.EVENTS.forEach(function (e) {
        if (e.at && e.at.indexOf(plan.district) < 0) return;
        if ((e.min || 0) > f || (e.once && s.seen[e.id])) return;
        cand[e.id] = e.w * (e.at ? 1.6 : 1);
      });
      while (cards.length < ncards && Object.keys(cand).length) {
        var id = weighted(s, cand);
        cards.push(id); delete cand[id];
      }
      var noise = (anyTraitIn(team, "chatter") ? 1 : 0) + (s.weather === "fog" ? 1 : 0);
      var ex = { pid: p.pid, d: plan.district, team: team.map(function (v) { return v.id; }), cards: cards, step: 0, noise: noise, log: [], done: false, horde: 0, heat: 0 };
      // 交通：第 3 圈以上開車（燃料 1），沒油就走路（體力 −2）
      if (A.ring >= 3) {
        if (s.res.fuel > 0) { resGain(s, "fuel", -1); ex.log.push(line("zm_ex_drive")); }
        else { team.forEach(function (v) { v.sta = clamp(v.sta - 2, 0, MAX_STA); }); ex.log.push(line("zm_ex_walk")); }
      }
      team.forEach(function (v) { v.sta = clamp(v.sta - 1 - Math.ceil(A.ring / 2), 0, MAX_STA); });
      dist.visits++;
      s.explore[p.pid] = ex;
    });
    if (Object.keys(s.explore).every(function (k) { return s.explore[k].done; })) endDay(s);
  }
  function anyTraitIn(team, tr) { return team.some(function (v) { return has(v, tr); }); }
  function exTeam(s, ex) { return ex.team.map(function (id) { return survById(s, id); }).filter(function (v) { return v && v.alive; }); }
  function teamStat(team, k) { var t = 0; team.forEach(function (v) { t += stat(v, k); }); return t; }
  function reqOk(s, ex, req) {
    if (!req) return true;
    if (req.g && !costOk(s, req.g)) return false;
    if (req.item && !(s.items[req.item] > 0)) return false;
    if (req.dog && !s.dog) return false;
    var team = ex ? exTeam(s, ex) : alive(s);
    if (req.trait && !anyTraitIn(team, req.trait)) return false;
    if (req.stat && !team.some(function (v) { return stat(v, req.stat[0]) >= req.stat[1]; })) return false;
    return true;
  }
  function currentCard(s, pid) {
    var ex = s.explore[pid];
    if (!ex || ex.done) return null;
    return D.EVENT_BY_ID[ex.cards[ex.step]] || null;
  }
  function answerCard(s, pid, c) {
    var ex = s.explore[pid];
    if (!ex || ex.done) return false;
    var e = D.EVENT_BY_ID[ex.cards[ex.step]], o = e && e.ch[c];
    if (!o || !reqOk(s, ex, o.req)) return false;
    s.seen[e.id] = (s.seen[e.id] || 0) + 1;
    var ctx = { s: s, pid: pid, ex: ex, team: exTeam(s, ex), lines: [] };
    ex.log.push({ card: e.id, c: c });
    applyEff(ctx, o.eff);
    if (o.r) ex.log.push(lit(o.r));
    ctx.lines.forEach(function (l) { ex.log.push(l); });
    ex.step++;
    if (!exTeam(s, ex).length) { ex.done = true; ex.log.push(line("zm_ex_wiped")); }
    else if (ex.step >= ex.cards.length) finishExplore(s, ex);
    if (Object.keys(s.explore).every(function (k) { return s.explore[k].done; })) endDay(s);
    return true;
  }
  // 效果
  function applyEff(ctx, effs) {
    var s = ctx.s;
    (effs || []).forEach(function (e) {
      if (e.g) Object.keys(e.g).forEach(function (k) {
        var got = resGain(s, k, e.g[k]);
        if (got) ctx.lines.push(line(got > 0 ? "zm_l_gain" : "zm_l_lose", { r: D.RES_INFO[k].name, i: D.RES_INFO[k].icon, n: Math.abs(got) }));
        if (got > 0) s.stats.found += got;
      });
      if (e.item) {
        var before = s.items[e.item] || 0;
        s.items[e.item] = Math.max(0, before + e.n);
        var dn = s.items[e.item] - before;
        if (dn) ctx.lines.push(line(dn > 0 ? "zm_l_gain" : "zm_l_lose", { r: D.ITEMS[e.item].name, i: D.ITEMS[e.item].icon, n: Math.abs(dn) }));
      }
      if (e.parts) { s.items.part += e.parts; ctx.lines.push(line("zm_l_gain", { r: D.ITEMS.part.name, i: D.ITEMS.part.icon, n: e.parts })); }
      if (e.weapon) { addWeapon(s, e.weapon); ctx.lines.push(line("zm_l_weapon", { w: D.WEAPONS[e.weapon].name, i: D.WEAPONS[e.weapon].icon })); }
      if (e.rp) { s.research += e.rp; ctx.lines.push(line("zm_l_rp", { n: e.rp })); }
      if (e.mor) { s.morale = clamp(s.morale + e.mor, 0, 100); ctx.lines.push(line(e.mor > 0 ? "zm_l_mor_up" : "zm_l_mor_down", { n: Math.abs(e.mor) })); }
      if (e.heat) { s.tonight.heat += e.heat; ctx.lines.push(line("zm_l_heat", { n: e.heat })); }
      if (e.horde) { s.tonight.horde += e.horde; ctx.lines.push(line(e.horde > 0 ? "zm_l_horde_up" : "zm_l_horde_down", { n: Math.round(Math.abs(e.horde) * 100) })); }
      if (e.noise && ctx.ex) { ctx.ex.noise += e.noise; ctx.lines.push(line("zm_l_noise")); }
      if (e.sta) ctx.team.forEach(function (v) { v.sta = clamp(v.sta + e.sta, 0, MAX_STA); });
      if (e.dog && !s.dog) { s.dog = { name: C("便當", "ベントー") }; ctx.lines.push(line("zm_l_dog")); }
      if (e.recruit) for (var i = 0; i < e.recruit; i++) {
        var nv = makeSurvivor(s, ctx.pid);
        nv.sta = 6;
        s.stats.recruits++;
        ctx.lines.push(line("zm_l_recruit", { n: nv.name }));
      }
      if (e.hurt) {
        var team = ctx.team.filter(function (v) { return v.alive; });
        var who = e.who === "all" ? team : team.length ? [e.who === "weak" ? team.slice().sort(function (a, b) { return a.hp - b.hp; })[0] : pick(s, team)] : [];
        who.forEach(function (v) { var d = hurtSurv(s, v, e.hurt); ctx.lines.push(line(v.alive ? "zm_l_hurt" : "zm_l_died", { n: v.name, d: d })); });
      }
      if (e.bite) tryBite(ctx, e.bite);
      if (e.fight) fight(ctx, e.fight);
      if (e.leave) {
        var t2 = ctx.team.filter(function (v) { return v.alive; });
        if (t2.length) { var lv = pick(s, t2); lv.alive = false; lv.gone = "left"; ctx.lines.push(line("zm_l_left", { n: lv.name })); }
      }
      if (e.chance !== undefined) {
        var p = e.chance + (e.stat ? teamStat(ctx.team, e.stat) * 0.04 : 0) + (anyTraitIn(ctx.team, "lucky") ? 0.1 : 0);
        var ok = rnd(s) < clamp(p, 0.05, 0.95);
        var r2 = ok ? e.ry : e.rn;
        if (r2) ctx.lines.push(lit(r2));
        applyEff(ctx, ok ? e.yes : e.no);
      }
    });
  }
  function tryBite(ctx, p0) {
    var s = ctx.s, team = ctx.team.filter(function (v) { return v.alive && !v.inf; });
    if (!team.length) return;
    var p = p0 * (rule(s, "bitey") ? 1.6 : 1);
    if (rnd(s) >= p) return;
    var v = pick(s, team);
    if (has(v, "coward") && rnd(s) < 0.5) { ctx.lines.push(line("zm_l_coward_dodge", { n: v.name })); return; }
    if (has(v, "lucky") && rnd(s) < 0.4) { ctx.lines.push(line("zm_l_lucky_dodge", { n: v.name })); return; }
    bite(s, v);
    ctx.lines.push(line("zm_l_bitten", { n: v.name, pid: v.owner }));
  }
  // 探索中的小規模戰鬥
  function fight(ctx, f) {
    var s = ctx.s, team = ctx.team.filter(function (v) { return v.alive; });
    if (!team.length) return;
    var Z = D.ZOMBIES[f.z] || D.ZOMBIES.walker, n = (f.n || 1) + (ctx.ex ? ctx.ex.noise : 0) * (f.z === "brute" ? 0 : 1);
    var prog = progress(s), threat = n * Z.threat * (1 + prog * 0.9) * (rule(s, "tourist") ? 0.6 : 1);
    var power = 0, gun = !!f.gun, ammoNeed = Math.ceil(n * Z.threat);
    if (gun && s.res.ammo < ammoNeed) gun = false;
    team.forEach(function (v) {
      var w = weaponOf(s, v);
      power += stat(v, "cmb") + 0.5 + (w ? D.WEAPONS[w.type].dmg * 0.5 : 0);
      if (w && !(D.WEAPONS[w.type].ranged && !gun)) { w.dur--; if (w.dur <= 0) breakWeapon(s, v, w, ctx.lines); }
    });
    if (s.dog) power += 1.5;
    if (gun) { power *= 1.7; resGain(s, "ammo", -ammoNeed); if (ctx.ex) ctx.ex.noise++; ctx.lines.push(line("zm_l_gunfire", { n: ammoNeed })); }
    var need = threat * 1.6;
    s.stats.kills += n;
    if (power >= need) { ctx.lines.push(line("zm_l_fight_win", { n: n, z: Z.name })); return; }
    var def = need - power;
    ctx.lines.push(line("zm_l_fight_hard", { n: n, z: Z.name }));
    var hits = Math.max(1, Math.round(def / 2.2));
    for (var i = 0; i < hits; i++) {
      var alv = team.filter(function (v) { return v.alive; });
      if (!alv.length) break;
      var v = pick(s, alv), d = hurtSurv(s, v, ri(s, 1, 3));
      ctx.lines.push(line(v.alive ? "zm_l_hurt" : "zm_l_died", { n: v.name, d: d }));
    }
    tryBite(ctx, clamp(0.1 + def * 0.05, 0, 0.6));
  }
  function breakWeapon(s, v, w, lines) {
    s.weapons = s.weapons.filter(function (x) { return x !== w; });
    s.surv.forEach(function (o) { if (o.weapon === w.uid) o.weapon = null; });
    lines.push(line("zm_l_broke", { n: v.name, w: D.WEAPONS[w.type].name }));
  }
  function finishExplore(s, ex) {
    var team = exTeam(s, ex), A = D.ARCH[ex.d], dist = s.districts[ex.d];
    var depF = Math.max(0.3, 1 - dist.dep * 0.18), mult = (rule(s, "scarce") ? 0.6 : 1) * (rule(s, "tourist") ? 1.3 : 1);
    var rolls = 2 + A.ring + Math.floor(teamStat(team, "scv") * 0.35) + (s.dog ? 1 : 0);
    if (anyTraitIn(team, "glutton") && (ex.d === "market" || ex.d === "conv" || ex.d === "nightmkt")) rolls += 2;
    var got = {};
    for (var i = 0; i < rolls; i++) {
      var k = weighted(s, A.loot), amt = ri(s, 1, 2 + Math.floor(A.ring / 2));
      if (k === "meds" && rule(s, "nomeds")) amt = Math.ceil(amt / 2);
      got[k] = (got[k] || 0) + amt;
    }
    var ctx = { s: s, pid: ex.pid, ex: ex, team: team, lines: [] };
    var g = {};
    Object.keys(got).forEach(function (k) { g[k] = Math.max(1, Math.round(got[k] * depF * mult)); });
    applyEff(ctx, [{ g: g }]);
    var sp = A.sp || {};
    if (sp.serum && rnd(s) < sp.serum * depF) applyEff(ctx, [{ item: "serum", n: 1 }]);
    if (sp.part && rnd(s) < sp.part * depF) applyEff(ctx, [{ parts: 1 }]);
    if (sp.weapon && rnd(s) < sp.weapon * depF) applyEff(ctx, [{ weapon: pick(s, ["machete", "pistol", "bat"]) }]);
    if (sp.rp && rnd(s) < 0.6 * depF) applyEff(ctx, [{ rp: 2 }]);
    if (sp.morale) applyEff(ctx, [{ mor: 3 }]);
    if (rnd(s) < 0.2 * depF) applyEff(ctx, [{ weapon: pick(s, ["knife", "spear", "bat"]) }]);
    dist.dep++;
    ex.log.push(line("zm_ex_loot", { d: districtName(s, ex.d) }));
    ctx.lines.forEach(function (l) { ex.log.push(l); });
    ex.done = true;
  }
  function districtName(s, a) { return D.CITIES[s.city].names[a]; }

  // ---------------- 白天的工作（進入夜晚前結算） ----------------
  function moraleMult(s) { return 0.8 + s.morale / 250; }
  function endDay(s) {
    var lines = [], mm = moraleMult(s);
    // 外出的人回來了；其他人做自己的工作
    var work = {}, craft = {};
    alive(s).forEach(function (v) {
      if (v.assign === "scavenge") return;
      var tired = v.sta < 3 ? 0.6 : 1, p = s.plans[v.owner] || {};
      if (v.assign === "build") {
        var w = (2 + stat(v, "crf") + (has(v, "workaholic") ? 2 : 0)) * mm * tired;
        var key = p.build || "repair";
        work[key] = (work[key] || 0) + w;
        v.sta = clamp(v.sta - 1 - (has(v, "workaholic") ? 1 : 0), 0, MAX_STA);
      } else if (v.assign === "craft") {
        var c = (1 + stat(v, "crf") + (has(v, "tinker") ? 2 : 0) + (s.bld.workshop ? 3 : 0)) * mm * tired;
        if (p.craft) craft[p.craft] = (craft[p.craft] || 0) + c;
        else work.repair = (work.repair || 0) + c * 0.5;
        v.sta = clamp(v.sta - 1, 0, MAX_STA);
      } else if (v.assign === "heal") {
        heal(s, (stat(v, "med") * 1.5 + 1) * (s.bld.infirmary ? 1.5 : 1), has(v, "nurse"), lines);
      } else if (v.assign === "research") {
        if (s.bld.lab) { var rp = Math.round((1 + stat(v, "med") * 0.5 + stat(v, "crf") * 0.5) * mm * 10) / 10; s.research = Math.round((s.research + rp) * 10) / 10; lines.push(line("zm_l_research", { n: v.name, p: rp })); }
        else lines.push(line("zm_l_nolab", { n: v.name }));
      } else {
        v.sta = clamp(v.sta + 5, 0, MAX_STA);
        if (v.hp < MAX_HP && !v.inf) v.hp = Math.min(MAX_HP, v.hp + 1);
      }
    });
    Object.keys(work).forEach(function (b) { buildWork(s, b, work[b], lines); });
    Object.keys(craft).forEach(function (r) { craftWork(s, r, craft[r], lines); });
    s.dayLog = lines;
    startNight(s);
  }
  // 治療：每 1 點回 1 HP；有藥時每用 1 份藥可回 perMed 點，沒藥只有一半效果
  function heal(s, pts, nurse, lines) {
    var perMed = nurse ? 5 : 3;
    alive(s).filter(function (v) { return v.hp < MAX_HP; }).sort(function (a, b) { return a.hp - b.hp; }).forEach(function (v) {
      var need = Math.min(MAX_HP - v.hp, Math.floor(pts));
      if (need <= 0) return;
      var withMed = Math.min(need, s.res.meds * perMed), noMed = Math.floor((need - withMed) / 2), tot = withMed + noMed;
      if (!tot) return;
      resGain(s, "meds", -Math.ceil(withMed / perMed));
      v.hp += tot; pts -= need;
      lines.push(line("zm_l_healed", { n: v.name, d: tot }));
    });
  }
  function buildWork(s, b, w, lines) {
    if (b === "repair" || !canBuild(s, b)) {
      // 修牆：每 1 工作量修 6 點，每 10 點用 1 材料，先修最破的
      var hp = Math.min(Math.round(w * 6), s.res.mats * 10), max = WALL_HP[s.bld.wall], fixed = 0, left = Math.round(w * 6);
      while (hp > 0) {
        var low = -1;
        for (var i = 0; i < s.walls.length; i++) if (s.walls[i] < max && (low < 0 || s.walls[i] < s.walls[low])) low = i;
        if (low < 0) break;
        var add = Math.min(10, hp, max - s.walls[low]);
        s.walls[low] += add; hp -= add; fixed += add;
      }
      if (fixed > 0) resGain(s, "mats", -Math.ceil(fixed / 10));
      hp = left - fixed;
      if (fixed > 0) lines.push(line("zm_l_repair", { n: Math.round(fixed) }));
      if (s.core < CORE_HP && hp > 0) { var c2 = Math.min(CORE_HP - s.core, hp); s.core += c2; lines.push(line("zm_l_core_fix", { n: Math.round(c2) })); }
      return;
    }
    var B = D.BUILDINGS[b], lv = s.bld[b], pr = s.prog[b] || { w: 0, paid: false };
    if (!pr.paid) {
      if (s.res.mats < B.cost[lv] || (B.needParts && s.items.part < B.needParts)) { lines.push(line("zm_l_build_nomats", { b: B.name })); return buildWork(s, "repair", w, lines); }
      resGain(s, "mats", -B.cost[lv]);
      if (B.needParts) s.items.part -= B.needParts;
      pr.paid = true;
    }
    pr.w += w;
    if (pr.w >= B.work[lv]) {
      s.bld[b] = lv + 1;
      delete s.prog[b];
      lines.push(line("zm_l_built", { b: B.name, lv: lv + 1 }));
      if (b === "wall") { var diff = WALL_HP[lv + 1] - WALL_HP[lv]; s.walls = s.walls.map(function (x) { return x + diff; }); }
      if (b === "radio") { s.evacIn = EVAC_DAYS; lines.push(line("zm_l_radio")); }
    } else {
      s.prog[b] = pr;
      lines.push(line("zm_l_building", { b: B.name, p: Math.round(pr.w * 10) / 10, need: B.work[lv] }));
    }
  }
  function craftWork(s, r, w, lines) {
    var R = D.RECIPES[r];
    if (!R || !canCraft(s, r)) return;
    var pts = w + (s.craftProg[r] || 0), made = 0;
    while (pts >= R.work && costOk(s, R.cost) && made < 6) {
      payCost(s, R.cost); pts -= R.work; made++;
      if (R.out.item) s.items[R.out.item] = (s.items[R.out.item] || 0) + R.out.n;
      if (R.out.g) Object.keys(R.out.g).forEach(function (k) { resGain(s, k, R.out.g[k]); });
      if (R.out.weapon) addWeapon(s, R.out.weapon);
    }
    s.craftProg[r] = made ? 0 : Math.min(pts, R.work);
    if (made) { lines.push(line("zm_l_crafted", { r: R.name, n: made })); s.tonight.heat += 0.5; }
    else lines.push(line(costOk(s, R.cost) ? "zm_l_craft_prog" : "zm_l_craft_nomats", { r: R.name }));
  }

  // ---------------- 夜晚 ----------------
  function heatOf(s) {
    return Math.round(((s.bld.generator && s.res.fuel > 0 ? 2 : 0) + (s.bld.kitchen ? 1 : 0) + s.tonight.heat + alive(s).length * 0.15 + (s.dog ? 0.3 : 0)) * 10) / 10;
  }
  function nightSetup(s) {
    var f = progress(s), np = s.players.length, heat = heatOf(s);
    var heatMult = 1 + heat * 0.06 * (rule(s, "loud") ? 2 : 1);
    var mult = (1 + s.tonight.horde) * heatMult * (rule(s, "horde") ? 1.6 : 1) * (rule(s, "tourist") ? 0.6 : 1) * (1 + 0.6 * (np - 1));
    var n = Math.max(4, Math.round((6 + 30 * Math.pow(f, s.len === 30 ? 1.6 : 1.2)) * mult));   // 長局的屍潮成長慢一點（要撐的天數多三倍）
    var mix = { walker: 1, runner: 0.1 + 0.25 * f, brute: f > 0.25 ? 0.04 + 0.08 * f : 0, screamer: f > 0.2 ? 0.06 : 0, mutant: f >= 0.45 ? 0.06 + 0.1 * f : 0 };
    if (rule(s, "sprinters")) { mix.runner += 0.4; mix.walker -= 0.4; }
    var light = s.bld.generator && s.res.fuel > 0 ? 0.1 : 0;
    var accMod = light - (s.weather === "fog" ? 0.12 : s.weather === "rain" ? 0.05 : 0);
    var guards = alive(s).filter(function (v) { return v.hp > 2; }).map(function (v) {
      var w = weaponOf(s, v), W = w ? D.WEAPONS[w.type] : null, cmb = stat(v, "cmb");
      return {
        sid: v.id, name: v.name, cmb: cmb,
        acc: 0.48 + cmb * 0.07 + (has(v, "sniper") ? 0.15 : 0) + (W && W.ranged ? 0.1 : 0),
        cd: Math.max(0.5, (1.5 - cmb * 0.1) * (has(v, "nightowl") ? 0.75 : 1)),
        dmg: 5 + (W && W.ranged ? W.dmg - 3 : 0), mdmg: 2.5 + (W ? W.dmg * 0.5 : 0) + cmb * 0.4, sniper: has(v, "sniper")
      };
    }).sort(function (a, b) { return b.cmb - a.cmb || (a.sid < b.sid ? -1 : 1); });
    return {
      seed: (s.seed ^ Math.imul(s.day + 7, 0x9e3779b1)) >>> 0, day: s.day, f: Math.round(f * 100) / 100, heat: heat,
      n: n, mix: mix, spd: s.weather === "rain" ? 0.8 : 1, hpMult: 1 + f * 0.35, accMod: Math.round(accMod * 100) / 100,
      walls: s.walls.slice(), wallMax: WALL_HP[s.bld.wall], core: s.core, coreMax: CORE_HP,
      tower: s.bld.tower, traps: s.bld.traps, wire: s.bld.wire, guards: guards,
      ammo: s.res.ammo, mats: s.res.mats, molotov: s.items.molotov, decoy: s.items.decoy,
      spawnDur: 50, limit: 95, weather: s.weather, dog: !!s.dog
    };
  }
  function startNight(s) {
    s.phase = "night";
    s.night = nightSetup(s);
    s.nightRes = null;
  }
  // 房主（或單機）跑完夜晚後呼叫
  function endNight(s, res) {
    if (s.phase !== "night" || !res) return false;
    var lines = [];
    s.walls = res.walls.map(function (w) { return Math.max(0, Math.round(w)); });
    s.core = Math.max(0, Math.round(res.core));
    resGain(s, "ammo", -res.ammoUsed); resGain(s, "mats", -res.matsUsed);
    s.items.molotov = Math.max(0, s.items.molotov - res.molUsed);
    s.items.decoy = Math.max(0, s.items.decoy - res.decoyUsed);
    s.stats.kills += res.kills;
    lines.push(line("zm_l_night", { k: res.kills, t: res.total, a: res.ammoUsed, b: res.breaches }));
    // 守衛的武器耐久
    (s.night.guards || []).forEach(function (g) {
      var v = survById(s, g.sid), w = v && weaponOf(s, v);
      if (w) { w.dur--; if (w.dur <= 0) breakWeapon(s, v, w, lines); }
    });
    // 核心被打：每 12 點傷害有一個人受傷，兩成機率被咬
    var hits = Math.floor((res.coreDmg || 0) / 12);
    for (var i = 0; i < hits; i++) {
      var al = alive(s);
      if (!al.length) break;
      var v2 = pick(s, al), d = hurtSurv(s, v2, 2);
      lines.push(line(v2.alive ? "zm_l_hurt" : "zm_l_died", { n: v2.name, d: d }));
      if (v2.alive && rnd(s) < 0.2 * (rule(s, "bitey") ? 1.6 : 1) && bite(s, v2)) lines.push(line("zm_l_bitten", { n: v2.name, pid: v2.owner }));
    }
    s.nightRes = res;
    s.nightLog = lines;
    if (res.overrun || !alive(s).length) return finish(s, "fall");
    dawn(s);
    return true;
  }

  // ---------------- 清晨 ----------------
  function dawn(s) {
    var lines = [], al = alive(s);
    // 生產
    if (s.bld.garden) { resGain(s, "food", s.bld.garden * 2); resGain(s, "water", -1); lines.push(line("zm_l_garden", { n: s.bld.garden * 2 })); }
    if (s.bld.purifier) { resGain(s, "water", s.bld.purifier * 3); lines.push(line("zm_l_purifier", { n: s.bld.purifier * 3 })); }
    if (s.weather === "rain") { resGain(s, "water", 2); lines.push(line("zm_l_rainwater")); }
    if (s.bld.generator) { if (s.res.fuel > 0) resGain(s, "fuel", -1); else lines.push(line("zm_l_gen_off")); }
    if (s.bld.kitchen) s.morale = clamp(s.morale + 4 + (anyTrait(s, "cook") ? 3 : 0), 0, 100);
    // 寒流
    if (s.weather === "cold") {
      if (s.res.fuel > 0) { resGain(s, "fuel", -1); lines.push(line("zm_l_heating")); }
      else { al.forEach(function (v) { v.sta = clamp(v.sta - 2, 0, MAX_STA); }); s.morale = clamp(s.morale - 6, 0, 100); lines.push(line("zm_l_freezing")); }
    }
    // 吃喝
    var cook = anyTrait(s, "cook") ? 1 : 0, eaters = [];
    al.forEach(function (v) { eaters.push(v); if (has(v, "glutton")) eaters.push(v); });
    var foodNeed = Math.max(0, eaters.length + (s.dog ? 1 : 0) - cook);
    var waterNeed = Math.ceil(al.length * (s.weather === "heat" ? 1.5 : 1));
    var fedN = Math.min(s.res.food, foodNeed), drinkN = Math.min(s.res.water, waterNeed);
    resGain(s, "food", -fedN); resGain(s, "water", -drinkN);
    var hungry = foodNeed - fedN, thirsty = waterNeed - drinkN;
    if (hungry > 0) {
      // 自私的人先吃（缺糧時偷吃）
      var order = al.slice().sort(function (a, b) { return (has(b, "selfish") ? 1 : 0) - (has(a, "selfish") ? 1 : 0); });
      order.reverse().slice(0, Math.min(hungry, al.length)).forEach(function (v) { hurtSurv(s, v, 1); });
      s.morale = clamp(s.morale - 4 * Math.min(hungry, al.length), 0, 100);
      lines.push(line("zm_l_hungry", { n: hungry }));
    }
    if (thirsty > 0) {
      al.slice(0, Math.min(thirsty, al.length)).forEach(function (v) { hurtSurv(s, v, 2); });
      s.morale = clamp(s.morale - 4 * Math.min(thirsty, al.length), 0, 100);
      lines.push(line("zm_l_thirsty", { n: thirsty }));
    }
    // 感染倒數
    alive(s).forEach(function (v) {
      if (!v.inf) return;
      v.inf.d--;
      if (v.inf.d > 0) return;
      if (v.inf.hid) {
        var others = alive(s).filter(function (o) { return o !== v; });
        lines.push(line("zm_l_turned_hidden", { n: v.name }));
        die(s, v, "turned");
        s.morale = clamp(s.morale - 10, 0, 100);
        if (others.length) {
          var vic = pick(s, others), d = hurtSurv(s, vic, 4);
          lines.push(line(vic.alive ? "zm_l_hurt" : "zm_l_died", { n: vic.name, d: d }));
          if (vic.alive && rnd(s) < 0.4 && bite(s, vic)) lines.push(line("zm_l_bitten", { n: vic.name, pid: vic.owner }));
        }
      } else {
        lines.push(line("zm_l_turned_known", { n: v.name }));
        die(s, v, "turned");
        s.morale = clamp(s.morale + 2, 0, 100);
      }
    });
    // 每天的士氣、體力、自然恢復
    alive(s).forEach(function (v) {
      if (has(v, "optimist")) s.morale += 2;
      if (has(v, "chatter")) s.morale += 1;
      v.sta = clamp(v.sta + 2, 0, MAX_STA);
      if (hungry <= 0 && thirsty <= 0 && !v.inf && v.hp < MAX_HP && v.hp > 0) v.hp = Math.min(MAX_HP, v.hp + 1);
    });
    if (s.base === "temple") s.morale += 1;
    if (s.dog) s.morale += 1;
    s.morale = clamp(Math.round(s.morale), 0, 100);
    // 背叛：士氣太低時，自私的人可能帶著物資跑路
    if (s.morale < 25) {
      var sel = alive(s).filter(function (v) { return has(v, "selfish"); });
      if (sel.length && rnd(s) < 0.45) {
        var tr = pick(s, sel), took = { food: Math.min(3, s.res.food), ammo: Math.min(4, s.res.ammo), meds: Math.min(1, s.res.meds) };
        Object.keys(took).forEach(function (k) { resGain(s, k, -took[k]); });
        tr.alive = false; tr.gone = "betray";
        lines.push(line("zm_l_betray", { n: tr.name, f: took.food, a: took.ammo }));
      }
    }
    s.zeroMorale = s.morale <= 0 ? s.zeroMorale + 1 : 0;
    lines.push(lit(pick(s, D.QUIPS)));
    s.dawnLog = lines;
    s.stats.days = s.day;
    // 結局判定
    if (!alive(s).length) return finish(s, "fall");
    if (s.zeroMorale >= 2) return finish(s, "disband");
    if (s.bld.lab && s.research >= cureNeed(s)) return finish(s, "cure");
    if (s.evacIn > 0) { s.evacIn--; if (s.evacIn <= 0) return finish(s, "radio"); }
    if (s.day >= s.len) return finish(s, "rescue");
    s.phase = "dawn";
    s.ack = {};
    return true;
  }
  function cureNeed(s) { return CURE_NEED[s.len] || 30; }
  // 新的一天
  function startDay(s) {
    s.day++;
    s.phase = "plan";
    s.weather = rollWeather(s, false);
    s.tonight = { horde: 0, heat: 0 };
    s.explore = {};
    s.night = null;
    s.players.forEach(function (p) { var pl = s.plans[p.pid]; pl.ready = false; if (pl.build !== "repair" && !canBuild(s, pl.build)) pl.build = "repair"; });
    alive(s).forEach(function (v) { if (v.assign === "scavenge" && !canScavenge(v)) v.assign = "rest"; });
    // 大門口的事件（最後一天沒有）
    s.gate = null;
    if (s.day < s.len && rnd(s) < 0.45) {
      var f = progress(s), cand = {};
      D.GATE_EVENTS.forEach(function (e) { if ((e.min || 0) <= f && !(e.once && s.seen[e.id])) cand[e.id] = e.w; });
      var ids = Object.keys(cand);
      if (ids.length) { var id = weighted(s, cand); s.gate = { id: id }; s.seen[id] = 1; }
    }
    s.log = [line("zm_log_day", { d: s.day, w: D.WEATHERS[s.weather].name, i: D.WEATHERS[s.weather].icon })];
    return true;
  }

  // ---------------- 結局與分數 ----------------
  var END_BONUS = { rescue: 1500, radio: 1800, cure: 2500, fall: 0, disband: 0 };
  function ruleMult(s) { var m = 1; s.rules.forEach(function (r) { m *= D.RULES[r].mult; }); return Math.round(m * 100) / 100; }
  function score(s, kind) {
    var days = kind === "rescue" ? s.len : s.day - (kind === "fall" || kind === "disband" ? 1 : 0);
    var base = days * 100 + alive(s).length * 150 + s.stats.kills * 3 + (END_BONUS[kind] || 0) * (s.len === 30 ? 1.5 : 1);
    return Math.max(0, Math.round(base * ruleMult(s)));
  }
  function finish(s, kind) {
    var sc = score(s, kind), win = END_BONUS[kind] > 0;
    s.end = { kind: kind, score: sc, win: win, legacy: Math.max(1, Math.floor(sc / (win ? 150 : 250))), day: s.day, alive: alive(s).length };
    s.phase = "end";
    return true;
  }

  // ---------------- 傳承（localStorage，每台裝置一份） ----------------
  var META_KEY = "pritest-zombie-meta";
  function loadMeta() {
    var m = null;
    try { m = JSON.parse(window.localStorage.getItem(META_KEY) || "null"); } catch (e) { m = null; }
    if (!m || m.v !== 1) m = { v: 1, pts: 0, unlocked: {}, best: {}, runs: 0, wins: 0, endings: {} };
    m.unlocked = m.unlocked || {}; m.best = m.best || {}; m.endings = m.endings || {};
    return m;
  }
  function saveMeta(m) { try { window.localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* 存不了也能玩 */ } }
  function unlockable(id) { return D.SPECIALS[id] ? D.SPECIALS[id].cost : D.BASES[id] ? D.BASES[id].cost : D.RULES[id] ? D.RULES[id].cost : null; }
  function isUnlocked(m, id) { var c = unlockable(id); return c === 0 || !!m.unlocked[id]; }
  function unlock(m, id) {
    var c = unlockable(id);
    if (c === null || isUnlocked(m, id) || m.pts < c) return false;
    m.pts -= c; m.unlocked[id] = 1; saveMeta(m);
    return true;
  }
  // 一場結束時記錄（同一場只記一次：key＝種子＋第幾天）
  function recordRun(s) {
    if (!s.end) return null;
    var m = loadMeta(), key = s.seed + ":" + s.end.day + ":" + s.end.kind;
    if (m.lastKey === key) return m;
    m.lastKey = key; m.runs++; m.pts += s.end.legacy;
    if (s.end.win) m.wins++;
    m.endings[s.end.kind] = (m.endings[s.end.kind] || 0) + 1;
    if (s.daily) { var b = m.best[s.daily] || 0; if (s.end.score > b) m.best[s.daily] = s.end.score; }
    saveMeta(m);
    return m;
  }
  // 每日挑戰的設定（同一天大家一樣）
  function dailyOpts(key) {
    var r = { rs: (key * 2654435761) >>> 0 };
    var rules = ["scarce", "horde", "sprinters", "nomeds", "loud", "bitey"];
    return { seed: (key * 2246822519 + 13) >>> 0, city: rnd(r) < 0.5 ? "tw" : "jp", len: 10, rules: [rules[Math.floor(rnd(r) * rules.length)]], base: "store", daily: key };
  }

  window.PriTestZombieCore = {
    VERSION: VERSION, MAX_HP: MAX_HP, MAX_STA: MAX_STA, WALL_HP: WALL_HP, CORE_HP: CORE_HP, EVAC_DAYS: EVAC_DAYS,
    newGame: newGame, applyIntent: applyIntent, endNight: endNight, nightSetup: nightSetup, currentCard: currentCard, reqOk: reqOk,
    alive: alive, survById: survById, stat: stat, weaponOf: weaponOf, has: has, progress: progress, heatOf: heatOf, cureNeed: cureNeed,
    canScavenge: canScavenge, canBuild: canBuild, canCraft: canCraft, costOk: costOk, teamOf: teamOf, districtName: districtName, ruleMult: ruleMult,
    loadMeta: loadMeta, saveMeta: saveMeta, unlock: unlock, isUnlocked: isUnlocked, unlockable: unlockable, recordRun: recordRun, dailyKey: dailyKey, dailyOpts: dailyOpts,
    newSeed: newSeed, hashStr: hashStr, clamp: clamp
  };
})();
