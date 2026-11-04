// 時間管理大師（jikan）：遊戲流程與畫面。
// 28 天、每天三個時段（白天／傍晚／夜晚）：外出邂逅（街道圖）、約會、休息。約會時會被考她說過的情報，
// 記錯扣分、跟別人搞混扣更多；電話、謊言、閨蜜、生日、情報變更都會回頭找你。第 28 天好感最高的她告白。
// 資料在 jikan_data.js、街道圖在 jikan_map.js。原版為單一 HTML（ES2017 async/await），這裡改寫為 ES5 Promise 鏈。
// 狀態存在 localStorage["pritest-jikan-save"]；回憶相簿在 ["pritest-jikan-album"]。
(function () {
  "use strict";

  var D = window.PriTestJikanData;
  var MAP = window.PriTestJikanMap;
  var root = document.getElementById("jk-app");
  if (!root || !D) return;

  var IMG_BASE = root.getAttribute("data-img") || "../static/images/jikan/";
  var KEY = "pritest-jikan-save", ALBUM_KEY = "pritest-jikan-album", DAILY_PREFIX = "pritest-jikan-daily-";
  var MAXDAY = D.MAXDAY, SLOTS = D.SLOTS, P = D.P, CATS = D.CATS, WEEK = D.WEEK;
  var WALK_STEPS = 45;

  root.innerHTML = '<div class="jk-app" id="jk-main"></div><div class="jk-toasts" id="jk-toasts"></div>';
  var app = document.getElementById("jk-main");
  function $(s) { return root.querySelector(s); }

  var S = null, cur = null, busy = false, mapCtl = null, pendingSay = null, locked = false, lastMeet = null;

  // ---------- 小工具 ----------
  function R() {
    if (!S || !S.daily) return Math.random();
    var t = (S.rs = (S.rs + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rnd(n) { return Math.floor(R() * n); }
  function pick(a) { return a[rnd(a.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fill(t, v) { return String(t).split("{v}").join(v); }
  function has(a, x) { return a.indexOf(x) >= 0; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function seq(arr, fn) { return arr.reduce(function (p, x, i) { return p.then(function () { return fn(x, i); }); }, Promise.resolve()); }
  function pad3(n) { return ("00" + n).slice(-3); }

  function week() { return Math.min(4, Math.ceil(S.day / 7)); }
  function tier(a) { var t = D.TIERS[0][1]; D.TIERS.forEach(function (p) { if (a >= p[0]) t = p[1]; }); return t; }
  function active() { return S.girls.filter(function (g) { return !g.left; }); }
  // 2026-11-04 使用者指定：對話中一律以「她」稱呼，名字與個性等個人資訊不先顯示，約會的題目才不會把答案擺在畫面上
  var SHE = "她";
  function dname(g) { return !g.named ? "???" : (has(g.known, "surname") ? g.surname + " " + g.given : g.given); }
  function imgUrl(ref, e) {
    if (!ref || ref.s === "h") return IMG_BASE + "hero_" + pad3(D.EXPR[e] || 0) + ".webp";
    return IMG_BASE + (ref.s === "n" ? "n_" : "g_") + pad3(ref.i) + ".webp";
  }
  function imgSrc(g, e) { return imgUrl(g.img, e); }
  function V(g) { return P[g.pers] || P["溫柔"]; }
  function tellLine(g, c) {
    var v = V(g);
    var t = fill(pick(CATS[c].tell), g.facts[c]);
    var pre = R() < 0.6 ? pick(v.pre) : "";
    var post = (c === "dislike" || c === "secret" || R() < 0.5) ? "" : pick(v.post);
    if (post) {
      post = post.replace(/^，/, "");
      if (/？$/.test(t)) t += post;
      else {
        t = t.replace(/[。！]$/, "") + (/^[～♪！…，（]/.test(post) ? "" : "，") + post;
        if (!/[。！？～♪…）]$/.test(t)) t += "。";
      }
    }
    return pre + t;
  }
  function askLine(g, q) { return pick(V(g).askp) + q; }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 無痕模式等 */ } }
  function load() { try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  function toast(t) {
    var d = document.createElement("div"); d.className = "jk-toast"; d.textContent = t;
    $("#jk-toasts").appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2900);
  }
  function randBirthday() { var m = 1 + rnd(12); var max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; return m + "月" + (1 + rnd(max)) + "日"; }
  function poolOf(c) {
    if (c === "birthday") { var a = []; for (var i = 0; i < 10; i++) a.push(randBirthday()); return a; }
    if (c === "surname") return D.SURNAMES;
    if (c === "personality") return D.PERS;
    return CATS[c].pool;
  }
  function dateOf(day) { var d = new Date(S.start[0], S.start[1] - 1, S.start[2] + day - 1); return (d.getMonth() + 1) + "月" + d.getDate() + "日"; }
  function byId(id) { for (var i = 0; i < S.girls.length; i++) if (S.girls[i].id === id) return S.girls[i]; return null; }
  function friendsOf(g) { return active().filter(function (o) { return o !== g && (o.rel === g.id || g.rel === o.id); }); }
  function timerSecs() { return Math.max(5, WEEK.timer[week() - 1] - (S.fatigue >= 4 ? 2 : 0)); }
  function todayKey() { var d = new Date(); return d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2); }
  function bestDaily() { try { return localStorage.getItem(DAILY_PREFIX + todayKey()) || ""; } catch (e) { return ""; } }

  // ---------- 女孩 ----------
  function freeImgs(set) {
    var n = set === "n" ? D.NEW_COUNT : D.GIRL_COUNT, out = [];
    for (var i = 0; i < n; i++) if (!has(S.usedImgs, set + i)) out.push(i);
    return out;
  }
  // opt.set："n"＝新女孩（車站常客）、"g"＝原本的女孩。指定的那組用完時改用另一組。
  function makeGirl(opt) {
    opt = opt || {};
    var usedS = S.girls.map(function (g) { return g.surname; }), usedG = S.girls.map(function (g) { return g.given; });
    var img;
    if (opt.hero) img = { s: "h", i: 0 };
    else {
      var set = opt.set === "n" ? "n" : "g";
      var free = freeImgs(set);
      if (!free.length) { set = set === "n" ? "g" : "n"; free = freeImgs(set); }
      if (!free.length) return null;
      var i = pick(free); S.usedImgs.push(set + i); img = { s: set, i: i };
    }
    var pers = img.s === "n" ? D.NEW_GIRLS[img.i] : pick(D.PERS);
    var fS = D.SURNAMES.filter(function (x) { return !has(usedS, x); }), fG = D.GIVEN.filter(function (x) { return !has(usedG, x); });
    var facts = { surname: pick(fS.length ? fS : D.SURNAMES), birthday: randBirthday(), personality: pers };
    var soon = S.day + 2 + rnd(10), bdaySoon = false;
    if (R() < 0.4 && soon <= MAXDAY) { facts.birthday = dateOf(soon); bdaySoon = true; }
    D.REVEAL.forEach(function (c) { if (!facts[c]) facts[c] = pick(CATS[c].pool); });
    if (img.s === "g" && D.JOBMAP[img.i]) facts.job = D.JOBMAP[img.i];
    else if (img.s === "g" && img.i >= 63 && img.i <= 78) facts.job = pick(D.OFFICE);
    else if (img.s === "n") facts.job = pick(D.CAMPUS_JOBS);
    facts.secret = pick(CATS.secret.pool);
    var order = shuffle(D.REVEAL);
    if (bdaySoon) { order = order.filter(function (c) { return c !== "birthday"; }); order.unshift("birthday"); }
    order.splice(1 + rnd(3), 0, "surname");
    var act = active();
    var rel = (!opt.hero && act.length && R() < 0.3) ? pick(act).id : null;
    return { id: S.nextId++, given: pick(fG.length ? fG : D.GIVEN), surname: facts.surname, img: img, pers: pers, facts: facts, prev: {}, known: [], order: order, rel: rel,
      aff: 12, met: S.day, last: S.day, bond: false, hotel: false, left: false, named: false, dates: 0, fresh: img.s === "n" };
  }
  function reveal(g, n) {
    var out = [];
    while (out.length < n) {
      var c = null;
      for (var i = 0; i < g.order.length; i++) if (!has(g.known, g.order[i])) { c = g.order[i]; break; }
      if (!c) break;
      g.known.push(c); out.push(c);
    }
    return out;
  }
  function change(g, d, reason) {
    var before = g.aff;
    g.aff = Math.max(0, Math.min(100, g.aff + d));
    var real = g.aff - before;
    S.today.push({ g: g.given, d: real, r: reason });
    if (g === cur && $("#jk-stage")) {
      updAff();
      if (real) $("#jk-fx").innerHTML = '<span class="' + (real > 0 ? "jk-p" : "jk-m") + '">' + (real > 0 ? "+" : "") + real + "</span>";
    } else if (real) toast(g.given + " 好感度 " + (real > 0 ? "+" : "") + real + "（" + reason + "）");
    D.LOCS.forEach(function (l) {
      if (l.need > 0 && before < l.need && g.aff >= l.need) setTimeout(function () { toast("🔓 " + g.given + "：解鎖「" + l.name + "」約會"); }, 600);
    });
  }

  // ---------- 舞台與對話 ----------
  function stopMap() { if (mapCtl) { mapCtl.destroy(); mapCtl = null; } }
  function stageScreen(g, label) {
    stopMap();
    cur = g;
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">' + esc(label) + '</span><span class="jk-pill jk-soft">Day ' + S.day + "・" + SLOTS[Math.min(S.slot, 2)] + "</span></div>" +
      '<div class="jk-stage" id="jk-stage"><img id="jk-pimg" alt=""><div class="jk-emote" id="jk-emote"></div><div class="jk-fx" id="jk-fx"></div>' +
      '<div class="jk-plate"><b id="jk-who"></b><div class="jk-bar"><i id="jk-affi"></i></div></div></div>' +
      '<div class="jk-dialog" id="jk-dlg" tabindex="0"><div class="jk-dname" id="jk-dname"></div><div class="jk-dtext" id="jk-dtext"></div><div class="jk-dnext" id="jk-dnext">點擊繼續 ▼</div></div>' +
      '<div class="jk-choices" id="jk-choices"></div>';
    setExpr("neutral"); updAff();
  }
  function setExpr(e) {
    if (!cur) return;
    var im = $("#jk-pimg"); if (!im) return;
    im.src = imgSrc(cur, e);
    var em = $("#jk-emote"); em.textContent = D.EMOTE[e] || ""; em.className = "jk-emote" + (D.EMOTE[e] ? " jk-show" : "");
    var st = $("#jk-stage"); st.classList.remove("jk-shake", "jk-bounce"); void st.offsetWidth;
    if (e === "angry" || e === "shock") st.classList.add("jk-shake");
    else if (has(["happy", "love", "wink"], e)) st.classList.add("jk-bounce");
  }
  function updAff() {
    if (!cur || !$("#jk-who")) return;
    $("#jk-who").textContent = SHE + "・" + tier(cur.aff) + "（" + cur.aff + "）";
    $("#jk-affi").style.width = cur.aff + "%";
  }
  function show(who, text, e) { if (e) setExpr(e); $("#jk-dname").textContent = who || ""; $("#jk-dtext").innerHTML = text; $("#jk-choices").innerHTML = ""; }
  function say(who, text, e) {
    return new Promise(function (res) {
      show(who, text, e);
      var n = $("#jk-dnext"); n.style.visibility = "visible";
      var d = $("#jk-dlg");
      var ready = false;
      var h = function () {
        if (busy || !ready) return;
        d.removeEventListener("click", h); pendingSay = null;
        n.style.visibility = "hidden"; res();
      };
      d.addEventListener("click", h);
      pendingSay = h;
      setTimeout(function () { ready = true; }, 180);
    });
  }
  function ask(who, text, e, opts) {
    show(who, text, e);
    $("#jk-dnext").style.visibility = "hidden";
    return new Promise(function (res) {
      var c = $("#jk-choices");
      opts.forEach(function (o) {
        var b = document.createElement("button"); b.type = "button"; b.className = "jk-choice"; b.innerHTML = o.t;
        b.onclick = function () { if (busy) return; c.innerHTML = ""; res(o.v); };
        c.appendChild(b);
      });
    });
  }
  // 鍵盤：Enter／空白鍵推進對話
  document.addEventListener("keydown", function (e) {
    if (!pendingSay || (e.key !== "Enter" && e.key !== " ")) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault(); pendingSay();
  });
  function memo(c, v) { return '<br><span class="jk-memo">📝 新情報｜' + CATS[c].label + "：" + esc(v) + "</span>"; }
  function badE(g) { return V(g).ang ? "angry" : "sad"; }

  // ---------- 題目 ----------
  // old＝情報變更前的舊值（陷阱選項）
  function buildQ(g, c, n) {
    var others = S.girls.filter(function (o) { return o !== g && o.named; });
    var ans, label, q, mix = {}, cands, old = null;
    if (c === "name") {
      ans = g.given; label = "名字"; q = pick(CATS.name.ask);
      others.forEach(function (o) { mix[o.given] = dname(o); });
      cands = shuffle(others.map(function (o) { return o.given; })).slice(0, 2).concat(shuffle(D.GIVEN));
    } else {
      ans = g.facts[c]; label = CATS[c].label; q = pick(CATS[c].ask);
      others.forEach(function (o) { if (has(o.known, c) && o.facts[c] !== ans) mix[o.facts[c]] = dname(o); });
      cands = shuffle(Object.keys(mix)).slice(0, 2).concat(shuffle(poolOf(c)));
      if (g.prev && g.prev[c] && g.prev[c] !== ans) { old = g.prev[c]; cands.unshift(old); delete mix[old]; }
    }
    delete mix[ans];
    var opts = [ans];
    for (var i = 0; i < cands.length && opts.length < n; i++) if (!has(opts, cands[i])) opts.push(cands[i]);
    return { q: q, ans: ans, label: label, mix: mix, old: old, opts: shuffle(opts) };
  }

  // ---------- 插播（電話／訊息） ----------
  function notif(from, title, text, opts, secs) {
    return new Promise(function (res) {
      try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { /* ignore */ }
      var n = document.createElement("div"); n.className = "jk-notif";
      n.innerHTML = '<div class="jk-nh"><img src="' + imgSrc(from, "smile") + '" alt=""><div><b>' + esc(dname(from)) + "</b><small>" + title + '</small></div><span class="jk-ncount">' + secs + '</span></div><div class="jk-nt">' + text + '</div><div class="jk-no"></div><div class="jk-ntimer"><i style="animation-duration:' + secs + 's"></i></div>';
      var box = n.querySelector(".jk-no"), done = false, left = secs, iv = 0;
      var finish = function (v) {
        if (done) return; done = true; clearInterval(iv);
        n.classList.remove("jk-show");
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 350);
        res(v);
      };
      opts.forEach(function (o) { var b = document.createElement("button"); b.type = "button"; b.innerHTML = o.t; b.onclick = function () { finish(o.v); }; box.appendChild(b); });
      root.appendChild(n);
      requestAnimationFrame(function () { requestAnimationFrame(function () { n.classList.add("jk-show"); }); });
      iv = setInterval(function () { left--; n.querySelector(".jk-ncount").textContent = left; if (left <= 0) finish("__timeout"); }, 1000);
    });
  }
  function interrupt(from, mode) {
    busy = true;
    var secs = timerSecs();
    if (mode === "date" && R() < 0.3) {
      var ex = shuffle(D.EXCUSES).slice(0, 2);
      var opts = [{ t: "🚻 藉口去洗手間，偷偷接", v: "wc" }].concat(ex.map(function (e) { return { t: "💬 掛斷，回訊息「" + e + "」", v: "ex:" + e }; })).concat([{ t: "📱 直接當面接起來", v: "pick" }]);
      return notif(from, "📞 來電中…", esc(from.given) + " 打電話來了！", opts, secs).then(function (v) {
        busy = false;
        if (v === "wc") { change(from, 3, "接了電話"); change(cur, -3, "約會中離席"); return say(SHE, "……去好久喔。", "pout"); }
        if (v.indexOf("ex:") === 0) {
          var e = v.slice(3); change(from, -2, "電話被掛斷");
          S.lies.push({ gid: from.id, day: S.day, q: "那天我打給你的時候，你說你在幹嘛？", a: e, opts: [e].concat(shuffle(D.EXCUSES.filter(function (x) { return x !== e; })).slice(0, 2)).concat(["我沒接到電話啊"]), done: false });
          return say(null, "（你回了「" + esc(e) + "」。……這個謊要記住。）");
        }
        if (v === "pick") { change(from, 5, "接了電話"); change(cur, -12, "當面講別人電話"); return say(SHE, "……是誰打來的？", "angry"); }
        change(from, -6, "未接來電");
        return say(null, "（手機震動停了……" + esc(from.given) + " 的未接來電）");
      });
    }
    // 通知的標頭會顯示她的名字（已知時含姓氏）：題目不問已經顯示在畫面上的姓氏／名字
    var askable = from.known.filter(function (c) { return c !== "surname" && c !== "name"; });
    if (!askable.length) { busy = false; return Promise.resolve(); }
    var Q = buildQ(from, pick(askable), 3);
    return notif(from, "💬 新訊息", "「" + esc(V(from).msg) + Q.q + "」", Q.opts.map(function (o) { return { t: esc(o), v: o }; }), secs).then(function (v) {
      busy = false;
      if (v === Q.ans) { change(from, 4, "秒回又答對"); toast(from.given + "：「" + pick(V(from).good) + (R() < 0.5 ? pick(D.PRAISE) : "") + "」"); }
      else if (v === "__timeout") { change(from, -6, "已讀不回"); toast(from.given + "：「……已讀不回？」"); }
      else if (Q.old && v === Q.old) { change(from, -6, "還記著舊的" + Q.label); toast(from.given + "：「那是以前的事了啦……我不是跟你說過了嗎？」"); }
      else { var mx = Q.mix[v]; change(from, mx ? -12 : -8, mx ? "把她跟別人搞混" : "訊息回錯"); toast(from.given + "：「" + pick(mx ? V(from).mix : V(from).bad) + "」"); }
    });
  }

  // ---------- 邂逅 ----------
  // opt：hero（第一位女主角）、fate（命運的邂逅）、station（車站情境）、set（"n" 新女孩／"g" 原本的女孩）
  function encounter(place, opt) {
    opt = opt || {};
    var g = makeGirl({ hero: opt.hero, set: opt.set });
    if (!g) { toast("這座城市好像沒有新的邂逅了……"); return Promise.resolve(false); }
    S.girls.push(g); stageScreen(g, "💫 " + place);
    var meet = opt.station ? pick(D.MEET_STATION) : pick(D.MEET);
    return Promise.resolve()
      .then(function () { if (opt.fate) return say(null, "✨ 命運的邂逅 ✨"); })
      .then(function () { return say(null, "在" + esc(place) + "，" + meet + "。"); })
      .then(function () { return say("???", pick(V(g).first), "surprise"); })
      .then(function () { g.named = true; updAff(); return say(SHE, "我叫" + esc(g.given) + "。", "smile"); })
      .then(function () {
        var rev = reveal(g, R() < 0.6 ? 2 : 1);
        return seq(rev, function (c) { return say(SHE, esc(tellLine(g, c)) + memo(c, g.facts[c]), "smile"); });
      })
      .then(function () {
        if (!g.rel) return;
        var f = byId(g.rel);
        return ask(SHE, "……咦？你是不是認識" + esc(f.given) + "？她是我閨蜜喔，常聽她提到一個人……", "surprise",
          [{ t: "「不認識耶，同名的人吧？」", v: "lie" }, { t: "「嗯，我們是朋友。」", v: "true" }]).then(function (r) {
          if (r === "lie") {
            S.lies.push({ gid: g.id, day: S.day, q: "你說過你認不認識" + f.given + "？", a: "不認識", opts: ["不認識", "是朋友", "只見過一次"], done: false });
            return say(SHE, "這樣啊……世界真小呢。", "think");
          }
          change(f, 2, "你對閨蜜很誠實");
          return say(SHE, "果然！那以後要好好相處喔。", "smile");
        }).then(function () { return say(null, "（" + esc(g.given) + " 和 " + esc(f.given) + " 是閨蜜。對其中一人做的事，另一人也會知道。）"); });
      })
      .then(function () {
        return ask(SHE, "……", "think", shuffle([{ t: "「這一定是命運吧。」", v: "tease" }, { t: "「很高興認識妳！」", v: "agree" }, { t: "「妳沒事吧？有沒有受傷？」", v: "care" }]));
      })
      .then(function (r) {
        if (r === V(g).pref) { change(g, 8, "好印象"); return say(SHE, "……嘿嘿。那，這是我的LINE。", "happy"); }
        change(g, 3, "普通的印象"); return say(SHE, "嗯……那，這是我的LINE。", "smile");
      })
      .then(function () { return say(null, "（" + esc(g.given) + " 加入了你的好友名單）" + (g.fresh ? "<br><small>✨ 她是常在車站出沒的新面孔。</small>" : "")); })
      .then(function () { g.last = S.day; save(); return true; });
  }

  // ---------- 約會中的事件 ----------
  function smallTalk(g) {
    var opts = shuffle(Object.keys(D.REPLY).map(function (k) { return { t: D.REPLY[k], v: k }; }));
    return ask(SHE, esc(pick(R() < 0.5 ? V(g).chat : D.CHAT)), "smile", opts).then(function (r) {
      if (r === V(g).pref) { change(g, 2, "聊得很投機"); return say(SHE, pick(["嘿嘿，就是說嘛。", "……你很懂我耶。", "跟你聊天好輕鬆。"].concat(D.TALK_GOOD)), "happy"); }
      return say(SHE, pick(D.TALK_MID), "neutral");
    });
  }
  function locEvent(g, type) {
    var c = type === "order" ? "food" : "color", known = has(g.known, c), ans = g.facts[c];
    var prompt = type === "order" ? "要幫我點嗎？你知道我想吃什麼吧？" : "你要送我這個？……那，要選哪個顏色的？";
    var opts = shuffle([ans].concat(shuffle(CATS[c].pool.filter(function (x) { return x !== ans; })).slice(0, 3)));
    return ask(SHE, esc(prompt), "think", opts.map(function (o) { return { t: (type === "order" ? "🍽️ " : "🎁 ") + esc(o), v: o }; })).then(function (v) {
      if (v === ans) {
        change(g, known ? 5 : 6, type === "order" ? "點了她的最愛" : "送了喜歡的顏色");
        return say(SHE, known ? pick(V(g).nice) : "咦！你怎麼知道！？我超喜歡這個！", "love");
      }
      if (known) { change(g, -5, type === "order" ? "點錯她的最愛" : "顏色選錯"); return say(SHE, pick(V(g).bad), badE(g)); }
      g.known.push(c);
      return say(SHE, "謝謝……不過其實呀，" + esc(tellLine(g, c)) + memo(c, ans), "smile");
    });
  }
  function shuraba(g, o) {
    return say(null, "……前方人群中，出現了熟悉的身影——是 " + esc(dname(o)) + "！", "neutral").then(function () {
      return ask(null, "怎麼辦？", "surprise", [{ t: "拉著她躲進人群", v: "hide" }, { t: "大方打招呼：「這是我同事」", v: "hi" }, { t: "假裝沒看到，繼續走", v: "ignore" }]);
    }).then(function (v) {
      if (v === "hide") {
        if (R() < 0.6) return say(null, "……好險，沒被發現。");
        change(o, -10, "被撞見約會"); change(g, -5, "行跡可疑"); return say(SHE, "……你在躲誰？", "angry");
      }
      if (v === "hi") {
        change(g, -6, "被說成同事"); change(o, -4, "看到你跟別人");
        S.lies.push({ gid: o.id, day: S.day, q: "那天跟你走在一起的女生，你說是誰？", a: "同事", opts: ["同事", "表妹", "大學同學", "不認識的人"], done: false });
        return say(SHE, "……同事？", "pout");
      }
      if (R() < 0.5) { change(o, -12, "被撞見約會"); toast(o.given + "：「剛剛那個人……是誰？」"); return; }
      return say(null, "……她好像沒看到你們。");
    });
  }
  function hotelEvent(g) {
    var n = SHE;
    return say(n, "……吶，可以聽我說一件事嗎？", "shy").then(function () {
      if (!has(g.known, "secret")) g.known.push("secret");
      return say(n, esc(tellLine(g, "secret")) + memo("secret", g.facts.secret), "fluster");
    }).then(function () {
      return ask(n, "（她不安地看著你）", "worry", [{ t: "「謝謝妳願意告訴我。」", v: 1 }, { t: "輕輕抱住她", v: 2 }, { t: "「我也想更了解妳。」", v: 3 }]);
    }).then(function () { return say(n, "……今晚，可以不要回去嗎？", "love"); })
      .then(function () { return say(null, "（燈光暗了下來——）"); })
      .then(function () { return say(null, "隔天早上，枕邊留著一張字條：「謝謝你。以後也要一直記得我喔。」"); })
      .then(function () { g.hotel = true; g.bond = true; change(g, 10, "特別的一夜"); toast("💞 羈絆成立：她的好感度下降會變慢"); });
  }
  function quiz(g, fresh) {
    var wk = week() - 1;
    var others = active().filter(function (o) { return o !== g && o.named; });
    var cands = g.known.slice(); if (others.length >= 2) cands.push("name");
    var pool = shuffle(cands.filter(function (c) { return !has(fresh, c); })).concat(shuffle(cands.filter(function (c) { return has(fresh, c); })));
    var target = WEEK.qmin[wk] + rnd(WEEK.qmax[wk] - WEEK.qmin[wk] + 1);
    var n = Math.min(target, pool.length);
    pool = pool.slice(0, n);
    if (!n) return Promise.resolve();
    var streak = 0, right = 0, ints = 0;
    return say(SHE, pick(D.QINTRO), "smile").then(function () {
      return seq(pool, function (c, i) {
        return Promise.resolve().then(function () {
          var avail = others.filter(function (o) { return !o.left; });
          if (i > 0 && ints < WEEK.maxint[wk] && avail.length && R() < WEEK.intp[wk]) { ints++; return interrupt(pick(avail), "date"); }
        }).then(function () {
          var Q = buildQ(g, c, 4);
          return ask(SHE, "（" + (i + 1) + "/" + n + "）" + esc(askLine(g, Q.q)), "think", Q.opts.map(function (o) { return { t: esc(o), v: o }; })).then(function (v) {
            if (v === Q.ans) {
              streak++; right++; S.stats.right++;
              change(g, 2 + Math.min(streak, 3), "記得" + Q.label);
              return say(SHE, pick(streak >= 3 ? V(g).nice : V(g).good) + (R() < (streak >= 2 ? 0.7 : 0.4) ? "<br>" + esc(pick(D.PRAISE)) : ""), streak >= 3 ? "love" : "happy");
            }
            streak = 0; S.stats.wrong++;
            if (Q.old && v === Q.old) {
              change(g, -8, "還記著舊的" + Q.label);
              return say(SHE, "……那是以前的事了啦。我明明跟你說過換了。", "pout").then(function () { return say(null, "（她的" + Q.label + "已經改成「" + esc(Q.ans) + "」了）"); });
            }
            if (Q.mix[v]) {
              S.stats.mix++; change(g, -15, "跟別人搞混");
              return say(SHE, pick(V(g).mix), "angry").then(function () {
                return say(null, "（那是 " + esc(Q.mix[v]) + " 的" + Q.label + "……正確答案是「" + esc(Q.ans) + "」）");
              }).then(function () { friendsOf(g).forEach(function (f) { change(f, -4, "閨蜜之間傳開了"); }); });
            }
            change(g, -10, "記錯" + Q.label);
            return say(SHE, pick(V(g).bad), badE(g)).then(function () { return say(null, "（正確答案是「" + esc(Q.ans) + "」）"); });
          });
        });
      });
    }).then(function () {
      if (right === n && n >= 3) {
        change(g, 6, "全部答對");
        return say(SHE, pick(V(g).great), "love").then(function () { return say(null, pick(D.ADMIRE), "love"); })
          .then(function () { friendsOf(g).forEach(function (f) { change(f, 2, "聽閨蜜誇你"); }); });
      }
    });
  }
  function opener(g) {
    var isB = g.facts.birthday === dateOf(S.day), k = g.id + "_" + S.day;
    return ask(null, "（要先說什麼？）", "smile", [{ t: "「今天也很好看喔。」", v: "n" }, { t: "🎂「生日快樂！」", v: "b" }]).then(function (v) {
      if (v === "n") return say(SHE, isB && !S.wished[k] ? "……嗯，謝謝。（她好像在等你說什麼）" : pick(["嘿嘿，謝謝。", "欸……突然這樣說，我會害羞啦！", "你也是喔，今天特別帥。", "真的嗎？那今天的努力就值得了！"]), "smile");
      if (isB) {
        // 修正：原版同一天先傳訊息、再當面祝福會拿兩次大額加分
        if (S.faceWished[k]) return say(SHE, "嘿嘿，你剛剛已經說過了啦～不過聽幾次都開心。", "happy");
        S.faceWished[k] = 1;
        if (S.wished[k]) {
          change(g, 5, "當面再說一次生日快樂");
          return say(SHE, "訊息我收到了……當面聽到，還是好開心。", "shy").then(function () { unlock(g, "生日快樂"); });
        }
        S.wished[k] = 1; change(g, 12, "記得她的生日");
        return say(SHE, "你……記得！？我還以為今天沒人會記得……", "fluster")
          .then(function () { return say(SHE, pick(V(g).great), "love"); })
          .then(function () { return say(null, "（她抱著你準備的小蛋糕，眼眶有點紅）"); })
          .then(function () { unlock(g, "生日快樂"); });
      }
      var who = active().filter(function (o) { return o !== g && o.facts.birthday === dateOf(S.day) && has(o.known, "birthday"); })[0];
      change(g, who ? -10 : -4, who ? "把別人的生日記到她身上" : "記錯生日");
      return say(SHE, who ? pick(V(g).mix) : "……今天不是我生日喔？", who ? "angry" : "think");
    });
  }
  function lieCheck(g) {
    var L = null;
    for (var i = 0; i < S.lies.length; i++) { var l = S.lies[i]; if (l.gid === g.id && !l.done && S.day > l.day) { L = l; break; } }
    if (!L || R() < 0.45) return Promise.resolve();
    L.done = true;
    return ask(SHE, "對了……" + esc(L.q), "think", shuffle(L.opts).map(function (o) { return { t: "「" + esc(o) + "」", v: o }; })).then(function (v) {
      if (v === L.a) return say(SHE, "……嗯，好吧。", "neutral").then(function () { return say(null, "（呼……謊言沒有被拆穿。）"); });
      change(g, -12, "謊話被拆穿");
      return say(SHE, "……你上次不是這樣說的。", "angry").then(function () { friendsOf(g).forEach(function (f) { change(f, -3, "閨蜜說你是騙子"); }); });
    });
  }
  function date(g, loc) {
    stageScreen(g, loc.ic + " " + loc.name);
    S.stats.dates++; g.dates++;
    var fresh = [];
    return say(null, pick(loc.scene).split("{n}").join(SHE))
      .then(function () { return say(SHE, pick(V(g).greet), "smile"); })
      .then(function () { return opener(g); })
      .then(function () { if (loc.id === "hotel" && !g.hotel) return hotelEvent(g).then(function () { unlock(g, "旅館之夜"); }); })
      .then(function () { if (loc.album) unlock(g, loc.album); return lieCheck(g); })
      .then(function () { if (R() < 0.55) return smallTalk(g); })
      .then(function () {
        fresh = reveal(g, week() >= 3 ? 2 : 1);
        return seq(fresh, function (c) { return say(SHE, esc(tellLine(g, c)) + memo(c, g.facts[c]), pick(["smile", "happy", "shy"])); });
      })
      .then(function () { if (!fresh.length) return say(SHE, "能像這樣跟你待在一起，就很開心了。", "shy"); })
      .then(function () { if (loc.ev) return locEvent(g, loc.ev); })
      .then(function () {
        var others = active().filter(function (o) { return o !== g; });
        if (loc.shuraba && others.length && R() < 0.25) return shuraba(g, pick(others));
      })
      .then(function () { return quiz(g, fresh); })
      .then(function () {
        change(g, loc.gain, loc.name + "約會"); g.last = S.day; S.fatigue += (loc.cost || 1);
        return say(SHE, pick(V(g).bye) + (g.aff >= 30 && R() < 0.6 ? "<br>" + esc(pick(D.PRAISE_BYE)) : ""), g.aff >= 60 ? "love" : "smile");
      })
      .then(function () { if (g.aff <= 0) { g.left = true; return say(null, "她頭也不回地走了……", "sad"); } });
  }

  // ---------- 相簿 ----------
  function loadAlbum() { try { return JSON.parse(localStorage.getItem(ALBUM_KEY) || "[]"); } catch (e) { return []; } }
  function unlock(g, title) {
    var a = loadAlbum(), key = g.given + "|" + title;
    if (a.some(function (x) { return x.k === key; })) return;
    a.push({ k: key, t: title, n: dname(g), img: g.img, day: S.day });
    try { localStorage.setItem(ALBUM_KEY, JSON.stringify(a.slice(-240))); } catch (e) { /* ignore */ }
    toast("📷 回憶相簿解鎖：" + g.given + "「" + title + "」");
  }

  // ---------- 畫面 ----------
  function on(id, fn) { var b = $("#" + id); if (b) b.onclick = fn; }
  function renderTitle() {
    stopMap(); cur = null; locked = false;
    var sv = load(), al = loadAlbum().length;
    var pics = [imgUrl({ s: "h" }, "love"), imgUrl({ s: "n", i: 1 }), imgUrl({ s: "g", i: 66 }), imgUrl({ s: "n", i: 22 }), imgUrl({ s: "g", i: 120 })];
    var bd = bestDaily();
    app.innerHTML = '<div class="jk-title-wrap">' +
      '<div class="jk-logo">時間管理大師</div><div class="jk-tagline">記住每一個她的事，一個都不能搞錯。</div>' +
      '<div class="jk-collage">' + pics.map(function (p) { return '<img src="' + p + '" alt="">'; }).join("") + "</div>" +
      (sv && !sv.over ? '<button type="button" class="jk-big jk-alt" id="jk-bCont">繼續（Day ' + sv.day + (sv.daily ? "・每日挑戰" : "") + "）</button>" : "") +
      '<button type="button" class="jk-big" id="jk-bHard">開始新遊戲<small>記憶模式：手帳不記錄情報，全靠你的腦袋</small></button>' +
      '<button type="button" class="jk-big jk-softbtn" id="jk-bEasy">開始新遊戲（輕鬆模式）<small>約會之外可以在手帳翻看已知情報</small></button>' +
      '<button type="button" class="jk-big jk-softbtn" id="jk-bDaily">📅 每日挑戰<small>今天所有玩家遇到同一批女孩' + (bd ? "・今日最佳：" + esc(bd) : "") + "</small></button>" +
      '<button type="button" class="jk-big jk-softbtn" id="jk-bAlbum">📷 回憶相簿<small>已收集 ' + al + " 張</small></button>" +
      '<details class="jk-howto"><summary>怎麼玩</summary><ul>' +
      "<li>每天有白天、傍晚、夜晚三個時段：外出邂逅、約會或休息。溫泉和遊樂園要花兩個時段。</li>" +
      "<li>外出邂逅會打開街道圖：點地面（或方向鍵、WASD）走動，走進店家、碰到路上的女孩（💗）就可能邂逅。每次外出只有 " + WALK_STEPS + " 步。</li>" +
      "<li>車站人潮最多，容易遇見常在車站出沒的 32 位新面孔（✨）。有些店晚上會打烊，夜市只在傍晚以後營業。</li>" +
      "<li>女孩有 32 種個性，說話方式和喜歡的回應都不一樣。所有登場人物皆為成年人。</li>" +
      "<li>約會時會被考 3～5 題，記錯大扣分，跟別人搞混扣更多。對話中只會以「她」稱呼，名字、姓氏、個性都不會顯示在畫面上，要靠自己記住。</li>" +
      "<li>每個女孩有姓氏、生日、個性、食物、飲料、家鄉、喜歡的花、電影類型、特技、夢想等 17 種情報，會在約會中慢慢說給你聽。</li>" +
      "<li>遊戲裡有日曆。記住她的生日，當天約她說「生日快樂」，或從首頁傳訊息祝福。忘記會大扣分。</li>" +
      "<li>電話裡編的藉口、在她面前說的謊都會被記錄，之後她會追問，答案要一致。</li>" +
      "<li>有些女孩是閨蜜，對一個人做的事另一個人也會知道。</li>" +
      "<li>女孩偶爾會換工作、換口味，舊情報會變成陷阱題。</li>" +
      "<li>連續約會會累積疲勞，疲勞高時回訊息的時間變短。</li>" +
      "<li>第 28 天，好感度最高的她會向你告白。</li></ul></details></div>";
    on("jk-bHard", function () { newGame(false); });
    on("jk-bEasy", function () { newGame(true); });
    on("jk-bDaily", function () { newGame(false, true); });
    on("jk-bAlbum", renderAlbum);
    on("jk-bCont", function () { S = normalize(sv); resume(); });
  }
  // 舊存檔補欄位
  function normalize(s) {
    s.faceWished = s.faceWished || {};
    s.wished = s.wished || {}; s.msged = s.msged || {};
    s.lies = s.lies || []; s.today = s.today || [];
    s.girls.forEach(function (g) {
      g.prev = g.prev || {};
      // 舊存檔的女孩補上 2026-11-04 追加的 5 種情報（排在還沒說過的情報後面）
      (D.NEW_INFO || []).forEach(function (c) {
        if (!g.facts[c]) g.facts[c] = pick(CATS[c].pool);
        if (g.order && !has(g.order, c)) g.order.push(c);
      });
    });
    return s;
  }
  function resume() {
    if (S.finale) return finale();
    if (S.slot >= 3) return endDay();   // 修正：原版在夜晚結算畫面重新整理後，「繼續」會多出一個可行動的時段
    renderHub();
  }
  function newGame(easy, daily) {
    var now = new Date();
    S = { easy: easy, day: 1, slot: 0, girls: [], usedImgs: [], today: [], stats: { dates: 0, right: 0, wrong: 0, mix: 0 }, over: false,
      start: [now.getFullYear(), now.getMonth() + 1, now.getDate()], fatigue: 0, lies: [], wished: {}, faceWished: {}, msged: {}, nextId: 1,
      daily: daily ? todayKey() : null, rs: daily ? (+todayKey()) | 0 : 0, pos: MAP ? MAP.HOME.slice() : null, nightLog: null, finale: false };
    encounter("書店", { hero: true }).then(renderHub);
  }
  function cardHTML(g, i) {
    var d = S.day - g.last;
    return '<button type="button" class="jk-card ' + (g.left ? "jk-left" : "") + '" data-i="' + i + '"><img src="' + imgSrc(g, "smile") + '" alt="">' +
      (!g.left && d >= 2 ? '<span class="jk-warn">' + d + " 天沒見</span>" : "") + (g.bond ? '<span class="jk-bond">💞</span>' : "") + (g.fresh ? '<span class="jk-new">✨</span>' : "") +
      '<div class="jk-nm">' + esc(dname(g)) + '</div><div class="jk-tr">' + (g.left ? "已離開" : tier(g.aff) + "・" + g.aff) + "</div>" +
      (g.left ? "" : '<div class="jk-bar"><i style="width:' + g.aff + '%"></i></div>') + "</button>";
  }
  function bindCards(fn) {
    Array.prototype.forEach.call(app.querySelectorAll(".jk-card[data-i]"), function (b) { b.onclick = function () { fn(S.girls[+b.getAttribute("data-i")]); }; });
  }
  function renderHub() {
    stopMap(); cur = null; locked = false; save();
    var act = active(), wk = week() - 1;
    var fat = S.fatigue >= 4 ? "😵 很累（回覆時間 -2 秒）" : S.fatigue >= 2 ? "😮‍💨 有點累" : "😊 精神很好";
    app.innerHTML = '<header class="jk-hub-h"><div><div class="jk-ttl">' + dateOf(S.day) + '<span class="jk-muted" style="font-size:14px;font-weight:400">　Day ' + S.day + "/" + MAXDAY + '</span></div><div class="jk-sub">第 ' + (wk + 1) + " 週・" + fat + (S.daily ? "・每日挑戰" : "") + '</div></div><button type="button" class="jk-ghost" id="jk-bNote">📖 手帳</button></header>' +
      '<div class="jk-slots">' + SLOTS.map(function (s, i) { return '<span class="jk-slot ' + (i < S.slot ? "jk-done" : i === S.slot ? "jk-now" : "") + '">' + s + "</span>"; }).join("") + "</div>" +
      '<div class="jk-actions"><button type="button" class="jk-big" id="jk-bMeet">💫 外出邂逅<small>在街道上走走</small></button><button type="button" class="jk-big jk-alt" id="jk-bDate" ' + (act.length ? "" : "disabled") + ">💌 約會</button></div>" +
      '<div class="jk-actions"><button type="button" class="jk-big jk-softbtn" id="jk-bRest">😴 休息</button><button type="button" class="jk-big jk-softbtn" id="jk-bMsg" ' + (act.length ? "" : "disabled") + ">📱 傳祝福</button></div>" +
      '<div class="jk-hint">本週：約會會被問 ' + WEEK.qmin[wk] + (WEEK.qmax[wk] > WEEK.qmin[wk] ? "～" + WEEK.qmax[wk] : "") + " 題，訊息限時 " + timerSecs() + " 秒。今天是 " + dateOf(S.day) + "——有誰生日嗎？</div>" +
      "<h3>女孩們（" + act.length + "）</h3>" +
      '<div class="jk-grid">' + (act.map(function (g) { return cardHTML(g, S.girls.indexOf(g)); }).join("") || '<p class="jk-muted">還沒有人在身邊。出去走走吧。</p>') + "</div>" +
      '<button type="button" class="jk-link" id="jk-bTitle">回到標題</button>';
    on("jk-bNote", renderNote); on("jk-bMeet", renderMeet); on("jk-bDate", renderDatePick); on("jk-bTitle", renderTitle);
    on("jk-bRest", function () { S.fatigue = Math.max(0, S.fatigue - 3); toast("😴 好好休息了一下，疲勞減輕"); nextSlot(1); });
    on("jk-bMsg", renderMsg);
    bindCards(renderLocPick);
  }
  // 外出邂逅：街道圖
  function renderMeet() {
    cur = null;
    if (!MAP) return renderMeetList();
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">💫 在街上走走</span><span class="jk-pill jk-soft">Day ' + S.day + "・" + SLOTS[S.slot] + "</span></div>" +
      '<div id="jk-mapwrap"></div>' +
      '<div class="jk-hint">點地面移動、點店家會走到門口。走進店家、碰到路上的女孩（💗）就可能邂逅；✨ 是常在車站出沒的新面孔。</div>';
    mapCtl = MAP.open($("#jk-mapwrap"), {
      slot: S.slot, steps: WALK_STEPS, pos: S.pos,
      onMove: function (p) { S.pos = p; },
      onEvent: onMapEvent
    });
  }
  function onMapEvent(ev) {
    if (ev.type === "spot") {
      var sp = ev.spot;
      if (sp.open && !has(sp.open, S.slot)) { toast(sp.ic + " " + sp.name + "：這個時間已經打烊了。"); return false; }
      if (R() < (sp.chance || 0.4)) { meetAt(sp.name, !!sp.station, false); return true; }
      toast(sp.ic + " " + sp.quiet);
      return false;
    }
    if (ev.type === "npc") {
      var s2 = ev.spot;
      meetAt(s2 ? s2.name : "街角", !!(s2 && s2.station), ev.npc && ev.npc.fresh);
      return true;
    }
    if (ev.type === "out") {
      stopMap(); toast("🌆 走了好久，天色變了……"); nextSlot(1); return true;
    }
    if (ev.type === "home") {
      stopMap();
      if (ev.moved) { toast("🏠 在街上逛了一圈，什麼也沒發生。"); nextSlot(1); }
      else renderHub();
      return true;
    }
    return false;
  }
  // 車站（或車站附近的 ✨ 女孩）有八成是新女孩；其他地方約一成
  function meetAt(place, station, fresh) {
    if (locked) return;
    locked = true;
    stopMap();
    var set = (station || fresh) ? (R() < 0.8 ? "n" : "g") : (R() < 0.12 ? "n" : "g");
    lastMeet = { place: place, station: station, fresh: !!fresh, set: set };
    encounter(place, { station: station, set: set }).then(function () { nextSlot(1); });
  }
  // 沒有街道圖模組時的後備：原版的三選一地點
  function renderMeetList() {
    var places = shuffle(D.SPOTS.filter(function (s) { return has(s.open, S.slot); })).slice(0, 3);
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">💫 要去哪裡？</span><span class="jk-pill jk-soft">' + SLOTS[S.slot] + "</span></div>" +
      places.map(function (p, i) { return '<button type="button" class="jk-loc" data-i="' + i + '"><span class="jk-ic">' + p.ic + "</span><span><b>" + p.name + "</b><small>也許會遇見誰</small></span></button>"; }).join("") +
      '<button type="button" class="jk-link" id="jk-bBack">返回</button>';
    Array.prototype.forEach.call(app.querySelectorAll(".jk-loc"), function (b) { b.onclick = function () { var p = places[+b.getAttribute("data-i")]; meetAt(p.name, !!p.station, false); }; });
    on("jk-bBack", renderHub);
  }
  function renderDatePick() {
    var act = active();
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">💌 要約誰？</span><span class="jk-pill jk-soft">' + SLOTS[S.slot] + "</span></div>" +
      '<div class="jk-grid">' + act.map(function (g) { return cardHTML(g, S.girls.indexOf(g)); }).join("") + '</div><button type="button" class="jk-link" id="jk-bBack">返回</button>';
    bindCards(renderLocPick);
    on("jk-bBack", renderHub);
  }
  function renderLocPick(g) {
    var evTxt = { order: "🍽️ 要幫她點餐", gift: "🎁 要挑禮物" };
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">跟 ' + esc(dname(g)) + ' 去哪？</span><span class="jk-pill jk-soft">' + SLOTS[S.slot] + "</span></div>" +
      D.LOCS.map(function (l, i) {
        var lock = g.aff < l.need, cost = l.cost || 1, time = !has(l.slots, S.slot) || S.slot + cost > 3;
        var why = lock ? "🔒 好感度 " + l.need + " 解鎖" :
          time ? (S.slot + cost > 3 ? "時間不夠（要花兩個時段）" : "只能在" + l.slots.map(function (s) { return SLOTS[s]; }).join("、") + "去") :
            (l.id === "hotel" && !g.hotel ? "✨ 會發生特別的事" : "好感度 +" + l.gain + (cost > 1 ? "・花兩個時段" : "") + (l.ev ? "・" + evTxt[l.ev] : "") + (l.shuraba ? "・人多小心" : "") + (l.album ? "・📷" : ""));
        return '<button type="button" class="jk-loc" data-i="' + i + '" ' + (lock || time ? "disabled" : "") + '><span class="jk-ic">' + l.ic + "</span><span><b>" + l.name + "</b><small>" + why + "</small></span></button>";
      }).join("") +
      '<button type="button" class="jk-link" id="jk-bBack">返回</button>';
    Array.prototype.forEach.call(app.querySelectorAll(".jk-loc"), function (b) {
      b.onclick = function () {
        if (locked) return; locked = true;   // 防止連點開兩場約會
        var l = D.LOCS[+b.getAttribute("data-i")];
        date(g, l).then(function () { nextSlot(l.cost || 1); });
      };
    });
    on("jk-bBack", renderHub);
  }
  function renderNote() {
    cur = null;
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">📖 手帳</span><span class="jk-pill jk-soft">' + (S.easy ? "輕鬆模式" : "記憶模式") + "</span></div>" +
      S.girls.map(function (g) {
        return '<div class="jk-panel jk-nb" style="' + (g.left ? "opacity:.5" : "") + '"><img src="' + imgSrc(g, "smile") + '" alt=""><div style="flex:1">' +
          "<b>" + esc(dname(g)) + '</b> <span class="jk-muted" style="font-size:13px">' + (g.left ? "已離開" : tier(g.aff) + "・" + g.aff) + (g.bond ? " 💞" : "") + (g.fresh ? " ✨" : "") + "</span>" +
          '<div class="jk-muted" style="font-size:12.5px">Day ' + g.met + " 相遇・約會 " + g.dates + " 次・" + (S.day - g.last) + " 天前見面</div>" +
          (S.easy ? "<ul>" + g.known.map(function (c) { return "<li>" + CATS[c].label + "：" + esc(g.facts[c]) + "</li>"; }).join("") + "</ul>"
            : '<div class="jk-muted" style="font-size:13px;margin-top:4px">已知情報 ' + g.known.length + " 項，內容請自己記住。</div>") +
          "</div></div>";
      }).join("") +
      '<button type="button" class="jk-big jk-softbtn" id="jk-bBack">關上手帳</button>';
    on("jk-bBack", renderHub);
  }
  function nextSlot(n) {
    S.slot += (n || 1);
    if (S.slot >= 3) { S.slot = 3; save(); endDay(); }
    else { save(); renderHub(); }
  }
  function endDay() {
    stopMap(); cur = null; locked = false;
    if (S.nightLog) return renderNight();
    app.innerHTML = '<div class="jk-night"><div class="jk-moon">🌙</div>' + dateOf(S.day) + ' 夜深了……<div class="jk-muted" style="font-size:14px">手機好像響了。</div></div>';
    var act = active();
    var p = Promise.resolve();
    if (act.length) {
      p = wait(900).then(function () { return interrupt(pick(act), "night"); }).then(function () {
        if (week() >= 3 && act.length >= 3) return wait(500).then(function () { return interrupt(pick(active()), "night"); });
      });
    }
    return p.then(function () {
      active().forEach(function (g) {
        if (g.facts.birthday === dateOf(S.day) && has(g.known, "birthday") && !S.wished[g.id + "_" + S.day]) {
          change(g, -15, "忘了她的生日");
          friendsOf(g).forEach(function (f) { change(f, -3, "閨蜜生日被忘記"); });
        }
      });
      var notes = [];
      if (week() >= 2 && R() < 0.35) {
        var cand = active().filter(function (g) { return g.known.some(function (c) { return D.CHANGE[c]; }); });
        if (cand.length) {
          var g = pick(cand), c = pick(g.known.filter(function (k) { return D.CHANGE[k]; }));
          var nv = pick(CATS[c].pool.filter(function (x) { return x !== g.facts[c]; }));
          g.prev[c] = g.facts[c];   // 舊情報留著當陷阱題（原版說明有寫，但沒有實作）
          g.facts[c] = nv;
          notes.push("💬 <b>" + esc(g.given) + "</b>：「" + esc(fill(D.CHANGE[c], nv)) + '」<br><span class="jk-memo">📝 情報更新｜' + CATS[c].label + "：" + esc(nv) + "</span>");
        }
      }
      S.fatigue = Math.max(0, S.fatigue - 2);
      var gone = [];
      active().forEach(function (g2) {
        var d = S.day - g2.last;
        if (d >= 2) { var loss = Math.min(12, (g2.bond ? 1 : 3) + Math.floor(d * 1.5)); change(g2, -loss, d + " 天沒見面"); }
        if (g2.aff <= 0) { g2.left = true; gone.push(g2.given); }
      });
      var sum = {}, order = [];
      S.today.forEach(function (t) {
        if (!sum[t.g]) { sum[t.g] = { d: 0, r: [] }; order.push(t.g); }
        sum[t.g].d += t.d;
        if (t.d) sum[t.g].r.push(t.r + " " + (t.d > 0 ? "+" : "") + t.d);
      });
      // 修正：原版夜晚結算沒有存檔，重新整理會重跑或遺失結算
      S.nightLog = { notes: notes, gone: gone, sum: order.map(function (n) { return [n, sum[n].d, sum[n].r]; }) };
      save();
      renderNight();
    });
  }
  function renderNight() {
    var L = S.nightLog;
    app.innerHTML = '<div class="jk-night" style="padding-top:16px"><div class="jk-moon">🌙</div>' + dateOf(S.day) + " 結束</div>" +
      L.notes.map(function (n) { return '<div class="jk-panel">' + n + "</div>"; }).join("") +
      '<div class="jk-panel">' + (L.sum.length ? L.sum.map(function (r) {
        return '<div class="jk-row"><span><b>' + esc(r[0]) + '</b><br><small class="jk-muted">' + (esc(r[2].join("、")) || "—") + '</small></span><span class="' + (r[1] >= 0 ? "jk-up" : "jk-down") + '">' + (r[1] > 0 ? "+" : "") + r[1] + "</span></div>";
      }).join("") : '<div class="jk-muted">今天很平靜。</div>') + "</div>" +
      L.gone.map(function (n) { return '<div class="jk-panel">💔 <b>' + esc(n) + "</b> 傳來最後一則訊息：「我們……還是算了吧。」</div>"; }).join("") +
      '<button type="button" class="jk-big" id="jk-bNext">' + (S.day >= MAXDAY ? "迎接最後的夜晚" : "迎接 " + dateOf(S.day + 1)) + "</button>";
    on("jk-bNext", function () {
      if (locked) return; locked = true;
      S.today = []; S.nightLog = null;
      if (S.day >= MAXDAY) { S.finale = true; save(); return finale(); }
      if (S.day >= 3 && !active().length) return renderEnding(true);
      S.day++; S.slot = 0; S.pos = MAP ? MAP.HOME.slice() : null; save();
      var wk = week();
      var p = (wk >= 2 && R() < (wk === 2 ? 0.5 : 0.7)) ? encounter(pick(D.SPOTS).name, { fate: true, set: R() < 0.3 ? "n" : "g" }) : Promise.resolve();
      p.then(renderHub);
    });
  }
  function renderEnding(bad, shura) {
    S.over = true; clearSave(); stopMap(); cur = null;
    var act = active(), lovers = act.filter(function (g) { return g.aff >= 80; }).length;
    var rank = bad ? "孤獨的週末" : shura ? (lovers >= 3 ? "修羅場之王" : "逃跑的海王") : lovers >= 5 ? "傳說中的時間管理大師" : lovers >= 3 ? "海王見習生" : lovers >= 1 ? "專情的普通人" : "沒有人記得你";
    var acc = S.stats.right + S.stats.wrong ? Math.round(S.stats.right * 100 / (S.stats.right + S.stats.wrong)) : 0;
    if (S.daily && !bad) {
      var sc = "戀人 " + lovers + "・答對率 " + acc + "%";
      var prev = ""; try { prev = localStorage.getItem(DAILY_PREFIX + S.daily) || ""; } catch (e) { prev = ""; }
      var m = prev.match(/戀人 (\d+)/), pv = m ? +m[1] : -1;
      if (lovers > pv) { try { localStorage.setItem(DAILY_PREFIX + S.daily, sc); } catch (e2) { /* ignore */ } }
    }
    app.innerHTML = '<div class="jk-night" style="padding-top:20px">' + (bad ? "💔" : "🏆") + '<div class="jk-muted" style="font-size:14px">' + (bad ? "所有人都離開了……" : "28 天過去了") + (S.daily ? "・每日挑戰" : "") + "</div></div>" +
      '<div class="jk-rank">' + rank + "</div>" +
      '<div class="jk-panel"><div class="jk-row"><span>戀人以上</span><b>' + lovers + ' 人</b></div><div class="jk-row"><span>認識的女孩</span><b>' + S.girls.length + " 人</b></div>" +
      '<div class="jk-row"><span>約會次數</span><b>' + S.stats.dates + '</b></div><div class="jk-row"><span>答對率</span><b>' + acc + '%</b></div><div class="jk-row"><span>把人搞混</span><b>' + S.stats.mix + " 次</b></div>" +
      '<div class="jk-row"><span>說過的謊</span><b>' + S.lies.length + " 個</b></div></div>" +
      '<div class="jk-grid">' + S.girls.map(function (g, i) { return cardHTML(g, i); }).join("") + "</div>" +
      '<button type="button" class="jk-big" id="jk-bAgain">回到標題</button>';
    Array.prototype.forEach.call(app.querySelectorAll(".jk-card"), function (b) { b.removeAttribute("data-i"); });
    on("jk-bAgain", renderTitle);
  }
  function renderAlbum() {
    var a = loadAlbum();
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">📷 回憶相簿</span><span class="jk-pill jk-soft">' + a.length + " 張</span></div>" +
      (a.length ? '<div class="jk-grid">' + a.slice().reverse().map(function (x) {
        return '<div class="jk-card"><img src="' + imgUrl(x.img, "love") + '" alt=""><div class="jk-nm">' + esc(x.t) + '</div><div class="jk-tr">' + esc(x.n) + "・Day " + x.day + "</div></div>";
      }).join("") + "</div>" : '<div class="jk-panel jk-muted">還沒有回憶。帶她去夜景展望台、夏日祭典、溫泉，或記住她的生日吧。</div>') +
      '<button type="button" class="jk-big jk-softbtn" id="jk-bBack">返回</button>';
    on("jk-bBack", renderTitle);
  }
  function renderMsg() {
    var act = active();
    app.innerHTML = '<div class="jk-topbar"><span class="jk-pill">📱 傳「生日快樂」給誰？</span><span class="jk-pill jk-soft">' + dateOf(S.day) + "</span></div>" +
      '<div class="jk-hint">不花時段。傳錯人會很尷尬。當面說的效果更好。</div>' +
      '<div class="jk-grid" style="margin-top:10px">' + act.map(function (g) { return cardHTML(g, S.girls.indexOf(g)); }).join("") + '</div><button type="button" class="jk-link" id="jk-bBack">返回</button>';
    bindCards(function (g) {
      var k = g.id + "_" + S.day;
      if (S.msged[k]) { toast("今天已經傳過了"); return; }
      S.msged[k] = 1;
      if (g.facts.birthday === dateOf(S.day)) {
        if (!S.wished[k]) { S.wished[k] = 1; change(g, 7, "傳了生日祝福"); toast(g.given + "：「謝謝！你記得耶！」"); }
        else toast(g.given + "：「嘿嘿，剛剛已經聽你說過了～」");
      } else { change(g, -4, "莫名其妙的生日祝福"); toast(g.given + "：「？？今天不是我生日喔……」"); }
      save(); renderHub();
    });
    on("jk-bBack", renderHub);
  }
  function finale() {
    var act = active().sort(function (a, b) { return b.aff - a.aff; });
    var lovers = act.filter(function (g) { return g.aff >= 80; });
    var shura = false, p;
    if (lovers.length >= 3 && R() < 0.5) {
      shura = true;
      var g = lovers[0]; stageScreen(g, "⚡ 最後的夜晚");
      p = say(null, "門鈴響了。打開門——" + lovers.slice(0, 3).map(function (x) { return esc(x.given); }).join("、") + "，同時站在門口。", "shock")
        .then(function () { return say(SHE, "……這是怎麼回事？", "angry"); })
        .then(function () { return say(null, "三個人互看了一眼，然後同時看向你。"); })
        .then(function () { return ask(null, "怎麼辦？", "worry", [{ t: "「我……每一個都是認真的。」", v: 1 }, { t: "轉身逃跑", v: 2 }]); })
        .then(function (v) {
          if (v === 1) return say(null, "……漫長的沉默之後，她們嘆了口氣。「真是拿你沒辦法。」").then(function () { return say(null, "——傳說中的時間管理大師，誕生了。"); });
          lovers.forEach(function (x) { change(x, -30, "臨陣脫逃"); });
          return say(null, "你跑了。身後傳來三個人整齊的聲音：「站住！」");
        });
    } else if (act.length && act[0].aff >= 80) {
      var g2 = act[0]; stageScreen(g2, "💌 最後的夜晚");
      p = say(null, dateOf(S.day) + " 的晚上，" + esc(g2.given) + " 約你出來。")
        .then(function () { return say(SHE, pick(V(g2).greet), "smile"); })
        .then(function () { return say(SHE, "這段時間……你記得我說過的每一件事。", "shy"); })
        .then(function () { return say(SHE, "……我喜歡你。以後，也只看著我好嗎？", "love"); })
        .then(function () { return ask(null, "……", "love", [{ t: "「我也喜歡妳。」", v: 1 }, { t: "（緊緊抱住她）", v: 2 }]); })
        .then(function () { return say(SHE, pick(V(g2).great), "love"); })
        .then(function () { unlock(g2, "告白"); });
    } else p = Promise.resolve();
    p.then(function () { renderEnding(false, shura); });
  }

  // 測試用
  window.PriTestJikan = {
    state: function () { return S; },
    cur: function () { return cur; },
    lastMeet: function () { return lastMeet; },
    save: save,
    render: function () { if (S) resume(); }
  };

  renderTitle();
})();
