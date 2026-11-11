// 冠軍教練（champ）：規則與狀態（localStorage）。
// 一年＝季前 2 週 → 春季聯賽 7 週（Bo3）→ 季後賽 2 週（Bo5）→ 休賽 2 週 → 夏季聯賽 7 週 → 季後賽 2 週 → 世界大賽 6 週 → 休賽季 1 週。
// 12 個地區各 8 隊同時進行聯賽（電腦隊互打用快速計算），夏季冠軍＋積分取得世界大賽名額（合計 16 隊）。
// 玩家的比賽：BP（藍紅各 3 禁 5 選，無懼選角：同系列賽中自己用過的英雄不能再選）→ 選戰術 → 賽前看選手數值與調子 → 系統計算勝負，產生 3〜5 個關鍵會戰給 3D 重播。
// 2026-11-11 依使用者需求新增。
(function () {
  "use strict";

  var D = window.PriTestChampData;
  var L = D.L;
  var KEY = "pritest-champ-save";
  var S = null;

  // ---------------- 小工具 ----------------
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ri(a, b) { return Math.floor(rnd(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function tr(key, params) { return window.I18N ? window.I18N.t("cc_" + key, params) : key; }
  function weighted(items, wf) {
    var tot = 0, i;
    for (i = 0; i < items.length; i++) tot += Math.max(0.0001, wf(items[i]));
    var r = Math.random() * tot;
    for (i = 0; i < items.length; i++) { r -= Math.max(0.0001, wf(items[i])); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  // ---------------- 行事曆 ----------------
  var CAL = (function () {
    var c = [], i;
    c.push({ k: "pre", i: 0 }, { k: "pre", i: 1 });
    for (i = 0; i < 7; i++) c.push({ k: "league", split: "spring", i: i });
    c.push({ k: "po", split: "spring", i: 0 }, { k: "po", split: "spring", i: 1 });
    c.push({ k: "break", i: 0 }, { k: "break", i: 1 });
    for (i = 0; i < 7; i++) c.push({ k: "league", split: "summer", i: i });
    c.push({ k: "po", split: "summer", i: 0 }, { k: "po", split: "summer", i: 1 });
    for (i = 0; i < 6; i++) c.push({ k: "worlds", i: i });
    c.push({ k: "off", i: 0 });
    return c;
  })();
  function week() { return CAL[S.wk]; }

  // ---------------- 照片 ----------------
  function photoFile(i) {
    i = ((i | 0) % D.PHOTO_N + D.PHOTO_N) % D.PHOTO_N;
    return i < 143 ? "g_" + ("00" + i).slice(-3) : "n_" + ("00" + (i - 143)).slice(-3);
  }
  // 自己隊伍與新人用不重複的照片；電腦隊的選手隨機
  function nextPhoto() {
    if (!S.photoBag || !S.photoBag.length) {
      var used = {}, bag = [], i;
      Object.keys(S.people || {}).forEach(function (id) { var p = S.people[id]; if (p.team === "me" || p.scout) used[p.img] = 1; });
      for (i = 0; i < D.PHOTO_N; i++) if (!used[i]) bag.push(i);
      if (!bag.length) for (i = 0; i < D.PHOTO_N; i++) bag.push(i);
      S.photoBag = shuffle(bag);
    }
    return S.photoBag.pop();
  }

  // ---------------- 選手 ----------------
  function ovr(p) {
    var w = D.ROLE[p.role].w, s = 0;
    D.STATS.forEach(function (k) { s += p.stats[k] * w[k]; });
    return s;
  }
  function ovrI(p) { return Math.round(ovr(p)); }
  function heroesOfRole(role) { return D.HEROES.filter(function (h) { return h.role === role; }); }
  function salaryOf(o) { return Math.max(2, Math.round(Math.pow(Math.max(0, o - 45), 1.5) / 7)); }

  function newPlayer(region, role, target, age, opts) {
    opts = opts || {};
    var reg = D.REGION[region], trait = pick(D.TRAITS);
    S.seq = (S.seq || 0) + 1;
    var p = {
      id: "p" + S.seq, region: region, role: role, age: age,
      name: pick(reg.names), handle: pick(D.HANDLES),
      img: opts.unique ? nextPhoto() : ri(0, D.PHOTO_N - 1),
      trait: trait.id, stats: {}, mastery: {}, cond: 0, mood: ri(50, 70), aff: ri(5, 18), fatigue: ri(10, 30),
      squad: 2, practice: null, games: 0, wins: 0, k: 0, d: 0, a: 0, mvp: 0, ms: {}, team: opts.team || null
    };
    D.STATS.forEach(function (k) { p.stats[k] = target + gauss() * 6; });
    p.stats[trait.statBias] += 3;
    var shift = target - ovr(p);
    D.STATS.forEach(function (k) { p.stats[k] = clamp(p.stats[k] + shift, 20, 99); });
    var o = ovr(p);
    p.pot = Math.round(clamp(o + (age <= 18 ? rnd(8, 28) : age <= 21 ? rnd(4, 18) : rnd(0, 7)), o, 99));
    var hs = shuffle(heroesOfRole(role).slice()), base = (o - 65) * 0.35;
    hs.forEach(function (h, i) { p.mastery[h.id] = Math.round(clamp((i < 2 ? rnd(76, 94) : i < 4 ? rnd(55, 75) : rnd(18, 55)) + base, 5, 100)); });
    p.salary = salaryOf(o);
    return p;
  }
  function person(id) { return S.people[id]; }
  function topHeroes(p, n) {
    return Object.keys(p.mastery).sort(function (a, b) { return p.mastery[b] - p.mastery[a]; }).slice(0, n || 3);
  }

  // ---------------- 隊伍 ----------------
  function team(id) { return S.teams[id]; }
  function teamPlayers(id) {
    var t = team(id);
    if (t.me) return D.ROLES.map(function (r) { return person(S.lineup[r]); });
    return t.players.map(person);
  }
  function teamStr(id) {
    var ps = teamPlayers(id), s = 0;
    ps.forEach(function (p) { s += p ? ovr(p) : 40; });
    return s / 5;
  }
  function teamName(id) { var t = team(id); return t ? t.name : "?"; }
  function makeAITeam(region, idx, target, name) {
    var id = region + idx, ps = [];
    D.ROLES.forEach(function (r) {
      var p = newPlayer(region, r, target + gauss() * 3, ri(17, 25), { team: id });
      p.squad = 1;
      S.people[p.id] = p;
      ps.push(p.id);
    });
    S.teams[id] = { id: id, region: region, name: name, players: ps, me: false };
    return id;
  }

  // ---------------- 新遊戲 ----------------
  function newGame(regionId, teamNameIn) {
    var reg = D.REGION[regionId];
    S = { v: 1, year: 1, wk: 0, region: regionId, people: {}, teams: {}, seq: 0, photoBag: null,
      funds: reg.fund, fans: Math.round(reg.sponsor * 90), ap: 3, focus1: "fight", focus2: "lane",
      lineup: {}, roster: [], scouts: [], news: [], trophies: [], history: [], meta: {}, patch: 1,
      leagues: {}, points: {}, worlds: null, series: null, draft: null, done: true, hotelThisWeek: 0, lastEvent: null, lastBudget: null };
    // 自己的隊伍
    var T = reg.str + reg.start;
    S.teams.me = { id: "me", region: regionId, name: teamNameIn || tr("default_team"), me: true };
    D.ROLES.forEach(function (r) {
      var p = newPlayer(regionId, r, T + gauss() * 2.5, ri(18, 23), { unique: true, team: "me" });
      p.squad = 1; p.aff = ri(10, 25);
      S.people[p.id] = p; S.roster.push(p.id); S.lineup[r] = p.id;
    });
    shuffle(D.ROLES.slice()).slice(0, 3).forEach(function (r) {
      var p = newPlayer(regionId, r, T - 9 + gauss() * 2.5, ri(16, 19), { unique: true, team: "me" });
      S.people[p.id] = p; S.roster.push(p.id);
    });
    // 各地區的電腦隊
    D.REGIONS.forEach(function (rg) {
      var offs = shuffle([7, 4.5, 2.5, 0.5, -1, -3, -5, -7]);
      var names = shuffle(rg.cities.slice());
      var n = rg.id === regionId ? 7 : 8;
      for (var i = 0; i < n; i++) makeAITeam(rg.id, i, rg.str + offs[i], names[i]);
    });
    newPatch();
    refreshScouts();
    rollConditions();
    addNews(tr("news_start", { team: S.teams.me.name, region: L(reg.name) }));
    save();
    return S;
  }

  // ---------------- 版本（強勢英雄） ----------------
  function newPatch() {
    S.meta = {};
    var hs = shuffle(D.HEROES.map(function (h) { return h.id; }));
    hs.slice(0, 3).forEach(function (id) { S.meta[id] = 2; });
    hs.slice(3, 11).forEach(function (id) { S.meta[id] = 1; });
    hs.slice(11, 19).forEach(function (id) { S.meta[id] = -1; });
    S.patch = (S.patch || 0) + 1;
  }
  function metaTier(hid) { return S.meta[hid] || 0; }

  // ---------------- 新人招募 ----------------
  function refreshScouts() {
    // 舊的候選人移除
    (S.scouts || []).forEach(function (id) { if (S.people[id] && S.people[id].scout) delete S.people[id]; });
    S.scouts = [];
    var reg = D.REGION[S.region], base = reg.str + reg.scout;
    for (var i = 0; i < 6; i++) {
      var age = ri(16, 22), gem = Math.random() < 0.12;
      var p = newPlayer(S.region, pick(D.ROLES), base - 10 + rnd(-4, 6) + (gem ? 6 : 0) + (age - 16) * 0.8, age, { unique: true });
      if (gem) p.pot = Math.max(p.pot, ri(88, 97));
      p.scout = true; p.known = false;
      S.people[p.id] = p; S.scouts.push(p.id);
    }
    // 海外選手 2 名（簽約金較高、實力較強）
    var others = D.REGIONS.filter(function (r) { return r.id !== S.region; });
    for (var j = 0; j < 2; j++) {
      var rg = pick(others);
      var q = newPlayer(rg.id, pick(D.ROLES), Math.max(rg.str, base) - 2 + rnd(-3, 5), ri(18, 24), { unique: true });
      q.scout = true; q.known = false; q.foreign = true;
      S.people[q.id] = q; S.scouts.push(q.id);
    }
  }
  function signFee(p) { return Math.round(p.salary * (p.foreign ? 10 : 6) + 10); }
  function sign(pid) {
    var p = person(pid);
    if (!p || !p.scout) return { ok: false };
    if (S.roster.length >= 10) return { ok: false, msg: tr("err_roster_full") };
    var fee = signFee(p);
    if (S.funds < fee) return { ok: false, msg: tr("err_funds") };
    S.funds -= fee;
    p.scout = false; p.known = true; p.team = "me"; p.squad = 2; p.aff = ri(5, 15);
    S.scouts = S.scouts.filter(function (id) { return id !== pid; });
    S.roster.push(pid);
    addNews(tr("news_sign", { name: p.handle, fee: fee }));
    save();
    return { ok: true };
  }
  function scoutReveal(pid) {
    var p = person(pid);
    if (!p || p.known) return { ok: false };
    if (S.funds < 3) return { ok: false, msg: tr("err_funds") };
    S.funds -= 3; p.known = true; save();
    return { ok: true };
  }
  function release(pid) {
    var p = person(pid);
    if (!p || p.team !== "me") return { ok: false };
    var role = p.role, subs = S.roster.filter(function (id) { return id !== pid && person(id).role === role; });
    if (S.lineup[role] === pid && !subs.length) return { ok: false, msg: tr("err_last_role") };
    S.roster = S.roster.filter(function (id) { return id !== pid; });
    if (S.lineup[role] === pid) setLineup(role, subs.sort(function (a, b) { return ovr(person(b)) - ovr(person(a)); })[0]);
    delete S.people[pid];
    addNews(tr("news_release", { name: p.handle }));
    save();
    return { ok: true };
  }
  function setLineup(role, pid) {
    var p = person(pid);
    if (!p || p.role !== role || p.team !== "me") return false;
    var old = person(S.lineup[role]);
    if (old) old.squad = 2;
    S.lineup[role] = pid; p.squad = 1;
    save();
    return true;
  }

  // ---------------- 新聞 ----------------
  function addNews(text, cls) {
    S.news.unshift({ y: S.year, wk: S.wk, text: text, cls: cls || "" });
    if (S.news.length > 80) S.news.length = 80;
  }

  // ---------------- 調子 ----------------
  function rollCond(p) {
    var t = D.TRAIT[p.trait];
    var base = (p.mood - 55) / 22 - (p.fatigue - 40) / 35 + (t.mental || 0) * 0.08;
    var v = Math.round(clamp(base + gauss() * 0.85 * (t.swing || 1), -2, 2));
    // 羈絆（好感 90）：世界大賽期間不會不調
    if (p.aff >= 90 && week().k === "worlds") v = Math.max(0, v);
    p.cond = v;
  }
  function rollConditions() {
    S.roster.forEach(function (id) { rollCond(person(id)); });
  }
  function aiCond(p) { p.cond = Math.round(clamp(gauss() * 0.9, -2, 2)); }

  // ---------------- 聯賽 ----------------
  function roundRobin(ids) {
    var n = ids.length, arr = ids.slice(), rounds = [];
    for (var r = 0; r < n - 1; r++) {
      var pairs = [];
      for (var i = 0; i < n / 2; i++) pairs.push(r % 2 ? [arr[n - 1 - i], arr[i]] : [arr[i], arr[n - 1 - i]]);
      rounds.push(pairs);
      arr.splice(1, 0, arr.pop());
    }
    return rounds;
  }
  function regionTeams(rid) {
    return Object.keys(S.teams).filter(function (id) { return S.teams[id].region === rid; });
  }
  function setupLeagues(split) {
    S.leagues = {};
    D.REGIONS.forEach(function (rg) {
      var ids = shuffle(regionTeams(rg.id));
      var table = {};
      ids.forEach(function (id) { table[id] = { w: 0, l: 0, gw: 0, gl: 0 }; });
      S.leagues[rg.id] = { split: split, teams: ids, sched: roundRobin(ids), table: table, results: [], po: null, champ: null, rank: null };
    });
  }
  function standings(lg) {
    return lg.teams.slice().sort(function (a, b) {
      var A = lg.table[a], B = lg.table[b];
      return (B.w - A.w) || ((B.gw - B.gl) - (A.gw - A.gl)) || (B.gw - A.gw) || (a < b ? -1 : 1);
    });
  }
  function recordLeague(lg, a, b, wa, wb, stage) {
    if (stage === "league") {
      var A = lg.table[a], B = lg.table[b];
      A.gw += wa; A.gl += wb; B.gw += wb; B.gl += wa;
      if (wa > wb) { A.w++; B.l++; } else { B.w++; A.l++; }
    }
    lg.results.push({ wk: S.wk, a: a, b: b, wa: wa, wb: wb, stage: stage });
  }

  // 電腦隊對戰（快速計算）：每局用雙方平均實力＋隨機調子
  function quickSeries(a, b, bo) {
    var need = Math.ceil(bo / 2), wa = 0, wb = 0;
    var pa = teamPlayers(a), pb = teamPlayers(b);
    while (wa < need && wb < need) {
      var sa = 0, sb = 0;
      pa.forEach(function (p) { sa += p ? ovr(p) + (team(a).me ? p.cond : gauss() * 0.9) * 2.2 : 40; });
      pb.forEach(function (p) { sb += p ? ovr(p) + (team(b).me ? p.cond : gauss() * 0.9) * 2.2 : 40; });
      var pr = sigmoid((sa / 5 - sb / 5 + gauss() * 2.5) / 4.2);
      if (Math.random() < pr) wa++; else wb++;
    }
    return { wa: wa, wb: wb };
  }

  // ---------------- 本週玩家的比賽 ----------------
  function myMatch() {
    var w = week();
    if (w.k === "league") {
      var lg = S.leagues[S.region], pairs = lg.sched[w.i];
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === "me") return { opp: pairs[i][1], bo: 3, stage: "league" };
        if (pairs[i][1] === "me") return { opp: pairs[i][0], bo: 3, stage: "league" };
      }
      return null;
    }
    if (w.k === "po") {
      var po = S.leagues[S.region].po;
      if (!po) return null;
      var list = w.i === 0 ? po.sf : (po.final ? [po.final] : []);
      for (var j = 0; j < list.length; j++) {
        if (list[j][0] === "me") return { opp: list[j][1], bo: 5, stage: w.i === 0 ? "sf" : "final" };
        if (list[j][1] === "me") return { opp: list[j][0], bo: 5, stage: w.i === 0 ? "sf" : "final" };
      }
      return null;
    }
    if (w.k === "worlds" && S.worlds) {
      var W = S.worlds, ps = worldsPairs(w.i);
      for (var k = 0; k < ps.length; k++) {
        if (ps[k][0] === "me") return { opp: ps[k][1], bo: w.i < 3 ? 3 : 5, stage: w.i < 3 ? "wgroup" : ["wqf", "wsf", "wfinal"][w.i - 3] };
        if (ps[k][1] === "me") return { opp: ps[k][0], bo: w.i < 3 ? 3 : 5, stage: w.i < 3 ? "wgroup" : ["wqf", "wsf", "wfinal"][w.i - 3] };
      }
      return null;
    }
    return null;
  }

  // ---------------- 季後賽 ----------------
  function setupPlayoffs() {
    Object.keys(S.leagues).forEach(function (rid) {
      var lg = S.leagues[rid], st = standings(lg);
      lg.rank = st.slice();
      lg.po = { sf: [[st[0], st[3]], [st[1], st[2]]], sfRes: [], final: null, finalRes: null };
    });
  }
  function resolvePlayoffWeek(i) {
    Object.keys(S.leagues).forEach(function (rid) {
      var lg = S.leagues[rid], po = lg.po;
      if (i === 0) {
        if (po.final) return;
        var winners = [], losers = [];
        po.sf.forEach(function (pr, idx) {
          var res = po.sfRes[idx];
          if (!res) {
            var q = quickSeries(pr[0], pr[1], 5);
            res = po.sfRes[idx] = { a: pr[0], b: pr[1], wa: q.wa, wb: q.wb };
            recordLeague(lg, pr[0], pr[1], q.wa, q.wb, "sf");
          }
          winners.push(res.wa > res.wb ? res.a : res.b);
          losers.push(res.wa > res.wb ? res.b : res.a);
        });
        po.final = winners; po.sfLosers = losers;
      } else {
        if (!po.finalRes) {
          var q2 = quickSeries(po.final[0], po.final[1], 5);
          po.finalRes = { a: po.final[0], b: po.final[1], wa: q2.wa, wb: q2.wb };
          recordLeague(lg, po.final[0], po.final[1], q2.wa, q2.wb, "final");
        }
        var fr = po.finalRes;
        lg.champ = fr.wa > fr.wb ? fr.a : fr.b;
        var second = fr.wa > fr.wb ? fr.b : fr.a;
        // 名次：冠、亞、季後賽四強、其餘依例行賽
        var order = [lg.champ, second].concat(po.sfLosers);
        lg.rank.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
        lg.final = order;
        var pts = lg.split === "spring" ? [90, 70, 50, 50, 30, 30, 10, 10] : [0, 100, 70, 70, 40, 40, 10, 10];
        order.forEach(function (id, k) { S.points[id] = (S.points[id] || 0) + pts[k]; });
        if (rid === S.region) {
          var place = order.indexOf("me");
          var prize = lg.split === "spring" ? [200, 100, 50, 50, 20, 20, 10, 10] : [300, 150, 70, 70, 30, 30, 15, 15];
          S.funds += prize[place];
          S.fans += [6000, 3000, 1500, 1500, 500, 500, 0, 0][place];
          if (place === 0) {
            S.trophies.push({ y: S.year, kind: lg.split });
            addNews(tr("news_title_" + lg.split, { team: S.teams.me.name }), "gold");
          } else {
            addNews(tr("news_place", { split: tr("split_" + lg.split), n: place + 1, prize: prize[place] }));
          }
          S.history.push({ y: S.year, kind: lg.split, place: place + 1 });
        }
      }
    });
  }

  // ---------------- 世界大賽 ----------------
  function qualifyWorlds() {
    var teams = [], seeds = {};
    D.REGIONS.forEach(function (rg) {
      var lg = S.leagues[rg.id], q = [lg.champ];
      var rest = lg.teams.filter(function (id) { return id !== lg.champ; }).sort(function (a, b) {
        return (S.points[b] || 0) - (S.points[a] || 0) || lg.final.indexOf(a) - lg.final.indexOf(b);
      });
      for (var i = 1; i < rg.slots; i++) q.push(rest[i - 1]);
      q.forEach(function (id, k) { teams.push(id); seeds[id] = k + 1; });
    });
    // 分組：依實力排序蛇形分到 4 組，同地區盡量不同組
    var sorted = teams.slice().sort(function (a, b) { return teamStr(b) - teamStr(a); });
    var groups = [[], [], [], []];
    sorted.forEach(function (id, idx) {
      var pot = Math.floor(idx / 4), order = pot % 2 ? [3, 2, 1, 0] : [0, 1, 2, 3];
      var reg = team(id).region, placed = false;
      order.forEach(function (g) {
        if (placed || groups[g].length > pot) return;
        if (groups[g].some(function (o) { return team(o).region === reg; })) return;
        groups[g].push(id); placed = true;
      });
      if (!placed) order.forEach(function (g) { if (!placed && groups[g].length <= pot) { groups[g].push(id); placed = true; } });
      if (!placed) groups.sort(function (x, y) { return x.length - y.length; })[0].push(id);
    });
    var table = {};
    teams.forEach(function (id) { table[id] = { w: 0, l: 0, gw: 0, gl: 0 }; });
    S.worlds = { teams: teams, seeds: seeds, groups: groups, table: table, results: [], qf: null, sf: null, final: null, ko: {}, champ: null, out: {} };
    if (teams.indexOf("me") >= 0) {
      addNews(tr("news_worlds_in", { seed: seeds.me }), "gold");
      S.fans += 3000;
    } else {
      addNews(tr("news_worlds_out"));
    }
  }
  var GROUP_RR = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  function worldsPairs(i) {
    var W = S.worlds;
    if (!W) return [];
    if (i < 3) {
      var out = [];
      W.groups.forEach(function (g) { GROUP_RR[i].forEach(function (pr) { out.push([g[pr[0]], g[pr[1]]]); }); });
      return out;
    }
    if (i === 3) return W.qf || [];
    if (i === 4) return W.sf || [];
    return W.final ? [W.final] : [];
  }
  function groupStandings(g) {
    var tb = S.worlds.table;
    return g.slice().sort(function (a, b) {
      var A = tb[a], B = tb[b];
      return (B.w - A.w) || ((B.gw - B.gl) - (A.gw - A.gl)) || (teamStr(b) - teamStr(a));
    });
  }
  function recordWorlds(a, b, wa, wb, stage) {
    var W = S.worlds;
    if (stage === "wgroup") {
      var A = W.table[a], B = W.table[b];
      A.gw += wa; A.gl += wb; B.gw += wb; B.gl += wa;
      if (wa > wb) { A.w++; B.l++; } else { B.w++; A.l++; }
    }
    W.results.push({ wk: S.wk, a: a, b: b, wa: wa, wb: wb, stage: stage });
    W.ko[a + "|" + b] = { wa: wa, wb: wb };
  }
  function koWinner(pr) {
    var r = S.worlds.ko[pr[0] + "|" + pr[1]];
    if (!r) return null;
    return r.wa > r.wb ? pr[0] : pr[1];
  }
  function resolveWorldsWeek(i) {
    var W = S.worlds;
    if (!W) return;
    var stage = i < 3 ? "wgroup" : ["wqf", "wsf", "wfinal"][i - 3];
    worldsPairs(i).forEach(function (pr) {
      if (W.ko[pr[0] + "|" + pr[1]]) return;
      var q = quickSeries(pr[0], pr[1], i < 3 ? 3 : 5);
      recordWorlds(pr[0], pr[1], q.wa, q.wb, stage);
    });
    var me = W.teams.indexOf("me") >= 0;
    if (i === 2) {
      var st = W.groups.map(groupStandings);
      W.gst = st;
      W.qf = [[st[0][0], st[1][1]], [st[1][0], st[0][1]], [st[2][0], st[3][1]], [st[3][0], st[2][1]]];
      st.forEach(function (g) { W.out[g[2]] = "group"; W.out[g[3]] = "group"; });
      if (me && W.out.me === "group") worldsPrize("group");
    } else if (i === 3) {
      W.sf = [[koWinner(W.qf[0]), koWinner(W.qf[1])], [koWinner(W.qf[2]), koWinner(W.qf[3])]];
      W.qf.forEach(function (pr) { var w = koWinner(pr); W.out[w === pr[0] ? pr[1] : pr[0]] = "qf"; });
      if (me && W.out.me === "qf") worldsPrize("qf");
    } else if (i === 4) {
      W.final = [koWinner(W.sf[0]), koWinner(W.sf[1])];
      W.sf.forEach(function (pr) { var w = koWinner(pr); W.out[w === pr[0] ? pr[1] : pr[0]] = "sf"; });
      if (me && W.out.me === "sf") worldsPrize("sf");
    } else if (i === 5) {
      W.champ = koWinner(W.final);
      W.out[W.champ === W.final[0] ? W.final[1] : W.final[0]] = "second";
      W.out[W.champ] = "champ";
      addNews(tr("news_worlds_champ", { team: teamName(W.champ), region: L(D.REGION[team(W.champ).region].name) }), "gold");
      if (me && (W.out.me === "champ" || W.out.me === "second")) worldsPrize(W.out.me);
    }
  }
  function worldsPrize(place) {
    var prize = { group: 100, qf: 250, sf: 500, second: 1000, champ: 2000 }[place];
    var fans = { group: 2000, qf: 5000, sf: 10000, second: 18000, champ: 40000 }[place];
    S.funds += prize; S.fans += fans;
    S.history.push({ y: S.year, kind: "worlds", place: place });
    if (place === "champ") {
      S.trophies.push({ y: S.year, kind: "worlds" });
      addNews(tr("news_worlds_win", { team: S.teams.me.name }), "gold");
    } else {
      addNews(tr("news_worlds_place", { place: tr("wplace_" + place), prize: prize }));
    }
  }

  // ---------------- 每週的電腦隊比賽 ----------------
  function resolveAIMatches() {
    var w = week();
    if (w.k === "league") {
      Object.keys(S.leagues).forEach(function (rid) {
        var lg = S.leagues[rid];
        lg.sched[w.i].forEach(function (pr) {
          if (pr[0] === "me" || pr[1] === "me") return;
          var q = quickSeries(pr[0], pr[1], 3);
          recordLeague(lg, pr[0], pr[1], q.wa, q.wb, "league");
        });
      });
      if (w.i === 6) setupPlayoffs();
    } else if (w.k === "po") {
      resolvePlayoffWeek(w.i);
      if (w.split === "summer" && w.i === 1) qualifyWorlds();
    } else if (w.k === "worlds") {
      resolveWorldsWeek(w.i);
    }
  }

  // ---------------- 每週結算（訓練、財務、心情） ----------------
  function growthMul(p) {
    var gap = clamp((p.pot - ovr(p)) / 14, 0.08, 1.4);
    var ageM = p.age <= 19 ? 1.25 : p.age <= 23 ? 1.0 : p.age <= 26 ? 0.7 : 0.4;
    return gap * ageM * (D.TRAIT[p.trait].grow || 1);
  }
  function trainOne(p, focusId, mult) {
    var f = D.FOCUS_BY_ID[focusId];
    if (focusId === "rest") {
      p.fatigue = clamp(p.fatigue - 30, 0, 100);
      p.mood = clamp(p.mood + 5, 0, 100);
    } else {
      var g = growthMul(p) * mult * (p.fatigue > 75 ? 0.5 : 1);
      if (f.stat) {
        p.stats[f.stat] = clamp(p.stats[f.stat] + rnd(0.3, 0.7) * g, 1, 99);
        D.STATS.forEach(function (k) { if (k !== f.stat) p.stats[k] = clamp(p.stats[k] + rnd(0, 0.1) * g, 1, 99); });
      } else {
        // 英雄池：練習英雄大幅、其他同位置英雄小幅
        heroesOfRole(p.role).forEach(function (h) { p.mastery[h.id] = clamp((p.mastery[h.id] || 0) + rnd(0.5, 2) * mult, 0, 100); });
      }
      p.fatigue = clamp(p.fatigue + (focusId === "mental" ? 3 : 9), 0, 100);
    }
    if (p.practice) p.mastery[p.practice] = clamp((p.mastery[p.practice] || 0) + (focusId === "hero" ? rnd(5, 8) : rnd(2, 4)) * mult, 0, 100);
    Object.keys(p.mastery).forEach(function (h) { p.mastery[h] = Math.round(p.mastery[h] * 10) / 10; });
  }
  function weeklyUpkeep() {
    var lines = [];
    S.roster.forEach(function (id) {
      var p = person(id);
      trainOne(p, p.squad === 1 ? S.focus1 : S.focus2, p.squad === 1 ? 1 : 1.1);
      // 心情回歸，二軍中實力不輸先發的人會想上場
      p.mood = clamp(p.mood + (60 - p.mood) * 0.12, 0, 100);
      if (p.squad === 2) {
        var st = person(S.lineup[p.role]);
        if (st && ovr(p) >= ovr(st) - 1) p.mood = clamp(p.mood - 4, 0, 100);
      }
      p.salary = salaryOf(ovr(p));
    });
    var reg = D.REGION[S.region], wage = 0;
    S.roster.forEach(function (id) { wage += person(id).salary; });
    var income = reg.sponsor + Math.round(S.fans / 2000);
    S.funds += income - wage;
    S.lastBudget = { income: income, wage: wage };
    return lines;
  }

  // ---------------- 隨機事件 ----------------
  function randomEvent() {
    if (Math.random() > 0.38) return null;
    var ps = S.roster.map(person), p = pick(ps), ev = ri(0, 10), text;
    switch (ev) {
      case 0: p.mood = clamp(p.mood + 10, 0, 100); S.fans += 600; text = tr("ev_fanmeet", { name: p.handle }); break;
      case 1: p.fatigue = clamp(p.fatigue + 25, 0, 100); p.cond = Math.max(-2, p.cond - 1); text = tr("ev_wrist", { name: p.handle }); break;
      case 2: p.mood = clamp(p.mood + 8, 0, 100); S.fans += 1500; text = tr("ev_stream", { name: p.handle }); break;
      case 3: p.mood = clamp(p.mood - (p.stats.mental > 70 ? 4 : 12), 0, 100); text = tr("ev_haters", { name: p.handle }); break;
      case 4: S.funds += 30; text = tr("ev_sponsor"); break;
      case 5: ps.forEach(function (x) { x.mood = clamp(x.mood - 4, 0, 100); }); text = tr("ev_blackout"); break;
      case 6:
        var hs = shuffle(D.HEROES.slice()).slice(0, 3);
        hs.forEach(function (h, k) { S.meta[h.id] = k === 0 ? 2 : k === 1 ? 1 : -1; });
        text = tr("ev_hotfix", { a: L(hs[0].name), b: L(hs[1].name), c: L(hs[2].name) }); break;
      case 7: ps.forEach(function (x) { x.mood = clamp(x.mood + 5, 0, 100); }); text = tr("ev_trash"); break;
      case 8: p.mood = clamp(p.mood + 12, 0, 100); text = tr("ev_birthday", { name: p.handle }); break;
      case 9: ps.forEach(function (x) { if (x.squad === 1) x.mood = clamp(x.mood + 5, 0, 100); }); text = tr("ev_scrim"); break;
      default:
        var hi = ps.filter(function (x) { return x.aff >= 70; }), lo = ps.filter(function (x) { return x.aff < 30; });
        if (hi.length && lo.length) { var v = pick(lo); v.mood = clamp(v.mood - 8, 0, 100); text = tr("ev_jealous", { name: v.handle, other: pick(hi).handle }); }
        else { p.stats.mental = clamp(p.stats.mental + 1, 1, 99); text = tr("ev_diary", { name: p.handle }); }
    }
    addNews(text, "event");
    return text;
  }

  // ---------------- 休賽季 ----------------
  function offseason() {
    // 年齡、成長或衰退
    Object.keys(S.people).forEach(function (id) {
      var p = S.people[id];
      if (p.scout) return;
      p.age += 1;
      var o = ovr(p), d;
      if (p.age <= 22) d = (p.pot - o) * rnd(0.08, 0.2);
      else if (p.age <= 25) d = rnd(-0.5, 1.5);
      else d = -rnd(0.5, 2.5);
      if (p.team !== "me") d += gauss() * 1.5;
      D.STATS.forEach(function (k) { p.stats[k] = clamp(p.stats[k] + d * rnd(0.7, 1.3), 1, 99); });
      p.pot = Math.max(Math.round(ovr(p)), p.pot);
      p.salary = salaryOf(ovr(p));
    });
    // 電腦隊：28 歲以上或隨機引退，補上新人
    Object.keys(S.teams).forEach(function (tid) {
      var t = S.teams[tid];
      if (t.me) return;
      t.players = t.players.map(function (pid) {
        var p = S.people[pid];
        if (p.age >= 28 || Math.random() < 0.12) {
          var rg = D.REGION[t.region];
          delete S.people[pid];
          var np = newPlayer(t.region, p.role, rg.str + rnd(-6, 6), ri(17, 20), { team: tid });
          np.squad = 1; S.people[np.id] = np;
          return np.id;
        }
        return pid;
      });
    });
    S.year += 1;
    S.points = {};
    S.worlds = null;
    addNews(tr("news_newyear", { y: S.year }), "gold");
  }

  // ---------------- 進入新的一週 ----------------
  function enterWeek() {
    var w = week();
    S.ap = 3; S.done = false; S.hotelThisWeek = 0; S.series = null; S.draft = null;
    if (w.k === "pre" && w.i === 0) { newPatch(); refreshScouts(); addNews(tr("news_patch", { n: S.patch })); }
    if (w.k === "league" && w.i === 0) { setupLeagues(w.split); addNews(tr("news_split_start", { split: tr("split_" + w.split) })); }
    if (w.k === "break" && w.i === 0) { newPatch(); refreshScouts(); addNews(tr("news_patch", { n: S.patch })); }
    rollConditions();
    S.lastEvent = randomEvent();
    if (!myMatch()) S.done = true;
  }
  function canAdvance() { return S.done || !myMatch(); }
  function advance() {
    if (!canAdvance()) return false;
    resolveAIMatches();
    weeklyUpkeep();
    if (week().k === "off") { S.wk = 0; offseason(); }
    else S.wk++;
    enterWeek();
    save();
    return true;
  }

  // ================= 比賽：BP =================
  // 藍紅各 3 禁 5 選：禁(藍紅藍紅) → 選(藍、紅紅、藍藍、紅) → 禁(紅藍) → 選(紅、藍藍、紅)
  var DRAFT = [
    ["blue", "ban"], ["red", "ban"], ["blue", "ban"], ["red", "ban"],
    ["blue", "pick"], ["red", "pick"], ["red", "pick"], ["blue", "pick"], ["blue", "pick"], ["red", "pick"],
    ["red", "ban"], ["blue", "ban"],
    ["red", "pick"], ["blue", "pick"], ["blue", "pick"], ["red", "pick"]
  ];
  function startSeries(auto) {
    var m = myMatch();
    if (!m || S.done) return null;
    S.series = { opp: m.opp, bo: m.bo, stage: m.stage, wins: { me: 0, opp: 0 }, games: [], used: { me: [], opp: [] }, auto: !!auto };
    // 對手每場比賽的調子
    teamPlayers(m.opp).forEach(aiCond);
    startGame();
    save();
    return S.series;
  }
  function startGame() {
    var se = S.series, n = se.games.length;
    var blueMe;
    if (n === 0) blueMe = se.stage === "league" ? Math.random() < 0.5 : (S.points.me || 0) >= (S.points[se.opp] || 0);
    else blueMe = se.games[n - 1].winner !== "me";   // 輸的一方拿藍方
    S.draft = { blue: blueMe ? "me" : se.opp, red: blueMe ? se.opp : "me", step: 0, bans: { blue: [], red: [] }, picks: { blue: {}, red: {} }, tactic: null, oppTactic: null };
  }
  function sideOf(tid) { return S.draft.blue === tid ? "blue" : "red"; }
  function teamOfSide(side) { return S.draft[side]; }
  function seriesKey(tid) { return tid === "me" ? "me" : "opp"; }
  function draftTurn() { return DRAFT[S.draft.step] || null; }
  function heroTaken(hid) {
    var d = S.draft;
    if (d.bans.blue.indexOf(hid) >= 0 || d.bans.red.indexOf(hid) >= 0) return "ban";
    var p = false;
    ["blue", "red"].forEach(function (s) { Object.keys(d.picks[s]).forEach(function (r) { if (d.picks[s][r] === hid) p = s; }); });
    return p ? "pick" : null;
  }
  // 無懼選角：同系列賽中自己隊伍用過的英雄不能再選（50 位英雄無法讓雙方共用的完整無懼撐到 Bo5，因此以隊伍為單位）
  function fearlessLocked(tid, hid) { return S.series.used[seriesKey(tid)].indexOf(hid) >= 0; }
  function canPick(side, hid) {
    var h = D.HERO[hid], tid = teamOfSide(side);
    if (!h || heroTaken(hid)) return false;
    if (S.draft.picks[side][h.role]) return false;
    if (fearlessLocked(tid, hid)) {
      // 保險：該位置已經沒有任何可選英雄時解除無懼限制
      var any = heroesOfRole(h.role).some(function (x) { return !heroTaken(x.id) && !fearlessLocked(tid, x.id); });
      if (any) return false;
    }
    return true;
  }
  function canBan(hid) { return !heroTaken(hid); }
  function playerFor(tid, role) {
    if (tid === "me") return person(S.lineup[role]);
    var ps = teamPlayers(tid);
    for (var i = 0; i < ps.length; i++) if (ps[i].role === role) return ps[i];
    return null;
  }
  function synergyWith(picks, hid) {
    var n = 0;
    D.SYNERGIES.forEach(function (s) {
      if ((s.a === hid && picks.indexOf(s.b) >= 0) || (s.b === hid && picks.indexOf(s.a) >= 0)) n++;
    });
    return n;
  }
  function pickedList(side) { var o = S.draft.picks[side]; return Object.keys(o).map(function (r) { return o[r]; }); }
  // 電腦（或助理教練）的選擇
  function aiChoose(side) {
    var turn = draftTurn(), tid = teamOfSide(side), other = side === "blue" ? "red" : "blue", otid = teamOfSide(other);
    var best = null, bestS = -1e9;
    if (turn[1] === "ban") {
      D.HEROES.forEach(function (h) {
        if (!canBan(h.id)) return;
        if (S.draft.picks[other][h.role]) return;   // 對方該位置已經選了，禁也沒用
        if (fearlessLocked(otid, h.id)) return;
        var p = playerFor(otid, h.role);
        var s = (p ? (p.mastery[h.id] || 0) * 0.9 + ovr(p) * 0.25 : 0) + metaTier(h.id) * 14 + synergyWith(pickedList(other), h.id) * 18 + rnd(0, 10);
        if (s > bestS) { bestS = s; best = h.id; }
      });
    } else {
      var mine = pickedList(side);
      D.HEROES.forEach(function (h) {
        if (!canPick(side, h.id)) return;
        var p = playerFor(tid, h.role);
        var s = (p ? (p.mastery[h.id] || 0) : 30) + metaTier(h.id) * 12 + synergyWith(mine, h.id) * 16 + rnd(0, 9);
        // 對方還沒選的位置上，對手招牌英雄先搶
        var op = playerFor(otid, h.role);
        if (op && !S.draft.picks[other][h.role] && (op.mastery[h.id] || 0) > 85) s += 6;
        if (s > bestS) { bestS = s; best = h.id; }
      });
    }
    return best;
  }
  function draftAct(hid) {
    var turn = draftTurn();
    if (!turn) return false;
    var side = turn[0];
    if (turn[1] === "ban") {
      if (!canBan(hid)) return false;
      S.draft.bans[side].push(hid);
    } else {
      if (!canPick(side, hid)) return false;
      S.draft.picks[side][D.HERO[hid].role] = hid;
    }
    S.draft.step++;
    return true;
  }
  function draftDone() { return S.draft && S.draft.step >= DRAFT.length; }
  function mySide() { return sideOf("me"); }

  // ================= 戰術與實力 =================
  function compFit(picksObj, tacticId) {
    var t = D.TACTIC[tacticId], n = 0;
    Object.keys(picksObj).forEach(function (r) { D.HERO[picksObj[r]].tags.forEach(function (tag) { if (t.likes.indexOf(tag) >= 0) n++; }); });
    return n;
  }
  function fitPct(picksObj, tacticId) { return Math.round(clamp(compFit(picksObj, tacticId) / 7, 0, 1) * 100); }
  function activeSynergies(picksObj) {
    var hs = Object.keys(picksObj).map(function (r) { return picksObj[r]; });
    return D.SYNERGIES.filter(function (s) { return hs.indexOf(s.a) >= 0 && hs.indexOf(s.b) >= 0; });
  }
  function aiTactic(picksObj) {
    var best = null, bs = -1e9;
    D.TACTICS.forEach(function (t) {
      var s = compFit(picksObj, t.id) + curveBias(picksObj, t.id) + rnd(0, 1.6);
      if (s > bs) { bs = s; best = t.id; }
    });
    return best;
  }
  function curveSum(picksObj) {
    var c = [0, 0, 0];
    Object.keys(picksObj).forEach(function (r) { var h = D.HERO[picksObj[r]]; for (var i = 0; i < 3; i++) c[i] += h.curve[i]; });
    return c;
  }
  function curveBias(picksObj, tacticId) {
    var c = curveSum(picksObj), ph = D.TACTIC[tacticId].phase;
    return ((c[0] - 15) * ph.early + (c[1] - 15) * ph.mid + (c[2] - 15) * ph.late) * 0.12;
  }
  function matchRating(p, hid) {
    if (!p) return 40;
    var m = p.mastery[hid] || 15;
    return ovr(p) * (0.9 + 0.2 * m / 100) + p.cond * 2.2 + (p.mood - 55) / 18 - Math.max(0, p.fatigue - 50) / 15 + metaTier(hid) * 0.9;
  }
  // 各時段的戰力
  function power(tid, picksObj, tactic, oppTactic, blue) {
    var base = 0, rs = {};
    D.ROLES.forEach(function (r) { var p = playerFor(tid, r); rs[r] = matchRating(p, picksObj[r]); base += rs[r]; });
    base /= 5;
    var fit = (Math.min(compFit(picksObj, tactic), 8) - 3) * 0.55;
    var c = curveSum(picksObj), ph = D.TACTIC[tactic].phase;
    var counter = D.TACTIC[tactic].beats.indexOf(oppTactic) >= 0 ? 1.8 : D.TACTIC[oppTactic].beats.indexOf(tactic) >= 0 ? -1.8 : 0;
    var syn = activeSynergies(picksObj).length * 1.2;
    var common = base + fit + counter + syn + (blue ? 0.4 : 0);
    return {
      base: base, fit: fit, counter: counter, syn: syn, rs: rs,
      early: common + (c[0] - 15) * 0.3 + ph.early,
      mid: common + (c[1] - 15) * 0.3 + ph.mid,
      late: common + (c[2] - 15) * 0.3 + ph.late
    };
  }
  // 賽前的分析師預測（不知道對手戰術，用平均）
  function predict(myTactic) {
    var d = S.draft, me = mySide(), opp = me === "blue" ? "red" : "blue";
    var pa = power("me", d.picks[me], myTactic || "fight", d.oppTactic || "fight", me === "blue");
    var pb = power(S.series.opp, d.picks[opp], d.oppTactic || "fight", myTactic || "fight", opp === "blue");
    // 對手戰術未知：不計克制
    var diff = (pa.early + pa.mid + pa.late - pb.early - pb.mid - pb.late) / 3 - pa.counter + pb.counter;
    return { pct: Math.round(sigmoid(diff / 4.2) * 100), me: pa, opp: pb };
  }

  // ================= 比賽模擬 =================
  var KILL_W = { top: 1, jg: 1.2, mid: 1.5, adc: 1.7, sup: 0.4 };
  var DEATH_W = { top: 0.9, jg: 1, mid: 1, adc: 1.2, sup: 1.3 };
  function simGame(A, B) {
    // A／B：{ tid, picks, tactic, oppTactic, blue }
    var pa = power(A.tid, A.picks, A.tactic, B.tactic, A.blue), pb = power(B.tid, B.picks, B.tactic, A.tactic, B.blue);
    var lead = 0, moments = [], box = { A: {}, B: {} };
    D.ROLES.forEach(function (r) { box.A[r] = { k: 0, d: 0, a: 0 }; box.B[r] = { k: 0, d: 0, a: 0 }; });
    var seq = [Math.random() < 0.5 ? "invade" : "gank", "drake", Math.random() < 0.5 ? "herald" : "midfight", Math.random() < 0.6 ? "baron" : "elder"];
    var lastMin = 0, ended = false;
    function fight(type, forced) {
      var M = D.MOMENTS[type];
      var diff = pa[M.phase] - pb[M.phase] + lead * 0.35;
      var aWin = forced ? forced === "A" : Math.random() < sigmoid(diff / 5);
      var w = aWin ? "A" : "B", l = aWin ? "B" : "A", wp = aWin ? pa : pb, lp = aWin ? pb : pa;
      var close = Math.abs(diff) < 2.5;
      var wk = clamp(1 + Math.floor(Math.random() * M.k) + (type === "siege" ? 1 : 0), 1, 5);
      var lk = close ? Math.floor(Math.random() * Math.min(3, wk + 1)) : Math.floor(Math.random() * 2) * (Math.random() < 0.5 ? 1 : 0);
      var kills = [], aliveW = D.ROLES.slice(), aliveL = D.ROLES.slice(), i;
      for (i = 0; i < lk && aliveW.length > 1; i++) {
        var k1 = weighted(aliveL, function (r) { return KILL_W[r] * lp.rs[r] / 60; });
        var v1 = weighted(aliveW, function (r) { return DEATH_W[r]; });
        aliveW.splice(aliveW.indexOf(v1), 1);
        kills.push({ side: l, killer: k1, victim: v1 });
      }
      for (i = 0; i < wk && aliveL.length; i++) {
        var k2 = weighted(aliveW.length ? aliveW : D.ROLES, function (r) { return KILL_W[r] * wp.rs[r] / 60; });
        var v2 = weighted(aliveL, function (r) { return DEATH_W[r]; });
        aliveL.splice(aliveL.indexOf(v2), 1);
        kills.push({ side: w, killer: k2, victim: v2 });
      }
      shuffle(kills);
      // 勝方的擊殺放到後面（先換、後收割）
      kills.sort(function (x, y) { return (x.side === w ? 1 : 0) - (y.side === w ? 1 : 0); });
      kills.forEach(function (kl) {
        var vs = kl.side === "A" ? "B" : "A";
        box[kl.side][kl.killer].k++; box[vs][kl.victim].d++;
        var others = D.ROLES.filter(function (r) { return r !== kl.killer; });
        shuffle(others).slice(0, ri(1, 3)).forEach(function (r) { box[kl.side][r].a++; });
      });
      var swing = M.swing * rnd(0.7, 1.3) + (wk - lk) * 0.4;
      lead += aWin ? swing : -swing;
      var min = type === "siege" ? lastMin + ri(2, 6) : Math.max(lastMin + 2, ri(M.min[0], M.min[1]));
      lastMin = min;
      moments.push({ type: type, min: min, sec: ri(0, 59), winner: w, kills: kills, lead: Math.round(lead * 10) / 10, obj: M.obj || null, close: close });
      return aWin;
    }
    for (var i = 0; i < seq.length; i++) {
      fight(seq[i]);
      // 大幅領先 → 直接推上高地結束（3〜4 幕）
      if (i >= 1 && i < seq.length - 1 && Math.abs(lead) > (i === 1 ? 11 : 9)) {
        ended = true;
        var fav = lead > 0 ? "A" : "B";
        var winSiege = Math.random() < 0.85;
        fight("siege", winSiege ? fav : (fav === "A" ? "B" : "A"));
        if (!winSiege) { ended = false; i = Math.max(i, 2); continue; }
        break;
      }
    }
    if (!ended) {
      // 終局：後期戰力＋經濟差決定誰推掉主堡
      var pr = sigmoid((pa.late - pb.late + lead * 0.45) / 4.5);
      fight("siege", Math.random() < pr ? "A" : "B");
    }
    var winner = moments[moments.length - 1].winner;
    // MVP：勝方 KDA 最高
    var mvp = null, ms = -1;
    D.ROLES.forEach(function (r) { var b = box[winner][r], s = (b.k * 2 + b.a) / Math.max(1, b.d) + b.k * 0.3; if (s > ms) { ms = s; mvp = r; } });
    return { winner: winner, moments: moments, box: box, mvp: { side: winner, role: mvp }, minutes: lastMin, pa: pa, pb: pb };
  }

  // 玩家選定戰術後進行一局
  function playGame(myTactic) {
    var d = S.draft, se = S.series, me = mySide(), opp = me === "blue" ? "red" : "blue";
    d.tactic = myTactic;
    if (!d.oppTactic) d.oppTactic = aiTactic(d.picks[opp]);
    var res = simGame(
      { tid: "me", picks: d.picks[me], tactic: myTactic, blue: me === "blue" },
      { tid: se.opp, picks: d.picks[opp], tactic: d.oppTactic, blue: opp === "blue" }
    );
    var win = res.winner === "A";
    se.wins[win ? "me" : "opp"]++;
    var g = { n: se.games.length + 1, blue: d.blue, red: d.red, bans: d.bans, picks: d.picks, myTactic: myTactic, oppTactic: d.oppTactic,
      winner: win ? "me" : se.opp, res: res, mySide: me };
    se.games.push(g);
    // 無懼：記錄用過的英雄
    Object.keys(d.picks[me]).forEach(function (r) { se.used.me.push(d.picks[me][r]); });
    Object.keys(d.picks[opp]).forEach(function (r) { se.used.opp.push(d.picks[opp][r]); });
    // 自己選手的成長與紀錄
    D.ROLES.forEach(function (r) {
      var p = person(S.lineup[r]), b = res.box.A[r], hid = d.picks[me][r];
      p.games++; if (win) p.wins++;
      p.k += b.k; p.d += b.d; p.a += b.a;
      p.mastery[hid] = clamp((p.mastery[hid] || 0) + 1.5, 0, 100);
      D.STATS.forEach(function (k) { p.stats[k] = clamp(p.stats[k] + rnd(0, 0.06) * growthMul(p), 1, 99); });
      p.fatigue = clamp(p.fatigue + 4, 0, 100);
      if (res.mvp.side === "A" && res.mvp.role === r) { p.mvp++; p.mood = clamp(p.mood + 4, 0, 100); }
    });
    var need = Math.ceil(se.bo / 2);
    if (se.wins.me >= need || se.wins.opp >= need) finishSeries();
    else startGame();
    save();
    return g;
  }
  function seriesOver() { var se = S.series; if (!se) return true; var need = Math.ceil(se.bo / 2); return se.wins.me >= need || se.wins.opp >= need; }
  function finishSeries() {
    var se = S.series, win = se.wins.me > se.wins.opp;
    S.roster.forEach(function (id) { var p = person(id); if (p.squad === 1) p.mood = clamp(p.mood + (win ? 7 : -6), 0, 100); });
    S.fans += win ? 400 : -100;
    if (win && se.stage === "league") S.funds += 8;
    if (se.stage === "league" || se.stage === "sf" || se.stage === "final") {
      var lg = S.leagues[S.region];
      if (se.stage === "league") recordLeague(lg, "me", se.opp, se.wins.me, se.wins.opp, "league");
      else {
        recordLeague(lg, "me", se.opp, se.wins.me, se.wins.opp, se.stage);
        var po = lg.po;
        if (se.stage === "sf") po.sf.forEach(function (pr, idx) { if (pr[0] === "me" || pr[1] === "me") po.sfRes[idx] = { a: "me", b: se.opp, wa: se.wins.me, wb: se.wins.opp }; });
        else po.finalRes = { a: "me", b: se.opp, wa: se.wins.me, wb: se.wins.opp };
      }
    } else {
      var W = S.worlds, ps = worldsPairs(week().i), pr0 = null;
      ps.forEach(function (pr) { if (pr[0] === "me" || pr[1] === "me") pr0 = pr; });
      if (pr0) {
        if (pr0[0] === "me") recordWorlds("me", se.opp, se.wins.me, se.wins.opp, se.stage);
        else recordWorlds(se.opp, "me", se.wins.opp, se.wins.me, se.stage);
      }
    }
    addNews(tr(win ? "news_win" : "news_loss", { opp: teamName(se.opp), a: se.wins.me, b: se.wins.opp, stage: tr("stage_" + se.stage) }), win ? "win" : "loss");
    S.done = true;
  }
  // 整場系列賽交給助理教練（不重播）
  function autoSeries() {
    if (!S.series) startSeries(true);
    var guard = 0;
    while (S.series && !seriesOver() && guard++ < 10) {
      while (!draftDone()) draftAct(aiChoose(draftTurn()[0]));
      playGame(aiTactic(S.draft.picks[mySide()]));
    }
    save();
  }

  // ================= 選手互動（行動點數） =================
  function needAP(n) { return S.ap >= n; }
  function checkMilestone(p) {
    var t = D.TRAIT[p.trait], th = [30, 60, 90];
    for (var i = 0; i < 3; i++) {
      if (p.aff >= th[i] && !p.ms[th[i]]) {
        p.ms[th[i]] = 1;
        if (th[i] === 90) p.stats.mental = clamp(p.stats.mental + 3, 1, 99);
        return { level: i, line: L(t.lines[i]) };
      }
    }
    return null;
  }
  function talk(pid) {
    var p = person(pid), t = D.TRAIT[p.trait];
    if (!needAP(1)) return { ok: false, msg: tr("err_ap") };
    S.ap -= 1;
    p.aff = clamp(p.aff + (3 + rnd(0, 2)) * (t.talkMul || 1), 0, 100);
    p.mood = clamp(p.mood + 6, 0, 100);
    save();
    return { ok: true, msg: tr("act_talk_done", { name: p.handle }), scene: checkMilestone(p) };
  }
  function coach(pid) {
    var p = person(pid);
    if (!needAP(1)) return { ok: false, msg: tr("err_ap") };
    S.ap -= 1;
    var low = D.STATS.slice().sort(function (a, b) { return p.stats[a] - p.stats[b]; })[0];
    var g = rnd(0.8, 1.5) * Math.max(0.4, growthMul(p));
    p.stats[low] = clamp(p.stats[low] + g, 1, 99);
    p.fatigue = clamp(p.fatigue + 6, 0, 100);
    p.aff = clamp(p.aff + 1.5, 0, 100);
    save();
    return { ok: true, msg: tr("act_coach_done", { name: p.handle, stat: L(D.STAT[low]), g: g.toFixed(1) }), scene: checkMilestone(p) };
  }
  function date(pid, spotId) {
    var p = person(pid), sp = D.DATE_SPOT[spotId], t = D.TRAIT[p.trait];
    if (!needAP(1)) return { ok: false, msg: tr("err_ap") };
    if (S.funds < sp.cost) return { ok: false, msg: tr("err_funds") };
    S.ap -= 1; S.funds -= sp.cost;
    var like = t.likes.indexOf(spotId) >= 0 ? 1.5 : (t.dislikes || []).indexOf(spotId) >= 0 ? 0.5 : 1;
    var mul = like * (t.dateMul || 1);
    p.mood = clamp(p.mood + sp.mood * mul, 0, 100);
    p.aff = clamp(p.aff + sp.aff * mul, 0, 100);
    p.fatigue = clamp(p.fatigue - 8, 0, 100);
    if (p.mood >= 80 && p.cond < 2 && Math.random() < 0.35) p.cond++;
    save();
    return { ok: true, msg: L(sp.text) + " " + tr(like > 1 ? "date_like" : like < 1 ? "date_dislike" : "date_ok", { name: p.handle }), scene: checkMilestone(p) };
  }
  function hotel(pid) {
    var p = person(pid), H = D.HOTEL;
    if (p.aff < H.needAff) return { ok: false, msg: tr("err_hotel_aff", { n: H.needAff }) };
    if (!needAP(H.ap)) return { ok: false, msg: tr("err_ap") };
    if (S.funds < H.cost) return { ok: false, msg: tr("err_funds") };
    S.ap -= H.ap; S.funds -= H.cost; S.hotelThisWeek++;
    p.mood = clamp(p.mood + H.mood, 0, 100);
    p.aff = clamp(p.aff + H.aff, 0, 100);
    p.fatigue = clamp(p.fatigue - 15, 0, 100);
    p.cond = Math.min(2, p.cond + 1);
    var msg = L(H.text), scandal = false;
    if (Math.random() < H.scandal * S.hotelThisWeek) {
      scandal = true;
      S.fans = Math.round(S.fans * 0.92);
      S.funds -= 20;
      S.roster.forEach(function (id) { var o = person(id); if (id !== pid && o.squad === 1) o.mood = clamp(o.mood - 6, 0, 100); });
      addNews(tr("news_scandal", { name: p.handle }), "loss");
      msg += "\n" + tr("hotel_scandal");
    }
    save();
    return { ok: true, msg: msg, scandal: scandal, scene: checkMilestone(p) };
  }
  function teamDinner() {
    var cost = 8 + S.roster.length;
    if (!needAP(1)) return { ok: false, msg: tr("err_ap") };
    if (S.funds < cost) return { ok: false, msg: tr("err_funds") };
    S.ap -= 1; S.funds -= cost;
    S.roster.forEach(function (id) { var p = person(id); p.mood = clamp(p.mood + 6, 0, 100); p.aff = clamp(p.aff + 1, 0, 100); });
    save();
    return { ok: true, msg: tr("act_dinner_done", { cost: cost }) };
  }
  function setFocus(which, id) { if (which === 1) S.focus1 = id; else S.focus2 = id; save(); }
  function setPractice(pid, hid) { var p = person(pid); if (p) { p.practice = hid || null; save(); } }

  // ---------------- 存檔 ----------------
  function save() { try { if (S) localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 容量不足時略過 */ } }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      S = s;
      return S;
    } catch (e) { return null; }
  }
  function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } S = null; }

  window.PriTestChampCore = {
    CAL: CAL, DRAFT: DRAFT,
    get: function () { return S; },
    newGame: newGame, load: load, save: save, hasSave: hasSave, reset: reset,
    week: week, myMatch: myMatch, canAdvance: canAdvance, advance: advance,
    photoFile: photoFile, ovr: ovr, ovrI: ovrI, person: person, team: team, teamName: teamName, teamPlayers: teamPlayers, teamStr: teamStr,
    heroesOfRole: heroesOfRole, topHeroes: topHeroes, metaTier: metaTier, signFee: signFee, standings: standings, groupStandings: groupStandings,
    worldsPairs: worldsPairs, playerFor: playerFor,
    sign: sign, scoutReveal: scoutReveal, release: release, setLineup: setLineup, setFocus: setFocus, setPractice: setPractice,
    talk: talk, coach: coach, date: date, hotel: hotel, teamDinner: teamDinner,
    startSeries: startSeries, draftTurn: draftTurn, draftAct: draftAct, draftDone: draftDone, aiChoose: aiChoose, canPick: canPick, canBan: canBan,
    heroTaken: heroTaken, fearlessLocked: fearlessLocked, mySide: mySide, teamOfSide: teamOfSide,
    compFit: compFit, fitPct: fitPct, activeSynergies: activeSynergies, aiTactic: aiTactic, predict: predict, matchRating: matchRating,
    playGame: playGame, seriesOver: seriesOver, autoSeries: autoSeries
  };
})();
