// 明星經紀 starV：「藝人」分頁（卡片網格、篩選排序、多選批次、藝人詳情與行程安排；規格 §3、§6.1、§6.5、§15.2）。
// 100 人時靠篩選與多選批次管理；詳情彈窗是 live 的，行程結束、數值變化會即時重畫。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Roster = window.PriTestStarvRoster;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var RAR_ORDER = { SSR: 0, SR: 1, R: 2 };
  var MOODS = ["😣", "😟", "🙂", "😊", "😆"];
  var POLICIES = ["idle", "study", "balance", "work"];
  var view = { dir: "", rarity: "", status: "", sort: "rarity", selecting: false, selected: {}, batchPolicy: "balance" };

  function power(a) { var s = 0; D.STATS.forEach(function (k) { s += a.stats[k]; }); return s; }
  function stars(n) { return new Array(n + 1).join("★"); }
  function taskLabel(a) {
    if (!a.task) return t("sv_status_idle");
    return t("sv_task_left", { task: t("sv_task_" + a.task.kind) + (a.task.forced ? "（" + t("sv_forced") + "）" : ""), n: a.task.left });
  }
  function dirOptions(allKey) {
    var opts = allKey ? [{ value: "", label: t(allKey) }] : [];
    return opts.concat(D.DIRS.map(function (d) { return { value: d.id, label: d.icon + " " + UI.L(d.name) }; }));
  }
  function policyOptions() { return POLICIES.map(function (p) { return { value: p, label: t("sv_policy_" + p) }; }); }
  function report(err) { if (err) UI.toast(t("sv_err_" + err), "bad"); }

  function filtered(st) {
    var key = {
      rarity: function (a) { return RAR_ORDER[a.rarity] * 1e6 - power(a); },
      fame: function (a) { return -a.fame; },
      power: function (a) { return -power(a); }
    }[view.sort];
    return st.artists.filter(function (a) {
      if (view.dir && a.dir !== view.dir) return false;
      if (view.rarity && a.rarity !== view.rarity) return false;
      if (view.status === "idle" && a.task) return false;
      if (view.status === "busy" && !a.task) return false;
      return true;
    }).sort(function (x, y) { return key(x) - key(y); });
  }

  function toolbar(st, App) {
    return el("div", { class: "sv-toolbar" }, [
      el("b", { text: t("sv_art_count", { n: st.artists.length, cap: Core.capacity(st) }) }),
      UI.select(dirOptions("sv_filter_all_dirs"), view.dir, function (v) { view.dir = v; App.render(); }),
      UI.select([{ value: "", label: t("sv_filter_all_rar") }, { value: "SSR", label: "SSR" }, { value: "SR", label: "SR" }, { value: "R", label: "R" }],
        view.rarity, function (v) { view.rarity = v; App.render(); }),
      UI.select([{ value: "", label: t("sv_filter_all_status") }, { value: "idle", label: t("sv_status_idle") }, { value: "busy", label: t("sv_status_busy") }],
        view.status, function (v) { view.status = v; App.render(); }),
      UI.select(["rarity", "fame", "power"].map(function (k) { return { value: k, label: t("sv_sort_" + k) }; }), view.sort, function (v) { view.sort = v; App.render(); }),
      UI.btn(t(view.selecting ? "sv_select_done" : "sv_select_mode"), function () {
        view.selecting = !view.selecting; view.selected = {}; App.render();
      }, view.selecting ? "sv-btn-gold" : "sv-btn-ghost", { "data-act": "select-mode" })
    ]);
  }

  function batchBar(st, App) {
    var ids = Object.keys(view.selected).filter(function (id) { return Core.artistById(st, id); });
    function eachIdle(spec) {
      App.act(function (s) { ids.forEach(function (id) { var a = Core.artistById(s, id); if (a && !a.task) Core.schedule(s, id, spec); }); });
    }
    return el("div", { class: "sv-card sv-batch" }, [
      el("b", { text: t("sv_selected", { n: ids.length }) }),
      UI.select(policyOptions(), view.batchPolicy, function (v) { view.batchPolicy = v; }, { "data-act": "batch-policy-select" }),
      UI.btn(t("sv_batch_policy"), function () {
        App.act(function (s) { ids.forEach(function (id) { Core.setPolicy(s, id, view.batchPolicy); }); });
      }, "sv-btn-primary", { "data-act": "batch-policy", disabled: !ids.length }),
      UI.btn(t("sv_batch_train"), function () { eachIdle({ kind: "train" }); }, "sv-btn-ghost", { "data-act": "batch-train", disabled: !ids.length }),
      UI.btn(t("sv_batch_rest"), function () { eachIdle({ kind: "rest", days: 2 }); }, "sv-btn-ghost", { "data-act": "batch-rest", disabled: !ids.length })
    ]);
  }

  function card(App, a) {
    var sel = !!view.selected[a.id];
    return el("div", {
      class: "sv-acard sv-acard-" + a.rarity.toLowerCase() + (sel ? " sv-sel" : "") + (a.task ? "" : " sv-idle"),
      role: "button", tabindex: "0", "data-aid": a.id,
      onclick: function () {
        if (!view.selecting) { openDetail(App, a.id); return; }
        if (sel) delete view.selected[a.id]; else view.selected[a.id] = true;
        App.render();
      }
    }, [
      UI.avatar(a, 64),
      el("div", { class: "sv-acard-name" }, [UI.rarity(a.rarity), " ", UI.name(a)]),
      el("div", { class: "sv-small sv-muted", text: UI.dirIcon(a.dir) + " " + UI.dirName(a.dir) }),
      el("div", { class: "sv-acard-task", text: taskLabel(a) }),
      UI.bar(a.stamina, 100, "sv-bar-stamina"),
      UI.bar(a.stress, 100, "sv-bar-stress"),
      el("div", { class: "sv-small", text: t("sv_fame", { n: UI.num(a.fame) }) })
    ]);
  }

  // ---- 詳情 ----
  function section(title, body) { return el("div", { class: "sv-sec" }, [el("h3", { class: "sv-sec-title", text: title }), body]); }
  function meter(label, v, max, cls) {
    return el("div", { class: "sv-meter" }, [el("span", { class: "sv-small", text: label + " " + Math.round(v) }), UI.bar(v, max, cls)]);
  }

  function dirsEditor(App, a) {
    var subs = a.subDirs.slice();
    function apply(main, list) {
      report(App.act(function (s) { return Core.setDirs(s, a.id, main, list.filter(Boolean)); }));
    }
    var subOpts = [{ value: "", label: t("sv_none") }].concat(dirOptions(null));
    return el("div", { class: "sv-row" }, [
      el("label", { class: "sv-small" }, [t("sv_main_dir") + " ", UI.select(dirOptions(null), a.dir, function (v) { apply(v, subs); }, { "data-act": "dir-main" })]),
      el("label", { class: "sv-small" }, [t("sv_sub_dir") + " ",
        UI.select(subOpts, subs[0] || "", function (v) { apply(a.dir, [v, subs[1]]); }, { "data-act": "dir-sub-0" }),
        UI.select(subOpts, subs[1] || "", function (v) { apply(a.dir, [subs[0], v]); }, { "data-act": "dir-sub-1" })])
    ]);
  }

  function statsTable(a) {
    var w = D.DIR_BY_ID[a.dir].weights;
    return el("div", { class: "sv-stats" }, D.STATS.map(function (s) {
      return el("div", { class: "sv-stat" + (w[s] ? " sv-stat-key" : "") }, [
        el("span", { class: "sv-stat-name", text: UI.statName(s) }),
        el("span", { class: "sv-apt sv-apt-" + a.apt[s], text: a.apt[s] }),
        el("span", { class: "sv-grow" }, [UI.bar(a.stats[s], a.caps[s], "sv-bar-stat")]),
        el("span", { class: "sv-stat-val", text: Math.floor(a.stats[s]) + " / " + a.caps[s] })
      ]);
    }));
  }

  function traitChips(a) {
    var chips = a.traits.map(function (id) {
      var tr = D.TRAIT_BY_ID[id];
      return tr ? el("span", { class: "sv-chip", title: UI.L(tr.desc), text: UI.L(tr.name) }) : null;
    });
    var e = a.rosterId ? Roster.byId(a.rosterId) : null;
    if (e && e.skill) chips.unshift(el("span", { class: "sv-chip sv-chip-skill", title: UI.L(e.skill.desc), text: "★ " + UI.L(e.skill.name) }));
    return chips.length ? el("div", { class: "sv-chips" }, chips) : el("p", { class: "sv-muted", text: t("sv_none") });
  }

  function profList(a) {
    var list = D.DIRS.filter(function (d) { return a.prof[d.id] && (a.prof[d.id].xp > 0 || d.id === a.dir); })
      .sort(function (x, y) { return a.prof[y.id].xp - a.prof[x.id].xp; }).slice(0, 6);
    return el("div", { class: "sv-chips" }, list.map(function (d) {
      return el("span", { class: "sv-chip" + (d.id === a.dir ? " sv-chip-main" : ""), text: d.icon + " " + UI.L(d.name) + " " + t("sv_prof_lv", { lv: a.prof[d.id].lv }) });
    }));
  }

  function actions(App, st, a, ui) {
    if (a.task) return el("p", { text: t("sv_busy_now", { task: taskLabel(a) }) });
    var courseSel = UI.select(D.COURSES.map(function (c) {
      return { value: c.id, label: t("sv_course_opt", { name: UI.courseName(c.id), days: c.days, cost: UI.money(c.cost) }), disabled: !Core.courseAllowed(st, c) };
    }), ui.course, function (v) { ui.course = v; }, { "data-act": "course-select" });
    var restSel = UI.select([1, 2, 3, 4, 5].map(function (n) { return { value: n, label: t("sv_days", { n: n }) }; }), ui.rest,
      function (v) { ui.rest = Number(v); }, { "data-act": "rest-days" });
    function run(spec) { report(App.act(function (s) { return Core.schedule(s, a.id, spec); })); }
    return el("div", {}, [
      el("div", { class: "sv-row" }, [courseSel, UI.btn(t("sv_do_course"), function () { run({ kind: "course", courseId: courseSel.value }); }, "sv-btn-primary", { "data-act": "do-course" })]),
      el("div", { class: "sv-row" }, [
        UI.btn(t("sv_do_train"), function () { run({ kind: "train" }); }, "", { "data-act": "do-train" }),
        restSel, UI.btn(t("sv_do_rest"), function () { run({ kind: "rest", days: ui.rest }); }, "", { "data-act": "do-rest" }),
        UI.btn(t("sv_do_promo", { cost: UI.money(D.PROMO.cost) }), function () { run({ kind: "promo" }); }, "", { "data-act": "do-promo" })
      ]),
      el("div", { class: "sv-row sv-row-end" }, [
        ui.confirmDismiss
          ? UI.btn(t("sv_do_dismiss_confirm", { m: UI.money(a.salary * D.BAL.dismissSalaryMonths) }), function () {
            report(App.act(function (s) { return Core.dismiss(s, a.id); }));
          }, "sv-btn-danger", { "data-act": "do-dismiss-confirm" })
          : UI.btn(t("sv_do_dismiss"), function () { ui.confirmDismiss = true; UI.refreshModal(); }, "sv-btn-ghost", { "data-act": "do-dismiss" })
      ])
    ]);
  }

  function trophyList(a) {
    if (!a.trophies.length) return el("p", { class: "sv-muted sv-trophies", text: t("sv_trophies_none") });
    return el("ul", { class: "sv-trophies" }, a.trophies.slice().reverse().map(function (x) {
      var aw = D.AWARD_BY_ID && D.AWARD_BY_ID[x.award];
      return el("li", { text: "🏆 " + t("sv_trophy_item", { year: x.year, award: aw ? UI.L(aw.name) : x.award }) });
    }));
  }

  function worksList(App, a) {
    if (!a.works.length) return el("p", { class: "sv-muted", text: t("sv_works_empty") });
    return el("ul", { class: "sv-works" }, a.works.slice(0, 10).map(function (w, i) {
      return el("li", {}, [
        el("span", { class: "sv-res sv-res-" + w.result, text: t("sv_result_" + w.result) }),
        el("span", { class: "sv-grow", text: Core.jobTitle(w, UI.lang()) }),
        el("span", { class: "sv-stars", text: stars(w.stars) }),
        // 先關掉藝人詳情：彈窗同時只顯示一個，不關的話演出會排在詳情後面
        UI.btn(t("sv_stage_replay"), function () { UI.closeModal(); window.PriTestStarvStageUI.playWork(App, a, w); }, "sv-btn-ghost sv-btn-icon", { "data-act": "replay-" + i })
      ]);
    }));
  }

  function openDetail(App, aid) {
    var ui = { course: D.COURSES[0].id, rest: 2, confirmDismiss: false };
    UI.openModal(function (box, close) {
      var st = App.st(), a = Core.artistById(st, aid);
      if (!a) { close(); return; }
      var e = a.rosterId ? Roster.byId(a.rosterId) : null;
      box.appendChild(UI.modalHead(UI.name(a), close));
      box.appendChild(el("div", { class: "sv-detail-head" }, [
        UI.avatar(a, 96),
        el("div", { class: "sv-grow" }, [
          el("div", {}, [UI.rarity(a.rarity), " ", a.limitBreak ? el("span", { class: "sv-chip", text: t("sv_lb", { n: a.limitBreak }) }) : null]),
          el("div", { class: "sv-small sv-muted", text: t("sv_age", { n: a.age }) + "・" + t("sv_salary", { m: UI.money(a.salary) }) }),
          el("div", { class: "sv-small sv-muted", text: t("sv_contract", { date: UI.dateText(a.contractEnd) }) + (a.contractEnd - st.day <= 90 ? t("sv_contract_soon") : "") }),
          el("div", { class: "sv-small", text: t("sv_fame", { n: UI.num(a.fame) }) + "　" + t("sv_mood") + " " + MOODS[a.mood + 2] }),
          meter(t("sv_stamina"), a.stamina, 100, "sv-bar-stamina"),
          meter(t("sv_stress"), a.stress, 100, "sv-bar-stress"),
          meter(t("sv_satisfaction"), a.satisfaction, 100, "sv-bar-sat")
        ])
      ]));
      if (e) box.appendChild(el("p", { class: "sv-small sv-muted sv-bio", text: UI.L(e.bio) }));
      box.appendChild(section(t("sv_dirs"), dirsEditor(App, a)));
      box.appendChild(section(t("sv_stats"), statsTable(a)));
      box.appendChild(section(t("sv_traits"), traitChips(a)));
      box.appendChild(section(t("sv_prof"), profList(a)));
      box.appendChild(section(t("sv_policy"), el("div", {}, [
        UI.select(policyOptions(), a.policy, function (v) { report(App.act(function (s) { return Core.setPolicy(s, a.id, v); })); }, { "data-act": "policy-select" }),
        el("p", { class: "sv-small sv-muted", text: t("sv_policy_hint") })
      ])));
      box.appendChild(section(t("sv_actions"), actions(App, st, a, ui)));
      box.appendChild(section(t("sv_trophies"), trophyList(a)));
      box.appendChild(section(t("sv_works"), worksList(App, a)));
    }, { live: true, cls: "sv-modal-detail" });
  }

  UI.register({
    id: "artists", order: 10, icon: "🌟", labelKey: "sv_tab_artists",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(toolbar(st, App));
      if (view.selecting) c.appendChild(batchBar(st, App));
      var list = filtered(st);
      if (!st.artists.length) c.appendChild(el("div", { class: "sv-card sv-empty", text: t("sv_art_empty") }));
      else c.appendChild(el("div", { class: "sv-grid" }, list.map(function (a) { return card(App, a); })));
    }
  });
})();
