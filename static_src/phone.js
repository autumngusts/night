// 手機裡的她們（phone）：規則與畫面。2026-11-11 依使用者需求新增。
// 21 天 × 4 個時段。每個時段：她們傳訊息來 → 你最多回 3 則 → 「下一個時段」結算（已讀不回、未讀的懲罰）。
// 回覆的語氣、貼圖、記不記得她說過的事（記憶題）決定好感；好感到了會約會（行事曆）、告白、交往，深夜可以去她家。
// 限動按讚、交友 App 配對（一般角色）。第 21 天結束時，選擇最後一晚陪誰＝結局。
(function () {
  "use strict";

  var D = window.PriTestPhoneData, N = window.PriTestPhoneNight;
  var app = document.getElementById("ph-app");
  if (!D || !N || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-phone-save-v1", AGE_KEY = "pritest-phone-age-ok", ALBUM_KEY = "pritest-phone-album", BEST_KEY = "pritest-phone-best";
  var H = {}; D.GIRLS.forEach(function (g) { H[g.id] = g; });
  var ARRIVE = { chen: 1, wan: 1, coco: 2, tong: 3, yu: 4, fang: 6, qi: 8, mu: 10 };
  var EXCLUDE = { 6: 1, 10: 1, 17: 1, 18: 1, 19: 1, 26: 1, 29: 1, 32: 1 };
  var FOODS = ["蛋糕", "壽司", "火鍋", "炸雞", "鬆餅", "咖哩", "牛排", "小籠包"], HOBBIES = ["瑜伽", "畫畫", "烘焙", "看電影", "爬山", "攝影", "彈吉他", "閱讀"], PLACES = ["巴黎", "倫敦", "峇里島", "沖繩", "布拉格", "紐西蘭", "夏威夷", "瑞士"];

  var st = null;
  var ui = { screen: "title", view: "home", chat: null, sticker: null, vn: null, story: null, toast: "", ageOk: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function save() { store(SAVE_KEY, st && !st.ended ? st : null); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function ageOk() { try { return localStorage.getItem(AGE_KEY) === "1"; } catch (e) { return ui.ageOk; } }
  function album() { return load(ALBUM_KEY) || {}; }
  function addAlbum(k) { var a = album(); a[k] = 1; store(ALBUM_KEY, a); }
  function slotKey(d, s) { return d * 10 + s; }
  function now() { return slotKey(st.day, st.slot); }

  // 女主角（H）與配對對象（st.match，id 以 m 開頭）共用 P／C
  function P(id) { return H[id] || st.mp[id]; }
  function Cn(id) { return st.c[id]; }
  function ids() { return Object.keys(st.c); }
  function dating() { return ids().filter(function (id) { return st.c[id].stage >= 3; }); }

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { day: 1, slot: 0, replies: D.REPLIES_PER_SLOT, c: {}, mp: {}, deck: [], stories: [], sched: {}, log: [], seq: 0, ended: false, lastShared: -1, photos: [] };
    startVN(null, "序章", [
      "你的手機，這個月突然熱鬧了起來。",
      "咖啡店的店員、酒吧的調酒師、在直播裡被你吐槽的實況主……一個接一個的訊息通知。",
      "訊息要怎麼回、什麼時候回、還記不記得她說過的話——",
      "每一則訊息，都是一個選擇。"
    ], function () { slotStart(); ui.screen = "phone"; ui.view = "home"; save(); });
  }
  function addContact(id) {
    if (st.c[id]) return;
    var g = P(id);
    st.c[id] = { aff: 0, stage: 0, log: [], pend: null, shown: {}, asked: {}, used: {}, dates: 0, nights: 0, cool: 0 };
    pushMsg(id, { k: "greet", q: g.greet || ("嗨～配對成功！我是" + g.short + "。" + g.bio), o: [["很高興認識你。", "sweet"], ["我們的緣分是被演算法決定的嗎？", "funny"], ["你好，請多指教。", "calm"], ["終於等到你了。", "flirty"]] });
  }
  function pushMsg(id, m) { var c = Cn(id); m.born = now(); m.read = false; c.pend = m; c.log.push({ f: "her", t: m.q, photo: m.photo || null }); }
  function log(t) { st.log.unshift("D" + st.day + " " + D.SLOTS[st.slot].name + "　" + t); if (st.log.length > 60) st.log.length = 60; }

  // ---------------- 時段 ----------------
  function slotStart() {
    st.replies = D.REPLIES_PER_SLOT;
    if (st.slot === 0) dayStart();
    var ev = st.sched[now()];
    if (ev) { delete st.sched[now()]; runEvent(ev); return; }
    ids().forEach(function (id) { genMessage(id); });
    // 深夜視訊
    var vc = ids().filter(function (id) { return st.c[id].stage >= 2 && !st.c[id].pend; });
    if (st.slot === 3 && vc.length && Math.random() < 0.3) st.call = pick(vc);
  }
  function dayStart() {
    D.GIRLS.forEach(function (g) { if (ARRIVE[g.id] === st.day) { addContact(g.id); log("📱 " + g.name + " 加了你的好友"); } });
    // 限動
    st.stories = [];
    ids().forEach(function (id) {
      if (Math.random() < 0.6) {
        var g = P(id), facts = g.facts, k = pick(["food", "hobby", "place", "mood"]);
        var t = k === "food" ? "今天吃了" + facts.food + "！果然是我的最愛 🤤" : k === "hobby" ? "週末又在" + facts.hobby + "了～這是我最大的興趣！" : k === "place" ? "好想去" + facts.place + "喔……總有一天！✈" : pick(["今天的天空好漂亮。", "好累……想要有人陪。", "今天穿了新衣服 ✨", "有人在嗎？"]);
        st.stories.push({ id: id, t: t, k: k, liked: false });
      }
    });
    // 交友 App 的新卡片
    st.deck = [];
    for (var i = 0; i < 4; i++) { var m = newMatch(); if (m) st.deck.push(m); }
    // 修羅場
    var ds = dating();
    if (ds.length >= 2 && Math.random() < 0.18) {
      var a = pick(ds), b = pick(ds.filter(function (x) { return x !== a; }));
      st.c[a].aff = clamp(st.c[a].aff - 8, 0, 100);
      st.pendingJealous = { who: a, m: b };
    }
  }
  function newMatch() {
    var used = {}; D.GIRLS.forEach(function (g) { used[g.img] = 1; }); Object.keys(st.mp).forEach(function (k) { used[st.mp[k].img] = 1; });
    var free = []; for (var i = 60; i <= 142; i++) { var im = "g_" + ("00" + i).slice(-3) + ".webp"; if (!EXCLUDE[i] && !used[im]) free.push(im); }
    if (!free.length) return null;
    var pers = pick(D.MATCH_PERS), given = pick(D.GIVEN), id = "m" + (++st.seq);
    st.mp[id] = { id: id, name: pick(D.SURN) + given, short: given, age: rnd(21, 34), job: pick(D.MATCH_JOBS), img: pick(free), color: "hsl(" + rnd(0, 359) + ",60%,68%)",
      like: pers.like, hate: pers.hate, sticker: pick(D.STICKERS), bio: pick(pers.bio), facts: { food: pick(FOODS), hobby: pick(HOBBIES), place: pick(PLACES) }, pers: pers.name };
    return id;
  }
  function genMessage(id) {
    var c = Cn(id), g = P(id);
    if (c.pend) return;
    // 邀約
    if (c.stage <= 1 && c.dates === 0 && c.aff >= D.DATE1_AFF && !hasSched(id)) { pushMsg(id, { k: "invite", ev: "date1", q: "那個……這週末，要不要一起出去？", o: [["好啊！我很期待。", "sweet"], ["只要你不帶我去鬼屋。", "funny"], ["好，時間地點你決定。", "calm"], ["終於約我了。", "flirty"]] }); return; }
    if (c.stage === 2 && c.dates === 1 && c.aff >= D.DATE2_AFF && !hasSched(id)) { pushMsg(id, { k: "invite", ev: "date2", q: "我……有話想當面跟你說。明天晚上，可以見面嗎？", o: [["好。我也有話想跟你說。", "sweet"], ["是要跟我借錢嗎？", "funny"], ["好，我會準時到。", "calm"], ["是什麼話？好期待。", "flirty"]] }); return; }
    if (c.stage >= 3 && st.slot === 3 && Math.random() < 0.45) { pushMsg(id, { k: "invite", ev: "night", q: pick(["今晚……要來我家嗎？", "睡不著。想見你。……現在。", "我家的燈還亮著。你要來嗎？"]), o: [["我馬上過去。", "sweet"], ["我帶宵夜過去？", "funny"], ["好，等我。", "calm"], ["……今晚不讓你睡了。", "flirty"]] }); return; }
    var p = c.stage >= 1 ? 0.6 : 0.45;
    if (Math.random() > p) return;
    var types = ["food", "hobby", "place"], unshown = types.filter(function (t) { return !c.shown[t]; }), shown = types.filter(function (t) { return c.shown[t] && !c.asked[t]; });
    if (unshown.length && Math.random() < 0.4) {
      var t = pick(unshown), f = g.facts[t]; c.shown[t] = 1;
      var q = t === "food" ? "我跟你說，我最喜歡吃的東西是" + f + "！記住喔！" : t === "hobby" ? "我的興趣是" + f + "。你呢？" : "我最想去的地方是" + f + "。總有一天要去！";
      pushMsg(id, { k: "fact", q: q, o: [["記住了，下次帶你去。", "sweet"], ["已經刻在我的 DNA 上了。", "funny"], ["好，我會記得。", "calm"], ["那我們一起。", "flirty"]] });
      return;
    }
    if (shown.length && c.stage >= 1 && Math.random() < 0.3) {
      var tq = pick(shown); c.asked[tq] = 1;
      var right = g.facts[tq], others = ids().filter(function (o) { return o !== id; }).map(function (o) { return P(o).facts[tq]; }).filter(function (x) { return x !== right; });
      var wrong = others.length ? pick(others) : pick(tq === "food" ? FOODS : tq === "hobby" ? HOBBIES : PLACES);
      pushMsg(id, { k: "quiz", right: right, q: D.FACT_Q[tq], o: shuffle([[right, "R"], [wrong, "W"], ["……我忘了，對不起。", "F"]]) });
      return;
    }
    if (st.slot === 3 && c.stage >= 1 && Math.random() < 0.6) { var L = pick(D.LATE); pushMsg(id, { k: "late", q: L.q, o: shuffle(L.o), photo: /傳了一張照片/.test(L.q) ? g.img : null }); if (/傳了一張照片/.test(L.q)) st.photos.push({ id: id, img: g.img, day: st.day }); return; }
    var pool = D.POOL[Math.min(c.stage, 3)], left = pool.map(function (x, i) { return i; }).filter(function (i) { return !c.used[c.stage + "_" + i]; });
    if (!left.length) { left = pool.map(function (x, i) { return i; }); Object.keys(c.used).forEach(function (k) { if (k.indexOf(c.stage + "_") === 0) delete c.used[k]; }); }
    var k = pick(left); c.used[c.stage + "_" + k] = 1;
    pushMsg(id, { k: "pool", q: pool[k].q, o: shuffle(pool[k].o) });
  }
  function hasSched(id) { return Object.keys(st.sched).some(function (k) { return st.sched[k].who === id; }); }
  function endSlot() {
    ids().forEach(function (id) {
      var c = Cn(id), m = c.pend; if (!m) return;
      if (m.read) { c.aff = clamp(c.aff - (P(id).like === "calm" || P(id).hate === "flirty" ? 4 : 6), 0, 100); c.log.push({ f: "sys", t: "（已讀不回）" }); }
      else c.aff = clamp(c.aff - 2, 0, 100);
      c.pend = null;
    });
    st.call = null;
    st.slot++;
    if (st.slot >= D.SLOTS.length) { st.slot = 0; st.day++; }
    if (st.day > D.DAYS) { st.day = D.DAYS; st.slot = 3; ui.screen = "final"; save(); render(); return; }
    slotStart();
    if (ui.screen === "phone" && st.pendingJealous) { var j = st.pendingJealous; st.pendingJealous = null; startVN(j.who, "修羅場", ["{n}拿著你的手機，螢幕上是你和{m}的聊天紀錄。", ["@", "……『早安，今天也很喜歡你』？"], ["@", "這句話，你昨天也對我說過喔。"], "她把手機還給你，轉身走了。那天，她的訊息都只回一個字。"], function () { ui.screen = "phone"; save(); }); ui.vn.sub.m = j.m; }
    save(); render();
  }

  // ---------------- 回覆 ----------------
  function reply(id, k) {
    var c = Cn(id), m = c.pend, g = P(id);
    if (!m || st.replies <= 0) return;
    var opt = m.o[k], sticker = ui.sticker, d = 0, react;
    st.replies--;
    c.log.push({ f: "me", t: opt[0] + (sticker ? " " + sticker : "") });
    if (m.k === "quiz") {
      if (opt[1] === "R") { d = 10; react = "……你真的記得！好開心 🥺"; }
      else if (opt[1] === "W") { d = -15; react = "……那是誰？我從來沒說過喜歡那個。"; log("💢 " + g.short + "：記錯了（" + opt[0] + "）"); }
      else { d = -4; react = "……好吧。下次要記得喔。"; }
    } else {
      var tone = opt[1];
      d = tone === g.like ? 8 : tone === g.hate ? -3 : 4;
      if (m.k === "late" && tone === "flirty" && c.stage >= 1) d += g.hate === "flirty" ? 0 : 3;
      if (m.k === "fact") d = Math.max(d, 3);
      react = d >= 8 ? pick(["😊", "嘿嘿……你很懂我嘛。", "（她傳了一個開心的貼圖）", "……你這樣，我會很高興的。"]) : d < 0 ? pick(["……喔。", "嗯。", "（已讀）", "……是喔。"]) : pick(["哈哈。", "嗯嗯！", "原來如此～", "😄"]);
    }
    if (sticker) d += sticker === g.sticker ? 3 : (sticker === "😏" && g.hate === "flirty") ? -2 : 1;
    if (m.born === now()) d += 1; // 秒回
    c.aff = clamp(c.aff + d, 0, 100);
    c.log.push({ f: "her", t: react });
    c.pend = null; ui.sticker = null;
    if (d > 0) ui.toast = g.short + " 好感 +" + d; else if (d < 0) ui.toast = g.short + " 好感 " + d;
    if (c.stage === 0 && c.aff >= 15 && c.log.length > 6) { c.stage = 1; log("💓 和 " + g.short + " 進入曖昧期"); }
    if (m.k === "invite") {
      if (m.ev === "night") { save(); openNight(id); return; }
      var at = slotKey(st.day + 1, 2);
      st.sched[at] = { who: id, type: m.ev };
      log("📅 約好了：第 " + (st.day + 1) + " 天晚上和 " + g.short + (m.ev === "date1" ? "約會" : "見面"));
      c.log.push({ f: "sys", t: "📅 第 " + (st.day + 1) + " 天 晚上 已加入行事曆" });
    }
    save(); render();
  }
  function inviteNight(id) {
    var c = Cn(id); if (st.slot !== 3 || c.stage < 3 || st.replies <= 0) return;
    st.replies--;
    c.log.push({ f: "me", t: "……今晚，想見你。可以過去嗎？" }, { f: "her", t: "……嗯。門沒鎖。" });
    openNight(id);
  }

  // ---------------- 約會與夜晚 ----------------
  function runEvent(ev) {
    var id = ev.who, g = P(id), c = Cn(id), steps;
    if (ev.type === "date1") {
      steps = (g.date1 || [g.short + "約你去了一間小酒館。你們聊了很久，從工作聊到小時候。", ["@", "……跟你在一起，時間過得好快。"]]).concat([{ ch: [
        { t: "「下次還想見你。」", e: { a: 10 }, r: ["她笑著點頭，臉紅紅的。"] },
        { t: "送她回家，在門口說晚安", e: { a: 8 }, r: ["她走進門之前，回頭對你揮了揮手。"] }] }]);
      startVN(id, "📅 約會・" + g.short, steps, function () { c.dates = 1; c.stage = Math.max(c.stage, 2); log("💐 和 " + g.short + " 第一次約會"); endEventSlot(); });
      return;
    }
    if (ev.type === "date2") {
      var base = g.date2 || [g.short + "約你在河堤見面。夜風很涼，她一直低著頭。"];
      steps = base.concat(c.aff >= D.CONFESS_AFF ? [["@", "……我喜歡你。可以跟我交往嗎？"], { ch: [
        { t: "抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡笑出聲，又哭又笑。從今晚開始，你們交往了。"] },
        { t: "「……我還想再多了解你一點。」", e: { a: -10 }, r: ["她愣了一下，然後勉強地笑了：「……也是。」"] }] }] : [["@", "……我們，再多了解彼此一點吧。"], { e: { a: 6 } }]);
      startVN(id, "📅 見面・" + g.short, steps, function () {
        c.dates = 2;
        if (c.aff >= D.CONFESS_AFF + 5) { c.stage = 3; log("💕 和 " + g.short + " 開始交往"); }
        else { c.dates = 1; }
        endEventSlot();
      });
    }
  }
  function endEventSlot() { ui.screen = "phone"; ui.view = "home"; endSlot(); }
  function openNight(id) {
    var c = Cn(id), story, key;
    if (!c.nights && N.OWN[id]) { story = N.OWN[id]; key = "own_" + id; }
    else { var k; do { k = Math.floor(Math.random() * N.SHARED.length); } while (N.SHARED.length > 1 && k === st.lastShared); st.lastShared = k; story = N.SHARED[k]; key = "sh" + k + "_" + id; }
    c.nights++; c.aff = clamp(c.aff + 5, 0, 100);
    if (H[id]) addAlbum(key); else addAlbum("m|" + P(id).img + "|" + P(id).name + "|" + key.split("_")[0].slice(2));
    log("🌙 在 " + P(id).short + " 的家過夜：" + story.title);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: function () { ui.screen = "phone"; ui.view = "home"; endSlot(); } };
    ui.screen = "story"; render();
  }
  function videoCall(id) {
    st.call = null;
    var g = P(id);
    startVN(id, "📞 視訊通話・" + g.short, D.VIDEO.concat([{ ch: [
      { t: "「我也好想看到你。」", e: { a: 8 }, r: ["她把臉埋進枕頭裡，只露出眼睛，笑了。", ["@", "……晚安。夢裡見。"]] },
      { t: "「……你的睡衣，好可愛。」", e: { a: 9 }, r: ["她低頭看了一眼，臉一下子紅了，把手機轉向天花板：「不、不准看！」", "過了一會兒，鏡頭又慢慢地轉了回來。"] }] }]), function () { ui.screen = "phone"; save(); });
  }

  // ---------------- 結局 ----------------
  function ending(pid) {
    st.ended = true; ui.end = { partner: pid };
    var best = load(BEST_KEY) || {}; best.clear = (best.clear || 0) + 1; if (pid && H[pid]) best["p_" + pid] = 1; store(BEST_KEY, best);
    store(SAVE_KEY, null); ui.screen = "ending"; render();
  }

  // ---------------- VN ----------------
  function startVN(who, title, steps, after) { ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after, sub: {} }; ui.screen = "vn"; adv(); }
  function fill(t) { var v = ui.vn; t = String(t); if (v && v.who) t = t.replace(/\{n\}/g, P(v.who).short); if (v && v.sub.m) t = t.replace(/\{m\}/g, P(v.sub.m).short); return t; }
  function eff(e, who) { if (e && e.a && who) { var c = Cn(who); c.aff = clamp(c.aff + e.a, 0, 100); if (e.a > 0) ui.toast = P(who).short + " 好感 +" + e.a; } }
  function adv() {
    var v = ui.vn;
    while (v && v.i < v.steps.length) { var s = v.steps[v.i]; if (s && typeof s === "object" && !Array.isArray(s) && s.e && !s.ch) { eff(s.e, v.who); v.i++; continue; } break; }
    if (v && v.i >= v.steps.length) { ui.vn = null; if (v.after) v.after(); }
  }
  function vnNext() { ui.vn.i++; adv(); render(); }
  function vnChoose(k) { var v = ui.vn, c = v.steps[v.i].ch[k]; eff(c.e, v.who); v.steps.splice.apply(v.steps, [v.i + 1, 0].concat((c.r || []).slice())); v.i++; adv(); render(); }

  // ---------------- 畫面 ----------------
  function av(id, cls) { var g = P(id); return '<img class="ph-av ' + (cls || "") + '" src="' + IMG + esc(g.img) + '" alt="" style="--ph-c:' + g.color + '">'; }
  function unread() { return ids().filter(function (id) { return st.c[id].pend && !st.c[id].pend.read; }).length; }
  function render() {
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    var h;
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "final") h = renderFinal();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else h = renderPhone();
    if (ui.toast) { h += '<div class="ph-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="ph-root">' + h + "</div>";
    var tl = app.querySelector(".ph-thread"); if (tl) tl.scrollTop = tl.scrollHeight;
  }
  function renderAge() {
    return '<div class="ph-age"><p class="ph-age-mark">18+</p><h2>本遊戲含成人向內容</h2><p>遊戲中有成年角色之間的親密、性暗示描寫。登場人物全員皆為 21 歲以上的成年人。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="ph-row"><button class="ph-btn ph-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="ph-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY), best = load(BEST_KEY) || {};
    var h = '<div class="ph-title"><div class="ph-device ph-device-title"><div class="ph-notif-demo">' + D.GIRLS.slice(0, 4).map(function (g) { return '<div class="ph-notif">' + av(g.id, "ph-mini") + "<div><b>" + esc(g.short) + '</b><span class="ph-small">' + esc(g.greet.slice(0, 22)) + "…</span></div></div>"; }).join("") + "</div></div>";
    h += '<h1>手機裡的她們</h1><p class="ph-tag">二十一天，八個她，一支手機。<br>回什麼、什麼時候回、還記不記得她說過的話。</p><div class="ph-row">';
    if (saved) h += '<button class="ph-btn ph-primary" data-act="continue">繼續（第 ' + saved.day + " 天）</button>";
    h += '<button class="ph-btn' + (saved ? "" : " ph-primary") + '" data-act="new">' + (saved ? "重新開始" : "解鎖手機") + '</button><button class="ph-btn" data-act="album">相簿與回憶</button></div>';
    var ps = Object.keys(best).filter(function (k) { return k.indexOf("p_") === 0; }).length;
    if (best.clear) h += '<p class="ph-muted ph-small">💕 結局 ' + ps + "／8</p>";
    return h + "</div>";
  }
  function statusBar() {
    var S = D.SLOTS[st.slot];
    return '<div class="ph-status"><span>第 ' + st.day + "／" + D.DAYS + " 天　" + S.ic + " " + S.time + '</span><span>💬 剩 ' + st.replies + " 則　🔋</span></div>";
  }
  function renderPhone() {
    var h = '<div class="ph-device">' + statusBar() + '<div class="ph-screen">';
    if (ui.view === "chats") h += renderChats();
    else if (ui.view === "thread") h += renderThread();
    else if (ui.view === "stories") h += renderStories();
    else if (ui.view === "match") h += renderMatch();
    else if (ui.view === "cal") h += renderCal();
    else h += renderHome();
    h += '</div><div class="ph-dock"><button data-act="view" data-v="home">🏠</button><button data-act="view" data-v="chats">💬' + (unread() ? '<i class="ph-badge">' + unread() + "</i>" : "") + '</button><button data-act="view" data-v="stories">⭕</button><button data-act="view" data-v="match">💘</button><button data-act="view" data-v="cal">📅</button></div></div>';
    h += '<div class="ph-row"><button class="ph-btn ph-primary" data-act="nextslot">⏭ 下一個時段（' + D.SLOTS[(st.slot + 1) % 4].name + "）</button><button class=\"ph-btn ph-sm\" data-act=\"title\">標題</button></div>";
    h += '<p class="ph-small ph-muted ph-center">讀了不回會被當成「已讀不回」；沒點開的只會小扣一點。每個時段只能回 ' + D.REPLIES_PER_SLOT + " 則。</p>";
    return h;
  }
  function renderHome() {
    var h = '<div class="ph-home"><div class="ph-apps"><button data-act="view" data-v="chats"><span>💬</span>聊天' + (unread() ? '<i class="ph-badge">' + unread() + "</i>" : "") + '</button><button data-act="view" data-v="stories"><span>⭕</span>限動</button><button data-act="view" data-v="match"><span>💘</span>交友</button><button data-act="view" data-v="cal"><span>📅</span>行事曆</button></div>';
    if (st.call) h += '<div class="ph-call">' + av(st.call, "ph-mid") + "<div><b>" + esc(P(st.call).short) + '</b><br><span class="ph-small">📞 視訊通話……</span></div><button class="ph-btn ph-primary ph-sm" data-act="call">接聽</button><button class="ph-btn ph-sm" data-act="decline">拒接</button></div>';
    var notes = ids().filter(function (id) { return st.c[id].pend && !st.c[id].pend.read; });
    h += '<div class="ph-notes">' + (notes.length ? notes.map(function (id) { return '<button class="ph-notif" data-act="open" data-id="' + id + '">' + av(id, "ph-mini") + "<div><b>" + esc(P(id).short) + '</b><span class="ph-small">' + esc(st.c[id].pend.q.slice(0, 28)) + (st.c[id].pend.q.length > 28 ? "…" : "") + "</span></div></button>"; }).join("") : '<p class="ph-small ph-muted ph-center">沒有新通知</p>') + "</div></div>";
    return h;
  }
  function renderChats() {
    var list = ids().sort(function (a, b) { return (st.c[b].pend ? 1 : 0) - (st.c[a].pend ? 1 : 0) || st.c[b].aff - st.c[a].aff; });
    if (!list.length) return '<p class="ph-muted ph-center">還沒有人傳訊息給你。</p>';
    return '<div class="ph-list">' + list.map(function (id) {
      var c = st.c[id], last = c.log[c.log.length - 1];
      return '<button class="ph-row-chat" data-act="open" data-id="' + id + '">' + av(id, "ph-mini") + '<div class="ph-rc-body"><b>' + esc(P(id).name) + (c.stage >= 3 ? " 💕" : "") + ' <small class="ph-stage">' + D.STAGE_NAME[c.stage] + '</small></b><span class="ph-small ph-muted">' + esc(last ? last.t.slice(0, 24) : "") + "</span></div>" + (c.pend && !c.pend.read ? '<i class="ph-dot"></i>' : "") + "</button>";
    }).join("") + "</div>";
  }
  function renderThread() {
    var id = ui.chat, c = st.c[id], g = P(id), m = c.pend;
    var h = '<div class="ph-thead"><button class="ph-back" data-act="view" data-v="chats">‹</button>' + av(id, "ph-mini") + "<div><b>" + esc(g.name) + '</b><br><span class="ph-small ph-muted">' + esc(g.job) + "・" + D.STAGE_NAME[c.stage] + '</span></div><span class="ph-aff">♥ ' + c.aff + "</span></div>";
    h += '<div class="ph-thread">' + c.log.slice(-30).map(function (x) {
      if (x.f === "sys") return '<div class="ph-sys">' + esc(x.t) + "</div>";
      return '<div class="ph-msg ph-' + x.f + '">' + (x.f === "her" ? av(id, "ph-tiny") : "") + '<div class="ph-bubble">' + (x.photo ? '<img class="ph-photo" src="' + IMG + esc(x.photo) + '" alt="">' : "") + esc(x.t) + "</div></div>";
    }).join("") + "</div>";
    if (m) {
      h += '<div class="ph-reply">';
      if (st.replies <= 0) h += '<p class="ph-small ph-warn">這個時段已經回不了訊息了……（已讀不回會扣好感）</p>';
      else {
        if (m.k !== "quiz") h += '<div class="ph-stickers">' + D.STICKERS.map(function (s) { return '<button class="' + (ui.sticker === s ? "ph-on" : "") + '" data-act="sticker" data-s="' + s + '">' + s + "</button>"; }).join("") + "</div>";
        h += m.o.map(function (o, k) { var tone = D.TONES[o[1]]; return '<button class="ph-opt" data-act="reply" data-k="' + k + '">' + (tone ? '<span class="ph-tone" title="' + tone.name + '">' + tone.ic + "</span>" : "") + esc(o[0]) + "</button>"; }).join("");
      }
      h += "</div>";
    } else if (c.stage >= 3 && st.slot === 3 && st.replies > 0) h += '<div class="ph-reply"><button class="ph-opt ph-love" data-act="invitenight" data-id="' + id + '">🌙 「今晚……想見你。」（去她家）</button></div>';
    else h += '<p class="ph-small ph-muted ph-center">（等她的下一則訊息）</p>';
    return h;
  }
  function renderStories() {
    if (!st.stories.length) return '<p class="ph-muted ph-center">今天沒有人發限動。</p>';
    return '<div class="ph-stories">' + st.stories.map(function (s, i) {
      return '<div class="ph-story-card">' + av(s.id, "ph-mid") + '<div class="ph-sc-body"><b>' + esc(P(s.id).short) + "</b><p>" + esc(s.t) + '</p></div><button class="ph-like' + (s.liked ? " ph-on" : "") + '" data-act="like" data-k="' + i + '"' + (s.liked ? " disabled" : "") + ">" + (s.liked ? "❤" : "♡") + "</button></div>";
    }).join("") + '<p class="ph-small ph-muted ph-center">按讚不花回覆次數。限動裡常有她喜歡的東西——記下來。</p></div>';
  }
  function renderMatch() {
    var id = st.deck[0];
    if (!id) return '<p class="ph-muted ph-center">今天的推薦都看完了。明天再來。</p>';
    var m = st.mp[id];
    return '<div class="ph-swipe"><div class="ph-mcard"><img src="' + IMG + esc(m.img) + '" alt=""><div class="ph-minfo"><b>' + esc(m.name) + "，" + m.age + '</b><br><span class="ph-small">' + esc(m.job) + "</span><p>" + esc(m.bio) + '</p></div></div><div class="ph-row"><button class="ph-btn ph-swl" data-act="swipe" data-dir="0">✕</button><button class="ph-btn ph-swr" data-act="swipe" data-dir="1">♥</button></div><p class="ph-small ph-muted ph-center">今天還有 ' + st.deck.length + " 張</p></div>";
  }
  function renderCal() {
    var ks = Object.keys(st.sched).sort();
    var h = '<div class="ph-cal"><h4>📅 行事曆</h4>' + (ks.length ? ks.map(function (k) { var e = st.sched[k], d = Math.floor(k / 10), s = k % 10; return '<div class="ph-calrow">' + av(e.who, "ph-mini") + "<div><b>第 " + d + " 天 " + D.SLOTS[s].name + "</b><br>" + esc(P(e.who).short) + "・" + (e.type === "date1" ? "約會" : "見面") + "</div></div>"; }).join("") : '<p class="ph-muted ph-small">沒有行程。</p>');
    h += '<h4>📒 紀錄</h4><ul class="ph-log">' + st.log.slice(0, 20).map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></div>";
    return h;
  }
  function renderFinal() {
    var ds = dating();
    var h = '<div class="ph-panel ph-center"><h2>📱 第二十一天的深夜</h2><p>手機螢幕亮著。這二十一天的訊息，一則一則地往上滑。</p>';
    if (ds.length) h += '<p>最後一晚，你想傳訊息給誰？</p><div class="ph-grid">' + ds.map(function (id) { return '<button class="ph-card ph-love" data-act="partner" data-id="' + id + '">' + av(id, "ph-mid") + "<b>" + esc(P(id).name) + "</b></button>"; }).join("") + '</div><div class="ph-row"><button class="ph-btn" data-act="partner" data-id="">關掉手機</button></div>';
    else h += '<div class="ph-row"><button class="ph-btn ph-primary" data-act="partner" data-id="">關掉手機</button></div>';
    return h + "</div>";
  }
  function renderEnding() {
    var p = ui.end.partner, ds = dating();
    var h = '<div class="ph-panel ph-ending"><h2>💌 二十一天之後</h2>';
    if (p) h += '<div class="ph-partner">' + av(p, "ph-big") + '<p class="ph-lovetxt">你傳了一則訊息給' + esc(P(p).short) + "：「以後的每一天，都想第一個跟你說早安。」<br>三秒後，已讀。然後：「……我也是。」</p></div>";
    else h += "<p>你關掉了手機。螢幕暗下來的瞬間，好像聽到了一聲通知音。</p>";
    h += "<h3>那之後的她們</h3>";
    D.GIRLS.forEach(function (g) { var c = st.c[g.id]; if (!c) return; h += '<div class="ph-mem">' + av(g.id, "ph-mini") + "<div><b>" + esc(g.name) + "</b>" + (c.stage >= 3 ? " 💕" : "") + (p === g.id ? " 👑" : "") + '<p class="ph-small">' + esc(c.stage >= 3 ? g.epi : g.epiN) + "</p></div></div>"; });
    ids().filter(function (id) { return !H[id] && st.c[id].stage >= 3; }).forEach(function (id) { h += '<div class="ph-mem">' + av(id, "ph-mini") + "<div><b>" + esc(P(id).name) + '</b> 💕<p class="ph-small">' + esc(P(id).short) + "還是會在每天早上傳一則「早安」給你。</p></div></div>"; });
    if (ds.length >= 3) h += '<p class="ph-warn">……另外，你同時和 ' + ds.length + " 個人交往的事，在某天被她們拉進了同一個群組。群組的名字叫做「我們需要談談」。</p>";
    return h + '<div class="ph-row"><button class="ph-btn ph-primary" data-act="title">回到標題</button></div></div>';
  }
  function renderAlbum() {
    var a = album(), h = '<div class="ph-panel"><h2>相簿與回憶</h2>';
    D.GIRLS.forEach(function (g) {
      var b = [];
      if (a["own_" + g.id]) b.push('<button class="ph-btn ph-sm" data-act="replay" data-k="own" data-id="' + g.id + '">' + esc(N.OWN[g.id].title) + "</button>");
      N.SHARED.forEach(function (s, i) { if (a["sh" + i + "_" + g.id]) b.push('<button class="ph-btn ph-sm" data-act="replay" data-k="' + i + '" data-id="' + g.id + '">' + esc(s.title) + "</button>"); });
      h += '<div class="ph-mem"><img class="ph-av ph-mini" src="' + IMG + esc(g.img) + '" alt=""><div><b>' + esc(g.name) + "</b><br>" + (b.length ? b.join(" ") : '<span class="ph-muted ph-small">？？？</span>') + "</div></div>";
    });
    return h + '<div class="ph-row"><button class="ph-btn" data-act="title">返回</button></div></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], h = '<div class="ph-vn">';
    if (v.title) h += '<p class="ph-vn-title">' + esc(v.title) + "</p>";
    var who = null, text = "";
    if (typeof s === "string") text = s; else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var sp = who === "@" ? v.who : who;
    h += '<div class="ph-stage">' + (v.who ? av(v.who, "ph-vnpt") : "") + '</div><div class="ph-box">';
    if (sp && P(sp)) h += '<p class="ph-name" style="color:' + P(sp).color + '">' + esc(P(sp).name) + "</p>";
    if (s && s.ch) h += '<div class="ph-choices">' + s.ch.map(function (c, k) { return '<button class="ph-btn ph-choice" data-act="ch" data-k="' + k + '">' + esc(fill(c.t)) + "</button>"; }).join("") + "</div>";
    else h += '<p class="ph-text">' + esc(fill(text)) + '</p><button class="ph-btn ph-primary ph-next" data-act="next">▼</button>';
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story, g = P(s.who);
    return '<div class="ph-vn"><p class="ph-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + '</small></p><div class="ph-stage ph-stage-night">' + av(s.who, "ph-vnpt") + '</div><div class="ph-box ph-box-night"><p class="ph-text">' + esc(String(s.pages[s.i]).replace(/\{n\}/g, g.short)) + '</p><div class="ph-row">' +
      (s.i > 0 ? '<button class="ph-btn ph-sm" data-act="sprev">上一段</button>' : "") + '<button class="ph-btn ph-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
  }

  // ---------------- 輸入 ----------------
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); ui.screen = st ? "phone" : "title"; ui.view = "home"; render(); return; }
    if (act === "title") { if (st && !st.ended) save(); ui.screen = "title"; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") { var sto = b.getAttribute("data-k") === "own" ? N.OWN[id] : N.SHARED[+b.getAttribute("data-k")]; ui.story = { who: id, title: sto.title, pages: sto.pages, i: 0, after: function () { ui.screen = "album"; render(); } }; ui.screen = "story"; render(); return; }
    if (act === "view") { ui.view = b.getAttribute("data-v"); render(); return; }
    if (act === "open") { ui.chat = id; ui.view = "thread"; ui.sticker = null; var c = st.c[id]; if (c.pend) c.pend.read = true; save(); render(); return; }
    if (act === "sticker") { var s = b.getAttribute("data-s"); ui.sticker = ui.sticker === s ? null : s; render(); return; }
    if (act === "reply") { reply(ui.chat, +b.getAttribute("data-k")); return; }
    if (act === "invitenight") { inviteNight(id); return; }
    if (act === "like") { var sk = st.stories[+b.getAttribute("data-k")]; if (sk && !sk.liked) { sk.liked = true; st.c[sk.id].aff = clamp(st.c[sk.id].aff + 2, 0, 100); if (sk.k !== "mood") st.c[sk.id].shown[sk.k] = 1; ui.toast = P(sk.id).short + " 好感 +2"; save(); } render(); return; }
    if (act === "swipe") {
      var mid = st.deck.shift();
      if (b.getAttribute("data-dir") === "1" && Math.random() < 0.45) { addContact(mid); log("💘 和 " + st.mp[mid].short + " 配對成功"); ui.toast = "配對成功！" + st.mp[mid].short + " 傳了訊息給你"; }
      save(); render(); return;
    }
    if (act === "call") { videoCall(st.call); render(); return; }
    if (act === "decline") { var cid = st.call; st.call = null; st.c[cid].aff = clamp(st.c[cid].aff - 3, 0, 100); save(); render(); return; }
    if (act === "nextslot") { ui.view = "home"; endSlot(); return; }
    if (act === "partner") { ending(id || null); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s2 = ui.story; if (s2.i + 1 < s2.pages.length) { s2.i++; render(); } else { ui.story = null; s2.after(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " && ev.key !== "Enter") return;
    var btn = app.querySelector(".ph-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  window.PriTestPhone = { _state: function () { return st; }, _ui: function () { return ui; } };
  render();
})();
