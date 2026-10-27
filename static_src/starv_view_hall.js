// 明星經紀 starV：「殿堂」分頁（名人堂與導師／製作人、圖鑑、成就、作品年表、新紀元；規格 §11、§13、§14）。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Roster = window.PriTestStarvRoster;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var SUBS = ["hall", "codex", "ach", "timeline", "era"];
  var view = { sub: "hall", hire: {}, carry: "", confirm: false };

  function report(err) { if (err) UI.toast(t("sv_err_" + err), "bad"); }
  function dirOpts() { return D.DIRS.map(function (d) { return { value: d.id, label: d.icon + " " + UI.L(d.name) }; }); }

  function hallView(st, App) {
    var wrap = el("div", {});
    wrap.appendChild(el("p", { class: "sv-small", text: t("sv_staff_slots", { n: st.staff.length, cap: Core.staffSlots(st) }) }));
    wrap.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_staff_hint") }));
    if (!st.hall.length) { wrap.appendChild(el("div", { class: "sv-card sv-muted", text: t("sv_hall_empty", { n: D.BAL.hofScore }) })); return wrap; }
    wrap.appendChild(el("div", { class: "sv-hall-grid" }, st.hall.slice().reverse().map(function (h) {
      var staff = null;
      st.staff.forEach(function (s) { if (s.hofId === h.id) staff = s; });
      var choice = view.hire[h.id] || (view.hire[h.id] = { role: "mentor", dir: h.dir });
      var body = [
        UI.avatar({ look: h.look, rarity: h.rarity, dir: h.dir }, 64),
        el("b", { text: UI.hallName(h) }),
        el("div", { class: "sv-small sv-muted", text: t("sv_hall_entry", { era: h.era, dir: UI.dirName(h.dir), score: h.score }) }),
        el("div", { class: "sv-small sv-warn", text: "🏆 " + h.trophies.length })
      ];
      if (staff) {
        body.push(el("div", { class: "sv-small", text: t("sv_staff_now", { role: t("sv_role_" + staff.role), dir: UI.dirName(staff.dir), m: UI.money(staff.salary), p: Math.round(Core.staffBonus(h) * 100) }) }));
        body.push(UI.btn(t("sv_staff_fire"), function () { App.act(function (s) { Core.fireStaff(s, h.id); }); }, "sv-btn-ghost", { "data-act": "fire-" + h.id }));
      } else {
        body.push(UI.select([{ value: "mentor", label: t("sv_role_mentor") }, { value: "producer", label: t("sv_role_producer") }], choice.role,
          function (v) { choice.role = v; }, { "data-act": "hire-role-" + h.id }));
        body.push(UI.select(dirOpts(), choice.dir, function (v) { choice.dir = v; }, { "data-act": "hire-dir-" + h.id }));
        body.push(UI.btn(t("sv_staff_hire"), function () { report(App.act(function (s) { return Core.hireStaff(s, h.id, choice.role, choice.dir); })); }, "sv-btn-gold", { "data-act": "hire-" + h.id }));
      }
      return el("div", { class: "sv-card sv-hall-card" }, body);
    })));
    return wrap;
  }

  function openStory(e) {
    UI.openModal(function (box, close) {
      box.appendChild(UI.modalHead(UI.L(e.name), close));
      box.appendChild(el("div", { class: "sv-retire-hero" }, [UI.avatar(e, 120)]));
      box.appendChild(el("p", { class: "sv-story", text: UI.L(e.story) }));
    }, { cls: "sv-story-modal" });
  }

  function codexView(st) {
    var c = Core.codexStats(st);
    var list = Roster.byRarity("SSR").concat(Roster.byRarity("SR"));
    return el("div", {}, [
      el("p", { class: "sv-small", text: t("sv_codex_summary", c) }),
      el("div", { class: "sv-codex-grid" }, list.map(function (e) {
        var owned = !!st.codex.owned[e.id];
        if (!owned) return el("div", { class: "sv-codex-card sv-codex-locked" }, [el("span", { class: "sv-ava sv-ava-ghost", style: "--sv-size:56px" }), UI.rarity(e.rarity), el("div", { text: "？？？" })]);
        var story = e.story && st.codex.stories[e.id];
        return el("div", { class: "sv-codex-card" }, [
          UI.avatar(e, 56), UI.rarity(e.rarity), el("b", { text: UI.L(e.name) }),
          el("div", { class: "sv-small sv-muted", text: UI.dirIcon(e.dir) + " " + UI.dirName(e.dir) }),
          e.story ? (story ? UI.btn(t("sv_codex_story"), function () { openStory(e); }, "sv-btn-gold", { "data-act": "story-" + e.id })
            : el("div", { class: "sv-small sv-muted", text: t("sv_codex_story_locked") })) : null
        ]);
      }))
    ]);
  }

  function achView(st) {
    var all = D.ACHIEVEMENTS || [], done = all.filter(function (x) { return st.achievements[x.id]; }).length;
    return el("div", {}, [
      el("p", { class: "sv-small", text: t("sv_ach_summary", { n: done, total: all.length }) }),
      el("ul", { class: "sv-ach-list" }, all.map(function (x) {
        var got = st.achievements[x.id];
        return el("li", { class: got ? "sv-ach-done" : "" }, [
          el("span", { class: "sv-ach-icon", text: got ? "🏅" : "🔒" }),
          el("div", { class: "sv-grow" }, [el("b", { text: UI.L(x.name) }), el("div", { class: "sv-small sv-muted", text: UI.L(x.desc) })]),
          el("span", { class: "sv-small", text: t("sv_ach_reward", { n: x.reward.tickets || 0 }) })
        ]);
      }))
    ]);
  }

  function tlText(st, x) {
    var d = x.data || {};
    if (x.kind === "award") {
      var aw = D.AWARD_BY_ID[d.award];
      return t("sv_tl_award", { name: window.PriTestStarvAwardsUI.nomineeName(st, d.nominee), award: aw ? UI.L(aw.name) : d.award });
    }
    if (x.kind === "retire" || x.kind === "hof") return t("sv_tl_" + x.kind, { name: UI.hallName(d) });
    if (x.kind === "level") return t("sv_tl_level");
    if (x.kind === "era") return t("sv_tl_era", { era: d.era });
    if (x.kind === "project") {
      var pj = D.PROJECT_BY_ID && D.PROJECT_BY_ID[d.project];
      return t("sv_tl_project", { title: pj ? UI.L(pj.name) : d.project, result: t("sv_proj_result_" + d.result) });
    }
    return x.kind;
  }
  function timelineView(st) {
    if (!st.timeline.length) return el("p", { class: "sv-muted", text: t("sv_timeline_empty") });
    return el("ul", { class: "sv-log-list" }, st.timeline.map(function (x) {
      var dt = Core.dateOf(x.day);
      return el("li", { class: "sv-log-line" }, [
        el("span", { class: "sv-log-day", text: t("sv_date_era", { era: x.era, date: t("sv_date", { y: dt.year, m: dt.month, d: dt.day }) }) }),
        el("span", { text: tlText(st, x) })
      ]);
    }));
  }

  function eraView(st, App) {
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "sv-card" }, [
      el("h3", { text: t("sv_era_points", { n: st.legacy.points }) }),
      el("p", { class: "sv-small", text: t("sv_era_gain", { n: Core.legacyPoints(st) }) })
    ].concat(D.LEGACY_PERKS.map(function (p) {
      var lv = st.legacy.perks[p.id] || 0;
      return el("div", { class: "sv-fac" }, [
        el("div", { class: "sv-grow" }, [el("b", { text: UI.L(p.name) }), " ", el("span", { class: "sv-chip", text: t("sv_perk_lv", { lv: lv, max: p.max }) }),
          el("div", { class: "sv-small sv-muted", text: UI.L(p.desc) })]),
        lv >= p.max ? el("span", { class: "sv-small sv-muted", text: t("sv_perk_max") })
          : UI.btn(t("sv_perk_buy", { n: p.cost[lv] }), function () { report(App.act(function (s) { return Core.buyPerk(s, p.id); })); },
            st.legacy.points >= p.cost[lv] ? "sv-btn-gold" : "sv-btn-ghost", { "data-act": "perk-" + p.id })
      ]);
    }))));
    var card = el("div", { class: "sv-card" }, [el("h3", { text: t("sv_hall_sub_era") }), el("p", { class: "sv-small", text: t("sv_era_desc") })]);
    if (st.company.level < 10) card.appendChild(el("p", { class: "sv-warn", text: t("sv_era_need") }));
    else {
      card.appendChild(el("label", { class: "sv-field" }, [el("span", { class: "sv-small", text: t("sv_era_carry") }),
        UI.select([{ value: "", label: t("sv_era_carry_none") }].concat(st.artists.map(function (a) { return { value: a.id, label: UI.name(a) }; })),
          view.carry, function (v) { view.carry = v; }, { "data-act": "era-carry" })]));
      card.appendChild(el("div", { class: "sv-row sv-row-end" }, [view.confirm
        ? UI.btn(t("sv_era_confirm", { era: st.era + 1 }), function () {
          view.confirm = false;
          report(App.act(function (s) { return Core.newEra(s, view.carry || null); }));
          view.carry = "";
        }, "sv-btn-danger", { "data-act": "era-confirm" })
        : UI.btn(t("sv_era_start"), function () { view.confirm = true; App.render(); }, "sv-btn-primary", { "data-act": "era-start" })]));
    }
    wrap.appendChild(card);
    return wrap;
  }

  UI.register({
    id: "hall", order: 50, icon: "🏛️", labelKey: "sv_tab_hall",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(el("div", { class: "sv-subtabs" }, SUBS.map(function (k) {
        return UI.btn(t("sv_hall_sub_" + k), function () { view.sub = k; view.confirm = false; App.render(); }, view.sub === k ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "hall-sub-" + k });
      })));
      var body = { hall: hallView, codex: codexView, ach: achView, timeline: timelineView, era: eraView }[view.sub];
      c.appendChild(body(st, App));
    }
  });
})();
