// 冠軍教練（champ）：經營與事件（2026-11-11 第三版，使用者指定的提案 6〜7、9〜14）。
// 合約與續約、別隊挖角、轉會市場、俱樂部設施、選手默契的初始值、選手離隊結局與回憶相簿、
// 節日（新年／情人節／夏日祭／聖誕節）與生日、修羅場、宿敵、成就（跨生涯保存）與挑戰模式、年度頒獎。
// 事件放在 S.events 佇列，畫面一次顯示一個；champ_core.js 透過 hook() 呼叫這裡（init／onWeek／beforeAdvance／onGame／onSeries／onTitle／ending／album）。
(function () {
  "use strict";

  var D = window.PriTestChampData, EX = window.PriTestChampExtra, Core = window.PriTestChampCore;
  var L = D.L;
  var ACH_KEY = "pritest-champ-ach";
  function S() { return Core.get(); }
  function tr(k, p) { return Core.tr(k, p); }
  function clamp(x, a, b) { return Core.clamp(x, a, b); }
  function ri(a, b) { return Core.ri(a, b); }
  function pick(a) { return Core.pick(a); }
  function person(id) { return Core.person(id); }
  function roster() { return S().roster.map(person).filter(Boolean); }

  // 節日所在的週（Core.CAL 的索引）：新年＝季前第 1 週、情人節＝春季第 3 週、夏日祭＝夏季第 4 週、聖誕節＝休賽季
  var HOLIDAY_WK = { 0: "newyear", 4: "valentine", 17: "festival", 29: "christmas" };

  // ---------------- 第四版：教練、個人目標、新英雄、全明星 ----------------
  var COACH_STYLES = ["safe", "draft", "youth", "rush", "mind"];
  function assignCoaches() {
    var s = S();
    Object.keys(s.teams).forEach(function (id) {
      var t = s.teams[id];
      if (t.me || t.coach) return;
      var st = pick(COACH_STYLES);
      t.coach = { name: Core.genName(t.region || "tw"), style: st };
      // 教練風格決定隊伍慣用戰術
      if (st === "safe") t.style = pick(["protect", "split"]);
      else if (st === "rush") t.style = pick(["early", "fight"]);
    });
  }
  function ensureLooks() {
    var s = S();
    Object.keys(s.people).forEach(function (id) {
      var p = s.people[id];
      if (!p.look) p.look = Core.randLook();
      if (p.sig === undefined) { p.sig = p.star ? "star_solo" : Core.sigFor(p.role); p.sigOn = !!p.star || (p.team !== "me" && Core.ovr(p) >= 82); }
    });
  }
  // 個人目標
  function goalHero(p) {
    var hs = Core.heroesOfRole(p.role).filter(function (h) { return (p.mastery[h.id] || 0) < 70; });
    hs.sort(function (a, b) { return Core.metaTier(b.id) - Core.metaTier(a.id) || (p.mastery[b.id] || 0) - (p.mastery[a.id] || 0); });
    return hs.length ? hs[0].id : null;
  }
  function assignGoal(p) {
    var s = S(), t;
    if (p.squad === 2) t = "starter";
    else {
      var pool = ["mvp", "kda", "worlds", "title", "ovr", "hero", "worlds", "mvp"];
      if (p.age <= 20) pool.push("ovr", "ovr");
      t = pick(pool);
    }
    var hero = t === "hero" ? goalHero(p) : null;
    if (t === "hero" && !hero) t = "mvp";
    p.goal = { t: t, y: s.year, hero: hero, base: { mvp: p.mvp, k: p.k, d: p.d, a: p.a, games: p.games, ovr: Math.round(Core.ovr(p) * 10) / 10 } };
  }
  function goalProgress(p) {
    var s = S(), g = p.goal;
    if (!g) return null;
    var b = g.base, cur = 0, need = 1, ok = false;
    if (g.t === "mvp") { cur = p.mvp - b.mvp; need = 3; }
    else if (g.t === "starter") { cur = p.squad === 1 ? p.games - b.games : 0; need = 6; }
    else if (g.t === "hero") { cur = Math.round(p.mastery[g.hero] || 0); need = 85; }
    else if (g.t === "worlds") { cur = s.worlds && s.worlds.teams.indexOf("me") >= 0 ? 1 : 0; }
    else if (g.t === "title") { cur = s.trophies.filter(function (x) { return x.y === g.y && (x.kind === "spring" || x.kind === "summer"); }).length ? 1 : 0; }
    else if (g.t === "kda") { var gm = p.games - b.games; cur = gm >= 6 ? Math.round((p.k - b.k + p.a - b.a) / Math.max(1, p.d - b.d) * 10) / 10 : 0; need = 3.5; }
    else if (g.t === "ovr") { cur = Math.round((Core.ovr(p) - b.ovr) * 10) / 10; need = 3; }
    ok = cur >= need;
    return { cur: cur, need: need, ok: ok };
  }
  function goalText(p) {
    var g = p.goal, G = EX.GOALS[g.t];
    return G.icon + " " + L(G.name).replace("{hero}", g.hero && D.HERO[g.hero] ? L(D.HERO[g.hero].name) : "");
  }
  function evalGoals() {
    var s = S();
    roster().forEach(function (p) {
      if (!p.goal || p.goal.y !== s.year || p.goal.done) return;
      var pr = goalProgress(p);
      p.goal.done = true; p.goal.ok = pr.ok;
      if (pr.ok) {
        p.aff = clamp(p.aff + 10, 0, 100); p.mood = clamp(p.mood + 15, 0, 100); p.stats.mental = clamp(p.stats.mental + 3, 1, 99); p.wantLeave = false;
        album("goal", p, goalText(p));
      } else {
        p.mood = clamp(p.mood - 10, 0, 100);
        if (p.aff < 50) p.wantLeave = true;
      }
      s.events.push({ t: "goal", pid: p.id, ok: pr.ok, text: goalText(p) });
    });
  }
  // 新英雄上市（每年 MSI 後＝夏季聯賽第 1 週）
  function releaseHeroes() {
    var s = S(), NH = EX.NEWHERO, roles = Core.shuffle(D.ROLES.slice()).slice(0, 2), made = [];
    s.newHeroes = s.newHeroes || [];
    roles.forEach(function (role) {
      var nm = null, tries = 0;
      while (tries++ < 30) {
        var pre = pick(NH.pre), noun = pick(NH.noun[role]);
        nm = { zh: pre.zh + noun.zh, ja: pre.ja + noun.ja };
        var dup = D.HEROES.some(function (h) { return h.name.zh === nm.zh; });
        if (!dup) break;
      }
      var tags = Core.shuffle(NH.tags.slice()).slice(0, ri(2, 3));
      var h = { id: "n" + s.year + "_" + role + "_" + ri(100, 999), role: role, name: nm, tags: tags, curve: [ri(1, 5), ri(2, 5), ri(1, 5)], color: ri(0x303030, 0xf0f0f0), isNew: s.year };
      s.newHeroes.push(h);
      made.push(h);
    });
    Core.registerHeroes();
    made.forEach(function (h) {
      s.meta[h.id] = 1;   // 上市當季強勢
      Object.keys(s.people).forEach(function (id) { var p = s.people[id]; if (p.role === h.role) p.mastery[h.id] = ri(5, 25); });
    });
    s.events.push({ t: "newhero", ids: made.map(function (h) { return h.id; }) });
    Core.addNews(tr("news_newhero", { a: L(made[0].name), b: L(made[1].name) }), "gold");
  }
  // 電腦隊每週練新英雄（新人培養派練得快）
  function aiPracticeNew() {
    var s = S();
    (s.newHeroes || []).forEach(function (h) {
      Object.keys(s.teams).forEach(function (tid) {
        var t = s.teams[tid];
        if (t.me) return;
        var mul = t.coach && t.coach.style === "youth" ? 1.5 : 1;
        t.players.forEach(function (pid) { var p = person(pid); if (p && p.role === h.role && (p.mastery[h.id] || 0) < 85) p.mastery[h.id] = Math.round(((p.mastery[h.id] || 0) + Core.rnd(0.3, 1.2) * mul) * 10) / 10; });
      });
    });
  }
  // 全明星：亞洲（中國、韓國、台日、亞洲區）vs 世界（北美、南美、歐洲）；你擔任自己聯賽所屬那一隊的教練
  var ASIA = ["cn", "kr", "tj", "asia"];
  function allstarTeams() {
    var s = S(), mySide = ASIA.indexOf(Core.myLg()) >= 0 ? "asia" : "world", out = { asia: [], world: [] };
    D.ROLES.forEach(function (r) {
      ["asia", "world"].forEach(function (side) {
        var best = null, bs = -1;
        Object.keys(s.teams).forEach(function (tid) {
          var t = s.teams[tid], inAsia = ASIA.indexOf(t.league) >= 0;
          if (!t.league || (side === "asia") !== inAsia) return;
          Core.teamPlayers(tid).forEach(function (p) {
            if (!p || p.role !== r) return;
            var sc = Core.ovr(p) + Math.random() * 3 + (tid === "me" ? 1.5 : 0);
            if (sc > bs) { bs = sc; best = p; }
          });
        });
        if (best) out[side].push(best.id);
      });
    });
    return { mine: out[mySide], other: out[mySide === "asia" ? "world" : "asia"], mySide: mySide };
  }

  // ---------------- 初始化／存檔升級 ----------------
  function ensurePlayer(p) {
    if (!p) return;
    if (p.contract == null) p.contract = ri(1, 3);
    if (p.bday == null) p.bday = ri(0, Core.CAL.length - 1);
    if (!p.played) p.played = {};
    if (!p.salMul) p.salMul = 1;
    if (!p.origin) p.origin = "start";
  }
  function initChem() {
    var s = S(), ids = s.roster;
    s.chem = s.chem || {};
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
      var k = ids[i] < ids[j] ? ids[i] + "|" + ids[j] : ids[j] + "|" + ids[i];
      if (s.chem[k] == null) s.chem[k] = ri(5, 35);
    }
  }
  function init(s) {
    s.fac = s.fac || { train: 0, dorm: 0, mental: 0, analyst: 0 };
    s.album = s.album || [];
    s.events = s.events || [];
    s.flags = s.flags || {};
    s.awards = s.awards || [];
    s.market = s.market || [];
    s.rivalRec = s.rivalRec || { w: 0, l: 0 };
    s.roster.forEach(function (id) { ensurePlayer(person(id)); });
    initChem();
    assignCoaches();
    ensureLooks();
    s.roster.forEach(function (id) { var p = person(id); if (!p.goal) assignGoal(p); });
    updateRival();
    refreshMarket();
  }

  // ---------------- 回憶相簿 ----------------
  function album(kind, p, text) {
    var s = S();
    if (!s.album) s.album = [];
    s.album.push({ y: s.year, wk: s.wk, kind: kind, img: p ? p.img : null, look: p ? p.look : null, handle: p ? p.handle : "", text: text || "" });
    if (s.album.length > 120) s.album.shift();
  }
  function onTitle(kind) {
    var s = S(), mvp = null;
    roster().forEach(function (p) { if (p.squad === 1 && (!mvp || p.mvp > mvp.mvp)) mvp = p; });
    album("title", mvp, tr("album_title", { kind: tr("trophy_" + kind) }));
    if (kind === "worlds") {
      confessCheck();
      s.flags.worldsWin = (s.flags.worldsWin || 0) + 1;
      var home = D.ROLES.every(function (r) { var p = person(s.lineup[r]); return p && (p.origin === "start" || p.origin === "scout"); });
      if (home) s.flags.homegrownWorld = 1;
    }
    checkAch();
  }

  // ---------------- 結局（選手離隊） ----------------
  function ending(p, reason) {
    var s = S(), story = p.chap >= 3;
    var tier = p.vow ? "vow" : p.aff >= 90 && story ? "bond" : p.aff >= 60 ? "close" : "normal";
    var text = tier === "vow" ? L(EX.VOW_ENDING[p.trait] || EX.VOW_ENDING.calm) : tier === "bond" ? L(EX.ENDING_BOND[p.trait] || EX.ENDING_BOND.calm) : L(pick(tier === "close" ? EX.ENDING_CLOSE : EX.ENDING_NORMAL));
    if (p.vow) s.vowPid = null;
    var ev = { t: "ending", img: p.img, look: p.look, handle: p.handle, name: p.name, trait: p.trait, tier: tier, reason: reason, text: text,
      games: p.games, wins: p.wins, mvp: p.mvp, aff: Math.round(p.aff) };
    s.events.push(ev);
    album("ending_" + tier, p, text);
  }

  // ---------------- 宿敵 ----------------
  function updateRival() {
    var s = S(), lid = Core.myLg(), best = null, bs = -1;
    Object.keys(s.teams).forEach(function (id) {
      var t = s.teams[id];
      if (t.me || t.league !== lid) return;
      var st = Core.teamStr(id) + (t.dyn ? 10 : 0);
      if (st > bs) { bs = st; best = id; }
    });
    if (!best) { s.rival = null; return; }
    var star = null;
    s.teams[best].players.forEach(function (pid) { var p = person(pid); if (!star || p.star || (!star.star && Core.ovr(p) > Core.ovr(star))) star = p; });
    s.rival = { team: best, pid: star.id };
  }
  function rivalOf(opp) {
    var s = S();
    if (!s.rival || s.rival.team !== opp) return null;
    var p = person(s.rival.pid);
    if (!p || p.team !== opp) { updateRival(); return null; }
    return p;
  }
  function rivalLine(p, kind) {
    var set = p.star ? EX.TAKER : EX.RIVAL;
    return L(pick(set[kind]));
  }

  // ---------------- 每週事件 ----------------
  function onWeek() {
    var s = S(), w = Core.week();
    if (!s.events) s.events = [];
    // 新加入的選手補上目標；季前第 1 週全員換新目標
    roster().forEach(function (p) {
      if (!p.look) p.look = Core.randLook();
      if (!p.goal || (w.k === "pre" && w.i === 0 && p.goal.y !== s.year)) assignGoal(p);
      // 招牌技覺醒：好感 60 或任一英雄熟練度 95
      if (p.sig && !p.sigOn) {
        var mx = 0; Object.keys(p.mastery).forEach(function (h) { mx = Math.max(mx, p.mastery[h]); });
        if (p.aff >= 60 || mx >= 95) { p.sigOn = true; s.events.push({ t: "sig", pid: p.id }); album("sig", p, L(EX.SIG[p.sig].name)); }
      }
    });
    if (w.k === "league" && w.split === "summer" && w.i === 0) releaseHeroes();
    aiPracticeNew();
    // 私人邀約：好感 50 以上的選手每週 25%
    var cand = roster().filter(function (p) { return p.aff >= 50; });
    if (cand.length && Math.random() < 0.25) s.events.push({ t: "invite", pid: pick(cand).id, spot: pick(D.DATE_SPOTS).id });
    // 生日
    roster().forEach(function (p) { if (p.bday === s.wk) s.events.push({ t: "bday", pid: p.id }); });
    // 節日
    var hol = HOLIDAY_WK[s.wk];
    if (hol === "newyear") s.events.push({ t: "newyear", fortune: ri(0, EX.FORTUNES.length - 1) });
    else if (hol === "valentine") {
      var top = roster().sort(function (a, b) { return b.aff - a.aff; })[0];
      if (top && top.aff >= 25) s.events.push({ t: "valentine", pid: top.id });
    } else if (hol === "festival" || hol === "christmas") s.events.push({ t: hol });
    if (hol === "christmas") confessCheck();
    // 修羅場：好感 60 以上的有兩人以上時，每週 18%
    var hi = roster().filter(function (p) { return p.aff >= 60; });
    if (hi.length >= 2 && Math.random() < 0.18) {
      var pair = Core.shuffle(hi.slice()).slice(0, 2);
      s.events.push({ t: "jealous", a: pair[0].id, b: pair[1].id });
    }
    // 別隊挖角：季前第 2 週與 MSI 第 2 週，35%
    if (((w.k === "pre" && w.i === 1) || (w.k === "msi" && w.i === 1)) && Math.random() < 0.35) poachOffer();
    // 轉會市場：季前、MSI、休賽季更新
    if ((w.k === "pre" && w.i === 0) || (w.k === "msi" && w.i === 0) || w.k === "off") refreshMarket();
    // 休賽季：頒獎、引退、合約
    if (w.k === "off") {
      evalGoals();
      awards();
      s.events.push({ t: "allstar" });
      retirements();
      roster().forEach(function (p) { p.contract = (p.contract || 1) - 1; });
      var exp = roster().filter(function (p) { return p.contract <= 0; });
      if (exp.length) Core.addNews(tr("news_contracts", { n: exp.length }), "event");
    }
    checkAch();
  }
  // 告白：好感 95 以上且身世故事讀完、還沒有誓約對象時（聖誕節、世界冠軍後）
  function confessCheck() {
    var s = S();
    if (s.vowPid && person(s.vowPid)) return;
    var c = roster().filter(function (p) { return p.aff >= 95 && p.chap >= 3 && !p.vow; }).sort(function (a, b) { return b.aff - a.aff; })[0];
    if (c && !s.events.some(function (e) { return e.t === "confess"; })) s.events.push({ t: "confess", pid: c.id });
  }
  function retirements() {
    roster().forEach(function (p) {
      var pr = p.age >= 31 ? 1 : p.age >= 29 ? 0.6 : p.age >= 27 ? 0.25 : 0;
      if (pr && Math.random() < pr && S().roster.length > 5) {
        Core.addNews(tr("news_retire", { name: p.handle, age: p.age }), "event");
        Core.removeFromTeam(p.id, "retire");
      }
    });
  }
  // 推進前：沒處理的事件用預設結果，合約到期沒續約的選手離隊
  function beforeAdvance() {
    var s = S();
    while (s.events && s.events.length) resolve(null);
    if (Core.week().k === "off") {
      roster().forEach(function (p) {
        if (p.contract <= 0) {
          if (s.roster.length <= 5) { p.contract = 1; return; }
          Core.addNews(tr("news_contract_left", { name: p.handle }), "event");
          Core.removeFromTeam(p.id, "contract");
        }
      });
      // 離隊選手的結局在下週顯示
    }
  }
  function current() { var s = S(); return s.events && s.events.length ? s.events[0] : null; }

  // 事件的處理（choice：依事件類型；null＝預設／忽略）
  function resolve(choice) {
    var s = S(), ev = s.events.shift(), msg = "";
    if (!ev) return null;
    var p, o;
    if (ev.t === "bday") {
      p = person(ev.pid);
      if (!p) return null;
      if (choice == null) { p.mood = clamp(p.mood - 8, 0, 100); p.aff = clamp(p.aff - 3, 0, 100); msg = tr("bday_ignored", { name: p.handle }); }
      else if (choice === "words") { p.mood = clamp(p.mood + 5, 0, 100); p.aff = clamp(p.aff + 2, 0, 100); msg = tr("bday_words", { name: p.handle }); }
      else {
        var g = null;
        EX.GIFTS.forEach(function (x) { if (x.id === choice) g = x; });
        if (!g || s.funds < g.cost) { s.events.unshift(ev); return { ok: false, msg: tr("err_funds") }; }
        s.funds -= g.cost;
        var like = g.likes.indexOf(p.trait) >= 0;
        p.mood = clamp(p.mood + (like ? 15 : 8), 0, 100); p.aff = clamp(p.aff + (like ? 8 : 4), 0, 100);
        msg = tr(like ? "bday_like" : "bday_ok", { name: p.handle, gift: L(g.name) });
        album("bday", p, msg);
      }
    } else if (ev.t === "valentine") {
      p = person(ev.pid);
      o = EX.HOLIDAY.valentine.opts[choice == null ? 0 : choice];
      if (p) {
        var bonus = o.likes && o.likes.indexOf(p.trait) >= 0 ? o.bonus : 0;
        p.aff = clamp(p.aff + o.aff + bonus, 0, 100); p.mood = clamp(p.mood + o.mood, 0, 100);
        if (o.team) roster().forEach(function (x) { x.mood = clamp(x.mood + o.team, 0, 100); });
        msg = tr("valentine_done", { name: p.handle });
        album("valentine", p, L(EX.HOLIDAY.valentine.text).replace("{name}", p.handle));
      }
    } else if (ev.t === "festival" || ev.t === "christmas") {
      if (choice == null) return { ok: true };
      if (choice === "party") {
        var cost = 15;
        if (s.funds < cost) { s.events.unshift(ev); return { ok: false, msg: tr("err_funds") }; }
        s.funds -= cost;
        roster().forEach(function (x) { x.mood = clamp(x.mood + 8, 0, 100); x.aff = clamp(x.aff + 2, 0, 100); });
        msg = tr("party_done");
      } else {
        p = person(choice);
        if (!p) return null;
        var big = ev.t === "christmas" ? 10 : 8;
        p.aff = clamp(p.aff + big, 0, 100); p.mood = clamp(p.mood + 14, 0, 100);
        roster().forEach(function (x) { if (x.id !== p.id && x.aff >= 60) x.mood = clamp(x.mood - 4, 0, 100); });
        msg = tr(ev.t + "_done", { name: p.handle });
        album(ev.t, p, msg);
      }
    } else if (ev.t === "newyear") {
      roster().forEach(function (x) { x.mood = clamp(x.mood + 5, 0, 100); });
      msg = L(EX.FORTUNES[ev.fortune]);
    } else if (ev.t === "jealous") {
      var a = person(ev.a), b = person(ev.b);
      if (!a || !b) return null;
      var c = choice || "honest";
      if (c === "honest") { a.aff = clamp(a.aff - 2, 0, 100); b.aff = clamp(b.aff - 2, 0, 100); Core.addChem(a.id, b.id, 5); }
      else if (c === "a" || c === "b") {
        var w1 = c === "a" ? a : b, l1 = c === "a" ? b : a;
        w1.aff = clamp(w1.aff + 4, 0, 100); w1.mood = clamp(w1.mood + 6, 0, 100);
        l1.aff = clamp(l1.aff - 3, 0, 100); l1.mood = clamp(l1.mood - 8, 0, 100);
        Core.addChem(a.id, b.id, -10);
      } else if (c === "dinner") {
        if (s.funds < 10) { s.events.unshift(ev); return { ok: false, msg: tr("err_funds") }; }
        s.funds -= 10;
        [a, b].forEach(function (x) { x.aff = clamp(x.aff + 3, 0, 100); x.mood = clamp(x.mood + 5, 0, 100); });
        Core.addChem(a.id, b.id, 3);
      }
      msg = tr("jealous_" + c, { a: a.handle, b: b.handle });
    } else if (ev.t === "invite") {
      p = person(ev.pid);
      if (!p) return null;
      var sp = D.DATE_SPOT[ev.spot];
      if (choice === "yes") {
        p.mood = clamp(p.mood + sp.mood * 1.6, 0, 100); p.aff = clamp(p.aff + sp.aff * 1.8, 0, 100); p.fatigue = clamp(p.fatigue - 8, 0, 100);
        msg = L(sp.text) + "\n" + L(window.PriTestChampStory.DATE_LIKE[p.trait]);
        album("invite", p, L(sp.text));
      } else {
        p.mood = clamp(p.mood - 5, 0, 100); p.aff = clamp(p.aff - 2, 0, 100);
        msg = p.handle + "：" + L(EX.INVITE_NO[p.trait]);
      }
    } else if (ev.t === "confess") {
      p = person(ev.pid);
      if (!p) return null;
      if (choice === "yes") {
        p.vow = true; s.vowPid = p.id; s.flags.vow = 1;
        p.stats.mental = clamp(p.stats.mental + 5, 1, 99); p.mood = 100; p.aff = 100;
        msg = L(EX.CONFESS[p.trait]);
        album("vow", p, msg);
        var others = roster().filter(function (x) { return x.id !== p.id && x.aff >= 80; });
        if (others.length) s.events.unshift({ t: "shura", pid: p.id, others: others.map(function (x) { return x.id; }) });
        Core.addNews(tr("news_vow", { name: p.handle }), "gold");
      } else msg = tr("confess_wait");
    } else if (ev.t === "shura") {
      var os = (ev.others || []).map(person).filter(Boolean);
      if (choice === "treat" && s.funds >= 30) {
        s.funds -= 30;
        os.forEach(function (x) { x.aff = clamp(x.aff - 4, 0, 100); x.mood = clamp(x.mood - 3, 0, 100); });
        msg = tr("shura_treat");
      } else {
        os.forEach(function (x) { x.aff = clamp(x.aff - 10, 0, 100); x.mood = clamp(x.mood - 8, 0, 100); });
        for (var i = 0; i < os.length; i++) for (var j = i + 1; j < os.length; j++) Core.addChem(os[i].id, os[j].id, 5);
        msg = tr("shura_honest");
      }
    } else if (ev.t === "allstar") {
      var tm = allstarTeams(), tac = choice || "fight";
      var ex = Core.exhibition(tm.mine, tm.other, tac), win = ex.res.winner === "A";
      tm.mine.concat(tm.other).forEach(function (pid) {
        var x = person(pid);
        if (x && x.team === "me") { x.mood = clamp(x.mood + 10, 0, 100); x.salMul = (x.salMul || 1) * 1.05; s.fans += 2000; album("allstar", x, tr("allstar_pick")); }
      });
      tm[win ? "mine" : "other"].forEach(function (pid) { var x = person(pid); if (x && x.team === "me") x.mood = clamp(x.mood + 5, 0, 100); });
      s.events.unshift({ t: "allstar_res", win: win, side: tm.mySide, mine: tm.mine, other: tm.other, moments: ex.res.moments, picksA: ex.picksA, picksB: ex.picksB, tacA: tac, tacB: ex.tacticB, mvp: ex.res.mvp });
      if (win) s.flags.allstarWin = 1;
      msg = tr(win ? "allstar_win" : "allstar_loss");
    } else if (ev.t === "poach") {
      p = person(ev.pid);
      if (!p) return null;
      if (choice === "accept") {
        s.funds += ev.fee;
        Core.addNews(tr("news_poached", { name: p.handle, team: Core.teamName(ev.team), fee: ev.fee }), "event");
        Core.removeFromTeam(p.id, "poach");
        msg = tr("poach_accept", { name: p.handle, fee: ev.fee });
      } else {
        if (p.aff < 40) { p.mood = clamp(p.mood - 10, 0, 100); msg = tr("poach_refuse_sad", { name: p.handle }); }
        else { p.mood = clamp(p.mood + 6, 0, 100); p.aff = clamp(p.aff + 3, 0, 100); msg = tr("poach_refuse_happy", { name: p.handle }); }
      }
    }
    Core.save();
    return { ok: true, msg: msg };
  }
  function poachOffer() {
    var s = S(), best = null;
    roster().forEach(function (p) { if (p.squad === 1 && (!best || Core.ovr(p) > Core.ovr(best))) best = p; });
    if (!best) return;
    var teams = Object.keys(s.teams).filter(function (id) { return !s.teams[id].me && s.teams[id].league !== Core.myLg(); });
    var youth = teams.filter(function (id) { return s.teams[id].coach && s.teams[id].coach.style === "youth"; });
    var tm = pick(youth.length && Math.random() < 0.6 ? youth : teams);
    s.events.push({ t: "poach", pid: best.id, team: tm, fee: Math.round(best.salary * 25 + 100) });
  }

  // ---------------- 合約 ----------------
  function renewCost(p) {
    var mul = Math.max(0.85, (p.salMul || 1) * (1.12 - p.aff / 500)) * (p.wantLeave ? 1.3 : 1);
    var sal = Math.round(Core.salaryOf(Core.ovr(p)) * mul);
    return { mul: mul, salary: sal, bonus: sal * 4 };
  }
  function renew(pid) {
    var p = person(pid), s = S();
    if (!p || p.contract > 0) return { ok: false };
    var c = renewCost(p);
    if (s.funds < c.bonus) return { ok: false, msg: tr("err_funds") };
    s.funds -= c.bonus; p.salMul = c.mul; p.contract = 2; p.salary = c.salary;
    p.mood = clamp(p.mood + 6, 0, 100);
    Core.save();
    return { ok: true, msg: tr("renew_done", { name: p.handle }) };
  }
  function expiring() { return roster().filter(function (p) { return p.contract <= 0; }); }

  // ---------------- 轉會市場 ----------------
  function marketFee(p) { return Math.round(Core.salaryOf(Core.ovr(p)) * 18 + 40); }
  function refreshMarket() {
    var s = S();
    if (s.chal && s.chal.nomarket) { s.market = []; return; }
    var min = Core.lgStr(Core.myLg()) - 3, cand = [];
    Object.keys(s.teams).forEach(function (id) {
      var t = s.teams[id];
      if (t.me) return;
      t.players.forEach(function (pid) { var p = person(pid); if (p && !p.star && Core.ovr(p) >= min) cand.push(pid); });
    });
    s.market = Core.shuffle(cand).slice(0, 8);
  }
  function marketList() { return (S().market || []).map(person).filter(function (p) { return p && p.team && p.team !== "me"; }); }
  function buy(pid) {
    var s = S(), p = person(pid);
    if (!p || p.team === "me" || (s.chal && s.chal.nomarket)) return { ok: false };
    if (s.roster.length >= 10) return { ok: false, msg: tr("err_roster_full") };
    var fee = marketFee(p);
    if (s.funds < fee) return { ok: false, msg: tr("err_funds") };
    s.funds -= fee;
    var t = s.teams[p.team], idx = t.players.indexOf(pid);
    var np = Core.newPlayer(t.region, p.role, Core.lgStr(t.league) - 6, ri(17, 19), { team: t.id });
    np.squad = 1; s.people[np.id] = np; t.players[idx] = np.id;
    p.team = "me"; p.squad = 2; p.aff = ri(5, 15); p.known = true; p.origin = "market"; p.contract = 2; p.salMul = 1.1; p.ms = p.ms || {};
    ensurePlayer(p);
    s.roster.push(pid);
    s.market = s.market.filter(function (id) { return id !== pid; });
    initChem();
    Core.addNews(tr("news_buy", { name: p.handle, team: t.name, fee: fee }), "event");
    Core.save();
    return { ok: true, msg: tr("buy_done", { name: p.handle }) };
  }

  // ---------------- 設施 ----------------
  function facCost(id) { var lv = (S().fac || {})[id] || 0; return lv >= 3 ? null : EX.FAC_COST[lv]; }
  function upgrade(id) {
    var s = S(), c = facCost(id);
    if (c == null) return { ok: false };
    if (s.funds < c) return { ok: false, msg: tr("err_funds") };
    s.funds -= c; s.fac[id] = (s.fac[id] || 0) + 1;
    checkAch();
    Core.save();
    return { ok: true, msg: tr("fac_done", { lv: s.fac[id] }) };
  }

  // ---------------- 年度頒獎（休賽季） ----------------
  function awards() {
    var s = S(), lid = Core.myLg(), lg = s.leagues && s.leagues[lid], best = null, bs = -1e9, rook = null, rs = -1e9;
    var order = lg && lg.final ? lg.final : [];
    Object.keys(s.teams).forEach(function (tid) {
      var t = s.teams[tid];
      if (t.league !== lid) return;
      var rank = order.indexOf(tid), ps = Core.teamPlayers(tid);
      ps.forEach(function (p) {
        if (!p) return;
        var sc = Core.ovr(p) + (rank >= 0 ? (8 - rank) * 1.0 : 0) + (tid === "me" ? Math.min(4, (p.k + p.a) / Math.max(1, p.d) / 2) : 0) + Math.random();
        if (sc > bs) { bs = sc; best = { p: p, tid: tid }; }
        if (p.age <= 19 && sc > rs) { rs = sc; rook = { p: p, tid: tid }; }
      });
    });
    // 最佳教練：名次＋超出實力的程度（實力排名 − 最終名次），所有電腦教練一起競爭
    var coachTid = null, cs = -1e9, strRank = order.slice().sort(function (a, b) { return Core.teamStr(b) - Core.teamStr(a); });
    order.forEach(function (tid, rank) {
      var sc = (8 - rank) + (strRank.indexOf(tid) - rank) * 0.8 + (tid === "me" && s.trophies.some(function (x) { return x.y === s.year && (x.kind === "worlds" || x.kind === "msi"); }) ? 4 : 0) + Math.random() * 0.5;
      if (sc > cs) { cs = sc; coachTid = tid; }
    });
    var A = { y: s.year,
      mvp: best ? { handle: best.p.handle, team: Core.teamName(best.tid), me: best.tid === "me", img: best.p.img, look: best.p.look } : null,
      rookie: rook ? { handle: rook.p.handle, team: Core.teamName(rook.tid), me: rook.tid === "me", img: rook.p.img, look: rook.p.look } : null,
      coach: coachTid ? { team: Core.teamName(coachTid), me: coachTid === "me", name: coachTid === "me" ? null : (s.teams[coachTid].coach || {}).name } : null };
    [best, rook].forEach(function (x, k) {
      if (x && x.tid === "me") {
        x.p.mood = clamp(x.p.mood + 15, 0, 100); x.p.salMul = (x.p.salMul || 1) * 1.15; s.fans += 3000;
        album("award", x.p, tr(k === 0 ? "award_mvp" : "award_rookie"));
        if (k === 0) s.flags.awardMvp = 1;
      }
    });
    if (A.coach && A.coach.me) { s.fans += 2000; s.flags.coachAward = 1; }
    s.awards.push(A);
    s.events.push({ t: "awards", y: s.year });
  }

  // ---------------- 比賽相關 ----------------
  function onGame(g) {
    var s = S();
    if (g.winner === "me" && g.res.minLead <= -8) s.flags.comeback = 1;
    if (g.res.moments.some(function (m) { return m.creative === "A"; })) s.flags.creative = 1;
  }
  function onSeries(se, win) {
    var s = S();
    if (win) s.flags.firstWin = 1;
    if (win && se.bo === 5 && se.wins.opp === 0) s.flags.sweep = 1;
    if (win && Core.teamPlayers(se.opp).some(function (p) { return p && p.star; })) s.flags.beatTaker = 1;
    var rv = rivalOf(se.opp);
    if (rv) {
      s.rivalRec[win ? "w" : "l"]++;
      if (win) roster().forEach(function (p) { if (p.squad === 1) p.mood = clamp(p.mood + 5, 0, 100); });
      Core.addNews(tr("news_rival_" + (win ? "w" : "l"), { name: rv.handle, line: rivalLine(rv, win ? "lose" : "win") }), win ? "win" : "loss");
    }
    checkAch();
  }

  // ---------------- 成就（跨生涯保存） ----------------
  function loadAch() { try { return JSON.parse(localStorage.getItem(ACH_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function unlocked(id) { return !!loadAch()[id]; }
  function checkAch() {
    var s = S();
    if (!s) return;
    var got = loadAch(), f = s.flags || {}, T = s.trophies || [], neu = [];
    var byYear = {};
    T.forEach(function (x) { (byYear[x.y] = byYear[x.y] || {})[x.kind] = 1; });
    var anyChal = s.chal && (s.chal.nomarket || s.chal.budget || s.chal.underdog);
    var fac = s.fac || {};
    var cond = {
      first_win: f.firstWin, league: T.some(function (x) { return x.kind === "spring" || x.kind === "summer"; }),
      msi: T.some(function (x) { return x.kind === "msi"; }), worlds: f.worldsWin,
      triple: Object.keys(byYear).some(function (y) { var b = byYear[y]; return b.spring && b.summer && b.worlds; }),
      hard_world: f.worldsWin && D.REGION[s.region].diff === "high", challenge_world: f.worldsWin && anyChal,
      homegrown: f.homegrownWorld, transfer: f.transfer, beat_taker: f.beatTaker, rival: (s.rivalRec || {}).w >= 3,
      sweep: f.sweep, comeback: f.comeback, creative: f.creative, bond: f.bond, stories: (f.stories || 0) >= 3,
      award: f.awardMvp, vow: f.vow, allstar: f.allstarWin, coach_award: f.coachAward, years5: s.year >= 6, facility: fac.train >= 3 && fac.dorm >= 3 && fac.mental >= 3 && fac.analyst >= 3
    };
    EX.ACH.forEach(function (a) { if (cond[a.id] && !got[a.id]) { got[a.id] = s.year; neu.push(a); } });
    if (neu.length) {
      try { localStorage.setItem(ACH_KEY, JSON.stringify(got)); } catch (e) { /* ignore */ }
      s.newAch = (s.newAch || []).concat(neu.map(function (a) { return a.id; }));
      neu.forEach(function (a) { Core.addNews(tr("news_ach", { name: L(a.name) }), "gold"); });
    }
  }
  function achState() { return loadAch(); }
  function popNewAch() { var s = S(), a = s.newAch || []; s.newAch = []; return a; }

  window.PriTestChampLife = {
    init: init, ensurePlayer: ensurePlayer, initChem: initChem, updateRival: updateRival, onWeek: onWeek, beforeAdvance: beforeAdvance,
    onTitle: onTitle, onGame: onGame, onSeries: onSeries, ending: ending, album: album,
    current: current, resolve: resolve, rivalOf: rivalOf, rivalLine: rivalLine, goalProgress: goalProgress, goalText: goalText, allstarTeams: allstarTeams,
    renewCost: renewCost, renew: renew, expiring: expiring, marketFee: marketFee, marketList: marketList, buy: buy,
    facCost: facCost, upgrade: upgrade, unlocked: unlocked, achState: achState, popNewAch: popNewAch, checkAch: checkAch
  };
})();
