// 明星經紀 starV：增加遊戲性的七個系統（規則，純邏輯，不碰 DOM；node 也能載入）。2026-11-05 使用者指定。
//   1 藝人心願：每人最多 2 個個人目標，達成→滿意度、心情、主能力上限永久 +3%；放太久會失望
//   2 季度經營目標：每季 3 個任務，達成給星探券／資金／聲望，三個全達成再加碼
//   3 臨場決策：A／S 級工作進行中有 3 回合「臨場狀況」，選對策略加分（不選就沒有影響，放置照常）
//   4 粉絲結構：核心粉（減緩人氣衰退、會員收入）、黑粉（醜聞壞結果機率↑）；粉絲見面會／限定直播／周邊販售三種行程
//   5 藝人關係網：一起工作、同期會變好友，同方向競爭會變對手；影響團體表現、壓力、前輩指導、對決工作、人際事件
//   6 作品 IP：★4 以上的作品可能變成系列，之後出現續集／改編工作，原班人馬有加成
//   7 醜聞連鎖：事件選項的 fx.chain 會在幾天後接續下一段事件（事件資料在 starv_events_15.js）
// 全部經由 starv_core.js 的 Core.hook() 掛上；狀態放在 st.plus 與藝人身上的 wishes／core／anti／capPlus。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var Core = root.PriTestStarvCore;
  if (!D || !D.PLUS || !Core || !Core.hook) return;
  var X = D.PLUS, B = X.BAL, I = Core._int;
  var TIERS = D.TIER_ORDER;
  function tierIdx(t) { return TIERS.indexOf(t); }
  function ri(n) { return Math.round(n); }

  // ==== 狀態 ====
  function ensureArtist(st, a) {
    if (!a.wishes) a.wishes = [];
    if (a.wishNext == null) a.wishNext = st.day + I.rint(st, B.wishFirst[0], B.wishFirst[1]);
    if (a.core == null) a.core = ri(a.fame * B.coreStart);
    if (a.anti == null) a.anti = 0;
    if (!a.capPlus) a.capPlus = {};
  }
  function ensure(st) {
    if (!st.plus) st.plus = { v: 1, goals: null, goalHist: [], ips: [], bonds: {}, chain: [], logSeen: st.logSeq, lastRefresh: st.boardRefreshDay, seasonPay: 0, lastSeasonPay: 0, stats: { wishes: 0, goals: 0, goalsAll: 0, clutch: 0, ips: 0 } };
    st.artists.forEach(function (a) { ensureArtist(st, a); });
    if (!st.plus.goals) newGoals(st);
    return st.plus;
  }

  // ==== 5. 關係網 ====
  function key(x, y) { return x < y ? x + "|" + y : y + "|" + x; }
  function bond(st, x, y) { return (st.plus && st.plus.bonds[key(x, y)]) || 0; }
  function addBond(st, x, y, v) {
    if (!x || !y || x === y || !v) return;
    var k = key(x, y), b0 = st.plus.bonds[k] || 0, b1 = I.clamp(Math.round((b0 + v) * 10) / 10, -100, 100);
    if (b1 === 0) delete st.plus.bonds[k]; else st.plus.bonds[k] = b1;
    if (b0 < B.bondFriend && b1 >= B.bondFriend) { I.log(st, "plus_friend", { aids: [x, y] }); goalAdd(st, "bond", 1); }
    if (b0 > B.bondRival && b1 <= B.bondRival) I.log(st, "plus_rival", { aids: [x, y] });
  }
  function pairs(ids, fn) { for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) fn(ids[i], ids[j]); }
  function bondsOf(st, a) {
    var out = [];
    Object.keys(st.plus.bonds).forEach(function (k) {
      var p = k.split("|"), other = p[0] === a.id ? p[1] : p[1] === a.id ? p[0] : null;
      if (other && I.artistById(st, other)) out.push({ aid: other, v: st.plus.bonds[k] });
    });
    out.sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); });
    return out;
  }
  function avgBond(st, ids) {
    var s = 0, n = 0;
    pairs(ids, function (x, y) { s += bond(st, x, y); n++; });
    return n ? s / n : 0;
  }

  // ==== 1. 心願 ====
  function wishTier(st, a) {
    var best = "C";
    TIERS.forEach(function (t) { var T0 = D.TIERS[t]; if (T0.unlock <= st.company.level && T0.minFame <= a.fame * 1.5 + 50 && tierIdx(t) >= 1) best = t; });
    return best;
  }
  function genWish(st, a) {
    var have = {}, w = {};
    a.wishes.forEach(function (x) { have[x.t] = true; });
    var others = st.artists.filter(function (x) { return x.id !== a.id; });
    X.WISHES.forEach(function (x) {
      if (have[x.id]) return;
      if (x.id === "chart" && a.fame < 100) return;
      if (x.id === "trophy" && a.fame < 500) return;
      if (x.id === "star5" && a.fame < 200) return;
      if (x.id === "duo" && !others.length) return;
      w[x.id] = x.w;
    });
    if (!Object.keys(w).length) return null;
    var t = I.wpick(st, w), p = {};
    if (t === "lead") p.tier = wishTier(st, a);
    else if (t === "great") p.dir = a.dir;
    else if (t === "try") {
      var subs = (a.subDirs || []).filter(function (d) { return d !== a.dir; });
      p.dir = subs.length ? I.pick(st, subs) : I.pick(st, D.DIRS.filter(function (d) { return d.id !== a.dir; })).id;
    } else if (t === "fame") p.n = Math.max(200, Math.ceil((a.fame * 1.6 + 150) / 100) * 100);
    else if (t === "duo") {
      var fr = bondsOf(st, a).filter(function (x) { return x.v > 0; });
      p.partner = fr.length ? fr[0].aid : I.pick(st, others).id;
    } else if (t === "course") p.n = I.rint(st, 2, 4);
    else if (t === "trophy") p.base = a.trophies.length;
    var wish = { id: I.newId(st, "wi"), t: t, p: p, since: st.day, until: st.day + B.wishLife, prog: 0 };
    a.wishes.push(wish);
    I.log(st, "plus_wish_new", { aid: a.id, wish: wish.t, p: p });
    return wish;
  }
  function doneWish(st, a, w) {
    a.wishes.splice(a.wishes.indexOf(w), 1);
    a.satisfaction = I.clamp(a.satisfaction + B.wishSat, 0, 100);
    a.mood = I.clamp(a.mood + 1, -2, 2);
    var stat = I.topStat(a.dir);
    a.capPlus[stat] = (a.capPlus[stat] || 0) + 1;
    I.recomputeCaps(a);
    var df = ri(a.fame * B.wishFamePct + B.wishFame);
    a.fame = I.clamp(a.fame + df, 0, 99999);
    a.core += ri(a.fame * B.wishCorePct);
    st.plus.stats.wishes++;
    I.log(st, "plus_wish_done", { aid: a.id, wish: w.t, p: w.p, stat: stat, fame: df });
    goalAdd(st, "wishes", 1);
  }
  function wishCheck(st, a, kind, ctx) {
    a.wishes.slice().forEach(function (w) {
      var ok = false, p = w.p;
      if (kind === "job") {
        var j = ctx.job, good = ctx.res === "great" || ctx.res === "success";
        if (w.t === "lead") ok = j.role === "lead" && good && tierIdx(j.tier) >= tierIdx(p.tier);
        else if (w.t === "great") ok = j.dir === p.dir && ctx.res === "great";
        else if (w.t === "try") ok = j.dir === p.dir && ctx.res !== "fail";
        else if (w.t === "star5") ok = ctx.stars >= 5 && !!j.isWork;
        else if (w.t === "duo") ok = ctx.ids.indexOf(p.partner) >= 0;
      } else if (kind === "day") {
        if (w.t === "fame") ok = a.fame >= p.n;
        else if (w.t === "trophy") ok = a.trophies.length > (p.base || 0);
        else if (w.t === "rest") ok = !!(a.task && a.task.kind === "rest" && a.task.days >= 4 && a.task.left <= 1);
        else if (w.t === "course") ok = w.prog >= p.n;
      } else if (kind === "chart") ok = w.t === "chart" && ctx.inChart;
      else if (kind === "fanmeet") ok = w.t === "fanmeet";
      if (ok) doneWish(st, a, w);
    });
  }
  function wishDaily(st, a) {
    // 對象離開公司的「想和某人合作」直接取消（不算失敗）
    a.wishes = a.wishes.filter(function (w) { return w.t !== "duo" || !!I.artistById(st, w.p.partner); });
    wishCheck(st, a, "day");
    a.wishes.slice().forEach(function (w) {
      if (st.day < w.until) return;
      a.wishes.splice(a.wishes.indexOf(w), 1);
      a.satisfaction = I.clamp(a.satisfaction + B.wishFailSat, 0, 100);
      a.mood = I.clamp(a.mood - 1, -2, 2);
      I.log(st, "plus_wish_fail", { aid: a.id, wish: w.t, p: w.p });
    });
    if (a.wishes.length < B.wishMax && st.day >= a.wishNext) {
      genWish(st, a);
      a.wishNext = st.day + I.rint(st, B.wishGap[0], B.wishGap[1]);
    }
  }

  // ==== 2. 季度目標 ====
  function totalCore(st) { var s = 0; st.artists.forEach(function (a) { s += a.core || 0; }); return s; }
  function goalTarget(st, id) {
    var lv = st.company.level;
    if (id === "hot") return 2 + Math.floor(lv / 3);
    if (id === "great") return 1 + Math.floor(lv / 2);
    if (id === "earn") return Math.max(30000 * lv, Math.round(st.plus.lastSeasonPay * 1.15 / 1000) * 1000);
    if (id === "chart") return Math.min(3, 1 + Math.floor(lv / 4));
    if (id === "tierA") return 1 + Math.floor(Math.max(0, lv - 4) / 3);
    if (id === "wishes") return 1 + Math.floor(lv / 4);
    if (id === "core") return Math.max(100, Math.round((totalCore(st) * 0.25 + 50 * lv) / 10) * 10);
    if (id === "rookie") return 200 + 150 * lv;
    return 1;
  }
  function newGoals(st) {
    var lv = st.company.level, w = {};
    X.GOALS.forEach(function (g) {
      if (g.minLv > lv) return;
      if (g.id === "rookie" && !st.artists.some(function (a) { return st.day - a.joinedDay <= D.BAL.daysPerYear; })) return;
      w[g.id] = 1;
    });
    var list = [];
    while (list.length < B.goalCount && Object.keys(w).length) {
      var id = I.wpick(st, w);
      delete w[id];
      var g = { t: id, n: goalTarget(st, id), prog: X.GOAL_BY_ID[id].keep ? 1 : 0, done: false, failed: false };
      if (id === "core") g.base = totalCore(st);
      list.push(g);
    }
    st.plus.goals = { season: Math.floor(st.day / D.BAL.seasonDays), list: list, all: false };
  }
  function goalReward(st, g) {
    var lv = st.company.level;
    g.done = true;
    st.company.tickets += B.goalTickets;
    st.company.money += B.goalMoneyPerLv * lv;
    I.addRep(st, B.goalRepPerLv * lv);
    st.plus.stats.goals++;
    I.log(st, "plus_goal_done", { goal: g.t, n: g.n, tickets: B.goalTickets, money: B.goalMoneyPerLv * lv });
    var G = st.plus.goals;
    if (!G.all && G.list.every(function (x) { return x.done; })) {
      G.all = true;
      st.company.tickets += B.goalAllTickets;
      I.addRep(st, B.goalAllRepPerLv * lv);
      st.plus.stats.goalsAll++;
      I.log(st, "plus_goal_all", { tickets: B.goalAllTickets });
    }
  }
  function goalOf(st, id) {
    var G = st.plus && st.plus.goals;
    if (!G) return null;
    for (var i = 0; i < G.list.length; i++) if (G.list[i].t === id && !G.list[i].done && !G.list[i].failed) return G.list[i];
    return null;
  }
  function goalAdd(st, id, v) { var g = goalOf(st, id); if (!g) return; g.prog += v; if (g.prog >= g.n) goalReward(st, g); }
  function goalSet(st, id, v) { var g = goalOf(st, id); if (!g) return; g.prog = Math.max(g.prog, v); if (g.prog >= g.n) goalReward(st, g); }
  function goalFail(st, id) { var g = goalOf(st, id); if (g) { g.failed = true; g.prog = 0; } }
  function seasonEnd(st) {
    var G = st.plus.goals;
    if (G) {
      G.list.forEach(function (g) { if (X.GOAL_BY_ID[g.t] && X.GOAL_BY_ID[g.t].keep && !g.done && !g.failed) goalReward(st, g); });
      st.plus.goalHist.unshift({ season: G.season, done: G.list.filter(function (g) { return g.done; }).length, n: G.list.length });
      if (st.plus.goalHist.length > 8) st.plus.goalHist.length = 8;
    }
    st.plus.lastSeasonPay = st.plus.seasonPay;
    st.plus.seasonPay = 0;
    newGoals(st);
  }

  // ==== 3. 臨場決策 ====
  function clutchOpen(aj, k) {
    if (!aj.clutch || aj.clutch.p[k] != null) return false;
    var elapsed = aj.job.days - aj.left;
    return elapsed >= Math.floor(aj.job.days * k / B.clutchRounds);
  }
  function clutchPending(st) {
    var out = [];
    st.activeJobs.forEach(function (aj) {
      if (!aj.clutch) return;
      for (var k = 0; k < B.clutchRounds; k++) if (clutchOpen(aj, k)) { out.push({ aj: aj, k: k }); break; }
    });
    return out;
  }
  function pickClutch(st, ajId, k, strat) {
    var aj = null;
    st.activeJobs.forEach(function (x) { if (x.id === ajId) aj = x; });
    if (!aj || !aj.clutch) return { err: "noJob" };
    if (!X.STRATS[strat]) return { err: "choice" };
    if (!clutchOpen(aj, k)) return { err: "busy" };
    var sit = X.SITS[aj.clutch.s[k]], q = strat === sit.best ? 2 : strat === sit.worst ? 0 : 1;
    var members = aj.members.map(function (id) { return I.artistById(st, id); }).filter(Boolean);
    // 發揮個性：有 SSR 或特質 2 個以上的人在場，結果提升一級
    if (strat === "flair" && members.some(function (a) { return a.rarity === "SSR" || a.traits.length >= 2; })) q = Math.min(2, q + 1);
    var delta = q === 2 ? B.clutchBest : q === 1 ? B.clutchMid : B.clutchWorst;
    if (strat === "rush") members.forEach(function (a) { a.stamina = I.clamp(a.stamina - B.clutchRushStamina, 0, 100); });
    aj.eventMod += delta;
    aj.clutch.p[k] = strat;
    aj.clutch.q[k] = q;
    st.plus.stats.clutch++;
    I.log(st, "plus_clutch", { aids: aj.members.slice(), q: q, sit: sit.id, strat: strat });
    return { q: q, delta: delta };
  }

  // ==== 4. 粉絲 ====
  function antiCut(st) { return 1 - st.facilities.pr * B.antiPrCut; }
  function addAnti(st, a, v) { a.anti = I.clamp(Math.round((a.anti + (v > 0 ? v * antiCut(st) : v)) * 10) / 10, 0, 100); }
  function addCore(a, v) { a.core = Math.max(0, Math.min(ri(Math.max(a.fame, 0) * B.coreMax), ri(a.core + v))); }
  function fanCost(st, kind) { var F = X.FAN_TASKS[kind]; return F.cost + F.costPerLv * st.company.level; }
  function fanFinish(st, a, t) {
    if (t.kind === "fanmeet") {
      var n = ri(a.fame * 0.04 + 20 + a.stats.charm / 10);
      a.core += n; addCore(a, 0);
      addAnti(st, a, -8);
      a.satisfaction = I.clamp(a.satisfaction + 3, 0, 100);
      I.log(st, "plus_fanmeet", { aid: a.id, n: n });
      wishCheck(st, a, "fanmeet");
    } else if (t.kind === "fanlive") {
      var c = ri(a.fame * 0.01 + 5), f = ri(5 + a.stats.talk / 40);
      a.core += c; a.fame = I.clamp(a.fame + f, 0, 99999); addCore(a, 0);
      I.log(st, "plus_fanlive", { aid: a.id, n: c, fame: f });
    } else if (t.kind === "merch") {
      var m = ri((a.core * 4 + a.fame * 0.3) / 100) * 100;
      st.company.money += m;
      if (a.core < a.fame * 0.1) addAnti(st, a, 3);
      I.log(st, "plus_merch", { aid: a.id, money: m });
    }
  }

  // ==== 6. 作品 IP ====
  function ipById(st, id) { for (var i = 0; i < st.plus.ips.length; i++) if (st.plus.ips[i].id === id) return st.plus.ips[i]; return null; }
  function onBoardOrActive(st, jobId) {
    if (st.board.some(function (j) { return j.id === jobId; })) return true;
    if (st.activeJobs.some(function (aj) { return aj.job.id === jobId; })) return true;
    return st.auditions.some(function (au) { return au.job.id === jobId; });
  }
  function offerSequel(st, ip) {
    var dir = ip.dir, adapt = false, lv = st.company.level;
    var opts = (X.ADAPT[ip.titleDir] || []).filter(function (d) { return !!I.dirById(d); });
    if (opts.length && I.rnd(st) < B.adaptChance) { dir = I.pick(st, opts); adapt = true; }
    var ti = tierIdx(ip.tier) + (ip.stars >= 5 ? 1 : 0);
    while (ti > 0 && D.TIERS[TIERS[ti]].unlock > lv) ti--;
    var job = I.genJob(st, { dir: dir, tier: TIERS[Math.min(ti, TIERS.length - 1)] });
    job.title = ip.title.slice(); job.titleDir = ip.titleDir; job.seq = ip.seq + 1; job.ip = ip.id; job.adapt = adapt;
    job.pay = Math.round(job.pay * B.ipPay / 100) * 100; job.fame = ri(job.fame * B.ipFame); job.isWork = true;
    if (job.slots > 1 && !job.audition) { job.slots = 1; job.role = "lead"; }
    st.board.push(job);
    ip.offered = job.id;
    I.log(st, "plus_ip_offer", { dir: job.dir, titleDir: job.titleDir, title: job.title, seq: job.seq, adapt: adapt });
  }
  function ipJobDone(st, aj, r) {
    var job = aj.job, P = st.plus;
    if (job.ip) {
      var ip = ipById(st, job.ip);
      if (!ip) return;
      ip.seq = job.seq; ip.day = st.day; ip.offered = null;
      ip.stars = Math.round((ip.stars + r.stars) / 2 * 10) / 10;
      if (r.res === "fail" || r.stars <= 2) { ip.dead = true; I.log(st, "plus_ip_end", { dir: ip.dir, titleDir: ip.titleDir, title: ip.title }); }
      else if (ip.seq >= B.ipFinal) { ip.final = true; I.addRep(st, B.ipFinalRep); I.log(st, "plus_ip_final", { dir: ip.dir, titleDir: ip.titleDir, title: ip.title, seq: ip.seq }); }
      return;
    }
    if (!job.isWork || job.project || tierIdx(job.tier) < tierIdx(B.ipMinTier) || r.stars < 4 || r.res === "fail") return;
    if (I.rnd(st) >= (r.stars >= 5 ? B.ipChance5 : B.ipChance4)) return;
    var nip = { id: I.newId(st, "ip"), dir: job.dir, titleDir: job.titleDir || job.dir, title: job.title.slice(), tier: job.tier, cast: aj.members.slice(), seq: 1, stars: r.stars, day: st.day, born: st.day, offered: null, dead: false, final: false };
    P.ips.push(nip);
    P.stats.ips++;
    var alive = P.ips.filter(function (x) { return !x.dead && !x.final; });
    if (P.ips.length > B.ipMax) P.ips.splice(P.ips.indexOf(P.ips.filter(function (x) { return x.dead || x.final; })[0] || alive[0]), 1);
    I.log(st, "plus_ip_new", { aids: aj.members.slice(), dir: nip.dir, titleDir: nip.titleDir, title: nip.title });
  }

  // ==== 掛鉤 ====
  Core.hook("create", function (st) { ensure(st); });
  Core.hook("migrate", function (st) { ensure(st); });

  Core.hook("schedule", function (st, a, spec) {
    var F = X.FAN_TASKS[spec.kind];
    if (!F) return undefined;
    var cost = fanCost(st, spec.kind);
    if (st.company.money < cost) return "money";
    st.company.money -= cost;
    return { kind: spec.kind, days: F.days, left: F.days, stamina: F.stamina, stress: F.stress };
  });
  Core.hook("finishTask", function (st, a, t) { ensureArtist(st, a); fanFinish(st, a, t); });

  Core.hook("jobStart", function (st, aj) {
    var job = aj.job;
    if (job.project || B.clutchTiers.indexOf(job.tier) < 0) return;
    var idx = [];
    while (idx.length < B.clutchRounds) { var k = I.rint(st, 0, X.SITS.length - 1); if (idx.indexOf(k) < 0) idx.push(k); }
    aj.clutch = { s: idx, p: [null, null, null], q: [null, null, null] };
  });

  Core.hook("teamPerf", function (st, members, job) {
    if (!st.plus) return 1;
    var m = 1, ids = members.map(function (a) { return a.id; });
    if (ids.length >= 2) {
      var b = avgBond(st, ids);
      if (job.duel && b <= B.bondRival) m *= B.duelBonus;
      else m *= 1 + I.clamp(b / 100, -1, 1) * B.bondPerfMax;
    }
    if (job.ip) {
      var ip = ipById(st, job.ip);
      if (ip) {
        var inCast = ids.filter(function (id) { return ip.cast.indexOf(id) >= 0; }).length / ids.length;
        m *= 1 + B.ipCastBonus * inCast - (inCast === 0 ? B.ipRecastPenalty : 0);
      }
    }
    return m;
  });

  Core.hook("jobDone", function (st, aj, r) {
    ensure(st);
    var job = aj.job, ids = aj.members.slice(), good = r.res === "great" || r.res === "success";
    st.plus.seasonPay += r.pay;
    // 作品紀錄補上改編／續集資訊（藝人作品列表的標題才會正確）
    if (job.titleDir || job.seq) r.members.forEach(function (a) { if (a.works[0] && a.works[0].day === st.day) { a.works[0].titleDir = job.titleDir || null; a.works[0].seq = job.seq || 0; } });
    r.members.forEach(function (a) {
      ensureArtist(st, a);
      if (good) addCore(a, job.fame * D.RESULTS[r.res].fame * B.coreFromJob * (r.res === "great" ? 1.5 : 1));
      if (r.res === "fail" && tierIdx(job.tier) >= 2) addAnti(st, a, B.antiFailJob);
      wishCheck(st, a, "job", { job: job, res: r.res, stars: r.stars, ids: ids });
    });
    if (r.res === "great") pairs(ids, function (x, y) { addBond(st, x, y, B.bondGreat); });
    else if (r.res === "success") pairs(ids, function (x, y) { addBond(st, x, y, B.bondSuccess); });
    else if (r.res === "fail") pairs(ids, function (x, y) { addBond(st, x, y, B.bondFail); });
    // 季度目標
    if (good && Core.trendMult(st, job.dir) > 1) goalAdd(st, "hot", 1);
    if (r.res === "great") goalAdd(st, "great", 1);
    goalAdd(st, "earn", r.pay);
    if (good && tierIdx(job.tier) >= 3) goalAdd(st, "tierA", 1);
    if (good && job.role === "lead" && tierIdx(job.tier) >= 2 && r.members.some(function (a) { return a.rarity === "R"; })) goalAdd(st, "rlead", 1);
    ipJobDone(st, aj, r);
  });

  Core.hook("fameDecay", function (st, a) {
    if (!a.core || a.fame <= 0) return 1;
    return 1 - Math.min(B.coreDecayShieldMax, a.core / a.fame * B.coreDecayShield);
  });
  Core.hook("eventBad", function (st, e) {
    var a = e.aid ? I.artistById(st, e.aid) : null;
    return a && a.anti ? 1 + a.anti / B.antiBadMultDiv : 1;
  });

  Core.hook("fx", function (st, e, fx, out, a) {
    ensure(st);
    if (a) {
      ensureArtist(st, a);
      if (fx.anti) { var a0 = a.anti; addAnti(st, a, fx.anti); if (a.anti !== a0) out.anti = Math.round((a.anti - a0) * 10) / 10; }
      if (fx.core) { var c0 = a.core; a.core += ri(a.fame * fx.core); addCore(a, 0); if (a.core !== c0) out.core = a.core - c0; }
    }
    var partner = e.ctx && e.ctx.partner ? I.artistById(st, e.ctx.partner) : null;
    if (partner && fx.partner) {
      ["stress", "satisfaction"].forEach(function (k) { if (fx.partner[k]) partner[k] = I.clamp(partner[k] + fx.partner[k], 0, 100); });
      if (fx.partner.mood) partner.mood = I.clamp(partner.mood + fx.partner.mood, -2, 2);
      out.partner = fx.partner;
    }
    if (partner && a && fx.bond) { addBond(st, a.id, partner.id, fx.bond); out.bond = fx.bond; }
    if (fx.chain) {
      st.plus.chain.push({ id: fx.chain, aid: e.aid || null, ctx: I.clone(e.ctx || {}), day: st.day + (fx.chainDays || B.chainDays) });
      out.chain = true;
    }
  });

  Core.hook("season", function (st) { ensure(st); seasonEnd(st); });

  Core.hook("month", function (st) {
    ensure(st);
    var P = st.plus, alive = {}, fee = 0, inChart = {};
    st.artists.forEach(function (a) { alive[a.id] = a; ensureArtist(st, a); });
    // 粉絲：核心粉自然流失、上限＝人氣 × 0.6；黑粉逐月淡化；會員收入
    st.artists.forEach(function (a) {
      a.core = ri(a.core * (1 - B.coreDecay)); addCore(a, 0);
      a.anti = Math.max(0, Math.round((a.anti * B.antiDecay - st.facilities.pr) * 10) / 10);
      fee += a.core * B.clubFeePerCore;
    });
    fee = ri(fee / 100) * 100;
    if (fee > 0) { st.company.money += fee; I.log(st, "plus_club_fee", { money: fee }); }
    // 排行榜：心願與季度目標
    if (st.charts && st.charts.lists) Object.keys(st.charts.lists).forEach(function (c) {
      st.charts.lists[c].forEach(function (e) { if (e.kind === "artist") inChart[e.aid] = true; });
    });
    st.artists.forEach(function (a) { wishCheck(st, a, "chart", { inChart: !!inChart[a.id] }); });
    goalSet(st, "chart", Object.keys(inChart).filter(function (id) { return alive[id]; }).length);
    // 心願放太久：滿意度慢慢下降
    st.artists.forEach(function (a) { a.wishes.forEach(function (w) { if (st.day - w.since >= B.wishLongDays) a.satisfaction = I.clamp(a.satisfaction + B.wishLongSat, 0, 100); }); });
    // 關係：清掉已離開的人；同方向競爭、同期入社
    // 關係會隨時間淡化（每月 8%），要常常一起行動才維持得住
    Object.keys(P.bonds).forEach(function (k) {
      var p = k.split("|");
      if (!alive[p[0]] || !alive[p[1]]) { delete P.bonds[k]; return; }
      var v = Math.round(P.bonds[k] * (1 - B.bondDecay) * 10) / 10;
      if (Math.abs(v) < 0.5) delete P.bonds[k]; else P.bonds[k] = v;
    });
    var list = st.artists;
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var x = list[i], y = list[j];
      if (x.dir === y.dir && x.fame >= 100 && y.fame >= 100) {
        var r = x.fame / y.fame;
        if (r >= 0.67 && r <= 1.5) addBond(st, x.id, y.id, B.bondCompete);
      }
      if (Math.abs(x.joinedDay - y.joinedDay) <= 30 && st.day - Math.max(x.joinedDay, y.joinedDay) <= D.BAL.daysPerYear) addBond(st, x.id, y.id, B.bondCohort);
    }
    // 好友分擔壓力、對手增加壓力；好友之間的前輩指導
    var friendPairs = [], rivalPairs = [];
    Object.keys(P.bonds).forEach(function (k) {
      var v = P.bonds[k], p = k.split("|");
      if (v >= B.bondFriend) friendPairs.push([alive[p[0]], alive[p[1]], v]);
      else if (v <= B.bondRival) rivalPairs.push([alive[p[0]], alive[p[1]], v]);
    });
    var fc = {}, rc = {};
    friendPairs.forEach(function (q) { fc[q[0].id] = (fc[q[0].id] || 0) + 1; fc[q[1].id] = (fc[q[1].id] || 0) + 1; });
    rivalPairs.forEach(function (q) { rc[q[0].id] = (rc[q[0].id] || 0) + 1; rc[q[1].id] = (rc[q[1].id] || 0) + 1; });
    st.artists.forEach(function (a) {
      if (fc[a.id]) a.stress = I.clamp(a.stress - Math.min(B.friendStressMax, fc[a.id] * B.friendStress), 0, 100);
      if (rc[a.id]) { a.stress = I.clamp(a.stress + Math.min(B.rivalStressMax, rc[a.id] * B.rivalStress), 0, 100); a.satisfaction = I.clamp(a.satisfaction - rc[a.id], 0, 100); }
    });
    function power(a) { var s = 0; D.STATS.forEach(function (k) { s += a.stats[k]; }); return s; }
    friendPairs.forEach(function (q) {
      if (q[2] < 50) return;
      var sen = power(q[0]) >= power(q[1]) ? q[0] : q[1], jun = sen === q[0] ? q[1] : q[0];
      if (power(sen) < power(jun) * B.mentorRatio || I.rnd(st) >= B.mentorChance) return;
      var stat = I.topStat(jun.dir), g = I.growStat(st, jun, stat, B.mentorGain, "course");
      if (g > 0) I.log(st, "plus_mentor", { aids: [sen.id, jun.id], stat: stat, gain: Math.round(g * 10) / 10 });
    });
    if (rivalPairs.length && I.rnd(st) < B.bondEventRival) { var rp = I.pick(st, rivalPairs); I.pushEvent(st, "bond_clash", rp[0].id, { partner: rp[1].id }); }
    if (friendPairs.length && I.rnd(st) < B.bondEventFriend) { var fp = I.pick(st, friendPairs); I.pushEvent(st, "bond_support", fp[0].id, { partner: fp[1].id }); }
  });

  Core.hook("day", function (st) {
    var P = ensure(st);
    // 日誌掃描：上課次數、宣傳太頻繁、醜聞壞結果
    st.log.forEach(function (e) {
      if (e.seq <= P.logSeen) return;
      var d = e.data || {}, a = d.aid ? I.artistById(st, d.aid) : null;
      if (e.type === "course_done" && a) a.wishes.forEach(function (w) { if (w.t === "course") w.prog++; });
      else if (e.type === "promo_done" && a) {
        if (a.lastPromo != null && st.day - a.lastPromo < B.antiPromoGap) addAnti(st, a, B.antiPromoSpam);
        a.lastPromo = st.day;
      } else if ((e.type === "event_resolved" || e.type === "event_auto") && d.bad) {
        var ev = D.EVENT_BY_ID && D.EVENT_BY_ID[d.ev];
        if (ev && (ev.category === "scandal" || ev.category === "net") && a) addAnti(st, a, B.antiScandal);
        if (ev && ev.category === "scandal") goalFail(st, "clean");
      }
    });
    P.logSeen = st.logSeq;
    // 一起工作的人每天累積一點好感
    st.activeJobs.forEach(function (aj) { if (aj.members.length >= 2) pairs(aj.members, function (x, y) { addBond(st, x, y, B.bondJobDay); }); });
    // 同時在上課／訓練／休息的人，每人每天和其中一位同伴聊天（人越多越分散，不會全公司都變好友）
    var room = {};
    st.artists.forEach(function (a) { var k = a.task && a.task.kind; if (k === "course" || k === "train" || k === "rest") (room[k] || (room[k] = [])).push(a.id); });
    Object.keys(room).forEach(function (k) {
      var ids = room[k];
      if (ids.length < 2) return;
      // 對象依現有好感加權：越熟越常聊，好友會集中在特定幾組，而不是大家都差不多
      ids.forEach(function (id) {
        var w = {};
        ids.forEach(function (o) { if (o !== id) w[o] = 1 + Math.max(0, bond(st, id, o)) / 8; });
        addBond(st, id, I.wpick(st, w), B.bondChat);
      });
    });
    // 心願
    st.artists.forEach(function (a) { ensureArtist(st, a); wishDaily(st, a); });
    // 季度目標：新人人氣、核心粉增加量
    var rookieMax = 0;
    st.artists.forEach(function (a) { if (st.day - a.joinedDay <= D.BAL.daysPerYear) rookieMax = Math.max(rookieMax, a.fame); });
    goalSet(st, "rookie", rookieMax);
    var cg = goalOf(st, "core");
    if (cg) goalSet(st, "core", totalCore(st) - (cg.base || 0));
    // 醜聞連鎖：到期的下一段事件
    var due = P.chain.filter(function (c) { return c.day <= st.day; });
    P.chain = P.chain.filter(function (c) { return c.day > st.day; });
    due.forEach(function (c) { if (!c.aid || I.artistById(st, c.aid)) I.pushEvent(st, c.id, c.aid, c.ctx); });
    // 作品 IP：續集工作
    P.ips.forEach(function (ip) {
      if (ip.dead || ip.final) return;
      if (ip.offered) { if (!onBoardOrActive(st, ip.offered)) { ip.offered = null; ip.day = st.day; } return; }
      if (st.day - ip.day >= B.ipWait && I.rnd(st) < B.ipOfferChance) offerSequel(st, ip);
    });
    // 看板剛刷新：互為對手的兩人可能收到「對決」工作
    if (P.lastRefresh !== st.boardRefreshDay) {
      P.lastRefresh = st.boardRefreshDay;
      var rivals = [];
      Object.keys(P.bonds).forEach(function (k) {
        if (P.bonds[k] > B.bondRival) return;
        var p = k.split("|"), x = I.artistById(st, p[0]), y = I.artistById(st, p[1]);
        if (x && y) rivals.push([x, y]);
      });
      if (rivals.length && I.rnd(st) < B.duelChance && !st.board.some(function (j) { return j.duel; })) {
        var q = I.pick(st, rivals), lead = q[0].fame >= q[1].fame ? q[0] : q[1];
        var job = I.genJob(st, { dir: lead.dir, tier: I.tierUp(st, lead) });
        job.slots = 2; job.role = "lead"; job.pair = [q[0].id, q[1].id]; job.duel = true; job.audition = false; job.interest = null;
        job.minFame = 0; job.minProf = 1; job.isWork = true;
        job.pay = Math.round(job.pay * 1.4 / 100) * 100;
        st.board.push(job);
        I.log(st, "plus_duel", { aids: job.pair.slice() });
      }
    }
  });

  root.PriTestStarvPlus = {
    ensure: ensure, bond: bond, bondsOf: bondsOf, avgBond: avgBond, pickClutch: pickClutch, clutchPending: clutchPending, clutchOpen: clutchOpen,
    fanCost: fanCost, ipById: ipById, goalTarget: goalTarget, _genWish: genWish, _addBond: addBond, _newGoals: newGoals
  };
})();
