// 明星經紀 starV：「企劃」分頁（大型企劃的選擇、派遣、進度、完成結算；規格 §12）。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var view = { pick: {}, confirmAbort: false };
  var showing = null;

  function report(err) { if (err) UI.toast(t("sv_err_" + err), "bad"); }
  function stageInfo(s) {
    return t("sv_proj_stage_info", { dirs: s.dirs.map(function (d) { return UI.dirIcon(d); }).join(""), min: s.slots[0], max: s.slots[1], tier: s.tier, days: s.days });
  }

  // 企劃一多（計畫 10：30 件），列表只放已解鎖的與接下來 3 件，其餘以一行提示帶過
  function listView(st, App) {
    var open = D.PROJECTS.filter(function (p) { return st.company.level >= p.unlockLevel; });
    var locked = D.PROJECTS.filter(function (p) { return st.company.level < p.unlockLevel; })
      .sort(function (x, y) { return x.unlockLevel - y.unlockLevel; });
    var shown = open.concat(locked.slice(0, 3)), hidden = locked.length - Math.min(3, locked.length);
    var wrap = el("div", { class: "sv-proj-list" }, shown.map(function (p) {
      var locked = st.company.level < p.unlockLevel;
      return el("div", { class: "sv-card sv-proj-card" + (locked ? " sv-proj-locked" : "") }, [
        el("h3", { text: UI.L(p.name) }),
        el("p", { class: "sv-small sv-muted", text: UI.L(p.desc) }),
        el("div", { class: "sv-row" }, [
          el("span", { class: "sv-chip", text: t("sv_proj_cost", { m: UI.money(p.cost) }) }),
          el("span", { class: "sv-chip", text: t("sv_proj_stages", { n: p.stages.length }) })
        ]),
        el("ol", { class: "sv-proj-stages" }, p.stages.map(function (s) { return el("li", { class: "sv-small", text: UI.L(s.name) + "：" + stageInfo(s) }); })),
        locked ? el("div", { class: "sv-warn sv-small", text: t("sv_proj_locked", { lv: p.unlockLevel }) })
          : el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_proj_start"), function () {
            report(App.act(function (s) { return Core.startProject(s, p.id); }));
          }, st.company.money >= p.cost ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "proj-start-" + p.id })])
      ]);
    }));
    if (hidden > 0) wrap.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_proj_more_locked", { n: hidden }) }));
    return wrap;
  }

  function names(st, ids) { return ids.map(function (id) { var a = Core.artistById(st, id); return a ? UI.name(a) : "—"; }).join("、"); }

  function activeView(st, App) {
    var pr = st.project, p = D.PROJECT_BY_ID[pr.id], wrap = el("div", {});
    wrap.appendChild(el("div", { class: "sv-card" }, [
      el("h3", { text: UI.L(p.name) }),
      el("ol", { class: "sv-proj-stages" }, p.stages.map(function (s, i) {
        var r = pr.results[i];
        return el("li", { class: "sv-proj-stage" + (i === pr.stage ? " sv-proj-current" : "") }, [
          el("b", { text: UI.L(s.name) }), " ",
          r ? el("span", { class: "sv-res sv-res-" + r.result, text: t("sv_result_" + r.result) }) : null,
          el("div", { class: "sv-small sv-muted", text: stageInfo(s) })
        ]);
      })),
      pr.mod ? el("div", { class: "sv-small sv-warn", text: t("sv_proj_mod", { v: Math.round(pr.mod * 100) }) }) : null
    ]));
    var stage = p.stages[pr.stage], card = el("div", { class: "sv-card" }, [el("h3", { text: t("sv_proj_now") + "：" + UI.L(stage.name) })]);
    if (pr.active) card.appendChild(el("p", { text: t("sv_proj_running", { names: names(st, pr.active.members), n: pr.active.left }) }));
    else {
      var free = st.artists.filter(function (a) { return !a.task && (stage.dirs.indexOf(a.dir) >= 0 || a.subDirs.some(function (d) { return stage.dirs.indexOf(d) >= 0; })); });
      Object.keys(view.pick).forEach(function (id) { if (!free.some(function (a) { return a.id === id; })) delete view.pick[id]; });
      card.appendChild(el("p", { class: "sv-small", text: t("sv_proj_pick", { min: stage.slots[0], max: stage.slots[1] }) }));
      card.appendChild(free.length ? el("div", { class: "sv-group-pick sv-proj-pick" }, free.map(function (a) {
        var box = el("input", { type: "checkbox", "data-aid": a.id, checked: !!view.pick[a.id],
          onchange: function () { if (box.checked) view.pick[a.id] = true; else delete view.pick[a.id]; } });
        return el("label", { class: "sv-pick" }, [box, UI.avatar(a, 32), el("span", { text: UI.name(a) + " " + UI.dirIcon(a.dir) })]);
      })) : el("p", { class: "sv-muted", text: t("sv_proj_none_free") }));
      card.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_proj_assign"), function () {
        var err = App.act(function (s) { return Core.assignStage(s, Object.keys(view.pick)); });
        if (err) report(err); else view.pick = {};
      }, "sv-btn-primary", { "data-act": "proj-assign" })]));
    }
    wrap.appendChild(card);
    wrap.appendChild(el("div", { class: "sv-row sv-row-end" }, [view.confirmAbort
      ? UI.btn(t("sv_proj_abort_confirm"), function () { view.confirmAbort = false; App.act(function (s) { Core.abortProject(s); }); }, "sv-btn-danger", { "data-act": "proj-abort-confirm" })
      : UI.btn(t("sv_proj_abort"), function () { view.confirmAbort = true; App.render(); }, "sv-btn-ghost", { "data-act": "proj-abort" })]));
    return wrap;
  }

  function openResult(App, q) {
    showing = q.id;
    var p = D.PROJECT_BY_ID[q.project];
    UI.openModal(function (box, close) {
      var st = App.st();
      box.appendChild(UI.modalHead(t("sv_proj_result_title", { name: p ? UI.L(p.name) : q.project }), close));
      box.appendChild(el("h2", { class: "sv-proj-result-head sv-res-text-" + q.result, text: t("sv_proj_result_" + q.result) }));
      box.appendChild(el("ul", { class: "sv-report-list" }, [
        el("li", { text: t("sv_proj_result_money", { m: UI.money(q.money), c: UI.money(q.invested) }) }),
        el("li", { text: t("sv_report_tickets", { v: "+" + q.tickets }) }),
        el("li", { text: t("sv_report_rep", { v: "+" + UI.num(q.rep) }) }),
        el("li", { text: t("sv_proj_result_stages", { list: q.stages.map(function (r) { return t("sv_result_" + r); }).join(" → ") }) })
      ]));
      box.appendChild(el("div", { class: "sv-group-avatars" }, q.members.map(function (id) { var a = Core.artistById(st, id); return a ? UI.avatar(a, 44) : null; })));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "proj-result-close" })]));
    }, { cls: "sv-proj-result", onClose: function () {
      showing = null;
      App.act(function (s) { s.projectQueue = s.projectQueue.filter(function (x) { return x.id !== q.id; }); });
    } });
  }

  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.projectQueue || !st.projectQueue.length || showing || UI.modalIsOpen()) return null;
    var q = st.projectQueue[0];
    setTimeout(function () { if (!showing && !UI.modalIsOpen()) openResult(App, q); }, 0);
    return null;
  });

  UI.register({
    id: "projects", order: 25, icon: "🎪", labelKey: "sv_tab_projects",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_proj_intro") }));
      c.appendChild(st.project ? activeView(st, App) : listView(st, App));
    }
  });
})();
