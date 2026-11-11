// 無人島的漂流者（isle）：規則與畫面。2026-11-11 依使用者需求新增。
// 每天：早上分配 8 位漂流者＋你的工作、選糧食配給 → 「度過這一天」結算（天氣、產出、建造、探索、消耗）→ 夜晚（營火／沙灘／瀑布、交往後共度）。
// 結局：訊號火被船看見（獲救）、乘木筏出海、第 30 天搜救隊抵達（回家或留下）。
(function () {
  "use strict";

  var D = window.PriTestIsleData, N = window.PriTestIsleNight;
  var app = document.getElementById("il-app");
  if (!D || !N || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-isle-save-v1", AGE_KEY = "pritest-isle-age-ok", ALBUM_KEY = "pritest-isle-album", BEST_KEY = "pritest-isle-best";
  var G = {}; D.GIRLS.forEach(function (g) { G[g.id] = g; });
  var TK = {}; D.TASKS.forEach(function (t) { TK[t.id] = t; });
  var BD = {}; D.BUILDS.forEach(function (b) { BD[b.id] = b; });
  var OUTDOOR = { food: 1, water: 1, wood: 1, mat: 1, explore: 1 };

  var st = null;
  var ui = { screen: "title", vn: null, story: null, toast: "", ageOk: false, queue: [] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function save() { store(SAVE_KEY, st && !st.ended ? st : null); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function ageOk() { try { return localStorage.getItem(AGE_KEY) === "1"; } catch (e) { return ui.ageOk; } }
  function album() { return load(ALBUM_KEY) || {}; }
  function addAlbum(k) { var a = album(); a[k] = 1; store(ALBUM_KEY, a); }
  function log(t) { st.log.unshift("D" + st.day + "　" + t); if (st.log.length > 60) st.log.length = 60; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function zoneDone(id) { return (st.zones[id] || 0) >= 100; }
  function dating() { return D.GIRLS.filter(function (g) { return st.g[g.id].dating; }).map(function (g) { return g.id; }); }
  function avgMor() { var t = 0; D.GIRLS.forEach(function (g) { t += st.g[g.id].mor; }); return t / D.GIRLS.length; }

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { day: 1, phase: "plan", res: { food: 14, water: 12, wood: 4, stone: 0, fiber: 2 }, ration: "normal", proj: null, built: {}, zones: {}, target: "jungle",
      weather: "sun", g: {}, me: "build", log: [], flags: {}, lastShared: -1, knock: null, ended: false };
    D.GIRLS.forEach(function (g) { st.g[g.id] = { hp: 100, mor: 55, aff: 0, line: 0, dating: false, nights: 0, cool: 0, task: g.skills[0] === "rest" ? "food" : g.skills[0] }; });
    st.proj = { id: "fire", work: 0 }; spend(BD.fire.cost);
    startVN(null, "序章・漂流", D.PROLOGUE, function () { ui.screen = "plan"; save(); });
  }
  function spend(cost) { Object.keys(cost).forEach(function (k) { st.res[k] -= cost[k]; }); }
  function afford(cost) { return Object.keys(cost).every(function (k) { return st.res[k] >= cost[k]; }); }
  function canBuild(b) { if (st.built[b.id]) return false; if (b.need && !(st.built[b.need] || zoneDone(b.need))) return false; return true; }
  function rollWeather() { var tot = 0; D.WEATHER.forEach(function (w) { tot += w.w; }); var x = Math.random() * tot; for (var i = 0; i < D.WEATHER.length; i++) { x -= D.WEATHER[i].w; if (x <= 0) return D.WEATHER[i].id; } return "sun"; }

  // ---------------- VN ----------------
  function startVN(who, title, steps, after) { ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after, sub: {} }; ui.screen = "vn"; adv(); }
  function fill(t) { var v = ui.vn; t = String(t); if (v && v.who) t = t.replace(/\{n\}/g, G[v.who].short); if (v && v.sub.m) t = t.replace(/\{m\}/g, G[v.sub.m].short); return t; }
  function addAff(id, n) { var x = st.g[id]; x.aff = clamp(x.aff + n, 0, 100); if (n > 0) ui.toast = G[id].short + " 好感 +" + n; }
  function eff(e, who) { if (!e) return; if (e.a && who) addAff(who, e.a); if (e.mor && who) st.g[who].mor = clamp(st.g[who].mor + e.mor, 0, 100); }
  function adv() {
    var v = ui.vn;
    while (v && v.i < v.steps.length) { var s = v.steps[v.i]; if (s && typeof s === "object" && !Array.isArray(s) && s.e && !s.ch) { eff(s.e, v.who); v.i++; continue; } break; }
    if (v && v.i >= v.steps.length) { ui.vn = null; if (v.after) v.after(); else { ui.screen = "plan"; save(); } }
  }
  function vnNext() { ui.vn.i++; adv(); render(); }
  function vnChoose(k) { var v = ui.vn, c = v.steps[v.i].ch[k]; eff(c.e, v.who); v.steps.splice.apply(v.steps, [v.i + 1, 0].concat((c.r || []).slice())); v.i++; adv(); render(); }
  // 依序播放一串 VN（發現、事件），播完回到 after
  function playQueue(after) { var q = ui.queue.shift(); if (!q) { after(); return; } startVN(q.who, q.title, q.steps, function () { playQueue(after); }); }

  // ---------------- 一天的結算 ----------------
  function workEff(id) { var x = st.g[id]; return (x.hp < 30 ? 0.4 : 1) * (0.6 + x.mor / 250); }
  function produce(task, skilled, e, rep) {
    var w = st.weather, amt = TK[task].base * (skilled ? 1.8 : 1) * e * rnd(0.85, 1.15);
    if (OUTDOOR[task] && w === "storm") amt *= 0.5;
    if (w === "rain") amt *= task === "water" ? 1.4 : OUTDOOR[task] ? 0.85 : 1;
    var R = st.res;
    if (task === "food") { amt *= (st.built.fire ? 1.2 : 1) * (zoneDone("jungle") ? 1.3 : 1); R.food += amt; rep.food += amt; }
    else if (task === "water") { amt *= zoneDone("falls") ? 1.4 : 1; R.water += amt; rep.water += amt; }
    else if (task === "wood") { R.wood += amt; rep.wood += amt; }
    else if (task === "mat") { var m = zoneDone("cave") ? 1.4 : 1; R.stone += amt * 0.5 * m; R.fiber += amt * 0.6 * m; rep.stone += amt * 0.5 * m; rep.fiber += amt * 0.6 * m; }
    else if (task === "explore") { var z = st.target; if (z && !zoneDone(z)) { st.zones[z] = (st.zones[z] || 0) + amt; rep.explore += amt; } }
    else if (task === "build") { if (st.proj) { st.proj.work += amt; rep.build += amt; } }
    return amt;
  }
  function endDay() {
    var rep = { food: 0, water: 0, wood: 0, stone: 0, fiber: 0, explore: 0, build: 0, lines: [] }, w = st.weather;
    D.GIRLS.forEach(function (g) {
      var x = st.g[g.id], t = x.task;
      if (t === "rest") {
        x.hp = clamp(x.hp + 15, 0, 100); x.mor = clamp(x.mor + 8, 0, 100);
        if (g.skills.indexOf("rest") >= 0) { D.GIRLS.forEach(function (o) { st.g[o.id].mor = clamp(st.g[o.id].mor + 4, 0, 100); }); rep.lines.push("💃 " + g.short + " 在營地跳舞唱歌，大家的士氣提升了"); }
        return;
      }
      if (t === "heal") {
        var amt = TK.heal.base * (g.skills.indexOf("heal") >= 0 ? 1.8 : 1) * workEff(g.id);
        var hurt = D.GIRLS.filter(function (o) { return o.id !== g.id; }).sort(function (a, b) { return st.g[a.id].hp - st.g[b.id].hp; }).slice(0, 2);
        hurt.forEach(function (o) { st.g[o.id].hp = clamp(st.g[o.id].hp + amt, 0, 100); });
        x.hp = clamp(x.hp - 1, 0, 100); return;
      }
      produce(t, g.skills.indexOf(t) >= 0, workEff(g.id), rep);
      x.hp = clamp(x.hp - (t === "wood" || t === "mat" || t === "build" ? 5 : 3), 0, 100);
      if (OUTDOOR[t] && Math.random() < 0.05) { x.hp = clamp(x.hp - 30, 0, 100); rep.lines.push("🤕 " + g.short + " 在" + TK[t].name + "時受傷了"); }
    });
    if (st.me !== "rest") produce(st.me, false, 1, rep);
    // 和你做同一件工作的人，好感 +3
    var mates = D.GIRLS.filter(function (g) { return st.me !== "rest" && st.g[g.id].task === st.me; });
    mates.forEach(function (g) { st.g[g.id].aff = clamp(st.g[g.id].aff + 3, 0, 100); });
    if (mates.length) rep.lines.push("🤝 和你一起" + TK[st.me].name + "的 " + mates.map(function (g) { return g.short; }).join("、") + " 好感 +3");
    // 自動產出
    if (st.built.rain) { var rw = w === "rain" || w === "storm" ? 7 : 3; st.res.water += rw; rep.water += rw; }
    if (st.built.net) { st.res.food += 3; rep.food += 3; }
    if (st.built.garden) { st.res.food += 3; rep.food += 3; }
    // 建造完成
    if (st.proj && st.proj.work >= BD[st.proj.id].work) {
      var b = BD[st.proj.id]; st.built[b.id] = true; rep.lines.push(b.ic + " " + b.name + "完成了！"); log(b.ic + " 建好了" + b.name); st.proj = null;
    }
    // 探索完成
    D.ZONES.forEach(function (z) {
      if ((st.zones[z.id] || 0) >= 100 && !st.flags["zone_" + z.id]) {
        st.flags["zone_" + z.id] = 1; log(z.ic + " 發現了" + z.name);
        ui.queue.push({ who: null, title: z.ic + " 發現：" + z.name, steps: [z.find] });
        var nxt = D.ZONES.filter(function (q) { return !zoneDone(q.id); })[0]; st.target = nxt ? nxt.id : null;
      }
    });
    // 消耗
    var n = D.GIRLS.length + 1, rm = { low: 0.6, normal: 1, high: 1.4 }[st.ration], needF = n * rm;
    if (st.res.food >= needF) { st.res.food -= needF; D.GIRLS.forEach(function (g) { st.g[g.id].mor = clamp(st.g[g.id].mor + (st.ration === "low" ? -4 : st.ration === "high" ? 4 : 0), 0, 100); if (st.ration === "low") st.g[g.id].hp = clamp(st.g[g.id].hp - 3, 0, 100); }); }
    else { st.res.food = 0; D.GIRLS.forEach(function (g) { st.g[g.id].hp = clamp(st.g[g.id].hp - 12, 0, 100); st.g[g.id].mor = clamp(st.g[g.id].mor - 10, 0, 100); }); rep.lines.push("⚠ 食物不夠了！全員的體力與士氣下降"); }
    if (st.res.water >= n) st.res.water -= n;
    else { st.res.water = 0; D.GIRLS.forEach(function (g) { st.g[g.id].hp = clamp(st.g[g.id].hp - 18, 0, 100); st.g[g.id].mor = clamp(st.g[g.id].mor - 8, 0, 100); }); rep.lines.push("⚠ 水不夠了！全員口渴難耐"); }
    if (w === "storm") {
      if (st.built.shelter) rep.lines.push("⛈ 暴風雨……幸好有避難所");
      else { D.GIRLS.forEach(function (g) { st.g[g.id].hp = clamp(st.g[g.id].hp - 10, 0, 100); st.g[g.id].mor = clamp(st.g[g.id].mor - 8, 0, 100); }); rep.lines.push("⛈ 暴風雨！沒有避難所，大家淋了一整天的雨"); }
    }
    if (st.built.shelter) D.GIRLS.forEach(function (g) { st.g[g.id].mor = clamp(st.g[g.id].mor + 3, 0, 100); });
    // 低士氣的爭吵
    var low = D.GIRLS.filter(function (g) { return st.g[g.id].mor < 30; });
    if (low.length >= 2 && Math.random() < 0.5) {
      var a = low[0], b2 = low[1];
      ui.queue.push({ who: a.id, title: "爭吵", steps: [a.short + "和" + b2.short + "為了誰多吃了一口飯吵了起來。", ["@", "大家都在挨餓，憑什麼她可以——"], { ch: [
        { t: "「我的那份分給你們。」", e: { mor: 8 }, r: ["兩個人愣住了，然後都低下了頭。那天晚上，大家把食物重新分得很仔細。"] },
        { t: "「吵架解決不了問題。」", e: { mor: 3 }, r: ["兩個人不情願地分開了。"] }] }] });
    }
    // 訊號火
    if (st.built.signal) {
      if (st.res.wood >= 2) { st.res.wood -= 2; if (st.day >= 10 && Math.random() < 0.06 + st.day * 0.004) st.flags.ship = 1; }
      else rep.lines.push("🔆 木材不夠，今天的訊號火沒有點燃");
    }
    Object.keys(st.res).forEach(function (k) { st.res[k] = Math.max(0, r1(st.res[k])); });
    ui.rep = rep;
    st.phase = "night";
    st.knock = dating().length && Math.random() < 0.3 ? pick(dating()) : null;
    playQueue(function () { ui.screen = "report"; save(); render(); });
    render();
  }
  function nextDay() {
    D.GIRLS.forEach(function (g) { if (st.g[g.id].cool > 0) st.g[g.id].cool--; });
    if (st.flags.ship) { endGame("rescued"); return; }
    st.day++; st.phase = "plan"; st.weather = rollWeather();
    if (st.day > D.DAYS) { st.day = D.DAYS; ui.screen = "day30"; render(); return; }
    ui.screen = "plan"; save(); render();
  }

  // ---------------- 夜晚 ----------------
  function lineDue(id) { var x = st.g[id]; return x.line < 2 && x.aff >= D.LINE_AFF[x.line]; }
  function confessDue(id) { var x = st.g[id]; return !x.dating && x.line >= 2 && x.aff >= D.CONFESS_AFF && x.cool <= 0; }
  function goSpot(sp) {
    var who = null, pool = D.GIRLS.filter(function (g) { return g.spots.indexOf(sp) >= 0; }).map(function (g) { return g.id; });
    var due = pool.filter(function (id) { return lineDue(id) || confessDue(id); });
    who = due.length && Math.random() < 0.85 ? pick(due) : pick(pool);
    var name = D.NIGHTSPOTS.filter(function (s) { return s.id === sp; })[0].name;
    log("🌙 " + name + "：遇到 " + G[who].short);
    var x = st.g[who];
    if (confessDue(who)) {
      startVN(who, G[who].short + "・告白", G[who].confess.concat([{ ch: [
        { t: "抱住她：「我也喜歡你。」", e: { a: 10 }, r: ["她在你懷裡又哭又笑。從今晚開始，你們在一起了。"] },
        { t: "「……等我們回到陸地再說。」", e: { a: -12 }, r: ["她低下頭：「……我知道了。」"] }] }]), function () {
        if (x.aff >= D.CONFESS_AFF + 5) { x.dating = true; log("💕 和 " + G[who].short + " 在一起了"); } else x.cool = 3;
        nextDay();
      });
      return;
    }
    if (lineDue(who)) { var ln = G[who].lines[x.line]; x.line++; log("📝 " + G[who].short + "的故事：" + ln.title); startVN(who, G[who].short + "・" + ln.title + "（" + x.line + "/2）", ln.steps, nextDay); return; }
    var hs = D.HAPPEN.filter(function (h) { return h.sp === sp; });
    if (hs.length && Math.random() < 0.4) {
      var h = pick(hs), ok = x.aff >= h.need || x.dating;
      log("💓 意外：" + h.title + "（" + G[who].short + "）");
      startVN(who, "意外・" + h.title, h.steps.concat([{ ch: [h.safe, { t: h.bold.t, e: { a: ok ? 10 : -4 }, r: ok ? h.bold.ok : h.bold.ng }] }]), nextDay);
      return;
    }
    var f = pick(D.FREE.filter(function (q) { return q.sp === sp; }));
    startVN(who, name, f.steps.concat([{ ch: f.ch }]), nextDay);
  }
  function openStory(id) {
    var x = st.g[id], story, key;
    if (!x.nights) { story = N.OWN[id]; key = "own_" + id; }
    else { var k; do { k = Math.floor(Math.random() * N.SHARED.length); } while (N.SHARED.length > 1 && k === st.lastShared); st.lastShared = k; story = N.SHARED[k]; key = "sh" + k + "_" + id; }
    x.nights++; addAff(id, 5); x.mor = clamp(x.mor + 8, 0, 100); addAlbum(key);
    log("🌙 和 " + G[id].short + " 共度夜晚：" + story.title);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: nextDay };
    ui.screen = "story";
  }
  function visit(id) {
    var others = dating().filter(function (o) { return o !== id; });
    if (others.length && Math.random() < 0.2) {
      var o = pick(others);
      startVN(o, "修羅場", D.JEALOUS.concat([{ e: { a: -6, mor: -6 } }]), function () { openStory(id); render(); });
      ui.vn.sub.m = id; return;
    }
    openStory(id);
  }

  // ---------------- 結局 ----------------
  function endGame(kind) { st.endKind = kind; ui.screen = "partner"; save(); render(); }
  function finish(partner) {
    st.ended = true; ui.end = { kind: st.endKind, partner: partner };
    var best = load(BEST_KEY) || {}; best[st.endKind] = (best[st.endKind] || 0) + 1; if (partner) best["p_" + partner] = 1; store(BEST_KEY, best);
    store(SAVE_KEY, null); ui.screen = "ending"; render();
  }

  // ---------------- 畫面 ----------------
  function portrait(id, cls) { return '<img class="il-pt ' + (cls || "") + '" src="' + IMG + esc(G[id].img) + '" alt="" style="--il-c:' + G[id].color + '">'; }
  function bar(v, cls) { return '<span class="il-bar ' + (cls || "") + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></span>'; }
  function render() {
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    var h;
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "report") h = renderReport();
    else if (ui.screen === "day30") h = renderDay30();
    else if (ui.screen === "partner") h = renderPartner();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else h = renderPlan();
    if (ui.toast) { h += '<div class="il-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="il-root">' + h + "</div>";
  }
  function renderAge() {
    return '<div class="il-age"><p class="il-age-mark">18+</p><h2>本遊戲含成人向內容</h2><p>遊戲中有成年角色之間的親密、性暗示描寫。登場人物全員皆為 21 歲以上的成年人。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="il-row"><button class="il-btn il-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="il-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY), best = load(BEST_KEY) || {};
    var h = '<div class="il-title"><p class="il-sub">SURVIVAL × ROMANCE</p><h1>無人島的漂流者</h1><p class="il-tag">郵輪觸礁。你和八個她，被沖上了無人島。<br>活下去——然後，回家，或者不回去。</p>';
    h += '<div class="il-faces">' + D.GIRLS.map(function (g) { return portrait(g.id, "il-face"); }).join("") + '</div><div class="il-row">';
    if (saved) h += '<button class="il-btn il-primary" data-act="continue">繼續（第 ' + saved.day + " 天）</button>";
    h += '<button class="il-btn' + (saved ? "" : " il-primary") + '" data-act="new">' + (saved ? "重新開始" : "醒來") + '</button><button class="il-btn" data-act="album">夜晚回憶</button></div>';
    var ks = ["rescued", "raft", "home", "paradise"].filter(function (k) { return best[k]; });
    if (ks.length) h += '<p class="il-muted il-small">已達成結局：' + ks.map(function (k) { return { rescued: "獲救", raft: "出海", home: "回家", paradise: "樂園" }[k]; }).join("、") + "</p>";
    return h + "</div>";
  }
  function renderTop() {
    var W = D.WEATHER.filter(function (w) { return w.id === st.weather; })[0], R = st.res;
    return '<div class="il-top"><div><b class="il-day">第 ' + st.day + " 天</b>／" + D.DAYS + "　" + W.ic + " " + W.name + '</div><div class="il-res">🍌 ' + Math.floor(R.food) + "　💧 " + Math.floor(R.water) + "　🪵 " + Math.floor(R.wood) + "　🪨 " + Math.floor(R.stone) + "　🌿 " + Math.floor(R.fiber) + '</div><div><button class="il-btn il-sm" data-act="title">標題</button></div></div>';
  }
  function taskSelect(id, cur) {
    return '<select class="il-sel" data-id="' + id + '">' + D.TASKS.map(function (t) { var sk = id !== "me" && G[id].skills.indexOf(t.id) >= 0; return '<option value="' + t.id + '"' + (cur === t.id ? " selected" : "") + ">" + t.ic + " " + t.name + (sk ? " ★" : "") + "</option>"; }).join("") + "</select>";
  }
  function renderPlan() {
    var h = renderTop(), n = D.GIRLS.length + 1;
    if (st.built.raft && !st.flags.raftAsked) h += '<div class="il-panel il-center"><h3>⛵ 木筏完成了</h3><p>要現在出海嗎？（遊戲結束）</p><div class="il-row"><button class="il-btn il-primary" data-act="sail">全員出海</button><button class="il-btn" data-act="notyet">再等等</button></div></div>';
    h += '<div class="il-panel"><h3>☀ 今天的工作分配</h3><p class="il-small il-muted">★＝她擅長的工作（效率 ×1.8）。體力低於 30 的人效率會大降，讓她休息或請醫生照顧。每天會消耗 🍌 ' + n + "（看配給）、💧 " + n + "。</p><div class=\"il-crew\">";
    D.GIRLS.forEach(function (g) {
      var x = st.g[g.id];
      h += '<div class="il-member' + (x.hp < 30 ? " il-hurt" : "") + '">' + portrait(g.id, "il-mini") + '<div class="il-mbody"><b>' + esc(g.short) + (x.dating ? " 💕" : "") + '</b><span class="il-small il-muted">' + esc(g.job) + '</span><span class="il-small">體力 ' + bar(x.hp, "il-hp") + " 士氣 " + bar(x.mor, "il-mor") + "</span>" + taskSelect(g.id, x.task) + "</div></div>";
    });
    h += '<div class="il-member"><div class="il-mepic">你</div><div class="il-mbody"><b>你</b><span class="il-small il-muted">和你做同一件工作的人，好感 +3</span>' + taskSelect("me", st.me) + "</div></div></div>";
    h += '<div class="il-opts"><label>🍽 配給 <select class="il-ration"><option value="low"' + (st.ration === "low" ? " selected" : "") + '>節省（×0.6，士氣與體力下降）</option><option value="normal"' + (st.ration === "normal" ? " selected" : "") + '>普通</option><option value="high"' + (st.ration === "high" ? " selected" : "") + ">豐盛（×1.4，士氣上升）</option></select></label>";
    var zs = D.ZONES.filter(function (z) { return !zoneDone(z.id); });
    if (zs.length) h += ' <label>🧭 探索目標 <select class="il-target">' + zs.map(function (z) { return '<option value="' + z.id + '"' + (st.target === z.id ? " selected" : "") + ">" + z.ic + " " + z.name + "（" + Math.floor(st.zones[z.id] || 0) + "%）</option>"; }).join("") + "</select></label>";
    h += "</div></div>";
    // 建造
    h += '<div class="il-panel"><h3>🔨 建造</h3>';
    if (st.proj) { var b = BD[st.proj.id]; h += '<p>' + b.ic + " <b>" + b.name + "</b> 施工中 " + bar(st.proj.work / b.work * 100, "il-work") + " " + Math.floor(st.proj.work) + "／" + b.work + '　<span class="il-small il-muted">' + esc(b.desc) + "</span></p>"; }
    else h += '<p class="il-small il-muted">選一個建築開工（開工時消耗材料，之後由「建造」工作累積進度）。</p>';
    h += '<div class="il-grid">' + D.BUILDS.map(function (b) {
      var done = st.built[b.id], ok = canBuild(b) && !st.proj && afford(b.cost);
      return '<button class="il-card' + (done ? " il-done" : "") + '" data-act="startbuild" data-id="' + b.id + '"' + (ok ? "" : " disabled") + "><b>" + b.ic + " " + esc(b.name) + (done ? " ✔" : "") + '</b><span class="il-small">' + Object.keys(b.cost).map(function (k) { return { wood: "🪵", stone: "🪨", fiber: "🌿", food: "🍌" }[k] + b.cost[k]; }).join(" ") + "・工作 " + b.work + '</span><span class="il-small il-muted">' + esc(b.desc) + (b.need && !(st.built[b.need] || zoneDone(b.need)) ? "（需要：" + (BD[b.need] ? BD[b.need].name : D.ZONES.filter(function (z) { return z.id === b.need; })[0].name) + "）" : "") + "</span></button>";
    }).join("") + "</div></div>";
    h += '<div class="il-row"><button class="il-btn il-primary il-big" data-act="endday">度過這一天</button></div>';
    h += '<details class="il-log"><summary>紀錄</summary><ul>' + st.log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></details>";
    return h;
  }
  function renderReport() {
    var r = ui.rep, h = renderTop();
    h += '<div class="il-panel"><h3>🌅 今天的成果</h3><p>🍌 +' + r1(r.food) + "　💧 +" + r1(r.water) + "　🪵 +" + r1(r.wood) + "　🪨 +" + r1(r.stone) + "　🌿 +" + r1(r.fiber) + (r.explore ? "　🧭 +" + Math.floor(r.explore) + "%" : "") + (r.build ? "　🔨 +" + Math.floor(r.build) : "") + "</p>";
    h += r.lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>";
    h += '<div class="il-panel"><h3>🌙 夜晚</h3>';
    if (st.knock) h += '<div class="il-row"><button class="il-btn il-primary il-pulse" data-act="knock">……有人在你的避難所外面</button></div>';
    h += '<div class="il-grid">' + D.NIGHTSPOTS.map(function (s) {
      var ok = (!s.need || st.built[s.need]) && (!s.needZone || zoneDone(s.needZone));
      var fans = D.GIRLS.filter(function (g) { return g.spots.indexOf(s.id) >= 0; }).map(function (g) { return g.short; }).join("、");
      return '<button class="il-card" data-act="spot" data-id="' + s.id + '"' + (ok ? "" : " disabled") + "><b>" + s.ic + " " + esc(s.name) + '</b><span class="il-small il-muted">' + (ok ? "常出現：" + esc(fans) : s.need ? "需要" + BD[s.need].name : "還沒找到") + "</span></button>";
    }).join("") + "</div>";
    var ds = dating();
    if (ds.length) h += '<h4>💕 和她溜出營地</h4><div class="il-grid">' + ds.map(function (id) { return '<button class="il-card il-love" data-act="visit" data-id="' + id + '">' + portrait(id, "il-mini") + "<b>" + esc(G[id].short) + '</b><span class="il-small">' + (st.g[id].nights ? "共度了 " + st.g[id].nights + " 晚" : "第一次的夜晚") + (st.built.hut ? "・小屋" : "") + "</span></button>"; }).join("") + "</div>";
    h += '<div class="il-row"><button class="il-btn il-sm" data-act="sleep">早點睡</button></div></div>';
    return h;
  }
  function renderDay30() {
    return '<div class="il-panel il-center"><h2>🚁 第三十天</h2><p>天空傳來了直升機的聲音。搜救隊，終於找到了你們。</p><p>大家在沙灘上揮手、哭著、抱在一起。</p><p>可是你看著這座島——你們一起蓋的避難所、營火、小屋——突然有點捨不得。</p>' +
      '<div class="il-row"><button class="il-btn il-primary" data-act="end" data-id="home">回家</button>' + (Object.keys(st.built).length >= 5 && avgMor() >= 55 ? '<button class="il-btn" data-act="end" data-id="paradise">留在島上</button>' : "") + "</div>" +
      (Object.keys(st.built).length >= 5 && avgMor() >= 55 ? "" : '<p class="il-small il-muted">（建築 5 座以上、平均士氣 55 以上，才會有人想留下）</p>') + "</div>";
  }
  function renderPartner() {
    var ds = dating(), kind = st.endKind;
    var head = { rescued: "🚢 訊號火被看見了！", raft: "⛵ 出海", home: "🚁 回家", paradise: "🏝 留在島上" }[kind];
    var h = '<div class="il-panel il-center"><h2>' + head + "</h2>";
    if (ds.length) h += '<p>最後，你想和誰在一起？</p><div class="il-grid">' + ds.map(function (id) { return '<button class="il-card il-love" data-act="partner" data-id="' + id + '">' + portrait(id, "il-midpt") + "<b>" + esc(G[id].name) + "</b></button>"; }).join("") + '</div><div class="il-row"><button class="il-btn" data-act="partner" data-id="">一個人</button></div>';
    else h += '<div class="il-row"><button class="il-btn il-primary" data-act="partner" data-id="">繼續</button></div>';
    return h + "</div>";
  }
  function renderEnding() {
    var e = ui.end, p = e.partner;
    var body = {
      rescued: "第 " + st.day + " 天的早上，一艘貨輪看見了山頂的煙。九個人被救上了船。甲板上，大家回頭看著那座越來越小的島，誰都沒有說話。",
      raft: "木筏在第 " + st.day + " 天出海了。三天三夜的漂流之後，你們被一艘漁船救起。漁夫說，他從來沒看過這麼堅固的木筏。",
      home: "直升機帶著九個人飛離了島。窗外，你們蓋的小屋和營火越來越小，最後變成了海上的一個綠點。",
      paradise: "搜救隊走了。有幾個人留了下來。你們在島上蓋了更多的小屋，開了更大的菜園。每年，都會有一艘船送來補給——和寄給你們的信。"
    }[e.kind];
    var h = '<div class="il-panel il-ending"><h2>' + { rescued: "🚢 獲救", raft: "⛵ 出海", home: "🚁 回家", paradise: "🏝 樂園" }[e.kind] + "</h2><p>" + esc(body) + "</p>";
    if (p) h += '<div class="il-partner">' + portrait(p, "il-big") + '<p class="il-lovetxt">💕 ' + esc(G[p].short) + "牽著你的手。" + (e.kind === "paradise" ? "她說：「這裡，就是我們的家。」" : "她說：「回去之後，我們也要在一起。」") + "</p></div>";
    h += "<h3>那之後的她們</h3>";
    D.GIRLS.forEach(function (g) { var x = st.g[g.id]; h += '<div class="il-mem">' + portrait(g.id, "il-mini") + "<div><b>" + esc(g.name) + "</b>" + (x.dating ? " 💕" : "") + (p === g.id ? " 👑" : "") + '<p class="il-small">' + esc(x.dating ? g.epi : g.epiN) + "</p></div></div>"; });
    if (dating().length >= 3) h += '<p class="il-warn">……另外，你在島上和 ' + dating().length + " 個人在一起的事，在搜救船的甲板上全部穿幫了。據說那天晚上，船艙的門被敲了一整夜。</p>";
    return h + '<div class="il-row"><button class="il-btn il-primary" data-act="title">回到標題</button></div></div>';
  }
  function renderAlbum() {
    var a = album(), h = '<div class="il-panel"><h2>夜晚回憶</h2>';
    D.GIRLS.forEach(function (g) {
      var b = [];
      if (a["own_" + g.id]) b.push('<button class="il-btn il-sm" data-act="replay" data-k="own" data-id="' + g.id + '">' + esc(N.OWN[g.id].title) + "</button>");
      N.SHARED.forEach(function (s, i) { if (a["sh" + i + "_" + g.id]) b.push('<button class="il-btn il-sm" data-act="replay" data-k="' + i + '" data-id="' + g.id + '">' + esc(s.title) + "</button>"); });
      h += '<div class="il-mem">' + portrait(g.id, "il-mini") + "<div><b>" + esc(g.name) + "</b><br>" + (b.length ? b.join(" ") : '<span class="il-muted il-small">？？？</span>') + "</div></div>";
    });
    return h + '<div class="il-row"><button class="il-btn" data-act="title">返回</button></div></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], h = '<div class="il-vn">';
    if (v.title) h += '<p class="il-vn-title">' + esc(v.title) + "</p>";
    var who = null, text = "";
    if (typeof s === "string") text = s; else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var sp = who === "@" ? v.who : who;
    h += '<div class="il-stage">' + (v.who ? portrait(v.who, "il-vnpt") : "") + '</div><div class="il-box">';
    if (sp) h += '<p class="il-name" style="color:' + (G[sp] ? G[sp].color : "#ffd59a") + '">' + esc(G[sp] ? G[sp].name : sp) + "</p>";
    if (s && s.ch) h += '<div class="il-choices">' + s.ch.map(function (c, k) { return '<button class="il-btn il-choice" data-act="ch" data-k="' + k + '">' + esc(fill(c.t)) + "</button>"; }).join("") + "</div>";
    else h += '<p class="il-text">' + esc(fill(text)) + '</p><button class="il-btn il-primary il-next" data-act="next">▼</button>';
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story;
    return '<div class="il-story"><p class="il-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + '</small></p><div class="il-stage il-stage-night">' + portrait(s.who, "il-vnpt") + '</div><div class="il-box il-box-night"><p class="il-text">' + esc(String(s.pages[s.i]).replace(/\{n\}/g, G[s.who].short)) + '</p><div class="il-row">' +
      (s.i > 0 ? '<button class="il-btn il-sm" data-act="sprev">上一段</button>' : "") + '<button class="il-btn il-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
  }

  // ---------------- 輸入 ----------------
  app.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.classList.contains("il-sel")) { var id = t.getAttribute("data-id"); if (id === "me") st.me = t.value; else st.g[id].task = t.value; save(); }
    else if (t.classList.contains("il-ration")) { st.ration = t.value; save(); }
    else if (t.classList.contains("il-target")) { st.target = t.value; save(); }
  });
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); ui.screen = st ? (st.phase === "night" ? "report" : "plan") : "title"; if (st && st.phase === "night" && !ui.rep) ui.rep = { food: 0, water: 0, wood: 0, stone: 0, fiber: 0, explore: 0, build: 0, lines: [] }; render(); return; }
    if (act === "title") { if (st && !st.ended) save(); ui.screen = "title"; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") { var sto = b.getAttribute("data-k") === "own" ? N.OWN[id] : N.SHARED[+b.getAttribute("data-k")]; ui.story = { who: id, title: sto.title, pages: sto.pages, i: 0, after: function () { ui.screen = "album"; render(); } }; ui.screen = "story"; render(); return; }
    if (act === "startbuild") { var bd = BD[id]; if (!st.proj && afford(bd.cost) && canBuild(bd)) { spend(bd.cost); st.proj = { id: id, work: 0 }; log("🔨 開始建造" + bd.name); save(); } render(); return; }
    if (act === "endday") { endDay(); return; }
    if (act === "sail") { endGame("raft"); return; }
    if (act === "notyet") { st.flags.raftAsked = 1; save(); render(); return; }
    if (act === "spot") { goSpot(id); render(); return; }
    if (act === "visit") { visit(id); render(); return; }
    if (act === "knock") { var kid = st.knock; st.knock = null; startVN(kid, "深夜", D.KNOCK.slice(), function () { openStory(kid); render(); }); render(); return; }
    if (act === "sleep") { log("😴 早早睡了"); nextDay(); return; }
    if (act === "end") { endGame(id); return; }
    if (act === "partner") { finish(id || null); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s = ui.story; if (s.i + 1 < s.pages.length) { s.i++; render(); } else { ui.story = null; s.after(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " && ev.key !== "Enter") return;
    if (ev.target && /SELECT|INPUT/.test(ev.target.tagName)) return;
    var btn = app.querySelector(".il-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  window.PriTestIsle = { _state: function () { return st; }, _ui: function () { return ui; } };
  render();
})();
