// 萬人迷（wanren）：畫面。標題 → 每天（早上迷妹 → 上課／考試 → 自由時間＝3D 校園 → 晚上）→ 學期報告。
// 規則在 wanren_core.js、資料在 wanren_data.js、3D 在 wanren_3d.js。沒有 WebGL 時自由時間改用地點按鈕。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  var C = window.PriTestWanrenCore;
  var V3 = window.PriTestWanren3D;
  var app = document.getElementById("wr-app");
  if (!app || !D || !C) return;

  function t(k, p) { return window.I18N.t(k, p); }
  function L(o) { return D.L(o); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
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
  function btn(label, onclick, cls, attrs) {
    var a = { class: cls || "wr-btn", type: "button", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function money(n) { return "¥" + Math.round(n).toLocaleString(); }
  function hex(c) { return "#" + ("000000" + c.toString(16)).slice(-6); }
  function hname(hid) { return L(D.HEROINE_BY_ID[hid].name); }
  var GROUP_COLOR = { classmate: "#e76f9a", senior: "#8a6ad0", teacher: "#3f8fd0", parent: "#e0943a" };

  var S = null;   // 遊戲狀態
  var ui = { screen: "title", loc: null, focus: null, topicFor: null, giftFor: null, msg: null, modal: null, shop: false, dateMoment: null, eveningPick: null, lengthId: "full", name: "" };
  var view = null, view3dState = "none";   // none | loading | ready | fail

  // ---------------- 外框 ----------------
  var topEl = el("div", { class: "wr-top" });
  var stageEl = el("div", { class: "wr-stage" });
  var stage3d = el("div", { class: "wr-stage-3d" });
  var hudEl = el("div", { class: "wr-hud" });
  var msgEl = el("div", { class: "wr-msg-host" });
  var fallbackEl = el("div", { class: "wr-fallback" });
  stageEl.appendChild(stage3d); stageEl.appendChild(fallbackEl); stageEl.appendChild(hudEl); stageEl.appendChild(msgEl);
  var panelEl = el("div", { class: "wr-panel" });
  var modalEl = el("div", { class: "wr-modal-host" });
  var mainEl = el("div", { class: "wr-main" }, [stageEl, panelEl]);
  app.appendChild(topEl); app.appendChild(mainEl); app.appendChild(modalEl);

  function init3d() {
    if (view3dState !== "none") return;
    if (!V3 || !V3.available()) { view3dState = "fail"; render(); return; }
    view3dState = "loading";
    V3.load().then(function () {
      try {
        view = V3.create(stage3d, {
          onPick: function (hid) { ui.focus = hid; if (S && S.phase === "free") render(); },
          onLocation: function (loc) {
            if (ui.loc === loc) return;
            ui.loc = loc;
            ui.topicFor = null; ui.giftFor = null; ui.shop = false;
            if (S && S.phase === "free") render();
            else renderHud();
          }
        });
        view3dState = "ready";
      } catch (e) {
        view3dState = "fail";
        if (window.console) console.error(e);
      }
      render();
    }, function () { view3dState = "fail"; render(); });
  }

  function save() { if (S) C.save(S); }
  function say(lines) {
    if (!lines || !lines.length) return;
    ui.msg = lines.slice();
  }
  function act(fn) {
    var out = fn();
    if (out) say(out);
    save();
    render();
  }

  // ---------------- 3D 同步 ----------------
  function sync3d() {
    if (!view) return;
    var ph = !S || ui.screen === "title" ? "free" : S.phase === "report" || S.phase === "yearreport" ? "report" : S.phase === "night" ? "evening" : S.phase === "exam" ? "class" : S.phase;
    if (sync3d.ph !== ph) { view.setPhase(ph); sync3d.ph = ph; }
    var list = [];
    if (S && S.today && S.phase !== "report" && S.phase !== "yearreport") {
      D.HEROINES.forEach(function (hd) {
        var loc = C.whereIs(S, hd.id);
        if (!loc) return;
        var h = S.h[hd.id];
        var hearts = h.dating ? "💕" : h.aff >= 80 ? "❤❤❤" : h.aff >= 60 ? "❤❤" : h.aff >= 40 ? "❤" : "";
        list.push({ id: hd.id, loc: loc, label: h.met ? hname(hd.id) : "？？？", sub: h.met ? C.stageName(S, hd.id) + (hearts ? " " + hearts : "") : L(D.GROUPS.filter(function (g) { return g.id === hd.group; })[0].name), color: GROUP_COLOR[hd.group] });
      });
    }
    var sig = JSON.stringify(list);
    if (sync3d.sig !== sig) { view.setHeroines(list); sync3d.sig = sig; }
    view.setEnabled(!!S && S.phase === "free" && ui.screen === "game");
  }

  // ---------------- 上方列 ----------------
  function renderTop() {
    topEl.innerHTML = "";
    var left = el("div", { class: "wr-brand" }, [el("span", { class: "wr-logo" }, ["💘"]), el("h1", { class: "wr-title" }, [t("wr_title")])]);
    topEl.appendChild(left);
    if (!S || ui.screen === "title") return;
    if (S.today) {
      var kind = S.today.kind, sp = C.special(S);
      var badge = sp ? sp.icon + " " + L(sp.name) : { midterm: t("wr_kind_midterm"), final: t("wr_kind_final"), weekend: t("wr_kind_weekend") }[kind];
      topEl.appendChild(el("div", { class: "wr-date" }, [
        el("span", { class: "wr-term" }, [C.termName(S)]),
        el("b", {}, [C.dateLabel(S, S.day)]), " ",
        el("span", { class: "wr-muted" }, [t("wr_day_of", { d: S.day + 1, n: S.length })]),
        badge ? el("span", { class: "wr-badge wr-badge-" + kind }, [badge]) : null,
        el("span", { class: "wr-phase" }, [t("wr_phase_" + S.phase)])
      ]));
    }
    var stats = el("div", { class: "wr-stats" });
    C.STATS.forEach(function (st) {
      var v = S.stats[st.id];
      var txt = st.id === "money" ? money(v) : st.id === "rep" ? (v > 0 ? "+" : "") + Math.round(v) : Math.round(v);
      var chip = el("span", { class: "wr-stat wr-stat-" + st.id, title: L(st.name) }, [st.icon + " ", el("small", {}, [L(st.name)]), " ", el("b", {}, [txt])]);
      if (st.id !== "money" && st.id !== "rep") chip.appendChild(el("i", { class: "wr-statbar", style: "width:" + clamp(v, 0, 100) + "%" }));
      stats.appendChild(chip);
    });
    stats.appendChild(el("span", { class: "wr-stat wr-stat-fans", title: t("wr_fans") }, ["📣 ", el("small", {}, [t("wr_fans")]), " ", el("b", {}, [S.fans])]));
    topEl.appendChild(stats);
    topEl.appendChild(el("div", { class: "wr-topbtns" }, [
      btn("👭 " + t("wr_people"), function () { ui.modal = { type: "people" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      btn("🎒 " + t("wr_bag"), function () { ui.modal = { type: "bag" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      btn("🏠 " + t("wr_to_title"), function () { save(); ui.screen = "title"; render(); }, "wr-btn wr-btn-ghost")
    ]));
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // ---------------- 3D 上的 HUD ----------------
  function renderHud() {
    hudEl.innerHTML = "";
    if (view3dState === "loading") hudEl.appendChild(el("div", { class: "wr-hud-center" }, [t("wr_loading3d")]));
    if (!S || ui.screen === "title") {
      hudEl.appendChild(el("div", { class: "wr-hud-hero" }, [el("div", { class: "wr-hud-hero-t" }, ["萬人迷"]), el("div", { class: "wr-hud-hero-s" }, [t("wr_tagline")])]));
      return;
    }
    if (S.phase === "free") {
      var loc = ui.loc ? D.LOC_BY_ID[ui.loc] : null;
      hudEl.appendChild(el("div", { class: "wr-hud-loc" }, [loc ? loc.icon + " " + L(loc.name) : t("wr_walking")]));
      var pips = el("div", { class: "wr-hud-ap", title: t("wr_ap") }, [t("wr_ap") + " "]);
      for (var i = 0; i < S.today.apMax; i++) pips.appendChild(el("i", { class: i < S.today.ap ? "on" : "" }));
      hudEl.appendChild(pips);
      if (view && !ui.msg) hudEl.appendChild(el("div", { class: "wr-hud-hint" }, [t("wr_hint_walk")]));
    }
  }
  function renderMsg() {
    msgEl.innerHTML = "";
    if (!ui.msg) return;
    var box = el("div", { class: "wr-msg", role: "dialog", onclick: closeMsg },
      ui.msg.map(function (ln) { return el("p", { class: /^（/.test(ln) ? "wr-msg-note" : /^【/.test(ln) ? "wr-msg-head" : "" }, [ln]); }).concat([el("span", { class: "wr-msg-next" }, ["▼ " + t("wr_tap")])]));
    msgEl.appendChild(box);
  }
  // 關掉對話框後整個重畫：排隊中的事件要在這時候出現
  function closeMsg() { ui.msg = null; render(); }
  function renderFallback() {
    fallbackEl.innerHTML = "";
    fallbackEl.style.display = view3dState === "ready" ? "none" : "";
    if (view3dState === "ready") return;
    var loc = S && S.phase === "free" && ui.loc ? D.LOC_BY_ID[ui.loc] : null;
    fallbackEl.className = "wr-fallback wr-sky-" + (!S ? "free" : S.phase);
    fallbackEl.appendChild(el("div", { class: "wr-fallback-icon" }, [loc ? loc.icon : "🏫"]));
    fallbackEl.appendChild(el("div", { class: "wr-fallback-name" }, [loc ? L(loc.name) : "私立音夣學園大學"]));
    if (view3dState === "fail") fallbackEl.appendChild(el("div", { class: "wr-small wr-muted" }, [t("wr_no3d")]));
  }

  // ---------------- 主畫面 ----------------
  function render() {
    renderTop();
    panelEl.innerHTML = "";
    if (ui.screen === "title" || !S) renderTitle();
    else if (S.phase === "report") renderReport(null);
    else if (S.phase === "yearreport") renderReport(S.yearReport);
    else {
      if (S.events.length && !ui.msg && S.today) renderEvent();
      else if (S.phase === "morning") renderMorning();
      else if (S.phase === "class") renderClass();
      else if (S.phase === "exam") renderExam();
      else if (S.phase === "free") renderFree();
      else if (S.phase === "evening") renderEvening();
      else if (S.phase === "night") renderNight();
    }
    renderHud(); renderMsg(); renderFallback(); renderModal();
    sync3d();
    app.setAttribute("data-phase", S && ui.screen !== "title" ? S.phase : "title");
  }
  function section(title, children, cls) {
    return el("section", { class: "wr-sec " + (cls || "") }, [title ? el("h2", {}, [title]) : null].concat(children));
  }

  // ---------------- 標題 ----------------
  function renderTitle() {
    var saved = C.load();
    var nameIn = el("input", { class: "wr-input", type: "text", maxlength: "12", placeholder: t("wr_name_ph"), value: ui.name });
    nameIn.addEventListener("input", function () { ui.name = nameIn.value; });
    var lenSel = el("div", { class: "wr-seg" }, C.LENGTHS.map(function (l) {
      return btn(L(l.name) + "・" + t("wr_hours", { n: l.hours }), function () { ui.lengthId = l.id; render(); }, "wr-seg-btn" + (ui.lengthId === l.id ? " on" : ""));
    }));
    panelEl.appendChild(section(null, [
      el("p", { class: "wr-intro" }, [t("wr_intro")]),
      el("ul", { class: "wr-rules" }, [1, 2, 3, 4, 5].map(function (i) { return el("li", {}, [t("wr_rule" + i)]); })),
      el("label", { class: "wr-field" }, [el("span", {}, [t("wr_name")]), nameIn]),
      el("div", { class: "wr-field" }, [el("span", {}, [t("wr_length")]), lenSel]),
      el("div", { class: "wr-row" }, [
        btn("✨ " + t("wr_new_game"), function () {
          if (saved && saved.phase !== "report" && !window.confirm(t("wr_overwrite"))) return;
          S = C.newGame({ name: (ui.name || "").trim() || t("wr_default_name"), length: ui.lengthId });
          ui.screen = "game"; ui.msg = [t("wr_open_1"), t("wr_open_2", { name: S.name })]; save();
          if (view) view.teleport("gate");
          render();
        }, "wr-btn wr-btn-main"),
        saved ? btn("▶ " + t("wr_continue") + "（" + C.termName(saved, Math.min(saved.day, saved.length - 1)) + " " + C.dateLabel(saved, Math.min(saved.day, saved.length - 1)) + "・" + saved.name + "）", function () {
          S = saved; ui.screen = "game"; ui.msg = null; if (view) view.teleport("gate"); render();
        }, "wr-btn") : null
      ])
    ], "wr-title-sec"));
    // 女主角介紹
    var cast = el("div", { class: "wr-cast" });
    D.GROUPS.forEach(function (g) {
      cast.appendChild(el("h3", { style: "color:" + GROUP_COLOR[g.id] }, [L(g.name)]));
      var row = el("div", { class: "wr-cast-row" });
      D.HEROINES.filter(function (hd) { return hd.group === g.id; }).forEach(function (hd) {
        row.appendChild(el("div", { class: "wr-cast-card" }, [face(hd, 44), el("div", {}, [el("b", {}, [L(hd.name)]), el("div", { class: "wr-small wr-muted" }, [L(hd.title)])])]));
      });
      cast.appendChild(row);
    });
    panelEl.appendChild(section(t("wr_cast"), [cast]));
  }
  // 頭像（用 3D 外觀的配色畫一個小圓臉）
  function face(hd, size, look) {
    var lk = look || hd.look;
    var s = size || 40;
    var c = el("canvas", { class: "wr-face", width: s * 2, height: s * 2, style: "width:" + s + "px;height:" + s + "px" });
    var g = c.getContext("2d");
    if (g) {
      var W = s * 2;
      g.fillStyle = hex(lk.top || 0x2a3358); g.beginPath(); g.arc(W / 2, W * 1.08, W * 0.46, 0, Math.PI * 2); g.fill();
      g.fillStyle = hex(lk.hair); g.beginPath(); g.arc(W / 2, W * 0.46, W * 0.33, 0, Math.PI * 2); g.fill();
      if (/long|wavy|curl/.test(lk.style || "")) g.fillRect(W * 0.17, W * 0.45, W * 0.66, W * 0.42);
      g.fillStyle = hex(lk.skin || 0xf6dcc8); g.beginPath(); g.arc(W / 2, W * 0.52, W * 0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = hex(lk.hair); g.beginPath(); g.ellipse(W / 2, W * 0.34, W * 0.27, W * 0.12, 0, 0, Math.PI * 2); g.fill();
      if (lk.style === "twin") { g.beginPath(); g.arc(W * 0.16, W * 0.56, W * 0.09, 0, Math.PI * 2); g.arc(W * 0.84, W * 0.56, W * 0.09, 0, Math.PI * 2); g.fill(); }
      if (/pony/.test(lk.style || "")) { g.beginPath(); g.arc(W * 0.8, W * 0.3, W * 0.1, 0, Math.PI * 2); g.fill(); }
      if (lk.style === "bun" || lk.style === "updo") { g.beginPath(); g.arc(W / 2, W * 0.15, W * 0.11, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#2a1e2a";
      g.beginPath(); g.ellipse(W * 0.42, W * 0.55, W * 0.03, W * 0.045, 0, 0, Math.PI * 2); g.ellipse(W * 0.58, W * 0.55, W * 0.03, W * 0.045, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(242,140,160,0.55)"; g.beginPath(); g.arc(W * 0.36, W * 0.63, W * 0.04, 0, Math.PI * 2); g.arc(W * 0.64, W * 0.63, W * 0.04, 0, Math.PI * 2); g.fill();
      if (lk.glasses) { g.strokeStyle = "#333"; g.lineWidth = W * 0.02; g.beginPath(); g.arc(W * 0.42, W * 0.55, W * 0.07, 0, Math.PI * 2); g.moveTo(W * 0.65, W * 0.55); g.arc(W * 0.58, W * 0.55, W * 0.07, 0, Math.PI * 2); g.stroke(); }
    }
    return c;
  }

  // ---------------- 事件 ----------------
  function renderEvent() {
    var ev = S.events[0], v = C.eventView(S, ev);
    panelEl.appendChild(section(v.title, [
      ev.hid ? el("div", { class: "wr-ev-face" }, [face(D.HEROINE_BY_ID[ev.hid], 64)]) : ev.type === "shura" ? el("div", { class: "wr-ev-face" }, [face(D.HEROINE_BY_ID[ev.a], 56), el("span", { class: "wr-vs" }, ["⚡"]), face(D.HEROINE_BY_ID[ev.b], 56)]) : null,
      el("p", { class: "wr-ev-text" }, v.text.split("\n").map(function (ln, i) { return i ? el("span", { class: "wr-ev-line" }, [ln]) : ln; })),
      el("div", { class: "wr-col" }, v.opts.map(function (o, i) { return btn(o, function () { act(function () { return C.resolveEvent(S, i); }); }, "wr-btn wr-btn-opt"); }))
    ], "wr-event wr-event-" + ev.type));
  }

  // ---------------- 早上 ----------------
  function renderMorning() {
    var sp = C.special(S);
    if (sp && sp.text) panelEl.appendChild(el("div", { class: "wr-special" }, [el("b", {}, [sp.icon + " " + L(sp.name)]), " ", sp.text]));
    if (S.summary && S.summary.lines.length && S.summary.day === S.day - 1) {
      panelEl.appendChild(section(t("wr_last_night"), [el("ul", { class: "wr-loglist" }, S.summary.lines.map(function (l) { return el("li", {}, [l]); }))], "wr-sec-sum"));
    }
    var list = el("div", { class: "wr-admirers" });
    S.today.admirers.forEach(function (a, i) {
      var ap = C.approachOf(a.ap);
      var lk = { hair: a.hair, skin: 0xf6dcc8, top: 0x2a3358, style: ["long", "twin", "ponytail", "bob", "bun"][a.name.length % 5] };
      var card = el("div", { class: "wr-adm" + (a.choice !== null ? " done" : "") }, [
        el("div", { class: "wr-adm-head" }, [face(null, 40, lk), el("div", {}, [el("b", {}, [a.name]), " ", el("span", { class: "wr-small wr-muted" }, [a.role]),
          a.ret ? el("span", { class: "wr-badge" }, [a.ret === "fan" ? t("wr_adm_fan") : t("wr_adm_again")]) : null])]),
        el("p", { class: "wr-adm-text" }, [ap.icon + " ", a.ret ? D.RETURN_TEXT[a.ret] + " " : "", ap.text]),
        a.choice !== null ? el("div", { class: "wr-adm-res" }, ["→ " + ap.opts[a.choice].label]) :
          el("div", { class: "wr-row wr-adm-opts" }, ap.opts.map(function (o, oi) {
            return btn((oi === 0 ? "💗 " : oi === ap.opts.length - 1 ? "🙈 " : "🙇 ") + o.label, function () { act(function () { return C.answerAdmirer(S, i, oi); }); }, "wr-btn wr-btn-sm" + (oi === 0 ? " wr-btn-pink" : ""));
          }))
      ]);
      list.appendChild(card);
    });
    var left = S.today.admirers.filter(function (a) { return a.choice === null; }).length;
    panelEl.appendChild(section(t("wr_morning_title", { n: S.today.admirers.length }), [
      el("p", { class: "wr-small wr-muted" }, [t("wr_morning_note")]),
      list,
      el("div", { class: "wr-row" }, [btn((left ? "🙈 " + t("wr_ignore_rest", { n: left }) + " → " : "") + t(S.today.kind === "weekday" ? "wr_go_class" : S.today.kind === "midterm" || S.today.kind === "final" ? "wr_go_exam" : "wr_go_free"), function () {
        act(function () { C.finishMorning(S); if (view) view.teleport(S.phase === "free" ? "gate" : "classroom"); return null; });
      }, "wr-btn wr-btn-main")])
    ]));
  }

  // ---------------- 上課 ----------------
  function renderClass() {
    panelEl.appendChild(section(t("wr_class_title"), [
      el("p", { class: "wr-small wr-muted" }, [t("wr_class_note")]),
      el("div", { class: "wr-grid2" }, D.CLASS_OPTS.map(function (o) {
        return btn(el("span", {}, [el("b", {}, [o.icon + " " + L(o.name)]), el("small", {}, [o.note])]), function () {
          act(function () { var r = C.doClass(S, o.id); if (view) view.teleport("classroom"); return r; });
        }, "wr-btn wr-btn-card");
      }))
    ]));
  }
  function renderExam() {
    var fin = S.today.kind === "final";
    panelEl.appendChild(section(fin ? t("wr_kind_final") : t("wr_kind_midterm"), [
      el("p", {}, [t("wr_exam_note", { s: Math.round(S.stats.study) })]),
      el("div", { class: "wr-grid2" }, [
        btn(el("span", {}, [el("b", {}, ["🔥 " + t("wr_exam_hard")]), el("small", {}, [t("wr_exam_hard_n")])]), function () { act(function () { return C.doExam(S, true); }); }, "wr-btn wr-btn-card"),
        btn(el("span", {}, [el("b", {}, ["📝 " + t("wr_exam_norm")]), el("small", {}, [t("wr_exam_norm_n")])]), function () { act(function () { return C.doExam(S, false); }); }, "wr-btn wr-btn-card")
      ])
    ]));
  }

  // ---------------- 自由時間 ----------------
  function renderFree() {
    var loc = ui.loc ? D.LOC_BY_ID[ui.loc] : null;
    var ap = S.today.ap;
    var head = el("div", { class: "wr-free-head" }, [
      el("h2", {}, [loc ? loc.icon + " " + L(loc.name) : "🚶 " + t("wr_walking")]),
      el("span", { class: "wr-apnum" }, [t("wr_ap") + " ", el("b", {}, [ap]), " / " + S.today.apMax]),
      S.today.date ? el("span", { class: "wr-badge wr-badge-date" }, ["💌 " + t("wr_date_tonight", { n: hname(S.today.date) })]) : null
    ]);
    panelEl.appendChild(head);
    if (!loc) {
      panelEl.appendChild(el("p", { class: "wr-small wr-muted" }, [view ? t("wr_free_hint3d") : t("wr_free_hint")]));
    } else {
      renderLocation(loc);
    }
    // 快速前往
    var go = el("div", { class: "wr-golist" });
    D.LOCATIONS.forEach(function (l) {
      var here = C.heroinesAt(S, l.id);
      var b = btn(el("span", {}, [l.icon + " " + L(l.name), el("span", { class: "wr-go-faces" }, here.map(function (hid) {
        var h = S.h[hid];
        return el("i", { class: "wr-dot" + (h.met ? "" : " unknown") + (h.dating ? " lover" : ""), title: h.met ? hname(hid) : "？", style: "background:" + (h.met ? GROUP_COLOR[D.HEROINE_BY_ID[hid].group] : "#bbb") });
      }))]), function () {
        if (view) view.teleport(l.id);
        else { ui.loc = l.id; ui.topicFor = null; ui.giftFor = null; ui.shop = false; render(); }
      }, "wr-btn wr-btn-go" + (ui.loc === l.id ? " on" : ""));
      go.appendChild(b);
    });
    panelEl.appendChild(section(t("wr_goto"), [go, el("p", { class: "wr-small wr-muted" }, [t("wr_goto_note")])], "wr-sec-go"));
    panelEl.appendChild(el("div", { class: "wr-row wr-endrow" }, [btn("🌆 " + t("wr_end_free") + (ap ? "（" + t("wr_ap_left", { n: ap }) + "）" : ""), function () {
      if (ap > 0 && !window.confirm(t("wr_end_free_confirm", { n: ap }))) return;
      act(function () { C.endFree(S); if (view) view.teleport("plaza"); return null; });
    }, "wr-btn wr-btn-main")]));
  }
  function renderLocation(loc) {
    var a = loc.act;
    var acts = el("div", { class: "wr-row" });
    if (a) acts.appendChild(btn(el("span", {}, [el("b", {}, [L(a.name)]), el("small", {}, [a.note + (a.ap ? "・" + t("wr_ap") + " " + a.ap : "")])]), function () {
      act(function () { var r = C.locAction(S, loc.id); if (S.phase !== "free" && view) view.teleport("plaza"); return r; });
    }, "wr-btn wr-btn-card", { disabled: a.ap > S.today.ap }));
    if (loc.shop) acts.appendChild(btn(el("span", {}, [el("b", {}, ["🛒 " + t("wr_shop")]), el("small", {}, [t("wr_shop_note")])]), function () { ui.modal = { type: "shop" }; renderModal(); }, "wr-btn wr-btn-card"));
    panelEl.appendChild(acts);
    // 地點型任務
    C.locQuests(S, loc.id).forEach(function (hid) {
      var q = C.questOf(S, hid);
      panelEl.appendChild(el("div", { class: "wr-quest" }, [
        el("b", {}, ["📜 " + t("wr_quest") + "：" + q.title]), el("span", { class: "wr-small" }, ["（" + hname(hid) + "）"]),
        el("p", { class: "wr-small" }, [q.desc]),
        btn(t("wr_do_quest"), function () { act(function () { return C.doQuest(S, hid, loc.id); }); }, "wr-btn wr-btn-pink wr-btn-sm", { disabled: S.today.ap < 1 })
      ]));
    });
    var here = C.heroinesAt(S, loc.id);
    if (!here.length) { panelEl.appendChild(el("p", { class: "wr-muted wr-small" }, [t("wr_nobody")])); return; }
    // 雙人互動
    C.pairsAt(S, loc.id).forEach(function (p) {
      panelEl.appendChild(el("div", { class: "wr-pair" }, [face(D.HEROINE_BY_ID[p.a], 32), face(D.HEROINE_BY_ID[p.b], 32),
        btn("👭 " + t("wr_pair_talk", { a: hname(p.a), b: hname(p.b) }), function () { act(function () { return C.pairTalk(S, p.a, p.b); }); }, "wr-btn wr-btn-sm", { disabled: S.today.ap < 1 })]));
    });
    here.forEach(function (hid) { panelEl.appendChild(heroineCard(hid, loc.id)); });
  }
  function affBar(hid) {
    var h = S.h[hid], cap = C.affCap(S, hid);
    return el("div", { class: "wr-aff", title: t("wr_aff") + " " + h.aff }, [
      el("i", { class: "wr-aff-fill" + (h.dating ? " lover" : ""), style: "width:" + h.aff + "%" }),
      cap < 100 ? el("i", { class: "wr-aff-cap", style: "left:" + cap + "%" }) : null,
      el("span", {}, [h.aff])
    ]);
  }
  function heroineCard(hid, locId) {
    var hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
    var noAp = S.today.ap < 1;
    var card = el("div", { class: "wr-hcard" + (ui.focus === hid ? " focus" : "") + (h.dating ? " lover" : ""), style: "--wr-g:" + GROUP_COLOR[hd.group] });
    card.appendChild(el("div", { class: "wr-hcard-head" }, [
      face(hd, 52),
      el("div", { class: "wr-hcard-info" }, [
        el("div", {}, [el("b", {}, [h.met ? L(hd.name) : "？？？"]), " ", el("span", { class: "wr-badge" }, [C.stageName(S, hid)])]),
        el("div", { class: "wr-small wr-muted" }, [h.met ? L(hd.title) : L(D.GROUPS.filter(function (g) { return g.id === hd.group; })[0].name)]),
        h.met ? affBar(hid) : null
      ])
    ]));
    if (!h.met) {
      card.appendChild(el("div", { class: "wr-row" }, [btn("👋 " + t("wr_meet"), function () { act(function () { return C.meet(S, hid); }); }, "wr-btn wr-btn-pink", { disabled: noAp })]));
      return card;
    }
    var row = el("div", { class: "wr-row" });
    row.appendChild(btn("💬 " + t("wr_talk") + ((S.today.talked[hid] || 0) ? " ×" + S.today.talked[hid] : ""), function () { ui.topicFor = ui.topicFor === hid ? null : hid; ui.giftFor = null; render(); }, "wr-btn wr-btn-sm" + (ui.topicFor === hid ? " on" : ""), { disabled: noAp }));
    row.appendChild(btn("🎁 " + t("wr_gift"), function () { ui.giftFor = ui.giftFor === hid ? null : hid; ui.topicFor = null; render(); }, "wr-btn wr-btn-sm" + (ui.giftFor === hid ? " on" : ""), { disabled: noAp || S.today.gifted[hid] }));
    if (C.canInvite(S, hid)) row.appendChild(btn("💌 " + t(C.isWeekend(S) ? "wr_invite_day" : "wr_invite"), function () { act(function () { return C.invite(S, hid); }); }, "wr-btn wr-btn-sm", { disabled: noAp }));
    else if (!S.today.date && !S.today.invited[hid] && h.aff < C.inviteMin(hid)) row.appendChild(el("span", { class: "wr-small wr-muted" }, [t("wr_invite_need", { n: C.inviteMin(hid) })]));
    var q = C.questOf(S, hid);
    if (q && q.req.type !== "loc" && !S.today.quests[hid]) {
      var ok = C.reqMet(S, q.req, locId);
      card.appendChild(el("div", { class: "wr-quest" }, [
        el("b", {}, ["📜 " + t("wr_quest") + "：" + q.title]),
        el("p", { class: "wr-small" }, [q.desc]),
        el("div", { class: "wr-small" + (ok ? " wr-good" : " wr-bad") }, [t("wr_req") + "：" + C.reqText(q.req)]),
        btn(t("wr_do_quest"), function () { act(function () { return C.doQuest(S, hid, locId); }); }, "wr-btn wr-btn-pink wr-btn-sm", { disabled: !ok || noAp })
      ]));
    } else if (q && q.req.type === "loc" && !S.today.quests[hid]) {
      card.appendChild(el("div", { class: "wr-small wr-quest-mini" }, ["📜 " + q.title + "：" + C.reqText(q.req)]));
    }
    if (C.canConfess(S, hid)) {
      var lack = C.confessReq(S, hid);
      card.appendChild(el("div", { class: "wr-confess" }, [
        btn("💘 " + t("wr_confess"), function () { if (window.confirm(t("wr_confess_confirm", { n: hname(hid) }))) act(function () { return C.confess(S, hid); }); }, "wr-btn wr-btn-pink", { disabled: noAp || lack.length > 0 }),
        lack.length ? el("span", { class: "wr-small wr-bad" }, [t("wr_confess_need") + "：" + lack.join("、")]) : el("span", { class: "wr-small wr-good" }, [t("wr_confess_ok")])
      ]));
    }
    card.appendChild(row);
    if (ui.topicFor === hid) {
      var tp = el("div", { class: "wr-topics" }, [el("div", { class: "wr-small wr-muted" }, [t("wr_pick_topic")])]);
      C.talkTopics(S, hid).forEach(function (tid) {
        var k = h.known.topics[tid];
        tp.appendChild(btn(el("span", {}, [L(D.TOPIC_BY_ID[tid].name), k ? el("i", { class: "wr-pref wr-pref-" + k }, [k === "like" ? "♥" : k === "bad" ? "✕" : "・"]) : null]), function () {
          act(function () { return C.talk(S, hid, tid); });
        }, "wr-btn wr-btn-topic"));
      });
      card.appendChild(tp);
    }
    if (ui.giftFor === hid) {
      var items = Object.keys(S.inv);
      var gp = el("div", { class: "wr-topics" }, [el("div", { class: "wr-small wr-muted" }, [items.length ? t("wr_pick_gift") : t("wr_no_items")])]);
      items.forEach(function (iid) {
        var it = D.ITEM_BY_ID[iid], k = h.known.gifts[iid];
        gp.appendChild(btn(el("span", {}, [it.icon + " " + L(it.name) + " ×" + S.inv[iid], k ? el("i", { class: "wr-pref wr-pref-" + k }, [k === "like" ? "♥" : k === "bad" ? "✕" : "・"]) : null]), function () {
          act(function () { ui.giftFor = null; return C.gift(S, hid, iid); });
        }, "wr-btn wr-btn-topic"));
      });
      card.appendChild(gp);
    }
    return card;
  }

  // ---------------- 晚上 ----------------
  function renderEvening() {
    var td = S.today;
    if (td.date) {
      var hid = td.date, hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
      if (td.dateRun && !td.dateRun.done) {
        var m = D.DATE_MOMENTS[td.dateRun.moment], sp = D.DATE_BY_ID[td.dateRun.spot];
        panelEl.appendChild(section("💕 " + t("wr_date_with", { n: hname(hid) }) + "・" + sp.icon + " " + L(sp.name), [
          el("div", { class: "wr-ev-face" }, [face(hd, 72)]),
          el("p", { class: "wr-ev-text" }, [m.text]),
          el("div", { class: "wr-col" }, ["romantic", "funny", "earnest"].map(function (k) {
            return btn(m.opts[k], function () { act(function () { return C.finishDate(S, k); }); }, "wr-btn wr-btn-opt");
          }))
        ], "wr-event"));
        return;
      }
      var spots = el("div", { class: "wr-grid2" });
      C.dateSpots(S).forEach(function (sp) {
        spots.appendChild(btn(el("span", {}, [el("b", {}, [sp.icon + " " + L(sp.name)]), el("small", {}, [sp.cost ? money(sp.cost) : t("wr_free_cost")])]), function () {
          var r = C.startDate(S, sp.id);
          if (r && r.error) say([r.error]);
          save(); render();
        }, "wr-btn wr-btn-card", { disabled: S.stats.money < sp.cost }));
      });
      panelEl.appendChild(section("💌 " + t("wr_date_with", { n: hname(hid) }), [
        el("div", { class: "wr-hcard-head" }, [face(hd, 52), el("div", {}, [el("b", {}, [L(hd.name)]), affBar(hid)])]),
        el("p", { class: "wr-small wr-muted" }, [t("wr_date_pick")]),
        C.specialEvening(S) ? el("p", { class: "wr-small wr-special" }, [t("wr_date_special", { e: C.specialEvening(S).title })]) : null,
        spots,
        el("div", { class: "wr-row" }, [btn("🙇 " + t("wr_date_cancel"), function () { if (window.confirm(t("wr_date_cancel_confirm"))) act(function () { return C.cancelDate(S); }); }, "wr-btn wr-btn-ghost")])
      ]));
      return;
    }
    var spEv = C.specialEvening(S);
    if (spEv) {
      var can = D.HEROINES.filter(function (hd) { return S.h[hd.id].met && S.h[hd.id].aff >= 40; });
      panelEl.appendChild(section((C.special(S).icon || "🔥") + " " + spEv.title, [
        el("p", {}, [spEv.note]),
        can.length ? el("div", { class: "wr-cast-row" }, can.map(function (hd) {
          return btn(el("span", { class: "wr-pickface" }, [face(hd, 40), L(hd.name)]), function () { act(function () { return C.festDance(S, hd.id); }); }, "wr-btn wr-btn-card");
        })) : el("p", { class: "wr-muted wr-small" }, [t("wr_fest_none")])
      ]));
    }
    if (ui.eveningPick === "message") {
      var tg = D.HEROINES.filter(function (hd) { return S.h[hd.id].met && S.h[hd.id].aff >= 20; });
      panelEl.appendChild(section("💬 " + t("wr_msg_pick"), [
        tg.length ? el("div", { class: "wr-cast-row" }, tg.map(function (hd) {
          return btn(el("span", { class: "wr-pickface" }, [face(hd, 40), L(hd.name)]), function () { ui.eveningPick = null; act(function () { return C.doEvening(S, "message", hd.id); }); }, "wr-btn wr-btn-card");
        })) : el("p", { class: "wr-muted" }, [t("wr_msg_none")]),
        btn(t("wr_back"), function () { ui.eveningPick = null; render(); }, "wr-btn wr-btn-ghost")
      ]));
      return;
    }
    panelEl.appendChild(section("🌙 " + t("wr_evening_title"), [
      el("div", { class: "wr-grid2" }, D.EVENING_OPTS.map(function (o) {
        var dis = o.eff.money < 0 && S.stats.money < -o.eff.money;
        return btn(el("span", {}, [el("b", {}, [o.icon + " " + L(o.name)]), el("small", {}, [o.note])]), function () {
          if (o.id === "message") { ui.eveningPick = "message"; render(); return; }
          act(function () { return C.doEvening(S, o.id); });
        }, "wr-btn wr-btn-card", { disabled: dis });
      }))
    ]));
  }
  function renderNight() {
    var yearEnd = S.day + 1 < S.length && C.cal(S, S.day + 1).year !== C.cal(S).year;
    var next = S.day + 1 >= S.length ? t("wr_to_report") : yearEnd ? t("wr_to_year_report") : t("wr_sleep");
    panelEl.appendChild(section("🌃 " + t("wr_night_title"), [
      el("p", { class: "wr-small wr-muted" }, [t("wr_night_note")]),
      el("div", { class: "wr-row" }, [btn("😴 " + next, function () {
        C.endDay(S);
        ui.loc = null; ui.focus = null; ui.topicFor = null; ui.giftFor = null;
        if (view) view.teleport("gate");
        save(); render();
      }, "wr-btn wr-btn-main")])
    ]));
  }

  // ---------------- 報告 ----------------
  // year＝null 是最後的總報告；數字是該學年的中間報告
  function renderReport(year) {
    var r = C.report(S, year);
    var head = el("div", { class: "wr-rep-head" }, [
      el("div", { class: "wr-rep-rank wr-rank-" + r.rank }, [r.rank]),
      el("div", {}, [el("div", { class: "wr-small wr-muted" }, [t("wr_rep_title_label")]), el("div", { class: "wr-rep-title" }, ["「" + r.title + "」"]), el("p", { class: "wr-small" }, [r.titleComment])])
    ]);
    var nums = el("div", { class: "wr-rep-nums" }, [
      num(t("wr_rep_grade"), r.letter, r.grade + " / 100"),
      num(t("wr_rep_exam"), r.examAvg, t("wr_rep_exam_n", { n: r.exams.length }) + (r.exams.length ? "・" + t("wr_rep_exam_best", { n: Math.max.apply(null, r.exams.map(function (e) { return e.score; })) }) : "")),
      num(t("wr_rep_att"), r.attRate + "%", ""),
      num(t("wr_rep_score"), r.score, t("wr_rep_rank") + " " + r.rank),
      num("💕 " + t("wr_rep_lovers"), r.lovers, t("wr_rep_met", { n: r.met })),
      num("📣 " + t("wr_fans"), r.fans, t("wr_rep_adm", { n: r.admirers })),
      num("⚡ " + t("wr_rep_shura"), r.shura, t("wr_rep_breakups", { n: r.breakups })),
      num("🗣 " + L(C.STAT_BY_ID.rep.name), Math.round(r.rep), "✨ " + L(C.STAT_BY_ID.charm.name) + " " + Math.round(r.charm))
    ]);
    var rows = el("div", { class: "wr-rep-rows" });
    r.rows.slice().sort(function (a, b) { return (b.dating - a.dating) || (b.aff - a.aff); }).forEach(function (row) {
      var hd = D.HEROINE_BY_ID[row.id];
      rows.appendChild(el("div", { class: "wr-rep-row" + (row.dating ? " lover" : "") + (!row.met ? " none" : ""), style: "--wr-g:" + GROUP_COLOR[hd.group] }, [
        face(hd, 44),
        el("div", { class: "wr-rep-row-main" }, [
          el("div", {}, [el("b", {}, [row.met ? row.name : "？？？"]), " ", el("span", { class: "wr-badge" }, [row.stage]), row.dates ? el("span", { class: "wr-small wr-muted" }, [" " + t("wr_rep_dates", { n: row.dates })]) : null]),
          row.met ? affBar(row.id) : null,
          row.line ? el("p", { class: "wr-rep-line" }, [row.line]) : el("p", { class: "wr-small wr-muted" }, [t("wr_rep_notmet")])
        ])
      ]));
    });
    panelEl.appendChild(section("📋 " + (r.interim ? t("wr_year_report", { name: r.name, y: r.yearName }) : t("wr_report_title", { name: r.name })), [
      head, nums,
      el("div", { class: "wr-rep-comment" }, [el("h3", {}, ["👩‍🏫 " + t("wr_rep_teacher")]), el("p", {}, [r.teacher])]),
      el("div", { class: "wr-rep-comment" }, [el("h3", {}, ["💘 " + t("wr_rep_love")])].concat(r.love.map(function (l) { return el("p", {}, [l]); }))),
      el("div", { class: "wr-rep-comment wr-rep-sum" }, [el("h3", {}, ["📝 " + t("wr_rep_summary")]), el("p", {}, [r.summary])]),
      chart(),
      el("h3", {}, [t("wr_rep_each")]), rows,
      el("div", { class: "wr-row" }, [r.interim ?
        btn("🌸 " + t("wr_next_year"), function () { C.nextYear(S); ui.msg = null; if (view) view.teleport("gate"); save(); render(); }, "wr-btn wr-btn-main") :
        btn("🔁 " + t("wr_again"), function () { C.clearSave(); S = null; ui.screen = "title"; render(); }, "wr-btn wr-btn-main")])
    ], "wr-report"));
  }
  function num(label, big, sub) { return el("div", { class: "wr-num" }, [el("small", {}, [label]), el("b", {}, [String(big)]), sub ? el("span", { class: "wr-small wr-muted" }, [sub]) : null]); }
  // 學業與魅力的變化（小折線圖）
  function chart() {
    var hs = S.history;
    if (hs.length < 2) return null;
    var W = 600, H = 140, P = 24;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("class", "wr-chart"); svg.setAttribute("role", "img");
    function line(key, cls) {
      var d = hs.map(function (h, i) { return (i ? "L" : "M") + (P + i / (hs.length - 1) * (W - P * 2)).toFixed(1) + " " + (H - P - h[key] / 100 * (H - P * 2)).toFixed(1); }).join(" ");
      var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); svg.appendChild(p);
    }
    [0, 50, 100].forEach(function (v) {
      var y = H - P - v / 100 * (H - P * 2);
      var g = document.createElementNS(ns, "line"); g.setAttribute("x1", P); g.setAttribute("x2", W - P); g.setAttribute("y1", y); g.setAttribute("y2", y); g.setAttribute("class", "wr-chart-grid"); svg.appendChild(g);
      var tx = document.createElementNS(ns, "text"); tx.setAttribute("x", 2); tx.setAttribute("y", y + 4); tx.setAttribute("class", "wr-chart-t"); tx.textContent = v; svg.appendChild(tx);
    });
    line("study", "wr-chart-study"); line("charm", "wr-chart-charm");
    return el("div", { class: "wr-chart-box" }, [el("h3", {}, [t("wr_rep_chart")]), svg, el("div", { class: "wr-small" }, [el("i", { class: "wr-key wr-key-study" }), L(C.STAT_BY_ID.study.name), " ", el("i", { class: "wr-key wr-key-charm" }), L(C.STAT_BY_ID.charm.name)])]);
  }

  // ---------------- 視窗：人物、背包、購買部 ----------------
  function renderModal() {
    modalEl.innerHTML = "";
    if (!ui.modal || !S) return;
    var m = ui.modal, body;
    function close() { ui.modal = null; renderModal(); }
    if (m.type === "people") body = peopleView();
    else if (m.type === "bag") body = bagView();
    else if (m.type === "shop") body = shopView();
    else if (m.type === "profile") body = profileView(m.hid);
    var box = el("div", { class: "wr-modal" }, [el("button", { class: "wr-modal-x", type: "button", onclick: close, "aria-label": t("wr_close") }, ["✕"]), body]);
    var back = el("div", { class: "wr-modal-back", onclick: function (e) { if (e.target === back) close(); } }, [box]);
    modalEl.appendChild(back);
  }
  function peopleView() {
    var wrap = el("div", {}, [el("h2", {}, ["👭 " + t("wr_people")])]);
    D.GROUPS.forEach(function (g) {
      wrap.appendChild(el("h3", { style: "color:" + GROUP_COLOR[g.id] }, [L(g.name)]));
      var row = el("div", { class: "wr-people" });
      D.HEROINES.filter(function (hd) { return hd.group === g.id; }).forEach(function (hd) {
        var h = S.h[hd.id], where = S.today ? C.whereIs(S, hd.id) : null;
        row.appendChild(el("button", { type: "button", class: "wr-person" + (h.dating ? " lover" : ""), onclick: function () { ui.modal = { type: "profile", hid: hd.id }; renderModal(); } }, [
          face(hd, 44),
          el("span", {}, [el("b", {}, [h.met ? L(hd.name) : "？？？"]), el("small", {}, [C.stageName(S, hd.id) + (h.met ? "・" + h.aff : "")]),
            el("small", { class: "wr-muted" }, [h.met ? (where ? "📍 " + L(D.LOC_BY_ID[where].name) : t("wr_absent")) : ""])])
        ]));
      });
      wrap.appendChild(row);
    });
    return wrap;
  }
  function profileView(hid) {
    var hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
    var known = function (map, src, nameOf) {
      var ks = Object.keys(map);
      if (!ks.length) return el("span", { class: "wr-muted wr-small" }, [t("wr_unknown")]);
      return el("span", {}, ks.map(function (k) { return el("span", { class: "wr-tag wr-pref-" + map[k] }, [(map[k] === "like" ? "♥ " : map[k] === "bad" ? "✕ " : "") + nameOf(k)]); }));
    };
    var where = S.today ? C.whereIs(S, hid) : null;
    return el("div", { class: "wr-profile", style: "--wr-g:" + GROUP_COLOR[hd.group] }, [
      el("div", { class: "wr-hcard-head" }, [face(hd, 72), el("div", {}, [
        el("h2", {}, [h.met ? L(hd.name) : "？？？"]),
        el("div", { class: "wr-small" }, [L(hd.title) + "・" + hd.age + t("wr_age")]),
        el("span", { class: "wr-badge" }, [C.stageName(S, hid)]), h.met ? affBar(hid) : null
      ])]),
      h.met ? el("p", {}, [hd.intro]) : el("p", { class: "wr-muted" }, [t("wr_not_met_yet")]),
      h.met ? el("div", { class: "wr-small" }, ["📍 " + t("wr_today") + "：" + (where ? L(D.LOC_BY_ID[where].name) : t("wr_absent"))]) : null,
      h.met ? el("div", { class: "wr-prof-row" }, [el("b", {}, [t("wr_known_topics")]), known(h.known.topics, D.TOPIC_BY_ID, function (k) { return L(D.TOPIC_BY_ID[k].name); })]) : null,
      h.met ? el("div", { class: "wr-prof-row" }, [el("b", {}, [t("wr_known_gifts")]), known(h.known.gifts, D.ITEM_BY_ID, function (k) { return D.ITEM_BY_ID[k].icon + L(D.ITEM_BY_ID[k].name); })]) : null,
      h.met ? el("div", {}, [el("h3", {}, ["📜 " + t("wr_quest")]), el("ol", { class: "wr-qlist" }, hd.quests.map(function (q, i) {
        var st = i < h.quest ? "done" : i === h.quest ? (h.aff >= q.at ? "now" : "lock") : "lock";
        return el("li", { class: "wr-q-" + st }, [
          st === "lock" ? t("wr_quest_lock", { n: q.at }) + (C.questLock(S, i) ? "・" + t("wr_quest_term", { t: C.questLock(S, i) }) : "") :
          st === "now" && C.questLock(S, i) ? el("span", {}, [el("b", {}, [q.title]), el("br"), el("small", {}, [t("wr_quest_term", { t: C.questLock(S, i) })])]) : el("span", {}, [el("b", {}, [q.title]), st === "done" ? " ✅" : "", el("br"), el("small", {}, [st === "now" ? q.desc + "（" + C.reqText(q.req) + "）" : q.done])])
        ]);
      })), h.quest >= hd.quests.length && !h.dating ? el("p", { class: "wr-small" }, [t("wr_confess_hint") + (C.confessReq(S, hid).length ? "（" + C.confessReq(S, hid).join("、") + "）" : "")]) : null]) : null
    ]);
  }
  function bagView() {
    var items = Object.keys(S.inv);
    return el("div", {}, [el("h2", {}, ["🎒 " + t("wr_bag")]),
      el("p", {}, [t("wr_money") + "：" + money(S.stats.money)]),
      items.length ? el("ul", { class: "wr-bag" }, items.map(function (iid) { var it = D.ITEM_BY_ID[iid]; return el("li", {}, [it.icon + " " + L(it.name) + " ×" + S.inv[iid]]); })) : el("p", { class: "wr-muted" }, [t("wr_no_items")]),
      el("p", { class: "wr-small wr-muted" }, [t("wr_bag_note")])
    ]);
  }
  function shopView() {
    return el("div", {}, [el("h2", {}, ["🛒 " + t("wr_shop")]),
      el("p", {}, [t("wr_money") + "：", el("b", {}, [money(S.stats.money)])]),
      el("div", { class: "wr-shop" }, D.ITEMS.map(function (it) {
        return el("div", { class: "wr-shop-item" }, [el("span", { class: "wr-shop-icon" }, [it.icon]), el("span", {}, [el("b", {}, [L(it.name)]), el("small", {}, [money(it.price) + (S.inv[it.id] ? "・" + t("wr_have", { n: S.inv[it.id] }) : "")])]),
          btn(t("wr_buy"), function () { var r = C.buy(S, it.id); if (r) { save(); renderTop(); renderModal(); } }, "wr-btn wr-btn-sm", { disabled: S.stats.money < it.price })]);
      }))
    ]);
  }
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (ui.modal) { ui.modal = null; renderModal(); } else if (ui.msg) closeMsg(); }
    if ((e.key === "Enter" || e.key === " ") && ui.msg && !/input|textarea|button|select/i.test(e.target.tagName)) { e.preventDefault(); closeMsg(); }
  });
  window.addEventListener("i18n:change", function () { sync3d.sig = null; render(); });

  // 測試用
  window.PriTestWanren = {
    get state() { return S; }, ui: ui, core: C,
    view: function () { return view; }, render: render
  };

  render();
  init3d();
})();
