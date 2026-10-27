// 明星經紀 starV：主程式（啟動、主迴圈、頂部列、分頁列、存檔時機）。
// 規則在 starv_core.js；各分頁畫面在 starv_view_*.js（PriTestStarvUI.register 登記）；日誌與離線報告在 starv_log.js。
// 存檔：狀態變動後最多每 5 秒存一次，切到背景或離開頁面時立即存（starv_store.js）。
// 時間：每秒 Core.catchUp(now)；補算 ≥ 3 天（離線或背景分頁暫停計時後回來）時顯示離線報告。
// ?debug=1：公司分頁出現開發用工具，可以把虛擬時鐘加速 ×10／×60。
(function () {
  "use strict";

  var Core = window.PriTestStarvCore;
  var Store = window.PriTestStarvStore;
  var UI = window.PriTestStarvUI;
  var root = document.getElementById("sv-app");
  if (!root || !Core || !Store || !UI) return;

  var t = UI.t, el = UI.el;
  var PREFS_KEY = "pritest-starv-ui";
  var REPORT_MIN_DAYS = 3;
  var SAVE_EVERY_MS = 5000;
  var DEBUG = /[?&]debug=1(&|$)/.test(location.search);

  var st = null;
  var timer = null;
  var speed = 1;
  var clockOffset = 0;
  var lastSave = 0;
  var dirty = false;
  var prefs = loadPrefs();

  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* 只是記不住 */ } }

  function now() { return Date.now() + clockOffset; }
  function saveNow() { if (!st) return; Store.save(st); lastSave = Date.now(); dirty = false; }

  // 所有狀態變動都走這裡：執行 → 標記待存 → 重畫畫面與 live 彈窗
  function act(fn) {
    var r = fn(st);
    dirty = true;
    render();
    UI.refreshModal();
    return r;
  }

  function topBar() {
    var c = st.company, next = Core.nextLevelRep(st);
    var repPct = next === null ? 100 : Math.min(100, c.rep / next * 100);
    return el("header", { class: "sv-top" }, [
      el("div", { class: "sv-top-co" }, [
        el("span", { class: "sv-top-name", text: c.name || t("sv_company_default") }),
        el("span", { class: "sv-top-lv", text: t("sv_level", { lv: c.level }) }),
        el("span", { class: "sv-top-rep", title: t("sv_rep_tip", { rep: UI.num(c.rep), next: next === null ? "MAX" : UI.num(next) }) },
          [el("span", { style: "width:" + repPct + "%" })])
      ]),
      el("div", { class: "sv-top-res" }, [
        el("span", { class: "sv-chip sv-chip-money" + (c.money < 0 ? " sv-neg" : ""), text: UI.money(c.money) }),
        el("span", { class: "sv-chip sv-chip-ticket", text: t("sv_tickets", { n: c.tickets }) })
      ].concat(UI.topItems().map(function (fn) { return fn(App); }))),
      el("div", { class: "sv-top-date" }, [
        el("span", { class: "sv-date", text: UI.dateText(st.day) }),
        el("span", { class: "sv-day" }, [el("span", { class: "sv-day-fill", style: "width:" + (Core.dayProgress(st, now()) * 100) + "%" })]),
        speed > 1 ? el("span", { class: "sv-speed", text: "×" + speed }) : null
      ])
    ]);
  }

  function tabBar(views) {
    return el("nav", { class: "sv-tabs" }, views.map(function (v) {
      return el("button", {
        type: "button", class: "sv-tab" + (v.id === prefs.tab ? " sv-on" : ""), "data-tab": v.id,
        onclick: function () { prefs.tab = v.id; savePrefs(); render(); }
      }, [el("span", { class: "sv-tab-icon", text: v.icon }), el("span", { class: "sv-tab-label", text: t(v.labelKey) })]);
    }));
  }

  function render() {
    if (!st) return;
    var views = UI.views();
    if (!views.some(function (v) { return v.id === prefs.tab; })) prefs.tab = views.length ? views[0].id : null;
    var body = el("section", { class: "sv-body" });
    views.forEach(function (v) { if (v.id === prefs.tab) v.render(body, App); });
    root.innerHTML = "";
    root.appendChild(topBar());
    root.appendChild(body);
    // 附加元件（日誌抽屜）排在分頁列之前：兩者都 sticky 在底部，日誌按鈕才會浮在分頁列上方而不是蓋住它
    UI.extras().forEach(function (fn) { var n = fn(App); if (n) root.appendChild(n); });
    if (views.length) root.appendChild(tabBar(views));
  }

  function updateTicker() {
    var fill = root.querySelector(".sv-day-fill");
    if (fill) fill.style.width = (Core.dayProgress(st, now()) * 100) + "%";
  }

  function handleReport(rep) {
    rep.logs.forEach(function (e) { if (e.type === "level_up") UI.toast(t("sv_toast_level_up", { lv: e.data.lv }), "gold"); });
    if (rep.days >= REPORT_MIN_DAYS) UI.showReport(App, rep);
    UI.logWatchers().forEach(function (fn) { fn(App, rep); });
  }

  function tick() {
    if (speed > 1) clockOffset += (speed - 1) * 1000;
    var rep = Core.catchUp(st, now());
    if (rep) {
      dirty = true;
      handleReport(rep);
      render();
      UI.refreshModal();
    } else updateTicker();
    if (dirty && Date.now() - lastSave > SAVE_EVERY_MS) saveNow();
  }

  function start() {
    var rep = Core.catchUp(st, now());
    render();
    if (rep) handleReport(rep);
    saveNow();
    if (!timer) timer = setInterval(tick, 1000);
  }

  function renderWelcome() {
    var input = el("input", { class: "sv-input", maxlength: "20", placeholder: t("sv_welcome_name_ph") });
    root.innerHTML = "";
    root.appendChild(el("div", { class: "sv-welcome" }, [
      el("div", { class: "sv-logo", text: "starV" }),
      el("h1", { class: "sv-welcome-title", text: t("sv_title") }),
      el("p", { class: "sv-welcome-intro", text: t("sv_welcome_intro") }),
      el("label", { class: "sv-field" }, [el("span", { text: t("sv_welcome_name") }), input]),
      UI.btn(t("sv_welcome_start"), function () {
        st = Core.create({ now: now(), name: input.value.trim().slice(0, 20) });
        prefs.tab = "gacha";
        savePrefs();
        start();
      }, "sv-btn-primary sv-btn-big", { "data-act": "start" })
    ]));
  }

  var App = {
    st: function () { return st; },
    act: act,
    render: render,
    now: now,
    saveNow: saveNow,
    debug: DEBUG,
    speed: function () { return speed; },
    setSpeed: function (n) { speed = n; render(); },
    // 匯入的存檔從現在開始計時（不補算它在別台裝置上的離線時間）
    replaceState: function (next) { st = next; st.lastTickAt = now(); saveNow(); render(); },
    reset: function () { Store.clear(); location.reload(); },
    skip: function (days) { act(function (s) { Core.advance(s, days); }); }
  };
  window.PriTestStarv = { state: function () { return st; }, app: App };

  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") saveNow(); });
  window.addEventListener("pagehide", saveNow);
  window.addEventListener("i18n:change", function () {
    if (st) { render(); UI.refreshModal(); } else renderWelcome();
  });

  st = Store.load();
  if (st) start(); else renderWelcome();
})();
