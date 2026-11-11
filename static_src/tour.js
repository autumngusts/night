// 星途巡演（tour）：規則與畫面。你是 5 人偶像團體 LUMINA 的經紀人，帶她們跑 20 個城市的巡演。
// 每站：白天兩個行動（排練／宣傳／休息／單獨相處）→ 演出（節奏小遊戲打 call）→ 夜晚（巴士、酒吧、頂樓、街頭、她的房間）。
// 狗仔指數到 100 會被週刊爆料。最終站台北大巨蛋，依總人氣與每個人的關係決定結局。
// 2026-11-11 依使用者需求新增。18 禁確認沿用冠軍教練（champ）的做法。
(function () {
  "use strict";

  var D = window.PriTestTourData, N = window.PriTestTourNight, C = window.PriTestTourCast;
  var app = document.getElementById("tr-app");
  if (!D || !N || !C || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-tour-save-v1";
  var AGE_KEY = "pritest-tour-age-ok";
  var ALBUM_KEY = "pritest-tour-album";
  var LANE_KEYS = ["d", "f", "j", "k"];
  var CALLS = ["Hi!", "Fu-Fu!", "L・O・V・E!", "LUMINA!", "Oi!", "Hey!", "可愛い!", "最高!"];

  var st = null;
  var ui = { screen: "title", vn: null, story: null, panel: null, toast: "", ageOk: false, pickDate: false, rg: null, result: null, castPick: null };

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
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

  // 成員（D.BY_ID）與邂逅角色（st.enc，id 以 e 開頭）共用 M／S
  function isEnc(id) { return !!id && id.charAt(0) === "e" && !D.BY_ID[id]; }
  function M(id) { return D.BY_ID[id] || (st && st.enc && st.enc[id]); }
  function S(id) { return isEnc(id) ? st.enc[id] : st.m[id]; }
  function nm(id) { var m = M(id); return m.short || m.name; }
  function imgOf(id) { if (D.BY_ID[id]) return (st && st.img && st.img[id]) || D.BY_ID[id].img; var e = M(id); return e ? e.img : ""; }
  function encIds() { return st && st.enc ? Object.keys(st.enc) : []; }
  function persOf(e) { return C.PERS.filter(function (p) { return p.id === e.pers; })[0]; }
  function city() { return D.CITIES[st.city]; }
  function avg(stat) { var t = 0; D.MEMBERS.forEach(function (m) { t += S(m.id).s[stat]; }); return t / D.MEMBERS.length; }
  function avgSta() { var t = 0; D.MEMBERS.forEach(function (m) { t += S(m.id).sta; }); return t / D.MEMBERS.length; }
  function avgMood() { var t = 0; D.MEMBERS.forEach(function (m) { t += S(m.id).mood; }); return t / D.MEMBERS.length; }
  function dating() { return D.MEMBERS.map(function (m) { return m.id; }).concat(encIds()).filter(function (id) { return S(id).dating; }); }
  function tierName(a) { return a >= 90 ? "摯愛" : a >= 75 ? "心動" : a >= 55 ? "信賴" : a >= 35 ? "親近" : a >= 15 ? "熟悉" : "工作夥伴"; }
  function log(t) { st.log.unshift(city().name + "　" + t); if (st.log.length > 40) st.log.length = 40; }

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { city: 0, phase: "day", slot: 0, fans: 5000, zap: 0, flags: {}, log: [], shows: [], lastShared: -1, ended: false, scandal: null, m: {}, img: {}, enc: {} };
    D.MEMBERS.forEach(function (m) {
      st.m[m.id] = { s: { vo: m.s.vo, da: m.s.da, ch: m.s.ch }, sta: 100, mood: 0, aff: rnd(0, 6), line: 0, dating: false, nights: 0, cool: 0 };
    });
    ui.panel = null; ui.castPick = null;
    ui.screen = "cast";
  }
  // 選角：替成員換外觀（只能選頭像池 C.POOL，且不和其他成員重複）
  function usedByCast(except) { var u = {}; D.MEMBERS.forEach(function (m) { if (m.id !== except) u[imgOf(m.id)] = 1; }); return u; }
  function randomizeCast() {
    var pool = C.POOL.slice(), out = {};
    D.MEMBERS.forEach(function (m) { var k = rnd(0, pool.length - 1); out[m.id] = pool[k]; pool.splice(k, 1); });
    st.img = out;
  }
  function startTour() {
    ui.castPick = null;
    startVN(null, "巡演前夜", [
      "事務所的會議室裡，五個人坐成一排。",
      "偶像團體 LUMINA。出道三年，人氣不上不下。社長下了最後通牒：這次的二十城巡演，最後一站要站上台北大巨蛋——賣不滿，就解散。",
      "而你，是剛被指派的新經紀人。",
      ["mo", "我是隊長澪。這段時間，請多指教。"],
      ["ln", "哇，新經紀人！你會帶我們去吃好吃的嗎？"],
      ["th", "嗯～長得還不錯嘛。桃華會好好『照顧』你的喔♪"],
      ["kk", "……（戴著耳機，對你點了一下頭）"],
      ["yk", "我只希望你不要拖累我們。"],
      "二十座城市。四萬個座位。五個她。",
      "巡演，從明天開始。"
    ], function () { ui.screen = "hub"; ui.toast = "🚌 抵達 " + city().name + "：" + city().flavor; save(); });
  }

  // ---------------- 對話（VN）----------------
  function startVN(who, title, steps, after) {
    ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after || null, sub: {} };
    ui.screen = "vn";
    advanceSilent();
  }
  function fill(text) {
    var v = ui.vn, t = String(text);
    if (v && v.who) t = t.replace(/\{n\}/g, nm(v.who));
    if (v && v.sub.m) t = t.replace(/\{m\}/g, nm(v.sub.m));
    return t.replace(/\{c\}/g, city().name).replace(/\{me\}/g, C.ME);
  }
  function addAff(id, n) { var x = S(id); x.aff = clamp(x.aff + n, 0, 100); if (n > 0) ui.toast = nm(id) + " 好感 +" + n; }
  function applyEff(e, who) {
    if (!e) return;
    if (e.a && who) addAff(who, e.a);
    if (e.aff) Object.keys(e.aff).forEach(function (k) { addAff(k, e.aff[k]); });
    if (e.mood && who) S(who).mood = clamp(S(who).mood + e.mood, -2, 2);
    ["vo", "da", "ch"].forEach(function (k) { if (e[k] && who) S(who).s[k] = clamp(S(who).s[k] + e[k], 1, 99); });
    if (e.fans) st.fans = Math.max(0, Math.abs(e.fans) < 1 ? st.fans * (1 + e.fans) : st.fans + e.fans);
    if (e.zap) st.zap = clamp(st.zap + e.zap, 0, 150);
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
    if (v && typeof v.after === "function") v.after();
    else { ui.screen = "hub"; save(); }
  }

  // ---------------- 白天 ----------------
  function nextSlot() {
    st.slot++;
    if (st.slot >= 2) st.phase = "show";
    ui.screen = "hub"; save();
  }
  function doAction(id) {
    if (id === "date") { ui.pickDate = true; render(); return; }
    if (id === "rehearse") {
      D.MEMBERS.forEach(function (m) { var x = S(m.id), f = x.sta < 30 ? 0 : 1; x.s.vo = clamp(x.s.vo + rnd(1, 2) * f, 1, 99); x.s.da = clamp(x.s.da + rnd(1, 2) * f, 1, 99); x.sta = clamp(x.sta - 12, 0, 100); });
      log("🎤 排練：全員歌唱與舞蹈上升");
    } else if (id === "promo") {
      var g = Math.round(1500 * city().promo * avg("ch") / 65 * (1 + rnd(-10, 15) / 100));
      st.fans += g;
      D.MEMBERS.forEach(function (m) { S(m.id).sta = clamp(S(m.id).sta - 8, 0, 100); S(m.id).s.ch = clamp(S(m.id).s.ch + (Math.random() < 0.4 ? 1 : 0), 1, 99); });
      log("📣 宣傳活動：人氣 +" + fmt(g)); ui.toast = "📣 人氣 +" + fmt(g);
    } else if (id === "rest") {
      D.MEMBERS.forEach(function (m) { var x = S(m.id); x.sta = clamp(x.sta + 25, 0, 100); if (Math.random() < 0.5) x.mood = clamp(x.mood + 1, -2, 2); });
      log("☕ 休息：全員體力回復");
    }
    nextSlot(); render();
  }
  function dateWith(id) {
    ui.pickDate = false;
    var x = S(id); addAff(id, 6); x.mood = clamp(x.mood + 1, -2, 2); x.sta = clamp(x.sta + 5, 0, 100);
    if (isEnc(id)) x.meets++;
    log("💗 和 " + nm(id) + " 單獨相處");
    if (dueConfess(id)) { runConfess(id, function () { nextSlot(); }); render(); return; }
    if (dueLine(id)) { runLine(id, function () { nextSlot(); }); render(); return; }
    startVN(id, "單獨相處", [pick([
      "你和{n}戴著口罩在{c}的街上散步。她在一家小店前停下來，拿起一個髮夾在頭上比劃：「好看嗎？」",
      "{n}拉著你去吃{c}的名產。她吃得滿嘴都是，你幫她擦掉，她愣了一下，臉紅了。",
      "你陪{n}去看了一場電影。散場的時候，她的手不知不覺地勾住了你的手臂。",
      "{n}說想去看海。你們在{c}的海邊坐了一個下午，什麼都沒說，卻一點也不覺得尷尬。"
    ])], function () { nextSlot(); });
    render();
  }

  function dueLine(id) { if (isEnc(id)) return null; var x = S(id); return x.line < 3 && x.aff >= D.LINE_AFF[x.line] ? D.LINES[id][x.line] : null; }
  // 邂逅角色：見面 4 次以上、好感 45 以上就會告白
  var ENC_CONFESS_AFF = 45, ENC_CONFESS_MEETS = 4;
  function dueConfess(id) {
    var x = S(id);
    if (isEnc(id)) return !x.dating && x.aff >= ENC_CONFESS_AFF && x.meets >= ENC_CONFESS_MEETS && x.cool <= 0;
    return !x.dating && x.line >= 3 && x.aff >= D.CONFESS_AFF && x.cool <= 0;
  }
  function runLine(id, after) {
    var x = S(id), ev = D.LINES[id][x.line];
    x.line++;
    startVN(id, M(id).name + "・" + ev.title + "（" + x.line + "/3）", ev.steps, after);
  }
  function runConfess(id, after) {
    var enc = isEnc(id), base = enc ? persOf(S(id)).confess : D.CONFESS[id];
    var steps = base.concat([{ ch: [
      { t: "抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡又哭又笑。", "從今晚開始，你們偷偷交往了。"] },
      enc ? { t: "「……現在的我，還沒辦法回應你。」", e: { a: -12 }, r: ["她的笑容僵住了一瞬間，然後又笑了：「……沒關係。我等你。」", "她轉身離開，腳步很快。"] }
        : { t: "「……你是偶像。我們不能。」", e: { a: -12 }, r: ["她的笑容僵住了。", "「……我知道。我早就知道了。」她轉身離開，腳步很快。"] }
    ] }]);
    startVN(id, nm(id) + "・告白", steps, function () {
      var x = S(id);
      if (x.aff >= (enc ? ENC_CONFESS_AFF : D.CONFESS_AFF) + 5) { x.dating = true; log("💕 和 " + nm(id) + " 開始秘密交往"); } else x.cool = 3;
      after();
    });
  }

  // ---------------- 演出：節奏遊戲 ----------------
  function songs() { return D.SONGS.filter(function (s) { return !s.lock || st.flags[s.lock]; }); }
  function skillFor(song) {
    var c = S(song.center);
    return avg(song.need) * 0.75 + c.s[song.need] * 0.25;
  }
  function makeChart(song) {
    var beat = 60 / song.bpm, len = 26, t = 2.2, notes = [], last = -1, rep = 0;
    var pBeat = [0, 0.6, 0.85, 0.9, 0.95][song.diff], pHalf = [0, 0, 0.18, 0.35, 0.55][song.diff], pChord = [0, 0, 0.03, 0.08, 0.15][song.diff];
    function lane() { var l; do { l = rnd(0, 3); } while (l === last && rep >= 1 && Math.random() < 0.8); rep = l === last ? rep + 1 : 0; last = l; return l; }
    while (t < len) {
      if (Math.random() < pBeat) {
        var l = lane(); notes.push({ t: t, lane: l });
        if (Math.random() < pChord) notes.push({ t: t, lane: (l + rnd(1, 3)) % 4 });
      }
      if (Math.random() < pHalf) notes.push({ t: t + beat / 2, lane: lane() });
      t += beat;
    }
    return notes;
  }
  function startShow(songId) {
    var song = D.SONGS.filter(function (s) { return s.id === songId; })[0];
    ui.rg = { song: song, notes: makeChart(song), travel: song.diff >= 4 ? 1.15 : song.diff >= 3 ? 1.35 : 1.6, t0: 0, raf: 0, score: 0, combo: 0, maxCombo: 0, judged: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 } };
    ui.screen = "rhythm";
    render();
    buildRhythm();
  }
  function buildRhythm() {
    var rg = ui.rg, field = app.querySelector(".tr-field");
    rg.field = field;
    rg.notes.forEach(function (n) { var el = document.createElement("i"); el.className = "tr-note tr-l" + n.lane; field.appendChild(el); n.el = el; });
    rg.t0 = performance.now() / 1000;
    var loop = function () {
      if (ui.rg !== rg) return;
      var now = performance.now() / 1000 - rg.t0, h = field.clientHeight, judgeY = h * 0.86, end = 0;
      rg.notes.forEach(function (n) {
        end = Math.max(end, n.t);
        if (n.done) return;
        var dt = n.t - now;
        if (dt < -0.15) { judge(n, "miss"); return; }
        if (dt > rg.travel) { n.el.style.display = "none"; return; }
        n.el.style.display = "block";
        n.el.style.transform = "translateY(" + (judgeY * (1 - dt / rg.travel) - 8) + "px)";
      });
      var bar = app.querySelector(".tr-prog i"); if (bar) bar.style.width = clamp(now / (end + 1) * 100, 0, 100) + "%";
      if (now > end + 1.2) { finishShow(false); return; }
      rg.raf = requestAnimationFrame(loop);
    };
    rg.raf = requestAnimationFrame(loop);
  }
  function judge(n, kind) {
    var rg = ui.rg; n.done = true; n.el.style.display = "none";
    rg.counts[kind]++; rg.judged++;
    rg.score += { perfect: 1, great: 0.75, good: 0.4, miss: 0 }[kind];
    rg.combo = kind === "miss" ? 0 : rg.combo + 1;
    rg.maxCombo = Math.max(rg.maxCombo, rg.combo);
    var j = app.querySelector(".tr-judge"); if (j) { j.textContent = { perfect: "PERFECT", great: "GREAT", good: "GOOD", miss: "MISS" }[kind] + (rg.combo > 4 ? "  " + rg.combo + " combo" : ""); j.className = "tr-judge tr-j-" + kind; }
    if (kind !== "miss" && rg.combo % 8 === 0) {
      var c = app.querySelector(".tr-call"); if (c) { c.textContent = pick(CALLS); c.classList.remove("tr-pop"); void c.offsetWidth; c.classList.add("tr-pop"); }
    }
  }
  function hit(lane) {
    var rg = ui.rg; if (!rg || !rg.t0) return;
    var now = performance.now() / 1000 - rg.t0, best = null, bd = 1;
    rg.notes.forEach(function (n) { if (!n.done && n.lane === lane) { var d = Math.abs(n.t - now); if (d < bd) { bd = d; best = n; } } });
    var pad = app.querySelector(".tr-pad.tr-l" + lane); if (pad) { pad.classList.add("tr-press"); setTimeout(function () { pad.classList.remove("tr-press"); }, 90); }
    if (!best || bd > 0.15) return;
    judge(best, bd < 0.055 ? "perfect" : bd < 0.1 ? "great" : "good");
  }
  function finishShow(auto) {
    var rg = ui.rg; if (rg && rg.raf) cancelAnimationFrame(rg.raf);
    var song = rg.song, total = rg.notes.length, acc;
    if (auto) acc = clamp(0.5 + skillFor(song) / 260 + rnd(-6, 6) / 100, 0.35, 0.92);
    else acc = total ? rg.score / total : 0;
    var c = city();
    var mult = 0.5 + skillFor(song) / 100 + avgMood() * 0.05;
    if (avgSta() < 40) mult *= 0.8;
    mult *= [1, 0.85, 1, 1.1, 1.3][song.diff];
    var gain = Math.round(c.cap * acc * mult * 1.1 + st.fans * 0.01 * acc);
    st.fans += gain;
    D.MEMBERS.forEach(function (m) { var x = S(m.id); x.sta = clamp(x.sta - 15, 0, 100); if (acc > 0.85 && Math.random() < 0.5) x.mood = clamp(x.mood + 1, -2, 2); if (acc < 0.5) x.mood = clamp(x.mood - 1, -2, 2); });
    S(song.center).s[song.need] = clamp(S(song.center).s[song.need] + 1, 1, 99);
    var rank = acc >= 0.92 ? "S" : acc >= 0.8 ? "A" : acc >= 0.65 ? "B" : acc >= 0.5 ? "C" : "D";
    st.shows.push({ city: c.name, song: song.name, rank: rank, gain: gain });
    log("🎶 " + c.venue + "「" + song.name + "」 " + rank + " 評價：人氣 +" + fmt(gain));
    ui.result = { song: song, acc: acc, rank: rank, gain: gain, auto: auto, counts: rg.counts, maxCombo: rg.maxCombo };
    ui.rg = null;
    ui.screen = "result";
    if (c.final) { st.ended = true; store(SAVE_KEY, null); }
    else { st.phase = "night"; save(); }
    render();
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
    var job = pick(here.length ? here : jobs);
    var n = C.genName(job.tour ? 0 : st.city, function (k) { return rnd(0, k - 1); });
    var id = "e" + img.slice(2, 5);
    st.enc[id] = { id: id, name: n.name, short: n.short, img: img, age: rnd(21, 34), job: job.name, meet: job.meet, spot: job.spot, home: job.tour ? "" : city().name,
      pers: pick(C.PERS).id, color: "hsl(" + rnd(0, 359) + ",65%,68%)", aff: 0, meets: 0, chat: 0, dating: false, nights: 0, cool: 0, mood: 0, sta: 100, line: 3, s: { vo: 0, da: 0, ch: 0 } };
    return id;
  }
  // 夜晚偶遇（forced＝玩家主動約她出來；當地認識的人會特地飛來看演出）
  function meetEnc(spotId, spot, forced) {
    var met = encIds().filter(function (id) { var e = st.enc[id]; return !e.dating && e.spot.indexOf(spotId) >= 0 && (!e.home || e.home === city().name); });
    var id = forced || null, isNew = false;
    if (!id && met.length && Math.random() < 0.6) {
      met.sort(function (a, b) { return st.enc[b].aff - st.enc[a].aff; });
      id = Math.random() < 0.6 ? met[0] : pick(met);
    }
    if (!id) { id = newEnc(spotId); isNew = !!id; }
    if (!id) return false;
    var e = st.enc[id], P = persOf(e);
    log(spot.ic + " " + spot.name + "：" + (isNew ? "邂逅了 " : "又遇到 ") + e.name + "（" + (e.home ? e.home + "的" : "") + e.job + "）");
    if (dueConfess(id)) { runConfess(id, endNight); return true; }
    e.meets++;
    if (isNew) {
      startVN(id, spot.name + "・邂逅", [e.meet, ["@", P.greet], "她是" + (e.home ? e.home + "的" : "") + e.job + "，" + e.age + " 歲。個性：" + P.name + "。", { e: { a: 10 } }], endNight);
      return true;
    }
    var c = P.chats[e.chat % P.chats.length]; e.chat++;
    var good = { t: c.good, e: { a: 12 }, r: [pick(["她開心地笑了。", "她的臉微微紅了。", "她看了你很久，然後別過頭去。", "她輕輕碰了一下你的手臂。"])] };
    var ok = { t: c.ok, e: { a: 5 } };
    var open = forced && e.home && e.home !== city().name ? "{n}特地從" + e.home + "飛來{c}看今晚的演出。散場後，她在" + spot.name + "等你。" :
      pick(["你在" + spot.name + "又遇到了{n}。", "{n}好像在等你。看到你，她揮了揮手。", "{n}正好也在。她拍了拍旁邊的位置。"]);
    startVN(id, spot.name, [open, ["@", c.q], { ch: Math.random() < 0.5 ? [good, ok] : [ok, good] }], endNight);
    return true;
  }

  function goSpot(spotId) {
    var spot = D.SPOTS.filter(function (s) { return s.id === spotId; })[0];
    if (Math.random() < 0.4 && meetEnc(spotId, spot)) return;
    var due = D.MEMBERS.filter(function (m) { return dueLine(m.id) || dueConfess(m.id); });
    if (Math.random() < 0.12) { log(spot.ic + " " + spot.name + "：沒有遇到誰"); startVN(null, spot.name, [spot.quiet], endNight); return; }
    var who = (due.length && Math.random() < 0.6 ? pick(due) : pick(D.MEMBERS)).id;
    log(spot.ic + " " + spot.name + "：遇到 " + M(who).name);
    if (dueConfess(who)) { runConfess(who, endNight); return; }
    if (dueLine(who)) { runLine(who, endNight); return; }
    var f = pick(D.FREE.filter(function (x) { return x.spot === spotId; }));
    startVN(who, spot.name, f.steps.concat([{ ch: f.ch }]), endNight);
  }
  function visit(id) {
    st.zap = clamp(st.zap + rnd(10, 16), 0, 150);
    var others = dating().filter(function (x) { return x !== id; });
    if (others.length && Math.random() < 0.3) {
      var o = pick(others);
      startVN(o, "修羅場", D.JEALOUS.slice().concat([{ e: { a: -6, mood: -1 } }]), function () { openStory(id); });
      ui.vn.sub.m = id;
      log("💢 修羅場：" + M(o).name + " 撞見了");
      return;
    }
    openStory(id);
  }
  function openStory(id) {
    var x = S(id), story, key;
    if (!x.nights && N.OWN[id]) { story = N.OWN[id]; key = "own_" + id; }
    else {
      var k; do { k = rnd(0, N.SHARED.length - 1); } while (N.SHARED.length > 1 && k === st.lastShared);
      st.lastShared = k; story = N.SHARED[k]; key = "sh_" + k;
    }
    x.nights++; addAff(id, 6); x.mood = clamp(x.mood + 1, -2, 2);
    log("🌙 和 " + nm(id) + " 共度夜晚：" + story.title);
    if (isEnc(id)) addAlbum("enc|" + x.img + "|" + x.short + "|" + key.slice(3));
    else addAlbum(key + "_" + id);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, cityName: city().name, after: endNight };
    ui.screen = "story";
    render();
  }
  function endNight() {
    D.MEMBERS.forEach(function (m) { var x = S(m.id); x.sta = clamp(x.sta + 20, 0, 100); if (x.cool > 0) x.cool--; });
    encIds().forEach(function (id) { if (st.enc[id].cool > 0) st.enc[id].cool--; });
    st.zap = clamp(st.zap - 4, 0, 150);
    var hot = st.zap >= 100;
    st.city++; st.phase = "day"; st.slot = 0;
    if (hot) {
      var ds = dating(), subj = ds.length ? pick(ds) : pick(D.MEMBERS).id;
      st.scandal = subj;
    }
    ui.screen = "hub";
    ui.toast = "🚌 抵達 " + city().name + "：" + city().flavor;
    save(); render();
    if (st.scandal) runScandal();
  }
  function runScandal() {
    var id = st.scandal; st.scandal = null;
    log("📰 週刊爆料：" + M(id).name);
    startVN(id, "週刊爆料", D.SCANDAL.concat([{ ch: D.SCANDAL_CH }]), function () { ui.screen = "hub"; save(); });
    render();
  }

  // ---------------- 結局 ----------------
  var EPI = {
    yk: { d: "雪乃的第一張 solo 專輯，最後一首歌叫〈為你而唱〉。演唱會的最後，她總會看向後台的某個角落。", n: "雪乃成了公認的實力派歌手。她說，現在的她，終於學會了休息。" },
    ln: { d: function (s) { return s.flags.ln_solo ? "露娜 solo 出道，舞台大得像海。每次下台，她第一個撲進的，是你的懷裡。" : "露娜留在 LUMINA，成為亞洲最強的舞蹈擔當。她的手機桌布，是你們在頂樓撒名片的照片。"; }, n: "露娜的舞越跳越好。她說，總有一天要跳到全世界都看見。" },
    th: { d: "桃華不再說『最喜歡你了』給每個人聽了。她把那句話，留給了每天晚上的你。", n: "桃華勇敢說出過去之後，人氣反而更高了。她的笑容，變得比以前更真。" },
    kk: { d: "〈Pixel Heart〉成了 LUMINA 最紅的歌。琪琪的資料夾改名了，叫做「給你的歌」，裡面已經有兩百首。", n: "琪琪的歌終於被採用了。她說，第一百首教會了她，要相信自己。" },
    mo: { d: function (s) { return s.flags.mo_wait ? "大巨蛋的最後一首安可，澪唸完了畢業宣言。最後一句是：『接下來，我要去當一個人的新娘。』四萬人的尖叫聲中，你打開了手心。" : "澪畢業了，成為受歡迎的主持人。她說，畢業那天，她終於做了一次自己。"; }, n: "澪畢業之後，成了受歡迎的主持人。LUMINA 的後輩們，都叫她『永遠的隊長』。" }
  };

  // ---------------- 畫面 ----------------
  function portrait(id, cls) { return id ? '<img class="tr-pt ' + (cls || "") + '" src="' + IMG + imgOf(id) + '" alt="" style="--tr-c:' + M(id).color + '">' : ""; }
  function renderCast() {
    var h = '<div class="tr-panel"><h2>選角：她們的樣子</h2><p class="tr-small tr-muted">點一位成員，從頭像庫幫她換外觀。名字和故事不變。</p><div class="tr-grid">';
    h += D.MEMBERS.map(function (m) {
      return '<button class="tr-card' + (ui.castPick === m.id ? " tr-lovecard" : "") + '" data-act="castPick" data-id="' + m.id + '">' + portrait(m.id, "tr-big") + "<b>" + esc(m.name) + '</b><span class="tr-small tr-muted">' + esc(m.pos) + "・" + esc(m.pers) + "</span></button>";
    }).join("") + "</div>";
    if (ui.castPick) {
      var used = usedByCast(ui.castPick);
      h += "<h3>" + esc(M(ui.castPick).name) + ' 的外觀</h3><div class="tr-gallery">' + C.POOL.filter(function (img) { return !used[img]; }).map(function (img) {
        return '<button class="tr-gimg' + (imgOf(ui.castPick) === img ? " tr-gsel" : "") + '" data-act="castImg" data-img="' + img + '"><img src="' + IMG + img + '" alt="" loading="lazy"></button>';
      }).join("") + "</div>";
    }
    return h + '<div class="tr-row"><button class="tr-btn" data-act="castRandom">全部隨機</button><button class="tr-btn" data-act="castReset">恢復預設</button><button class="tr-btn tr-primary" data-act="castStart">開始巡演</button></div></div>';
  }
  function bar(v, cls) { return '<span class="tr-bar ' + (cls || "") + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></span>'; }

  function render() {
    if (ui.screen === "rhythm" && app.querySelector(".tr-field")) return;
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    var h = "";
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "rhythm") h = renderRhythm();
    else if (ui.screen === "result") h = renderResult();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else if (ui.screen === "cast") h = renderCast();
    else h = renderHub();
    if (ui.toast) { h += '<div class="tr-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="tr-root">' + h + "</div>";
  }
  function renderAge() {
    return '<div class="tr-age"><p class="tr-age-mark">18+</p><h2>本遊戲含成人向內容</h2>' +
      '<p>遊戲中有成年角色之間的親密、性暗示描寫。登場人物全員皆為 21 歲以上的成年人。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="tr-row"><button class="tr-btn tr-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="tr-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY);
    var h = '<div class="tr-title"><p class="tr-sub">LUMINA 20 CITIES TOUR</p><h1>星途巡演</h1><p class="tr-tag">二十座城市、四萬個座位、五個她。<br>你是經紀人——也是她們唯一的秘密。</p>';
    h += '<div class="tr-faces">' + D.MEMBERS.map(function (m) { return portrait(m.id, "tr-face"); }).join("") + "</div><div class=\"tr-row\">";
    if (saved) h += '<button class="tr-btn tr-primary" data-act="continue">繼續（第 ' + (saved.city + 1) + " 站）</button>";
    h += '<button class="tr-btn' + (saved ? "" : " tr-primary") + '" data-act="new">' + (saved ? "重新開始" : "開始巡演") + '</button><button class="tr-btn" data-act="album">夜晚回憶</button></div>';
    return h + '<p class="tr-small tr-muted">節奏遊戲：鍵盤 D F J K，或點擊／觸控下方的四個按鍵</p></div>';
  }
  function renderAlbum() {
    var a = album(), h = '<div class="tr-panel"><h2>夜晚回憶</h2><div class="tr-album">';
    D.MEMBERS.forEach(function (m) {
      h += '<div class="tr-alb">' + portrait(m.id, "tr-mini") + "<div><b>" + esc(m.name) + "</b><br>";
      h += a["own_" + m.id + "_" + m.id] ? '<button class="tr-btn tr-sm" data-act="replay" data-k="own" data-id="' + m.id + '">' + esc(N.OWN[m.id].title) + "</button>" : '<span class="tr-muted tr-small">？？？</span>';
      N.SHARED.forEach(function (s, i) { if (a["sh_" + i + "_" + m.id]) h += ' <button class="tr-btn tr-sm" data-act="replay" data-k="' + i + '" data-id="' + m.id + '">' + esc(s.title) + "</button>"; });
      h += "</div></div>";
    });
    // 邂逅角色：鍵是 enc|頭像|名字|共用劇情編號
    var encs = {};
    Object.keys(a).forEach(function (k) { if (k.indexOf("enc|") === 0) { var p = k.split("|"), key = p[1] + "|" + p[2]; (encs[key] = encs[key] || []).push(+p[3]); } });
    Object.keys(encs).forEach(function (key) {
      var p = key.split("|");
      h += '<div class="tr-alb"><img class="tr-pt tr-mini" src="' + IMG + esc(p[0]) + '" alt=""><div><b>' + esc(p[1]) + '</b> <span class="tr-small tr-muted">邂逅</span><br>' +
        encs[key].sort().map(function (i) { return '<button class="tr-btn tr-sm" data-act="replayEnc" data-k="' + i + '" data-img="' + esc(p[0]) + '" data-name="' + esc(p[1]) + '">' + esc(N.SHARED[i].title) + "</button>"; }).join(" ") + "</div></div>";
    });
    return h + '</div><div class="tr-row"><button class="tr-btn" data-act="title">返回</button></div></div>';
  }
  function renderHub() {
    var c = city();
    var h = '<div class="tr-top"><div><b class="tr-city">' + (st.city + 1) + "/20　" + esc(c.name) + '</b> <span class="tr-small tr-muted">' + esc(c.venue) + "（" + fmt(c.cap) + ' 席）</span></div>' +
      '<div class="tr-small">人氣 <b class="tr-fans">' + fmt(st.fans) + '</b>　狗仔指數 ' + bar(st.zap, "tr-zapbar") + " " + Math.round(st.zap) + '</div><div><button class="tr-btn tr-sm" data-act="panel" data-p="roster">成員</button> <button class="tr-btn tr-sm" data-act="panel" data-p="log">紀錄</button> <button class="tr-btn tr-sm" data-act="title">標題</button></div></div>';
    if (ui.panel === "roster") h += renderRoster();
    else if (ui.panel === "log") h += '<div class="tr-panel"><h3>紀錄</h3><ul class="tr-log">' + st.log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + '</ul><button class="tr-btn tr-sm" data-act="panel" data-p="">關閉</button></div>';
    h += '<div class="tr-strip">' + D.MEMBERS.map(function (m) {
      var x = S(m.id);
      return '<div class="tr-chip' + (x.dating ? " tr-love" : "") + '">' + portrait(m.id, "tr-mini") + '<span class="tr-small">' + esc(m.name) + (x.dating ? " 💕" : "") + "</span>" + bar(x.sta, "tr-sta") + bar(x.aff, "tr-aff") + "</div>";
    }).join("") + '</div><p class="tr-small tr-muted tr-center">上條＝體力　下條＝好感</p>';
    if (st.zap >= 70) h += '<p class="tr-warn tr-center">📸 狗仔盯得很緊……再被拍到就會上週刊了。</p>';

    if (st.phase === "day") {
      if (ui.pickDate) {
        var dateIds = D.MEMBERS.map(function (m) { return m.id; }).concat(encIds().sort(function (a, b) { return st.enc[b].aff - st.enc[a].aff; }));
        h += '<div class="tr-panel"><h3>💗 要和誰單獨相處？</h3><div class="tr-grid">' + dateIds.map(function (id) {
          return '<button class="tr-card" data-act="dateWith" data-id="' + id + '">' + portrait(id, "tr-mini") + "<b>" + esc(nm(id)) + (dueLine(id) || dueConfess(id) ? ' <span class="tr-new">！</span>' : "") + '</b><span class="tr-small">' + (isEnc(id) ? esc(M(id).job) + "・" : "") + tierName(S(id).aff) + "</span></button>";
        }).join("") + '</div><div class="tr-row"><button class="tr-btn tr-sm" data-act="cancelDate">取消</button></div></div>';
      } else {
        h += '<div class="tr-panel"><h3>☀ 白天的行動（' + (st.slot + 1) + '/2）</h3><div class="tr-grid">' + D.ACTIONS.map(function (a) {
          return '<button class="tr-card" data-act="action" data-id="' + a.id + '"><b>' + a.ic + " " + esc(a.name) + '</b><span class="tr-small">' + esc(a.desc) + "</span></button>";
        }).join("") + "</div></div>";
      }
    } else if (st.phase === "show") {
      h += '<div class="tr-panel"><h3>🎶 今晚的演出：' + esc(c.venue) + (c.final ? "　——最終公演" : "") + '</h3><p class="tr-small tr-muted">選一首歌。難度越高、打得越好，人氣漲得越多。歌的主角能力也會影響結果。</p><div class="tr-grid">' + songs().map(function (s) {
        return '<button class="tr-card" data-act="song" data-id="' + s.id + '">' + portrait(s.center, "tr-mini") + "<b>" + esc(s.name) + '</b><span class="tr-small">' + "★★★★".slice(0, s.diff) + "　" + s.bpm + " BPM・" + D.STAT_NAME[s.need] + '</span><span class="tr-small tr-muted">' + esc(s.desc) + "</span></button>";
      }).join("") + "</div></div>";
    } else {
      h += '<div class="tr-panel"><h3>🌙 演出之後的夜晚</h3><div class="tr-grid">' + D.SPOTS.map(function (s) {
        return '<button class="tr-card" data-act="spot" data-id="' + s.id + '"><b>' + s.ic + " " + esc(s.name) + "</b></button>";
      }).join("") + "</div>";
      var seek = encIds().filter(function (id) { return !st.enc[id].dating; }).sort(function (a, b) { return st.enc[b].aff - st.enc[a].aff; });
      if (seek.length) {
        h += '<h3>📱 約認識的人出來</h3><div class="tr-grid">' + seek.map(function (id) {
          var e = st.enc[id];
          return '<button class="tr-card" data-act="seek" data-id="' + id + '">' + portrait(id, "tr-mini") + "<b>" + esc(e.short) + (dueConfess(id) ? ' <span class="tr-new">！</span>' : "") + '</b><span class="tr-small tr-muted">' + esc((e.home ? e.home + "・" : "") + e.job) + "・" + tierName(e.aff) + "</span></button>";
        }).join("") + "</div>";
      }
      var ds = dating();
      if (ds.length) {
        h += '<h3>💕 偷偷去她的房間</h3><p class="tr-small tr-warn">狗仔指數 +10〜16</p><div class="tr-grid">' + ds.map(function (id) {
          return '<button class="tr-card tr-lovecard" data-act="visit" data-id="' + id + '">' + portrait(id, "tr-mini") + "<b>" + esc(nm(id)) + '</b><span class="tr-small">' + (S(id).nights ? "共度了 " + S(id).nights + " 晚" : "第一次的夜晚") + "</span></button>";
        }).join("") + "</div>";
      }
      h += '<div class="tr-row"><button class="tr-btn tr-sm" data-act="sleep">早點睡，前往下一站</button></div></div>';
    }
    return h;
  }
  function renderRoster() {
    var h = '<div class="tr-panel"><h3>成員</h3>';
    D.MEMBERS.forEach(function (m) {
      var x = S(m.id);
      h += '<div class="tr-mem">' + portrait(m.id, "tr-big") + "<div><b>" + esc(m.name) + '</b> <span class="tr-small tr-muted">' + m.age + " 歲・" + esc(m.pos) + "・" + esc(m.pers) + '</span><p class="tr-small">' + esc(m.intro) + "</p>" +
        '<p class="tr-small">歌唱 <b>' + x.s.vo + "</b>　舞蹈 <b>" + x.s.da + "</b>　魅力 <b>" + x.s.ch + "</b>　體力 " + x.sta + "　心情 " + ["很差", "低落", "普通", "不錯", "絕佳"][x.mood + 2] + "　好感 " + x.aff + "（" + tierName(x.aff) + "）" + (x.dating ? "　💕 秘密交往中" : "") + "</p>" +
        '<p class="tr-small tr-muted">個人故事「' + esc(m.line) + "」 " + x.line + "/3" + (x.line < 3 ? "（下一段：好感 " + D.LINE_AFF[x.line] + "）" : x.dating ? "" : "（好感 " + D.CONFESS_AFF + " 會有特別的事）") + "</p></div></div>";
    });
    var es = encIds();
    h += "<h3>邂逅的她們（" + es.length + "／" + (C.POOL.length - D.MEMBERS.length) + '）</h3><p class="tr-small tr-muted">夜晚有時會遇到成員以外的人，也可以在白天約她們。見面 ' + ENC_CONFESS_MEETS + " 次以上、好感夠高，就會發生特別的事。</p>";
    es.forEach(function (id) {
      var e = st.enc[id];
      h += '<div class="tr-mem">' + portrait(id, "tr-mini") + "<div><b>" + esc(e.name) + '</b> <span class="tr-small tr-muted">' + e.age + " 歲・" + esc((e.home ? e.home + "的" : "") + e.job) + "・" + esc(persOf(e).name) + '</span><p class="tr-small">見面 ' + e.meets + " 次　好感 " + e.aff + "（" + tierName(e.aff) + "）" + (e.dating ? "　💕 交往中" : "") + "</p></div></div>";
    });
    return h + '<button class="tr-btn tr-sm" data-act="panel" data-p="">關閉</button></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], who = null, text = "";
    if (typeof s === "string") text = s; else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var speaker = who === "@" ? v.who : who;
    var showPt = speaker && speaker !== "me" && speaker.charAt(0) !== "?" ? speaker : v.who;
    var h = '<div class="tr-vn">' + (v.title ? '<p class="tr-vn-title">' + esc(v.title) + "</p>" : "") + '<div class="tr-stage">' + portrait(showPt, "tr-vnpt") + '</div><div class="tr-box">';
    if (who) h += '<p class="tr-name" style="color:' + (speaker && speaker !== "me" && M(speaker) ? M(speaker).color : "#9fd3ff") + '">' + esc(who === "me" ? "你" : speaker.charAt(0) === "?" ? speaker.slice(1) : M(speaker).name) + "</p>";
    if (s && s.ch) h += '<div class="tr-choices">' + s.ch.map(function (c, k) { return '<button class="tr-btn tr-choice" data-act="ch" data-k="' + k + '">' + esc(fill(c.t)) + "</button>"; }).join("") + "</div>";
    else h += '<p class="tr-text">' + esc(fill(text)) + '</p><button class="tr-btn tr-primary tr-next" data-act="next">▼</button>';
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story;
    var txt = String(s.pages[s.i]).replace(/\{n\}/g, s.look ? s.look.short : nm(s.who)).replace(/\{c\}/g, s.cityName || "這座城市");
    return '<div class="tr-story"><p class="tr-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + '</small></p><div class="tr-stage tr-stage-night">' + (s.look ? '<img class="tr-pt tr-vnpt" src="' + IMG + esc(s.look.img) + '" alt="">' : portrait(s.who, "tr-vnpt")) + '</div><div class="tr-box tr-box-night"><p class="tr-text">' + esc(txt) + '</p><div class="tr-row">' +
      (s.i > 0 ? '<button class="tr-btn tr-sm" data-act="sprev">上一段</button>' : "") + '<button class="tr-btn tr-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
  }
  function renderRhythm() {
    var rg = ui.rg;
    var h = '<div class="tr-rg"><div class="tr-rg-head">' + portrait(rg.song.center, "tr-mini") + "<b>" + esc(rg.song.name) + '</b><span class="tr-small tr-muted">' + esc(city().venue) + '</span><button class="tr-btn tr-sm" data-act="auto">自動演出</button></div>';
    h += '<div class="tr-prog"><i></i></div><div class="tr-field"><div class="tr-lanes"><span></span><span></span><span></span><span></span></div><div class="tr-line"></div><p class="tr-judge"></p><p class="tr-call"></p></div>';
    h += '<div class="tr-pads">' + [0, 1, 2, 3].map(function (l) { return '<button class="tr-pad tr-l' + l + '" data-lane="' + l + '">' + LANE_KEYS[l].toUpperCase() + "</button>"; }).join("") + "</div></div>";
    return h;
  }
  function renderResult() {
    var r = ui.result, c = city(), h = '<div class="tr-panel tr-center"><h2>' + esc(r.song.name) + '</h2><p class="tr-rank tr-rank-' + r.rank + '">' + r.rank + "</p>";
    h += "<p>" + (r.auto ? "自動演出" : "準確率 " + Math.round(r.acc * 100) + "%　最大連擊 " + r.maxCombo) + "</p>";
    if (!r.auto) h += '<p class="tr-small tr-muted">PERFECT ' + r.counts.perfect + "　GREAT " + r.counts.great + "　GOOD " + r.counts.good + "　MISS " + r.counts.miss + "</p>";
    h += '<p class="tr-big">人氣 +' + fmt(r.gain) + "</p><p>總人氣 <b>" + fmt(st.fans) + "</b></p>";
    h += '<p class="tr-small">' + esc(r.rank === "S" || r.rank === "A" ? "安可聲久久不散，整座場館都在喊 LUMINA。" : r.rank === "B" ? "觀眾很熱情。下一場，還能更好。" : "有點可惜……可是成員們都很努力。") + "</p>";
    h += '<div class="tr-row"><button class="tr-btn tr-primary" data-act="' + (c.final ? "toEnding" : "toNight") + '">' + (c.final ? "謝幕" : "夜晚") + "</button></div></div>";
    return h;
  }
  function renderEnding() {
    var f = st.fans, tier = f >= 300000 ? "legend" : f >= 190000 ? "good" : "bad";
    var head = { legend: "🌟 傳說的大巨蛋", good: "✨ 大巨蛋公演成功", bad: "🌙 未滿的大巨蛋" }[tier];
    var body = { legend: "四萬個座位全部坐滿，場外還有上萬人在看轉播。最後一首歌，五萬人一起合唱。社長在後台哭了。LUMINA 成了傳說。", good: "大巨蛋坐了八成滿。螢光棒的海洋裡，五個人手牽著手鞠躬。解散的話題，再也沒有人提起。", bad: "大巨蛋只坐了一半。可是，那一半的人喊得比任何一場都大聲。社長給了她們最後一次機會。" }[tier];
    var h = '<div class="tr-panel tr-ending"><h2>' + head + '</h2><p class="tr-big">總人氣 ' + fmt(f) + "</p><p>" + esc(body) + "</p><h3>那之後的她們</h3>";
    D.MEMBERS.forEach(function (m) {
      var x = S(m.id), e = EPI[m.id], d = typeof e.d === "function" ? e.d(st) : e.d;
      h += '<div class="tr-mem">' + portrait(m.id, "tr-mini") + "<div><b>" + esc(m.name) + "</b>" + (x.dating ? " 💕" : "") + '<p class="tr-small">' + esc(x.dating ? d : e.n) + "</p></div></div>";
    });
    encIds().filter(function (id) { return st.enc[id].dating; }).forEach(function (id) {
      var e = st.enc[id];
      h += '<div class="tr-mem">' + portrait(id, "tr-mini") + "<div><b>" + esc(e.name) + '</b> 💕 <span class="tr-small tr-muted">' + esc(e.job) + '</span><p class="tr-small">' + esc(persOf(e).epi.replace(/\{n\}/g, e.short)) + "</p></div></div>";
    });
    if (dating().length >= 3) h += '<p class="tr-warn">……另外，你同時和 ' + dating().length + " 個人交往的事，在慶功宴上全部穿幫了。據說那一晚的修羅場，比大巨蛋還要熱鬧。</p>";
    return h + '<div class="tr-row"><button class="tr-btn tr-primary" data-act="title">回到標題</button></div></div>';
  }

  // ---------------- 輸入 ----------------
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); if (st) { st.enc = st.enc || {}; st.img = st.img || {}; } ui.screen = st ? "hub" : "title"; render(); if (st && st.scandal) runScandal(); return; }
    if (act === "title") { if (st && !st.ended) save(); ui.screen = "title"; ui.panel = null; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") {
      var k = b.getAttribute("data-k"), story = k === "own" ? N.OWN[id] : N.SHARED[+k];
      ui.story = { who: id, title: story.title, pages: story.pages, i: 0, cityName: "", after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "replayEnc") {
      var sk = N.SHARED[+b.getAttribute("data-k")];
      ui.story = { who: null, look: { img: b.getAttribute("data-img"), short: b.getAttribute("data-name") }, title: sk.title, pages: sk.pages, i: 0, cityName: "", after: function () { ui.screen = "album"; render(); } };
      ui.screen = "story"; render(); return;
    }
    if (act === "castPick") { ui.castPick = ui.castPick === id ? null : id; render(); return; }
    if (act === "castImg") { st.img[ui.castPick] = b.getAttribute("data-img"); render(); return; }
    if (act === "castRandom") { randomizeCast(); render(); return; }
    if (act === "castReset") { st.img = {}; render(); return; }
    if (act === "castStart") { startTour(); render(); return; }
    if (act === "seek") { var sp = D.SPOTS.filter(function (x) { return x.id === st.enc[id].spot[0]; })[0]; meetEnc(sp.id, sp, id); render(); return; }
    if (act === "panel") { var p = b.getAttribute("data-p"); ui.panel = ui.panel === p ? null : (p || null); render(); return; }
    if (act === "action") { doAction(id); return; }
    if (act === "dateWith") { dateWith(id); return; }
    if (act === "cancelDate") { ui.pickDate = false; render(); return; }
    if (act === "song") { startShow(id); return; }
    if (act === "auto") { finishShow(true); return; }
    if (act === "toNight") { ui.screen = "hub"; render(); return; }
    if (act === "toEnding") { ui.screen = "ending"; render(); return; }
    if (act === "spot") { goSpot(id); render(); return; }
    if (act === "visit") { visit(id); render(); return; }
    if (act === "sleep") { log("🛌 早早睡了"); endNight(); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s = ui.story; if (s.i + 1 < s.pages.length) { s.i++; render(); } else { ui.story = null; s.after(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  app.addEventListener("pointerdown", function (ev) {
    var p = ev.target.closest(".tr-pad"); if (!p) return;
    ev.preventDefault(); hit(+p.getAttribute("data-lane"));
  });
  document.addEventListener("keydown", function (ev) {
    if (ui.screen === "rhythm") {
      var l = LANE_KEYS.indexOf(String(ev.key).toLowerCase());
      if (l >= 0 && !ev.repeat) { ev.preventDefault(); hit(l); }
      return;
    }
    if (ev.key !== " " && ev.key !== "Enter") return;
    var btn = app.querySelector(".tr-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  window.PriTestTour = { _state: function () { return st; }, _ui: function () { return ui; } };
  render();
})();
