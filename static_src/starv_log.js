// 明星經紀 starV：日誌抽屜、日誌文字、離線報告（規格 §2、§15.2）。
// 日誌項目是 { seq, day, type, data }（Core 產生），這裡依 type 組出 sv_log_<type> 的參數。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var drawer = { open: false, aid: "" };
  var REPORT_LINES = 20;

  function artistLabel(st, id) { var a = Core.artistById(st, id); return a ? UI.name(a) : "—"; }
  // 已經不在公司的人（候補流失、解約）由日誌裡的 rosterId／nameSeed 還原名字
  function who(st, d) {
    if (d.aid) return artistLabel(st, d.aid);
    if (d.rosterId || d.nameSeed != null) return Core.artistName({ rosterId: d.rosterId || null, nameSeed: d.nameSeed || 0, gender: d.gender || "f" }, UI.lang());
    return "—";
  }

  function text(st, e) {
    var d = e.data || {}, p = { name: who(st, d) };
    if (e.type === "dup_lb") p.lb = d.lb;
    else if (e.type === "dup_ticket") p.n = d.tickets;
    else if (e.type === "course_done") {
      var c = D.COURSE_BY_ID[d.courseId];
      p.course = UI.courseName(d.courseId); p.stat = c ? UI.statName(c.stat) : ""; p.gain = d.gain;
    } else if (e.type === "promo_done") p.fame = d.fame;
    else if (e.type === "job_done") {
      p.names = (d.aids || []).map(function (id) { return artistLabel(st, id); }).join("、");
      p.title = Core.jobTitle({ dir: d.dir, title: d.title }, UI.lang());
      p.result = t("sv_result_" + d.result);
      p.pay = UI.money(d.pay);
      p.stars = new Array((d.stars || 0) + 1).join("★");
    } else if (e.type === "minor") {
      var ev = null;
      D.MINOR_EVENTS.forEach(function (x) { if (x.id === d.ev) ev = x; });
      p.ev = ev ? UI.L(ev.text) : String(d.ev);
    } else if (e.type === "level_up") p.lv = d.lv;
    else if (e.type === "month_end") { p.salary = UI.money(d.salary); p.upkeep = UI.money(d.upkeep); p.div = UI.money(d.dividends); p.loan = UI.money(d.loan || 0); }
    else if (e.type === "birthday_year") p.year = d.year;
    else if (e.type === "event_new" || e.type === "event_resolved" || e.type === "event_auto") {
      var ev2 = D.EVENT_BY_ID && D.EVENT_BY_ID[d.ev];
      p.title = ev2 ? UI.L(ev2.title) : String(d.ev);
      p.choice = ev2 && d.choice != null ? UI.L(ev2.choices[d.choice].label) : "";
    }
    return t("sv_log_" + e.type, p);
  }

  function involves(e, aid) { var d = e.data || {}; return d.aid === aid || (!!d.aids && d.aids.indexOf(aid) >= 0); }
  function line(st, e) {
    return el("li", { class: "sv-log-line sv-log-" + e.type }, [
      el("span", { class: "sv-log-day", text: UI.dateText(e.day) }),
      el("span", { text: text(st, e) })
    ]);
  }

  function drawerNode(App) {
    var st = App.st();
    var toggle = el("button", {
      type: "button", class: "sv-log-btn" + (drawer.open ? " sv-on" : ""), "data-act": "log-toggle", text: "📜 " + t("sv_log"),
      onclick: function () { drawer.open = !drawer.open; App.render(); }
    });
    if (!drawer.open) return el("div", { class: "sv-log-wrap" }, [toggle]);
    if (drawer.aid && !Core.artistById(st, drawer.aid)) drawer.aid = "";
    var logs = st.log.slice().reverse().filter(function (e) { return !drawer.aid || involves(e, drawer.aid); });
    var filter = UI.select([{ value: "", label: t("sv_log_all") }].concat(st.artists.map(function (a) { return { value: a.id, label: UI.name(a) }; })),
      drawer.aid, function (v) { drawer.aid = v; App.render(); }, { "data-act": "log-filter" });
    return el("div", { class: "sv-log-wrap" }, [
      toggle,
      el("aside", { class: "sv-log-panel" }, [
        el("div", { class: "sv-row" }, [el("b", { class: "sv-grow", text: t("sv_log") }), filter]),
        logs.length ? el("ul", { class: "sv-log-list" }, logs.map(function (e) { return line(st, e); }))
          : el("p", { class: "sv-muted", text: t("sv_log_empty") })
      ])
    ]);
  }

  function signed(v, fmt) { return (v >= 0 ? "+" : "−") + fmt(Math.abs(v)); }

  function report(App, rep) {
    UI.openModal(function (box, close) {
      var st = App.st(), cnt = { great: 0, success: 0, normal: 0, fail: 0 }, n = 0;
      rep.logs.forEach(function (e) { if (e.type === "job_done") { n++; cnt[e.data.result]++; } });
      box.appendChild(UI.modalHead(t("sv_report_title", { days: rep.days }), close));
      if (rep.capped) box.appendChild(el("p", { class: "sv-warn", text: t("sv_report_capped") }));
      box.appendChild(el("ul", { class: "sv-report-list" }, [
        el("li", { text: t("sv_report_money", { v: signed(rep.money, UI.money) }) }),
        el("li", { text: t("sv_report_tickets", { v: signed(rep.tickets, String) }) }),
        el("li", { text: t("sv_report_rep", { v: signed(rep.rep, UI.num) }) }),
        rep.levelTo !== rep.levelFrom ? el("li", { class: "sv-good", text: t("sv_report_level", { from: rep.levelFrom, to: rep.levelTo }) }) : null,
        el("li", { text: t("sv_report_jobs", { n: n, g: cnt.great, s: cnt.success, o: cnt.normal, f: cnt.fail }) })
      ]));
      box.appendChild(el("h3", { text: t("sv_report_recent") }));
      box.appendChild(el("ul", { class: "sv-log-list" }, rep.logs.slice(-REPORT_LINES).reverse().map(function (e) { return line(st, e); })));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "report-close" })]));
    }, { cls: "sv-report" });
  }

  UI.addExtra(drawerNode);
  UI.setReportHandler(report);
})();
