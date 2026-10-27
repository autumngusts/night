// 明星經紀 starV：「業界」分頁（本季趨勢、特殊潮流、下季傳聞；規格 §8.3）。
// 對手公司、排行榜、頒獎典禮在計畫 4 加進這個分頁。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;

  var Roster = window.PriTestStarvRoster;
  var chartTab = "single";

  function dirChip(id, cls) {
    var d = D.DIR_BY_ID[id];
    return el("span", { class: "sv-chip " + cls, style: "--sv-dc:" + d.color, text: d.icon + " " + UI.L(d.name) });
  }

  function trendCard(st) {
    var c = st.trend.cur, sp = c.special ? D.SPECIAL_TREND_BY_ID[c.special] : null, s = Core.seasonOf(st.day);
    var left = D.BAL.seasonDays - (st.day % D.BAL.seasonDays);
    return el("div", { class: "sv-card sv-trend" }, [
      el("h3", { text: t("sv_trend_title") }),
      el("div", { class: "sv-small sv-muted", text: t("sv_season", { y: s.year, s: s.season }) + "・" + t("sv_trend_ends", { n: left }) }),
      el("div", { class: "sv-trend-row" }, [el("span", { class: "sv-small", text: "🔥 " + t("sv_trend_hot") }), el("div", { class: "sv-chips" }, c.hot.map(function (id) { return dirChip(id, "sv-trend-hot"); }))]),
      el("div", { class: "sv-trend-row" }, [el("span", { class: "sv-small", text: "🧊 " + t("sv_trend_cold") }), el("div", { class: "sv-chips" }, [dirChip(c.cold, "sv-trend-cold")])]),
      sp ? el("div", { class: "sv-trend-special" }, [
        el("div", { class: "sv-small sv-warn", text: "✨ " + t("sv_trend_special") }),
        el("b", { text: UI.L(sp.name) }),
        el("p", { class: "sv-small", text: UI.L(sp.desc) }),
        el("div", { class: "sv-chips" }, sp.dirs.map(function (id) { return dirChip(id, "sv-trend-hot"); }))
      ]) : null
    ]);
  }

  function rumorCard(st) {
    var n = st.trend.next, sp = n.special ? D.SPECIAL_TREND_BY_ID[n.special] : null;
    var dirs = n.hot.map(function (id) { return UI.dirName(id); }).join("、");
    return el("div", { class: "sv-card sv-trend-rumor" }, [
      el("h3", { text: "🗞️ " + t("sv_trend_rumor_title") }),
      el("p", { text: t("sv_trend_rumor", { dirs: dirs }) }),
      sp ? el("p", { class: "sv-small", text: t("sv_trend_rumor_special", { name: UI.L(sp.name) }) }) : null
    ]);
  }

  function rivalsCard(st) {
    var max = Math.max.apply(null, st.rivals.map(function (r) { return r.power; }).concat([100]));
    return el("div", { class: "sv-card" }, [el("h3", { text: "🏢 " + t("sv_rivals_title") })].concat(st.rivals.map(function (r) {
      var names = r.stars.map(function (s) { return Core.rivalStarName(s, UI.lang()); }).join("、");
      return el("div", { class: "sv-rival" }, [
        el("div", { class: "sv-row" }, [el("b", { class: "sv-grow", text: Core.rivalName(r, UI.lang()) }), el("span", { class: "sv-small", text: t("sv_rival_power", { n: Math.round(r.power) }) })]),
        UI.bar(r.power, max, "sv-bar-rival"),
        el("div", { class: "sv-rival-stars" }, r.stars.map(function (s) { var e = Roster.byId(s.rosterId); return e ? UI.avatar(e, 32) : null; }).concat([
          el("span", { class: "sv-small sv-muted", text: names ? t("sv_rival_stars", { names: names }) : t("sv_rival_nostar") })
        ]))
      ]);
    })));
  }

  function entryName(st, n) { return window.PriTestStarvAwardsUI.nomineeName(st, n); }
  function chartsCard(st, App) {
    var card = el("div", { class: "sv-card sv-chart" }, [el("h3", { text: "📊 " + t("sv_charts_title") })]);
    card.appendChild(el("div", { class: "sv-subtabs" }, D.CHARTS.map(function (c) {
      return UI.btn(UI.L(c.name), function () { chartTab = c.id; App.render(); }, chartTab === c.id ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "chart-" + c.id });
    })));
    if (!st.charts) { card.appendChild(el("p", { class: "sv-muted", text: t("sv_charts_empty") })); return card; }
    card.appendChild(el("div", { class: "sv-small sv-muted", text: t("sv_charts_when", { date: UI.dateText(st.charts.day) }) }));
    card.appendChild(el("ol", { class: "sv-chart-list" }, (st.charts.lists[chartTab] || []).map(function (n) {
      var ours = n.kind === "artist";
      return el("li", { class: ours ? "sv-chart-ours" : "" }, [
        el("span", { class: "sv-grow", text: entryName(st, n) }),
        el("span", { class: "sv-small sv-muted", text: ours ? t("sv_ours") : UI.rivalName(st, n.rival) }),
        el("span", { class: "sv-small", text: t("sv_chart_score", { n: Math.round(n.score) }) })
      ]);
    })));
    return card;
  }

  function historyCard(st, App) {
    var A = window.PriTestStarvAwardsUI;
    var rows = st.awards.history.map(function (h) {
      var n = h.results.filter(function (r) { return A.ours(r.nominees[r.winner]); }).length;
      return UI.btn(t("sv_ceremony_replay", { year: h.year, n: n }), function () { A.open(App, h.year); }, "sv-btn-ghost", { "data-act": "ceremony-replay-" + h.year });
    });
    return el("div", { class: "sv-card" }, [
      el("h3", { text: "🏆 " + t("sv_ceremony_history") }),
      rows.length ? el("div", { class: "sv-row" }, rows) : el("p", { class: "sv-muted", text: t("sv_ceremony_empty") })
    ]);
  }

  UI.register({
    id: "industry", order: 40, icon: "📈", labelKey: "sv_tab_industry",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(trendCard(st));
      c.appendChild(rumorCard(st));
      c.appendChild(chartsCard(st, App));
      c.appendChild(rivalsCard(st));
      c.appendChild(historyCard(st, App));
    }
  });
})();
