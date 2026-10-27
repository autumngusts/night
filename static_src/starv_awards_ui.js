// 明星經紀 starV：頒獎典禮演出（規格 §10）。新一屆在沒有其他彈窗時自動播放；也可以從業界分頁重看歷屆。
// 一次揭曉一個獎項（可以跳到結果），最後列出我們拿到的獎。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Roster = window.PriTestStarvRoster;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var OURS = { artist: 1, work: 1, group: 1, company: 1 };

  function groupName(st, gid) { var g = null; st.groups.forEach(function (x) { if (x.id === gid) g = x; }); return g ? g.name : "—"; }
  function nomineeName(st, n) {
    var lang = UI.lang();
    if (n.kind === "artist") { var a = Core.artistById(st, n.aid); return a ? UI.name(a) : "—"; }
    if (n.kind === "rstar") return Core.rivalStarName({ rosterId: n.rosterId }, lang);
    if (n.kind === "rgen") return Core.artistName({ rosterId: null, nameSeed: n.nameSeed, gender: n.gender }, lang);
    if (n.kind === "work") { var w = Core.artistById(st, n.aid); return Core.jobTitle(n, lang) + (w ? "（" + UI.name(w) + "）" : ""); }
    if (n.kind === "rwork") return Core.jobTitle(n, lang);
    if (n.kind === "group") return groupName(st, n.gid);
    if (n.kind === "rgroup") return t("sv_rgroup", { rival: UI.rivalName(st, n.rival) });
    if (n.kind === "company") return st.company.name || t("sv_company_default");
    if (n.kind === "rcompany") return UI.rivalName(st, n.rival);
    return "—";
  }
  function nomineeOrg(st, n) { return OURS[n.kind] ? t("sv_ours") : UI.rivalName(st, n.rival); }
  function nomineeAvatar(st, n) {
    if (n.kind === "artist" || n.kind === "work") { var a = Core.artistById(st, n.aid); return a ? UI.avatar(a, 36) : null; }
    if (n.kind === "rstar") { var e = Roster.byId(n.rosterId); return e ? UI.avatar(e, 36) : null; }
    return el("span", { class: "sv-ava sv-ava-r sv-ava-ghost", style: "--sv-size:36px" });
  }

  function open(App, year) {
    var step = 0;
    UI.openModal(function (box, close) {
      var st = App.st(), h = null;
      st.awards.history.forEach(function (x) { if (x.year === year) h = x; });
      if (!h) { close(); return; }
      var results = h.results;
      box.appendChild(UI.modalHead("🏆 " + t("sv_ceremony_title", { year: year }), close));
      if (step < results.length) {
        var r = results[step], aw = D.AWARD_BY_ID[r.award], cer = null;
        D.CEREMONIES.forEach(function (c) { if (aw && c.id === aw.ceremony) cer = c; });
        box.appendChild(el("div", { class: "sv-small sv-muted", text: (cer ? UI.L(cer.name) : "") + "・" + t("sv_ceremony_progress", { i: step + 1, n: results.length }) }));
        box.appendChild(el("h3", { class: "sv-award-name", text: aw ? UI.L(aw.name) : r.award }));
        box.appendChild(el("ul", { class: "sv-noms" }, r.nominees.map(function (n, i) {
          return el("li", { class: "sv-nom" + (i === r.winner ? " sv-nom-win" : "") + (OURS[n.kind] ? " sv-nom-ours" : "") }, [
            nomineeAvatar(st, n),
            el("div", { class: "sv-grow" }, [el("b", { text: nomineeName(st, n) }), el("div", { class: "sv-small sv-muted", text: nomineeOrg(st, n) })]),
            i === r.winner ? el("span", { class: "sv-chip sv-nom-badge", text: "🏆 " + t("sv_ceremony_winner") }) : null
          ]);
        })));
        box.appendChild(el("div", { class: "sv-row sv-row-end" }, [
          UI.btn(t("sv_ceremony_skip"), function () { step = results.length; UI.refreshModal(); }, "sv-btn-ghost", { "data-act": "ceremony-skip" }),
          UI.btn(t("sv_ceremony_next"), function () { step++; UI.refreshModal(); }, "sv-btn-primary", { "data-act": "ceremony-next" })
        ]));
        return;
      }
      var mine = results.filter(function (x) { return OURS[x.nominees[x.winner].kind]; });
      box.appendChild(el("h3", { text: mine.length ? t("sv_ceremony_summary", { n: mine.length }) : t("sv_ceremony_none") }));
      if (mine.length) box.appendChild(el("ul", { class: "sv-noms" }, mine.map(function (x) {
        var aw = D.AWARD_BY_ID[x.award], n = x.nominees[x.winner];
        var awName = aw ? UI.L(aw.name) : x.award, idx = mine.indexOf(x);
        return el("li", { class: "sv-nom sv-nom-win sv-nom-ours" }, [
          nomineeAvatar(st, n),
          el("div", { class: "sv-grow" }, [el("b", { text: awName }), el("div", { class: "sv-small", text: nomineeName(st, n) })]),
          UI.btn(t("sv_stage_award"), function () { close(); window.PriTestStarvStageUI.playAward(App, n, awName); }, "sv-btn-gold", { "data-act": "award-stage-" + idx })
        ]);
      })));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "ceremony-close" })]));
    }, { live: true, cls: "sv-modal-wide sv-ceremony", onClose: function () {
      var st = App.st();
      if (st.awards.unseen === year) App.act(function (s) { s.awards.unseen = null; });
    } });
  }

  // 新一屆自動播放（沒有其他彈窗時）
  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.awards || st.awards.unseen == null || UI.modalIsOpen()) return null;
    var y = st.awards.unseen;
    setTimeout(function () { if (!UI.modalIsOpen() && App.st().awards.unseen === y) open(App, y); }, 0);
    return null;
  });

  window.PriTestStarvAwardsUI = { open: open, nomineeName: nomineeName, ours: function (n) { return !!OURS[n.kind]; } };
})();
