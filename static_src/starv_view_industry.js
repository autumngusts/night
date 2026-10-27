// 明星經紀 starV：「業界」分頁（本季趨勢、特殊潮流、下季傳聞；規格 §8.3）。
// 對手公司、排行榜、頒獎典禮在計畫 4 加進這個分頁。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;

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

  UI.register({
    id: "industry", order: 40, icon: "📈", labelKey: "sv_tab_industry",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(trendCard(st));
      c.appendChild(rumorCard(st));
    }
  });
})();
