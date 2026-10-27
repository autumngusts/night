// 明星經紀 starV：「工作」分頁（企劃書風格的看板、選角、進行中工作、組合；規格 §6.2–§6.4、§15.2）。
// 預估成功率只顯示「高／中／低」與適配星數，不顯示確切數值。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  var view = { sub: "board", dir: "", tier: "" };
  var draft = { name: "", members: {} };

  function fitStars(ratio) { var n = ratio >= 1.4 ? 5 : ratio >= 1.0 ? 4 : ratio >= 0.85 ? 3 : ratio >= 0.7 ? 2 : 1; return new Array(n + 1).join("★"); }
  function title(job) { return Core.jobTitle(job, UI.lang()); }
  function names(st, ids) {
    return ids.map(function (id) { var a = Core.artistById(st, id); return a ? UI.name(a) : "—"; }).join("、");
  }

  function jobCard(st, job, onclick) {
    var d = D.DIR_BY_ID[job.dir];
    return el("div", {
      class: "sv-job sv-tier-" + job.tier, style: "--sv-dc:" + d.color, "data-job": job.id,
      role: onclick ? "button" : null, tabindex: onclick ? "0" : null, onclick: onclick || null
    }, [
      el("div", { class: "sv-job-poster" }, [el("span", { class: "sv-job-icon", text: d.icon }), el("span", { class: "sv-job-tier", text: job.tier })]),
      el("div", { class: "sv-job-body" }, [
        el("div", { class: "sv-job-title", text: title(job) }),
        el("div", { class: "sv-small sv-muted", text: [UI.dirName(job.dir), UI.L(D.ROLES[job.role].name), t("sv_job_days", { n: job.days }),
          job.slots > 1 ? t("sv_job_slots", { n: job.slots }) : null].filter(Boolean).join("・") }),
        el("div", { class: "sv-job-pay", text: UI.money(job.pay) }),
        el("div", { class: "sv-small sv-muted", text: t("sv_job_req", { fame: UI.num(job.minFame), prof: job.minProf }) +
          (job.expires != null ? "・" + t("sv_job_expires", { n: job.expires - st.day }) : "") }),
        job.isWork ? el("span", { class: "sv-chip sv-chip-work", text: t("sv_job_work") }) : null
      ])
    ]);
  }

  function openCasting(App, jobId) {
    var sel = [], signed = false;
    UI.openModal(function (box, close) {
      var st = App.st(), job = null;
      st.board.forEach(function (j) { if (j.id === jobId) job = j; });
      // 簽約成功後 App.act 會立刻重畫這個 live 彈窗，那時工作已經離開看板：只有「不是自己簽走的」才提示錯誤
      if (!job) { close(); if (!signed) UI.toast(t("sv_err_noJob"), "bad"); return; }
      sel = sel.filter(function (id) { var a = Core.artistById(st, id); return a && !Core.eligible(st, a, job); });
      box.appendChild(UI.modalHead(t("sv_cast_title"), close));
      box.appendChild(jobCard(st, job, null));
      var rows = st.artists.map(function (a) {
        return { a: a, err: Core.eligible(st, a, job), est: Core.estimate(st, [a.id], job) };
      }).sort(function (x, y) { return (x.err ? 1 : 0) - (y.err ? 1 : 0) || y.est.ratio - x.est.ratio; });
      box.appendChild(el("p", { class: "sv-small", text: t("sv_cast_pick", { n: job.slots, k: sel.length }) }));
      box.appendChild(el("div", { class: "sv-cast-list" }, rows.map(function (r) {
        var on = sel.indexOf(r.a.id) >= 0;
        return el("div", {
          class: "sv-cast-row" + (on ? " sv-sel" : "") + (r.err ? " sv-dis" : ""), "data-aid": r.a.id, role: "button", tabindex: "0",
          onclick: function () {
            if (r.err) return;
            var i = sel.indexOf(r.a.id);
            if (i >= 0) sel.splice(i, 1);
            else if (sel.length < job.slots) sel.push(r.a.id);
            else if (job.slots === 1) sel = [r.a.id];
            UI.refreshModal();
          }
        }, [
          UI.avatar(r.a, 40),
          el("div", { class: "sv-grow" }, [
            el("div", {}, [UI.rarity(r.a.rarity), " ", el("b", { text: UI.name(r.a) })]),
            el("div", { class: "sv-small sv-muted", text: r.err ? t("sv_err_" + r.err) : UI.dirIcon(r.a.dir) + " " + UI.dirName(r.a.dir) + "・" + t("sv_fame", { n: UI.num(r.a.fame) }) })
          ]),
          r.err ? null : el("div", { class: "sv-est sv-est-" + r.est.label }, [
            el("div", { text: t("sv_est", { label: t("sv_est_" + r.est.label) }) }),
            el("div", { class: "sv-stars", text: fitStars(r.est.ratio) })
          ])
        ]);
      })));
      var ready = sel.length === job.slots;
      var team = ready && job.slots > 1 ? Core.estimate(st, sel, job) : null;
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [
        team ? el("span", { class: "sv-est sv-est-" + team.label, text: t("sv_cast_team", { label: t("sv_est_" + team.label) }) }) : null,
        UI.btn(t("sv_cast_sign"), function () {
          var name = title(job);
          var err = App.act(function (s) { var x = Core.takeJob(s, job.id, sel); signed = !x; return x; });
          if (err) { UI.toast(t("sv_err_" + err), "bad"); return; }
          close();
          UI.toast(t("sv_toast_signed", { title: name }), "stamp");
        }, "sv-btn-primary", { "data-act": "cast-sign", disabled: !ready })
      ]));
    }, { live: true, cls: "sv-modal-wide sv-casting" });
  }

  function activeList(st) {
    if (!st.activeJobs.length) return null;
    return el("div", { class: "sv-card" }, [
      el("h3", { text: t("sv_jobs_active") }),
      el("div", {}, st.activeJobs.map(function (aj) {
        return el("div", { class: "sv-active-row" }, [
          el("span", { class: "sv-job-mini-icon", text: UI.dirIcon(aj.job.dir) }),
          el("div", { class: "sv-grow" }, [
            el("div", { text: title(aj.job) }),
            el("div", { class: "sv-small sv-muted", text: t("sv_job_members", { names: names(st, aj.members) }) }),
            UI.bar(aj.job.days - aj.left, aj.job.days)
          ]),
          el("span", { class: "sv-small", text: t("sv_job_days", { n: aj.left }) })
        ]);
      }))
    ]);
  }

  function board(st, App) {
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "sv-toolbar" }, [
      UI.select([{ value: "", label: t("sv_filter_all_dirs") }].concat(D.DIRS.map(function (d) { return { value: d.id, label: d.icon + " " + UI.L(d.name) }; })),
        view.dir, function (v) { view.dir = v; App.render(); }),
      UI.select([{ value: "", label: t("sv_filter_all_tiers") }].concat(D.TIER_ORDER.map(function (x) { return { value: x, label: x }; })),
        view.tier, function (v) { view.tier = v; App.render(); }),
      el("span", { class: "sv-small sv-muted", text: t("sv_jobs_refresh", { n: Math.max(0, st.boardRefreshDay - st.day) }) })
    ]));
    var active = activeList(st);
    if (active) wrap.appendChild(active);
    var jobs = st.board.filter(function (j) {
      return (!view.dir || j.dir === view.dir) && (!view.tier || j.tier === view.tier);
    }).sort(function (x, y) { return TIER_RANK[x.tier] - TIER_RANK[y.tier] || y.pay - x.pay; });
    wrap.appendChild(jobs.length
      ? el("div", { class: "sv-jobs" }, jobs.map(function (j) { return jobCard(st, j, function () { openCasting(App, j.id); }); }))
      : el("div", { class: "sv-card sv-empty", text: t("sv_jobs_empty") }));
    return wrap;
  }

  function groups(st, App) {
    var wrap = el("div", {});
    if (!st.groups.length) wrap.appendChild(el("div", { class: "sv-card sv-muted", text: t("sv_groups_empty") }));
    st.groups.forEach(function (g) {
      wrap.appendChild(el("div", { class: "sv-card sv-group" }, [
        el("div", { class: "sv-row" }, [
          el("b", { class: "sv-grow", text: g.name }),
          UI.btn(t("sv_group_disband"), function () { App.act(function (s) { Core.disbandGroup(s, g.id); }); }, "sv-btn-ghost", { "data-act": "group-disband" })
        ]),
        el("div", { class: "sv-group-avatars" }, g.members.map(function (id) { var a = Core.artistById(st, id); return a ? UI.avatar(a, 44) : null; })),
        el("div", { class: "sv-small sv-muted", text: t("sv_group_info", { jobs: g.jobs, chem: Math.round(Core.chemistry(st, g.members) * 100), fame: UI.num(g.fame) }) })
      ]));
    });
    var taken = {};
    st.groups.forEach(function (g) { g.members.forEach(function (id) { taken[id] = true; }); });
    var free = st.artists.filter(function (a) { return !taken[a.id]; });
    Object.keys(draft.members).forEach(function (id) { if (taken[id] || !Core.artistById(st, id)) delete draft.members[id]; });
    var nameInput = el("input", { class: "sv-input", maxlength: "20", placeholder: t("sv_group_name_ph"), value: draft.name, "data-act": "group-name",
      oninput: function () { draft.name = nameInput.value; } });
    wrap.appendChild(el("div", { class: "sv-card" }, [
      el("h3", { text: t("sv_group_create") }),
      el("label", { class: "sv-field" }, [el("span", { class: "sv-small", text: t("sv_group_name") }), nameInput]),
      el("div", { class: "sv-small", text: t("sv_group_members") }),
      free.length ? el("div", { class: "sv-group-pick" }, free.map(function (a) {
        var box = el("input", { type: "checkbox", "data-aid": a.id, checked: !!draft.members[a.id],
          onchange: function () { if (box.checked) draft.members[a.id] = true; else delete draft.members[a.id]; } });
        return el("label", { class: "sv-pick" }, [box, UI.avatar(a, 32), el("span", { text: UI.name(a) })]);
      })) : el("p", { class: "sv-muted sv-small", text: t("sv_group_none_free") }),
      el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_group_create"), function () {
        var res = App.act(function (s) { return Core.createGroup(s, draft.name.trim() || t("sv_jobs_groups"), Object.keys(draft.members)); });
        if (res.err) { UI.toast(t("sv_err_" + res.err), "bad"); return; }
        draft = { name: "", members: {} };
        App.render();
      }, "sv-btn-primary", { "data-act": "group-create" })])
    ]));
    return wrap;
  }

  UI.register({
    id: "jobs", order: 20, icon: "🎬", labelKey: "sv_tab_jobs",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(el("div", { class: "sv-subtabs" }, ["board", "groups"].map(function (k) {
        return UI.btn(t(k === "board" ? "sv_jobs_board" : "sv_jobs_groups"), function () { view.sub = k; App.render(); },
          view.sub === k ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "jobs-sub-" + k });
      })));
      c.appendChild(view.sub === "board" ? board(st, App) : groups(st, App));
    }
  });
})();
