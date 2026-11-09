// 深夜居酒屋（izakaya）：規則與狀態。狀態 s 是可 JSON 化的單一物件；所有操作經由 applyIntent(s, pid, intent)。
// 單機＝自己當房主；連線＝房主套用意圖並廣播 s（izakaya_net.js）。畫面只讀 s，不直接改。
// 2026-11-09 依使用者需求新增。設計：docs/superpowers/specs/2026-11-09-izakaya-design.md
(function () {
  "use strict";
  var D = window.PriTestIzakayaData;
  function Cast() { return window.PriTestIzakayaCast; }
  function Story() { return window.PriTestIzakayaStory; }
  function Rush() { return window.PriTestIzakayaRush; }

  // ---------------- 亂數（mulberry32；狀態存在 s.rs，跟著存檔走）----------------
  function rnd(s) {
    s.rs = (s.rs + 0x6D2B79F5) >>> 0;
    var t = s.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(s, n) { return Math.floor(rnd(s) * n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------------- 日曆（每 6 營業日接 1 天公休；dow 5、6＝週五、週六尖峰）----------------
  function seasonOf(day) { return day <= 8 ? 0 : day <= 15 ? 1 : day <= 23 ? 2 : 3; }
  function dowOf(day) { return ((day - 1) % D.WEEK) + 1; }
  function isRushDay(day) { var w = dowOf(day); return w === 5 || w === 6; }

  // ---------------- 分工 ----------------
  // 依加入順序：想要的職位還沒人拿就給他；剩下的職位輪流補給目前職位最少的人
  function assignRoles(players) {
    var out = {}, taken = {};
    players.forEach(function (p) { out[p.pid] = []; });
    players.forEach(function (p) { if (p.want && D.ROLES[p.want] && !taken[p.want]) { taken[p.want] = 1; out[p.pid].push(p.want); } });
    D.ROLE_ORDER.forEach(function (r) {
      if (taken[r] || !players.length) return;
      var best = players.slice().sort(function (a, b) { return out[a.pid].length - out[b.pid].length; })[0];
      out[best.pid].push(r); taken[r] = 1;
    });
    return out;
  }
  function isAway(s, pid) { return !!(s.away && s.away[pid]); }
  function activeLead(s) { var l = s.order.filter(function (p) { return !isAway(s, p); })[0]; return l || s.order[0]; }
  // 斷線代班（2026-11-09）：負責這個職位的人全部暫離時，由第一位在線的玩家代理
  function hasRole(s, pid, role) {
    if (s.roles[pid] && s.roles[pid].indexOf(role) >= 0) return true;
    if (pid !== activeLead(s)) return false;
    return s.order.every(function (p) { return !(s.roles[p] && s.roles[p].indexOf(role) >= 0) || isAway(s, p); });
  }

  // ---------------- 新局 ----------------
  function newGame(o) {
    var seed = (o.seed >>> 0) || 1;
    var s = {
      v: 1, seed: seed, rs: seed, day: 1, phase: "market",
      cash: D.START_CASH, rep: 0, star: 1, maxStar: 1,
      fridge: {}, mk: {}, board: [], prepped: {}, known: {}, sig: null,
      photos: {}, pool: [], notes: {}, night: null, today: null, log: [], refer: [], creations: {}, atelier: {},
      offers: [], resvNext: [], resvToday: [], haggled: {}, banquet: null, away: {},
      players: {}, order: [], roles: {}, ready: {},
      story: { seen: {}, flags: {}, arcs: {}, links: {}, cur: null, queue: [] },
      rel: {}, date: {}, staff: { crew: [], met: {} }, rush: null, end: null,
      legacy: JSON.parse(JSON.stringify(o.legacy || emptyLegacy()))
    };
    (o.players || []).forEach(function (p) {
      s.players[p.pid] = { name: String(p.name || "").slice(0, 16), want: p.want || "", aff: {}, dates: 0 };
      s.order.push(p.pid);
    });
    s.roles = assignRoles(o.players || []);
    Object.keys(D.DISHES).forEach(function (k) { if (D.DISHES[k].unlock === "start") s.known[k] = 1; });
    var ph = Cast().assignPhotos(function () { return rnd(s); });   // 每局輪換照片（依種子，存進 s，讀檔不變）
    s.photos = ph.photos;
    s.pool = Cast().genPool(function () { return rnd(s); }, 60, ph.rest);
    startMarket(s);
    return s;
  }

  // ---------------- 市場與冰箱 ----------------
  function startMarket(s) {
    s.phase = "market";
    var se = seasonOf(s.day);
    Object.keys(D.INGS).forEach(function (k) {
      var g = D.INGS[k], f = g.season === se ? 0.7 : g.season >= 0 ? 1.15 : 1;
      s.mk[k] = Math.max(10, Math.round(g.price * f * (0.85 + rnd(s) * 0.3) / 10) * 10);
    });
    Object.keys(s.fridge).forEach(function (k) {
      s.fridge[k] = s.fridge[k].filter(function (exp) { return exp >= s.day; });
      if (!s.fridge[k].length) delete s.fridge[k];
    });
    s.ready = {};
    // 殺價（一天每種一次）、明日預約（★2）：昨天接的預約變成今晚的客人
    s.haggled = {};
    s.resvToday = s.resvNext || [];
    s.resvNext = [];
    s.offers = [];
    if (s.maxStar >= 2 && s.pool && s.pool.length) {
      var no = 1 + rint(s, 2);
      for (var o = 0; o < no; o++) {
        var gp = s.pool[rint(s, s.pool.length)];
        s.offers.push({ id: "o" + s.day + "_" + o, gid: gp.id, n: 3 + rint(s, 4), want: D.DIMS[rint(s, 5)], bonus: 2000 + rint(s, 5) * 500 });
      }
    }
  }
  function haggle(s, id) {
    if (!D.INGS[id] || s.haggled[id]) return { ok: false };
    s.haggled[id] = 1;
    var cut = rnd(s) < 0.6;
    s.mk[id] = cut ? Math.max(10, Math.round(s.mk[id] * 0.8 / 10) * 10) : Math.round(s.mk[id] * 1.1 / 10) * 10;
    return { ok: true, cut: cut };
  }
  function acceptResv(s, oid) {
    var o = (s.offers || []).filter(function (x) { return x.id === oid; })[0];
    if (!o || s.resvNext.some(function (x) { return x.id === oid; }) || s.resvNext.length >= 2) return false;
    s.resvNext.push(o);
    return true;
  }
  // 季節宴席（★5）：外場在準備階段選 3 道
  function setBanquet(s, ids) {
    if (s.maxStar < 5 || !Array.isArray(ids) || ids.length !== 3) return false;
    if (!ids.every(function (k) { return s.known[k] && D.DISHES[k] && D.DISHES[k].cat !== "drink"; })) return false;
    s.banquet = ids.slice();
    return true;
  }
  function fridgeCap(s) { return s.maxStar >= 2 ? D.FRIDGE_CAP_STAR2 : D.FRIDGE_CAP; }
  function fridgeCount(s) { var n = 0; Object.keys(s.fridge).forEach(function (k) { n += s.fridge[k].length; }); return n; }
  function stock(s, id) { return s.fridge[id] ? s.fridge[id].length : 0; }
  function buy(s, id, n) {
    n = n | 0;
    if (!D.INGS[id] || n <= 0 || !s.mk[id]) return false;
    var cost = s.mk[id] * n;
    if (cost > s.cash || fridgeCount(s) + n > fridgeCap(s)) return false;
    s.cash -= cost;
    var list = s.fridge[id] || (s.fridge[id] = []);
    for (var i = 0; i < n; i++) list.push(s.day + D.INGS[id].fresh);
    list.sort(function (a, b) { return a - b; });
    return true;
  }
  // 一鍵備料（2026-11-10）：依今晚預估的出菜數（一般組＋常客＋尖峰）算出黑板上每道菜要用的食材，扣掉冰箱與備料後的缺額。
  // 黑板還沒排（第 1 天）就用已會做的菜。回傳 { 食材: 份數 }，實際買多少再受冰箱容量與現金限制。
  function stockPlan(s) {
    var known = Object.keys(s.known).filter(function (k) { return D.DISHES[k] && !D.DISHES[k].creative; });
    var ids = (s.board.length ? s.board : known).filter(function (k) { return D.DISHES[k] && !D.DISHES[k].creative; });
    var foods = ids.filter(function (k) { return D.DISHES[k].cat !== "drink"; }).slice(0, D.BOARD_MAX);
    var drinks = ids.filter(function (k) { return D.DISHES[k].cat === "drink"; }).slice(0, 4);
    var serv = D.BASE_GROUPS + s.maxStar * 2 + 3 + (isRushDay(s.day) ? 14 : 0), need = {};
    function add(list, total) {
      if (!list.length) return;
      var each = Math.ceil(total / list.length);
      list.forEach(function (k) {
        var d = D.DISHES[k], left = Math.max(0, each - (s.prepped[k] || 0)), sets = d.prep ? Math.ceil(left / D.PREP_PORTIONS) : left;
        Object.keys(d.ing).forEach(function (i) { if (D.INGS[i]) need[i] = (need[i] || 0) + d.ing[i] * sets; });
      });
    }
    add(foods, serv); add(drinks, Math.ceil(serv * 0.85));
    var out = {};
    Object.keys(need).forEach(function (k) { var n = need[k] - stock(s, k); if (n > 0) out[k] = n; });
    return out;
  }
  // 依 stockPlan 實際採買：先買缺最多的，冰箱滿或錢不夠就停
  function autoStock(s) {
    var plan = stockPlan(s), bought = 0;
    Object.keys(plan).sort(function (a, b) { return plan[b] - plan[a]; }).forEach(function (k) {
      for (var i = 0; i < plan[k]; i++) { if (!buy(s, k, 1)) break; bought++; }
    });
    return bought;
  }
  function hasIngs(s, ing) { return Object.keys(ing).every(function (k) { return stock(s, k) >= ing[k]; }); }
  // 做這道菜還缺哪些食材（{ 食材: 份數 }；有備料就不缺）
  function shortOf(s, id) {
    var d = D.DISHES[id], out = {};
    if (!d || (s.prepped[id] || 0) > 0) return out;
    Object.keys(d.ing).forEach(function (k) { var n = d.ing[k] - stock(s, k); if (n > 0) out[k] = n; });
    return out;
  }
  function restockCost(s, id) { return Math.round((s.mk[id] || 0) * D.RESTOCK_MULT); }
  function shortCost(s, id) {
    var sh = shortOf(s, id), c = 0;
    Object.keys(sh).forEach(function (k) { c += restockCost(s, k) * sh[k]; });
    return c;
  }
  // 臨時加碼（2026-11-10 使用者回報「食材一沒有就只能 pass」）：缺的食材以 1.3 倍價直接買來做這一份。
  // 創作料理（__create）等市場買不到的就不行。
  function canBuyShort(s, id) {
    var sh = shortOf(s, id), ks = Object.keys(sh);
    return ks.length > 0 && ks.every(function (k) { return D.INGS[k] && s.mk[k]; }) && shortCost(s, id) <= s.cash;
  }
  function buyShort(s, id) {
    if (!canBuyShort(s, id)) return false;
    var sh = shortOf(s, id);
    Object.keys(sh).forEach(function (k) { restock(s, k, sh[k]); });
    return hasIngs(s, D.DISHES[id].ing);
  }
  function useIngs(s, ing) {
    if (!hasIngs(s, ing)) return false;
    Object.keys(ing).forEach(function (k) { s.fridge[k].splice(0, ing[k]); if (!s.fridge[k].length) delete s.fridge[k]; });
    return true;
  }
  function canMake(s, id) { return (s.prepped[id] || 0) > 0 || hasIngs(s, D.DISHES[id].ing); }
  // 出一份：有備料先用備料
  function makeOne(s, id) {
    if ((s.prepped[id] || 0) > 0) { s.prepped[id]--; return true; }
    return useIngs(s, D.DISHES[id].ing);
  }

  // ---------------- 菜單、備料、研發 ----------------
  function setBoard(s, ids) {
    if (!Array.isArray(ids) || ids.length > D.BOARD_MAX) return false;
    if (!ids.every(function (k) { return s.known[k] && D.DISHES[k]; })) return false;
    s.board = ids.slice();
    return true;
  }
  function prep(s, id) {
    var d = D.DISHES[id];
    if (!d || !d.prep || !s.known[id] || !useIngs(s, d.ing)) return false;
    s.prepped[id] = (s.prepped[id] || 0) + D.PREP_PORTIONS;
    return true;
  }
  // 試作：食材集合＋手法對到一道還沒解鎖的菜就解鎖；對不到或已解鎖，食材照樣用掉
  function dev(s, ings, m) {
    if (!Array.isArray(ings) || !ings.length) return { ok: false };
    var need = {};
    ings.forEach(function (k) { need[k] = 1; });
    if (!useIngs(s, need)) return { ok: false, short: true };
    var key = Object.keys(need).sort().join("+") + "@" + m, hit = null;
    Object.keys(D.DISHES).forEach(function (k) {
      var d = D.DISHES[k];
      if (d.cat !== "drink" && Object.keys(d.ing).sort().join("+") + "@" + d.m === key) hit = k;
    });
    if (!hit || s.known[hit]) return { ok: false };
    s.known[hit] = 1;
    s.log.push({ day: s.day, k: "dev", id: hit });
    return { ok: true, id: hit };
  }
  function devDrink(s, id) {
    var d = D.DISHES[id];
    if (!d || d.cat !== "drink" || s.known[id] || !useIngs(s, d.ing)) return false;
    s.known[id] = 1;
    return true;
  }
  // ---------------- 創作料理（規格第 2 期：用武俠合成「世界美食」的配方合成稀有菜）----------------
  // 素材＝基本素材（水火鹽米油，無限）＋冰箱裡有對應的食材＋工坊的半成品。兩種素材查 recipes：
  // 結果是料理／甜點／飲品／夢幻逸品 → 創作料理（解鎖、附 CREATE_PORTIONS 份可直接出菜，再做一次就再多幾份）；
  // 其他 → 半成品收進工坊（之後可以繼續合成）；沒有配方 → 失敗（食材照樣用掉）。
  var CREATE_PORTIONS = 4, gIndex = null;
  function GD() { return window.PriTestGouseiData && window.PriTestGouseiData.food; }
  function gItem(id) {
    if (!GD()) return null;
    if (!gIndex) { gIndex = {}; GD().items.forEach(function (x) { gIndex[x[0]] = x; }); }
    return gIndex[id] || null;
  }
  function gName(id) { var it = gItem(id); return it ? D.C(it[1], it[2]) : D.C(id); }
  function materials(s) {
    var out = [];
    if (!GD()) return out;
    GD().basics.forEach(function (b) { out.push({ id: b, src: "basic", n: 99 }); });
    Object.keys(D.GOUSEI_MAP).forEach(function (k) { var n = stock(s, k); if (n > 0) out.push({ id: D.GOUSEI_MAP[k], src: "ing", ing: k, n: n }); });
    Object.keys(s.atelier || {}).forEach(function (g) { if (s.atelier[g] > 0) out.push({ id: g, src: "atelier", n: s.atelier[g] }); });
    return out;
  }
  function hashStr(str, k) { var h = 2166136261 ^ k; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
  function creationDish(gid) {
    var it = gItem(gid), tier = it[4] || 3, drink = it[3] === "drink";
    return { name: D.C(it[1], it[2]), cat: drink ? "drink" : "creative", m: "create", st: drink ? "bar" : it[3] === "dessert" ? "cold" : "pot",
      ing: { __create: 1 }, f: D.DIMS.map(function (d, i) { return hashStr(gid, i) % 3; }), tags: [], creative: true,
      price: drink ? 300 + tier * 90 : 380 + tier * 140, cook: drink ? 2 : 6, season: -1, unlock: "create", prep: false, gid: gid };
  }
  function registerCreations(s) { Object.keys(s.creations || {}).forEach(function (id) { if (!D.DISHES[id]) D.DISHES[id] = s.creations[id]; }); }
  function create(s, a, b) {
    if (!GD()) return { ok: false };
    var mats = {}, list = materials(s);
    list.forEach(function (m) { mats[m.id] = m; });
    if (!mats[a] || !mats[b] || (a === b && mats[a].src !== "basic" && mats[a].n < 2)) return { ok: false, short: true };
    [a, b].forEach(function (g) {
      var m = mats[g];
      if (m.src === "ing") { var need = {}; need[m.ing] = 1; useIngs(s, need); }
      else if (m.src === "atelier") s.atelier[g]--;
    });
    var res = GD().recipes[[a, b].sort().join("|")], it = res && gItem(res);
    if (!it) return { ok: false, fail: true };
    if (D.CREATE_CATS.indexOf(it[3]) >= 0) {
      var id = "cr_" + res;
      if (!s.creations[id]) s.creations[id] = creationDish(res);
      D.DISHES[id] = s.creations[id];
      var first = !s.known[id];
      s.known[id] = 1;
      s.prepped[id] = (s.prepped[id] || 0) + CREATE_PORTIONS;
      return { ok: true, kind: "dish", id: id, first: first };
    }
    s.atelier[res] = (s.atelier[res] || 0) + 1;
    return { ok: true, kind: "prep", gid: res };
  }
  function photoOf(s, id) {
    if (s.photos[id]) return s.photos[id];
    for (var i = 0; i < s.pool.length; i++) if (s.pool[i].id === id) return s.pool[i].photo;
    return "";
  }

  // ---------------- 營業 ----------------
  function avgAff(s, cid) {
    var n = 0, t = 0;
    s.order.forEach(function (pid) { t += s.players[pid].aff[cid] || 0; n++; });
    return n ? t / n : 0;
  }
  function pickTopics(s, guest) {
    var all = Object.keys(D.TOPICS), out = [];
    if (rnd(s) < 0.5) out.push(guest.topic);
    while (out.length < 3) { var t = all[rint(s, all.length)]; if (out.indexOf(t) < 0) out.push(t); }
    for (var i = out.length - 1; i > 0; i--) { var j = rint(s, i + 1), x = out[i]; out[i] = out[j]; out[j] = x; }
    return out;
  }
  function makeReq(guest) {
    var hi = -1, lo = -1, i;
    for (i = 0; i < 5; i++) {
      if (guest.pref[i] >= 1 && (hi < 0 || guest.pref[i] > guest.pref[hi])) hi = i;
      if (guest.pref[i] <= -1 && (lo < 0 || guest.pref[i] < guest.pref[lo])) lo = i;
    }
    return { want: hi >= 0 ? [D.DIMS[hi]] : [], avoid: lo >= 0 ? [D.DIMS[lo]] : [] };
  }
  function guestOf(s, g) {
    if (g.kind === "reg") return Cast().byId(g.gid);
    for (var i = 0; i < s.pool.length; i++) if (s.pool[i].id === g.gid) return s.pool[i];
    return null;
  }
  function newGroup(s, kind, gid, n) {
    var g = { kind: kind, gid: gid, n: n, sat: 60, step: "talk", topics: [], req: null, food: null, drink: null, bill: 0 };
    g.topics = pickTopics(s, guestOf(s, g));
    return g;
  }
  function openService(s) {
    s.phase = "service";
    var total = D.BASE_GROUPS + s.maxStar * 2, groups = [], used = {};
    // 常客另外加入、不佔一般客的名額（每晚最多 D.REG_PER_NIGHT 組）：劇情進度不受星級影響，難度才能單獨調整
    // （2026-11-09：原本常客佔總組數，提高星級門檻會讓常客來得太少、事件線走不完）
    // 每晚隨機順序判斷常客到店（依名單順序的話，排在後面的常客幾乎搶不到名額）
    var regs = Cast().REGULARS.slice();
    for (var r = regs.length - 1; r > 0; r--) { var q = rint(s, r + 1), x = regs[r]; regs[r] = regs[q]; regs[q] = x; }
    regs.forEach(function (c) {
      if (c.from > s.day || groups.length >= D.REG_PER_NIGHT) return;
      if (c.run && ((s.legacy && s.legacy.runs) || 0) < c.run) return;   // 隱藏常客：第 run+1 年起才出現
      if (rnd(s) < c.freq + avgAff(s, c.id) / 200) { groups.push(newGroup(s, "reg", c.id, 1)); used[c.id] = 1; }
    });
    var refer = s.refer || [], guard = 0, walkTotal = groups.length + total;
    while (groups.length < walkTotal && guard++ < 500) {
      var cand = s.pool[rint(s, s.pool.length)];
      // 口碑擴散：昨天很滿意的客人帶同職業的朋友來
      if (refer.length && rnd(s) < 0.5) {
        var jobs = refer.map(function (id) { var p = s.pool.filter(function (x) { return x.id === id; })[0]; return p ? p.job.zh : ""; });
        var same = s.pool.filter(function (x) { return jobs.indexOf(x.job.zh) >= 0 && !used[x.id]; });
        if (same.length) cand = same[rint(s, same.length)];
      }
      if (used[cand.id]) continue;
      used[cand.id] = 1;
      groups.push(newGroup(s, "walk", cand.id, 1 + rint(s, 3)));
    }
    for (var i = groups.length - 1; i > 0; i--) { var j = rint(s, i + 1), t = groups[i]; groups[i] = groups[j]; groups[j] = t; }
    // ★2：昨天接的預約（玩家自己決定接不接，2026-11-09 取代原本自動的 4 人團體）
    (s.resvToday || []).forEach(function (o) {
      var gr = newGroup(s, "walk", o.gid, o.n); gr.resv = true; gr.bonus = o.bonus; gr.resvWant = o.want; groups.push(gr);
    });
    // ★5：季節宴席（6 人，最後一組）
    if (s.maxStar >= 5 && s.banquet && s.banquet.length === 3) groups.push({ kind: "banquet", gid: s.pool[rint(s, s.pool.length)].id, n: 6, sat: 60, step: "banquet" });
    var rush = isRushDay(s.day), rushAt = -1;
    if (rush) { rushAt = Math.floor(groups.length / 2); groups.splice(rushAt, 0, { kind: "rush", step: "rush", gid: "", n: 0, sat: 0 }); }
    s.night = { groups: groups, i: 0, rush: rush, rushAt: rushAt, rev: 0, satSum: 0, satN: 0, high: [], hints: {}, dirty: 0, incident: null };
    // 突發狀況（採買處理）：約三成的晚上發生一次，落在某一組
    if (rnd(s) < 0.35) s.night.incident = { type: D.INCIDENTS[rint(s, D.INCIDENTS.length)].id, at: rint(s, groups.length), done: false };
    if (s.maxStar >= 5) s.night.groups.forEach(function (g) { if (g.kind === "walk" && rnd(s) < 0.1) g.critic = true; });
    s.refer = [];
    enterGroup(s);
  }
  // 進入目前這一組：常客先看有沒有劇情，有就停在 story 步驟
  function enterGroup(s) {
    var g = curGroup(s);
    if (!g || g.kind === "rush" || g.kind === "banquet") return;
    if (g.kind === "reg" && Story() && Story().eligible) {
      var present = s.night.groups.filter(function (x) { return x.kind === "reg"; }).map(function (x) { return x.gid; });
      var sc = Story().eligible(s, { at: "visit", who: g.gid, present: present });
      // 日常小劇場（批次 D）：沒有主線劇情時，有 D.DAILY_CHANCE 機率從符合條件的小劇場裡隨機抽一段
      if (!sc && rnd(s) < D.DAILY_CHANCE) {
        var pool = Story().all().filter(function (x) { return Story().condOk(s, x, { at: "daily", who: g.gid, present: present }); });
        if (pool.length) sc = pool[rint(s, pool.length)];
      }
      if (sc) { g.step = "story"; Story().begin(s, sc.id, null); }
    }
  }
  function curGroup(s) { return s.night && s.night.i < s.night.groups.length ? s.night.groups[s.night.i] : null; }
  function note(s, gid, c) {
    var n = s.notes[gid] || (s.notes[gid] = { pref: {}, visits: 0 });
    if (c.k === "pref") {
      var old = n.pref[c.d];
      if (old && old.lv === "c" && c.lv !== "c") return;
      n.pref[c.d] = { v: c.v, lv: c.lv };
    } else if (c.k === "topic") n.topic = "c";
    else if (c.k === "taboo") n.taboo = c.tag;
    else if (c.k === "drink") n.drink = c.v;
  }
  function talk(s, ci) {
    var g = curGroup(s);
    if (!g || g.step !== "talk" || !g.topics[ci]) return null;
    var guest = guestOf(s, g), liked = g.topics[ci] === guest.topic;
    g.picked = g.topics[ci]; g.liked = liked;
    if (liked) { g.sat += 10; note(s, g.gid, { k: "topic" }); }
    g.step = "order";
    g.req = makeReq(guest);
    if (g.resvWant) g.req = { want: [g.resvWant], avoid: [] };
    if (guest.taboo && rnd(s) < 0.25) { note(s, g.gid, { k: "taboo", tag: guest.taboo }); g.saidTaboo = guest.taboo; }
    crewOf(s).forEach(function (stf) {   // 記單準的店員：每位多看出一個口味線索
      if (stf.ability !== "memo") return;
      var i = rint(s, 5);
      if (guest.pref[i]) note(s, g.gid, { k: "pref", d: D.DIMS[i], v: guest.pref[i] > 0 ? 1 : -1, lv: "s" });
    });
    return { liked: liked };
  }
  function scoreDish(s, guest, id, req) {
    var d = D.DISHES[id], delta = 0, best = -1, bestV = 0, i;
    if (guest.taboo && d.tags.indexOf(guest.taboo) >= 0) return { delta: -40, taboo: true, clue: { k: "taboo", tag: guest.taboo } };
    if (guest.drink === 0 && d.tags.indexOf("alcohol") >= 0) return { delta: -40, taboo: true, clue: { k: "taboo", tag: "alcohol" } };
    for (i = 0; i < 5; i++) {
      var c = guest.pref[i] * d.f[i];
      delta += c * 6;
      if (Math.abs(c) > bestV) { bestV = Math.abs(c); best = i; }
    }
    if (d.season === seasonOf(s.day)) delta += 4;
    if (req) {
      var okW = req.want.every(function (k) { return d.f[D.DIMS.indexOf(k)] >= 1; });
      var okA = req.avoid.every(function (k) { return d.f[D.DIMS.indexOf(k)] === 0; });
      if ((req.want.length || req.avoid.length) && okW && okA) delta += 8;
    }
    return { delta: clamp(delta, -30, 30), taboo: false, clue: best >= 0 ? { k: "pref", d: D.DIMS[best], v: guest.pref[best] > 0 ? 1 : -1, lv: "s" } : null };
  }
  function serve(s, id) {
    var g = curGroup(s), d = D.DISHES[id];
    if (!g || !d || s.board.indexOf(id) < 0) return { ok: false };
    var isDrink = d.cat === "drink";
    if ((g.step === "order" && isDrink) || (g.step === "drink" && !isDrink) || (g.step !== "order" && g.step !== "drink")) return { ok: false };
    if (!makeOne(s, id)) return { ok: false, short: true };
    var guest = guestOf(s, g), r = scoreDish(s, guest, id, isDrink ? null : g.req);
    g.sat = clamp(g.sat + r.delta + (isDrink ? 0 : staffSatBonus(s)) - (s.night.dirty > D.DIRTY_MAX ? 5 : 0), 0, 100);
    g.last = { id: id, delta: r.delta, taboo: r.taboo, clue: r.clue };
    if (r.clue) note(s, g.gid, r.clue);
    if (isDrink) { g.drink = id; pay(s, g); } else { g.food = id; g.step = "drink"; }
    return { ok: true, delta: r.delta, clue: r.clue, taboo: r.taboo };
  }
  // 口碑：每組依滿意度加減（不乘人數；人數只影響營收）。數值依 sim.js 調整（2026-11-09）
  function repDelta(sat) { return Math.round((sat - D.REP_BASE) / D.REP_DIV); }
  function starOf(rep) { var st = 1; for (var i = 0; i < D.STAR_REP.length; i++) if (rep >= D.STAR_REP[i]) st = i + 1; return st; }
  // 目前這一組遇到還沒處理的突發狀況
  function incidentNow(s) { var ic = s.night && s.night.incident; return ic && !ic.done && ic.at === s.night.i ? ic : null; }
  function pay(s, g) {
    if (incidentNow(s)) { g.sat = clamp(g.sat - 10, 0, 100); s.rep = Math.max(0, s.rep - 2); s.night.incident.done = true; s.night.incident.missed = true; }
    s.night.dirty = (s.night.dirty || 0) + g.n;
    if (g.resv) { if (g.sat >= 70) s.cash += g.bonus; else s.rep = Math.max(0, s.rep - 3); }
    var f = D.DISHES[g.food], dr = D.DISHES[g.drink];
    var fp = f ? f.price * (s.sig === g.food && s.maxStar >= 3 ? D.SIG_MULT : 1) : 0;
    var bill = Math.round((fp + (dr ? dr.price * drinkMult(s) : 0)) * g.n);
    if (g.sat >= 80) bill = Math.round(bill * 1.1);
    g.bill = bill; s.cash += bill;
    if (g.critic) s.rep = Math.max(0, s.rep + (g.sat >= 80 ? 30 : -15));
    else s.rep = Math.max(0, s.rep + repDelta(g.sat));
    s.night.rev += bill; s.night.satSum += g.sat; s.night.satN++;
    var nt = s.notes[g.gid] || (s.notes[g.gid] = { pref: {}, visits: 0 });
    nt.visits = (nt.visits || 0) + 1;
    if (g.kind === "walk" && g.sat >= 80) s.night.high.push(g.gid);
    if (g.kind === "reg") s.order.forEach(function (pid) { addAff(s, pid, g.gid, g.sat >= 80 ? 3 : g.sat >= 60 ? 1 : -1); });
    g.step = "done";
    s.night.i++;
    enterGroup(s);
  }
  // 季節宴席：板前一次出完 3 道；當令菜、創作料理越多越好
  function serveBanquet(s) {
    var g = curGroup(s);
    if (!g || g.kind !== "banquet" || g.step !== "banquet" || !s.banquet) return { ok: false };
    if (!s.banquet.every(function (k) { return canMake(s, k); })) return { ok: false, short: true };
    var se = seasonOf(s.day), good = 0, sum = 0;
    s.banquet.forEach(function (k) { makeOne(s, k); var d = D.DISHES[k]; sum += d.price; if (d.season === se || d.creative) good++; });
    g.sat = clamp(60 + good * 10 + staffSatBonus(s), 0, 100);
    var bill = Math.round(sum * g.n * 1.3);
    g.bill = bill; s.cash += bill;
    s.rep = Math.max(0, s.rep + 2 + good * 2);
    s.night.rev += bill; s.night.satSum += g.sat; s.night.satN++; s.night.dirty = (s.night.dirty || 0) + g.n;
    g.step = "done"; g.good = good;
    s.night.i++;
    enterGroup(s);
    return { ok: true, good: good, bill: bill };
  }
  // 酒保話題：點單或上飲料時，每組一次
  function barTalk(s, ci) {
    var g = curGroup(s), tk = D.BAR_TALKS[ci];
    if (!g || !tk || g.bartalked || (g.step !== "order" && g.step !== "drink")) return { ok: false };
    var guest = guestOf(s, g), d = 3;
    if (tk.id === "rec") { d = guest.drink === 0 ? -5 : 6; note(s, g.gid, { k: "drink", v: guest.drink }); }
    else if (tk.likes.indexOf(guest.persona) >= 0) d = 8;
    g.sat = clamp(g.sat + d, 0, 100);
    g.bartalked = tk.id; g.barDelta = d;
    return { ok: true, delta: d };
  }
  // 採買的夜間工作：洗碗、緊急補貨、處理突發狀況
  function wash(s) { if (!s.night || !s.night.dirty) return false; s.night.dirty = 0; return true; }
  // 營業中補貨直接拿到檯面上用，不受冰箱容量限制（2026-11-10）；n 份一次買
  function restock(s, id, n) {
    n = Math.max(1, n | 0);
    if (!D.INGS[id] || !s.mk[id]) return false;
    var cost = restockCost(s, id) * n;
    if (cost > s.cash) return false;
    s.cash -= cost;
    var list = s.fridge[id] || (s.fridge[id] = []);
    for (var i = 0; i < n; i++) list.push(s.day + D.INGS[id].fresh);
    list.sort(function (a, b) { return a - b; });
    return true;
  }
  // 沒有能做的菜時的替代方案（取代原本只能 pass 的 −20）：
  // 點菜時送招待小菜（滿意度 −6、不收菜錢，接著還能點飲料）；點飲料時奉茶（−2、不收飲料錢，結帳）
  function fallback(s) {
    var g = curGroup(s);
    if (!g || (g.step !== "order" && g.step !== "drink")) return false;
    if (g.step === "order") {
      g.sat = clamp(g.sat - 6, 0, 100);
      g.food = null; g.otoshi = true; g.step = "drink";
      g.last = { id: null, delta: -6, taboo: false, clue: null, otoshi: true };
    } else {
      g.sat = clamp(g.sat - 2, 0, 100);
      g.drink = null; g.tea = true;
      pay(s, g);
    }
    return true;
  }
  function handleIncident(s) { var ic = s.night && s.night.incident; if (!ic || ic.done) return false; ic.done = true; s.rep += 1; return true; }
  function addAff(s, pid, cid, n) { var a = s.players[pid].aff; a[cid] = clamp((a[cid] || 0) + n, 0, 100); }
  function closeService(s) {
    s.phase = "close";
    var cost = D.RENT + wageOf(s);
    s.cash -= cost;
    var st = starOf(s.rep), up = st > s.maxStar ? st : 0;
    s.star = st; if (up) s.maxStar = st;
    var n = s.night || { rev: 0, satSum: 0, satN: 0, high: [] };
    s.today = { day: s.day, rev: n.rev || 0, cost: cost, groups: n.satN || 0, sat: n.satN ? Math.round(n.satSum / n.satN) : 0, rep: s.rep, star: st, unlock: up, rush: n.rushStats || null };
    s.refer = (n.high || []).slice();
    s.night = null;
    s.ready = {};
  }
  function nextDay(s) {
    if (s.day >= D.DAYS) { s.phase = "end"; s.end = endingOf(s); return; }
    if (dowOf(s.day) === 6) { s.phase = "holiday"; s.ready = {}; s.date = {}; return; }
    s.day++; startMarket(s);
  }
  function afterHoliday(s) {
    s.date = {};
    if (s.day >= D.DAYS) { s.phase = "end"; s.end = endingOf(s); return; }
    s.day++; startMarket(s);
  }
  // 多重結局（使用者指定 2026-11-09）：D.ENDINGS 依順序判定，第一個條件成立的就是這一年的結局
  function condMatch(s, c) {
    c = c || {};
    var st = s.story, lg = s.legacy || emptyLegacy();
    if (c.seen && !c.seen.every(function (k) { return st.seen[k]; })) return false;
    if (c.flag && !c.flag.every(function (k) { return st.flags[k]; })) return false;
    if (c.notFlag && c.notFlag.some(function (k) { return st.flags[k]; })) return false;
    if (c.run && (lg.runs || 0) < c.run) return false;
    if (c.secret && !c.secret.every(function (k) { return lg.secrets[k] || st.flags[k]; })) return false;
    if (c.star && s.maxStar < c.star) return false;
    return true;
  }
  function endingOf(s) {
    var hit = D.ENDINGS.filter(function (e) { return condMatch(s, e.cond); })[0];
    return { ending: hit ? hit.id : D.ENDINGS[D.ENDINGS.length - 1].id, star: s.maxStar, cash: s.cash, rep: s.rep,
      arcs: JSON.parse(JSON.stringify(s.story.arcs)), rel: JSON.parse(JSON.stringify(s.rel)) };
  }
  // ---------------- 跨局記憶（一年結束時合併；最深處的祕密要好幾輪才串得起來）----------------
  function emptyLegacy() { return { runs: 0, seen: {}, endings: {}, secrets: {} }; }
  function mergeLegacy(leg, s) {
    leg = JSON.parse(JSON.stringify(leg || emptyLegacy()));
    if (!s.end) return leg;
    var key = s.seed + ":" + s.day;
    if (leg.last === key) return leg;   // 同一局只記一次
    leg.last = key;
    leg.runs = (leg.runs || 0) + 1;
    Object.keys(s.story.seen).forEach(function (k) { leg.seen[k] = 1; });
    leg.endings[s.end.ending] = 1;
    Object.keys(s.story.flags).forEach(function (k) { if (k.indexOf("secret_") === 0) leg.secrets[k] = 1; });
    return leg;
  }

  // ---------------- 戀愛（使用者指定 2026-11-09：★3 約會、★4 心動、★5 告白～結婚；每位玩家各自計算）----------------
  function affOf(s, pid, cid) { return s.players[pid].aff[cid] || 0; }
  function canDate(s, pid, cid) {
    var who = Cast().byId(cid);
    if (s.phase !== "holiday" || s.maxStar < 3 || !who || who.noLove || s.date[pid]) return false;
    if (affOf(s, pid, cid) < D.DATE_AFF) return false;
    if (s.rel[cid] && s.rel[cid].pid !== pid) return false;
    return !Object.keys(s.date).some(function (p) { return s.date[p].cid === cid; });
  }
  function startDate(s, pid, cid, spot) {
    if (!canDate(s, pid, cid) || !D.SPOTS.some(function (x) { return x.id === spot; })) return false;
    s.date[pid] = { cid: cid, spot: spot, r: 0, gain: 0, heart: false, done: false, log: [] };
    return true;
  }
  function dateChoice(s, pid, ci) {
    var dt = s.date[pid];
    if (!dt || dt.done) return null;
    var spot = D.SPOTS.filter(function (x) { return x.id === dt.spot; })[0], round = spot.rounds[dt.r];
    if (!round || !round.ch[ci]) return null;
    var c = Cast().byId(dt.cid), tag = round.ch[ci].tag, liked = c.likes.indexOf(tag) >= 0;
    dt.gain += liked ? 6 : 2; dt.log.push({ c: ci, liked: liked }); dt.r++;
    if (dt.r >= spot.rounds.length) finishDate(s, pid);
    return { tag: tag, liked: liked };
  }
  function finishDate(s, pid) {
    var dt = s.date[pid], c = Cast().byId(dt.cid);
    addAff(s, pid, dt.cid, dt.gain + (c.favSpot === dt.spot ? 5 : 0));
    s.players[pid].dates++;
    if (s.rel[dt.cid] && s.rel[dt.cid].pid === pid) s.rel[dt.cid].dates++;
    if (s.maxStar >= 4 && affOf(s, pid, dt.cid) >= D.HEART_AFF) {
      dt.heart = true;
      var sc = Story() && Story().eligible(s, { at: "date", who: dt.cid, spot: dt.spot, pid: pid });
      if (sc) Story().begin(s, sc.id, pid); else addAff(s, pid, dt.cid, 8);
    }
    dt.done = true;
  }
  function confess(s, pid, cid) {
    if (s.maxStar < 5 || affOf(s, pid, cid) < D.CONFESS_AFF || !Cast().byId(cid) || Cast().byId(cid).noLove) return { ok: false };
    var r = s.rel[cid];
    if (!r) { s.rel[cid] = { pid: pid, stage: 1, dates: 0 }; return { ok: true }; }
    if (r.pid === pid) return { ok: false };
    // 三角戀：兩位玩家搶同一個角色，由角色選好感高的人（同分維持原本）
    s.story.flags["tri_" + cid] = 1;
    var win = affOf(s, pid, cid) > affOf(s, r.pid, cid) ? pid : r.pid, lose = win === pid ? r.pid : pid;
    addAff(s, lose, cid, -15);
    if (win === pid) s.rel[cid] = { pid: pid, stage: 1, dates: 0 };
    return { ok: win === pid, tri: true, winner: win };
  }
  function propose(s, pid, cid) {
    var r = s.rel[cid];
    if (!r || r.pid !== pid || r.stage !== 1 || affOf(s, pid, cid) < D.PROPOSE_AFF || r.dates < 3) return false;
    r.stage = 2; return true;
  }
  function wedding(s, pid, cid) {
    var r = s.rel[cid];
    if (s.phase !== "holiday" || !r || r.pid !== pid || r.stage !== 2) return false;
    r.stage = 3; return true;
  }
  function partnerOf(s, pid) {
    var out = null;
    Object.keys(s.rel).forEach(function (cid) { if (s.rel[cid].pid === pid && s.rel[cid].stage === 3) out = cid; });
    return out;
  }

  // ---------------- 店員、招牌 ----------------
  // 店員（使用者指定 2026-11-09：可同時雇用多人，★4 兩人、★5 三人；能力可疊加但有上限）
  function crewOf(s) { return (s.staff.crew || []).map(function (id) { return Cast().byId(id); }).filter(Boolean); }
  function staffNow(s) { return crewOf(s)[0] || null; }
  function hasAbility(s, ab) { return crewOf(s).some(function (c) { return c.ability === ab; }); }
  function maxCrew(s) { return s.maxStar >= 5 ? 3 : s.maxStar >= 4 ? 2 : 0; }
  function canHire(s, id) {
    var c = Cast().byId(id);
    return !!c && !!c.ability && !!s.staff.met[id] && s.staff.crew.indexOf(id) < 0 && s.staff.crew.length < maxCrew(s);
  }
  function hire(s, id) { if (!canHire(s, id)) return false; s.staff.crew.push(id); return true; }
  function fire(s, id) { var i = s.staff.crew.indexOf(id); if (i < 0) return false; s.staff.crew.splice(i, 1); return true; }
  function setSig(s, id) { var d = D.DISHES[id]; if (s.maxStar < 3 || !d || d.cat === "drink" || !s.known[id]) return false; s.sig = id; return true; }
  function staffSatBonus(s) {
    var b = Math.min(10, crewOf(s).filter(function (c) { return c.ability === "host"; }).length * 5);
    if (s.order.some(function (pid) { return partnerOf(s, pid); })) b += 5;
    return b;
  }
  function drinkMult(s) { return 1 + Math.min(2, crewOf(s).filter(function (c) { return c.ability === "bar"; }).length) / 10; }
  function wageOf(s) { return crewOf(s).reduce(function (t, c) { return t + c.wage; }, 0); }

  // ---------------- 意圖 ----------------
  function allReady(s) { return s.order.every(function (p) { return s.ready[p] || isAway(s, p); }); }
  function runQueue(s) { var id = s.story.queue.shift(); if (id) Story().begin(s, id, null); }
  // 店員面試（店員的第 1 段）一個公休日最多 2 段：1b 店員增加到 30 人，★3 之後的第一個公休日會一口氣塞滿面試
  var MAX_INTERVIEWS = 2;
  function findScenes(s, at) {
    var out = [], interviews = 0;
    if (!Story() || !Story().eligible) return out;
    var list = Cast().REGULARS.concat(Cast().STAFF), off = s.day % list.length;
    list.slice(off).concat(list.slice(0, off)).forEach(function (c) {
      var sc = Story().eligible(s, { at: at, who: c.id, present: [] });
      if (!sc || out.indexOf(sc.id) >= 0) return;
      if (c.ability && sc.id === c.id + "_01") { if (interviews >= MAX_INTERVIEWS) return; interviews++; }
      out.push(sc.id);
    });
    return out;
  }
  function onReady(s) {
    if (!allReady(s)) return;
    s.ready = {};
    if (s.phase === "market") { s.phase = "prep"; return; }
    if (s.phase === "prep") { openService(s); return; }
    if (s.phase === "close") {
      if (!s.closeDone) { s.closeDone = 1; s.story.queue = findScenes(s, "close"); if (s.story.queue.length) { runQueue(s); return; } }
      s.closeDone = 0; nextDay(s);
      if (s.phase === "holiday") { s.story.queue = findScenes(s, "holiday"); runQueue(s); }
      return;
    }
    if (s.phase === "holiday") {
      if (Object.keys(s.date).some(function (p) { return !s.date[p].done; })) return;
      afterHoliday(s);
    }
  }
  var MOD = { buy: "buyer", stock: "buyer", fallback: "hall", haggle: "buyer", resv: "buyer", wash: "buyer", restock: "buyer", incident: "buyer", banquet: "hall", serveBanquet: "chef", bartalk: "bar",
    board: "hall", sig: "hall", prep: "chef", dev: "chef", create: "chef", devDrink: "bar", talk: "hall", rush: "hall", hire: "hall", fire: "hall" };
  function applyIntent(s, pid, it) {
    // 中途加入（2026-11-09）：營業以外的階段、最多 4 人；職位依每個人想要的重新分配
    if (it && it.a === "join" && !s.players[pid]) {
      if (s.phase === "service" || s.phase === "end" || s.order.length >= 4) return false;
      s.players[pid] = { name: String(it.name || "").slice(0, 16), want: D.ROLES[it.want] ? it.want : "", aff: {}, dates: 0 };
      s.order.push(pid);
      s.roles = assignRoles(s.order.map(function (p) { return { pid: p, want: s.players[p].want }; }));
      return true;
    }
    if (!it || !s.players[pid] || s.phase === "end") return false;
    // 暫離（房主偵測到離線時送出）：準備與投票不用等他，他的職位由第一位在線的玩家代理
    if (it.a === "away") {
      if (!s.players[it.pid] || isAway(s, pid)) return false;
      s.away = s.away || {};
      if (it.v) s.away[it.pid] = 1; else delete s.away[it.pid];
      if (s.phase !== "service" && s.phase !== "end" && s.order.length) onReady(s);
      if (s.story.cur && Story().allVoted && Story().allVoted(s)) { Story().resolve(s); afterStory(s); }
      return true;
    }
    var a = it.a;
    if (s.story.cur) {
      if (a === "vote") { var ok = Story().choose(s, pid, it.c); if (ok) afterStory(s); return ok; }
      if (a === "vforce") { var f = Story().force(s, pid); if (f) afterStory(s); return f; }
      return false;
    }
    if (MOD[a] && !hasRole(s, pid, MOD[a])) return false;
    switch (a) {
      case "ready": if (s.phase === "service") return false; s.ready[pid] = !!it.v; onReady(s); return true;
      case "buy": return s.phase === "market" && buy(s, it.id, it.n);
      case "stock": return s.phase === "market" && autoStock(s) > 0;
      case "board": return s.phase === "prep" && setBoard(s, it.ids);
      case "sig": return s.phase === "prep" && setSig(s, it.id);
      case "prep": return s.phase === "prep" && prep(s, it.id);
      case "dev": {
        if (s.phase !== "prep" && s.phase !== "holiday") return false;
        var r = dev(s, it.ings, it.m); s.lastDev = { pid: pid, ok: r.ok, id: r.id || null, n: ((s.lastDev && s.lastDev.n) || 0) + 1 }; return true;
      }
      case "devDrink": return (s.phase === "prep" || s.phase === "holiday") && devDrink(s, it.id);
      case "haggle": { if (s.phase !== "market") return false; var hg = haggle(s, it.id); s.lastHaggle = { id: it.id, ok: hg.ok, cut: hg.cut, n: ((s.lastHaggle && s.lastHaggle.n) || 0) + 1 }; return hg.ok; }
      case "resv": return s.phase === "market" && acceptResv(s, it.id);
      case "banquet": return s.phase === "prep" && setBanquet(s, it.ids);
      case "serveBanquet": { if (s.phase !== "service" || s.rush) return false; var sb = serveBanquet(s); if (sb.ok && !curGroup(s) && !s.story.cur) closeService(s); return sb.ok; }
      case "bartalk": return s.phase === "service" && !s.rush && barTalk(s, it.c).ok;
      case "wash": return s.phase === "service" && wash(s);
      case "restock": return s.phase === "service" && restock(s, it.id, it.n);
      case "incident": return s.phase === "service" && handleIncident(s);
      case "create": {
        if (s.phase !== "prep" && s.phase !== "holiday") return false;
        var rc = create(s, it.g1, it.g2); rc.pid = pid; rc.n = ((s.lastCreate && s.lastCreate.n) || 0) + 1; s.lastCreate = rc; return true;
      }
      case "talk": return s.phase === "service" && !s.rush && !!talk(s, it.c);
      case "hint": if (s.phase !== "service" || hasRole(s, pid, "hall")) return false; s.night.hints[pid] = it.c; return true;
      case "serve": {
        if (s.phase !== "service" || s.rush || !D.DISHES[it.id]) return false;
        if (!hasRole(s, pid, D.DISHES[it.id].cat === "drink" ? "bar" : "chef")) return false;
        // buy：缺料時先臨時加碼再出菜（負責出菜的人自己就能按，不用等採買）
        if (it.buy && !canMake(s, it.id) && !buyShort(s, it.id)) return false;
        var res = serve(s, it.id); s.lastServe = res;
        if (res.ok && !curGroup(s) && !s.story.cur) closeService(s);
        return res.ok;
      }
      case "skip": {   // 冰箱沒有能做的東西時：這一組只結帳已上的菜
        var gs = curGroup(s);
        if (s.phase !== "service" || !gs || (gs.step !== "order" && gs.step !== "drink") || !hasRole(s, pid, "hall")) return false;
        gs.sat = clamp(gs.sat - 20, 0, 100);
        pay(s, gs);
        if (!curGroup(s) && !s.story.cur) closeService(s);
        return true;
      }
      case "fallback": {
        if (s.phase !== "service" || s.rush || !fallback(s)) return false;
        if (!curGroup(s) && !s.story.cur) closeService(s);
        return true;
      }
      case "rush": { var g = curGroup(s); if (s.phase !== "service" || !g || g.kind !== "rush" || s.rush) return false; Rush().start(s); return true; }
      case "rc": case "rt": case "rs": return s.phase === "service" && !!s.rush && Rush().intent(s, pid, it);
      case "date": return startDate(s, pid, it.cid, it.spot);
      case "dc": return !!dateChoice(s, pid, it.c);
      case "confess": { var c1 = confess(s, pid, it.cid); s.lastLove = { pid: pid, kind: "confess", ok: c1.ok, tri: !!c1.tri, winner: c1.winner || null, cid: it.cid }; return true; }
      case "propose": { var c2 = propose(s, pid, it.cid); s.lastLove = { pid: pid, kind: "propose", ok: c2, cid: it.cid }; return c2; }
      case "wedding": { var c3 = wedding(s, pid, it.cid); s.lastLove = { pid: pid, kind: "wedding", ok: c3, cid: it.cid }; return c3; }
      case "hire": return s.phase === "holiday" && hire(s, it.id);
      case "fire": return s.phase === "holiday" && fire(s, it.id);
    }
    return false;
  }
  function afterStory(s) {
    if (s.story.cur) return;
    var g = curGroup(s);
    if (s.phase === "service" && g && g.step === "story") g.step = "talk";
    if (s.story.queue.length) { runQueue(s); return; }
    if (s.phase === "service" && !curGroup(s)) closeService(s);
  }
  // 房主每幀呼叫：只在尖峰時推進
  function tick(s, dt) {
    if (!s.rush) return;
    Rush().step(s, dt);
    if (s.phase === "service" && !s.rush && !curGroup(s) && !s.story.cur) closeService(s);
  }

  // ---------------- 存檔 ----------------
  function serialize(s) { return JSON.stringify(s); }
  function restore(str) {
    var s;
    try { s = typeof str === "string" ? JSON.parse(str) : null; } catch (e) { return null; }
    if (!s || s.v !== 1 || !s.players) return null;
    // 舊存檔相容：店員從單一 hired 改成名單 crew；沒有跨局記憶就補空的
    if (!s.staff.crew) { s.staff.crew = s.staff.hired ? [s.staff.hired] : []; delete s.staff.hired; }
    if (!s.legacy) s.legacy = emptyLegacy();
    ["offers", "resvNext", "resvToday"].forEach(function (k) { if (!s[k]) s[k] = []; });
    if (!s.haggled) s.haggled = {};
    if (!s.away) s.away = {};
    if (s.banquet === undefined) s.banquet = null;
    if (!s.creations) s.creations = {};
    if (!s.atelier) s.atelier = {};
    registerCreations(s);
    return s;
  }

  window.PriTestIzakayaCore = {
    rnd: rnd, rint: rint, clamp: clamp, seasonOf: seasonOf, dowOf: dowOf, isRushDay: isRushDay,
    assignRoles: assignRoles, hasRole: hasRole, newGame: newGame,
    startMarket: startMarket, stockPlan: stockPlan, autoStock: autoStock, shortOf: shortOf, shortCost: shortCost, canBuyShort: canBuyShort, buyShort: buyShort,
    restockCost: restockCost, fallback: fallback, fridgeCap: fridgeCap, fridgeCount: fridgeCount, stock: stock, buy: buy,
    hasIngs: hasIngs, useIngs: useIngs, canMake: canMake, makeOne: makeOne,
    setBoard: setBoard, prep: prep, dev: dev, devDrink: devDrink, photoOf: photoOf,
    openService: openService, enterGroup: enterGroup, curGroup: curGroup, guestOf: guestOf, note: note, talk: talk,
    scoreDish: scoreDish, serve: serve, repDelta: repDelta, starOf: starOf, pay: pay, addAff: addAff, closeService: closeService,
    nextDay: nextDay, afterHoliday: afterHoliday,
    affOf: affOf, canDate: canDate, startDate: startDate, dateChoice: dateChoice, confess: confess, propose: propose,
    wedding: wedding, partnerOf: partnerOf,
    staffNow: staffNow, crewOf: crewOf, hasAbility: hasAbility, maxCrew: maxCrew, canHire: canHire, hire: hire, fire: fire,
    emptyLegacy: emptyLegacy, mergeLegacy: mergeLegacy, endingOf: endingOf, condMatch: condMatch,
    materials: materials, create: create, gName: gName, registerCreations: registerCreations,
    haggle: haggle, acceptResv: acceptResv, setBanquet: setBanquet, serveBanquet: serveBanquet, barTalk: barTalk, wash: wash,
    restock: restock, handleIncident: handleIncident, incidentNow: incidentNow, isAway: isAway, activeLead: activeLead, setSig: setSig, staffSatBonus: staffSatBonus,
    drinkMult: drinkMult, wageOf: wageOf,
    allReady: allReady, applyIntent: applyIntent, tick: tick, serialize: serialize, restore: restore
  };
})();
