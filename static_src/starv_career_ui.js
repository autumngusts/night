// 明星經紀 starV：引退紀念（規格 §11）。st.retireQueue 有人時、畫面上沒有其他彈窗就自動彈出，一次一位，看完移出佇列。
(function () {
  "use strict";

  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var showing = null;

  function open(App, s) {
    showing = s.id;
    UI.openModal(function (box, close) {
      var look = { look: s.look, rarity: s.rarity, dir: s.dir };
      box.appendChild(UI.modalHead(t("sv_retire_title"), close));
      box.appendChild(el("div", { class: "sv-retire-hero" }, [
        UI.avatar(look, 120),
        el("h2", { text: UI.hallName(s) }),
        s.hof ? el("div", { class: "sv-retire-hof", text: t("sv_retire_hof") }) : null,
        el("p", { class: "sv-muted", text: t("sv_retire_thanks") })
      ]));
      box.appendChild(el("ul", { class: "sv-report-list" }, [
        el("li", { text: UI.dirIcon(s.dir) + " " + UI.dirName(s.dir) + "・" + t("sv_retire_years", { n: s.years, age: s.age }) }),
        el("li", { text: t("sv_retire_works", { n: s.works }) }),
        s.best ? el("li", { text: t("sv_retire_best", { title: Core.jobTitle(s.best, UI.lang()), stars: new Array(s.best.stars + 1).join("★") }) }) : null,
        el("li", { text: t("sv_trophies") + " " + s.trophies.length }),
        el("li", { text: t("sv_retire_score", { n: s.score }) })
      ]));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "retire-close" })]));
    }, { cls: "sv-retire", onClose: function () {
      showing = null;
      App.act(function (st) { st.retireQueue = st.retireQueue.filter(function (x) { return x.id !== s.id; }); });
    } });
  }

  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.retireQueue || !st.retireQueue.length || showing || UI.modalIsOpen()) return null;
    var s = st.retireQueue[0];
    setTimeout(function () { if (!showing && !UI.modalIsOpen()) open(App, s); }, 0);
    return null;
  });
})();
