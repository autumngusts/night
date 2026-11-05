// 明星經紀 starV：增加遊戲性的七個系統的畫面（規則在 starv_plus.js）。2026-11-05 使用者指定。
//   「🎯 目標」分頁：本季經營目標、臨場決策、心願牆、作品系列、人際關係、粉絲
//   藝人詳情：心願・粉絲・人際區塊（含粉絲見面會／限定直播／周邊販售）
//   頂部列：有臨場決策可以做時出現 🎬 按鈕
//   事件結果、日誌、工作卡的擴充文字
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var Plus = window.PriTestStarvPlus;
  if (!D || !D.PLUS || !Core || !UI || !Plus) return;
  var X = D.PLUS, B = X.BAL;
  var t = UI.t, el = UI.el;

  function nameOf(st, id) { var a = Core.artistById(st, id); return a ? UI.name(a) : "—"; }
  function names(st, ids) { return (ids || []).map(function (id) { return nameOf(st, id); }).join("、"); }
  function openArtist(App, aid) { if (window.PriTestStarvArtistsView) window.PriTestStarvArtistsView.openDetail(App, aid); }
  function sec(title, body, extra) { return el("div", { class: "sv-card sv-plus-card" }, [el("h3", { class: "sv-sec-title", text: title }), extra || null].concat(body)); }
  function titleOf(x) { return Core.jobTitle({ dir: x.dir, titleDir: x.titleDir, title: x.title, seq: x.seq }, UI.lang()); }

  function wishText(st, w) {
    var W = X.WISH_BY_ID[w.t];
    if (!W) return w.t;
    var p = w.p || {};
    return UI.L(W.text).replace("{tier}", p.tier || "").replace("{dir}", p.dir ? UI.dirName(p.dir) : "")
      .replace("{n}", p.n != null ? UI.num(p.n) : "").replace("{partner}", p.partner ? nameOf(st, p.partner) : "");
  }
  function wishProgress(st, a, w) {
    if (w.t === "fame") return [Math.min(a.fame, w.p.n), w.p.n];
    if (w.t === "course") return [Math.min(w.prog, w.p.n), w.p.n];
    return null;
  }
  function goalText(g) {
    var G = X.GOAL_BY_ID[g.t];
    return G ? UI.L(G.text).replace("{n}", g.t === "earn" ? UI.money(g.n) : UI.num(g.n)) : g.t;
  }
  function bondLabel(v) { return v >= B.bondFriend ? t("sv_plus_friend") : v <= B.bondRival ? t("sv_plus_rival") : v > 0 ? t("sv_plus_close") : t("sv_plus_cold"); }
  function bondCls(v) { return v >= B.bondFriend ? "sv-plus-good" : v <= B.bondRival ? "sv-plus-bad" : ""; }

  // ---- 臨場決策 ----
  function openClutch(App) {
    UI.openModal(function (box, close) {
      var st = App.st(), list = Plus.clutchPending(st);
      box.appendChild(UI.modalHead("🎬 " + t("sv_plus_clutch"), close));
      box.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_plus_clutch_hint") }));
      if (!list.length) { box.appendChild(el("p", { class: "sv-muted", text: t("sv_plus_clutch_none") })); return; }
      list.forEach(function (x) {
        var aj = x.aj, sit = X.SITS[aj.clutch.s[x.k]];
        box.appendChild(el("div", { class: "sv-card sv-plus-clutch", "data-clutch": aj.id }, [
          el("div", { class: "sv-row" }, [
            el("span", { class: "sv-chip", text: UI.dirIcon(aj.job.dir) + " " + aj.job.tier }),
            el("b", { class: "sv-grow", text: Core.jobTitle(aj.job, UI.lang()) }),
            el("span", { class: "sv-small sv-muted", text: t("sv_plus_round", { k: x.k + 1, n: B.clutchRounds }) })
          ]),
          el("div", { class: "sv-small sv-muted", text: names(st, aj.members) }),
          el("p", { class: "sv-plus-sit", text: "「" + UI.L(sit.text) + "」" }),
          el("div", { class: "sv-plus-strats" }, Object.keys(X.STRATS).map(function (k) {
            var S = X.STRATS[k];
            return el("button", { type: "button", class: "sv-ev-choice", "data-act": "clutch-" + k, onclick: function () {
              var r = App.act(function (s) { return Plus.pickClutch(s, aj.id, x.k, k); });
              if (!r || r.err) { UI.toast(t("sv_err_" + ((r && r.err) || "busy")), "bad"); return; }
              UI.toast(t("sv_plus_clutch_q" + r.q), r.q === 2 ? "gold" : r.q === 0 ? "bad" : "");
            } }, [el("b", { text: S.icon + " " + UI.L(S.name) }), el("span", { class: "sv-small sv-muted", text: UI.L(S.hint) })]);
          }))
        ]));
      });
    }, { live: true, cls: "sv-event" });
  }
  UI.addTopItem(function (App) {
    var n = Plus.clutchPending(App.st()).length;
    if (!n) return null;
    return el("button", { type: "button", class: "sv-chip sv-bell sv-plus-bell", "data-act": "clutch-bell", text: t("sv_plus_clutch_bell", { n: n }), onclick: function () { openClutch(App); } });
  });

  // ---- 「目標」分頁 ----
  function goalsCard(st) {
    var G = st.plus.goals, s = Core.seasonOf(st.day);
    var left = D.BAL.seasonDays - (st.day % D.BAL.seasonDays);
    var lv = st.company.level;
    var rows = G.list.map(function (g) {
      var stt = g.done ? "✅" : g.failed ? "❌" : "⬜";
      return el("li", { class: "sv-plus-goal" + (g.done ? " sv-plus-done" : g.failed ? " sv-plus-failed" : "") }, [
        el("div", { class: "sv-row" }, [el("span", { text: stt }), el("span", { class: "sv-grow", text: goalText(g) }),
          el("span", { class: "sv-small sv-muted", text: g.t === "earn" ? UI.money(Math.min(g.prog, g.n)) + " / " + UI.money(g.n) : UI.num(Math.min(g.prog, g.n)) + " / " + UI.num(g.n) })]),
        UI.bar(Math.min(g.prog, g.n), g.n)
      ]);
    });
    return sec(t("sv_plus_goals_title", { y: s.year, s: s.season }), [
      el("p", { class: "sv-small sv-muted", text: t("sv_plus_goals_hint", { n: left, tk: B.goalTickets, m: UI.money(B.goalMoneyPerLv * lv), all: B.goalAllTickets }) }),
      el("ul", { class: "sv-plus-list" }, rows),
      G.all ? el("p", { class: "sv-plus-good", text: "🎉 " + t("sv_plus_goals_all") }) : null,
      st.plus.goalHist.length ? el("div", { class: "sv-chips" }, st.plus.goalHist.map(function (h) { var q = Core.seasonOf(h.season * D.BAL.seasonDays); return el("span", { class: "sv-chip", text: t("sv_plus_goal_hist", { y: q.year, s: q.season, d: h.done, n: h.n }) }); })) : null
    ]);
  }
  function wishWall(App, st) {
    var rows = [];
    st.artists.forEach(function (a) {
      (a.wishes || []).forEach(function (w) {
        var pr = wishProgress(st, a, w);
        rows.push(el("li", { class: "sv-plus-wish", role: "button", tabindex: "0", onclick: function () { openArtist(App, a.id); } }, [
          UI.avatar(a, 34),
          el("div", { class: "sv-grow" }, [
            el("div", {}, [el("b", { text: UI.name(a) }), el("span", { class: "sv-small sv-muted", text: "　" + t("sv_plus_wish_left", { n: Math.max(0, w.until - st.day) }) })]),
            el("div", { class: "sv-small", text: "💭 " + wishText(st, w) }),
            pr ? UI.bar(pr[0], pr[1]) : null
          ])
        ]));
      });
    });
    return sec(t("sv_plus_wishes_title"), [
      el("p", { class: "sv-small sv-muted", text: t("sv_plus_wishes_hint") }),
      rows.length ? el("ul", { class: "sv-plus-list" }, rows) : el("p", { class: "sv-muted", text: t("sv_plus_wishes_none") })
    ]);
  }
  function ipCard(st) {
    var list = st.plus.ips.slice().reverse();
    return sec(t("sv_plus_ip_title"), [
      el("p", { class: "sv-small sv-muted", text: t("sv_plus_ip_hint") }),
      list.length ? el("ul", { class: "sv-plus-list" }, list.map(function (ip) {
        var status = ip.final ? t("sv_plus_ip_final") : ip.dead ? t("sv_plus_ip_dead") : ip.offered ? t("sv_plus_ip_offered") : t("sv_plus_ip_wait");
        return el("li", { class: ip.dead ? "sv-plus-failed" : ip.final ? "sv-plus-done" : "" }, [
          el("div", { class: "sv-row" }, [el("span", { text: UI.dirIcon(ip.titleDir) }), el("b", { class: "sv-grow", text: titleOf({ dir: ip.dir, titleDir: ip.titleDir, title: ip.title, seq: ip.seq }) }),
            el("span", { class: "sv-chip", text: t("sv_plus_ip_seq", { n: ip.seq }) }), el("span", { class: "sv-stars", text: "★" + ip.stars })]),
          el("div", { class: "sv-small sv-muted", text: t("sv_plus_ip_cast", { names: names(st, ip.cast) }) + "・" + status })
        ]);
      })) : el("p", { class: "sv-muted", text: t("sv_plus_ip_none") })
    ]);
  }
  function bondCard(App, st) {
    var fr = [], rv = [];
    Object.keys(st.plus.bonds).forEach(function (k) {
      var v = st.plus.bonds[k], p = k.split("|");
      if (!Core.artistById(st, p[0]) || !Core.artistById(st, p[1])) return;
      if (v >= B.bondFriend) fr.push([p, v]); else if (v <= B.bondRival) rv.push([p, v]);
    });
    fr.sort(function (x, y) { return y[1] - x[1]; }); rv.sort(function (x, y) { return x[1] - y[1]; });
    function row(q, cls, icon) {
      return el("li", { class: cls }, [el("span", { text: icon + " " + nameOf(st, q[0][0]) + " × " + nameOf(st, q[0][1]) }), el("span", { class: "sv-small sv-muted", text: "　" + Math.round(q[1]) })]);
    }
    return sec(t("sv_plus_bond_title"), [
      el("p", { class: "sv-small sv-muted", text: t("sv_plus_bond_hint") }),
      el("h4", { text: "💞 " + t("sv_plus_friends", { n: fr.length }) }),
      fr.length ? el("ul", { class: "sv-plus-list" }, fr.slice(0, 8).map(function (q) { return row(q, "sv-plus-good", "💞"); })) : el("p", { class: "sv-muted sv-small", text: t("sv_plus_none") }),
      el("h4", { text: "⚡ " + t("sv_plus_rivals", { n: rv.length }) }),
      rv.length ? el("ul", { class: "sv-plus-list" }, rv.slice(0, 8).map(function (q) { return row(q, "sv-plus-bad", "⚡"); })) : el("p", { class: "sv-muted sv-small", text: t("sv_plus_none") })
    ]);
  }
  function fanCard(App, st) {
    var top = st.artists.slice().sort(function (x, y) { return (y.core || 0) - (x.core || 0); }).slice(0, 8);
    var anti = st.artists.filter(function (a) { return (a.anti || 0) >= 30; });
    return sec(t("sv_plus_fan_title"), [
      el("p", { class: "sv-small sv-muted", text: t("sv_plus_fan_hint") }),
      el("ul", { class: "sv-plus-list" }, top.map(function (a) {
        return el("li", { role: "button", tabindex: "0", onclick: function () { openArtist(App, a.id); } }, [
          el("span", { class: "sv-grow", text: UI.name(a) }),
          el("span", { class: "sv-small", text: t("sv_plus_core_n", { n: UI.num(a.core || 0) }) }),
          a.anti >= 30 ? el("span", { class: "sv-chip sv-plus-bad", text: t("sv_plus_anti_n", { n: Math.round(a.anti) }) }) : null
        ]);
      })),
      anti.length ? el("p", { class: "sv-small sv-plus-bad", text: t("sv_plus_anti_warn", { names: anti.map(function (a) { return UI.name(a); }).join("、") }) }) : null
    ]);
  }
  UI.register({
    id: "goals", order: 17, icon: "🎯", labelKey: "sv_tab_goals",
    render: function (c, App) {
      var st = App.st();
      Plus.ensure(st);
      c.appendChild(goalsCard(st));
      var pend = Plus.clutchPending(st);
      if (pend.length) c.appendChild(sec("🎬 " + t("sv_plus_clutch"), [el("p", { class: "sv-small", text: t("sv_plus_clutch_bell", { n: pend.length }) }), UI.btn(t("sv_plus_clutch_open"), function () { openClutch(App); }, "sv-btn-primary", { "data-act": "clutch-open" })]));
      c.appendChild(wishWall(App, st));
      c.appendChild(fanCard(App, st));
      c.appendChild(bondCard(App, st));
      c.appendChild(ipCard(st));
    }
  });

  // ---- 藝人詳情 ----
  if (window.PriTestStarvArtistsView) window.PriTestStarvArtistsView.addSection(function (App, st, a) {
    Plus.ensure(st);
    var body = [];
    // 心願
    body.push(el("h4", { text: "💭 " + t("sv_plus_wishes") }));
    if (a.wishes && a.wishes.length) body.push(el("ul", { class: "sv-plus-list" }, a.wishes.map(function (w) {
      var pr = wishProgress(st, a, w);
      return el("li", {}, [el("div", { text: wishText(st, w) }), el("div", { class: "sv-small sv-muted", text: t("sv_plus_wish_left", { n: Math.max(0, w.until - st.day) }) }), pr ? UI.bar(pr[0], pr[1]) : null]);
    })));
    else body.push(el("p", { class: "sv-small sv-muted", text: t("sv_plus_wish_none_one") }));
    var plusCap = Object.keys(a.capPlus || {}).filter(function (k) { return a.capPlus[k]; });
    if (plusCap.length) body.push(el("p", { class: "sv-small", text: t("sv_plus_cap_plus", { list: plusCap.map(function (k) { return UI.statName(k) + " +" + (a.capPlus[k] * 3) + "%"; }).join("、") }) }));
    // 粉絲
    var core = a.core || 0, casual = Math.max(0, a.fame - core);
    body.push(el("h4", { text: "💗 " + t("sv_plus_fans") }));
    body.push(el("div", { class: "sv-small", text: t("sv_plus_fans_line", { core: UI.num(core), casual: UI.num(casual) }) }));
    body.push(el("div", { class: "sv-small" }, [t("sv_plus_anti") + " " + Math.round(a.anti || 0), UI.bar(a.anti || 0, 100, "sv-bar-stress")]));
    if (!a.task) {
      body.push(el("div", { class: "sv-row" }, Object.keys(X.FAN_TASKS).map(function (k) {
        var F = X.FAN_TASKS[k], cost = Plus.fanCost(st, k);
        return UI.btn(F.icon + " " + t("sv_task_" + k) + (cost ? "（" + UI.money(cost) + "）" : ""), function () {
          var err = App.act(function (s) { return Core.schedule(s, a.id, { kind: k }); });
          if (err) UI.toast(t("sv_err_" + err), "bad");
        }, "", { "data-act": "do-" + k, title: t("sv_plus_fan_tip_" + k) });
      })));
      body.push(el("p", { class: "sv-small sv-muted", text: t("sv_plus_fan_tasks_hint") }));
    }
    // 人際
    var bl = Plus.bondsOf(st, a).slice(0, 6);
    body.push(el("h4", { text: "🤝 " + t("sv_plus_bonds") }));
    body.push(bl.length ? el("ul", { class: "sv-plus-list" }, bl.map(function (x) {
      return el("li", { class: bondCls(x.v) }, [el("span", { class: "sv-grow", text: nameOf(st, x.aid) }), el("span", { class: "sv-small", text: bondLabel(x.v) + " " + Math.round(x.v) })]);
    })) : el("p", { class: "sv-small sv-muted", text: t("sv_plus_none") }));
    return { title: t("sv_plus_detail"), body: el("div", {}, body) };
  });

  // ---- 工作卡標籤 ----
  if (window.PriTestStarvJobsView) window.PriTestStarvJobsView.addTag(function (st, job) {
    if (job.duel) return el("span", { class: "sv-chip sv-plus-bad", text: t("sv_plus_tag_duel", { names: names(st, job.pair) }) });
    if (job.ip) {
      var ip = Plus.ipById(st, job.ip);
      return el("span", { class: "sv-chip sv-chip-work", text: t(job.adapt ? "sv_plus_tag_adapt" : "sv_plus_tag_seq", { n: job.seq }) + (ip ? "・" + t("sv_plus_tag_cast", { names: names(st, ip.cast) }) : "") });
    }
    if (B.clutchTiers.indexOf(job.tier) >= 0) return el("span", { class: "sv-chip", text: t("sv_plus_tag_clutch") });
    return null;
  });

  // ---- 事件結果的擴充效果 ----
  if (window.PriTestStarvEventsUI) window.PriTestStarvEventsUI.addFx(function (st, fx) {
    var out = [];
    function signed(v) { return (v >= 0 ? "+" : "−") + UI.num(Math.abs(v)); }
    if (fx.core) out.push(t("sv_plus_fx_core", { v: signed(fx.core) }));
    if (fx.anti) out.push(t("sv_plus_fx_anti", { v: signed(fx.anti) }));
    if (fx.bond) out.push(t("sv_plus_fx_bond", { v: signed(fx.bond) }));
    if (fx.partner) out.push(t("sv_plus_fx_partner"));
    if (fx.chain) out.push(t("sv_plus_fx_chain"));
    return out;
  });

  // ---- 日誌參數 ----
  if (window.PriTestStarvLog) window.PriTestStarvLog.addParams(function (st, e, p) {
    if (!/^plus_/.test(e.type)) return;
    var d = e.data || {};
    if (d.aids) p.names = names(st, d.aids);
    if (d.wish) { var a = Core.artistById(st, d.aid); p.wish = wishText(st, { t: d.wish, p: d.p || {} }); void a; }
    if (d.goal) p.goal = goalText({ t: d.goal, n: d.n });
    if (d.title) p.title = titleOf(d);
    if (d.money != null) p.money = UI.money(d.money);
    if (d.n != null) p.n = UI.num(d.n);
    if (d.fame != null) p.fame = UI.num(d.fame);
    if (d.stat) p.stat = UI.statName(d.stat);
    if (d.gain != null) p.gain = d.gain;
    if (d.tickets != null) p.tickets = d.tickets;
    if (d.q != null) p.q = t("sv_plus_clutch_q" + d.q);
    if (d.strat) p.strat = UI.L(X.STRATS[d.strat].name);
  });

  // 心願、季度目標達成時跳出提示（前景與離線報告都會經過 logWatchers）
  UI.addLogWatcher(function (App, rep) {
    rep.logs.forEach(function (e) {
      if (e.type === "plus_goal_done") UI.toast("🎯 " + t("sv_plus_toast_goal"), "gold");
      else if (e.type === "plus_goal_all") UI.toast("🎉 " + t("sv_plus_goals_all"), "gold");
      else if (e.type === "plus_wish_done") UI.toast("💭 " + t("sv_plus_toast_wish", { name: nameOf(App.st(), e.data.aid) }), "gold");
    });
  });

  window.PriTestStarvPlusUI = { openClutch: openClutch, wishText: wishText, goalText: goalText };
})();
