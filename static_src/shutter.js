// 快門之後（shutter）：規則與畫面。2026-11-11 依使用者需求新增（故事 C：寫真集企劃、完整版）。
// 出版社「青嵐社」委託你在 60 天內拍完《十二月光》：12 位女性、12 個章節，最後選誰當封面＝結局。
// 每天：白天（接案／寫真集章節拍攝／約她見面／整理作品集；器材行不花時間）→ 夜晚（地點自由行動、去交往對象那裡）。
// 拍攝小遊戲在 shutter_shoot.js；18 禁確認沿用盛夏合宿的做法。
(function () {
  "use strict";

  var D = window.PriTestShutterData, N = window.PriTestShutterNight, C = window.PriTestShutterCast, SH = window.PriTestShutterShoot;
  var MORE = window.PriTestShutterNightMore || { OWN: {}, SHARED: [] };
  // 夜晚劇情：女主角各 4 段專屬（shutter_night.js 第 1 段＋shutter_night2〜4.js 第 2〜4 段），之後從共用劇情挑（2026-11-12 加量）
  function ownList(id) { return N.OWN[id] ? [N.OWN[id]].concat(MORE.OWN[id] || []) : []; }
  var SHARED_ALL = N.SHARED.concat(MORE.SHARED || []);
  function ownKey(id, i) { return i ? "own" + i + "_" + id : "own_" + id + "_" + id; } // 第 1 段沿用舊的相簿鍵
  var app = document.getElementById("sh-app");
  if (!D || !N || !C || !SH || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var CUT = app.getAttribute("data-cut") || "../static/images/shutter/"; // 去背頭像（拍攝場景與照片用）
  var SAVE_KEY = "pritest-shutter-save-v1";
  var AGE_KEY = "pritest-shutter-age-ok";
  var ALBUM_KEY = "pritest-shutter-album";
  var BEST_KEY = "pritest-shutter-best";
  var PORT_MAX = 60;

  var st = null;
  var ui = { screen: "title", vn: null, story: null, panel: null, toast: "", ageOk: false, castPick: null, shootCtx: null, sel: null };

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
  function log(t) { st.log.unshift("D" + st.day + "　" + t); if (st.log.length > 50) st.log.length = 50; }

  // 女主角（D.BY_ID）與客人（st.cl，id 以 c 開頭）共用 M／S
  function isCl(id) { return !!id && id.charAt(0) === "c" && !D.BY_ID[id]; }
  function M(id) { return D.BY_ID[id] || (st && st.cl && st.cl[id]); }
  function S(id) { return isCl(id) ? st.cl[id] : st.h[id]; }
  function imgOf(id) { if (D.BY_ID[id]) return (st && st.img && st.img[id]) || D.BY_ID[id].img; var c = M(id); return c ? c.img : ""; }
  function clIds() { return st && st.cl ? Object.keys(st.cl) : []; }
  function persOf(c) { return C.PERS.filter(function (p) { return p.id === c.pers; })[0]; }
  function dating() { return D.HEROINES.map(function (h) { return h.id; }).concat(clIds()).filter(function (id) { return S(id).dating; }); }
  function metIds() { return D.HEROINES.filter(function (h) { return st.h[h.id].met; }).map(function (h) { return h.id; }); }
  function tierName(a) { return a >= 90 ? "摯愛" : a >= 75 ? "心動" : a >= 55 ? "信賴" : a >= 35 ? "親近" : a >= 15 ? "熟悉" : "初識"; }
  function chaptersDone() { return D.HEROINES.filter(function (h) { return st.h[h.id].chapter; }).length; }
  function owns(kind, id) { return st.gear[kind].indexOf(id) >= 0; }

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { day: 1, phase: "day", money: 40, fame: 0, flags: {}, log: [], h: {}, cl: {}, jobs: [], port: [], img: {}, travelNight: null, lastShared: -1, ended: false, jobSeq: 0,
      gear: { lenses: ["std50"], lights: ["reflector"], films: ["color"] } };
    D.HEROINES.forEach(function (h) { st.h[h.id] = { met: false, aff: 0, tr: 0, line: 0, chapter: null, chapterSeen: false, dating: false, nights: 0, cool: 0 }; });
    ui.panel = null; ui.castPick = null;
    ui.screen = "cast";
  }
  function usedByCast(except) { var u = {}; D.HEROINES.forEach(function (h) { if (h.id !== except) u[imgOf(h.id)] = 1; }); return u; }
  function randomizeCast() {
    var pool = C.POOL.slice(), out = {};
    D.HEROINES.forEach(function (h) { var k = rnd(0, pool.length - 1); out[h.id] = pool[k]; pool.splice(k, 1); });
    st.img = out;
  }
  function startStory() {
    ui.castPick = null;
    st.h.qiu.met = true;
    startVN("qiu", "序章・十二月光", [
      "去年冬天，你的老師——攝影師沈青山過世了。他留下的工作室，現在由你租著。",
      "某天早上，出版社「青嵐社」的編輯找上了門。",
      ["@", "許知秋，青嵐社的編輯。我就直說了。"],
      "她把一份泛黃的企劃書放在桌上。標題是老師的字跡：《十二月光》。",
      ["@", "十二位女性，十二個章節。這是沈老師沒能完成的寫真集。"],
      ["@", "期限六十天。拍完全部十二個章節，選出其中一個人當封面。"],
      ["@", "人選我已經有名單了，可是要拍誰、拍成什麼樣子，由你決定。……沒有拍的章節，書上就只能留白。"],
      "她頓了一下，推了推眼鏡。",
      ["@", "對了。這個案子，唐霧也想要。你最好不要讓我後悔。"],
      "六十天。十二個她。還有一卷又一卷的底片。",
      "快門之後的故事，從今天開始。"
    ], function () { dayStart(); ui.screen = "hub"; save(); });
  }

  // ---------------- 對話（VN）----------------
  // steps：字串＝旁白；[who, text]；{ch:[...]}；{e:{...}}。who="@" 代表事件主角。
  function startVN(who, title, steps, after) {
    ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after || null, sub: {} };
    ui.screen = "vn";
    advanceSilent();
  }
  function fill(text) {
    var v = ui.vn; var t = String(text);
    if (v && v.who && M(v.who)) t = t.replace(/\{n\}/g, M(v.who).short);
    if (v && v.sub.m && M(v.sub.m)) t = t.replace(/\{m\}/g, M(v.sub.m).short);
    return t.replace(/\{me\}/g, C.ME);
  }
  function addAff(id, n) {
    var x = S(id); x.aff = clamp(x.aff + n, 0, 100);
    if (n > 0) ui.toast = M(id).short + " 好感 +" + n;
  }
  function applyEff(e, who) {
    if (!e) return;
    if (e.a && who) addAff(who, e.a);
    if (e.tr && who) S(who).tr = clamp((S(who).tr || 0) + e.tr, 0, 60);
    if (e.fame) st.fame = clamp(st.fame + e.fame, 0, 100);
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
  function vnNext() { var v = ui.vn; if (!v) return; v.i++; advanceSilent(); render(); }
  function vnChoose(k) {
    var v = ui.vn, s = v.steps[v.i], c = s.ch[k];
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
  function toNight() { st.phase = "night"; ui.screen = "hub"; save(); }

  // ---------------- 一天的開始 ----------------
  function dayStart() {
    // 每 10 天付一次租金（旅行外拍會一次跳兩天，所以用「應付次數」補齊）
    var due = Math.floor((st.day - 1) / D.RENT_EVERY);
    while ((st.rentN || 0) < due) {
      st.rentN = (st.rentN || 0) + 1; st.money -= D.RENT;
      log("🏠 付了工作室租金 " + money(D.RENT));
    }
    refreshJobs();
  }
  function pendingMeets() {
    return D.HEROINES.filter(function (h) { return !st.h[h.id].met && st.fame >= h.fame; }).map(function (h) { return h.id; });
  }
  function meetHeroine(id) {
    var h = D.BY_ID[id];
    st.h[id].met = true;
    log("📩 認識了 " + h.name + "（" + h.job + "）");
    startVN(id, h.short + "・邂逅", h.meet.concat(["她是" + h.job + "，" + h.age + " 歲。" + h.intro, { e: { a: 6 } }]), function () { ui.screen = "hub"; save(); });
  }

  // ---------------- 客人 ----------------
  function newClient(fantasy) {
    var used = usedByCast(null);
    clIds().forEach(function (id) { used[st.cl[id].img] = 1; });
    var free = C.POOL.filter(function (img) { return !used[img] && C.isFantasy(img) === !!fantasy; });
    if (!free.length) return null;
    var img = pick(free), given = pick(C.GIVEN), id = "c" + img.slice(2, 5);
    st.cl[id] = { id: id, name: pick(C.SURN) + given, short: given, img: img, age: rnd(21, 36), job: pick(fantasy ? C.FANTASY_JOBS : C.JOBS),
      pers: pick(C.PERS).id, color: "hsl(" + rnd(0, 359) + ",62%,66%)", aff: 0, tr: 0, meets: 0, dating: false, nights: 0, cool: 0, privAsked: false, best: pick(["left", "right", null]) };
    return id;
  }
  function pickClient(fantasy) {
    var old = clIds().filter(function (id) { var c = st.cl[id]; return C.isFantasy(c.img) === !!fantasy && !c.dating; });
    if (old.length && Math.random() < 0.42) return pick(old);
    return newClient(fantasy) || (old.length ? pick(old) : null);
  }

  // ---------------- 案子 ----------------
  function makeJob(type, who) {
    var cs = D.CASES[type];
    var j = { id: "j" + (++st.jobSeq), type: type, who: who, scene: pick(cs.scenes), mood: pick(cs.moods), frame: pick(cs.frames), want: cs.want.slice(),
      theme: pick(D.THEMES[type]), pay: rnd(cs.pay[0], cs.pay[1]), expire: st.day + rnd(1, 3) };
    if (type === "travel") j.pay += 4;
    return j;
  }
  function refreshJobs() {
    st.jobs = st.jobs.filter(function (j) { return j.expire >= st.day; });
    // 常客的私人寫真委託
    clIds().forEach(function (id) {
      var c = st.cl[id];
      if (!c.privAsked && c.aff >= 45 && c.meets >= 2 && st.fame >= D.CASES.priv.fame) {
        c.privAsked = true;
        var j = makeJob("priv", id); j.request = true; j.expire = st.day + 4; st.jobs.unshift(j);
        log("💌 " + c.short + " 寄來了私人寫真的委託");
      }
    });
    var types = D.CASE_ORDER.filter(function (t) { return st.fame >= D.CASES[t].fame; });
    var guard = 0;
    while (st.jobs.length < 3 && guard++ < 20) {
      var t = pick(types), cs = D.CASES[t], who = null;
      var hs = metIds().filter(function (id) {
        var h = D.BY_ID[id];
        if (st.jobs.some(function (j) { return j.who === id; })) return false;
        if (cs.fantasy) return id === "rin";
        if (t === "priv") return st.h[id].aff >= 40;
        return id !== "qiu" && id !== "wu";
      });
      if (hs.length && Math.random() < 0.38) who = pick(hs);
      else who = pickClient(!!cs.fantasy);
      if (!who) continue;
      st.jobs.push(makeJob(t, who));
    }
  }
  function acceptJob(jid) {
    var j = st.jobs.filter(function (x) { return x.id === jid; })[0];
    if (!j) return;
    st.jobs = st.jobs.filter(function (x) { return x.id !== jid; });
    var cs = D.CASES[j.type], who = j.who;
    log(cs.ic + " 接案：" + cs.name + "「" + j.theme + "」（" + M(who).short + "）");
    var go = function () { beginShoot({ kind: "job", job: j, who: who }); };
    if (isCl(who) && !st.cl[who].meets) {
      var P = persOf(st.cl[who]);
      startVN(who, cs.name + "・初次見面", [M(who).name + "，" + M(who).age + " 歲，" + M(who).job + "。", ["@", P.greet]], function () { maybeBride(j, go); });
      return;
    }
    maybeBride(j, go);
  }
  function maybeBride(j, go) {
    if (j.type === "wed" && Math.random() < 0.45) { startVN(j.who, "婚紗外拍・空檔", D.BRIDE, function () { maybeJealous(j.who, go); }); return; }
    maybeJealous(j.who, go);
  }
  function maybeJealous(who, go) {
    var ds = dating().filter(function (x) { return x !== who; });
    if (ds.length && Math.random() < 0.22) {
      var other = pick(ds);
      startVN(other, "修羅場", D.JEALOUS.slice().concat([{ e: { a: -6 } }]), go);
      ui.vn.sub.m = who;
      log("💢 修羅場：" + M(other).short + " 撞見你在拍 " + M(who).short);
      return;
    }
    go();
  }

  // ---------------- 拍攝 ----------------
  function shootTrust(id) {
    var x = S(id), base = isCl(id) ? 8 : D.BY_ID[id].trust;
    return clamp(base + (x.tr || 0) + x.aff * 0.5 + (x.dating ? 20 : 0), 0, 100);
  }
  function beginShoot(ctx) {
    var who = ctx.who, m = M(who), x = S(who), o;
    var model = { id: who, name: m.name, short: m.short, img: imgOf(who), best: isCl(who) ? m.best : m.best, joke: isCl(who) ? persOf(m).joke : m.joke };
    if (ctx.kind === "chapter") {
      var h = D.BY_ID[who];
      o = { title: "《十二月光》" + h.short + "的章節", cs: { mood: h.mood, frame: "half", want: h.poses.concat(["tempt", "intimate"]), adult: 1 }, scene: h.loc, theme: h.chapter.title };
    } else {
      var j = ctx.job, cs = D.CASES[j.type];
      o = { title: cs.ic + " " + cs.name, cs: { mood: j.mood, frame: j.frame, want: j.want, strict: cs.strict, adult: cs.adult }, scene: j.scene, theme: j.theme };
    }
    o.model = model; o.trust = shootTrust(who); o.mood = clamp(48 + x.aff / 4, 0, 100);
    o.gear = { lenses: st.gear.lenses.slice(), lights: st.gear.lights.slice(), films: st.gear.films.slice() };
    o.roll = owns("films", "long"); o.img = CUT;
    ui.shootCtx = ctx; ui.shootOpts = o;
    ui.screen = "shoot";
  }
  function afterShoot(res) {
    ui.mounted = false;
    var ctx = ui.shootCtx, ps = res.photos.slice();
    ps.forEach(function (p) { p.who = ctx.who; p.nm = M(ctx.who).name; p.day = st.day; p.t = ui.shootOpts.theme; p.cs = ctx.kind === "chapter" ? "chapter" : ctx.job.type; });
    var x = S(ctx.who);
    if (res.trustGain > 0) x.tr = clamp((x.tr || 0) + Math.round(res.trustGain / 2), 0, 60);
    var limit = ctx.kind === "chapter" ? 1 : 3;
    var order = ps.map(function (p, i) { return i; }).sort(function (a, b) { return ps[b].score - ps[a].score; });
    ui.sel = { photos: ps, limit: limit, chosen: order.slice(0, limit) };
    ui.screen = "select";
    render();
  }
  function confirmSelect() {
    var ctx = ui.shootCtx, sel = ui.sel, who = ctx.who, x = S(who);
    var chosen = sel.chosen.map(function (i) { return sel.photos[i]; });
    ui.sel = null; ui.shootCtx = null;
    var best = chosen.reduce(function (a, p) { return Math.max(a, p.score); }, 0);
    var avg = chosen.length ? chosen.reduce(function (a, p) { return a + p.score; }, 0) / chosen.length : 0;
    chosen.forEach(function (p) { st.port.push(p); });
    st.port.sort(function (a, b) { return b.score - a.score; });
    if (st.port.length > PORT_MAX) st.port.length = PORT_MAX;
    // 客人只在接案時見面，好感成長比女主角快一些
    var aff = isCl(who) ? Math.round(avg / 6) + (best >= 80 ? 5 : 0) : Math.round(avg / 12) + (best >= 80 ? 2 : 0);
    var lines = [];
    if (ctx.kind === "chapter") {
      var h = D.BY_ID[who], old = x.chapter;
      if (chosen[0] && (!old || chosen[0].score >= old.score)) x.chapter = chosen[0];
      st.fame = clamp(st.fame + (old ? 1 : 3), 0, 100);
      lines.push("《十二月光》" + h.short + "的章節：" + (x.chapter ? x.chapter.g + "（" + x.chapter.score + " 分）" : "沒有選片"));
      log("📖 拍攝章節：" + h.name + "　" + (x.chapter ? x.chapter.score + " 分" : "—"));
      addAff(who, aff + 2);
      ui.result = { title: "章節拍攝完成", lines: lines, after: toNight };
    } else {
      var j = ctx.job, cs = D.CASES[j.type];
      var pay = chosen.length ? Math.round(j.pay * (0.5 + avg / 100)) : 0;
      var fame = chosen.length ? Math.max(0, Math.round(cs.gain * (best >= 80 ? 2 : best >= 66 ? 1 : 0.5))) : 0;
      st.money += pay; st.fame = clamp(st.fame + fame, 0, 100);
      if (isCl(who)) x.meets = (x.meets || 0) + 1;
      addAff(who, aff);
      lines.push("交件 " + chosen.length + " 張，平均 " + Math.round(avg) + " 分");
      lines.push("報酬 " + money(pay) + "　名聲 +" + fame);
      log(cs.ic + " 交件：" + M(who).short + "　平均 " + Math.round(avg) + " 分　" + money(pay));
      var after = j.type === "travel" ? function () { st.travelNight = who; toNight(); } : toNight;
      if (isCl(who)) {
        var P = persOf(x), thanks = avg >= 70 ? P.thanks[0] : P.thanks[1];
        var next = after;
        if (j.type === "priv" && !x.dating && x.aff >= 56 && x.cool <= 0) next = function () { clientConfess(who, after); };
        ui.result = { title: "交件完成", lines: lines, who: who, quote: thanks, after: next };
      } else ui.result = { title: "交件完成", lines: lines, who: who, after: after };
    }
    ui.screen = "result";
    save(); render();
  }
  function clientConfess(id, after) {
    var P = persOf(st.cl[id]);
    var steps = P.confess.concat([{ ch: [
      { t: "抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡笑出聲，又哭又笑。", "從今天開始，你們交往了。"] },
      { t: "「……我是攝影師，你是客人。」", e: { a: -12 }, r: ["她愣了一下，然後低下頭：「……也是呢。」", "她把那組照片收進包包，轉身離開了。"] }
    ] }]);
    startVN(id, M(id).short + "・告白", steps, function () {
      var x = st.cl[id];
      if (x.aff >= 66) { x.dating = true; log("💕 和 " + x.short + " 開始交往"); } else x.cool = 4;
      after();
    });
  }

  // ---------------- 白天的其他行動 ----------------
  function dueLine(id) {
    var x = st.h[id];
    if (x.line >= 3 || x.aff < D.LINE_AFF[x.line]) return null;
    if (x.line === 1 && !x.chapter) return null; // 第 2 段：拍過章節之後
    return D.BY_ID[id].lines[x.line];
  }
  function dueConfess(id) {
    var x = S(id);
    if (isCl(id)) return false;
    return !x.dating && x.line >= 3 && x.aff >= D.CONFESS_AFF && x.cool <= 0;
  }
  function chapterReady(id) { var x = st.h[id]; return x.met && x.line >= 1 && x.aff >= D.CHAPTER_AFF; }
  function runLine(id, after) {
    var x = st.h[id], ev = D.BY_ID[id].lines[x.line];
    x.line++;
    log("📝 " + D.BY_ID[id].short + "的故事：" + ev.title + "（" + x.line + "/3）");
    startVN(id, D.BY_ID[id].short + "・" + ev.title + "（" + x.line + "/3）", ev.steps, after);
  }
  function runConfess(id, after) {
    var steps = D.BY_ID[id].confess.concat([{ ch: [
      { t: "抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡笑出聲，又哭又笑。", "從今天開始，你們交往了。"] },
      { t: "「……等寫真集完成再說。」", e: { a: -12 }, r: ["她愣了一下，然後低下頭：「……我知道了。」", "她轉身走了。你看到她的肩膀在發抖。"] }
    ] }]);
    startVN(id, D.BY_ID[id].short + "・告白", steps, function () {
      var x = st.h[id];
      if (x.aff >= D.CONFESS_AFF + 5) { x.dating = true; log("💕 和 " + D.BY_ID[id].short + " 開始交往"); } else x.cool = 3;
      after();
    });
  }
  function shootChapter(id) {
    var h = D.BY_ID[id], x = st.h[id];
    var go = function () { maybeJealous(id, function () { beginShoot({ kind: "chapter", who: id }); }); };
    if (!x.chapterSeen) { x.chapterSeen = true; startVN(id, h.short + "・" + h.chapter.title, h.chapter.steps.concat([{ e: { a: 4, tr: 4 } }]), go); return; }
    go();
  }
  var DATES = [
    { steps: ["你和{n}在河堤散步。她走在前面，偶爾回頭看你有沒有跟上。", ["@", "你走路好慢。……是故意的吧？想多走一會兒？"]],
      ch: [{ t: "「被你發現了。」", e: { a: 8 } }, { t: "牽起她的手", e: { a: 9, tr: 2 } }] },
    { steps: ["咖啡店的窗邊，{n}捧著拿鐵，看著你的相機。", ["@", "你每次看到好看的光，眼睛都會亮一下。像小孩子一樣。"]],
      ch: [{ t: "「現在也亮了。因為你在光裡。」", e: { a: 9 } }, { t: "幫她拍一張隨手照", e: { a: 6, tr: 4 } }] },
    { steps: ["{n}拉著你去逛二手相機店。她拿起一台老底片機，對著你。", ["@", "喀嚓。……拍到了。你剛剛的表情好呆。"]],
      ch: [{ t: "「那台送你。」", e: { a: 8, money: -3 } }, { t: "也用一台老相機拍她", e: { a: 7, tr: 3 } }] },
    { steps: ["下雨了，你們躲進一間小小的拉麵店。{n}的頭髮被淋濕了，貼在臉頰上。", ["@", "……看什麼看。快吃，麵要糊了。"]],
      ch: [{ t: "把自己的叉燒夾給她", e: { a: 8 } }, { t: "用毛巾幫她擦頭髮", e: { a: 9, tr: 2 } }] }
  ];
  function dateHeroine(id) {
    var h = D.BY_ID[id];
    log("☕ 和 " + h.short + " 見面");
    if (dueConfess(id)) { runConfess(id, toNight); return; }
    if (dueLine(id)) { runLine(id, toNight); return; }
    var d = pick(DATES);
    startVN(id, "白天・" + h.short, d.steps.concat([{ ch: d.ch }]), "toNight");
  }
  function postPortfolio() {
    var top = st.port.slice(0, 3), avg = top.length ? top.reduce(function (a, p) { return a + p.score; }, 0) / top.length : 0;
    var g = 1 + Math.floor(avg / 35);
    st.fame = clamp(st.fame + g, 0, 100);
    log("🖼 整理作品集上傳（名聲 +" + g + "）");
    ui.toast = "作品集上傳：名聲 +" + g;
    toNight(); render();
  }
  function buy(kind, id) {
    var list = kind === "lenses" ? D.LENSES : kind === "lights" ? D.LIGHTS : D.FILMS;
    var it = list.filter(function (x) { return x.id === id; })[0];
    if (!it || owns(kind, id) || st.money < it.price) return;
    st.money -= it.price; st.gear[kind].push(id);
    log("🛒 買了 " + it.name + "（" + money(it.price) + "）");
    ui.toast = "買了 " + it.name;
    save(); render();
  }

  // ---------------- 夜晚 ----------------
  function goSpot(spotId) {
    var spot = D.SPOTS.filter(function (s) { return s.id === spotId; })[0];
    var pool = metIds().filter(function (id) { return D.BY_ID[id].spot.indexOf(spotId) >= 0; });
    var due = pool.filter(function (id) { return dueLine(id) || dueConfess(id); });
    var who = null;
    if (due.length && Math.random() < 0.85) who = pick(due);
    else if (pool.length && Math.random() < 0.82) who = pick(pool);
    if (!who) { log(spot.ic + " " + spot.name + "：沒有遇到誰"); startVN(null, spot.name, [spot.quiet], "endNight"); return; }
    log(spot.ic + " " + spot.name + "：遇到 " + M(who).short);
    if (dueConfess(who)) { runConfess(who, endNight); return; }
    if (dueLine(who)) { runLine(who, "endNight"); return; }
    var evs = D.FREE.filter(function (f) { return f.spot === spotId; }), f = pick(evs);
    startVN(who, spot.name, f.steps.concat([{ ch: f.ch }]), "endNight");
  }
  function visit(id) { openStory(id, endNight); }
  function openStory(id, after) {
    var x = S(id), story, key, own = isCl(id) ? [] : ownList(id), ownIdx = -1;
    if (x.nights < own.length) { ownIdx = x.nights; story = own[ownIdx]; }
    else {
      var k; do { k = rnd(0, SHARED_ALL.length - 1); } while (SHARED_ALL.length > 1 && k === st.lastShared);
      st.lastShared = k; story = SHARED_ALL[k]; key = "sh_" + k;
    }
    x.nights++; addAff(id, 5);
    log("🌙 和 " + M(id).short + " 共度夜晚：" + story.title);
    if (isCl(id)) addAlbum("cl|" + x.img + "|" + x.name + "|" + key.slice(3));
    else addAlbum(ownIdx >= 0 ? ownKey(id, ownIdx) : key + "_" + id);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: after };
    ui.screen = "story";
    render();
  }
  function travelNight() {
    var id = st.travelNight; st.travelNight = null;
    var x = S(id);
    if (x.dating) { openStory(id, function () { endNight(2); }); return; }
    var steps = [
      "旅館的夜晚。工作結束後，{n}敲了你的房門，手上拿著兩罐啤酒。",
      ["@", "睡不著。……陪我聊一下？"],
      "你們坐在窗邊，聊到月亮升得很高。她的肩膀，不知道什麼時候靠在了你身上。",
      { ch: [
        { t: "輕輕摟住她的肩膀", e: { a: 12 }, r: ["她沒有躲開。過了很久，她小聲地說：「……今晚，我不想一個人回房間。」", "可是你們只是這樣靠著，一直到天亮。"] },
        { t: "「早點睡吧，明天還要拍。」", e: { a: 5, tr: 4 }, r: [["@", "……你真的很認真耶。"], "她笑著回房間了。"] }
      ] }
    ];
    startVN(id, "旅館之夜", steps, function () { endNight(2); });
  }
  function endNight(days) {
    D.HEROINES.forEach(function (h) { var x = st.h[h.id]; if (x.cool > 0) x.cool--; });
    clIds().forEach(function (id) { if (st.cl[id].cool > 0) st.cl[id].cool--; });
    st.day = Math.min(D.DAYS, st.day + (days || 1));
    st.phase = "day";
    ui.screen = "hub";
    dayStart();
    if (st.day >= 30 && !st.flags.mid) {
      st.flags.mid = 1;
      startVN("qiu", "第三十天・期中檢查", D.MIDCHECK.concat(["目前完成的章節：" + chaptersDone() + "／12。"]), function () { ui.screen = "hub"; save(); });
    }
    save(); render();
  }

  // ---------------- 交稿與結局 ----------------
  function finalTier() {
    var done = chaptersDone(), sum = 0;
    D.HEROINES.forEach(function (h) { if (st.h[h.id].chapter) sum += st.h[h.id].chapter.score; });
    var avg = sum / 12;
    return { done: done, avg: avg, tier: done < 6 ? "delay" : avg >= 72 ? "award" : avg >= 52 ? "reprint" : "quiet" };
  }
  function ending(cover) {
    st.ended = true; st.cover = cover;
    var f = finalTier(), ds = dating();
    var rel = !ds.length ? "alone" : cover && S(cover).dating ? "true" : ds.length >= 3 ? "harem" : "other";
    ui.end = { tier: f.tier, avg: f.avg, done: f.done, rel: rel, cover: cover };
    var best = load(BEST_KEY) || {};
    best[f.tier] = (best[f.tier] || 0) + 1;
    if (rel === "true") best["true_" + cover] = 1;
    store(BEST_KEY, best);
    store(SAVE_KEY, null);
    ui.screen = "ending";
    render();
  }

  // ---------------- 畫面 ----------------
  function portrait(id, cls) {
    if (!id || !M(id)) return "";
    return '<img class="sh-pt ' + (cls || "") + '" src="' + IMG + esc(imgOf(id)) + '" alt="" style="--sh-c:' + M(id).color + '">';
  }
  function bar(v, cls) { return '<span class="sh-bar ' + (cls || "") + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></span>'; }
  function photo(p, w) { return SH.photoHTML(p, CUT, w); }

  function render() {
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    if (ui.screen === "shoot") {
      if (ui.mounted) return;
      ui.mounted = true;
      app.innerHTML = '<div class="sh-root"><div class="sh-shoot-host"></div></div>';
      SH.mount(app.querySelector(".sh-shoot-host"), ui.shootOpts, afterShoot);
      return;
    }
    var h = "";
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "select") h = renderSelect();
    else if (ui.screen === "result") h = renderResult();
    else if (ui.screen === "final") h = renderFinal();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else if (ui.screen === "cast") h = renderCast();
    else h = renderHub();
    if (ui.toast) { h += '<div class="sh-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="sh-root">' + h + "</div>";
  }
  function renderAge() {
    return '<div class="sh-age"><p class="sh-age-mark">18+</p><h2>本遊戲含成人向內容</h2>' +
      '<p>遊戲中有成年角色之間的親密、性暗示描寫，以及私人寫真的拍攝場景。登場人物全員皆為 21 歲以上的成年人。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="sh-row"><button class="sh-btn sh-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="sh-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY), best = load(BEST_KEY) || {};
    var h = '<div class="sh-title"><p class="sh-sub">寫真集企劃《十二月光》</p><h1>快門之後</h1><p class="sh-tag">六十天，十二個她。<br>取景、打光、等待那 0.5 秒——然後，按下快門。</p>';
    h += '<div class="sh-faces">' + D.HEROINES.map(function (x) { return '<img class="sh-pt sh-face" src="' + IMG + esc((saved && saved.img && saved.img[x.id]) || x.img) + '" alt="">'; }).join("") + "</div>";
    h += '<div class="sh-row">';
    if (saved) h += '<button class="sh-btn sh-primary" data-act="continue">繼續（第 ' + saved.day + " 天）</button>";
    h += '<button class="sh-btn' + (saved ? "" : " sh-primary") + '" data-act="new">' + (saved ? "重新開始" : "開始企劃") + "</button>";
    h += '<button class="sh-btn" data-act="album">夜晚回憶</button></div>';
    var trues = Object.keys(best).filter(function (k) { return k.indexOf("true_") === 0; }).length;
    if (best.award || trues) h += '<p class="sh-muted sh-small">' + (best.award ? "🏆 年度寫真集大賞 " + best.award + " 次　" : "") + (trues ? "💕 真結局 " + trues + "／12" : "") + "</p>";
    return h + "</div>";
  }
  function renderCast() {
    var h = '<div class="sh-panel"><h2>選角：她們的樣子</h2><p class="sh-small sh-muted">點一位女主角，從頭像庫幫她換外觀。名字和故事不變。</p><div class="sh-grid">';
    h += D.HEROINES.map(function (x) {
      return '<button class="sh-card' + (ui.castPick === x.id ? " sh-lovecard" : "") + '" data-act="castPick" data-id="' + x.id + '">' + portrait(x.id, "sh-big") + "<b>" + esc(x.name) + '</b><span class="sh-small sh-muted">' + esc(x.job) + "</span></button>";
    }).join("") + "</div>";
    if (ui.castPick) {
      var used = usedByCast(ui.castPick);
      h += "<h3>" + esc(M(ui.castPick).name) + ' 的外觀</h3><div class="sh-gallery">' + C.POOL.filter(function (img) { return !used[img]; }).map(function (img) {
        return '<button class="sh-gimg' + (imgOf(ui.castPick) === img ? " sh-gsel" : "") + '" data-act="castImg" data-img="' + img + '"><img src="' + IMG + img + '" alt="" loading="lazy"></button>';
      }).join("") + "</div>";
    }
    return h + '<div class="sh-row"><button class="sh-btn" data-act="castRandom">全部隨機</button><button class="sh-btn" data-act="castReset">恢復預設</button><button class="sh-btn sh-primary" data-act="castStart">開始企劃</button></div></div>';
  }
  function renderTop() {
    return '<div class="sh-top"><div><b class="sh-day">第 ' + st.day + " 天</b>／" + D.DAYS + '　<span class="sh-phase">' + (st.phase === "day" ? "☀ 白天" : "🌙 夜晚") + "</span></div>" +
      '<div class="sh-small"><span class="' + (st.money < 0 ? "sh-warn" : "") + '">💰 ' + money(st.money) + "</span>　⭐ 名聲 <b>" + st.fame + "</b>　📖 章節 <b>" + chaptersDone() + "</b>／12</div>" +
      '<div class="sh-tabs"><button class="sh-btn sh-sm" data-act="panel" data-p="roster">她們</button> <button class="sh-btn sh-sm" data-act="panel" data-p="book">寫真集</button> <button class="sh-btn sh-sm" data-act="panel" data-p="port">作品集</button> <button class="sh-btn sh-sm" data-act="panel" data-p="shop">器材行</button> <button class="sh-btn sh-sm" data-act="panel" data-p="log">紀錄</button> <button class="sh-btn sh-sm" data-act="title">標題</button></div></div>';
  }
  function renderHub() {
    var h = renderTop();
    if (ui.panel === "roster") h += renderRoster();
    else if (ui.panel === "book") h += renderBook();
    else if (ui.panel === "port") h += renderPort();
    else if (ui.panel === "shop") h += renderShop();
    else if (ui.panel === "log") h += '<div class="sh-panel"><h3>紀錄</h3><ul class="sh-log">' + st.log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + '</ul><button class="sh-btn sh-sm" data-act="panel" data-p="">關閉</button></div>';

    if (st.day >= D.DAYS && st.phase === "day") {
      var f = finalTier();
      h += '<div class="sh-panel sh-center"><h2>📖 交稿日</h2><p>六十天到了。知秋在編輯部等你。</p><p class="sh-small">完成章節 ' + f.done + "／12，平均 " + Math.round(f.avg) + ' 分（沒拍的章節算 0 分）</p><button class="sh-btn sh-primary" data-act="final">交出《十二月光》</button></div>';
      return h;
    }
    if (st.phase === "day") {
      var pm = pendingMeets();
      if (pm.length) {
        h += '<div class="sh-panel"><h3>📩 新的邀約</h3><p class="sh-small sh-muted">名聲提高後，名單上的她們會主動聯絡你（不花時間）。</p><div class="sh-grid">' + pm.map(function (id) {
          return '<button class="sh-card sh-lovecard" data-act="meet" data-id="' + id + '">' + portrait(id, "sh-mini") + "<b>" + esc(D.BY_ID[id].name) + ' <span class="sh-new">！</span></b><span class="sh-small">' + esc(D.BY_ID[id].job) + "</span></button>";
        }).join("") + "</div></div>";
      }
      var locked = D.HEROINES.filter(function (x) { return !st.h[x.id].met && st.fame < x.fame; });
      if (locked.length) h += '<p class="sh-small sh-muted sh-center">還沒聯絡你的人：' + locked.map(function (x) { return "名聲 " + x.fame; }).join("、") + "</p>";
      // 案子
      h += '<div class="sh-panel"><h3>📋 委託</h3><div class="sh-grid">' + st.jobs.map(function (j) {
        var cs = D.CASES[j.type], m = M(j.who);
        return '<button class="sh-card' + (j.request ? " sh-lovecard" : "") + '" data-act="job" data-id="' + j.id + '"><div class="sh-cardhead">' + portrait(j.who, "sh-mini") + "<div><b>" + cs.ic + " " + esc(cs.name) + "</b><br><span class=\"sh-small\">" + esc(m.short) + (isCl(j.who) ? "（" + esc(m.job) + "）" : "") + "</span></div></div>" +
          '<span class="sh-small">「' + esc(j.theme) + "」・" + esc(D.SCENES[j.scene].name) + "</span>" +
          '<span class="sh-small sh-muted">' + D.MOODS[j.mood] + "系・" + D.FRAMES[j.frame] + "・" + money(j.pay) + "〜" + (cs.travel ? "・兩天一夜" : "") + "</span>" +
          '<span class="sh-small sh-muted">期限：第 ' + j.expire + " 天" + (j.request ? "・💌 指名委託" : "") + "</span></button>";
      }).join("") + '</div><p class="sh-small sh-muted">' + D.CASE_ORDER.map(function (t) { var c = D.CASES[t]; return (st.fame >= c.fame ? "" : "🔒") + c.ic + c.name + (st.fame >= c.fame ? "" : "（名聲 " + c.fame + "）"); }).join("　") + "</p></div>";
      // 章節
      var ready = metIds().filter(chapterReady);
      h += '<div class="sh-panel"><h3>📖 拍攝寫真集章節</h3>';
      if (ready.length) h += '<div class="sh-grid">' + ready.map(function (id) {
        var x = st.h[id], hh = D.BY_ID[id];
        return '<button class="sh-card" data-act="chapter" data-id="' + id + '">' + portrait(id, "sh-mini") + "<b>" + esc(hh.short) + '</b><span class="sh-small">' + esc(D.SCENES[hh.loc].name) + "・" + D.MOODS[hh.mood] + "系</span><span class=\"sh-small sh-muted\">" + (x.chapter ? "目前 " + x.chapter.g + "（" + x.chapter.score + "）・可以重拍" : "尚未拍攝") + "</span></button>";
      }).join("") + "</div>";
      else h += '<p class="sh-small sh-muted">先和她們熟一點（好感 ' + D.CHAPTER_AFF + "、看過她的第一段故事），才能拍她的章節。</p>";
      h += "</div>";
      // 約她
      var met = metIds();
      h += '<div class="sh-panel"><h3>☕ 約她見面</h3><div class="sh-grid">' + met.map(function (id) {
        var x = st.h[id];
        var mark = dueConfess(id) || dueLine(id) ? ' <span class="sh-new">！</span>' : "";
        return '<button class="sh-card" data-act="date" data-id="' + id + '">' + portrait(id, "sh-mini") + "<b>" + esc(D.BY_ID[id].short) + mark + (x.dating ? " 💕" : "") + '</b><span class="sh-small sh-muted">' + tierName(x.aff) + "・故事 " + x.line + "/3</span></button>";
      }).join("") + '</div><div class="sh-row"><button class="sh-btn sh-sm" data-act="post">整理作品集上傳（名聲 +）</button></div></div>';
    } else {
      if (st.travelNight) {
        h += '<div class="sh-panel sh-center"><h3>🏨 旅館之夜</h3><p>外拍的第一天結束了。' + esc(M(st.travelNight).short) + ' 在隔壁房間。</p><button class="sh-btn sh-primary" data-act="travelnight">……</button></div>';
        return h;
      }
      h += '<div class="sh-panel"><h3>🌙 夜晚</h3><div class="sh-grid">' + D.SPOTS.map(function (s) {
        var fans = metIds().filter(function (id) { return D.BY_ID[id].spot.indexOf(s.id) >= 0; }).map(function (id) { return D.BY_ID[id].short; }).join("、");
        return '<button class="sh-card" data-act="spot" data-id="' + s.id + '"><b>' + s.ic + " " + esc(s.name) + '</b><span class="sh-small sh-muted">常出沒：' + esc(fans || "—") + "</span></button>";
      }).join("") + "</div>";
      var ds = dating();
      if (ds.length) {
        h += '<h3>💕 去她那裡</h3><div class="sh-grid">' + ds.map(function (id) {
          return '<button class="sh-card sh-lovecard" data-act="visit" data-id="' + id + '">' + portrait(id, "sh-mini") + "<b>" + esc(M(id).short) + '</b><span class="sh-small">' + (S(id).nights ? "共度了 " + S(id).nights + " 晚" : "第一次的夜晚") + "</span></button>";
        }).join("") + "</div>";
        if (ds.length >= 2) h += '<p class="sh-small sh-warn">同時和 ' + ds.length + " 個人交往中……拍照時小心有人來探班。</p>";
      }
      h += '<div class="sh-row"><button class="sh-btn sh-sm" data-act="sleep">早點睡</button></div></div>';
    }
    return h;
  }
  function renderRoster() {
    var h = '<div class="sh-panel"><h3>《十二月光》的她們</h3><div class="sh-roster">';
    D.HEROINES.forEach(function (m) {
      var x = st.h[m.id];
      if (!x.met) { h += '<div class="sh-mem sh-dim">' + portrait(m.id, "sh-mini") + "<div><b>？？？</b> <span class=\"sh-small sh-muted\">" + esc(m.job) + "・名聲 " + m.fame + " 以上會聯絡你</span></div></div>"; return; }
      h += '<div class="sh-mem">' + portrait(m.id, "sh-big") + "<div><b>" + esc(m.name) + '</b> <span class="sh-small sh-muted">' + m.age + " 歲・" + esc(m.job) + "・" + esc(m.pers) + "</span>" +
        '<p class="sh-small">' + esc(m.intro) + "</p>" +
        '<p class="sh-small">好感 ' + bar(x.aff, "sh-bar-aff") + " " + x.aff + "（" + tierName(x.aff) + "）　信任 +" + (x.tr || 0) + (x.dating ? "　💕 交往中" : "") + "</p>" +
        '<p class="sh-small sh-muted">故事 ' + x.line + "/3" + (x.line < 3 ? "（下一段：好感 " + D.LINE_AFF[x.line] + (x.line === 1 && !x.chapter ? "、先拍她的章節" : "") + "）" : x.dating ? "" : "（好感 " + D.CONFESS_AFF + " 會有特別的事）") +
        "　章節：" + (x.chapter ? x.chapter.g + "（" + x.chapter.score + "）" : "未拍") + "　常去：" + m.spot.map(function (s) { return D.SPOTS.filter(function (y) { return y.id === s; })[0].name; }).join("、") + "</p></div></div>";
    });
    var cs = clIds();
    h += '</div><h3>客人（' + cs.length + '）</h3><p class="sh-small sh-muted">常客好感夠高，會寄來私人寫真的委託；私人寫真之後，也許會發生特別的事。</p><div class="sh-roster">';
    cs.forEach(function (id) {
      var c = st.cl[id];
      h += '<div class="sh-mem">' + portrait(id, "sh-mini") + "<div><b>" + esc(c.name) + '</b> <span class="sh-small sh-muted">' + c.age + " 歲・" + esc(c.job) + "・" + esc(persOf(c).name) + '</span><p class="sh-small">拍過 ' + c.meets + " 次　好感 " + c.aff + "（" + tierName(c.aff) + "）" + (c.dating ? "　💕 交往中" : "") + "</p></div></div>";
    });
    return h + '</div><button class="sh-btn sh-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderBook() {
    var f = finalTier();
    var h = '<div class="sh-panel"><h3>📖 《十二月光》進度</h3><p class="sh-small">完成 ' + f.done + "／12　平均 " + Math.round(f.avg) + ' 分（未拍＝0）。最後一天交稿時，從章節照片中選一張當封面。</p><div class="sh-book">';
    D.HEROINES.forEach(function (m, i) {
      var x = st.h[m.id];
      h += '<div class="sh-chap"><div class="sh-chap-pic">' + (x.chapter ? photo(x.chapter, 150) : '<div class="sh-empty">' + (x.met ? "未拍攝" : "？？？") + "</div>") + '</div><span class="sh-small">第 ' + (i + 1) + " 章　" + (x.met ? esc(m.short) : "？？？") + (x.chapter ? "　<b class=\"sh-g sh-g" + x.chapter.g + "\">" + x.chapter.g + "</b> " + x.chapter.score : "") + "</span></div>";
    });
    return h + '</div><button class="sh-btn sh-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderPort() {
    var h = '<div class="sh-panel"><h3>🖼 作品集（' + st.port.length + "／" + PORT_MAX + '）</h3><p class="sh-small sh-muted">交件的照片會收進這裡（只保留分數最高的 ' + PORT_MAX + " 張）。白天可以「整理作品集上傳」換名聲。</p><div class=\"sh-portgrid\">";
    h += st.port.map(function (p) {
      return '<div class="sh-portitem">' + photo(p, 170) + '<span class="sh-small"><b class="sh-g sh-g' + p.g + '">' + p.g + "</b> " + p.score + "　" + esc(p.nm || "") + '</span><span class="sh-small sh-muted">「' + esc(p.t || "") + "」D" + p.day + "</span></div>";
    }).join("");
    return h + '</div><button class="sh-btn sh-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderShop() {
    function sect(title, kind, list) {
      return "<h4>" + title + '</h4><div class="sh-grid">' + list.filter(function (x) { return x.price > 0; }).map(function (it) {
        var own = owns(kind, it.id);
        return '<button class="sh-card" data-act="buy" data-k="' + kind + '" data-id="' + it.id + '"' + (own || st.money < it.price ? " disabled" : "") + "><b>" + esc(it.name) + '</b><span class="sh-small">' + esc(it.desc) + '</span><span class="sh-small sh-muted">' + (own ? "✔ 已擁有" : money(it.price)) + "</span></button>";
      }).join("") + "</div>";
    }
    return '<div class="sh-panel"><h3>🛒 器材行</h3><p class="sh-small sh-muted">買東西不花時間。目前 ' + money(st.money) + "。</p>" + sect("鏡頭", "lenses", D.LENSES) + sect("燈具", "lights", D.LIGHTS) + sect("底片", "films", D.FILMS) +
      '<button class="sh-btn sh-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderSelect() {
    var sel = ui.sel, ctx = ui.shootCtx;
    var h = '<div class="sh-panel"><h2>🎞 挑片</h2><p class="sh-small">' + (ctx.kind === "chapter" ? "選 1 張放進寫真集的章節。" : "選最多 " + sel.limit + " 張交給客戶（報酬看平均分數，名聲看最好的一張）。") + "　已選 " + sel.chosen.length + "／" + sel.limit + "</p>";
    if (!sel.photos.length) h += '<p class="sh-muted">一張都沒有拍……</p>';
    h += '<div class="sh-portgrid">' + sel.photos.map(function (p, i) {
      var on = sel.chosen.indexOf(i) >= 0;
      return '<button class="sh-portitem sh-pick' + (on ? " sh-picked" : "") + '" data-act="pickphoto" data-k="' + i + '">' + photo(p, 170) + '<span class="sh-small"><b class="sh-g sh-g' + p.g + '">' + p.g + "</b> " + p.score + (on ? "　✔" : "") + '</span><span class="sh-small sh-muted">' + esc((p.notes || []).join("・")) + "</span></button>";
    }).join("") + "</div>";
    return h + '<div class="sh-row"><button class="sh-btn sh-primary" data-act="confirmsel">確定</button></div></div>';
  }
  function renderResult() {
    var r = ui.result;
    var h = '<div class="sh-panel sh-center"><h2>' + esc(r.title) + "</h2>";
    if (r.who && r.quote) h += '<div class="sh-quote">' + portrait(r.who, "sh-big") + "<p>「" + esc(r.quote) + "」</p></div>";
    h += r.lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("");
    return h + '<div class="sh-row"><button class="sh-btn sh-primary" data-act="resultok">繼續</button></div></div>';
  }
  function renderFinal() {
    var f = finalTier(), cands = D.HEROINES.filter(function (m) { return st.h[m.id].chapter; });
    var h = '<div class="sh-panel"><h2>📖 交稿：選擇封面</h2><p>完成 ' + f.done + "／12 章，平均 " + Math.round(f.avg) + " 分。封面是整本書的臉——也是你的答案。</p>";
    if (!cands.length) return h + '<p class="sh-muted">一個章節都沒有拍……</p><div class="sh-row"><button class="sh-btn sh-primary" data-act="cover" data-id="">交出空白的書</button></div></div>';
    h += '<div class="sh-book">' + cands.map(function (m) {
      var x = st.h[m.id];
      return '<button class="sh-chap sh-pick" data-act="cover" data-id="' + m.id + '"><div class="sh-chap-pic">' + photo(x.chapter, 170) + '</div><span class="sh-small"><b>' + esc(m.name) + "</b>" + (x.dating ? " 💕" : "") + "　" + x.chapter.g + " " + x.chapter.score + "</span></button>";
    }).join("") + "</div>";
    return h + "</div>";
  }
  function renderEnding() {
    var e = ui.end, cover = e.cover ? D.BY_ID[e.cover] : null;
    var head = { award: "🏆 年度寫真集大賞", reprint: "📚 好評再版", quiet: "📕 低調出版", delay: "⏳ 出版延期" }[e.tier];
    var body = {
      award: "《十二月光》在書店上架的第一週就賣到缺貨。年底，它拿下了年度寫真集大賞。頒獎台上，知秋說：「這是沈老師的書，也是一個新的攝影師的書。」",
      reprint: "《十二月光》安靜地上架，然後安靜地一刷再刷。書店的店員說，買這本書的人，常常會站在書架前看很久。",
      quiet: "《十二月光》出版了，沒有太多人注意到。可是書裡的她們，每個人都收到了一本。那就夠了。",
      delay: "章節太少，書出不了。知秋把企劃書收回了抽屜：「再給你一次機會。……下一次。」"
    }[e.tier];
    var h = '<div class="sh-panel sh-ending"><h2>' + head + '</h2><p class="sh-small sh-center">完成 ' + e.done + "／12 章　平均 " + Math.round(e.avg) + " 分</p><p>" + esc(body) + "</p>";
    if (cover && e.tier !== "delay") {
      h += '<div class="sh-cover">' + photo(st.h[cover.id].chapter, 260) + '<p class="sh-small">封面：' + esc(cover.name) + "</p></div>";
      if (e.rel === "true") h += '<p class="sh-love">💕 封面上的她，是你愛的人。——' + esc(cover.short) + "的真結局</p>";
      else if (st.h[cover.id].met) h += "<p>封面上的" + esc(cover.short) + "，對著全世界笑著。而你，只是鏡頭後面的那個人。</p>";
    }
    h += "<h3>那之後的她們</h3>";
    D.HEROINES.forEach(function (m) {
      var x = st.h[m.id]; if (!x.met) return;
      h += '<div class="sh-mem">' + portrait(m.id, "sh-mini") + "<div><b>" + esc(m.name) + "</b>" + (x.dating ? " 💕" : "") + '<p class="sh-small">' + esc(x.dating ? m.epi : m.epiN) + "</p></div></div>";
    });
    clIds().filter(function (id) { return st.cl[id].dating; }).forEach(function (id) {
      var c = st.cl[id];
      h += '<div class="sh-mem">' + portrait(id, "sh-mini") + "<div><b>" + esc(c.name) + '</b> 💕 <span class="sh-small sh-muted">' + esc(c.job) + '</span><p class="sh-small">' + esc(persOf(c).epi.replace(/\{n\}/g, c.short)) + "</p></div></div>";
    });
    if (e.rel === "harem") h += '<p class="sh-warn">……另外，你同時和 ' + dating().length + " 個人交往的事，在出版紀念會上全部穿幫了。據說那天的簽名會，你的簽名是用左手簽的。</p>";
    if (e.rel === "alone") h += "<p class=\"sh-muted\">你沒有和任何人在一起。只有那台相機，一直陪著你。</p>";
    return h + '<div class="sh-row"><button class="sh-btn sh-primary" data-act="title">回到標題</button></div></div>';
  }
  function renderAlbum() {
    var a = album(), h = '<div class="sh-panel"><h2>夜晚回憶</h2><p class="sh-muted sh-small">看過的夜晚劇情可以在這裡重看。</p><div class="sh-roster">';
    D.HEROINES.forEach(function (m) {
      var btns = ownList(m.id).map(function (s, i) { return a[ownKey(m.id, i)] ? '<button class="sh-btn sh-sm" data-act="replay" data-k="own' + i + '" data-id="' + m.id + '">' + esc(s.title) + "</button> " : ""; }).join("");
      h += '<div class="sh-mem"><img class="sh-pt sh-mini" src="' + IMG + esc(m.img) + '" alt=""><div><b>' + esc(m.name) + "</b><br>";
      h += btns || '<span class="sh-muted sh-small">？？？</span>';
      SHARED_ALL.forEach(function (s, i) { if (a["sh_" + i + "_" + m.id]) h += ' <button class="sh-btn sh-sm" data-act="replay" data-k="' + i + '" data-id="' + m.id + '">' + esc(s.title) + "</button>"; });
      h += "</div></div>";
    });
    var cls = {};
    Object.keys(a).forEach(function (k) { if (k.indexOf("cl|") === 0) { var p = k.split("|"); var key = p[1] + "|" + p[2]; (cls[key] = cls[key] || []).push(+p[3]); } });
    Object.keys(cls).forEach(function (key) {
      var p = key.split("|");
      h += '<div class="sh-mem"><img class="sh-pt sh-mini" src="' + IMG + esc(p[0]) + '" alt=""><div><b>' + esc(p[1]) + '</b> <span class="sh-small sh-muted">客人</span><br>' +
        cls[key].sort().map(function (i) { return '<button class="sh-btn sh-sm" data-act="replayCl" data-k="' + i + '" data-img="' + esc(p[0]) + '" data-name="' + esc(p[1]) + '">' + esc(SHARED_ALL[i].title) + "</button>"; }).join(" ") + "</div></div>";
    });
    return h + '</div><div class="sh-row"><button class="sh-btn" data-act="title">返回</button></div></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], h = '<div class="sh-vn">';
    if (v.title) h += '<p class="sh-vn-title">' + esc(v.title) + "</p>";
    var who = null, text = "";
    if (typeof s === "string") text = s;
    else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var speaker = who === "@" ? v.who : who;
    var npc = speaker && speaker.charAt(0) === "?";
    var showPt = speaker && speaker !== "me" && !npc && M(speaker) ? speaker : v.who;
    h += '<div class="sh-stage">' + (showPt ? portrait(showPt, "sh-vnpt") : "") + "</div>";
    h += '<div class="sh-box">';
    if (who) h += '<p class="sh-name" style="color:' + (speaker && !npc && speaker !== "me" && M(speaker) ? M(speaker).color : "#ffd59a") + '">' + esc(speaker === "me" ? "你" : npc ? speaker.slice(1) : M(speaker).name) + "</p>";
    if (s && s.ch) h += '<div class="sh-choices">' + s.ch.map(function (c, k) { return '<button class="sh-btn sh-choice" data-act="ch" data-k="' + k + '">' + esc(fill(c.t)) + "</button>"; }).join("") + "</div>";
    else h += '<p class="sh-text">' + esc(fill(text)) + '</p><button class="sh-btn sh-primary sh-next" data-act="next">▼</button>';
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story, m = s.look || M(s.who);
    var h = '<div class="sh-story"><p class="sh-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + "</small></p>";
    h += '<div class="sh-stage sh-stage-night">' + (s.look ? '<img class="sh-pt sh-vnpt" src="' + IMG + esc(s.look.img) + '" alt="">' : portrait(s.who, "sh-vnpt")) + "</div>";
    h += '<div class="sh-box sh-box-night"><p class="sh-text">' + esc(String(s.pages[s.i]).replace(/\{n\}/g, m.short)) + "</p>";
    h += '<div class="sh-row">' + (s.i > 0 ? '<button class="sh-btn sh-sm" data-act="sprev">上一段</button>' : "") +
      '<button class="sh-btn sh-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
    return h;
  }

  // ---------------- 輸入 ----------------
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); if (st) { st.cl = st.cl || {}; st.img = st.img || {}; } ui.screen = st ? "hub" : "title"; render(); return; }
    if (act === "title") { if (st && !st.ended) save(); ui.screen = "title"; ui.panel = null; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") {
      var k = b.getAttribute("data-k"), story = k.indexOf("own") === 0 ? ownList(id)[+k.slice(3)] : SHARED_ALL[+k];
      ui.story = { who: null, look: { img: D.BY_ID[id].img, short: D.BY_ID[id].short }, title: story.title, pages: story.pages, i: 0, after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "replayCl") {
      var sk = SHARED_ALL[+b.getAttribute("data-k")], nm = b.getAttribute("data-name");
      ui.story = { who: null, look: { img: b.getAttribute("data-img"), short: nm.length > 2 ? nm.slice(1) : nm }, title: sk.title, pages: sk.pages, i: 0, after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "castPick") { ui.castPick = ui.castPick === id ? null : id; render(); return; }
    if (act === "castImg") { st.img[ui.castPick] = b.getAttribute("data-img"); render(); return; }
    if (act === "castRandom") { randomizeCast(); render(); return; }
    if (act === "castReset") { st.img = {}; render(); return; }
    if (act === "castStart") { startStory(); render(); return; }
    if (act === "panel") { var p = b.getAttribute("data-p"); ui.panel = ui.panel === p ? null : (p || null); render(); return; }
    if (act === "meet") { meetHeroine(id); render(); return; }
    if (act === "job") { ui.panel = null; acceptJob(id); render(); return; }
    if (act === "chapter") { ui.panel = null; shootChapter(id); render(); return; }
    if (act === "date") { ui.panel = null; dateHeroine(id); render(); return; }
    if (act === "post") { postPortfolio(); return; }
    if (act === "buy") { buy(b.getAttribute("data-k"), id); return; }
    if (act === "pickphoto") {
      var i = +b.getAttribute("data-k"), sel = ui.sel, at = sel.chosen.indexOf(i);
      if (at >= 0) sel.chosen.splice(at, 1);
      else { if (sel.chosen.length >= sel.limit) sel.chosen.shift(); sel.chosen.push(i); }
      render(); return;
    }
    if (act === "confirmsel") { confirmSelect(); return; }
    if (act === "resultok") { var r = ui.result; ui.result = null; r.after(); render(); return; }
    if (act === "spot") { ui.panel = null; goSpot(id); render(); return; }
    if (act === "visit") { ui.panel = null; visit(id); render(); return; }
    if (act === "travelnight") { travelNight(); render(); return; }
    if (act === "sleep") { log("🛌 早早睡了"); endNight(); return; }
    if (act === "final") { ui.panel = null; ui.screen = "final"; render(); return; }
    if (act === "cover") { ending(id || null); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s = ui.story; if (s.i + 1 < s.pages.length) { s.i++; render(); } else { ui.story = null; s.after(); if (ui.screen === "story") render(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ui.screen === "shoot") return;
    if (ev.key !== " " && ev.key !== "Enter") return;
    var btn = app.querySelector(".sh-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  window.PriTestShutter = { _state: function () { return st; }, _ui: function () { return ui; } };
  render();
})();
