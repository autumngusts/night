// 盛夏合宿（natsu）：規則與畫面。30 天的海邊集訓營，你是企業女排「海燕」的代理教練。
// 每天：晨練（選菜單）→ 午後（個別指導／練習賽）→ 夜晚（自由行動、個人線、交往後的夜晚）。第 30 天全國企業盃準決賽與決賽。
// 2026-11-11 依使用者需求新增。18 禁確認沿用冠軍教練（champ）的做法。
(function () {
  "use strict";

  var D = window.PriTestNatsuData, N = window.PriTestNatsuNight, MORE = window.PriTestNatsuNightMore || { OWN: {}, SHARED: [], FREE: [] }, C = window.PriTestNatsuCast;
  // 夜晚劇情加量（2026-11-12）：每人第一段在 N.OWN，之後的專屬夜晚在 MORE.OWN；共用夜晚與自由行動事件也併入
  function ownList(id) { return (N.OWN[id] ? [N.OWN[id]] : []).concat(MORE.OWN[id] || []); }
  function ownKey(id, i) { return (i ? "own" + i + "_" : "own_") + id; }
  var SHARED_ALL = N.SHARED.concat(MORE.SHARED || []);
  var FREE_ALL = D.FREE.concat(MORE.FREE || []);
  var app = document.getElementById("nt-app");
  if (!D || !N || !C || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-natsu-save-v1";
  var AGE_KEY = "pritest-natsu-age-ok";
  var ALBUM_KEY = "pritest-natsu-album";

  var st = null;
  var ui = { screen: "title", vn: null, story: null, match: null, panel: null, toast: "", ageOk: false };

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

  // 隊員（D.BY_ID）與邂逅角色（st.enc，id 以 e 開頭）共用 M／S
  function isEnc(id) { return !!id && id.charAt(0) === "e" && !D.BY_ID[id]; }
  function M(id) { return D.BY_ID[id] || (st && st.enc && st.enc[id]); }
  function S(id) { return isEnc(id) ? st.enc[id] : st.m[id]; }
  function imgOf(id) { if (D.BY_ID[id]) return (st && st.img && st.img[id]) || D.BY_ID[id].img; var e = M(id); return e ? e.img : ""; }
  function encIds() { return st && st.enc ? Object.keys(st.enc) : []; }
  function ovr(id) { var s = S(id).s; return Math.round((s.atk + s.rcv + s.srv + s.blk + s.set) / 5); }
  function teamOvr() { var t = 0; D.MEMBERS.forEach(function (m) { t += ovr(m.id); }); return Math.round(t / D.MEMBERS.length); }
  function dating() { return D.MEMBERS.map(function (m) { return m.id; }).concat(encIds()).filter(function (id) { return S(id).dating; }); }
  function persOf(e) { return C.PERS.filter(function (p) { return p.id === e.pers; })[0]; }
  function tierName(a) { return a >= 90 ? "摯愛" : a >= 75 ? "心動" : a >= 55 ? "信賴" : a >= 35 ? "親近" : a >= 15 ? "熟悉" : "隊員"; }

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { day: 1, phase: "morning", chem: 40, flags: {}, log: [], res: {}, lastShared: -1, ended: false, m: {}, img: {}, enc: {} };
    D.MEMBERS.forEach(function (m) {
      var s = {}; D.STATS.forEach(function (k) { s[k] = m.s[k]; });
      st.m[m.id] = { s: s, sta: 100, cond: 0, aff: rnd(0, 6), line: 0, dating: false, nights: 0, inj: 0, cool: 0 };
    });
    ui.panel = null; ui.castPick = null;
    ui.screen = "cast";
  }
  // 選角：替隊員換外觀（只能選頭像池 C.POOL，且不和其他隊員重複）
  function usedByCast(except) { var u = {}; D.MEMBERS.forEach(function (m) { if (m.id !== except) u[imgOf(m.id)] = 1; }); return u; }
  function randomizeCast() {
    var pool = C.POOL.slice(), out = {};
    D.MEMBERS.forEach(function (m) { var k = rnd(0, pool.length - 1); out[m.id] = pool[k]; pool.splice(k, 1); });
    st.img = out;
  }
  function startCamp() {
    ui.castPick = null;
    startVN(null, "合宿第一天", [
      "七月中旬，白砂灣。蟬聲大得像是要把天空撕開。",
      "企業女排「藍鷗電子・海燕隊」的總教練住院了。公司臨時找來的代理教練——就是你。",
      "旅館改建的宿舍前，八個人排成一列。最前面的隊長沈雨晴瞪著你：「三十天後就是全國企業盃。你最好不是來度假的。」",
      ["yl", "欸～新教練長得還不錯嘛。"],
      ["xy", "教練早安！我幫大家沖了咖啡喔！"],
      ["lm", "……看起來很好捉弄。"],
      ["zx", "請、請多指教……！"],
      "三十天。訓練、比賽，還有八個人各自藏著的心事。",
      "這個夏天，就從今天開始。"
    ], "toDay");
  }

  // ---------------- 對話（VN）----------------
  // steps：字串＝旁白；[who, text]；{ch:[...]}；{e:{...}}。who="@" 代表事件主角。
  function startVN(who, title, steps, after) {
    ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after || null, sub: {} };
    ui.screen = "vn";
    advanceSilent();
  }
  function fill(text) {
    var v = ui.vn; if (!v) return text;
    var t = String(text);
    if (v.who) t = t.replace(/\{n\}/g, M(v.who).short);
    if (v.sub.m) t = t.replace(/\{m\}/g, M(v.sub.m).short);
    return t.replace(/\{me\}/g, C.ME);
  }
  function applyEff(e, who) {
    if (!e) return;
    if (e.a && who) addAff(who, e.a);
    if (e.aff) Object.keys(e.aff).forEach(function (k) { addAff(k, e.aff[k]); });
    if (e.chem) { st.chem = clamp(st.chem + e.chem, 0, 100); }
    if (e.st && who) Object.keys(e.st).forEach(function (k) { S(who).s[k] = clamp(S(who).s[k] + e.st[k], 1, 99); });
    if (e.sta && who) S(who).sta = clamp(S(who).sta + e.sta, 0, 100);
    if (e.cond && who) S(who).cond = clamp(S(who).cond + e.cond, -2, 2);
    if (e.flag) st.flags[e.flag] = 1;
  }
  function addAff(id, n) {
    var x = S(id); x.aff = clamp(x.aff + n, 0, 100);
    if (n > 0) ui.toast = M(id).short + " 好感 +" + n;
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
  function vnNext() { var v = ui.vn; if (!v) return; v.i++; advanceSilent(); render(); }
  function vnChoose(k) {
    var v = ui.vn, s = v.steps[v.i], c = s.ch[k];
    applyEff(c.e, v.who);
    var rest = (c.r || []).slice();
    v.steps.splice.apply(v.steps, [v.i + 1, 0].concat(rest));
    v.i++; advanceSilent(); render();
  }
  function endVN() {
    var v = ui.vn; ui.vn = null;
    var a = v && v.after;
    if (typeof a === "function") a();
    else if (a === "toDay") { ui.screen = "hub"; save(); }
    else if (a === "toNight") { st.phase = "night"; ui.screen = "hub"; save(); }
    else if (a === "endNight") endNight();
    else { ui.screen = "hub"; save(); }
  }

  // ---------------- 晨練 ----------------
  function doMenu(id) {
    var menu = D.MENUS.filter(function (x) { return x.id === id; })[0];
    var lines = [];
    D.MEMBERS.forEach(function (m) {
      var x = S(m.id);
      if (x.inj > 0) { x.sta = clamp(x.sta + 15, 0, 100); return; }
      if (menu.id === "rest") { x.sta = clamp(x.sta + 30, 0, 100); x.cond = clamp(x.cond + (Math.random() < 0.4 ? 1 : 0), -2, 2); return; }
      var tired = x.sta < 30 ? 0.5 : 1;
      if (menu.main) x.s[menu.main] = clamp(x.s[menu.main] + Math.round(rnd(2, 4) * tired), 1, 99);
      if (menu.sub) x.s[menu.sub] = clamp(x.s[menu.sub] + Math.round(rnd(1, 2) * tired), 1, 99);
      if (menu.id === "sand") { D.STATS.forEach(function (k) { x.s[k] = clamp(x.s[k] + 1, 1, 99); }); x.cond = clamp(x.cond + 1, -2, 2); }
      x.sta = clamp(x.sta - menu.sta - rnd(0, 4), 0, 100);
      if (x.sta < 18 && Math.random() < 0.3) { x.inj = 3; x.cond = -1; lines.push("⚠ " + m.short + " 練到體力透支，受傷了！要休養 3 天。"); }
    });
    st.chem = clamp(st.chem + menu.chem, 0, 100);
    log(menu.ic + " 晨練：" + menu.name + (menu.chem ? "（默契 +" + menu.chem + "）" : ""));
    lines.forEach(log);
    st.phase = "afternoon";
    if (lines.length) ui.toast = lines[0];
    save(); render();
  }
  function log(t) { st.log.unshift("D" + st.day + "　" + t); if (st.log.length > 40) st.log.length = 40; }

  // ---------------- 午後：個別指導 ----------------
  function weakStat(id) {
    var m = M(id), s = S(id).s, roleKey = { S: "set", OH: "atk", OP: "atk", MB: "blk", L: "rcv" }[m.role];
    return Math.random() < 0.6 ? roleKey : D.STATS.reduce(function (a, k) { return s[k] < s[a] ? k : a; }, "atk");
  }
  function coach(id) {
    var x = S(id), k = weakStat(id), g = rnd(3, 4);
    x.s[k] = clamp(x.s[k] + g, 1, 99); x.sta = clamp(x.sta - 8, 0, 100);
    addAff(id, 4);
    log("🤝 個別指導：" + M(id).short + "（" + D.STAT_NAME[k] + " +" + g + "）");
    var ev = dueLine(id);
    if (ev) { runLine(id, "toNight"); return; }
    startVN(id, "個別指導", [pick([
      "你陪{n}練到太陽西斜。她最後一球打得特別漂亮，回頭對你比了個讚。",
      "{n}練得很專心。休息的時候，她把自己的水壺遞給你。",
      "{n}的動作越來越好了。你稱讚她，她假裝不在意，嘴角卻一直往上揚。"
    ])], "toNight");
  }
  function skipAfternoon() { D.MEMBERS.forEach(function (m) { S(m.id).sta = clamp(S(m.id).sta + 10, 0, 100); }); log("😴 午後自由休息（全員體力 +10）"); st.phase = "night"; save(); render(); }

  function dueLine(id) {
    if (isEnc(id)) return null;
    var x = S(id);
    if (x.line < 3 && x.aff >= D.LINE_AFF[x.line]) return D.LINES[id][x.line];
    return null;
  }
  // 邂逅角色：見面 5 次以上、好感 55 以上就會告白
  var ENC_CONFESS_AFF = 45, ENC_CONFESS_MEETS = 4;
  function dueConfess(id) {
    var x = S(id);
    if (isEnc(id)) return !x.dating && x.aff >= ENC_CONFESS_AFF && x.meets >= ENC_CONFESS_MEETS && x.cool <= 0;
    return !x.dating && x.line >= 3 && x.aff >= D.CONFESS_AFF && x.cool <= 0;
  }
  function runLine(id, after) {
    var x = S(id), ev = D.LINES[id][x.line];
    x.line++;
    startVN(id, M(id).short + "・" + ev.title + "（" + x.line + "/3）", ev.steps, after);
  }
  function runConfess(id) {
    var enc = isEnc(id), base = enc ? persOf(S(id)).confess : D.CONFESS[id];
    var steps = base.concat([{ ch: [
      { t: "緊緊抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡笑出聲，又哭又笑。", "從今晚開始，你們交往了。"] },
      { t: "「……現在還不行。等合宿結束。」", e: { a: -12 }, r: ["她愣了一下，然後低下頭：「……我知道了。」", "她轉身走了。你看到她的肩膀在發抖。"] }
    ] }]);
    startVN(id, M(id).short + "・告白", steps, function () {
      var x = S(id);
      if (x.aff >= (enc ? ENC_CONFESS_AFF : D.CONFESS_AFF) + 5) { x.dating = true; log("💕 和 " + M(id).short + " 開始交往"); }
      else x.cool = 3;
      endNight();
    });
  }

  // ---------------- 夜晚 ----------------
  // ---------------- 邂逅角色 ----------------
  function newEnc(spotId) {
    var used = usedByCast(null);
    encIds().forEach(function (id) { used[st.enc[id].img] = 1; });
    var free = C.POOL.filter(function (img) { return !used[img]; });
    if (!free.length) return null;
    var img = pick(free), jobs = C.isFantasy(img) ? C.FANTASY_JOBS : C.JOBS;
    var here = jobs.filter(function (j) { return j.spot.indexOf(spotId) >= 0; });
    var job = pick(here.length ? here : jobs), given = pick(C.GIVEN);
    var id = "e" + img.slice(2, 5);
    st.enc[id] = { id: id, name: pick(C.SURN) + given, short: given, img: img, age: rnd(21, 34), job: job.name, meet: job.meet, spot: job.spot,
      pers: pick(C.PERS).id, color: "hsl(" + rnd(0, 359) + ",60%,62%)", aff: 0, meets: 0, chat: 0, dating: false, nights: 0, cool: 0, cond: 0, sta: 100, line: 3, s: { atk: 0, rcv: 0, srv: 0, blk: 0, set: 0 } };
    return id;
  }
  // 夜晚在地點偶遇（forced＝玩家主動去找她）
  function meetEnc(spotId, spot, forced) {
    var met = encIds().filter(function (id) { return !st.enc[id].dating && st.enc[id].spot.indexOf(spotId) >= 0; });
    var id = forced || null, isNew = false;
    if (!id && met.length && Math.random() < 0.6) {
      met.sort(function (a, b) { return st.enc[b].aff - st.enc[a].aff; });
      id = Math.random() < 0.6 ? met[0] : pick(met);
    }
    if (!id) { id = newEnc(spotId); isNew = !!id; if (!id && met.length) id = pick(met); }
    if (!id) return false;
    var e = st.enc[id], P = persOf(e);
    log(spot.ic + " " + spot.name + "：" + (isNew ? "邂逅了 " : "又遇到 ") + e.short + "（" + e.job + "）");
    if (dueConfess(id)) { runConfess(id); return true; }
    e.meets++;
    if (isNew) {
      startVN(id, spot.name + "・邂逅", [e.meet, ["@", P.greet], "她是" + e.job + "，" + e.age + " 歲。個性：" + P.name + "。", { e: { a: 10 } }], "endNight");
      return true;
    }
    var c = P.chats[e.chat % P.chats.length]; e.chat++;
    var good = { t: c.good, e: { a: 12 }, r: [pick(["她開心地笑了。", "她的臉微微紅了。", "她看了你很久，然後別過頭去。", "她輕輕碰了一下你的手臂。"])] };
    var ok = { t: c.ok, e: { a: 5 } };
    startVN(id, spot.name, [pick(["你在" + spot.name + "又遇到了{n}。", "{n}好像在等你。看到你，她揮了揮手。", "{n}正好也在。她拍了拍旁邊的位置。"]), ["@", c.q], { ch: Math.random() < 0.5 ? [good, ok] : [ok, good] }], "endNight");
    return true;
  }

  function goSpot(spotId) {
    var spot = D.SPOTS.filter(function (s) { return s.id === spotId; })[0];
    if (Math.random() < 0.4 && meetEnc(spotId, spot)) return;
    var pool = D.MEMBERS.filter(function (m) { return S(m.id).inj <= 0 || Math.random() < 0.5; });
    // 優先：喜歡這個地點、且有個人線或告白待觸發的人
    var due = pool.filter(function (m) { return (dueLine(m.id) || dueConfess(m.id)) && m.spot.indexOf(spotId) >= 0; });
    var who = null;
    if (due.length && Math.random() < 0.85) who = pick(due).id;
    else {
      var likes = pool.filter(function (m) { return m.spot.indexOf(spotId) >= 0; });
      if (Math.random() < 0.15) { log(spot.ic + " " + spot.name + "：沒有遇到誰"); startVN(null, spot.name, [spot.quiet], "endNight"); return; }
      who = (likes.length && Math.random() < 0.7 ? pick(likes) : pick(pool)).id;
    }
    log(spot.ic + " " + spot.name + "：遇到 " + M(who).short);
    if (dueConfess(who)) { runConfess(who); return; }
    if (dueLine(who)) { runLine(who, "endNight"); return; }
    var evs = FREE_ALL.filter(function (f) { return f.spot === spotId; });
    var f = pick(evs);
    var steps = f.steps.slice();
    steps.push({ ch: f.ch });
    startVN(who, spot.name, steps, "endNight");
  }
  function festival(id) {
    st.flags.fest = id;
    log("🎆 夏日祭：和 " + M(id).short + " 一起去");
    var steps = D.FESTIVAL.slice(); steps.push({ e: { a: 12, cond: 1 } });
    startVN(id, "夏日祭", steps, "endNight");
  }
  function visit(id) {
    var ds = dating().filter(function (x) { return x !== id; });
    var go = function () { openStory(id); };
    if (ds.length && Math.random() < 0.3) {
      var other = pick(ds);
      startVN(other, "修羅場", D.JEALOUS.slice().concat([{ e: { a: -6 } }]), go);
      ui.vn.sub.m = id;
      st.chem = clamp(st.chem - 4, 0, 100);
      log("💢 修羅場：" + M(other).short + " 撞見你要去找 " + M(id).short + "（默契 -4）");
      return;
    }
    go();
  }
  function openStory(id) {
    var x = S(id), story, key;
    var own = ownList(id);
    if (x.nights < own.length) { story = own[x.nights]; key = ownKey(id, x.nights); }
    else {
      var k; do { k = rnd(0, SHARED_ALL.length - 1); } while (SHARED_ALL.length > 1 && k === st.lastShared);
      st.lastShared = k; story = SHARED_ALL[k]; key = "sh_" + k;
    }
    x.nights++; addAff(id, 6); x.cond = clamp(x.cond + 1, -2, 2); x.sta = clamp(x.sta - 5, 0, 100);
    log("🌙 和 " + M(id).short + " 共度夜晚：" + story.title);
    if (isEnc(id)) addAlbum("enc|" + x.img + "|" + x.name + "|" + key.slice(3));
    else addAlbum(key + "_" + id);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: endNight };
    ui.screen = "story";
    render();
  }

  function endNight() {
    D.MEMBERS.forEach(function (m) {
      var x = S(m.id);
      x.sta = clamp(x.sta + 22, 0, 100);
      if (x.inj > 0) x.inj--;
      if (x.cool > 0) x.cool--;
      if (Math.random() < 0.3) x.cond = clamp(x.cond + (Math.random() < 0.5 + x.aff / 300 ? 1 : -1), -2, 2);
    });
    encIds().forEach(function (id) { if (st.enc[id].cool > 0) st.enc[id].cool--; });
    st.day++;
    st.phase = "morning";
    ui.screen = "hub";
    if (st.day > D.DAYS) st.day = D.DAYS;
    save(); render();
  }

  // ---------------- 比賽 ----------------
  function lineup() {
    var avail = D.MEMBERS.filter(function (m) { return S(m.id).inj <= 0; }).map(function (m) { return m.id; });
    var used = {}, out = [];
    function take(role, n) {
      var c = avail.filter(function (id) { return !used[id] && M(id).role === role; }).sort(function (a, b) { return ovr(b) - ovr(a); });
      for (var i = 0; i < n && i < c.length; i++) { used[c[i]] = 1; out.push(c[i]); }
    }
    take("S", 1); take("OP", 1); take("MB", 2); take("L", 1); take("OH", 2);
    if (ui.match && ui.match.key === "fn" && st.flags.yq_bench && used.yq && !used.zx && avail.indexOf("zx") >= 0) { out[out.indexOf("yq")] = "zx"; used.zx = 1; delete used.yq; }
    var rest = avail.filter(function (id) { return !used[id]; }).sort(function (a, b) { return ovr(b) - ovr(a); });
    while (out.length < 7 && rest.length) out.push(rest.shift());
    return out;
  }
  function teamPower(tac, ids, key) {
    var t = 0;
    ids.forEach(function (id) {
      var s = S(id).s, v = 0;
      Object.keys(tac.w).forEach(function (k) { v += s[k] * tac.w[k]; });
      v += S(id).cond * 1.5 + (S(id).sta < 35 ? -3 : 0);
      if (key === "fn" && id === "yq" && st.flags.yq_play) v += 4;
      if (key === "fn" && id === "zx" && st.flags.yq_bench) v += 4;
      t += v;
    });
    return t / ids.length + st.chem * 0.12;
  }
  function startMatch(key) {
    var o = D.OPP[key];
    ui.match = { key: key, opp: o, bo: key === "p1" || key === "p2" ? 3 : 5, sets: [], won: 0, lost: 0, lines: [], done: false };
    ui.match.ids = lineup();
    ui.screen = "match";
    render();
  }
  function playSet(tid) {
    var m = ui.match, tac = D.TACTICS.filter(function (t) { return t.id === tid; })[0], o = m.opp;
    var oppTac = D.TACTICS.filter(function (t) { return t.id === o.style; })[0];
    var ours = teamPower(tac, m.ids, m.key);
    var edge = 0;
    if (tac.beats === o.style) edge = 6; else if (oppTac.beats === tac.id) edge = -6;
    var diff = ours + edge - o.pow;
    var p = 1 / (1 + Math.exp(-diff / 16));
    var target = (m.won + m.lost === 4) ? 15 : 25, a = 0, b = 0;
    while (true) {
      if (Math.random() < p) a++; else b++;
      if ((a >= target || b >= target) && Math.abs(a - b) >= 2) break;
    }
    var win = a > b;
    if (win) m.won++; else m.lost++;
    var hl = [];
    var hitter = m.ids.filter(function (id) { return M(id).role !== "L"; });
    for (var i = 0; i < 3; i++) {
      var id = pick(hitter), nm = M(id).short;
      hl.push(pick([
        nm + " 的重扣穿過攔網，砸在對方場地上！",
        nm + " 一記攔網把對方王牌的球蓋了回去！",
        nm + " 發球直接得分，對手連動都來不及動！",
        "對方強攻，" + M(m.ids.indexOf("rh") >= 0 ? "rh" : id).short + " 撲地救起，反擊得分！",
        nm + " 的球被攔了回來。下一球，她咬著牙再扣一次——得分！",
        "長回合拉鋸了二十拍，最後 " + nm + " 打手出界拿下這一分。"
      ]));
    }
    var note = edge > 0 ? "（戰術剋制對手！）" : edge < 0 ? "（被對手的打法剋制了…）" : "";
    m.sets.push({ a: a, b: b, tac: tac.name + note, hl: hl });
    var need = Math.ceil(m.bo / 2);
    if (m.won >= need || m.lost >= need) finishMatch();
    render();
  }
  function finishMatch() {
    var m = ui.match; m.done = true;
    var win = m.won > m.lost;
    st.res[m.key] = win ? 1 : 0;
    log("🏐 vs " + m.opp.name + "　" + m.won + "-" + m.lost + (win ? "　勝利！" : "　落敗"));
    if (m.key === "p1" || m.key === "p2") {
      st.chem = clamp(st.chem + (win ? 3 : 1), 0, 100);
      m.ids.forEach(function (id) { var x = S(id); x.cond = clamp(x.cond + (win ? 1 : 0), -2, 2); x.sta = clamp(x.sta - 15, 0, 100); });
    }
  }
  function afterMatch() {
    var m = ui.match; ui.match = null;
    if (m.key === "sf") {
      if (m.won > m.lost) { startVN(null, "決賽前", ["準決賽勝利！休息室裡，大家抱在一起尖叫。", "決賽的對手是衛冕冠軍——台北銀行・金鷹。", D.OPP.fn.scout, ["yq", "最後一場了。教練，帶我們贏。"]], function () { startMatch("fn"); }); return; }
      return ending("sf");
    }
    if (m.key === "fn") return ending(m.won > m.lost ? "win" : "fn");
    st.phase = "night"; ui.screen = "hub"; save(); render();
  }

  // ---------------- 結局 ----------------
  var EPI = {
    yq: { d: "合宿結束後，雨晴動了膝蓋手術。復健的每一天，你都在旁邊。她說，退役之後的下一個夢想，是當你的太太。", n: "雨晴打完了最後一季，轉任海燕隊的助理教練。" },
    yl: { d: "雅蕾每一場比賽都會往場邊看一眼，確認你在喊她的名字。休賽季，你們一起去峇里島衝浪。", n: "雅蕾還是常翹晨練，但每次被抓回來，都會乖乖跟隊長道歉。" },
    xy: { d: function (s) { return s.flags.xy_go ? "「第三拍」在白砂灣開幕了。吧台後面，有一張只有你能坐的椅子。" : "小芸留下來繼續舉球。休假日，你們一起去找適合開店的地方。"; }, n: "小芸的咖啡越來越好喝，她說總有一天要開一家自己的店。" },
    bs: { d: function (s) { return s.flags.bs_nat ? "白霜入選了國家隊。國際賽的轉播裡，她每攔下一球，都會對著鏡頭比出只有你看得懂的手勢。" : "白霜留在海燕。她的話還是很少，但每天晚上，都會傳一張星空的照片給你。"; }, n: "白霜的攔網成了聯賽第一。她說，總有一天要讓國家隊後悔。" },
    hl: { d: "紅綾成了公司新海報的主角——她堅持要拍攔網的瞬間。海報底下的小字寫著：「攝影：她的男朋友」。", n: "紅綾還是一頓吃三碗，攔網也還是全隊最強。" },
    rh: { d: "若禾沒有退役。她把你介紹給家人的時候，媽媽看著你們綁在一起的小指，終於笑了。", n: "若禾決定打到自己說停為止。她說，是你給了她說出口的勇氣。" },
    lm: { d: "黎墨在決賽打爆了前東家。賽後訪問，她對著鏡頭說：「感謝我的教練。私底下的那種。」全場譁然。", n: "黎墨留在海燕，哨子惡作劇每週都會發生一次。" },
    zx: { d: "知夏成了海燕的新王牌。她的跳發球有了名字，叫「夏天」。她說，那是你們第一次的季節。", n: "知夏再也不怕發球了。她說，因為有人教會她怎麼跳。" }
  };
  function ending(tier) {
    st.ended = true;
    ui.screen = "ending";
    ui.endTier = tier;
    store(SAVE_KEY, null);
    var best = load("pritest-natsu-best") || {};
    best[tier] = (best[tier] || 0) + 1; store("pritest-natsu-best", best);
    render();
  }

  // ---------------- 畫面 ----------------
  function portrait(id, cls) {
    if (!id) return "";
    return '<img class="nt-pt ' + (cls || "") + '" src="' + IMG + imgOf(id) + '" alt="" style="--nt-c:' + M(id).color + '">';
  }
  function renderCast() {
    var h = '<div class="nt-panel"><h2>選角：她們的樣子</h2><p class="nt-small nt-muted">點一位隊員，從頭像庫幫她換外觀。名字和故事不變。</p><div class="nt-grid">';
    h += D.MEMBERS.map(function (m) {
      return '<button class="nt-card' + (ui.castPick === m.id ? " nt-lovecard" : "") + '" data-act="castPick" data-id="' + m.id + '">' + portrait(m.id, "nt-big") + "<b>" + esc(m.name) + '</b><span class="nt-small nt-muted">' + esc(D.ROLE_NAME[m.role]) + "・" + esc(m.pers) + "</span></button>";
    }).join("") + "</div>";
    if (ui.castPick) {
      var used = usedByCast(ui.castPick);
      h += '<h3>' + esc(M(ui.castPick).name) + ' 的外觀</h3><div class="nt-gallery">' + C.POOL.filter(function (img) { return !used[img]; }).map(function (img) {
        return '<button class="nt-gimg' + (imgOf(ui.castPick) === img ? " nt-gsel" : "") + '" data-act="castImg" data-img="' + img + '"><img src="' + IMG + img + '" alt="" loading="lazy"></button>';
      }).join("") + "</div>";
    }
    return h + '<div class="nt-row"><button class="nt-btn" data-act="castRandom">全部隨機</button><button class="nt-btn" data-act="castReset">恢復預設</button><button class="nt-btn nt-primary" data-act="castStart">開始合宿</button></div></div>';
  }
  function bar(v, cls) { return '<span class="nt-bar ' + (cls || "") + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></span>'; }

  function render() {
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    var h = "";
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "match") h = renderMatch();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else if (ui.screen === "cast") h = renderCast();
    else h = renderHub();
    if (ui.toast) { h += '<div class="nt-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="nt-root">' + h + "</div>";
  }
  function renderAge() {
    return '<div class="nt-age"><p class="nt-age-mark">18+</p><h2>本遊戲含成人向內容</h2>' +
      '<p>遊戲中有成年角色之間的親密、性暗示描寫。登場人物全員皆為 22 歲以上的成年社會人。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="nt-row"><button class="nt-btn nt-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="nt-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY), best = load("pritest-natsu-best") || {};
    var h = '<div class="nt-title"><p class="nt-sub">企業女排・海燕隊</p><h1>盛夏合宿</h1><p class="nt-tag">三十天的海邊集訓營。你是代理教練。<br>訓練、比賽，還有八個她的夏天。</p>';
    h += '<div class="nt-faces">' + D.MEMBERS.map(function (m) { return portrait(m.id, "nt-face"); }).join("") + "</div>";
    h += '<div class="nt-row">';
    if (saved) h += '<button class="nt-btn nt-primary" data-act="continue">繼續（第 ' + saved.day + " 天）</button>";
    h += '<button class="nt-btn' + (saved ? "" : " nt-primary") + '" data-act="new">' + (saved ? "重新開始" : "開始合宿") + "</button>";
    h += '<button class="nt-btn" data-act="album">夜晚回憶</button></div>';
    if (best.win) h += '<p class="nt-muted nt-small">🏆 已奪冠 ' + best.win + " 次</p>";
    return h + "</div>";
  }
  function renderAlbum() {
    var a = album(), h = '<div class="nt-panel"><h2>夜晚回憶</h2><p class="nt-muted nt-small">看過的夜晚劇情可以在這裡重看。</p><div class="nt-album">';
    D.MEMBERS.forEach(function (m) {
      h += '<div class="nt-alb">' + portrait(m.id, "nt-mini") + "<div><b>" + esc(m.name) + "</b><br>";
      var ownHas = false; ownList(m.id).forEach(function (o, i) { if (a[ownKey(m.id, i) + "_" + m.id]) { ownHas = true; h += '<button class="nt-btn nt-sm" data-act="replay" data-k="own" data-i="' + i + '" data-id="' + m.id + '">' + esc(o.title) + "</button> "; } });
      if (!ownHas) h += '<span class="nt-muted nt-small">？？？</span>';
      SHARED_ALL.forEach(function (s, i) { if (a["sh_" + i + "_" + m.id]) h += ' <button class="nt-btn nt-sm" data-act="replay" data-k="' + i + '" data-id="' + m.id + '">' + esc(s.title) + "</button>"; });
      h += "</div></div>";
    });
    // 邂逅角色：鍵是 enc|頭像|名字|共用劇情編號
    var encs = {};
    Object.keys(a).forEach(function (k) { if (k.indexOf("enc|") === 0) { var p = k.split("|"); var key = p[1] + "|" + p[2]; (encs[key] = encs[key] || []).push(+p[3]); } });
    Object.keys(encs).forEach(function (key) {
      var p = key.split("|");
      h += '<div class="nt-alb"><img class="nt-pt nt-mini" src="' + IMG + esc(p[0]) + '" alt=""><div><b>' + esc(p[1]) + '</b> <span class="nt-small nt-muted">邂逅</span><br>' +
        encs[key].sort().map(function (i) { return '<button class="nt-btn nt-sm" data-act="replayEnc" data-k="' + i + '" data-img="' + esc(p[0]) + '" data-name="' + esc(p[1]) + '">' + esc(SHARED_ALL[i].title) + "</button>"; }).join(" ") + "</div></div>";
    });
    return h + '</div><div class="nt-row"><button class="nt-btn" data-act="title">返回</button></div></div>';
  }
  function renderHub() {
    var h = '<div class="nt-top"><div><b class="nt-day">第 ' + st.day + " 天</b>／" + D.DAYS + '　<span class="nt-phase">' + { morning: "☀ 晨練", afternoon: "🌤 午後", night: "🌙 夜晚" }[st.phase] + "</span></div>" +
      '<div class="nt-small">團隊 OVR <b>' + teamOvr() + "</b>　默契 " + bar(st.chem, "nt-chem") + " " + st.chem + '</div><div><button class="nt-btn nt-sm" data-act="panel" data-p="roster">隊員</button> <button class="nt-btn nt-sm" data-act="panel" data-p="log">紀錄</button> <button class="nt-btn nt-sm" data-act="title">標題</button></div></div>';
    if (ui.panel === "roster") h += renderRoster();
    else if (ui.panel === "log") h += '<div class="nt-panel"><h3>紀錄</h3><ul class="nt-log">' + st.log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + '</ul><button class="nt-btn nt-sm" data-act="panel" data-p="">關閉</button></div>';
    h += '<div class="nt-strip">' + D.MEMBERS.map(function (m) {
      var x = S(m.id);
      return '<div class="nt-chip' + (x.inj > 0 ? " nt-inj" : "") + (x.dating ? " nt-love" : "") + '" title="' + esc(m.name) + '">' + portrait(m.id, "nt-mini") + '<span class="nt-small">' + esc(m.short) + (x.dating ? " 💕" : "") + "</span>" + bar(x.sta, "nt-sta") + bar(x.aff, "nt-aff") + "</div>";
    }).join("") + '</div><p class="nt-small nt-muted nt-center">上條＝體力　下條＝好感</p>';

    if (st.day === D.DAYS && st.phase === "morning") {
      h += '<div class="nt-panel nt-center"><h2>🏆 全國企業盃・決賽日</h2><p>三十天的合宿，全都為了今天。</p><p class="nt-small">' + esc(D.OPP.sf.scout) + '</p><button class="nt-btn nt-primary" data-act="final">前往準決賽</button></div>';
      return h;
    }
    if (st.phase === "morning") {
      h += '<div class="nt-panel"><h3>☀ 晨練菜單</h3><div class="nt-grid">' + D.MENUS.map(function (mn) {
        return '<button class="nt-card" data-act="menu" data-id="' + mn.id + '"><b>' + mn.ic + " " + esc(mn.name) + '</b><span class="nt-small">' + esc(mn.desc) + '</span><span class="nt-small nt-muted">' + (mn.sta > 0 ? "體力 -" + mn.sta : "體力 +" + (-mn.sta)) + "</span></button>";
      }).join("") + "</div></div>";
    } else if (st.phase === "afternoon") {
      var mk = D.MATCH_DAYS[st.day];
      if (mk) {
        h += '<div class="nt-panel nt-center"><h3>🏐 練習賽 vs ' + esc(D.OPP[mk].name) + '</h3><p class="nt-small">' + esc(D.OPP[mk].scout) + '</p><button class="nt-btn nt-primary" data-act="match" data-k="' + mk + '">開始比賽</button></div>';
      } else {
        h += '<div class="nt-panel"><h3>🌤 午後：個別指導</h3><p class="nt-small nt-muted">選一位隊員一對一指導（能力 +3〜4、好感 +4）。好感夠高時會觸發她的個人故事。</p><div class="nt-grid">' + D.MEMBERS.map(function (m) {
          var x = S(m.id), due = dueLine(m.id);
          return '<button class="nt-card" data-act="coach" data-id="' + m.id + '"' + (x.inj > 0 ? " disabled" : "") + ">" + portrait(m.id, "nt-mini") + "<b>" + esc(m.short) + (due ? ' <span class="nt-new">！</span>' : "") + '</b><span class="nt-small">' + esc(D.ROLE_NAME[m.role]) + "・OVR " + ovr(m.id) + (x.inj > 0 ? "・受傷" : "") + "</span></button>";
        }).join("") + '</div><div class="nt-row"><button class="nt-btn nt-sm" data-act="skip">全員休息</button></div></div>';
      }
    } else {
      if (st.day === D.FESTIVAL_DAY && !st.flags.fest) {
        var festIds = D.MEMBERS.map(function (m) { return m.id; }).concat(encIds().filter(function (id) { return st.enc[id].aff >= 20; }));
        h += '<div class="nt-panel"><h3>🎆 夏日祭之夜</h3><p class="nt-small nt-muted">今晚是白砂灣的夏日祭。邀請一個人一起去（好感 +12）。</p><div class="nt-grid">' + festIds.map(function (id) {
          return '<button class="nt-card" data-act="fest" data-id="' + id + '">' + portrait(id, "nt-mini") + "<b>" + esc(M(id).short) + '</b><span class="nt-small">' + (isEnc(id) ? esc(M(id).job) + "・" : "") + tierName(S(id).aff) + "</span></button>";
        }).join("") + "</div></div>";
        return h;
      }
      h += '<div class="nt-panel"><h3>🌙 夜晚自由行動</h3><div class="nt-grid">' + D.SPOTS.map(function (s) {
        var fans = D.MEMBERS.filter(function (m) { return m.spot.indexOf(s.id) >= 0; }).map(function (m) { return m.short; }).join("、");
        return '<button class="nt-card" data-act="spot" data-id="' + s.id + '"><b>' + s.ic + " " + esc(s.name) + '</b><span class="nt-small nt-muted">常出沒：' + esc(fans) + "</span></button>";
      }).join("") + "</div>";
      var seek = encIds().filter(function (id) { return !st.enc[id].dating; }).sort(function (a, b) { return st.enc[b].aff - st.enc[a].aff; });
      if (seek.length) {
        h += '<h3>📱 約認識的人出來</h3><div class="nt-grid">' + seek.map(function (id) {
          var e = st.enc[id];
          return '<button class="nt-card" data-act="seek" data-id="' + id + '">' + portrait(id, "nt-mini") + "<b>" + esc(e.short) + (dueConfess(id) ? ' <span class="nt-new">！</span>' : "") + '</b><span class="nt-small nt-muted">' + esc(e.job) + "・" + tierName(e.aff) + "</span></button>";
        }).join("") + "</div>";
      }
      var ds = dating();
      if (ds.length) {
        h += '<h3>💕 去她的房間</h3><div class="nt-grid">' + ds.map(function (id) {
          return '<button class="nt-card nt-lovecard" data-act="visit" data-id="' + id + '">' + portrait(id, "nt-mini") + "<b>" + esc(M(id).short) + '</b><span class="nt-small">' + (S(id).nights ? "共度了 " + S(id).nights + " 晚" : "第一次的夜晚") + "</span></button>";
        }).join("") + "</div>";
        if (ds.length >= 2) h += '<p class="nt-small nt-warn">同時和 ' + ds.length + " 個人交往中……小心修羅場。</p>";
      }
      h += '<div class="nt-row"><button class="nt-btn nt-sm" data-act="sleep">早點睡（全員體力 +10）</button></div></div>';
    }
    return h;
  }
  function renderRoster() {
    var h = '<div class="nt-panel"><h3>隊員</h3><div class="nt-roster">';
    D.MEMBERS.forEach(function (m) {
      var x = S(m.id);
      h += '<div class="nt-mem">' + portrait(m.id, "nt-big") + '<div><b>' + esc(m.name) + '</b> <span class="nt-small nt-muted">' + m.age + " 歲・" + esc(D.ROLE_NAME[m.role]) + "・" + esc(m.pers) + "</span>" +
        '<p class="nt-small">' + esc(m.intro) + "</p>" +
        '<p class="nt-small">' + D.STATS.map(function (k) { return D.STAT_NAME[k] + " <b>" + x.s[k] + "</b>"; }).join("　") + "</p>" +
        '<p class="nt-small">體力 ' + x.sta + "　調子 " + ["絕不調", "不調", "普通", "好調", "絕好調"][x.cond + 2] + "　好感 " + x.aff + "（" + tierName(x.aff) + "）" + (x.dating ? "　💕 交往中" : "") + (x.inj > 0 ? "　🩹 受傷（" + x.inj + " 天）" : "") + "</p>" +
        '<p class="nt-small nt-muted">個人故事「' + esc(m.line) + "」 " + x.line + "/3" + (x.line < 3 ? "（下一段：好感 " + D.LINE_AFF[x.line] + "）" : x.dating ? "" : "（好感 " + D.CONFESS_AFF + " 會有特別的事）") + "</p></div></div>";
    });
    var es = encIds();
    h += '</div><h3>邂逅的她們（' + es.length + "／" + (C.POOL.length - D.MEMBERS.length) + '）</h3><p class="nt-small nt-muted">夜晚自由行動時，有時會遇到隊員以外的人。見面 ' + ENC_CONFESS_MEETS + " 次以上、好感夠高，就會發生特別的事。</p><div class=\"nt-roster\">";
    es.forEach(function (id) {
      var e = st.enc[id];
      h += '<div class="nt-mem">' + portrait(id, "nt-mini") + "<div><b>" + esc(e.name) + '</b> <span class="nt-small nt-muted">' + e.age + " 歲・" + esc(e.job) + "・" + esc(persOf(e).name) + '</span><p class="nt-small">見面 ' + e.meets + " 次　好感 " + e.aff + "（" + tierName(e.aff) + "）" + (e.dating ? "　💕 交往中" : "") + "</p></div></div>";
    });
    return h + '</div><button class="nt-btn nt-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], h = '<div class="nt-vn">';
    if (v.title) h += '<p class="nt-vn-title">' + esc(v.title) + "</p>";
    var who = null, text = "", isMe = false;
    if (typeof s === "string") text = s;
    else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var speaker = who === "@" ? v.who : who;
    var showPt = speaker && speaker !== "me" && speaker.charAt(0) !== "?" ? speaker : v.who;
    if (who === "me") isMe = true;
    h += '<div class="nt-stage">' + (showPt ? portrait(showPt, "nt-vnpt") : "") + "</div>";
    h += '<div class="nt-box">';
    if (who) h += '<p class="nt-name" style="color:' + (speaker && speaker !== "me" && M(speaker) ? M(speaker).color : "#9fd3ff") + '">' + esc(isMe ? "你" : speaker.charAt(0) === "?" ? speaker.slice(1) : M(speaker).name) + "</p>";
    if (s && s.ch) {
      h += '<div class="nt-choices">' + s.ch.map(function (c, k) { return '<button class="nt-btn nt-choice" data-act="ch" data-k="' + k + '">' + esc(fill(c.t)) + "</button>"; }).join("") + "</div>";
    } else {
      h += '<p class="nt-text">' + esc(fill(text)) + '</p><button class="nt-btn nt-primary nt-next" data-act="next">▼</button>';
    }
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story, m = s.look || M(s.who);
    var h = '<div class="nt-story"><p class="nt-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + "</small></p>";
    h += '<div class="nt-stage nt-stage-night">' + (s.look ? '<img class="nt-pt nt-vnpt" src="' + IMG + esc(s.look.img) + '" alt="">' : portrait(s.who, "nt-vnpt")) + "</div>";
    h += '<div class="nt-box nt-box-night"><p class="nt-text">' + esc(String(s.pages[s.i]).replace(/\{n\}/g, m.short)) + "</p>";
    h += '<div class="nt-row">' + (s.i > 0 ? '<button class="nt-btn nt-sm" data-act="sprev">上一段</button>' : "") +
      '<button class="nt-btn nt-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
    return h;
  }
  function renderMatch() {
    var m = ui.match, h = '<div class="nt-panel nt-match"><h2>' + esc({ p1: "練習賽", p2: "練習賽", sf: "全國企業盃・準決賽", fn: "全國企業盃・決賽" }[m.key]) + "</h2>";
    h += '<p class="nt-score"><b>海燕</b> ' + m.won + " - " + m.lost + " <b>" + esc(m.opp.name) + "</b></p>";
    h += '<p class="nt-small nt-muted">' + esc(m.opp.scout) + "　（Bo" + m.bo + "）</p>";
    h += '<div class="nt-strip">' + m.ids.map(function (id) { return '<div class="nt-chip">' + portrait(id, "nt-mini") + '<span class="nt-small">' + esc(M(id).short) + "</span></div>"; }).join("") + "</div>";
    m.sets.forEach(function (s, i) {
      h += '<div class="nt-set ' + (s.a > s.b ? "nt-win" : "nt-lose") + '"><b>第 ' + (i + 1) + " 局　" + s.a + " - " + s.b + '</b> <span class="nt-small">' + esc(s.tac) + "</span><ul>" + s.hl.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    });
    if (!m.done) {
      h += '<h3>第 ' + (m.sets.length + 1) + " 局的戰術</h3><div class=\"nt-grid\">" + D.TACTICS.map(function (t) {
        return '<button class="nt-card" data-act="tac" data-id="' + t.id + '"><b>' + t.ic + " " + esc(t.name) + '</b><span class="nt-small">' + esc(t.desc) + "</span></button>";
      }).join("") + "</div>";
    } else {
      h += '<p class="nt-big nt-center">' + (m.won > m.lost ? "🎉 勝利！" : "落敗……") + '</p><div class="nt-row"><button class="nt-btn nt-primary" data-act="aftermatch">繼續</button></div>';
    }
    return h + "</div>";
  }
  function renderEnding() {
    var tier = ui.endTier;
    var head = { win: "🏆 全國企業盃 冠軍", fn: "🥈 全國企業盃 亞軍", sf: "🥉 全國企業盃 四強" }[tier];
    var body = { win: "最後一球落地的瞬間，全隊衝進場內。雨晴哭著把你拋向空中——三十天的夏天，換來了海燕隊的第一座冠軍。", fn: "決賽以些微之差落敗。可是頒獎台上，八個人都笑著。「明年，」雨晴說，「明年一定拿下來。」", sf: "準決賽落敗。回程的巴士上很安靜，直到小芸開始唱歌，大家一個接一個跟著唱。這個夏天，還是很好。" }[tier];
    var h = '<div class="nt-panel nt-ending"><h2>' + head + "</h2><p>" + esc(body) + '</p><h3>那之後的她們</h3>';
    D.MEMBERS.forEach(function (m) {
      var x = S(m.id), e = EPI[m.id], txt = x.dating ? (typeof e.d === "function" ? e.d(st) : e.d) : e.n;
      h += '<div class="nt-mem">' + portrait(m.id, "nt-mini") + "<div><b>" + esc(m.name) + "</b>" + (x.dating ? " 💕" : "") + '<p class="nt-small">' + esc(txt) + "</p></div></div>";
    });
    encIds().filter(function (id) { return st.enc[id].dating; }).forEach(function (id) {
      var e = st.enc[id];
      h += '<div class="nt-mem">' + portrait(id, "nt-mini") + "<div><b>" + esc(e.name) + '</b> 💕 <span class="nt-small nt-muted">' + esc(e.job) + '</span><p class="nt-small">' + esc(persOf(e).epi.replace(/\{n\}/g, e.short)) + "</p></div></div>";
    });
    var ds = dating();
    if (ds.length >= 3) h += '<p class="nt-warn">……另外，你同時和 ' + ds.length + " 個人交往的事，在合宿結束那天全部穿幫了。據說那一晚，宿舍的牆上多了好幾個排球形狀的凹痕。</p>";
    return h + '<div class="nt-row"><button class="nt-btn nt-primary" data-act="title">回到標題</button></div></div>';
  }

  // ---------------- 輸入 ----------------
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); if (st) { st.enc = st.enc || {}; st.img = st.img || {}; } ui.screen = st ? "hub" : "title"; render(); return; }
    if (act === "title") { if (st && !st.ended) save(); ui.screen = "title"; ui.panel = null; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") {
      var k = b.getAttribute("data-k"), story = k === "own" ? ownList(id)[+(b.getAttribute("data-i") || 0)] : SHARED_ALL[+k];
      ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "replayEnc") {
      var sk = SHARED_ALL[+b.getAttribute("data-k")], nm = b.getAttribute("data-name");
      ui.story = { who: null, look: { img: b.getAttribute("data-img"), short: nm.length > 2 ? nm.slice(1) : nm }, title: sk.title, pages: sk.pages, i: 0, after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "castPick") { ui.castPick = ui.castPick === id ? null : id; render(); return; }
    if (act === "castImg") { st.img[ui.castPick] = b.getAttribute("data-img"); render(); return; }
    if (act === "castRandom") { randomizeCast(); render(); return; }
    if (act === "castReset") { st.img = {}; render(); return; }
    if (act === "castStart") { startCamp(); render(); return; }
    if (act === "panel") { var p = b.getAttribute("data-p"); ui.panel = ui.panel === p ? null : (p || null); render(); return; }
    if (act === "menu") { doMenu(id); return; }
    if (act === "coach") { coach(id); render(); return; }
    if (act === "skip") { skipAfternoon(); return; }
    if (act === "match") { startMatch(b.getAttribute("data-k")); return; }
    if (act === "final") { startMatch("sf"); return; }
    if (act === "tac") { playSet(id); return; }
    if (act === "aftermatch") { afterMatch(); render(); return; }
    if (act === "spot") { goSpot(id); render(); return; }
    if (act === "fest") { festival(id); render(); return; }
    if (act === "seek") { var sp = D.SPOTS.filter(function (x) { return x.id === st.enc[id].spot[0]; })[0]; meetEnc(sp.id, sp, id); render(); return; }
    if (act === "visit") { visit(id); render(); return; }
    if (act === "sleep") { D.MEMBERS.forEach(function (m) { S(m.id).sta = clamp(S(m.id).sta + 10, 0, 100); }); log("🛌 早早睡了"); endNight(); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s = ui.story; if (s.i + 1 < s.pages.length) { s.i++; render(); } else { ui.story = null; s.after(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " && ev.key !== "Enter") return;
    var btn = app.querySelector(".nt-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  window.PriTestNatsu = { _state: function () { return st; }, _ui: function () { return ui; } };
  render();
})();
