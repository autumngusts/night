// 明星經紀 starV：「公司」分頁（概況、安全線、存檔匯出入、雲端存檔（starv_cloud_ui.js）、重新開始、?debug=1 的開發工具；規格 §8、§17）。
// 設施升級、導師、名人堂、圖鑑、成就、新紀元在計畫 3、5 加進這個分頁。
(function () {
  "use strict";

  var Core = window.PriTestStarvCore;
  var Store = window.PriTestStarvStore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var ui = { code: "", importText: "", pending: null, confirmReset: false };

  function infoCard(st, App) {
    var c = st.company, next = Core.nextLevelRep(st);
    var safe = el("input", { class: "sv-input", type: "number", min: "0", step: "1000", value: String(c.safeLine), "data-act": "safe-line",
      onchange: function () { App.act(function (s) { Core.setSafeLine(s, Number(safe.value)); }); } });
    return el("div", { class: "sv-card" }, [
      el("h3", { text: t("sv_co_title") }),
      el("div", { class: "sv-co-name", text: c.name || t("sv_company_default") }),
      el("div", { text: t("sv_co_level", { lv: c.level }) }),
      el("div", { class: "sv-small sv-muted", text: next === null ? t("sv_co_rep_max", { rep: UI.num(c.rep) }) : t("sv_co_rep", { rep: UI.num(c.rep), next: UI.num(next) }) }),
      UI.bar(next === null ? 1 : c.rep, next === null ? 1 : next, "sv-bar-sat"),
      el("div", { class: "sv-row" }, [
        el("span", { class: "sv-chip", text: t("sv_co_money", { m: UI.money(c.money) }) }),
        el("span", { class: "sv-chip", text: t("sv_tickets", { n: c.tickets }) }),
        el("span", { class: "sv-chip", text: t("sv_co_artists", { n: st.artists.length, cap: Core.capacity(st) }) })
      ]),
      el("label", { class: "sv-field" }, [el("span", { text: t("sv_co_safe") }), safe, el("span", { class: "sv-small sv-muted", text: t("sv_co_safe_hint") })])
    ]);
  }

  function facilitiesCard(st, App) {
    var D = window.PriTestStarvData;
    return el("div", { class: "sv-card" }, [el("h3", { text: t("sv_fac_title") })].concat(D.FACILITY_ORDER.map(function (f) {
      var F = D.FACILITIES[f], lv = st.facilities[f], cap = Core.facilityCap(st, f), cost = Core.facilityCost(st, f);
      var action;
      if (cost === null) action = el("span", { class: "sv-small sv-muted", text: t("sv_fac_max") });
      else if (lv >= cap) action = el("span", { class: "sv-small sv-muted", text: t("sv_fac_need_level") });
      else action = UI.btn(t("sv_fac_up", { cost: UI.money(cost) }), function () {
        var err = App.act(function (s) { return Core.upgradeFacility(s, f); });
        if (err) UI.toast(t("sv_err_" + err), "bad");
      }, st.company.money >= cost ? "sv-btn-gold" : "sv-btn-ghost", { "data-act": "fac-up-" + f });
      return el("div", { class: "sv-fac" }, [
        el("div", { class: "sv-grow" }, [
          el("div", {}, [el("b", { text: UI.L(F.name) }), " ", el("span", { class: "sv-chip", text: t("sv_fac_lv", { lv: lv, cap: F.max }) })]),
          el("div", { class: "sv-small sv-muted", text: UI.L(F.desc) + (f === "dorm" ? "・" + t("sv_fac_dorm_cap", { n: Core.capacity(st) }) : "") })
        ]),
        action
      ]);
    })));
  }

  function stageCard() {
    var S = window.PriTestStarvStage3D;
    return el("div", { class: "sv-card" }, [
      el("label", { class: "sv-field" }, [
        el("span", { text: t("sv_stage_quality") }),
        UI.select(["high", "low", "off"].map(function (q) { return { value: q, label: t("sv_stage_q_" + q) }; }), S.quality(),
          function (v) { S.setQuality(v); }, { "data-act": "stage-quality" }),
        el("span", { class: "sv-small sv-muted", text: t("sv_stage_quality_hint") })
      ])
    ]);
  }

  function saveCard(st, App) {
    var importBox = el("textarea", { class: "sv-textarea", placeholder: t("sv_save_import_ph"), "data-act": "save-import-text", value: ui.importText,
      oninput: function () { ui.importText = importBox.value; ui.pending = null; } });
    var rows = [
      el("h3", { text: t("sv_save") }),
      el("p", { class: "sv-small sv-muted", text: t("sv_save_hint") }),
      el("div", { class: "sv-row" }, [UI.btn(t("sv_save_export"), function () { ui.code = Store.encode(App.st()); App.render(); }, "", { "data-act": "save-export" })])
    ];
    if (ui.code) {
      rows.push(el("textarea", { class: "sv-textarea", readonly: true, "data-act": "save-code", value: ui.code }));
      rows.push(el("div", { class: "sv-row" }, [UI.btn(t("sv_save_copy"), function () {
        try { navigator.clipboard.writeText(ui.code).then(function () { UI.toast(t("sv_save_copied")); }); } catch (e) { /* 不支援就手動複製 */ }
      }, "sv-btn-ghost", { "data-act": "save-copy" })]));
    }
    rows.push(importBox);
    rows.push(el("div", { class: "sv-row" }, [
      UI.btn(t("sv_save_import"), function () {
        try { ui.pending = Store.decode(ui.importText); } catch (e) { ui.pending = null; UI.toast(t("sv_err_import"), "bad"); }
        App.render();
      }, "", { "data-act": "save-import" }),
      ui.pending ? UI.btn(t("sv_save_import_confirm"), function () {
        var next = ui.pending;
        ui.pending = null; ui.importText = ""; ui.code = "";
        App.replaceState(next);
        UI.toast(t("sv_save_imported"), "gold");
      }, "sv-btn-danger", { "data-act": "save-import-confirm" }) : null
    ]));
    rows.push(el("div", { class: "sv-row sv-row-end" }, [
      ui.confirmReset
        ? UI.btn(t("sv_save_reset_confirm"), function () { App.reset(); }, "sv-btn-danger", { "data-act": "save-reset-confirm" })
        : UI.btn(t("sv_save_reset"), function () { ui.confirmReset = true; App.render(); }, "sv-btn-ghost", { "data-act": "save-reset" })
    ]));
    return el("div", { class: "sv-card" }, rows);
  }

  function debugCard(st, App) {
    return el("div", { class: "sv-card sv-debug" }, [
      el("h3", { text: t("sv_debug") }),
      el("div", { class: "sv-row" }, [el("span", { text: t("sv_debug_speed") })].concat([1, 10, 60].map(function (n) {
        return UI.btn("×" + n, function () { App.setSpeed(n); }, App.speed() === n ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "debug-speed-" + n });
      }))),
      el("div", { class: "sv-row" }, [
        UI.btn(t("sv_debug_money"), function () { App.act(function (s) { s.company.money += 100000; }); }, "", { "data-act": "debug-money" }),
        UI.btn(t("sv_debug_tickets"), function () { App.act(function (s) { s.company.tickets += 10; }); }, "", { "data-act": "debug-tickets" }),
        UI.btn(t("sv_debug_skip", { n: 7 }), function () { App.skip(7); }, "", { "data-act": "debug-skip-7" }),
        UI.btn(t("sv_debug_skip", { n: 30 }), function () { App.skip(30); }, "", { "data-act": "debug-skip-30" }),
        UI.btn(t("sv_debug_event"), function () { App.act(function (s) { Core.triggerRandomEvent(s); }); }, "", { "data-act": "debug-event" }),
        UI.btn(t("sv_debug_awards"), function () { App.act(function (s) { Core.holdAwards(s); }); }, "", { "data-act": "debug-awards" })
      ])
    ]);
  }

  UI.register({
    id: "company", order: 90, icon: "🏢", labelKey: "sv_tab_company",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(infoCard(st, App));
      c.appendChild(facilitiesCard(st, App));
      c.appendChild(stageCard());
      var cloud = window.PriTestStarvCloudUI && window.PriTestStarvCloudUI.card(App);
      if (cloud) c.appendChild(cloud);
      c.appendChild(saveCard(st, App));
      if (App.debug) c.appendChild(debugCard(st, App));
    }
  });
})();
