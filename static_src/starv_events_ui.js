// 明星經紀 starV：重大事件的畫面（事件卡、頂部鈴鐺、新事件自動彈出、效果摘要；規格 §7）。
// 選項只顯示傾向（hint），選完才顯示實際變化。新事件只在沒有其他彈窗時自動彈出一次；
// 關掉沒選的事件留在鈴鐺裡，期限到了由 Core 自動套用預設選項。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var shown = {};

  function signed(v, fmt) { return (v >= 0 ? "+" : "−") + (fmt ? fmt(Math.abs(v)) : Math.abs(v)); }
  function leftName(info) { return Core.artistName({ rosterId: info.rosterId || null, nameSeed: info.nameSeed || 0, gender: info.gender || "f" }, UI.lang()); }

  function fxLines(st, fx, ev) {
    var out = [];
    if (fx.money) out.push(t("sv_fx_money", { v: signed(fx.money, UI.money) }));
    if (fx.tickets) out.push(t("sv_fx_tickets", { v: signed(fx.tickets) }));
    if (fx.rep) out.push(t("sv_fx_rep", { v: signed(fx.rep, UI.num) }));
    ["fame", "stress", "stamina", "satisfaction", "mood"].forEach(function (k) {
      if (fx[k]) out.push(t("sv_fx_" + k, { v: signed(fx[k], UI.num) }));
    });
    if (fx.salary) out.push(t("sv_fx_salary", { v: signed(fx.salary, UI.money) }));
    if (fx.statAll) out.push(t("sv_fx_statAll", { v: signed(fx.statAll) }));
    if (fx.stat) Object.keys(fx.stat).forEach(function (s) { out.push(t("sv_fx_stat", { stat: UI.statName(s), v: signed(fx.stat[s]) })); });
    if (fx.rest) out.push(t("sv_fx_rest", { n: fx.rest }));
    if (fx.job) out.push(t("sv_fx_job"));
    if (fx.leave && ev) out.push(t("sv_fx_leave", { name: ev.name }));
    if (fx.sold) out.push(t("sv_fx_sold", { name: leftName(fx.sold) }));
    if (fx.loan) out.push(t("sv_fx_loan", { m: UI.money(fx.loan.monthly), n: fx.loan.months }));
    if (fx.allStress) out.push(t("sv_fx_allStress", { v: signed(fx.allStress) }));
    if (fx.allSatisfaction) out.push(t("sv_fx_allSatisfaction", { v: signed(fx.allSatisfaction) }));
    if (fx.allSalaryPct) out.push(t("sv_fx_allSalaryPct", { v: signed(Math.round(fx.allSalaryPct * 100)) }));
    if (fx.rivalPower) out.push(t("sv_fx_rivalPower", { rival: UI.rivalName(st, fx.rival), v: signed(fx.rivalPower) }));
    if (fx.renewed) out.push(t("sv_fx_renewed"));
    if (fx.refused && ev) out.push(t("sv_fx_refused", { name: ev.name }));
    if (fx.retired && ev) out.push(t(fx.retired.hof ? "sv_fx_retired_hof" : "sv_fx_retired", { name: ev.name }));
    if (fx.retained && ev) out.push(t("sv_fx_retained", { name: ev.name }));
    return out;
  }

  function fill(text, vars) {
    return text.replace(/\{name\}/g, vars.name).replace(/\{n\}/g, vars.n == null ? "" : UI.num(vars.n))
      .replace(/\{rival\}/g, vars.rival || "").replace(/\{star\}/g, vars.star || "");
  }

  function open(App, uid) {
    shown[uid] = true;
    var result = null, name = "";
    UI.openModal(function (box, close) {
      var st = App.st(), e = null;
      st.events.pending.forEach(function (x) { if (x.uid === uid) e = x; });
      if (!e && !result) { close(); return; }
      var ev = D.EVENT_BY_ID[(e || result).id];
      var a = e && e.aid ? Core.artistById(st, e.aid) : null;
      if (a) name = UI.name(a);
      box.appendChild(UI.modalHead(UI.L(ev.title), close));
      box.appendChild(el("div", { class: "sv-ev-meta" }, [
        el("span", { class: "sv-chip sv-evcat-" + ev.category, text: t("sv_evcat_" + ev.category) }),
        a ? UI.avatar(a, 40) : null,
        el("b", { text: a ? name : (ev.target === "none" ? t("sv_ev_company") : name) })
      ]));
      var ctx = (e || result).ctx;
      var starName = ctx.star ? Core.rivalStarName({ rosterId: ctx.star }, UI.lang()) : "";
      box.appendChild(el("p", { class: "sv-ev-text", text: fill(UI.L(ev.text), { name: name, n: ctx.n, rival: ctx.rival ? UI.rivalName(st, ctx.rival) : "", star: starName }) }));
      if (result) {
        var lines = fxLines(st, result.fx, { name: name });
        box.appendChild(el("div", { class: "sv-ev-result" + (result.bad ? " sv-ev-bad" : "") }, [
          el("h3", { text: t(result.bad ? "sv_ev_result_bad" : "sv_ev_result_good") }),
          el("div", { class: "sv-small sv-muted", text: UI.L(ev.choices[result.choice].label) }),
          lines.length ? el("ul", {}, lines.map(function (l) { return el("li", { text: l }); })) : el("p", { class: "sv-muted", text: t("sv_ev_nothing") })
        ]));
        box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "event-result-close" })]));
        return;
      }
      box.appendChild(el("p", { class: "sv-small sv-warn", text: t("sv_ev_deadline", { n: Math.max(0, e.deadline - st.day), def: UI.L(ev.choices[ev.defaultChoice].label) }) }));
      box.appendChild(el("div", { class: "sv-ev-choices" }, ev.choices.map(function (c, i) {
        return el("button", {
          type: "button", class: "sv-ev-choice", "data-act": "event-choice-" + i, "data-default": i === ev.defaultChoice ? "1" : null,
          onclick: function () {
            // result 要在 App.act 的函式裡設定：act 執行完會立刻重畫 live 彈窗，
            // 那時事件已經從 pending 移除，若 result 還沒設定，彈窗會被當成「事件不見了」而關掉
            var r = App.act(function (s) {
              var x = Core.resolveEvent(s, uid, i);
              if (!x.err) result = { id: ev.id, ctx: e.ctx, choice: i, fx: x.fx, bad: x.bad };
              return x;
            });
            if (r.err) { UI.toast(t("sv_err_" + r.err), "bad"); close(); }
          }
        }, [el("b", { text: UI.L(c.label) }), el("span", { class: "sv-small sv-muted", text: UI.L(c.hint) })]);
      })));
    }, { live: true, cls: "sv-event" });
  }

  // 頂部鈴鐺：有待處理事件才出現，點了打開最早的一件
  UI.addTopItem(function (App) {
    var st = App.st(), list = st.events ? st.events.pending : [];
    if (!list.length) return null;
    return el("button", { type: "button", class: "sv-chip sv-bell", "data-act": "event-bell", text: t("sv_ev_bell", { n: list.length }),
      onclick: function () { open(App, list[0].uid); } });
  });

  // 每次重畫時檢查：有還沒彈過的新事件、而且畫面上沒有其他彈窗 → 自動彈出
  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.events || UI.modalIsOpen()) return null;
    var e = st.events.pending.filter(function (x) { return !shown[x.uid]; })[0];
    if (e) setTimeout(function () { if (!UI.modalIsOpen()) open(App, e.uid); }, 0);
    return null;
  });

  window.PriTestStarvEventsUI = { open: open, fxLines: fxLines };
})();
