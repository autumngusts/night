// 鐵拳教育：搜打撤模式的畫面（辦公桌／整備、即時潛入、結算、案件筆記）。規則在 fist_raid_core.js，設計見 docs/fist_raid_design.md。
//   fist.js 的入口選了搜打撤就呼叫 PriTestFistRaid.render(app)；按「選擇模式」時呼叫 PriTestFistRaid.onExit()。
//   辦公桌（含跨局的案件）存在 localStorage["pritest-fist-raid"]，潛入中的一局存在 ["pritest-fist-raid-run"]（關掉頁面再回來會接著打）。
//   潛入畫面只建一次 DOM，之後每一影格只更新有變的地方（整個重畫會讓按鈕在按下的瞬間被換掉）。
//   美術在 fist_raid_art.js（地點插圖、學生頭像），台詞模板在 fist_raid_text.js。
(function () {
  "use strict";

  var D = window.PriTestFistData;
  var R = window.PriTestFistRaidData;
  var X = window.PriTestFistRaidText;
  var Art = window.PriTestFistRaidArt;
  var Core = window.PriTestFistRaidCore;
  if (!D || !R || !X || !Art || !Core) return;

  var PROFILE_KEY = "pritest-fist-raid";
  var RUN_KEY = "pritest-fist-raid-run";

  var app = null;
  var view = "hub";            // hub | raid | result
  var prof = loadProfile();
  var run = loadRun();
  var summary = null;
  var hub = { cls: "pe", take: [], confirmReset: false, noteOpen: false };
  var rv = null;               // 潛入畫面的節點與快取
  if (run) view = "raid";      // 潛入到一半關掉頁面：回來直接接著打
  var activeFight = null;

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function L(obj) { if (!obj) return ""; var l = lang(); return obj[l] || obj.zh || ""; }
  function FF() { return window.PriTestFistFight; }
  function sfx(k) { if (FF()) FF().sfx.play(k); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function bar(cur, max, cls) {
    var pct = max > 0 ? Math.max(0, Math.min(100, Math.round(100 * cur / max))) : 0;
    return el("span", { class: "fe-bar " + (cls || "") }, [el("span", { class: "fe-bar-fill", style: "width:" + pct + "%" })]);
  }
  function fill(tpl, params) { return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return params[k] !== undefined ? params[k] : m; }); }

  // ---------------- 存檔 ----------------
  function loadProfile() {
    try { var s = localStorage.getItem(PROFILE_KEY); return Core.loadProfile(s ? JSON.parse(s) : null); } catch (e) { return Core.newProfile(); }
  }
  function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(prof)); } catch (e) { /* 只是記不住 */ } }
  function loadRun() {
    try {
      var s = localStorage.getItem(RUN_KEY);
      var st = s ? JSON.parse(s) : null;
      return st && st.v === 2 && st.phase === "raid" && st.me && st.cs ? st : null;
    } catch (e) { return null; }
  }
  function saveRun() {
    try {
      if (run && run.phase === "raid") {
        var ev = run.events;
        run.events = [];
        localStorage.setItem(RUN_KEY, JSON.stringify(run));
        run.events = ev;
      } else localStorage.removeItem(RUN_KEY);
    } catch (e) { /* 只是記不住 */ }
  }

  // ---------------- 名稱與文本 ----------------
  function itemName(id) { return R.ITEM[id] ? L(R.ITEM[id].name) : id; }
  function itemLabel(id) { return R.ITEM[id] ? R.ITEM[id].icon + " " + itemName(id) : id; }
  function eName(id) { return D.ENEMY[id] ? L(D.ENEMY[id].name) : id; }
  function tileName(id) { return R.TILE[id] ? L(R.TILE[id].name) : id; }
  function zoneName(id) { return R.ZONE[id] ? L(R.ZONE[id].name) : id; }
  function clsName(id) { return L(D.CLASS[id].name); }
  function curCase() { return run ? run.cs : prof.cs; }
  function sName(s, cs) {
    cs = cs || curCase();
    var c = cs && cs.cast[s];
    if (!c) return t("fr_src_diary");
    var list = R.NAMES[lang()] || R.NAMES.zh;
    return list[c.n % list.length];
  }
  function pred(a, vi) { return L(X.PRED[a][vi]); }
  function attrName(a, vi) { return L(R.ATTR[a].names[vi]); }
  function currentBossId() { return prof.ch < D.CHAPTERS.length ? D.CHAPTERS[prof.ch].boss : null; }

  // 對話結構（規則引擎產生）→ 這個語言的句子
  function partText(p) {
    switch (p[0]) {
      case "greet": return L(X.GREET[p[1]][p[2]]);
      case "clue": return fill(L(X.CLUE[p[1]]), { p: pred(p[2], p[3]), place: tileName(p[4]) });
      case "tell": return L(X.TELL[p[1]]);
      case "none": return L(X.NONE[p[1]]);
      case "small": return fill(L(X.SMALL[p[1]]), { place: tileName(p[2]), club: attrName("club", p[3]) });
      case "thanks": return L(X.THANKS[p[1]]);
      case "refuse": return L(X.REFUSE[p[1]]);
      case "confess": return fill(L(X.CONFESS[p[1]]), { p: pred(p[2], p[3]) });
      case "accuse": return L(X.ACCUSE[p[1]][p[2]]);
      case "diary": return fill(L(X.DIARY[p[1]]), { p: pred(p[2], p[3]), place: tileName(p[4]) });
    }
    return "";
  }
  function rumorText(r, i, cs) {
    var list = X.RUMOR[r.k];
    if (!list) return "";
    var tpl = L(list[(i + (r.s || 0)) % list.length]);
    return fill(tpl, { name: r.s !== undefined ? sName(r.s, cs) : "", boss: r.boss ? eName(r.boss) : "", zone: r.zone ? zoneName(r.zone) : "",
      place: r.place ? tileName(r.place) : "", p: r.a ? pred(r.a, r.v) : "" });
  }
  function faceOf(s, size, mood, cs) {
    cs = cs || curCase();
    var c = cs && cs.cast[s];
    return c ? Art.face(c, size, mood || c.mood) : "";
  }

  // ================= 案件筆記（辦公桌與潛入中共用） =================
  var HOW_ICON = { talk: "💬", rescue: "🙏", diary: "📔", confess: "🗣️", rumor: "📰" };
  function notebook(cs, onMark) {
    var box = el("div", { class: "fr-notebook" });
    box.appendChild(el("p", { class: "fe-small fe-muted", text: cs.solved ? t("fr_case_solved") : t("fr_case_hint") }));
    // 線索：依特徵分組
    var notes = el("div", { class: "fr-notes" });
    if (!cs.notes.length) notes.appendChild(el("p", { class: "fe-muted fe-small", text: t("fr_notes_empty") }));
    R.ATTRS.forEach(function (a) {
      var ns = cs.notes.filter(function (n) { return n.a === a.id; });
      if (!ns.length) return;
      var row = el("div", { class: "fr-note-row" }, [el("b", { class: "fr-note-attr", text: L(a.label) })]);
      ns.forEach(function (n) {
        row.appendChild(el("span", { class: "fr-note fr-note-" + n.how, title: t("fr_how_" + n.how) }, [
          (HOW_ICON[n.how] || "") + " " + attrName(n.a, n.v), el("small", { class: "fe-muted", text: "　— " + sName(n.s, cs) })
        ]));
      });
      notes.appendChild(row);
    });
    box.appendChild(notes);
    // 見過的學生
    var met = cs.cast.map(function (c, i) { return i; }).filter(function (i) { return cs.met[i]; });
    box.appendChild(el("h3", { class: "fr-sub", text: t("fr_met", { n: met.length, max: R.CAST }) }));
    if (!met.length) box.appendChild(el("p", { class: "fe-muted fe-small", text: t("fr_met_none") }));
    var grid = el("div", { class: "fr-cast" });
    met.forEach(function (i) {
      var c = cs.cast[i];
      var tags = [];
      if (cs.rescued[i]) tags.push(t("fr_tag_rescued"));
      if (cs.refused[i]) tags.push(t("fr_tag_refused"));
      if (cs.confessed[i]) tags.push(t("fr_tag_confessed"));
      if (cs.broke[i]) tags.push(t("fr_tag_broke"));
      if (cs.solved && c.role === "mm") tags.push(t("fr_tag_mm"));
      var m = cs.marks[i] || "";
      var card = el("div", { class: "fr-card" + (m ? " fr-mark-" + m : "") }, [
        el("div", { class: "fr-card-face", html: faceOf(i, 54, null, cs) }),
        el("div", { class: "fr-card-body" }, [
          el("strong", { text: sName(i, cs) }),
          el("div", { class: "fe-small fe-muted", text: R.ATTRS.map(function (a) { return attrName(a.id, R.ATTR[a.id].vals.indexOf(c[a.id])); }).join("・") }),
          el("div", { class: "fe-small", text: t("fr_match", { n: Core.matchCount(cs, i), max: cs.notes.length }) + (tags.length ? "　" + tags.join("・") : "") }),
          onMark ? el("div", { class: "fr-card-marks" }, [
            el("button", { type: "button", class: "fe-link" + (m === "sus" ? " fe-bad" : ""), text: "❗ " + t("fr_mark_sus"), onclick: function () { onMark(i, m === "sus" ? null : "sus"); } }),
            el("button", { type: "button", class: "fe-link" + (m === "clear" ? " fe-good" : ""), text: "✔ " + t("fr_mark_clear"), onclick: function () { onMark(i, m === "clear" ? null : "clear"); } })
          ]) : null
        ])
      ]);
      grid.appendChild(card);
    });
    box.appendChild(grid);
    return box;
  }

  function rumorList(cs) {
    var ul = el("ul", { class: "fr-rumors" });
    (cs.rumors || []).forEach(function (r, i) { var s = rumorText(r, i, cs); if (s) ul.appendChild(el("li", { text: s })); });
    return ul;
  }

  // ================= 辦公桌 =================
  function renderHub() {
    var wrap = el("div", { class: "fr-hub" });
    wrap.appendChild(el("div", { class: "fe-topbar" }, [
      el("strong", { text: "🗄️ " + t("fr_hub_title") }),
      el("span", { text: "⭐ " + t("fr_rep") + " " + prof.rep }),
      FF() ? el("button", { type: "button", class: "fe-link fe-sfx", title: t("fe_sfx"), text: FF().sfx.on ? "🔊" : "🔇", onclick: function () { FF().sfx.toggle(); render(app); } }) : null,
      el("button", { type: "button", class: "fe-link", text: t("fr_back_modes"), onclick: function () { if (api.onExit) api.onExit(); } })
    ]));

    // 章節進度
    var prog = el("div", { class: "fe-panel fr-progress" });
    var bid = currentBossId();
    if (bid) {
      var ch = D.CHAPTERS[prof.ch];
      var bd = D.ENEMY[bid];
      var wmax = Core.wallOf(bid), wleft = Math.max(0, wmax - (prof.wall[bid] || 0));
      prog.appendChild(el("h2", { text: L(ch.name) }));
      prog.appendChild(el("p", { class: "fe-small", text: L(ch.intro) }));
      prog.appendChild(el("div", { class: "fr-boss-line" }, [
        el("span", { class: "fr-boss-icon", text: bd.icon }),
        el("strong", { text: eName(bid) }),
        el("span", { class: "fe-muted fe-small", text: "📍" + tileName(bd.at) }),
        el("span", { class: "fe-wall", text: "🧱 " + t("fe_wall") + " " + wleft + "/" + wmax }), bar(wleft, wmax, "fe-bar-dark")
      ]));
      prog.appendChild(el("p", { class: "fe-small fe-muted", text: t("fr_goal", { boss: eName(bid), token: itemLabel(R.BOSS_TOKEN[bid]) }) }));
    } else {
      prog.appendChild(el("h2", { text: t("fr_won_title") }));
      prog.appendChild(el("p", { class: "fe-small", text: L(D.CHAPTERS[D.CHAPTERS.length - 1].clear) }));
      prog.appendChild(el("p", { class: "fe-small fe-muted", text: t("fr_won_more") }));
    }
    // 區域
    prog.appendChild(el("div", { class: "fr-zones-line fe-small" }, R.ZONES.map(function (z) {
      var ok = Core.zoneOpen(prof.keys, z.id);
      return el("span", { class: "fr-zone-chip" + (ok ? "" : " fr-locked"), title: ok ? "" : t("fr_zone_need", { key: itemLabel(z.lock) }) }, [(ok ? "" : "🔒 ") + L(z.name)]);
    })));
    prog.appendChild(el("div", { class: "fe-small fe-muted", text: t("fr_stats", prof.stats) }));
    wrap.appendChild(prog);

    // 晨間傳聞＋案件
    var cs = prof.cs;
    var news = el("div", { class: "fe-panel fr-news" });
    news.appendChild(el("h2", { text: "📰 " + t("fr_rumors") }));
    news.appendChild(rumorList(cs));
    var nb = el("details", { class: "fr-case" });
    if (hub.noteOpen) nb.open = true;
    nb.addEventListener("toggle", function () { hub.noteOpen = nb.open; });
    nb.appendChild(el("summary", { text: "📓 " + t("fr_notebook") + "（" + t("fr_notes_n", { n: cs.notes.length }) + (cs.solved ? "・" + t("fr_case_done") : "") + "）" }));
    nb.appendChild(notebook(cs, function (i, m) { Core.mark(prof, i, m); saveProfile(); render(app); }));
    news.appendChild(nb);
    wrap.appendChild(news);

    if (run) {
      wrap.appendChild(el("div", { class: "fe-panel fe-saved" }, [
        el("span", { text: t("fr_run_found", { cls: clsName(run.cls), s: Math.floor(run.t) }) }),
        el("button", { type: "button", class: "fe-primary", text: t("fr_run_continue"), onclick: function () { view = "raid"; render(app); } })
      ]));
    } else wrap.appendChild(renderLoadout());
    wrap.appendChild(renderStash());
    wrap.appendChild(renderUpgrades());
    wrap.appendChild(rulesPanel());

    var reset = el("div", { class: "fe-actions fr-reset" });
    if (hub.confirmReset) {
      reset.appendChild(el("span", { class: "fe-bad", text: t("fr_reset_confirm") }));
      reset.appendChild(el("button", { type: "button", class: "fe-link fe-bad", text: t("fe_yes"), onclick: function () {
        prof = Core.newProfile(); run = null; hub.take = []; hub.confirmReset = false; saveProfile(); saveRun(); render(app);
      } }));
      reset.appendChild(el("button", { type: "button", class: "fe-link", text: t("fe_no"), onclick: function () { hub.confirmReset = false; render(app); } }));
    } else reset.appendChild(el("button", { type: "button", class: "fe-link fe-muted", text: t("fr_reset"), onclick: function () { hub.confirmReset = true; render(app); } }));
    wrap.appendChild(reset);
    return wrap;
  }

  function takeUsed() { return hub.take.reduce(function (s, i) { return s + (R.ITEM[prof.stash[i]] ? R.ITEM[prof.stash[i]].size : 0); }, 0); }

  function renderLoadout() {
    var box = el("div", { class: "fe-panel fr-loadout" });
    box.appendChild(el("h2", { text: t("fr_loadout") }));
    var grid = el("div", { class: "fe-class-grid" });
    D.CLASSES.forEach(function (c) {
      grid.appendChild(el("button", { type: "button", class: "fe-class-btn" + (hub.cls === c.id ? " fe-on" : ""), style: "--fe-c:" + c.color,
        onclick: function () { hub.cls = c.id; render(app); } }, [el("span", { class: "fe-class-icon", text: c.icon }), el("span", { text: L(c.name) })]));
    });
    box.appendChild(grid);
    var c = D.CLASS[hub.cls];
    var hp = c.hp + prof.up.hp * 2;
    box.appendChild(el("div", { class: "fe-class-info", style: "--fe-c:" + c.color }, [
      el("div", { class: "fe-class-head" }, [el("span", { class: "fe-class-icon", text: c.icon }), el("strong", { text: L(c.name) }),
        el("span", { class: "fe-muted fe-small", text: t("fe_stats", { hp: hp, pow: c.pow, talk: c.talk, sense: c.sense }) })]),
      el("div", { class: "fe-small", text: L(c.desc) }),
      el("div", { class: "fe-small" }, [el("b", { text: t("fe_skill") + "「" + L(c.skill.name) + "」" }), " " + t("fr_skill_" + c.skill.id, { cd: R.SKILL_CD })]),
      el("div", { class: "fe-small" }, [el("b", { text: t("fe_ult") + "「" + L(c.ult.name) + "」" }), " " + (D.FIGHT_ULTS[c.ult.id] ? L(c.ult.desc) : t("fr_ult_" + c.ult.id))])
    ]));
    var max = Core.bagMax(prof);
    box.appendChild(el("div", { class: "fe-small fr-bag-head", text: t("fr_take", { n: takeUsed(), max: max }) }));
    var takeRow = el("div", { class: "fr-chips" });
    if (!hub.take.length) takeRow.appendChild(el("span", { class: "fe-muted fe-small", text: t("fr_take_none") }));
    hub.take.forEach(function (i) {
      takeRow.appendChild(el("button", { type: "button", class: "fr-chip fr-chip-on", title: t("fr_take_remove"), onclick: function () { hub.take = hub.take.filter(function (x) { return x !== i; }); render(app); } }, [itemLabel(prof.stash[i]), " ✕"]));
    });
    box.appendChild(takeRow);
    box.appendChild(el("p", { class: "fe-small fe-muted", text: t("fr_take_hint") }));
    box.appendChild(el("div", { class: "fe-actions" }, [
      el("button", { type: "button", class: "fe-primary fr-go", text: "🌙 " + t("fr_go"), onclick: startRaid })
    ]));
    return box;
  }

  function renderStash() {
    var box = el("div", { class: "fe-panel fr-stash" });
    box.appendChild(el("h2", { text: t("fr_stash", { n: Core.stashUsed(prof), max: R.STASH }) }));
    if (!prof.stash.length) { box.appendChild(el("p", { class: "fe-muted fe-small", text: t("fr_stash_empty") })); return box; }
    var list = el("div", { class: "fr-stash-list" });
    var evidSum = 0;
    prof.stash.forEach(function (id, i) {
      var it = R.ITEM[id];
      if (it.kind === "evid") evidSum += it.val;
      var taken = hub.take.indexOf(i) >= 0;
      var fits = takeUsed() + it.size <= Core.bagMax(prof);
      list.appendChild(el("div", { class: "fr-stash-item" + (taken ? " fr-taken" : ""), title: L(it.desc) }, [
        el("span", { class: "fr-item-name", text: itemLabel(id) + (it.size > 1 ? " ▢▢" : "") }),
        it.kind === "evid" ? el("span", { class: "fe-muted fe-small", text: t("fr_val", { n: it.val }) }) : null,
        !run ? el("button", { type: "button", class: "fe-act fr-mini", disabled: taken || !fits ? true : null, text: t("fr_bring"),
          onclick: function () { hub.take.push(i); render(app); } }) : null,
        it.kind === "evid" ? el("button", { type: "button", class: "fe-act fr-mini", disabled: taken ? true : null, text: t("fr_submit", { n: it.val }),
          onclick: function () { Core.submit(prof, i); hub.take = []; saveProfile(); sfx("rescue"); render(app); } }) : null,
        el("button", { type: "button", class: "fe-link fe-muted", disabled: taken ? true : null, title: t("fr_discard"), text: "🗑",
          onclick: function () { Core.discard(prof, i); hub.take = []; saveProfile(); render(app); } })
      ]));
    });
    box.appendChild(list);
    if (evidSum) box.appendChild(el("div", { class: "fe-actions" }, [
      el("button", { type: "button", class: "fe-act", text: t("fr_submit_all", { n: evidSum }), onclick: function () {
        for (var i = prof.stash.length - 1; i >= 0; i--) if (R.ITEM[prof.stash[i]].kind === "evid") Core.submit(prof, i);
        hub.take = []; saveProfile(); sfx("rescue"); render(app);
      } }),
      el("span", { class: "fe-muted fe-small", text: t("fr_submit_hint") })
    ]));
    return box;
  }

  function renderUpgrades() {
    var box = el("div", { class: "fe-panel fr-ups" });
    box.appendChild(el("h2", { text: t("fr_ups") }));
    var grid = el("div", { class: "fr-up-grid" });
    R.UPGRADES.forEach(function (u) {
      var lv = prof.up[u.id], max = u.costs.length, cost = u.costs[lv];
      grid.appendChild(el("div", { class: "fr-up" }, [
        el("div", {}, [el("strong", { text: u.icon + " " + L(u.name) }), el("span", { class: "fe-muted fe-small", text: " Lv " + lv + "/" + max })]),
        el("div", { class: "fe-small", text: L(u.desc) }),
        lv < max ? el("button", { type: "button", class: "fe-act", disabled: prof.rep < cost ? true : null, text: t("fr_buy", { n: cost }),
          onclick: function () { if (!Core.buy(prof, u.id)) { saveProfile(); sfx("ko"); render(app); } } }) : el("span", { class: "fe-good fe-small", text: t("fr_up_max") })
      ]));
    });
    box.appendChild(grid);
    return box;
  }

  function rulesPanel() {
    var d = el("details", { class: "fe-panel fe-rules" });
    d.appendChild(el("summary", { text: t("fe_rules_title") }));
    var ul = el("ul");
    for (var i = 1; i <= 12; i++) ul.appendChild(el("li", { text: t("fr_rule_" + i, { lock: R.LOCKDOWN_TIME, bag: R.BAG, w: R.MAX_WITNESS, wrong: R.ALERT_WRONG, wall: R.SOLVE_WALL }) }));
    d.appendChild(ul);
    return d;
  }

  function startRaid() {
    if (run) return;
    run = Core.create(prof, { cls: hub.cls, take: hub.take, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0 });
    run.briefing = true;
    hub.take = [];
    saveProfile();
    saveRun();
    view = "raid";
    render(app);
  }

  // ================= 結算 =================
  function renderResult() {
    var s = summary;
    var wrap = el("div", { class: "fe-panel fr-result fr-result-" + s.result });
    wrap.appendChild(el("h2", { text: t("fr_res_" + s.result) }));
    wrap.appendChild(el("p", { text: t("fr_res_" + s.result + "_d") }));
    function list(title, ids, cls) {
      if (!ids.length) return null;
      return el("div", { class: "fr-res-list " + cls }, [el("b", { text: title }), " "].concat(ids.map(function (id) { return el("span", { class: "fr-chip", text: itemLabel(id) }); })));
    }
    var g = list(t("fr_res_gained"), s.gained, "fr-gain");
    if (g) wrap.appendChild(g);
    var l = list(t("fr_res_lost"), s.lost, "fr-lost");
    if (l) wrap.appendChild(l);
    if (s.value) wrap.appendChild(el("p", { class: "fe-small", text: t("fr_res_value", { n: s.value }) }));
    if (s.auto) wrap.appendChild(el("p", { class: "fe-small", text: t("fr_res_auto", { n: s.auto }) }));
    if (s.rep) wrap.appendChild(el("p", { class: "fe-small", text: t("fr_res_rep", { n: s.rep }) }));
    if (s.witnessLost) wrap.appendChild(el("p", { class: "fe-small fe-bad", text: t("fr_res_witness_lost", { n: s.witnessLost }) }));
    if (s.wall) wrap.appendChild(el("p", { class: "fe-small fe-good", text: t("fr_res_wall", { n: s.wall }) }));
    if (s.solved) wrap.appendChild(el("p", { class: "fe-good", text: t("fr_res_solved") }));
    s.keys.forEach(function (k) { wrap.appendChild(el("p", { class: "fe-good fe-small", text: t("fr_res_key", { zone: zoneName(R.ITEM[k].zone) }) })); });
    if (s.ch) {
      var done = D.CHAPTERS[prof.ch - 1];
      wrap.appendChild(el("div", { class: "fr-story" }, [
        el("strong", { text: t("fe_clear_title") + "　" + L(done.name) }),
        el("p", { text: L(done.clear) }),
        prof.ch < D.CHAPTERS.length ? el("p", { class: "fe-small", text: L(D.CHAPTERS[prof.ch].intro) }) : null
      ]));
    }
    if (s.won) wrap.appendChild(el("p", { class: "fe-good", text: t("fr_won_title") }));
    // 給下一局的傳聞
    wrap.appendChild(el("div", { class: "fr-story" }, [el("strong", { text: "📰 " + t("fr_rumors_next") }), rumorList(prof.cs)]));
    wrap.appendChild(el("div", { class: "fe-actions" }, [
      el("button", { type: "button", class: "fe-primary", text: t("fr_back_desk"), onclick: function () { summary = null; view = "hub"; render(app); } })
    ]));
    return wrap;
  }

  function finishRun() {
    summary = Core.settle(prof, run);
    run = null;
    saveProfile();
    saveRun();
    view = "result";
    render(app);
  }

  // ================= 潛入 =================
  function can(a) {
    var copy = JSON.parse(JSON.stringify(run));
    copy.events = [];
    return Core.act(copy, a) === null;
  }
  function send(a) {
    if (!run || activeFight) return;
    var err = Core.act(run, a);
    if (err && rv) { rv.err = t("fr_err_" + err); rv.errT = 2.5; }
    if (rv && a.t !== "move") rv.confirm = null;
    saveRun();
  }
  // 對話框或開局簡報開著時，時間暫停（讓人慢慢看文字）
  function paused() { return !!(run && (run.dialog || run.briefing || (rv && rv.noteOpen))); }

  function buildRaid() {
    rv = { tiles: {}, tokens: {}, panelKey: "", err: "", errT: 0, saveT: 0, endT: 0, confirmQuit: false, ticker: [], zone: Core.tile(run.me.at).zone,
      lastZone: Core.tile(run.me.at).zone, zoneKey: "", confirm: null, noteOpen: false, dlgKey: "" };
    var wrap = el("div", { class: "fr-raid" });

    var hud = el("div", { class: "fr-hud" });
    rv.alert = el("div", { class: "fe-meter fr-alert" }, [el("span", { class: "fr-alert-label" }), el("span", { class: "fe-bar fr-alert-bar" }, [el("span", { class: "fe-bar-fill" })]), el("b")]);
    rv.hp = el("div", { class: "fe-meter fr-hp" }, [el("span", { text: "❤️" }), el("span", { class: "fe-bar" }, [el("span", { class: "fe-bar-fill" })]), el("b")]);
    rv.heat = el("div", { class: "fe-meter fr-heat" }, [el("span", { text: "🔥" }), el("b")]);
    rv.bagInfo = el("div", { class: "fe-meter fr-baginfo" }, [el("span", { text: "🎒" }), el("b")]);
    [rv.alert, rv.hp, rv.heat, rv.bagInfo].forEach(function (n) { hud.appendChild(n); });
    wrap.appendChild(hud);

    rv.goal = el("div", { class: "fr-goal fe-small" });
    wrap.appendChild(rv.goal);

    // 區域分頁
    rv.tabs = el("div", { class: "fr-zone-tabs" });
    wrap.appendChild(rv.tabs);

    // 地圖
    var mapWrap = el("div", { class: "fr-mapwrap" });
    rv.mapWrap = mapWrap;
    rv.grid = el("div", { class: "fr-map" });
    rv.layer = el("div", { class: "fr-tokens", "aria-hidden": "true" });
    mapWrap.appendChild(rv.grid);
    mapWrap.appendChild(rv.layer);
    rv.lockBanner = el("div", { class: "fr-lock-banner" });
    mapWrap.appendChild(rv.lockBanner);
    rv.dialog = el("div", { class: "fr-dialog", role: "dialog" });
    mapWrap.appendChild(rv.dialog);
    wrap.appendChild(mapWrap);
    buildZone();

    rv.act = el("div", { class: "fr-actbar" }, [el("span", { class: "fr-act-label" }), el("span", { class: "fr-act-bar" }, [el("span", { class: "fr-act-fill" })])]);
    wrap.appendChild(rv.act);
    rv.errEl = el("div", { class: "fe-bad fe-small fr-err" });
    wrap.appendChild(rv.errEl);

    rv.panel = el("div", { class: "fe-panel fr-panel" });
    wrap.appendChild(rv.panel);
    rv.tickerEl = el("div", { class: "fr-ticker fe-small" });
    wrap.appendChild(rv.tickerEl);

    rv.note = el("div", { class: "fe-panel fr-note-panel" });
    rv.note.style.display = "none";
    wrap.appendChild(rv.note);

    rv.foot = el("div", { class: "fe-actions fr-foot" });
    wrap.appendChild(rv.foot);
    renderFoot();

    app.appendChild(wrap);
    rv.last = 0;
    rv.raf = requestAnimationFrame(frame);
  }

  // 建這個區域的格子（切換區域時重建）
  function buildZone() {
    var z = R.ZONE[rv.zone];
    rv.grid.innerHTML = "";
    rv.tiles = {};
    Object.keys(rv.tokens).forEach(function (k) { var n = rv.tokens[k].node; if (n.parentNode) n.parentNode.removeChild(n); });
    rv.tokens = {};
    rv.grid.style.gridTemplateColumns = "repeat(" + z.cols + ", minmax(0, 1fr))";
    var cells = [];
    for (var y = 0; y < z.rows; y++) for (var x = 0; x < z.cols; x++) cells.push(R.TILES.filter(function (tt) { return tt.zone === z.id && tt.x === x && tt.y === y; })[0] || null);
    cells.forEach(function (tl) {
      if (!tl) { rv.grid.appendChild(el("div", { class: "fr-void" })); return; }
      var portals = Core.adj(tl.id).filter(function (n) { return Core.tile(n).zone !== tl.zone; });
      var name = el("span", { class: "fr-tile-name", text: tileName(tl.id) });
      var mark = el("span", { class: "fr-tile-mark" });
      var portal = portals.length ? el("span", { class: "fr-portal", text: "⇄ " + portals.map(function (n) { return zoneName(Core.tile(n).zone); }).join("・") }) : null;
      var node = el("button", { type: "button", class: "fr-tile", "data-tile": tl.id, title: tileName(tl.id), style: "background-image:" + Art.tileBg(tl.art) }, [name, mark, portal]);
      node.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        if (paused()) return;
        if (tl.id === run.me.at && !run.me.path.length) return;
        send({ t: "move", to: tl.id });
      });
      rv.grid.appendChild(node);
      rv.tiles[tl.id] = { node: node, mark: mark, cls: "", text: "" };
    });
    rv.zoneKey = "";
  }

  function renderTabs() {
    var me = run.me;
    var b = Core.boss(run);
    var key = rv.zone + "|" + Core.tile(me.at).zone + "|" + run.exits.join(",") + "|" + (b ? b.at : "") + "|" + lang();
    if (key === rv.zoneKey) return;
    rv.zoneKey = key;
    rv.tabs.innerHTML = "";
    R.ZONES.forEach(function (z) {
      var ok = Core.zoneOpen(run.keys, z.id);
      var marks = "";
      if (Core.tile(me.at).zone === z.id) marks += D.CLASS[run.cls].icon;
      if (run.exits.some(function (id) { return Core.tile(id).zone === z.id; })) marks += "🚪";
      if (b && Core.tile(b.at).zone === z.id) marks += D.ENEMY[b.id].icon;
      rv.tabs.appendChild(el("button", { type: "button", class: "fr-zone-tab" + (z.id === rv.zone ? " fe-on" : "") + (ok ? "" : " fr-locked"), "data-zone": z.id,
        disabled: ok ? null : true, title: ok ? "" : t("fr_zone_need", { key: itemLabel(z.lock) }),
        onclick: function () { rv.zone = z.id; buildZone(); } }, [(ok ? "" : "🔒") + L(z.name), marks ? el("span", { class: "fr-tab-marks", text: " " + marks }) : null]));
    });
  }

  function renderFoot() {
    var f = rv.foot;
    f.innerHTML = "";
    f.appendChild(el("button", { type: "button", class: "fe-act fr-note-btn", text: "📓 " + t("fr_notebook") + " [N]", onclick: toggleNote }));
    f.appendChild(el("span", { class: "fe-muted fe-small fr-keys", text: t("fr_keys") }));
    if (FF()) f.appendChild(el("button", { type: "button", class: "fe-link fe-sfx", text: FF().sfx.on ? "🔊" : "🔇", onclick: function () { FF().sfx.toggle(); renderFoot(); } }));
    if (rv.confirmQuit) {
      f.appendChild(el("span", { class: "fe-bad", text: t("fr_quit_confirm") }));
      f.appendChild(el("button", { type: "button", class: "fe-link fe-bad", text: t("fe_yes"), onclick: function () { send({ t: "quit" }); } }));
      f.appendChild(el("button", { type: "button", class: "fe-link", text: t("fe_no"), onclick: function () { rv.confirmQuit = false; renderFoot(); } }));
    } else f.appendChild(el("button", { type: "button", class: "fe-link", text: t("fr_quit"), onclick: function () { rv.confirmQuit = true; renderFoot(); } }));
  }

  function toggleNote() {
    rv.noteOpen = !rv.noteOpen;
    renderNote();
    if (rv.noteOpen) rv.note.scrollIntoView({ block: "nearest" });
  }
  function renderNote() {
    rv.note.style.display = rv.noteOpen ? "" : "none";
    if (!rv.noteOpen) return;
    rv.note.innerHTML = "";
    rv.note.appendChild(el("div", { class: "fe-row" }, [el("strong", { text: "📓 " + t("fr_notebook") }), el("span", { class: "fe-muted fe-small", text: t("fr_paused") }),
      el("button", { type: "button", class: "fe-link", text: "✕", onclick: toggleNote })]));
    rv.note.appendChild(notebook(run.cs, function (i, m) { if (m) run.cs.marks[i] = m; else delete run.cs.marks[i]; saveRun(); renderNote(); }));
  }

  function stopLoop() {
    if (rv && rv.raf) cancelAnimationFrame(rv.raf);
    if (rv) rv.raf = 0;
  }

  function frame(now) {
    if (!rv || !run) return;
    var dt = rv.last ? Math.min(0.1, (now - rv.last) / 1000) : 0;
    rv.last = now;
    if (run.phase === "raid" && !activeFight && !run.fight && !paused()) Core.tick(run, dt);
    var evs = run.events.splice(0);
    evs.forEach(handleEvent);
    if (run.fight && !activeFight && run.phase === "raid") openFight();
    if (run.phase !== "raid") {
      rv.endT += dt;
      if (rv.endT > 1.3) { stopLoop(); finishRun(); return; }
    } else {
      rv.saveT += dt;
      if (rv.saveT > 1) { rv.saveT = 0; saveRun(); }
    }
    if (rv.errT > 0) { rv.errT -= dt; if (rv.errT <= 0) rv.err = ""; }
    // 老師換了區域：地圖跟過去
    var z = Core.tile(run.me.at).zone;
    if (z !== rv.lastZone) { rv.lastZone = z; rv.zone = z; buildZone(); }
    draw();
    rv.raf = requestAnimationFrame(frame);
  }

  // ---------- 每一影格更新 ----------
  function setText(node, s) { if (node.textContent !== s) node.textContent = s; }
  function setWidth(node, pct) { var v = Math.max(0, Math.min(100, pct)).toFixed(1) + "%"; if (node.style.width !== v) node.style.width = v; }
  function alertTier() { return run.lock ? "lock" : run.alert >= R.ALERT_HIGH ? "high" : run.alert >= R.ALERT_WARY ? "wary" : "calm"; }

  function draw() {
    var me = run.me;
    var tier = alertTier();
    setText(rv.alert.firstChild, "👁 " + t("fr_alert_" + tier));
    setWidth(rv.alert.querySelector(".fe-bar-fill"), run.alert);
    setText(rv.alert.lastChild, run.lock ? Math.ceil(run.lock.t) + "s" : Math.floor(run.alert) + "/100");
    rv.alert.className = "fe-meter fr-alert fr-alert-" + tier + (tier === "lock" || tier === "high" ? " fe-warn" : "");
    setWidth(rv.hp.querySelector(".fe-bar-fill"), 100 * me.hp / me.max);
    setText(rv.hp.lastChild, me.hp + "/" + me.max);
    rv.hp.classList.toggle("fe-warn", me.hp <= me.max * 0.3);
    setText(rv.heat.lastChild, "🔥".repeat(me.heat) + "·".repeat(D.MAX_HEAT - me.heat));
    setText(rv.bagInfo.lastChild, Core.used(me.bag) + "/" + me.bagMax + (Core.witnesses(run).length ? "　🧑‍🎓×" + Core.witnesses(run).length : ""));

    var b = Core.boss(run);
    var goal = t("fr_exits", { list: run.exits.map(tileName).join("、") });
    if (b) goal += "　" + D.ENEMY[b.id].icon + " " + eName(b.id) + "（" + tileName(b.at) + "）" + (b.wall > 0 ? " 🧱" + b.wall : " " + t("fe_wall_broken"));
    if (me.bag.some(function (id) { return R.ITEM[id].kind === "token" || R.ITEM[id].kind === "key"; })) goal += "　" + t("fr_token_carry");
    setText(rv.goal, goal);
    setText(rv.lockBanner, run.lock ? t("fr_lock_banner", { n: Math.ceil(run.lock.t), exit: tileName(run.exits[0]) }) : "");
    rv.lockBanner.style.display = run.lock ? "" : "none";

    renderTabs();
    drawTiles();
    drawTokens();
    drawDialog();

    var a = me.act;
    if (a && a.k !== "rest") {
      rv.act.style.visibility = "visible";
      setText(rv.act.firstChild, t("fr_doing_" + a.k));
      setWidth(rv.act.querySelector(".fr-act-fill"), 100 * a.t / a.dur);
    } else if (a) {
      rv.act.style.visibility = "visible";
      setText(rv.act.firstChild, t("fr_doing_rest"));
      setWidth(rv.act.querySelector(".fr-act-fill"), 100 * me.hp / me.max);
    } else if (me.path.length) {
      rv.act.style.visibility = "visible";
      setText(rv.act.firstChild, t("fr_moving", { n: me.path.length, to: tileName(me.path[me.path.length - 1]) }));
      setWidth(rv.act.querySelector(".fr-act-fill"), 100 * me.mv / Core.stepTime(run));
    } else rv.act.style.visibility = "hidden";
    setText(rv.errEl, rv.err || "");

    var key = panelKey();
    if (key !== rv.panelKey) { rv.panelKey = key; renderPanel(); }
  }

  function drawTiles() {
    var me = run.me;
    var dest = me.path.length ? me.path[me.path.length - 1] : null;
    Object.keys(rv.tiles).forEach(function (id) {
      var n = rv.tiles[id];
      var vis = Core.visible(run, id);
      var seen = !!run.seen[id];
      var bs = vis ? Core.bulliesAt(run, id) : [];
      var cls = "fr-tile";
      if (!vis) cls += seen ? " fr-fog" : " fr-unseen";
      if (bs.length) cls += " fr-danger";
      if (id === me.at) cls += " fr-here";
      if (Core.isExit(run, id)) cls += " fr-exit";
      if (id === dest) cls += " fr-dest";
      if (me.path.indexOf(id) >= 0 && id !== dest) cls += " fr-onpath";
      if (cls !== n.cls) { n.node.className = cls; n.cls = cls; }
      var marks = [];
      if (Core.isExit(run, id)) marks.push("🚪");
      var spots = run.spots[id] || [];
      var left = spots.filter(function (s) { return !s.done; }).length;
      if (spots.length && (seen || vis)) marks.push(left ? "🔍" + left : "✓");
      else if (spots.length) marks.push("❔");
      if (run.proof[id]) marks.push("📎");
      if ((run.floor[id] || []).length) marks.push("🎁");
      var s = marks.join(" ");
      if (s !== n.text) { n.mark.textContent = s; n.text = s; }
    });
  }

  function tileCenter(id) {
    var n = rv.tiles[id] && rv.tiles[id].node;
    if (!n) return null;
    return { x: n.offsetLeft + n.offsetWidth / 2, y: n.offsetTop + n.offsetHeight * 0.62, w: n.offsetWidth, h: n.offsetHeight };
  }

  function token(key, html, cls, x, y, title) {
    var tk = rv.tokens[key];
    if (!tk) {
      tk = { node: el("div", { class: "fr-tok" }), html: "", cls: "" };
      rv.layer.appendChild(tk.node);
      rv.tokens[key] = tk;
    }
    tk.seen = true;
    if (tk.html !== html) { tk.node.innerHTML = html; tk.html = html; }
    if (tk.cls !== cls) { tk.node.className = "fr-tok " + cls; tk.cls = cls; }
    if (title && tk.node.title !== title) tk.node.title = title;
    var l = x.toFixed(1) + "px", tp = y.toFixed(1) + "px";
    if (tk.node.style.left !== l) tk.node.style.left = l;
    if (tk.node.style.top !== tp) tk.node.style.top = tp;
    return tk;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function drawTokens() {
    Object.keys(rv.tokens).forEach(function (k) { rv.tokens[k].seen = false; });
    var me = run.me;
    var crowd = {};
    function slot(id) {
      crowd[id] = (crowd[id] || 0) + 1;
      var i = crowd[id] - 1;
      var c = tileCenter(id);
      var col = i % 4, row = Math.floor(i / 4);
      return { x: c.x + (col - 1.5) * c.w * 0.21, y: c.y - row * c.h * 0.32, c: c };
    }
    var c0 = tileCenter(me.at);
    if (c0) {
      var pos = { x: c0.x, y: c0.y };
      if (me.path.length && !run.fight) {
        var c1 = tileCenter(me.path[0]);
        if (c1) {
          var p = Math.min(1, me.mv / Core.stepTime(run));
          pos = { x: c0.x + (c1.x - c0.x) * p, y: c0.y + (c1.y - c0.y) * p };
        }
      }
      var cd = D.CLASS[run.cls];
      var tk = token("me", esc(cd.icon), "fr-tok-me" + (me.act ? " fr-busy" : "") + (me.path.length ? " fr-walk" : ""), pos.x, pos.y + c0.h * 0.06);
      tk.node.style.setProperty("--fe-c", cd.color);
      Core.witnesses(run).forEach(function (v, i) {
        token("w" + v.u, faceOf(v.s, 22, "bright"), "fr-tok-witness", pos.x + (i ? 1 : -1) * c0.w * 0.3, pos.y + c0.h * 0.1, sName(v.s));
      });
    }
    run.bullies.forEach(function (b) {
      if (!rv.tiles[b.at] || (!b.boss && !Core.visible(run, b.at))) return;
      var d = D.ENEMY[b.id];
      var sp = slot(b.at);
      var label = b.boss && b.wall > 0 ? "🧱" + b.wall : String(b.hp);
      var icon = b.mm !== undefined ? faceOf(b.mm, 26, "angry") : esc(d.icon);
      token("b" + b.u, icon + "<small>" + esc(label) + "</small>", "fr-tok-bully" + (b.boss ? " fe-u-boss" : "") + (b.mm !== undefined ? " fr-tok-mm" : "") +
        (b.stun > 0 ? " fr-stunned" : "") + (d.fierce ? " fr-fierce" : ""), sp.x, sp.y - sp.c.h * 0.3, eName(b.id));
    });
    run.victims.forEach(function (v) {
      if (v.follow || !rv.tiles[v.at] || !Core.visible(run, v.at)) return;
      var sp = slot(v.at);
      token("v" + v.u, faceOf(v.s, 24, "shy") + "<small class=\"fr-tear\">💧" + v.hp + "</small>", "fr-tok-victim", sp.x, sp.y - sp.c.h * 0.3, sName(v.s));
    });
    run.students.forEach(function (x) {
      if (!rv.tiles[x.at] || !Core.visible(run, x.at)) return;
      var sp = slot(x.at);
      var m = run.cs.marks[x.s];
      token("s" + x.u, faceOf(x.s, 24), "fr-tok-student" + (m ? " fr-mark-" + m : "") + (run.cs.refused[x.s] ? " fr-tok-refused" : ""), sp.x, sp.y - sp.c.h * 0.3, sName(x.s));
    });
    Object.keys(rv.tokens).forEach(function (k) {
      var tk = rv.tokens[k];
      if (tk.seen) return;
      if (tk.node.parentNode) tk.node.parentNode.removeChild(tk.node);
      delete rv.tokens[k];
    });
  }

  // ---------- 對話框（開局簡報也用它） ----------
  function drawDialog() {
    var d = run.dialog;
    var key = run.briefing ? "brief|" + lang() : d ? JSON.stringify(d) + lang() : "";
    if (key === rv.dlgKey) return;
    rv.dlgKey = key;
    var box = rv.dialog;
    box.innerHTML = "";
    if (!key) { box.style.display = "none"; return; }
    box.style.display = "";
    if (run.briefing) {
      box.appendChild(el("div", { class: "fr-dlg-head" }, [el("strong", { text: "📰 " + t("fr_rumors") })]));
      box.appendChild(rumorList(run.cs));
      box.appendChild(el("p", { class: "fe-small fe-muted", text: t("fr_brief_hint", { exits: run.exits.map(tileName).join("、") }) }));
      box.appendChild(el("button", { type: "button", class: "fe-primary fr-dlg-ok", text: t("fr_brief_go"), onclick: function () { run.briefing = false; saveRun(); } }));
      return;
    }
    var s = d.s;
    var who = s >= 0 ? sName(s) : t("fr_src_diary");
    box.appendChild(el("div", { class: "fr-dlg-head" }, [
      s >= 0 ? el("span", { class: "fr-dlg-face", html: faceOf(s, 64) }) : el("span", { class: "fr-dlg-face fr-dlg-diary", text: "📔" }),
      el("strong", { text: who }),
      s >= 0 && run.cs.cast[s] ? el("span", { class: "fe-small fe-muted", text: R.ATTRS.map(function (a) { return attrName(a.id, R.ATTR[a.id].vals.indexOf(run.cs.cast[s][a.id])); }).join("・") }) : null
    ]));
    var lines = el("div", { class: "fr-dlg-lines" });
    d.parts.forEach(function (p) {
      var txt = partText(p);
      if (!txt) return;
      lines.appendChild(el("p", { class: "fr-dlg-line fr-dlg-" + p[0], text: txt }));
      if (p[0] === "clue" || p[0] === "confess" || p[0] === "diary") lines.appendChild(el("p", { class: "fr-dlg-noted fe-small", text: "📓 " + t("fr_noted", { a: L(R.ATTR[p[2]].label), v: attrName(p[2], p[3]) }) }));
    });
    box.appendChild(lines);
    box.appendChild(el("button", { type: "button", class: "fe-primary fr-dlg-ok", text: t("fr_dialog_ok"), onclick: function () { send({ t: "closeDialog" }); } }));
  }

  // ---------- 行動面板（狀態有變才重建） ----------
  function panelKey() {
    var me = run.me;
    var bs = Core.hereBullies(run).map(function (b) { return b.u + ":" + b.hp + ":" + (b.stun > 0 ? 1 : 0) + ":" + (b.wall || 0); });
    var vs = Core.victimsAt(run, me.at).map(function (v) { return v.u + ":" + v.hp; });
    var ss = Core.studentsAt(run, me.at).map(function (x) { return x.u + ":" + (run.talked[x.s] ? 1 : 0) + ":" + (run.cs.marks[x.s] || ""); });
    var spots = (run.spots[me.at] || []).filter(function (s) { return !s.done; }).length;
    var bb = Core.boss(run);
    return [me.at, bs.join(","), vs.join(","), ss.join(","), spots, (run.floor[me.at] || []).join(","), me.bag.join(","), me.act ? me.act.k : "", me.path.length ? 1 : 0,
      me.cd > 0 ? Math.ceil(me.cd) : 0, me.heat, me.hp >= me.max ? 1 : 0, run.proof[me.at] ? 1 : 0, Core.witnesses(run).length, run.exits.join(","),
      bb ? bb.wall : -1, rv.confirm || "", run.cs.solved ? 1 : 0, lang()].join("|");
  }

  function actBtn(label, a, opts) {
    opts = opts || {};
    var ok = can(a);
    return el("button", { type: "button", class: "fe-act" + (opts.cls ? " " + opts.cls : ""), disabled: ok ? null : true, title: opts.title || null, "data-act": a.t,
      "data-u": a.u || null, onclick: function () { if (opts.onclick) opts.onclick(); else send(a); } }, [label]);
  }

  function renderPanel() {
    var p = rv.panel;
    p.innerHTML = "";
    var me = run.me, tl = Core.here(run);
    var bs = Core.hereBullies(run);
    var vs = Core.victimsAt(run, me.at);
    var ss = Core.studentsAt(run, me.at);
    var cd = D.CLASS[run.cls];
    p.style.setProperty("--fe-c", cd.color);

    p.appendChild(el("div", { class: "fe-row fr-here" }, [el("strong", { text: "📍" + tileName(tl.id) }), el("span", { class: "fe-muted fe-small", text: zoneName(tl.zone) + "・" + t("fr_type_" + tl.type) }),
      Core.isExit(run, tl.id) ? el("span", { class: "fe-good fe-small", text: "🚪 " + t("fr_is_exit") }) : null]));
    bs.forEach(function (b) {
      var d = D.ENEMY[b.id];
      var tags = [];
      if (b.mm !== undefined) tags.push(t("fr_tag_mm"));
      if (d.fierce) tags.push(t("fr_tag_fierce"));
      if (d.coward) tags.push(t("fe_tag_coward"));
      if (d.stubborn) tags.push(t("fe_tag_stubborn"));
      if (b.stun > 0) tags.push(t("fr_tag_stun"));
      p.appendChild(el("div", { class: "fe-small" }, [d.icon + " " + (b.mm !== undefined ? sName(b.mm) : eName(b.id)) + " ",
        b.boss && b.wall > 0 ? el("span", { class: "fe-wall", text: "🧱 " + b.wall + "/" + b.wallMax + " " }) : null,
        bar(b.hp, b.max, "fe-bar-bully"), " " + b.hp + "/" + b.max, el("span", { class: "fe-muted", text: tags.length ? "　" + tags.join("・") : "" })]));
    });
    vs.forEach(function (v) { p.appendChild(el("div", { class: "fe-small fr-person" }, [el("span", { html: faceOf(v.s, 28, "shy") }), " " + t("fe_victim", { name: sName(v.s) }) + " ", bar(v.hp, v.max, "fe-bar-heart"), " " + v.hp + "/" + v.max])); });

    // 學生：交談、指認（指認要再按一次確認）
    ss.forEach(function (x) {
      var c = run.cs.cast[x.s];
      var row = el("div", { class: "fr-person" + (run.cs.marks[x.s] ? " fr-mark-" + run.cs.marks[x.s] : "") }, [
        el("span", { html: faceOf(x.s, 34) }),
        el("span", { class: "fr-person-name" }, [el("strong", { text: sName(x.s) }), el("small", { class: "fe-muted", text: " " + R.ATTRS.map(function (a) { return attrName(a.id, R.ATTR[a.id].vals.indexOf(c[a.id])); }).join("・") })])
      ]);
      row.appendChild(actBtn("💬 " + t("fr_chat") + (run.talked[x.s] ? "✓" : ""), { t: "chat", u: x.u }, { cls: "fr-mini" }));
      if (!run.cs.solved) {
        if (rv.confirm === "acc" + x.u) {
          row.appendChild(el("span", { class: "fe-bad fe-small", text: t("fr_accuse_confirm", { n: R.ALERT_WRONG }) }));
          row.appendChild(actBtn("☝ " + t("fr_accuse_yes"), { t: "accuse", u: x.u }, { cls: "fr-mini fe-act-fist" }));
          row.appendChild(el("button", { type: "button", class: "fe-link", text: t("fe_no"), onclick: function () { rv.confirm = null; rv.panelKey = ""; } }));
        } else {
          var ok = can({ t: "accuse", u: x.u });
          row.appendChild(el("button", { type: "button", class: "fe-act fr-mini", "data-act": "accuse-ask", "data-u": x.u, disabled: ok ? null : true, text: "☝ " + t("fr_accuse"),
            title: run.cs.refused[x.s] ? t("fr_err_refused") : t("fr_accuse_tip"), onclick: function () { rv.confirm = "acc" + x.u; rv.panelKey = ""; } }));
        }
      }
      p.appendChild(row);
    });

    var acts = el("div", { class: "fe-acts fr-acts" });
    var spotsLeft = (run.spots[tl.id] || []).filter(function (s) { return !s.done; }).length;
    if ((run.spots[tl.id] || []).length) acts.appendChild(actBtn("🔍 " + t("fr_search", { n: spotsLeft }) + " [E]", { t: "search" }));
    if (bs.length) {
      acts.appendChild(actBtn("👊 " + t("fr_fight") + " [F]", { t: "fight" }, { cls: "fe-act-fist", title: run.proof[tl.id] ? t("fe_punch_tip") : t("fr_fight_comp") }));
      if (!run.proof[tl.id]) acts.appendChild(actBtn("📷 " + t("fr_photo"), { t: "photo" }, { title: t("fr_photo_tip") }));
      acts.appendChild(actBtn("💬 " + t("fe_talk"), { t: "talk" }, { title: t("fe_talk_tip") }));
    }
    if (Core.safe(tl.id)) acts.appendChild(actBtn("🛌 " + t("fe_rest"), { t: "rest" }, { title: t("fr_rest_tip") }));
    if (Core.isExit(run, tl.id)) acts.appendChild(actBtn("🚪 " + t("fr_extract") + " [X]", { t: "extract" }, { cls: "fr-act-extract" }));
    acts.appendChild(actBtn("✨ " + L(cd.skill.name) + (me.cd > 0 ? "（" + Math.ceil(me.cd) + "s）" : "") + " [Q]", { t: "skill" }, { title: t("fr_skill_" + cd.skill.id, { cd: R.SKILL_CD }) }));
    if (!D.FIGHT_ULTS[cd.ult.id]) acts.appendChild(actBtn("🔥 " + L(cd.ult.name), { t: "ult" }, { cls: "fe-act-ult", title: t("fr_ult_" + cd.ult.id) }));
    if (me.act || me.path.length) acts.appendChild(el("button", { type: "button", class: "fe-act", text: "✋ " + t("fr_stop"), onclick: function () { send({ t: "stop" }); } }));
    p.appendChild(acts);
    if (bs.length && !run.proof[tl.id]) p.appendChild(el("div", { class: "fe-small fe-bad", text: t("fr_fight_comp") }));

    var bb = Core.boss(run);
    var canExpose = bb && Core.walled(bb) && (tl.type === "broadcast" || bb.at === me.at);
    var evid = me.bag.filter(function (id, i) { return R.ITEM[id].kind === "evid" && me.bag.indexOf(id) === i; });
    if (canExpose) {
      var ex = el("div", { class: "fr-expose" }, [el("b", { class: "fe-small", text: "🧱 " + t("fr_expose_head", { n: bb.wall }) + (tl.type === "broadcast" ? t("fr_expose_half") : "") })]);
      if (!evid.length) ex.appendChild(el("span", { class: "fe-muted fe-small", text: " " + t("fr_expose_none") }));
      evid.forEach(function (id) {
        var v = R.ITEM[id].val, n = tl.type === "broadcast" ? Math.max(1, Math.floor(v / 2)) : v;
        ex.appendChild(actBtn(itemLabel(id) + " → 🧱−" + Math.min(n, bb.wall), { t: "expose", i: id }, { cls: "fr-mini" }));
      });
      p.appendChild(ex);
    }

    var fl = run.floor[tl.id] || [];
    if (fl.length) {
      var fr = el("div", { class: "fr-floor" }, [el("b", { class: "fe-small", text: "🎁 " + t("fr_floor") + " " })]);
      fl.forEach(function (id) { fr.appendChild(actBtn(itemLabel(id) + " ↑", { t: "take", i: id }, { cls: "fr-mini", title: L(R.ITEM[id].desc) })); });
      p.appendChild(fr);
    }

    var bag = el("div", { class: "fr-bag" }, [el("b", { class: "fe-small", text: "🎒 " + t("fr_bag", { n: Core.used(me.bag), max: me.bagMax }) + " " })]);
    if (!me.bag.length) bag.appendChild(el("span", { class: "fe-muted fe-small", text: t("fr_bag_empty") }));
    me.bag.forEach(function (id, i) {
      var it = R.ITEM[id];
      var chip = el("span", { class: "fr-chip fr-kind-" + it.kind + (i === 0 && me.pocket ? " fr-pocket" : ""), title: L(it.desc) + (it.kind === "evid" ? "（" + t("fr_val", { n: it.val }) + "）" : "") }, [itemLabel(id) + (it.size > 1 ? " ▢▢" : "")]);
      if (it.kind === "sup") chip.appendChild(el("button", { type: "button", class: "fe-link", disabled: can({ t: "use", i: id }) ? null : true, text: t("fr_use"), onclick: function () { send({ t: "use", i: id }); } }));
      chip.appendChild(el("button", { type: "button", class: "fe-link fe-muted", title: t("fr_drop"), text: "⤓", onclick: function () { send({ t: "drop", i: id }); } }));
      bag.appendChild(chip);
    });
    p.appendChild(bag);
    if (me.pocket) p.appendChild(el("div", { class: "fe-muted fe-small", text: t("fr_pocket_hint") }));
  }

  // ---------- 格鬥 ----------
  function openFight() {
    if (!FF() || activeFight) return;
    var f = run.fight, me = run.me, c = D.CLASS[run.cls];
    var foes = f.us.map(function (u) { return Core.bully(run, u); }).filter(Boolean).map(function (b) {
      var d = D.ENEMY[b.id];
      return { u: b.u, id: b.id, icon: d.icon, name: b.mm !== undefined ? sName(b.mm) + "（" + t("fr_tag_mm") + "）" : eName(b.id), hp: b.hp, max: b.max, atk: d.atk, boss: !!b.boss, wall: b.wall || 0, stun: b.stun > 0 };
    });
    if (!foes.length) { Core.applyFight(run, { hits: [], taken: 0 }); return; }
    activeFight = FF().open({
      teacher: { icon: c.icon, color: c.color, name: clsName(run.cls), pow: me.pow, talk: me.talk, hp: me.hp, max: me.max, heat: me.heat, ult: { id: c.ult.id, name: L(c.ult.name) } },
      foes: foes, place: tileName(me.at) + (f.ambush ? "　" + t("fr_ambush") : ""), proof: f.proof,
      seed: (run.rs ^ Math.imul(Math.floor(run.t * 10) + 1, 2654435761)) | 0,
      onDone: function (r) {
        activeFight = null;
        if (!run) return;
        Core.applyFight(run, r);
        saveRun();
        if (rv) rv.last = 0;
      }
    });
  }

  // ---------- 事件演出 ----------
  var bigLayer = null;
  function showBig(text, sub, cls, color) {
    if (!bigLayer || !bigLayer.parentNode) { bigLayer = el("div", { class: "fe-big-layer", "aria-hidden": "true" }); document.body.appendChild(bigLayer); }
    var main = el("div", { class: "fe-big-main", text: text });
    if (color) main.style.color = color;
    var n = el("div", { class: "fe-big " + cls }, [main, sub ? el("div", { class: "fe-big-sub", text: sub }) : null]);
    bigLayer.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1100);
  }
  function hue() { return "hsl(" + Math.floor(Math.random() * 360) + ", 95%, 60%)"; }
  function floatText(text, cls) {
    var tk = rv && rv.tokens.me;
    if (!tk) return;
    var n = el("div", { class: "fr-float " + (cls || ""), text: text });
    n.style.left = tk.node.style.left;
    n.style.top = tk.node.style.top;
    rv.layer.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1200);
  }

  function logText(e) {
    switch (e.k) {
      case "loot": return t("fr_log_loot", { item: itemLabel(e.i) });
      case "floor": return t("fr_log_floor", { item: itemLabel(e.i) });
      case "empty": return t("fr_log_empty");
      case "proof": return t("fr_log_proof");
      case "talk": return t("fr_log_talk", { e: eName(e.e), d: e.d });
      case "defeat": return e.mm !== null && e.mm !== undefined ? t("fr_log_solved", { name: sName(e.mm) }) : t(e.how === "talk" ? "fr_log_repent" : "fr_log_defeat", { e: eName(e.e) });
      case "rescue": return t("fr_log_rescue", { name: sName(e.s) });
      case "broke": return t("fr_log_broke", { name: sName(e.s) });
      case "full": return t("fr_log_full", { n: R.MAX_WITNESS });
      case "comp": return t("fr_log_comp", { n: R.ALERT_COMP });
      case "lock": return t("fr_log_lock", { exit: tileName(e.exit), n: R.LOCKDOWN_TIME });
      case "expose": return t("fr_log_expose", { n: e.n, left: e.left });
      case "flee": return t("fr_log_flee", { e: eName(e.e) });
      case "chase": return t("fr_log_chase", { e: eName(e.e) });
      case "disturb": return t("fr_log_disturb", { e: eName(e.e) });
      case "use": return t("fr_log_use", { item: itemLabel(e.i) });
      case "skill": return t("fr_log_skill", { name: L(D.CLASS[run.cls].skill.name) });
      case "ult": return t("fr_log_skill", { name: L(D.CLASS[run.cls].ult.name) });
      case "fought": return t("fr_log_fought", { ko: e.ko, hurt: e.taken });
      case "wall": return t("fe_wall_tip");
      case "clue": return t("fr_log_clue", { name: sName(e.s), a: L(R.ATTR[e.a].label), v: attrName(e.a, e.v) });
      case "wrong": return t("fr_log_wrong", { name: sName(e.s), n: R.ALERT_WRONG });
      case "confess": return t("fr_log_confess", { name: sName(e.s) });
      case "reveal": return t("fr_log_reveal", { name: sName(e.s) });
      case "solved": return t("fr_log_solved_wall", { n: e.wall });
    }
    return null;
  }

  function handleEvent(e) {
    var line = logText(e);
    if (line) {
      rv.ticker.unshift(line);
      rv.ticker = rv.ticker.slice(0, 5);
      rv.tickerEl.innerHTML = "";
      rv.ticker.forEach(function (s, i) { rv.tickerEl.appendChild(el("div", { class: i ? "fe-muted" : "", text: s })); });
    }
    var cd = D.CLASS[run.cls];
    switch (e.k) {
      case "step": sfx("step"); break;
      case "loot": floatText("+" + itemLabel(e.i), "fr-float-good"); sfx("block"); if (R.ITEM[e.i].kind === "key") showBig(itemName(e.i) + "!", t("fr_key_hint"), "fe-big-good"); break;
      case "floor": floatText(t("fr_float_full"), "fr-float-bad"); break;
      case "empty": floatText(t("fr_log_empty"), ""); break;
      case "proof": floatText("📎", "fr-float-good"); break;
      case "clue": floatText("📓+1", "fr-float-good"); break;
      case "defeat":
        if (e.boss) { if (FF()) FF().cutIn(cd.icon, cd.color, t("fe_fx_boss_down"), eName(e.e)); }
        else if (e.mm !== null && e.mm !== undefined) { if (FF()) FF().cutIn(cd.icon, cd.color, t("fr_fx_solved"), sName(e.mm)); }
        else if (e.how === "talk") showBig(t("fe_fx_repent"), eName(e.e), "fe-big-good");
        break;
      case "rescue": showBig(t("fe_fx_rescue"), sName(e.s), "fe-big-good"); sfx("rescue"); break;
      case "broke": showBig(t("fr_fx_broke"), sName(e.s), "fe-big-wall"); sfx("lose"); break;
      case "comp": showBig(t("fr_fx_comp"), "👁 +" + R.ALERT_COMP, "fe-big-fist"); sfx("hurt"); break;
      case "wrong": showBig(t("fr_fx_wrong"), "👁 +" + R.ALERT_WRONG, "fe-big-fist"); sfx("lose"); break;
      case "confess": showBig(t("fr_fx_confess"), sName(e.s), "fe-big-good"); sfx("parry"); break;
      case "reveal": showBig(t("fr_fx_reveal"), sName(e.s), "fe-big-boss"); sfx("ult"); break;
      case "lock": showBig(t("fr_fx_lock"), tileName(e.exit), "fe-big-boss"); sfx("lose"); break;
      case "expose": showBig(t("fe_fx_expose"), "🧱 −" + e.n, "fe-big-good"); sfx("wall"); break;
      case "chase": floatText("⚠", "fr-float-bad"); break;
      case "disturb": floatText(t("fr_float_disturb"), "fr-float-bad"); break;
      case "skill": showBig(L(cd.skill.name) + "!", null, "fe-big-crit", hue()); sfx("parry"); break;
      case "ult": if (FF()) FF().cutIn(cd.icon, cd.color, L(cd.ult.name) + "!!", clsName(run.cls)); break;
      case "end":
        if (e.why === "extract") { showBig(t("fr_fx_extract"), null, "fe-big-good"); sfx("win"); }
        else { showBig(t("fr_res_" + e.why), null, "fe-big-wall"); sfx("lose"); }
        break;
    }
  }

  // ---------- 鍵盤 ----------
  document.addEventListener("keydown", function (ev) {
    if (view !== "raid" || !run || activeFight || !rv) return;
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
    var k = ev.key.toLowerCase();
    if (k === "n") { ev.preventDefault(); toggleNote(); return; }
    if (run.briefing || run.dialog) {
      if (k === "enter" || k === " " || k === "escape") { ev.preventDefault(); if (run.briefing) run.briefing = false; else send({ t: "closeDialog" }); }
      return;
    }
    if (rv.noteOpen) { if (k === "escape") { ev.preventDefault(); toggleNote(); } return; }
    var dirs = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
    var me = run.me;
    if (dirs[k]) {
      ev.preventDefault();
      if (ev.repeat) return;
      // 從目前要去的格子，往同一區那個方向的相鄰格
      var from = Core.tile(me.path.length ? me.path[me.path.length - 1] : me.at);
      var to = R.TILES.filter(function (x) { return x.zone === from.zone && x.x === from.x + dirs[k][0] && x.y === from.y + dirs[k][1]; })[0];
      if (to) send({ t: "move", to: to.id });
      return;
    }
    var map = { e: { t: "search" }, f: { t: "fight" }, x: { t: "extract" }, q: { t: "skill" } };
    if (map[k]) { ev.preventDefault(); if (!ev.repeat) send(map[k]); }
    else if (k === "t") {
      // 跟這格第一個還沒聊過的學生說話
      var x = Core.studentsAt(run, me.at).filter(function (y) { return !run.talked[y.s]; })[0];
      if (x) { ev.preventDefault(); send({ t: "chat", u: x.u }); }
    } else if (k === " " && (me.act || me.path.length)) { ev.preventDefault(); send({ t: "stop" }); }
  });

  // ================= 進入點 =================
  function render(root) {
    app = root;
    stopLoop();
    rv = null;
    app.innerHTML = "";
    if (view === "raid" && run) buildRaid();
    else if (view === "result" && summary) app.appendChild(renderResult());
    else { view = "hub"; app.appendChild(renderHub()); }
  }

  var api = {
    render: render,
    onExit: null,
    leave: function () { stopLoop(); rv = null; if (view === "raid") view = "hub"; },
    hasRun: function () { return !!run; },
    // 測試用（tools/fist_check/raid_ui_check.js）
    state: function () { return run; }, profile: function () { return prof; }, view: function () { return view; }, fight: function () { return activeFight; },
    paused: paused
  };
  window.PriTestFistRaid = api;
})();
