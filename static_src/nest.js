// 秘密的同居生活（nest）：規則與畫面。2026-11-11 依使用者需求新增（20 位房客、大量 18 禁劇情）。
// 每天：白天（修繕／和房客聊天／打掃／翻修／打工；房間配置、接受新房客、打招呼不花時間）→ 夜晚（公共空間偶遇、意外事件、去她的房間）。
// 每 15 天收房租（看房間與滿意度）。第 90 天要還清貸款，否則椿莊被建商收購。
// 房間配置拼圖：comfort() 依左右鄰居、樓上樓下、樓層、角間計算舒適度，滿意度每天往「目標值」靠近。
(function () {
  "use strict";

  var D = window.PriTestNestData, N = window.PriTestNestNight, C = window.PriTestNestCast;
  var app = document.getElementById("ns-app");
  if (!D || !N || !C || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-nest-save-v1", AGE_KEY = "pritest-nest-age-ok", ALBUM_KEY = "pritest-nest-album", BEST_KEY = "pritest-nest-best";
  var NR = D.FLOORS * D.COLS;
  var H = {}; D.HEROINES.forEach(function (h) { H[h.id] = h; });

  var st = null;
  var ui = { screen: "title", vn: null, story: null, panel: null, toast: "", ageOk: false, sel: null, place: null, reno: false, castPick: null };

  // ---------------- 工具 ----------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function save() { store(SAVE_KEY, st && !st.ended ? st : null); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ageOk() { try { return localStorage.getItem(AGE_KEY) === "1"; } catch (e) { return ui.ageOk; } }
  function album() { return load(ALBUM_KEY) || {}; }
  function addAlbum(key) { var a = album(); a[key] = 1; store(ALBUM_KEY, a); }
  function money(k) { return (k < 0 ? "-" : "") + "NT$ " + Math.abs(Math.round(k * 1000)).toLocaleString("en-US"); }
  function log(t) { st.log.unshift("D" + st.day + "　" + t); if (st.log.length > 60) st.log.length = 60; }

  function isGen(id) { return !!id && !H[id] && id.charAt(0) === "x"; } // 注意：女主角 xi、xue 也是 x 開頭
  function M(id) { return H[id] || (st && st.gen && st.gen[id]); }
  function S(id) { return isGen(id) ? st.gen[id] : st.h[id]; }
  function imgOf(id) { if (H[id]) return (st && st.img && st.img[id]) || H[id].img; var g = M(id); return g ? g.img : ""; }
  function persOf(g) { return C.PERS.filter(function (p) { return p.id === g.pers; })[0]; }
  function roomOf(id) { return st.rooms.indexOf(id); }
  function tenants() { return st.rooms.filter(function (x) { return !!x; }); }
  function dating() { return Object.keys(st.h).filter(function (id) { return st.h[id].dating; }).concat(Object.keys(st.gen).filter(function (id) { return st.gen[id].dating; })); }
  function roomName(r) { return (Math.floor(r / D.COLS) + 1) + "F-" + "ABCD".charAt(r % D.COLS); }
  function tierName(a) { return a >= 90 ? "摯愛" : a >= 75 ? "心動" : a >= 55 ? "信賴" : a >= 35 ? "親近" : a >= 15 ? "熟悉" : "房客"; }
  function tagsOf(id) { var m = M(id); return { emits: m.emits || [], sens: m.sens || [], traits: m.traits || [], prefs: m.prefs || [] }; }
  function has(arr, x) { return arr.indexOf(x) >= 0; }
  function avgSat() { var t = tenants(); return t.length ? t.reduce(function (a, id) { return a + S(id).sat; }, 0) / t.length : 0; }

  // ---------------- 房間配置拼圖 ----------------
  // rooms＝要計算的配置（陣列）；回傳 { c: 舒適度, why: [[文字, 數值], ...] }
  function comfort(id, r, rooms) {
    var t = tagsOf(id), why = [], c = 0, f = Math.floor(r / D.COLS), col = r % D.COLS;
    function add(txt, v) { if (!v) return; c += v; why.push([txt, v]); }
    function nb(rr) { return rr >= 0 && rr < NR ? rooms[rr] : null; }
    var left = col > 0 ? nb(r - 1) : null, right = col < D.COLS - 1 ? nb(r + 1) : null;
    var above = f < D.FLOORS - 1 ? nb(r + D.COLS) : null, below = f > 0 ? nb(r - D.COLS) : null;
    [left, right].forEach(function (n) {
      if (!n || n === id) return;
      var e = tagsOf(n).emits, nm = M(n).short;
      if (has(e, "music")) { if (has(t.sens, "light")) add("隔壁 " + nm + " 的聲音", -2); if (has(t.sens, "daysleep")) add("隔壁 " + nm + " 白天的聲音", -2); }
      if (has(e, "late") && has(t.sens, "light")) add("隔壁 " + nm + " 深夜晚歸", -1.5);
      if (has(e, "smell")) { if (has(t.traits, "foodie")) add("隔壁 " + nm + " 做菜好香", 1.5); if (has(t.sens, "smellSens")) add("隔壁 " + nm + " 的油煙味", -1.5); }
      if (has(e, "cat")) { if (has(t.traits, "catlover")) add("隔壁 " + nm + " 的貓", 1.5); if (has(t.sens, "allergy")) add("隔壁 " + nm + " 的貓毛（過敏）", -2.5); }
      if (has(e, "smoke")) { if (has(t.sens, "smellSens")) add("隔壁 " + nm + " 的菸味", -1.5); if (has(t.sens, "allergy")) add("隔壁 " + nm + " 的菸味（過敏）", -1); }
      if (has(t.traits, "social")) add("有鄰居 " + nm, 0.7);
      if (has(t.traits, "loner")) add("鄰居 " + nm + " 太近", -0.7);
    });
    if (above && above !== id) {
      var ea = tagsOf(above).emits, na = M(above).short;
      if (has(ea, "steps")) { if (has(t.sens, "light")) add("樓上 " + na + " 的腳步聲", -2); if (has(t.sens, "daysleep")) add("樓上 " + na + " 的腳步聲", -2); }
      if (has(ea, "music") && (has(t.sens, "light") || has(t.sens, "daysleep"))) add("樓上 " + na + " 的聲音", -1);
    }
    if (below && below !== id) {
      var eb = tagsOf(below).emits, nb2 = M(below).short;
      if (has(eb, "music") && (has(t.sens, "light") || has(t.sens, "daysleep"))) add("樓下 " + nb2 + " 的聲音", -1);
      if (has(eb, "smoke") && (has(t.sens, "smellSens") || has(t.sens, "allergy"))) add("樓下 " + nb2 + " 的菸味飄上來", -1);
    }
    if (has(t.prefs, "sun")) add(f === 4 ? "5F 的陽光" : f === 3 ? "4F 的陽光" : f === 0 ? "1F 照不到太陽" : "", f === 4 ? 1.5 : f === 3 ? 0.6 : f === 0 ? -1 : 0);
    if (has(t.prefs, "corner")) add(col === 0 || col === 3 ? "角間" : "不是角間", col === 0 || col === 3 ? 1.2 : -0.5);
    if (has(t.prefs, "low")) add(f <= 1 ? "低樓層好方便" : f >= 3 ? "樓梯好累" : "", f <= 1 ? 1.5 : f >= 3 ? -1 : 0);
    if (f === 0 && has(t.sens, "light")) add("1F 的車聲", -1);
    return { c: c, why: why };
  }
  function target(id, r, rooms) {
    rooms = rooms || st.rooms; r = r == null ? rooms.indexOf(id) : r;
    var cf = comfort(id, r, rooms);
    return clamp(Math.round(55 + 9 * cf.c + st.grade[r] * 4 + (st.clean > 0 ? 5 : 0)), 5, 100);
  }
  // 預覽：把 id 移到 r（有人就交換）之後，她的目標滿意度
  function preview(id, r) {
    var rooms = st.rooms.slice(), from = rooms.indexOf(id), other = rooms[r];
    if (from >= 0) rooms[from] = other || null;
    rooms[r] = id;
    return target(id, r, rooms);
  }
  function rentOf(r) { var f = Math.floor(r / D.COLS), col = r % D.COLS; return 5 + f * 0.6 + (col === 0 || col === 3 ? 0.8 : 0) + st.grade[r] * 1.6; }
  function payFactor(s) { return s >= 70 ? 1 : s >= 45 ? 0.85 : s >= 25 ? 0.6 : 0.3; }

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { day: 1, phase: "day", money: D.START_MONEY, rooms: [], grade: [], h: {}, gen: {}, apps: [], repairs: [], clean: 0, rentN: 0, flags: {}, log: [], img: {}, lastShared: -1, knock: null, ended: false, genSeq: 0 };
    for (var i = 0; i < NR; i++) { st.rooms.push(null); st.grade.push(0); }
    D.HEROINES.forEach(function (h) { st.h[h.id] = { met: false, living: false, applied: false, next: h.arrive, aff: 0, line: 0, dating: false, nights: 0, cool: 0, sat: 60, low: 0, leaving: 0, talks: 0 }; });
    // 一開始就住著的 4 位女主角＋3 位一般房客：故意排得不太好，讓玩家調整
    var start = { kana: 9, aoi: 5, mio: 1, shiori: 10 };
    Object.keys(start).forEach(function (id) { st.rooms[start[id]] = id; st.h[id].living = true; st.h[id].applied = true; });
    [2, 13, 17].forEach(function (r) { var g = newGen(); st.rooms[r] = g; st.gen[g].met = true; st.gen[g].lease = rnd(12, 30); });
    tenants().forEach(function (id) { S(id).sat = target(id); });
    ui.screen = "cast"; ui.castPick = null;
  }
  function usedImgs() { var u = {}; D.HEROINES.forEach(function (h) { u[imgOf(h.id)] = 1; }); Object.keys(st.gen).forEach(function (g) { u[st.gen[g].img] = 1; }); return u; }
  function newGen() {
    var used = usedImgs(), free = C.POOL.filter(function (img) { return !used[img]; });
    if (!free.length) return null;
    var img = pick(free), id = "x" + (++st.genSeq), given = pick(C.GIVEN);
    function maybe(list, p) { return Math.random() < p ? [pick(list)] : []; }
    st.gen[id] = { id: id, name: pick(C.SURN) + given, short: given, img: img, age: rnd(21, 36), job: pick(C.isFantasy(img) ? C.FANTASY_JOBS : C.JOBS),
      pers: pick(C.PERS).id, color: "hsl(" + rnd(0, 359) + ",60%,68%)",
      emits: maybe(D.GEN_EMITS, 0.45), sens: maybe(D.GEN_SENS, 0.5), traits: maybe(D.GEN_TRAITS, 0.6), prefs: maybe(D.GEN_PREFS, 0.5),
      met: false, aff: 0, talks: 0, dating: false, nights: 0, cool: 0, sat: 60, low: 0, leaving: 0, lease: st.day + rnd(20, 35) };
    return id;
  }
  function randomizeCast() {
    var pool = C.POOL.slice(), out = {}, gimg = {};
    Object.keys(st.gen).forEach(function (g) { gimg[st.gen[g].img] = 1; });
    pool = pool.filter(function (x) { return !gimg[x]; });
    D.HEROINES.forEach(function (h) { var k = rnd(0, pool.length - 1); out[h.id] = pool[k]; pool.splice(k, 1); });
    st.img = out;
  }
  function startStory() {
    ui.castPick = null;
    startVN(null, "序章・椿莊", [
      "外婆過世了。她留給你的，是台北巷子裡一棟五層樓的老公寓——「椿莊」。",
      "還有一筆貸款。六十萬。九十天後到期。",
      "玄關的牆上，掛著外婆親手寫的木牌：「住在這裡的人，都是家人。」"
    ].concat(D.DEVELOPER).concat([
      "現在的房客有七個人，空房還有一大半。有人抱怨樓上太吵，有人說隔壁的菸味很重。",
      "房間怎麼排、要讓誰住進來——從今天開始，都由你這個新管理人決定。",
      "九十天。二十個房間。還有，一個屋簷下的秘密。"
    ]), function () { dayStart(); ui.screen = "hub"; save(); });
  }

  // ---------------- 對話（VN）----------------
  function startVN(who, title, steps, after) { ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after || null, sub: {} }; ui.screen = "vn"; advanceSilent(); }
  function fill(text) {
    var v = ui.vn, t = String(text);
    if (v && v.who && M(v.who)) t = t.replace(/\{n\}/g, M(v.who).short);
    if (v && v.sub.m && M(v.sub.m)) t = t.replace(/\{m\}/g, M(v.sub.m).short);
    return t;
  }
  function addAff(id, n) { var x = S(id); x.aff = clamp(x.aff + n, 0, 100); if (n > 0) ui.toast = M(id).short + " 好感 +" + n; }
  function applyEff(e, who) {
    if (!e) return;
    if (e.a && who) addAff(who, e.a);
    if (e.sat && who) S(who).sat = clamp(S(who).sat + e.sat, 0, 100);
    if (e.money) st.money += e.money;
    if (e.flag) st.flags[e.flag] = 1;
  }
  function advanceSilent() {
    var v = ui.vn;
    while (v && v.i < v.steps.length) {
      var s = v.steps[v.i];
      if (s && typeof s === "object" && !Array.isArray(s) && s.e && !s.ch) { applyEff(s.e, v.who); v.i++; continue; }
      break;
    }
    if (v && v.i >= v.steps.length) endVN();
  }
  function vnNext() { if (!ui.vn) return; ui.vn.i++; advanceSilent(); render(); }
  function vnChoose(k) {
    var v = ui.vn, c = v.steps[v.i].ch[k];
    applyEff(c.e, v.who);
    v.steps.splice.apply(v.steps, [v.i + 1, 0].concat((c.r || []).slice()));
    v.i++; advanceSilent(); render();
  }
  function endVN() {
    var v = ui.vn; ui.vn = null;
    var a = v && v.after;
    if (typeof a === "function") a();
    else if (a === "toNight") toNight();
    else if (a === "endNight") endNight();
    else { ui.screen = "hub"; save(); }
  }
  function toNight() {
    st.phase = "night"; ui.screen = "hub"; ui.sel = null; ui.place = null; ui.reno = false;
    var ds = dating().filter(function (id) { return roomOf(id) >= 0; });
    st.knock = ds.length && Math.random() < 0.3 ? pick(ds) : null;
    save();
  }

  // ---------------- 一天的開始 ----------------
  function collectRent(final) {
    var sum = 0;
    st.rooms.forEach(function (id, r) { if (id) sum += rentOf(r) * payFactor(S(id).sat); });
    sum = Math.round(sum);
    st.money += sum;
    log("💰 " + (final ? "最後一期" : "收房租") + "：" + money(sum) + "（" + tenants().length + " 間）");
    ui.toast = "收房租 " + money(sum);
  }
  function dayStart() {
    var due = Math.floor((st.day - 1) / D.RENT_EVERY);
    while (st.rentN < due) { st.rentN++; collectRent(false); }
    // 女主角來看房
    D.HEROINES.forEach(function (h) {
      var x = st.h[h.id];
      if (!x.living && !x.applied && st.day >= x.next) { x.applied = true; st.apps.push(h.id); log("📩 " + h.name + "（" + h.job + "）來看房了"); }
    });
    var empty = st.rooms.filter(function (x) { return !x; }).length;
    if (empty > 0 && st.apps.filter(isGen).length < 2 && Math.random() < 0.45) { var g = newGen(); if (g) { st.apps.push(g); log("📩 " + st.gen[g].name + "（" + st.gen[g].job + "）來看房了"); } }
    // 修繕委託
    if (st.repairs.length < 3 && Math.random() < 0.42) {
      var cand = tenants().filter(function (id) { return !st.repairs.some(function (q) { return q.who === id; }); });
      if (cand.length) { var who = pick(cand), k = pick(D.REPAIRS); st.repairs.push({ id: "q" + st.day + who, who: who, kind: k.id }); log(k.ic + " " + M(who).short + "：" + k.name); }
    }
    // 滿意度往目標值靠近；太低就會搬走
    tenants().forEach(function (id) {
      var x = S(id), tg = target(id), rep = st.repairs.some(function (q) { return q.who === id; });
      x.sat = clamp(x.sat + (tg - x.sat) * 0.3 - (rep ? 4 : 0), 0, 100);
      if (x.dating) { x.sat = Math.max(x.sat, 30); x.low = 0; x.leaving = 0; return; }
      x.low = x.sat < 22 ? x.low + 1 : 0;
      if (!x.leaving && x.low >= 3) { x.leaving = 4; log("⚠ " + M(id).short + " 提出了退租通知（4 天後搬走，滿意度回到 35 以上就會打消念頭）"); }
      else if (x.leaving) {
        if (x.sat >= 35) { x.leaving = 0; log("😮‍💨 " + M(id).short + " 打消了搬走的念頭"); }
        else if (--x.leaving <= 0) moveOut(id);
      }
    });
    // 一般房客的租約到期就搬走（交往中的人會續約），空出房間給新的人
    tenants().filter(isGen).forEach(function (id) {
      var g = st.gen[id];
      if (g.dating || st.day < g.lease) return;
      log("📄 " + g.short + " 的租約到期了");
      moveOut(id);
    });
    if (st.clean > 0) st.clean--;
  }
  function evict(id) {
    if (!isGen(id) || S(id).dating) return;
    st.money -= 5;
    log("🙇 請 " + M(id).short + " 提前解約（補償 " + money(5) + "）");
    moveOut(id); ui.sel = null; save();
  }
  function moveOut(id) {
    var r = roomOf(id); if (r >= 0) st.rooms[r] = null;
    st.repairs = st.repairs.filter(function (q) { return q.who !== id; });
    var x = S(id); x.leaving = 0; x.low = 0;
    if (isGen(id)) { x.gone = true; log("🧳 " + M(id).short + " 搬走了"); }
    else { x.living = false; x.applied = false; x.next = st.day + 15; x.sat = 60; log("🧳 " + M(id).short + " 搬走了……（15 天後也許會再來看房）"); }
  }
  function acceptApp(id, r) {
    if (st.rooms[r]) return;
    st.apps = st.apps.filter(function (x) { return x !== id; });
    st.rooms[r] = id;
    var x = S(id); x.sat = target(id); x.low = 0; x.leaving = 0;
    if (!isGen(id)) x.living = true;
    log("🏠 " + M(id).short + " 搬進了 " + roomName(r));
    ui.place = null;
    if (!x.met) meet(id);
  }
  function declineApp(id) {
    st.apps = st.apps.filter(function (x) { return x !== id; });
    if (!isGen(id)) { st.h[id].applied = false; st.h[id].next = st.day + 7; }
    log("🙇 婉拒了 " + M(id).short + " 的入住申請");
  }
  function meet(id) {
    var x = S(id); x.met = true;
    if (isGen(id)) { var g = st.gen[id]; startVN(id, "新房客", [g.name + "，" + g.age + " 歲，" + g.job + "。", ["@", persOf(g).greet], { e: { a: 4 } }], function () { ui.screen = "hub"; save(); }); return; }
    var h = H[id];
    startVN(id, h.short + "・初次見面", h.meet.concat([h.name + "，" + h.age + " 歲，" + h.job + "。" + h.intro, { e: { a: 5 } }]), function () { ui.screen = "hub"; save(); });
  }
  function moveTenant(id, r) {
    var from = roomOf(id), other = st.rooms[r];
    if (from === r) return;
    st.rooms[from] = other || null; st.rooms[r] = id;
    S(id).sat = clamp(S(id).sat - 5, 0, 100);
    if (other) S(other).sat = clamp(S(other).sat - 5, 0, 100);
    log("📦 " + M(id).short + " 搬到 " + roomName(r) + (other ? "（和 " + M(other).short + " 交換）" : ""));
  }

  // ---------------- 白天的行動 ----------------
  function doRepair(qid) {
    var q = st.repairs.filter(function (x) { return x.id === qid; })[0]; if (!q) return;
    var k = D.REPAIRS.filter(function (x) { return x.id === q.kind; })[0], cost = st.flags.chao_tools ? Math.max(1, Math.ceil(k.cost / 2)) : k.cost;
    st.repairs = st.repairs.filter(function (x) { return x.id !== qid; });
    st.money -= cost;
    log(k.ic + " 修好了 " + M(q.who).short + " 的" + k.name + "（" + money(cost) + "）");
    startVN(q.who, k.name, k.steps.concat([{ ch: k.ch }, { e: { sat: 18 } }]), "toNight");
  }
  function dueLine(id) { if (isGen(id)) return null; var x = st.h[id]; return x.line < 3 && x.aff >= D.LINE_AFF[x.line] ? H[id].lines[x.line] : null; }
  function dueConfess(id) {
    var x = S(id);
    if (x.dating || x.cool > 0) return false;
    return isGen(id) ? x.aff >= 70 && x.talks >= 4 : x.line >= 3 && x.aff >= D.CONFESS_AFF;
  }
  function runLine(id, after) {
    var x = st.h[id], ev = H[id].lines[x.line];
    x.line++;
    log("📝 " + H[id].short + "的故事：" + ev.title + "（" + x.line + "/3）");
    startVN(id, H[id].short + "・" + ev.title + "（" + x.line + "/3）", ev.steps, after);
  }
  function runConfess(id, after) {
    var base = isGen(id) ? persOf(st.gen[id]).confess : H[id].confess;
    var steps = base.concat([{ ch: [
      { t: "抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡笑出聲，又哭又笑。", "從今晚開始，你們交往了。……在同一個屋簷下。"] },
      { t: "「……我是管理人，你是房客。」", e: { a: -12 }, r: ["她愣了一下，然後低下頭：「……也是呢。」", "她轉身上樓了。你聽到她的房門，輕輕地關上。"] }
    ] }]);
    startVN(id, M(id).short + "・告白", steps, function () {
      var x = S(id), need = isGen(id) ? 76 : D.CONFESS_AFF + 5;
      if (x.aff >= need) { x.dating = true; log("💕 和 " + M(id).short + " 開始交往"); } else x.cool = 3;
      after();
    });
  }
  function talk(id) {
    var x = S(id); x.talks = (x.talks || 0) + 1;
    log("☕ 和 " + M(id).short + " 聊天");
    if (dueConfess(id)) { runConfess(id, toNight); return; }
    if (dueLine(id)) { runLine(id, "toNight"); return; }
    var c;
    if (isGen(id)) c = pick(persOf(st.gen[id]).chat);
    else c = pick([["今天工作的時候，發生了好多事。……想聽嗎？", "「想聽。慢慢說。」", "「嗯，說吧。」"], ["今天好累……可以在這裡多待一下嗎？", "「待多久都可以。」", "「嗯，休息一下吧。」"], ["管理人，你在這棟樓住得習慣嗎？", "「有你們在，很習慣。」", "「還在適應。」"], ["我房間的窗戶看出去，可以看到一棵好大的樹。……下次來看？", "「好。今晚就去。」", "「改天吧。」"]]);
    var good = { t: c[1], e: { a: 9, sat: 4 } }, ok = { t: c[2], e: { a: 5, sat: 2 } };
    startVN(id, "聊天・" + M(id).short, [["@", c[0]], { ch: Math.random() < 0.5 ? [good, ok] : [ok, good] }], "toNight");
  }
  function doClean() { st.clean = 5; log("🧹 把公共空間打掃得乾乾淨淨（5 天內全員舒適度 +）"); ui.toast = "打掃完成：5 天內全員滿意度提升"; toNight(); }
  function doWork() { st.money += 7; log("🏪 去便利商店打工（+" + money(7) + "）"); ui.toast = "打工：+" + money(7); toNight(); }
  var RENO = [25, 40];
  function renovate(r) {
    var g = st.grade[r]; if (g >= 2) return;
    var cost = RENO[g]; if (st.money < cost) { ui.toast = "錢不夠"; return; }
    st.money -= cost; st.grade[r]++;
    log("🔨 翻修 " + roomName(r) + "（等級 " + st.grade[r] + "，" + money(cost) + "）");
    ui.reno = false; toNight();
  }

  // ---------------- 夜晚 ----------------
  function goSpace(sp) {
    var space = D.SPACES.filter(function (s) { return s.id === sp; })[0];
    var here = tenants().filter(function (id) { return isGen(id) ? Math.random() < 0.25 : H[id].spots.indexOf(sp) >= 0; }).filter(function (id) { return S(id).met; });
    var due = here.filter(function (id) { return dueLine(id) || dueConfess(id); });
    var who = due.length && Math.random() < 0.85 ? pick(due) : here.length && Math.random() < 0.85 ? pick(here) : null;
    if (!who) { log(space.ic + " " + space.name + "：沒有遇到誰"); startVN(null, space.name, [space.quiet], "endNight"); return; }
    log(space.ic + " " + space.name + "：遇到 " + M(who).short);
    if (dueConfess(who)) { runConfess(who, endNight); return; }
    if (dueLine(who)) { runLine(who, "endNight"); return; }
    var hs = D.HAPPEN.filter(function (e) { return e.sp === sp; });
    if (hs.length && Math.random() < 0.4) {
      var e = pick(hs), x = S(who), ok = x.aff >= e.bold.need || x.dating;
      var bold = { t: e.bold.t, e: { a: ok ? 10 : -4 }, r: ok ? e.bold.ok : e.bold.ng };
      log("💓 意外：" + e.title + "（" + M(who).short + "）");
      startVN(who, "意外・" + e.title, e.steps.concat([{ ch: [e.safe, bold] }]), "endNight");
      return;
    }
    var f = pick(D.FREE.filter(function (x) { return x.sp === sp; }));
    startVN(who, space.name, f.steps.concat([{ ch: f.ch }]), "endNight");
  }
  function visit(id) {
    var others = dating().filter(function (x) { return x !== id && roomOf(x) >= 0; });
    if (others.length && Math.random() < 0.2) {
      var o = pick(others);
      startVN(o, "修羅場", D.JEALOUS.slice().concat([{ e: { a: -6, sat: -6 } }]), function () { openStory(id, endNight); });
      ui.vn.sub.m = id;
      log("💢 修羅場：" + M(o).short + " 撞見你從 " + M(id).short + " 的房間出來");
      return;
    }
    openStory(id, endNight);
  }
  function knock() {
    var id = st.knock; st.knock = null;
    startVN(id, "深夜的敲門聲", D.KNOCK.slice(), function () { openStory(id, endNight); render(); });
  }
  function openStory(id, after) {
    var x = S(id), story, key, own = !isGen(id) && N.OWN[id];
    if (own && x.nights < own.length) { story = own[x.nights]; key = "own" + x.nights + "_" + id; }
    else {
      var k; do { k = rnd(0, N.SHARED.length - 1); } while (N.SHARED.length > 1 && k === st.lastShared);
      st.lastShared = k; story = N.SHARED[k]; key = "sh" + k + "_" + id;
    }
    x.nights++; addAff(id, 4); x.sat = clamp(x.sat + 6, 0, 100);
    log("🌙 和 " + M(id).short + " 共度夜晚：" + story.title);
    if (isGen(id)) addAlbum("gen|" + x.img + "|" + x.name + "|" + key.split("_")[0].slice(2));
    else addAlbum(key);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: after };
    ui.screen = "story";
  }
  function endNight() {
    Object.keys(st.h).forEach(function (id) { if (st.h[id].cool > 0) st.h[id].cool--; });
    Object.keys(st.gen).forEach(function (id) { if (st.gen[id].cool > 0) st.gen[id].cool--; });
    st.day = Math.min(D.DAYS, st.day + 1);
    st.phase = "day"; st.knock = null;
    ui.screen = "hub"; ui.panel = null;
    dayStart();
    if (st.day === 60 && !st.flags.dev60) { st.flags.dev60 = 1; startVN(null, "第六十天", ["玄關前又停了那台黑色的車。", ["?建商", "管理人先生，還剩三十天。考慮得怎麼樣了？"], ["me", "……我說過了。不賣。"], "車開走了。你轉過身，看到好幾個房客站在玄關，看著你。", "沒有人說話。可是那天晚上，交誼廳的燈，亮到很晚。"], function () { ui.screen = "hub"; save(); }); }
    save(); render();
  }

  // ---------------- 結局 ----------------
  function finalDay() {
    collectRent(true);
    ui.screen = "final"; render();
  }
  function ending(partner) {
    st.ended = true;
    var saved = st.money >= D.DEBT, avg = avgSat(), ds = dating();
    var tier = !saved ? "sold" : avg >= 70 && tenants().length >= 16 ? "bloom" : "saved";
    var rel = partner ? "true" : ds.length ? "open" : "alone";
    ui.end = { tier: tier, rel: rel, partner: partner, avg: avg, money: st.money, n: tenants().length };
    var best = load(BEST_KEY) || {};
    best[tier] = (best[tier] || 0) + 1;
    if (partner && !isGen(partner)) best["true_" + partner] = 1;
    store(BEST_KEY, best); store(SAVE_KEY, null);
    ui.screen = "ending"; render();
  }

  // ---------------- 畫面 ----------------
  function portrait(id, cls) { if (!id || !M(id)) return ""; return '<img class="ns-pt ' + (cls || "") + '" src="' + IMG + esc(imgOf(id)) + '" alt="" style="--ns-c:' + M(id).color + '">'; }
  function bar(v, cls) { return '<span class="ns-bar ' + (cls || "") + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></span>'; }
  function tagIcons(id, kinds) {
    var t = tagsOf(id), out = [];
    (kinds || ["emits", "sens", "traits", "prefs"]).forEach(function (k) { t[k].forEach(function (x) { out.push('<span class="ns-tag ns-tag-' + D.TAGS[x].kind + '" title="' + esc(D.TAGS[x].name + "：" + D.TAGS[x].desc) + '">' + D.TAGS[x].ic + "</span>"); }); });
    return out.join("");
  }
  function tagList(id) {
    var t = tagsOf(id), out = [];
    ["emits", "sens", "traits", "prefs"].forEach(function (k) { t[k].forEach(function (x) { out.push('<span class="ns-tagl ns-tag-' + D.TAGS[x].kind + '">' + D.TAGS[x].ic + " " + esc(D.TAGS[x].name) + "</span>"); }); });
    return out.join(" ") || '<span class="ns-muted ns-small">（沒有特別的特質）</span>';
  }
  function satCls(v) { return v >= 70 ? "ns-good" : v >= 45 ? "ns-mid" : v >= 25 ? "ns-low" : "ns-bad"; }

  function render() {
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    var h = "";
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "final") h = renderFinal();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else if (ui.screen === "cast") h = renderCast();
    else h = renderHub();
    if (ui.toast) { h += '<div class="ns-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="ns-root">' + h + "</div>";
  }
  function renderAge() {
    return '<div class="ns-age"><p class="ns-age-mark">18+</p><h2>本遊戲含成人向內容</h2><p>遊戲中有成年角色之間的親密、性暗示描寫。登場人物全員皆為 21 歲以上的成年人。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="ns-row"><button class="ns-btn ns-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="ns-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY), best = load(BEST_KEY) || {};
    var h = '<div class="ns-title"><p class="ns-sub">台北・巷子裡的老公寓</p><h1>秘密的同居生活</h1><p class="ns-tag">二十個房間，二十個她。<br>房間怎麼排、誰住在誰隔壁——還有，夜裡誰會來敲你的門。</p>';
    h += '<div class="ns-faces">' + D.HEROINES.map(function (x) { return '<img class="ns-pt ns-face" src="' + IMG + esc((saved && saved.img && saved.img[x.id]) || x.img) + '" alt="">'; }).join("") + "</div>";
    h += '<div class="ns-row">';
    if (saved) h += '<button class="ns-btn ns-primary" data-act="continue">繼續（第 ' + saved.day + " 天）</button>";
    h += '<button class="ns-btn' + (saved ? "" : " ns-primary") + '" data-act="new">' + (saved ? "重新開始" : "成為管理人") + '</button><button class="ns-btn" data-act="album">夜晚回憶</button></div>';
    var trues = Object.keys(best).filter(function (k) { return k.indexOf("true_") === 0; }).length;
    if (best.bloom || best.saved || trues) h += '<p class="ns-muted ns-small">' + (best.bloom ? "🌸 椿莊滿開 " + best.bloom + " 次　" : "") + (best.saved ? "🏠 守住椿莊 " + best.saved + " 次　" : "") + (trues ? "💕 真結局 " + trues + "／20" : "") + "</p>";
    return h + "</div>";
  }
  function renderCast() {
    var h = '<div class="ns-panel"><h2>選角：她們的樣子</h2><p class="ns-small ns-muted">點一位房客，從頭像庫幫她換外觀。名字和故事不變。</p><div class="ns-grid">';
    h += D.HEROINES.map(function (x) { return '<button class="ns-card' + (ui.castPick === x.id ? " ns-lovecard" : "") + '" data-act="castPick" data-id="' + x.id + '">' + portrait(x.id, "ns-mid-pt") + "<b>" + esc(x.name) + '</b><span class="ns-small ns-muted">' + esc(x.job) + "</span></button>"; }).join("") + "</div>";
    if (ui.castPick) {
      var used = usedImgs(); delete used[imgOf(ui.castPick)];
      h += "<h3>" + esc(M(ui.castPick).name) + ' 的外觀</h3><div class="ns-gallery">' + C.POOL.filter(function (img) { return !used[img]; }).map(function (img) {
        return '<button class="ns-gimg' + (imgOf(ui.castPick) === img ? " ns-gsel" : "") + '" data-act="castImg" data-img="' + img + '"><img src="' + IMG + img + '" alt="" loading="lazy"></button>';
      }).join("") + "</div>";
    }
    return h + '<div class="ns-row"><button class="ns-btn" data-act="castRandom">全部隨機</button><button class="ns-btn" data-act="castReset">恢復預設</button><button class="ns-btn ns-primary" data-act="castStart">搬進椿莊</button></div></div>';
  }
  function renderTop() {
    var left = D.DAYS - st.day;
    return '<div class="ns-top"><div><b class="ns-day">第 ' + st.day + " 天</b>／" + D.DAYS + '　<span class="ns-phase">' + (st.phase === "day" ? "☀ 白天" : "🌙 夜晚") + "</span></div>" +
      '<div class="ns-small"><span class="' + (st.money < 0 ? "ns-warn" : "") + '">💰 ' + money(st.money) + '</span>　🏦 貸款 ' + money(D.DEBT) + "（剩 " + left + ' 天）　😊 平均滿意 <b>' + Math.round(avgSat()) + "</b>　🏠 " + tenants().length + "／" + NR + "</div>" +
      '<div class="ns-tabs"><button class="ns-btn ns-sm" data-act="panel" data-p="roster">房客名簿</button> <button class="ns-btn ns-sm" data-act="panel" data-p="help">配置規則</button> <button class="ns-btn ns-sm" data-act="panel" data-p="log">紀錄</button> <button class="ns-btn ns-sm" data-act="title">標題</button></div></div>';
  }
  function renderBuilding() {
    var sel = ui.sel, place = ui.place;
    var h = '<div class="ns-panel"><h3>🏢 椿莊</h3>';
    if (place) h += '<p class="ns-hint">選一間<b>空房</b>給 ' + esc(M(place).short) + ' 住（數字＝她在那間房的預估滿意度）。 <button class="ns-btn ns-sm" data-act="cancelmode">取消</button></p>';
    else if (ui.reno) h += '<p class="ns-hint">選一間要翻修的房間（等級 0→1：' + money(RENO[0]) + "、1→2：" + money(RENO[1]) + '；房租與滿意度提高）。 <button class="ns-btn ns-sm" data-act="cancelmode">取消</button></p>';
    else if (sel) h += '<p class="ns-hint">' + esc(M(sel).short) + ' 要搬到哪裡？點空房＝搬過去，點別人＝交換（數字＝她在那間房的預估滿意度，搬家會讓雙方滿意度 -5）。 <button class="ns-btn ns-sm" data-act="cancelmode">取消</button></p>';
    else h += '<p class="ns-small ns-muted">點一位房客可以看她的特質與滿意度的原因，再點別的房間就能搬家或交換（不花時間）。</p>';
    h += '<div class="ns-bldg">';
    for (var f = D.FLOORS - 1; f >= 0; f--) {
      h += '<div class="ns-floor"><span class="ns-flabel">' + (f + 1) + "F</span>";
      for (var c = 0; c < D.COLS; c++) {
        var r = f * D.COLS + c, id = st.rooms[r], cls = "ns-room", inner = "";
        var pv = (sel && r !== roomOf(sel)) ? preview(sel, r) : place && !id ? preview(place, r) : null;
        if (id) {
          var x = S(id), rep = st.repairs.some(function (q) { return q.who === id; });
          cls += " " + satCls(x.sat) + (sel === id ? " ns-selroom" : "") + (x.dating ? " ns-loveroom" : "");
          inner = portrait(id, "ns-rpt") + '<span class="ns-rname">' + esc(M(id).short) + (x.dating ? " 💕" : "") + (rep ? " 🔧" : "") + (x.leaving ? " ⚠" : "") + "</span>" + bar(x.sat, "ns-sat " + satCls(x.sat)) + '<span class="ns-ricons">' + tagIcons(id, ["emits"]) + "</span>";
        } else { cls += " ns-empty"; inner = '<span class="ns-small ns-muted">空房</span><span class="ns-small ns-muted">' + money(rentOf(r)) + "</span>"; }
        if (st.grade[r]) inner += '<span class="ns-grade">' + "★".repeat(st.grade[r]) + "</span>";
        if (pv != null) inner += '<span class="ns-pv ' + satCls(pv) + '">' + pv + "</span>";
        h += '<button class="' + cls + '" data-act="room" data-r="' + r + '"><span class="ns-rno">' + roomName(r) + "</span>" + inner + "</button>";
      }
      h += "</div>";
    }
    h += '<div class="ns-floor ns-ground"><span class="ns-flabel"></span><span class="ns-small ns-muted">🚪 玄關・管理人室・🛋 交誼廳・♨ 大浴場・🍲 廚房</span></div></div>';
    if (sel) {
      var cf = comfort(sel, roomOf(sel), st.rooms), xs = S(sel);
      h += '<div class="ns-detail">' + portrait(sel, "ns-mid-pt") + "<div><b>" + esc(M(sel).name) + '</b> <span class="ns-small ns-muted">' + (M(sel).age) + " 歲・" + esc(M(sel).job) + "・" + roomName(roomOf(sel)) + "</span><div>" + tagList(sel) + "</div>" +
        '<p class="ns-small">滿意度 <b class="' + satCls(xs.sat) + '">' + Math.round(xs.sat) + "</b> → 目標 <b>" + target(sel) + "</b>　好感 " + xs.aff + "（" + tierName(xs.aff) + "）" + (xs.leaving ? '　<span class="ns-warn">⚠ ' + xs.leaving + " 天後搬走</span>" : "") + "</p>" +
        '<ul class="ns-why">' + (cf.why.length ? cf.why.map(function (w) { return '<li class="' + (w[1] > 0 ? "ns-plus" : "ns-minus") + '">' + (w[1] > 0 ? "＋" : "－") + " " + esc(w[0]) + "</li>"; }).join("") : '<li class="ns-muted">沒有特別在意的事</li>') +
        (st.grade[roomOf(sel)] ? '<li class="ns-plus">＋ 翻修過的房間</li>' : "") + (st.clean > 0 ? '<li class="ns-plus">＋ 公共空間很乾淨</li>' : "") + "</ul>" +
        (isGen(sel) ? '<p class="ns-small ns-muted">租約到第 ' + xs.lease + " 天" + (xs.dating ? "（交往中，會續約）" : "") + "</p>" + (xs.dating ? "" : '<button class="ns-btn ns-sm" data-act="evict" data-id="' + sel + '">請她提前解約（補償 ' + money(5) + "）</button>") : "") + "</div></div>";
    }
    if (st.apps.length) {
      if (!st.rooms.some(function (x) { return !x; })) h += '<p class="ns-hint">📩 有人想入住，可是沒有空房。點一位一般房客，可以請她提前解約；一般房客的租約到期也會自己搬走。</p>';
      h += '<h4>📩 想入住的人</h4><div class="ns-grid">' + st.apps.map(function (id) {
        return '<div class="ns-card' + (isGen(id) ? "" : " ns-lovecard") + (place === id ? " ns-on" : "") + '"><div class="ns-cardhead">' + portrait(id, "ns-mini") + "<div><b>" + esc(M(id).name) + "</b>" + (isGen(id) ? "" : ' <span class="ns-new">★</span>') + '<br><span class="ns-small ns-muted">' + M(id).age + " 歲・" + esc(M(id).job) + "</span></div></div><div>" + tagList(id) + '</div><div class="ns-row ns-row-l"><button class="ns-btn ns-sm ns-primary" data-act="accept" data-id="' + id + '">選房間</button><button class="ns-btn ns-sm" data-act="decline" data-id="' + id + '">婉拒</button></div></div>';
      }).join("") + "</div>";
    }
    return h + "</div>";
  }
  function renderHub() {
    var h = renderTop();
    if (ui.panel === "roster") h += renderRoster();
    else if (ui.panel === "help") h += renderHelp();
    else if (ui.panel === "log") h += '<div class="ns-panel"><h3>紀錄</h3><ul class="ns-log">' + st.log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + '</ul><button class="ns-btn ns-sm" data-act="panel" data-p="">關閉</button></div>';
    if (st.day >= D.DAYS && st.phase === "day") {
      h += '<div class="ns-panel ns-center"><h2>🏦 還款日</h2><p>九十天到了。銀行和建商，都在玄關等著。</p><p>目前 ' + money(st.money) + "／貸款 " + money(D.DEBT) + '（今天還會收最後一期房租）</p><button class="ns-btn ns-primary" data-act="final">前往玄關</button></div>';
      return h;
    }
    var unmet = tenants().filter(function (id) { return !S(id).met; });
    if (unmet.length) h += '<div class="ns-panel"><h3>👋 還沒打招呼的房客</h3><div class="ns-grid">' + unmet.map(function (id) { return '<button class="ns-card ns-lovecard" data-act="meet" data-id="' + id + '">' + portrait(id, "ns-mini") + "<b>" + esc(M(id).short) + ' <span class="ns-new">！</span></b><span class="ns-small">' + esc(M(id).job) + "</span></button>"; }).join("") + "</div></div>";
    h += renderBuilding();
    if (st.phase === "day") {
      h += '<div class="ns-panel"><h3>☀ 白天要做什麼？（選一件）</h3>';
      if (st.repairs.length) h += "<h4>🔧 修繕委託</h4>" + '<div class="ns-grid">' + st.repairs.map(function (q) {
        var k = D.REPAIRS.filter(function (x) { return x.id === q.kind; })[0], cost = st.flags.chao_tools ? Math.max(1, Math.ceil(k.cost / 2)) : k.cost;
        return '<button class="ns-card" data-act="repair" data-id="' + q.id + '">' + portrait(q.who, "ns-mini") + "<b>" + k.ic + " " + esc(k.name) + '</b><span class="ns-small">' + esc(M(q.who).short) + "・" + roomName(roomOf(q.who)) + '</span><span class="ns-small ns-muted">材料費 ' + money(cost) + "・她的滿意度大幅提升</span></button>";
      }).join("") + "</div>";
      var met = tenants().filter(function (id) { return S(id).met; });
      h += '<h4>☕ 去她的房間聊天</h4><div class="ns-grid">' + met.map(function (id) {
        var x = S(id), mark = dueLine(id) || dueConfess(id) ? ' <span class="ns-new">！</span>' : "";
        return '<button class="ns-card" data-act="talk" data-id="' + id + '">' + portrait(id, "ns-mini") + "<b>" + esc(M(id).short) + mark + (x.dating ? " 💕" : "") + '</b><span class="ns-small ns-muted">' + tierName(x.aff) + (isGen(id) ? "" : "・故事 " + x.line + "/3") + "</span></button>";
      }).join("") + "</div>";
      h += '<h4>🧰 其他</h4><div class="ns-row ns-row-l"><button class="ns-btn" data-act="clean">🧹 打掃公共空間（5 天內全員＋）</button><button class="ns-btn" data-act="reno">🔨 翻修房間</button><button class="ns-btn" data-act="work">🏪 打工（+' + money(7) + "）</button></div></div>";
    } else {
      h += '<div class="ns-panel"><h3>🌙 夜晚</h3>';
      if (st.knock) h += '<div class="ns-row"><button class="ns-btn ns-primary ns-knock" data-act="knock">🚪 管理人室的門……有人在敲</button></div>';
      h += '<div class="ns-grid">' + D.SPACES.map(function (s) {
        var fans = tenants().filter(function (id) { return !isGen(id) && H[id].spots.indexOf(s.id) >= 0 && S(id).met; }).map(function (id) { return H[id].short; }).join("、");
        return '<button class="ns-card" data-act="space" data-id="' + s.id + '"><b>' + s.ic + " " + esc(s.name) + '</b><span class="ns-small ns-muted">常出沒：' + esc(fans || "—") + "</span></button>";
      }).join("") + "</div>";
      var ds = dating().filter(function (id) { return roomOf(id) >= 0; });
      if (ds.length) {
        h += '<h4>💕 去她的房間</h4><div class="ns-grid">' + ds.map(function (id) { return '<button class="ns-card ns-lovecard" data-act="visit" data-id="' + id + '">' + portrait(id, "ns-mini") + "<b>" + esc(M(id).short) + '</b><span class="ns-small">' + roomName(roomOf(id)) + "・" + (S(id).nights ? "共度了 " + S(id).nights + " 晚" : "第一次的夜晚") + "</span></button>"; }).join("") + "</div>";
        if (ds.length >= 2) h += '<p class="ns-small ns-warn">同一棟樓裡和 ' + ds.length + " 個人交往中……走廊上小心。</p>";
      }
      h += '<div class="ns-row"><button class="ns-btn ns-sm" data-act="sleep">早點睡</button></div></div>';
    }
    return h;
  }
  function renderHelp() {
    var h = '<div class="ns-panel"><h3>配置規則</h3><p class="ns-small">每個人的滿意度每天會往「目標值」靠近。目標值＝55 ＋ 9 × 舒適度（＋翻修、打掃）。滿意度決定房租（70 以上全額、45 以上 85%、25 以上 60%、更低只收 30%），連續 3 天低於 22 會提出退租。</p><ul class="ns-helplist">';
    Object.keys(D.TAGS).forEach(function (k) { var t = D.TAGS[k]; h += '<li><span class="ns-tagl ns-tag-' + t.kind + '">' + t.ic + " " + esc(t.name) + "</span> " + esc(t.desc) + "</li>"; });
    return h + '</ul><p class="ns-small ns-muted">左右＝同樓層相鄰的房間；樓上樓下＝同一欄。A、D 是角間。</p><button class="ns-btn ns-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderRoster() {
    var h = '<div class="ns-panel"><h3>房客名簿</h3><div class="ns-roster">';
    D.HEROINES.forEach(function (m) {
      var x = st.h[m.id];
      if (!x.met) { h += '<div class="ns-mem ns-dim">' + portrait(m.id, "ns-mini") + '<div><b>？？？</b> <span class="ns-small ns-muted">' + esc(m.job) + "・" + (x.applied ? "正在等你回覆入住申請" : x.living ? "已入住、還沒打招呼" : "第 " + x.next + " 天左右會來看房") + "</span></div></div>"; return; }
      h += '<div class="ns-mem">' + portrait(m.id, "ns-mid-pt") + "<div><b>" + esc(m.name) + '</b> <span class="ns-small ns-muted">' + m.age + " 歲・" + esc(m.job) + "・" + esc(m.pers) + "</span><p class=\"ns-small\">" + esc(m.intro) + "</p><div>" + tagList(m.id) + "</div>" +
        '<p class="ns-small">' + (x.living ? roomName(roomOf(m.id)) + "　滿意度 " + Math.round(x.sat) : "（目前沒有住在椿莊）") + "　好感 " + bar(x.aff, "ns-aff") + " " + x.aff + "（" + tierName(x.aff) + "）" + (x.dating ? "　💕 交往中" : "") + "</p>" +
        '<p class="ns-small ns-muted">故事 ' + x.line + "/3" + (x.line < 3 ? "（下一段：好感 " + D.LINE_AFF[x.line] + "）" : x.dating ? "" : "（好感 " + D.CONFESS_AFF + " 會有特別的事）") + "　常去：" + m.spots.map(function (s) { return D.SPACES.filter(function (y) { return y.id === s; })[0].name; }).join("、") + "</p></div></div>";
    });
    var gs = Object.keys(st.gen).filter(function (id) { return st.gen[id].met && !st.gen[id].gone; });
    h += '</div><h3>其他房客（' + gs.length + "）</h3><div class=\"ns-roster\">";
    gs.forEach(function (id) {
      var g = st.gen[id];
      h += '<div class="ns-mem">' + portrait(id, "ns-mini") + "<div><b>" + esc(g.name) + '</b> <span class="ns-small ns-muted">' + g.age + " 歲・" + esc(g.job) + "・" + esc(persOf(g).name) + "</span><div>" + tagList(id) + '</div><p class="ns-small">' + (roomOf(id) >= 0 ? roomName(roomOf(id)) + "　滿意度 " + Math.round(g.sat) + "　" : "") + "好感 " + g.aff + "（" + tierName(g.aff) + "）" + (g.dating ? "　💕 交往中" : "") + "</p></div></div>";
    });
    return h + '</div><button class="ns-btn ns-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderFinal() {
    var saved = st.money >= D.DEBT, ds = dating();
    var h = '<div class="ns-panel ns-center"><h2>🏦 還款日</h2><p>最後一期房租也收齊了。手上的錢：<b>' + money(st.money) + "</b>／貸款 " + money(D.DEBT) + "</p>";
    h += saved ? '<p class="ns-good">你把一疊鈔票放在銀行專員的面前。建商的車，在巷口停了很久，然後開走了。</p>' : '<p class="ns-warn">差了 ' + money(D.DEBT - st.money) + "。銀行專員搖了搖頭。建商的人，在玄關笑了。</p>";
    if (ds.length) {
      h += '<h3>最後一晚，你想和誰一起迎接早晨？</h3><div class="ns-grid">' + ds.map(function (id) { return '<button class="ns-card ns-lovecard" data-act="partner" data-id="' + id + '">' + portrait(id, "ns-mid-pt") + "<b>" + esc(M(id).name) + "</b></button>"; }).join("") + "</div>";
      h += '<div class="ns-row"><button class="ns-btn" data-act="partner" data-id="">一個人</button></div>';
    } else h += '<div class="ns-row"><button class="ns-btn ns-primary" data-act="partner" data-id="">迎接早晨</button></div>';
    return h + "</div>";
  }
  function renderEnding() {
    var e = ui.end, p = e.partner;
    var head = { bloom: "🌸 椿莊滿開", saved: "🏠 守住了椿莊", sold: "🏚 椿莊的最後一天" }[e.tier];
    var body = {
      bloom: "還清貸款的那天晚上，椿莊的交誼廳擠滿了人。二十個房間，幾乎每一間都亮著燈。有人開了香檳，有人彈起了貝斯。外婆的木牌還掛在玄關：「住在這裡的人，都是家人。」——這句話，現在是真的了。",
      saved: "貸款還清了。椿莊的招牌還掛在原來的地方。房客來了又走，有人抱怨隔壁太吵，有人在廚房煮宵夜。日子就這樣，一天一天地過下去。",
      sold: "椿莊被建商收購了。最後一天，房客們一個一個地搬走。你站在空蕩蕩的玄關，把外婆的木牌拆了下來。……可是，有些人沒有走遠。"
    }[e.tier];
    var h = '<div class="ns-panel ns-ending"><h2>' + head + '</h2><p class="ns-small ns-center">房客 ' + e.n + "／20　平均滿意度 " + Math.round(e.avg) + "　手上 " + money(e.money) + "</p><p>" + esc(body) + "</p>";
    if (p) h += '<div class="ns-partner">' + portrait(p, "ns-big") + '<p class="ns-love">💕 最後一晚，' + esc(M(p).short) + "在你的身邊。" + (e.tier === "sold" ? "她說：「椿莊沒有了也沒關係。你在的地方，就是我的家。」" : "早晨的陽光照進管理人室，她在你的懷裡醒來，說了一聲：「早安，管理人。」") + "</p></div>";
    h += "<h3>那之後的她們</h3>";
    D.HEROINES.forEach(function (m) {
      var x = st.h[m.id]; if (!x.met) return;
      var txt = x.dating ? m.epi : m.epiN;
      if (e.tier === "sold" && !x.dating) txt = m.short + "搬走了。搬家那天，她回頭看了椿莊很久。";
      h += '<div class="ns-mem">' + portrait(m.id, "ns-mini") + "<div><b>" + esc(m.name) + "</b>" + (x.dating ? " 💕" : "") + (p === m.id ? " 👑" : "") + '<p class="ns-small">' + esc(txt) + "</p></div></div>";
    });
    Object.keys(st.gen).filter(function (id) { return st.gen[id].dating; }).forEach(function (id) {
      var g = st.gen[id];
      h += '<div class="ns-mem">' + portrait(id, "ns-mini") + "<div><b>" + esc(g.name) + "</b> 💕" + (p === id ? " 👑" : "") + '<p class="ns-small">' + esc(persOf(g).epi.replace(/\{n\}/g, g.short)) + "</p></div></div>";
    });
    var ds = dating();
    if (ds.length >= 4) h += '<p class="ns-warn">……另外，你同時和 ' + ds.length + " 位房客交往的事，在還款日的慶功宴上全部穿幫了。據說那天晚上，管理人室的門被敲了一整夜——不是同一個人。</p>";
    if (!ds.length) h += '<p class="ns-muted">你沒有和任何人在一起。不過每天早上，玄關都有人對你說：「早安，管理人。」</p>';
    return h + '<div class="ns-row"><button class="ns-btn ns-primary" data-act="title">回到標題</button></div></div>';
  }
  function renderAlbum() {
    var a = album(), h = '<div class="ns-panel"><h2>夜晚回憶</h2><p class="ns-muted ns-small">看過的夜晚劇情可以在這裡重看。</p><div class="ns-roster">';
    D.HEROINES.forEach(function (m) {
      var btns = [];
      (N.OWN[m.id] || []).forEach(function (s, i) { if (a["own" + i + "_" + m.id]) btns.push('<button class="ns-btn ns-sm" data-act="replay" data-k="own' + i + '" data-id="' + m.id + '">' + esc(s.title) + "</button>"); });
      N.SHARED.forEach(function (s, i) { if (a["sh" + i + "_" + m.id]) btns.push('<button class="ns-btn ns-sm" data-act="replay" data-k="sh' + i + '" data-id="' + m.id + '">' + esc(s.title) + "</button>"); });
      h += '<div class="ns-mem"><img class="ns-pt ns-mini" src="' + IMG + esc(m.img) + '" alt=""><div><b>' + esc(m.name) + "</b><br>" + (btns.length ? btns.join(" ") : '<span class="ns-muted ns-small">？？？</span>') + "</div></div>";
    });
    var gs = {};
    Object.keys(a).forEach(function (k) { if (k.indexOf("gen|") === 0) { var p = k.split("|"); var key = p[1] + "|" + p[2]; (gs[key] = gs[key] || []).push(+p[3]); } });
    Object.keys(gs).forEach(function (key) {
      var p = key.split("|");
      h += '<div class="ns-mem"><img class="ns-pt ns-mini" src="' + IMG + esc(p[0]) + '" alt=""><div><b>' + esc(p[1]) + '</b> <span class="ns-small ns-muted">房客</span><br>' +
        gs[key].sort().map(function (i) { return '<button class="ns-btn ns-sm" data-act="replayGen" data-k="' + i + '" data-img="' + esc(p[0]) + '" data-name="' + esc(p[1]) + '">' + esc(N.SHARED[i].title) + "</button>"; }).join(" ") + "</div></div>";
    });
    return h + '</div><div class="ns-row"><button class="ns-btn" data-act="title">返回</button></div></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], h = '<div class="ns-vn">';
    if (v.title) h += '<p class="ns-vn-title">' + esc(v.title) + "</p>";
    var who = null, text = "";
    if (typeof s === "string") text = s; else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var speaker = who === "@" ? v.who : who, npc = speaker && speaker.charAt(0) === "?";
    var showPt = speaker && speaker !== "me" && !npc && M(speaker) ? speaker : v.who;
    h += '<div class="ns-stage">' + (showPt ? portrait(showPt, "ns-vnpt") : "") + '</div><div class="ns-box">';
    if (who) h += '<p class="ns-name" style="color:' + (speaker && !npc && speaker !== "me" && M(speaker) ? M(speaker).color : "#ffd59a") + '">' + esc(speaker === "me" ? "你" : npc ? speaker.slice(1) : M(speaker).name) + "</p>";
    if (s && s.ch) h += '<div class="ns-choices">' + s.ch.map(function (c, k) { return '<button class="ns-btn ns-choice" data-act="ch" data-k="' + k + '">' + esc(fill(c.t)) + "</button>"; }).join("") + "</div>";
    else h += '<p class="ns-text">' + esc(fill(text)) + '</p><button class="ns-btn ns-primary ns-next" data-act="next">▼</button>';
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story, m = s.look || M(s.who);
    var h = '<div class="ns-story"><p class="ns-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + "</small></p>";
    h += '<div class="ns-stage ns-stage-night">' + (s.look ? '<img class="ns-pt ns-vnpt" src="' + IMG + esc(s.look.img) + '" alt="">' : portrait(s.who, "ns-vnpt")) + "</div>";
    h += '<div class="ns-box ns-box-night"><p class="ns-text">' + esc(String(s.pages[s.i]).replace(/\{n\}/g, m.short)) + '</p><div class="ns-row">' + (s.i > 0 ? '<button class="ns-btn ns-sm" data-act="sprev">上一段</button>' : "") +
      '<button class="ns-btn ns-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
    return h;
  }

  // ---------------- 輸入 ----------------
  function clickRoom(r) {
    var id = st.rooms[r];
    if (ui.reno) { if (st.phase !== "day") return; renovate(r); return; }
    if (ui.place) { if (!id) acceptApp(ui.place, r); else ui.toast = "這間有人住了，選空房"; return; }
    if (ui.sel) { if (ui.sel === id) ui.sel = null; else { moveTenant(ui.sel, r); ui.sel = null; save(); } return; }
    if (id) ui.sel = id;
  }
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); ui.screen = st ? "hub" : "title"; render(); return; }
    if (act === "title") { if (st && !st.ended) save(); ui.screen = "title"; ui.panel = null; ui.sel = null; ui.place = null; ui.reno = false; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") {
      var k = b.getAttribute("data-k"), story = k.indexOf("own") === 0 ? N.OWN[id][+k.slice(3)] : N.SHARED[+k.slice(2)];
      ui.story = { who: null, look: { img: H[id].img, short: H[id].short }, title: story.title, pages: story.pages, i: 0, after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "replayGen") {
      var sk = N.SHARED[+b.getAttribute("data-k")], nm = b.getAttribute("data-name");
      ui.story = { who: null, look: { img: b.getAttribute("data-img"), short: nm.length > 2 ? nm.slice(1) : nm }, title: sk.title, pages: sk.pages, i: 0, after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "castPick") { ui.castPick = ui.castPick === id ? null : id; render(); return; }
    if (act === "castImg") { st.img[ui.castPick] = b.getAttribute("data-img"); render(); return; }
    if (act === "castRandom") { randomizeCast(); render(); return; }
    if (act === "castReset") { st.img = {}; render(); return; }
    if (act === "castStart") { startStory(); render(); return; }
    if (act === "panel") { var p = b.getAttribute("data-p"); ui.panel = ui.panel === p ? null : (p || null); render(); return; }
    if (act === "room") { clickRoom(+b.getAttribute("data-r")); render(); return; }
    if (act === "cancelmode") { ui.sel = null; ui.place = null; ui.reno = false; render(); return; }
    if (act === "accept") { ui.place = id; ui.sel = null; ui.reno = false; render(); return; }
    if (act === "decline") { declineApp(id); if (ui.place === id) ui.place = null; save(); render(); return; }
    if (act === "meet") { meet(id); render(); return; }
    if (act === "evict") { evict(id); render(); return; }
    if (act === "repair") { doRepair(id); render(); return; }
    if (act === "talk") { ui.sel = null; talk(id); render(); return; }
    if (act === "clean") { doClean(); render(); return; }
    if (act === "work") { doWork(); render(); return; }
    if (act === "reno") { ui.reno = true; ui.sel = null; ui.place = null; render(); return; }
    if (act === "space") { ui.sel = null; goSpace(id); render(); return; }
    if (act === "visit") { ui.sel = null; visit(id); render(); return; }
    if (act === "knock") { knock(); render(); return; }
    if (act === "sleep") { log("🛌 早早睡了"); endNight(); return; }
    if (act === "final") { finalDay(); return; }
    if (act === "partner") { ending(id || null); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s = ui.story; if (s.i + 1 < s.pages.length) { s.i++; render(); } else { ui.story = null; s.after(); render(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " && ev.key !== "Enter") return;
    var btn = app.querySelector(".ns-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  window.PriTestNest = { _state: function () { return st; }, _ui: function () { return ui; }, comfort: comfort, target: target, preview: preview };
  render();
})();
