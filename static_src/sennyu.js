// 潛入晶片（sennyu）：畫面（標題、選角、VN 對話、每日行動、小遊戲、人物／情報一覽、結局）與本機存檔。
// 規則全部交給 sennyu_core.js；這裡只負責顯示與輸入。
(function () {
  "use strict";

  var D = window.PriTestSennyuData, C = window.PriTestSennyuCore;
  var app = document.getElementById("sn-app");
  if (!D || !C || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-sennyu-save-v1";
  var END_KEY = "pritest-sennyu-endings";
  var TYPE_MS = 22;

  // 圖庫頭像（jikan 的 g_000〜g_142、n_000〜n_031）
  var GALLERY = [];
  (function () {
    var i;
    for (i = 0; i <= 142; i++) GALLERY.push("g_" + ("00" + i).slice(-3) + ".webp");
    for (i = 0; i <= 31; i++) GALLERY.push("n_" + ("00" + i).slice(-3) + ".webp");
  })();

  var st = null;
  var ui = { screen: "title", cands: null, pick: 0, name: "", panel: null, typedKey: null, typing: null, qte: null, inboxRes: null, recorded: false, confirmQuit: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function save() { store(SAVE_KEY, st && !(st.ending && !st.cur) ? st : null); }
  function endingsSeen() { return load(END_KEY) || {}; }

  // ---------------- 頭像 ----------------
  var SILHOUETTE = '<svg viewBox="0 0 100 120" class="sn-sil"><circle cx="50" cy="40" r="22"/><path d="M12 120 Q14 76 50 72 Q86 76 88 120 Z"/></svg>';
  var PHONE = '<svg viewBox="0 0 100 120" class="sn-sil"><rect x="30" y="14" width="40" height="80" rx="8"/><rect x="36" y="24" width="28" height="56" rx="2" class="sn-sil-scr"/><path d="M14 40 Q6 54 14 68 M22 46 Q18 54 22 62 M86 40 Q94 54 86 68 M78 46 Q82 54 78 62" class="sn-sil-wave"/></svg>';
  function portrait(who, cls) {
    cls = "sn-pt " + (cls || "");
    if (who === "me") return '<div class="' + cls + '"><img src="' + IMG + esc(st.hero.img) + '" alt=""></div>';
    var n = D.NPCS[who];
    if (n && n.img) return '<div class="' + cls + '"><img src="' + IMG + n.img + '" alt=""></div>';
    if (n) return '<div class="' + cls + ' sn-pt-sil" style="--sn-c:' + n.color + '">' + (n.phone ? PHONE : SILHOUETTE) + '<b>' + esc(n.name.charAt(0)) + '</b></div>';
    if (who && who.charAt(0) === "?") return '<div class="' + cls + ' sn-pt-sil" style="--sn-c:#6d6f78">' + SILHOUETTE + "<b>？</b></div>";
    return "";
  }
  function speakerName(w) {
    if (w === "me") return st.hero.name;
    if (D.NPCS[w]) return D.NPCS[w].name;
    if (w && w.charAt(0) === "?") return w.slice(1);
    return "";
  }

  // ---------------- 標題 ----------------
  function renderTitle() {
    var saved = load(SAVE_KEY), seen = endingsSeen();
    var h = '<div class="sn-title-screen">';
    h += '<div class="sn-title-mark">VEINOR NANO / CLASSIFIED</div>';
    h += '<h1 class="sn-title">潛入晶片</h1>';
    h += '<p class="sn-sub">代號「夜鶯」——以秘書的身分潛入晶片大廠 VN，在信任與危險之間，一步一步走到最頂樓。</p>';
    h += '<div class="sn-title-btns">';
    if (saved && saved.v === 1) {
      var c = D.CHAPTERS[saved.ch];
      h += '<button class="sn-btn sn-primary" data-act="continue">繼續任務<span>' + esc(saved.hero.name) + "・" + esc(c.n) + "「" + esc(c.title) + "」第 " + saved.day + " 天</span></button>";
    }
    h += '<button class="sn-btn' + (saved ? "" : " sn-primary") + '" data-act="new">新的任務</button>';
    h += "</div>";
    h += '<div class="sn-gallery"><h2>結局收藏 ' + Object.keys(seen).length + " / " + D.ENDING_ORDER.length + "</h2><ul>";
    D.ENDING_ORDER.forEach(function (id) {
      var e = D.ENDINGS[id], got = seen[id];
      h += '<li class="sn-end-' + e.kind + (got ? " sn-got" : "") + '"><span>' + esc(D.KIND_NAME[e.kind]) + "</span>" + (got ? esc(e.title) : "？？？") + "</li>";
    });
    h += "</ul></div>";
    h += '<p class="sn-note">一輪約 1 小時。每一輪能做的事遠少於可做的事——人物的過去、散落的情報、隱藏的真相，需要好幾輪才拼得完整。進度自動存在這台裝置的瀏覽器裡。</p>';
    h += "</div>";
    return h;
  }

  // ---------------- 選角 ----------------
  function newCandidates() {
    ui.cands = C.candidates((Date.now() ^ (Math.random() * 1e9)) | 0, GALLERY);
    ui.pick = 0;
    ui.name = ui.cands[0].name;
  }
  function statBars(stats) {
    return D.STATS.map(function (s) {
      var v = stats[s.id], dots = "";
      for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= v ? "sn-on" : "") + '"></i>';
      return '<div class="sn-stat"><span>' + s.name + "</span><span class=\"sn-dots\">" + dots + "</span></div>";
    }).join("");
  }
  function archOf(id) { return D.ARCHES.filter(function (a) { return a.id === id; })[0]; }
  function renderSelect() {
    var h = '<div class="sn-select"><h2 class="sn-h2">選擇你的偽裝</h2><p class="sn-muted">從檔案裡抽出了五位候選人。每個人的出身不同，擅長的事也不同。</p><div class="sn-cands">';
    ui.cands.forEach(function (c, i) {
      var a = archOf(c.arch);
      h += '<button class="sn-cand' + (i === ui.pick ? " sn-on" : "") + '" data-act="pick" data-i="' + i + '">';
      h += '<div class="sn-cand-img"><img src="' + IMG + c.img + '" alt=""></div>';
      h += '<div class="sn-cand-arch">' + esc(a.name) + "</div>";
      h += "</button>";
    });
    h += "</div>";
    var cur = ui.cands[ui.pick], a = archOf(cur.arch);
    h += '<div class="sn-dossier"><div class="sn-dossier-img"><img src="' + IMG + cur.img + '" alt=""></div><div class="sn-dossier-body">';
    h += '<div class="sn-dossier-arch">' + esc(a.name) + "</div><p class=\"sn-muted\">" + esc(a.desc) + "</p>";
    h += statBars(a.stats);
    h += '<div class="sn-skill"><b>技巧【' + esc(a.skillName) + "】</b>每章一次，" + esc(C.statName(a.skill)) + "判定必定成功</div>";
    h += '<div class="sn-skill"><b>特性</b>' + esc(a.passiveText) + "</div>";
    h += '<label class="sn-label">偽裝身分的名字<input class="sn-input" id="sn-name" maxlength="8" value="' + esc(ui.name) + '"></label>';
    h += "</div></div>";
    h += '<div class="sn-row"><button class="sn-btn" data-act="reroll">重新抽選</button><button class="sn-btn" data-act="title">返回</button><button class="sn-btn sn-primary" data-act="start">開始任務</button></div>';
    h += "</div>";
    return h;
  }

  // ---------------- 遊戲畫面 ----------------
  function meter(label, v, cls) {
    return '<div class="sn-meter ' + cls + '"><span>' + label + '</span><div class="sn-bar"><i style="width:' + v + '%"></i></div><b>' + v + "</b></div>";
  }
  function renderHud() {
    var c = C.chap(st), a = C.arch(st);
    var h = '<div class="sn-hud">';
    h += '<div class="sn-hud-who">' + portrait("me", "sn-pt-xs") + "<div><b>" + esc(st.hero.name) + "</b><span>" + esc(c.rank) + "</span></div></div>";
    h += '<div class="sn-hud-time"><b>' + esc(c.n) + "「" + esc(c.title) + "」</b>";
    if (c.days) h += "<span>第 " + st.day + " / " + c.days + " 天・" + C.slotName(st) + "</span>";
    h += "</div>";
    h += '<div class="sn-hud-meters">' + meter("懷疑", st.susp, "sn-m-susp") + meter("壓力", st.stress, "sn-m-stress");
    var gate = c.gate ? "／" + c.gate : "";
    h += '<div class="sn-meter sn-m-rep"><span>評價</span><b>' + st.rep + gate + "</b></div>";
    h += '<div class="sn-meter sn-m-skill' + (st.skillUsed ? " sn-used" : "") + '" title="每章一次"><span>技巧</span><b>' + esc(a.skillName) + (st.skillUsed ? "（已用）" : "") + "</b></div>";
    h += "</div>";
    h += '<div class="sn-hud-btns"><button class="sn-btn sn-sm" data-act="panel" data-p="people">人物</button><button class="sn-btn sn-sm" data-act="panel" data-p="intel">情報 ' + Object.keys(st.intel).length + "</button><button class=\"sn-btn sn-sm\" data-act=\"panel\" data-p=\"menu\">選單</button></div>";
    h += "</div>";
    return h;
  }

  function stageNpc() {
    var cur = st.cur, line = cur.lines[cur.i];
    if (line && line.w && line.w !== "me" && line.w !== "sys" && line.w !== "act") return line.w;
    for (var i = cur.i; i >= 0; i--) {
      var l = cur.lines[i];
      if (l && l.w && l.w !== "me" && l.w !== "sys" && l.w !== "act") return l.w;
    }
    var r = C.rootScene(st);
    return r && r.npc ? r.npc : null;
  }

  function notesHtml(notes) {
    if (!notes || !notes.length) return "";
    return '<div class="sn-notes">' + notes.map(function (n) { return '<span class="sn-note-chip' + (n.bad ? " sn-bad" : "") + " sn-k-" + n.k + '">' + esc(n.t) + "</span>"; }).join("") + "</div>";
  }

  function lineHtml(line) {
    if (!line) return "";
    var w = line.w, name = speakerName(w), full = esc(line.t);
    var cls = "sn-box";
    if (w === "sys") cls += " sn-box-sys" + (line.roll ? " sn-roll-" + line.roll : "");
    else if (w === "act") cls += " sn-box-act";
    else if (!w) cls += " sn-box-narr";
    var h = '<div class="' + cls + '" data-act="next">';
    if (w === "me") h += portrait("me", "sn-pt-box");
    if (name) h += '<div class="sn-name" style="' + (D.NPCS[w] ? "--sn-c:" + D.NPCS[w].color : "") + '">' + esc(name) + "</div>";
    h += '<div class="sn-text" data-full="' + full + '"></div>';
    h += '<div class="sn-next">▼</div></div>';
    return h;
  }

  function choicesHtml() {
    var s = C.seg(st), list = C.visibleChoices(st, s), a = C.arch(st);
    var h = '<div class="sn-choices">';
    list.forEach(function (v, k) {
      var c = v.c, t = typeof c.t === "function" ? c.t(st) : c.t, info = "", skill = "";
      if (c.check) {
        var ch = C.chance(st, c.check);
        info = '<span class="sn-pct">' + C.statName(ch.stat) + " " + ch.pct + "%</span>";
        if (ch.skill && !v.why) skill = '<button class="sn-skill-btn" data-act="choose" data-i="' + v.i + '" data-skill="1">【' + esc(ch.skill) + "】必定成功</button>";
      }
      var star = c.fav && a.passive === "hint" ? '<span class="sn-fav">★</span>' : "";
      h += '<div class="sn-choice-row"><button class="sn-choice" data-act="choose" data-i="' + v.i + '"' + (v.why ? " disabled" : "") + ">";
      h += '<span class="sn-key">' + (k + 1) + "</span>" + star + '<span class="sn-ct">' + esc(t) + "</span>" + info;
      if (v.why) h += '<span class="sn-why">' + esc(v.why) + "</span>";
      h += "</button>" + skill + "</div>";
    });
    h += "</div>";
    return h;
  }

  function renderScene() {
    var cur = st.cur, line = cur.lines[cur.i], npc = stageNpc(), loc = cur.loc || (C.rootScene(st) || {}).loc || "office";
    var title = (C.rootScene(st) || {}).title || "", place = D.LOCS[loc] || "";
    var h = '<div class="sn-stage sn-bg-' + loc + (cur.phase === "mini" ? " sn-stage-mini" : cur.phase === "choice" ? " sn-choosing" : "") + '">';
    h += '<div class="sn-loc">' + esc(place) + (title && title !== place ? "・" + esc(title) : "") + "</div>";
    if (npc && cur.phase !== "mini") h += '<div class="sn-actor">' + portrait(npc, "sn-pt-stage") + "</div>";
    h += notesHtml(cur.notes);
    if (cur.phase === "choice") {
      h += '<div class="sn-box-wrap sn-dim">' + lineHtml(line).replace('data-act="next"', "") + "</div>" + choicesHtml();
    } else if (cur.phase === "mini") {
      h += "</div>" + renderMini();
      return h;
    } else {
      h += '<div class="sn-box-wrap">' + lineHtml(line) + "</div>";
    }
    h += "</div>";
    return h;
  }

  // ---- 每日行動 ----
  var KIND_ICON = { main: "★", bond: "♥", work: "✉", snoop: "⌕", handler: "☎", rest: "☾" };
  function renderHub() {
    var c = C.chap(st), acts = C.actions(st);
    var h = '<div class="sn-stage sn-bg-' + (st.slot ? "street" : "office") + ' sn-hub-stage">';
    h += '<div class="sn-hub-head"><div class="sn-hub-day">第 ' + st.day + " 天</div><div class=\"sn-hub-slot\">" + C.slotName(st) + "</div>";
    h += '<div class="sn-hub-left">' + (c.days - st.day === 0 ? (st.slot ? "今天是最後一個時段" : "最後一天") : "距離「" + esc(c.finLabel) + "」還有 " + (c.days - st.day) + " 天") + "</div></div>";
    h += "</div>";
    var groups = [["main", "任務"], ["bond", "人物"], ["other", "其他"]];
    h += '<div class="sn-acts">';
    groups.forEach(function (g) {
      var list = acts.filter(function (a) { return g[0] === "other" ? (a.kind !== "main" && a.kind !== "bond") : a.kind === g[0]; });
      if (!list.length) return;
      h += '<div class="sn-act-group"><h3>' + g[1] + "</h3>";
      list.forEach(function (a) {
        var who = a.npc ? portrait(a.npc, "sn-pt-xs") : '<span class="sn-act-icon">' + (KIND_ICON[a.kind] || "・") + "</span>";
        h += '<button class="sn-act sn-act-' + a.kind + '" data-act="do" data-id="' + esc(a.id) + '"' + (a.why ? " disabled" : "") + ">" + who + "<span class=\"sn-act-t\"><b>" + (a.npc ? esc(D.NPCS[a.npc].short) + "：" : "") + esc(a.label) + "</b>";
        if (a.why || a.desc) h += "<small>" + esc(a.why || a.desc) + "</small>";
        h += "</span></button>";
      });
      h += "</div>";
    });
    h += "</div>";
    return h;
  }

  // ---------------- 小遊戲 ----------------
  function renderMini() {
    var m = st.mini;
    if (!m) return "";
    if (m.kind === "inbox") return renderInbox(m);
    if (m.kind === "qte") return renderQte(m.foe, m.need, m.of);
    if (m.kind === "sneak") return renderSneak(m);
    return "";
  }

  function requester(from) { return D.NPCS[from] ? D.NPCS[from].name : (D.REQUESTERS[from] || from); }
  function renderInbox(m) {
    var h = '<div class="sn-mini sn-inbox"><div class="sn-mini-head"><b>處理請求</b><span>第 ' + Math.min(m.i + 1, m.list.length) + " / " + m.list.length + " 件</span><span>剩餘時間 " + m.time + " 小時</span><span>成功 " + m.score + " / 目標 " + m.need + "</span></div>";
    if (ui.inboxRes) {
      var r = ui.inboxRes;
      h += '<div class="sn-inbox-res">';
      if (r.roll) h += '<div class="sn-roll sn-roll-' + (r.roll.ok ? "ok" : "ng") + '">' + C.statName(r.roll.stat) + "判定 " + r.roll.pct + "%：" + (r.roll.ok ? "成功" : "失敗") + "</div>";
      h += "<p>" + esc(r.text) + "</p>" + notesHtml(r.notes);
      h += '<button class="sn-btn sn-primary" data-act="inbox-next">' + (m.done ? "看結果" : "下一件") + "</button></div>";
    } else if (m.done) {
      h += '<div class="sn-inbox-res"><h3>' + (m.win ? "過關：處理成功 " + m.score + " 件" : "沒有過關：處理成功 " + m.score + " 件") + "</h3>";
      if (m.win) h += notesHtml([{ k: "rep", t: "評價 +3" }]);
      h += '<button class="sn-btn sn-primary" data-act="mini-end">繼續</button></div>';
    } else {
      var q = C.inboxQ(st), a = C.arch(st);
      h += '<div class="sn-req">' + (D.NPCS[q.from] ? portrait(q.from, "sn-pt-sm") : '<div class="sn-pt sn-pt-sm sn-pt-dept">' + esc(requester(q.from).charAt(0)) + "</div>") + "<div><div class=\"sn-req-from\">" + esc(requester(q.from)) + "</div><p>" + esc(q.t) + "</p></div></div>";
      h += '<div class="sn-choices sn-inbox-opts">';
      q.opts.forEach(function (o, k) {
        var info = '<span class="sn-cost">' + (o.time ? o.time + " 小時" : "不花時間") + "</span>", skill = "";
        if (o.check) {
          var ch = C.chance(st, o.check);
          info += '<span class="sn-pct">' + C.statName(ch.stat) + " " + ch.pct + "%</span>";
          if (ch.skill && o.time <= m.time) skill = '<button class="sn-skill-btn" data-act="inbox" data-i="' + k + '" data-skill="1">【' + esc(ch.skill) + "】必定成功</button>";
        }
        h += '<div class="sn-choice-row"><button class="sn-choice" data-act="inbox" data-i="' + k + '"' + (o.time > m.time ? " disabled" : "") + '><span class="sn-key">' + (k + 1) + '</span><span class="sn-ct">' + esc(o.label) + "</span>" + info + "</button>" + skill + "</div>";
      });
      h += "</div>";
      if (a.passive === "work") h += '<p class="sn-muted sn-small">審計師：時間 +2、工作壓力減半。</p>';
    }
    h += "</div>";
    return h;
  }

  // QTE：ui.qte = { foe, need, of, round, hits, zone:[a,b], pos, dir, t0, done, win, onEnd }
  function startQte(foe, need, of, speed, onEnd) {
    ui.qte = { foe: foe, need: need, of: of, speed: speed || 1, round: 0, hits: 0, misses: 0, done: false, win: false, onEnd: onEnd, flash: "" };
    newZone();
  }
  function newZone() {
    var q = ui.qte, w = C.qteZone(st);
    var a = 8 + Math.random() * (84 - w);
    q.zone = [a, a + w];
    q.t0 = performance.now();
  }
  function qtePos(q, now) {
    var period = 1300 / q.speed, x = ((now - q.t0) % (period * 2)) / period;
    return x <= 1 ? x * 100 : (2 - x) * 100;
  }
  function renderQte(foe, need, of) {
    if (!ui.qte) {
      var m = st.mini;
      startQte(foe, need, of, m.speed, function (win) { save(); C.miniEnd(st, win); ui.qte = null; afterAction(); });
    }
    var q = ui.qte;
    var h = '<div class="sn-mini sn-qte"><div class="sn-mini-head"><b>擊暈：' + esc(q.foe) + "</b><span>命中 " + q.hits + " / 需要 " + q.need + "</span><span>剩餘 " + (q.of - q.round) + " 次</span></div>";
    h += '<div class="sn-qte-bar"><div class="sn-qte-zone" style="left:' + q.zone[0] + "%;width:" + (q.zone[1] - q.zone[0]) + '%"></div><div class="sn-qte-mark" id="sn-qte-mark"></div></div>';
    h += '<div class="sn-qte-flash">' + esc(q.flash) + "</div>";
    if (q.done) h += '<div class="sn-qte-end ' + (q.win ? "sn-ok" : "sn-ng") + '">' + (q.win ? "制伏成功" : "制伏失敗") + '</div><button class="sn-btn sn-primary" data-act="qte-end">繼續</button>';
    else h += '<button class="sn-btn sn-primary sn-qte-hit" data-act="qte-hit">出手！（空白鍵）</button><p class="sn-muted sn-small">在白色指針進入紅色區域時出手。判定區寬度取決於「身手」。</p>';
    h += "</div>";
    return h;
  }
  function qteHit() {
    var q = ui.qte;
    if (!q || q.done) return;
    var p = qtePos(q, performance.now());
    var hit = p >= q.zone[0] && p <= q.zone[1];
    q.round++;
    if (hit) q.hits++; else q.misses++;
    q.flash = hit ? "命中！" : "落空……";
    if (q.hits >= q.need) { q.done = true; q.win = true; }
    else if (q.of - q.round < q.need - q.hits) { q.done = true; q.win = false; }
    else newZone();
    render();
  }
  var rafOn = false;
  function qteLoop() {
    var el = document.getElementById("sn-qte-mark");
    if (!el || !ui.qte || ui.qte.done) { rafOn = false; return; }
    el.style.left = qtePos(ui.qte, performance.now()) + "%";
    requestAnimationFrame(qteLoop);
  }

  // 潛入地圖
  function renderSneak(m) {
    var map = D.MAPS[m.map], guards = C.activeGuards(st), a = C.arch(st);
    var vis = {}, next = {}, gat = {};
    guards.forEach(function (g) {
      gat[g.x + "," + g.y] = g;
      if (!g.away) C.visionCells(map, g).forEach(function (c) { vis[c[0] + "," + c[1]] = true; });
      if (a.passive === "sight") for (var k = 1; k <= 2; k++) { var p = C.guardAt(map, g.i, m.t + k); next[p.x + "," + p.y] = k; }
    });
    var need = Object.keys(map.targets), got = need.filter(function (k) { return m.got[k]; }).length;
    var h = '<div class="sn-mini sn-sneak"><div class="sn-mini-head"><b>潛入：' + esc(map.name) + "</b><span>目標 " + got + " / " + need.length + "</span><span>剩餘 " + (map.turns - m.t) + " 回合</span></div>";
    h += '<div class="sn-grid" style="grid-template-columns:repeat(' + map.rows[0].length + ',1fr)">';
    map.rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var ch = row.charAt(x), key = x + "," + y, cls = "sn-cell";
        if (ch === "#") cls += " sn-wall";
        else if (ch === "d") cls += " sn-desk";
        else if (ch === "S") cls += " sn-exit";
        if (map.targets[key]) cls += m.got[key] ? " sn-tgot" : " sn-target";
        if (vis[key]) cls += " sn-vis";
        var adj = Math.abs(x - m.pos[0]) + Math.abs(y - m.pos[1]) === 1 && ch !== "#";
        if (adj && !m.done && !m.alert) cls += " sn-adj";
        var inner = "";
        if (gat[key]) { var g = gat[key]; inner = '<span class="sn-guard' + (g.away ? " sn-away" : "") + '" style="--dx:' + g.dx + ";--dy:" + g.dy + '">' + arrow(g.dx, g.dy) + "</span>"; }
        else if (next[key]) inner = '<span class="sn-ghost">' + next[key] + "</span>";
        if (x === m.pos[0] && y === m.pos[1]) inner += '<span class="sn-me">' + portrait("me", "sn-pt-cell") + "</span>";
        else if (ch === "d" && !inner) inner = "<em>桌</em>";
        else if (ch === "S" && !inner) inner = "<em>出口</em>";
        else if (map.targets[key] && !inner) inner = "<em>" + (m.got[key] ? "✔" : "★") + "</em>";
        h += '<div class="' + cls + '"' + (adj ? ' data-act="move" data-dx="' + (x - m.pos[0]) + '" data-dy="' + (y - m.pos[1]) + '"' : "") + ">" + inner + "</div>";
      }
    });
    h += "</div>";
    if (m.msg) h += '<div class="sn-sneak-msg">' + esc(m.msg) + "</div>";
    if (m.done) {
      h += '<div class="sn-qte-end ' + (m.win ? "sn-ok" : "sn-ng") + '">' + (m.win ? "成功撤出" : "任務失敗") + '</div><button class="sn-btn sn-primary" data-act="mini-end">繼續</button>';
    } else if (m.alert) {
      if (ui.qte) {
        h += renderQte();
      } else {
        var bluff = C.chance(st, { s: "guise", dc: m.dc });
        h += '<div class="sn-alert"><b>被發現了！</b><div class="sn-choices">';
        h += '<div class="sn-choice-row"><button class="sn-choice" data-act="sn-stun"' + (m.alert.adj ? "" : " disabled") + '><span class="sn-ct">擊暈警衛</span>' + (m.alert.adj ? '<span class="sn-pct">擊暈小遊戲</span>' : '<span class="sn-why">太遠了，打不到</span>') + "</button></div>";
        h += '<div class="sn-choice-row"><button class="sn-choice" data-act="sn-bluff"><span class="sn-ct">找藉口</span><span class="sn-pct">演技 ' + bluff.pct + "%</span></button>" + (bluff.skill ? '<button class="sn-skill-btn" data-act="sn-bluff" data-skill="1">【' + esc(bluff.skill) + "】必定成功</button>" : "") + "</div>";
        h += "</div></div>";
      }
    } else {
      h += '<div class="sn-pad"><button class="sn-btn" data-act="move" data-dx="0" data-dy="-1">↑</button><div><button class="sn-btn" data-act="move" data-dx="-1" data-dy="0">←</button><button class="sn-btn" data-act="move" data-dx="0" data-dy="0">等待</button><button class="sn-btn" data-act="move" data-dx="1" data-dy="0">→</button></div><button class="sn-btn" data-act="move" data-dx="0" data-dy="1">↓</button></div>';
      h += '<p class="sn-muted sn-small">點相鄰的格子或用方向鍵移動。黃色是警衛的視線（前方 3 格）；躲在「桌」上只有相鄰的警衛看得到。拿到所有 ★ 後回到「出口」。' + (a.passive === "sight" ? "數字是警衛接下來的位置。" : "") + "</p>";
    }
    h += "</div>";
    return h;
  }
  function arrow(dx, dy) { return dx > 0 ? "▶" : dx < 0 ? "◀" : dy > 0 ? "▼" : "▲"; }

  // ---------------- 結局 ----------------
  function renderEnding() {
    var e = D.ENDINGS[st.ending];
    if (!ui.recorded) {
      var seen = endingsSeen();
      seen[st.ending] = seen[st.ending] || new Date().toISOString().slice(0, 10);
      store(END_KEY, seen);
      store(SAVE_KEY, null);
      ui.recorded = true;
    }
    var h = '<div class="sn-ending sn-end-' + e.kind + '"><div class="sn-end-kind">' + esc(D.KIND_NAME[e.kind]) + '</div><h2 class="sn-end-title">' + esc(e.title) + "</h2>";
    h += '<div class="sn-end-hero">' + portrait("me", "sn-pt-md") + "<div><b>" + esc(st.hero.name) + "</b><span>" + esc(C.arch(st).name) + "・" + esc(C.chap(st).n) + "・評價 " + st.rep + "</span></div></div>";
    h += '<div class="sn-end-stats"><span>情報 ' + Object.keys(st.intel).length + " / " + D.INTEL.length + "</span><span>懷疑 " + st.susp + "</span><span>壓力 " + st.stress + "</span><span>行動 " + st.turns + " 次</span></div>";
    h += '<p class="sn-muted">這一輪的內鬼是：<b>' + esc(D.NPCS[st.mole].name) + "</b>" + (st.flags.moleRight ? "（你指認正確）" : "") + "</p>";
    h += '<div class="sn-row"><button class="sn-btn" data-act="panel" data-p="intel">回顧情報</button><button class="sn-btn sn-primary" data-act="title">回到標題</button></div>';
    h += "</div>";
    return h;
  }

  // ---------------- 一覽（人物／情報／選單） ----------------
  function renderPanel() {
    var p = ui.panel, h = '<div class="sn-modal" data-act="close-bg"><div class="sn-modal-box">';
    h += '<button class="sn-x" data-act="close">✕</button>';
    if (p === "people") {
      h += "<h2>人物</h2>";
      Object.keys(D.NPCS).forEach(function (k) {
        if (!st.met[k] && k !== "heron") return;
        var n = D.NPCS[k], t = st.trust[k];
        var next = (D.BONDS[k] || [])[st.bond[k] || 0];
        h += '<div class="sn-person">' + portrait(k, "sn-pt-sm") + '<div class="sn-person-body"><div><b>' + esc(n.name) + "</b> <span class=\"sn-muted\">" + esc(n.role) + "</span>" + (k === st.mole && st.ending ? ' <span class="sn-mole-tag">內鬼</span>' : "") + "</div>";
        if (k !== "heron") h += '<div class="sn-trust"><div class="sn-bar"><i style="width:' + t + '%;background:' + n.color + '"></i></div><span>信任 ' + t + "</span></div>";
        h += '<p class="sn-muted sn-small">' + esc(n.bio) + "</p>";
        if (next) h += '<p class="sn-small">下一段：「' + esc(next.label) + "」（信任 " + next.req + (next.ch > st.ch ? "・" + D.CHAPTERS[next.ch].n + "以後" : "") + "）</p>";
        h += "</div></div>";
      });
    } else if (p === "intel") {
      var nose = C.arch(st).passive === "nose";
      h += "<h2>情報 " + Object.keys(st.intel).length + " / " + D.INTEL.length + "</h2>";
      h += '<p class="sn-muted sn-small">「灰鷺的真相」需要灰鷺類情報 2 條（目前 ' + (C.truthHeron(st) ? "成立" : "未成立") + "）；「零號的真相」需要零號模型類情報 2 條（目前 " + (C.truthModel(st) ? "成立" : "未成立") + "）。</p>";
      D.INTEL_CATS.forEach(function (cat) {
        h += '<h3 class="sn-cat">' + cat.name + "</h3>";
        D.INTEL.filter(function (x) { return x.cat === cat.id; }).forEach(function (it) {
          if (st.intel[it.id]) h += '<div class="sn-intel"><b>' + esc(it.name) + "</b><p>" + esc(C.intelText(st, it.id)) + "</p></div>";
          else h += '<div class="sn-intel sn-locked"><b>？？？</b>' + (nose || st.ending ? '<p class="sn-small">線索：' + esc(it.where) + "</p>" : "") + "</div>";
        });
      });
    } else if (p === "menu") {
      h += "<h2>選單</h2><p class=\"sn-muted\">進度會在每一步自動存檔。</p>";
      h += '<div class="sn-row"><button class="sn-btn" data-act="title">回到標題（保留存檔）</button>';
      h += ui.confirmQuit ? '<button class="sn-btn sn-danger" data-act="abandon">確定放棄這一輪</button>' : '<button class="sn-btn" data-act="abandon-ask">放棄這一輪</button>';
      h += "</div>";
      h += "<h3>能力</h3>" + statBars(st.stats);
      var a = C.arch(st);
      h += '<div class="sn-skill"><b>' + esc(a.name) + "</b>技巧【" + esc(a.skillName) + "】（" + C.statName(a.skill) + "）・" + esc(a.passiveText) + "</div>";
      h += "<h3>紀錄</h3><ul class=\"sn-log\">" + st.log.slice(-12).map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
    }
    h += "</div></div>";
    return h;
  }

  // ---------------- 繪製 ----------------
  function render() {
    var h = "";
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "select") h = renderSelect();
    else if (st && st.ending && !st.cur) h = renderEnding();
    else {
      h = renderHud();
      h += st.cur ? renderScene() : renderHub();
    }
    if (ui.panel && st) h += renderPanel();
    app.innerHTML = '<div class="sn-root">' + h + "</div>";
    startTyping();
    if (ui.qte && !ui.qte.done && !rafOn) { rafOn = true; requestAnimationFrame(qteLoop); }
  }

  // 打字機效果：同一行只打一次
  function startTyping() {
    var el = app.querySelector(".sn-text");
    if (!el) return;
    var full = el.getAttribute("data-full");
    var txt = document.createElement("textarea");
    txt.innerHTML = full;
    full = txt.value;
    var key = st && st.cur ? st.cur.sid + "|" + JSON.stringify(st.cur.path) + "|" + st.cur.i : "";
    if (ui.typedKey === key || st.cur.phase !== "lines") { el.textContent = full; return; }
    ui.typedKey = key;
    if (ui.typing) clearInterval(ui.typing.id);
    var n = 0;
    ui.typing = { el: el, full: full, id: setInterval(function () {
      n += 1;
      if (!el.isConnected || n >= full.length) { finishTyping(); return; }
      el.textContent = full.slice(0, n);
    }, TYPE_MS) };
  }
  function finishTyping() {
    if (!ui.typing) return false;
    clearInterval(ui.typing.id);
    if (ui.typing.el.isConnected) ui.typing.el.textContent = ui.typing.full;
    ui.typing = null;
    return true;
  }

  function afterAction() {
    save();
    render();
    window.scrollTo && app.getBoundingClientRect().top < 0 && app.scrollIntoView({ block: "start" });
  }

  // ---------------- 輸入 ----------------
  function act(a, el) {
    if (a === "new") { newCandidates(); ui.screen = "select"; render(); return; }
    if (a === "continue") { st = load(SAVE_KEY); ui.screen = "game"; ui.recorded = false; ui.typedKey = null; render(); return; }
    if (a === "title") { ui.screen = "title"; ui.panel = null; ui.confirmQuit = false; render(); return; }
    if (a === "pick") { readName(); ui.pick = +el.getAttribute("data-i"); ui.name = ui.cands[ui.pick].name; render(); return; }
    if (a === "reroll") { newCandidates(); render(); return; }
    if (a === "start") {
      readName();
      var c = ui.cands[ui.pick];
      st = C.newGame({ img: c.img, arch: c.arch, name: ui.name, seed: (Date.now() ^ (Math.random() * 1e9)) | 0 });
      ui.screen = "game"; ui.recorded = false; ui.typedKey = null;
      afterAction();
      return;
    }
    if (a === "panel") { ui.panel = el.getAttribute("data-p"); ui.confirmQuit = false; render(); return; }
    if (a === "close") { ui.panel = null; render(); return; }
    if (a === "abandon-ask") { ui.confirmQuit = true; render(); return; }
    if (a === "abandon") { store(SAVE_KEY, null); st = null; ui.panel = null; ui.screen = "title"; render(); return; }
    if (!st) return;
    if (a === "next") {
      if (finishTyping()) return;
      C.advance(st); afterAction(); return;
    }
    if (a === "choose") { C.choose(st, +el.getAttribute("data-i"), el.hasAttribute("data-skill")); afterAction(); return; }
    if (a === "do") { C.doAction(st, el.getAttribute("data-id")); afterAction(); return; }
    if (a === "inbox") { ui.inboxRes = C.inboxPick(st, +el.getAttribute("data-i"), el.hasAttribute("data-skill")); afterAction(); return; }
    if (a === "inbox-next") { ui.inboxRes = null; render(); return; }
    if (a === "mini-end") { var m = st.mini; C.miniEnd(st, !!m.win); ui.inboxRes = null; afterAction(); return; }
    if (a === "qte-hit") { qteHit(); return; }
    if (a === "qte-end") { var q = ui.qte; if (q && q.onEnd) q.onEnd(q.win); return; }
    if (a === "move") { C.sneakMove(st, +el.getAttribute("data-dx"), +el.getAttribute("data-dy")); afterAction(); return; }
    if (a === "sn-stun") {
      startQte("警衛", 2, 3, 1.1, function (win) { ui.qte = null; C.sneakStun(st, win); afterAction(); });
      render(); return;
    }
    if (a === "sn-bluff") { C.sneakBluff(st, el.hasAttribute("data-skill")); afterAction(); return; }
  }
  function readName() { var i = document.getElementById("sn-name"); if (i) ui.name = i.value.trim() || ui.cands[ui.pick].name; }

  app.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el || !app.contains(el) || el.disabled) return;
    var a = el.getAttribute("data-act");
    if (a === "close-bg" && el !== ev.target) return;
    if (a === "close-bg") a = "close";
    act(a, el);
  });

  document.addEventListener("keydown", function (ev) {
    if (ui.screen !== "game" || !st || ui.panel) return;
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    var k = ev.key;
    if (ui.qte && !ui.qte.done && (k === " " || k === "Enter")) { ev.preventDefault(); qteHit(); return; }
    if (st.mini && st.mini.kind === "sneak" && !st.mini.alert && !st.mini.done) {
      var d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], ".": [0, 0] }[k];
      if (d) { ev.preventDefault(); C.sneakMove(st, d[0], d[1]); afterAction(); return; }
    }
    if (st.cur && st.cur.phase === "lines" && (k === " " || k === "Enter")) { ev.preventDefault(); act("next"); return; }
    if (/^[1-9]$/.test(k)) {
      var btns = app.querySelectorAll(".sn-choice:not([disabled])");
      var all = app.querySelectorAll(".sn-choice");
      var b = all[+k - 1];
      if (b && !b.disabled && Array.prototype.indexOf.call(btns, b) >= 0) { ev.preventDefault(); b.click(); }
    }
  });

  window.PriTestSennyu = { state: function () { return st; }, ui: function () { return ui; }, refresh: function () { save(); render(); } };
  render();
})();
