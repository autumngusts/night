// 明星經紀 starV：「招募」分頁（兩個抽卡池、PICKUP、保底、候補名單、翻卡演出；規格 §5.1、§15.2）。
// 抽卡結果先存檔再演出，避免演出途中關頁面造成結果遺失。新 SSR 在翻卡之後接全螢幕介紹。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Roster = window.PriTestStarvRoster;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var FLIP_MS = 220;

  function findAny(st, id) {
    var a = Core.artistById(st, id);
    if (a) return a;
    for (var i = 0; i < st.waitlist.length; i++) if (st.waitlist[i].artist.id === id) return st.waitlist[i].artist;
    return null;
  }
  function pct(x) { return Math.round(x * 1000) / 10; }

  function pickupBanner(st) {
    var items = ["SSR", "SR"].map(function (r) { return Roster.byId(st.gacha.pickup[r]); }).filter(Boolean);
    if (!items.length) return null;
    return el("div", { class: "sv-card sv-pickup" }, [
      el("div", { class: "sv-pickup-label", text: t("sv_gacha_pickup") }),
      el("div", { class: "sv-pickup-row" }, items.map(function (e) {
        return el("div", { class: "sv-pickup-item" }, [
          UI.avatar(e, 64),
          el("div", {}, [
            UI.rarity(e.rarity),
            el("div", { class: "sv-pickup-name", text: UI.L(e.name) }),
            el("div", { class: "sv-small sv-muted", text: UI.dirIcon(e.dir) + " " + UI.dirName(e.dir) })
          ])
        ]);
      }))
    ]);
  }

  function doPull(App, poolId, count) {
    var res = App.act(function (st) { return Core.pull(st, poolId, count); });
    if (res.err) { UI.toast(t("sv_err_" + res.err), "bad"); return; }
    App.saveNow();
    openReveal(App, res.results);
  }

  function pool(st, App, id) {
    var r = Core.rates(st, id);
    var fmt = function (c) { return id === "money" ? UI.money(c) : t("sv_tickets", { n: c }); };
    var free = Core.freeSlots(st);
    return el("div", { class: "sv-card sv-pool sv-pool-" + id }, [
      el("h3", { text: t("sv_pool_" + id) }),
      el("p", { class: "sv-muted sv-small", text: t("sv_pool_" + id + "_desc") }),
      el("div", { class: "sv-small", text: t("sv_pool_rates", { sr: pct(r.SR), ssr: pct(r.SSR) }) }),
      id === "money" ? el("div", { class: "sv-small sv-muted", text: t("sv_daily_left", { n: Core.dailyPullsLeft(st) }) }) : null,
      el("div", { class: "sv-row" }, [
        UI.btn(t("sv_pull_1", { cost: fmt(Core.pullCost(st, id, 1)) }), function () { doPull(App, id, 1); }, "sv-btn-ghost", { "data-act": "pull-" + id + "-1", disabled: free < 1 }),
        UI.btn(t("sv_pull_10", { cost: fmt(Core.pullCost(st, id, 10)) }), function () { doPull(App, id, 10); }, "sv-btn-primary", { "data-act": "pull-" + id + "-10", disabled: free < 10 })
      ]),
      free < 10 ? el("div", { class: "sv-small sv-pull-space", text: t("sv_pull_space", { n: free }) }) : null,
      el("div", { class: "sv-small sv-muted", text: t("sv_pull_10_note") })
    ]);
  }

  function resultNote(st, r) {
    if (r.lost) return t("sv_res_lost");
    if (r.dup === "limitBreak") { var a = findAny(st, r.artistId); return t("sv_res_lb", { n: a ? a.limitBreak : 1 }); }
    if (r.dup === "tickets") return t("sv_res_tickets", { n: r.tickets });
    if (r.waitlisted) return t("sv_res_wait");
    return "";
  }

  // 流失的人不在 state 裡：SR/SSR 用名錄資料畫，R 畫剪影
  function cardFace(st, r) {
    var a = findAny(st, r.artistId), e = r.rosterId ? Roster.byId(r.rosterId) : null;
    var who = a || e;
    return el("div", { class: "sv-gcard-front" }, [
      who ? UI.avatar(who, 72) : el("span", { class: "sv-ava sv-ava-r sv-ava-ghost", style: "--sv-size:72px" }),
      UI.rarity(r.rarity),
      el("div", { class: "sv-gcard-name", text: a ? UI.name(a) : e ? UI.L(e.name) : "???" }),
      who ? el("div", { class: "sv-small sv-muted", text: UI.dirIcon(who.dir) + " " + UI.dirName(who.dir) }) : null,
      el("div", { class: "sv-gcard-note", text: resultNote(st, r) })
    ]);
  }

  function openReveal(App, results) {
    var st = App.st();
    UI.openModal(function (box, close) {
      var cards = results.map(function (r) {
        return el("div", { class: "sv-gcard sv-gcard-" + r.rarity.toLowerCase() }, [
          el("div", { class: "sv-gcard-in" }, [el("div", { class: "sv-gcard-back", text: "★" }), cardFace(st, r)])
        ]);
      });
      var idx = 0, timer = null;
      var skipBtn = UI.btn(t("sv_reveal_skip"), finish, "sv-btn-ghost", { "data-act": "reveal-skip" });
      var doneBtn = UI.btn(t("sv_reveal_done"), close, "sv-btn-primary", { "data-act": "reveal-done", hidden: true });
      function flipNext() {
        if (idx >= cards.length) { finish(); return; }
        cards[idx++].classList.add("sv-flipped");
        timer = setTimeout(flipNext, FLIP_MS);
      }
      function finish() {
        clearTimeout(timer);
        while (idx < cards.length) cards[idx++].classList.add("sv-flipped");
        skipBtn.hidden = true;
        doneBtn.hidden = false;
      }
      box.appendChild(el("h2", { class: "sv-modal-title", text: t("sv_reveal_title") }));
      box.appendChild(el("div", { class: "sv-gacha-grid" + (results.length === 1 ? " sv-gacha-one" : "") }, cards));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [skipBtn, doneBtn]));
      timer = setTimeout(flipNext, 300);
    }, { cls: "sv-modal-wide sv-reveal", locked: true, onClose: function () { spotlights(App, results); } });
  }

  function spotlights(App, results) {
    var st = App.st();
    results.forEach(function (r) {
      if (r.rarity !== "SSR" || r.dup || r.lost) return;
      var a = findAny(st, r.artistId), e = Roster.byId(r.rosterId);
      if (!a || !e) return;
      UI.openModal(function (box, close) {
        box.appendChild(el("div", { class: "sv-spot" }, [
          el("div", { class: "sv-spot-rays" }),
          UI.avatar(a, 160),
          el("div", {}, [UI.rarity("SSR")]),
          el("h2", { class: "sv-spot-name", text: UI.L(e.name) }),
          el("div", { class: "sv-muted", text: UI.dirIcon(e.dir) + " " + UI.dirName(e.dir) + "・" + t("sv_age", { n: e.age }) }),
          el("p", { class: "sv-spot-bio", text: UI.L(e.bio) }),
          e.skill ? el("div", { class: "sv-skill" }, [
            el("b", { text: t("sv_spot_skill") + "：" + UI.L(e.skill.name) }),
            el("div", { class: "sv-small", text: UI.L(e.skill.desc) })
          ]) : null,
          UI.btn(t("sv_reveal_done"), close, "sv-btn-primary", { "data-act": "spot-done" })
        ]));
      }, { cls: "sv-modal-spot" });
    });
  }

  function waitlist(st, App) {
    var rows = st.waitlist.map(function (w, i) {
      var a = w.artist;
      return el("div", { class: "sv-wait-row" }, [
        UI.avatar(a, 44),
        el("div", { class: "sv-grow" }, [
          el("div", {}, [UI.rarity(a.rarity), " ", el("b", { text: UI.name(a) })]),
          el("div", { class: "sv-small sv-muted", text: UI.dirIcon(a.dir) + " " + UI.dirName(a.dir) + "・" + t("sv_wait_left", { n: w.until - st.day }) })
        ]),
        el("div", { class: "sv-wait-acts" }, [
          UI.btn(t("sv_wait_accept"), function () {
            var err = App.act(function (s) { return Core.acceptWaitlist(s, i); });
            if (err) UI.toast(t("sv_err_" + err), "bad");
          }, "sv-btn-gold", { "data-act": "wait-accept" }),
          UI.btn(t("sv_wait_farewell"), function () {
            var nm = UI.name(a);
            var err = App.act(function (s) { return Core.farewellWaitlist(s, i); });
            if (err) UI.toast(t("sv_err_" + err), "bad");
            else UI.toast(t("sv_toast_farewell", { name: nm }));
          }, "sv-btn-ghost", { "data-act": "wait-farewell" })
        ])
      ]);
    });
    return el("div", { class: "sv-card" }, [
      el("h3", { text: t("sv_wait_title") + "（" + st.waitlist.length + "／" + D.BAL.waitlistMax + "）" }),
      el("p", { class: "sv-small sv-muted", text: t("sv_wait_hint") }),
      rows.length ? el("div", {}, rows) : el("p", { class: "sv-muted", text: t("sv_wait_empty") })
    ]);
  }

  UI.register({
    id: "gacha", order: 30, icon: "✨", labelKey: "sv_tab_gacha",
    render: function (c, App) {
      var st = App.st();
      var banner = pickupBanner(st);
      if (banner) c.appendChild(banner);
      c.appendChild(el("div", { class: "sv-card sv-pity", text: t("sv_gacha_pity", { n: Core.pityLeft(st) }) }));
      c.appendChild(el("div", { class: "sv-pools" }, [pool(st, App, "ticket"), pool(st, App, "money")]));
      c.appendChild(waitlist(st, App));
    }
  });
})();
