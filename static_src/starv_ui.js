// 明星經紀 starV：畫面共用工具（DOM 建構、格式化、頭像、彈窗佇列、提示、分頁登記）。
// 各分頁（starv_view_*.js）用 register() 登記；starv.js 最後載入，依 order 排出底部分頁列。
// 彈窗同一時間只顯示一個，其他排隊（規格 §15.2）；live 的彈窗會在狀態變動時重畫。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Avatar = window.PriTestStarvAvatar;

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function L(obj) { if (!obj) return ""; return obj[lang() === "zh" ? "zh" : "ja"] || obj.zh || ""; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k === "value") node.value = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function num(n) { return Math.round(n).toLocaleString("en-US"); }
  function money(n) { return t("sv_money", { n: num(n) }); }
  // 第 2 紀元以後在日期前加上紀元（規格 §15.2）
  function dateText(day) {
    var d = Core.dateOf(day), s = t("sv_date", { y: d.year, m: d.month, d: d.day });
    var st = window.PriTestStarv && window.PriTestStarv.state && window.PriTestStarv.state();
    return st && st.era > 1 ? t("sv_date_era", { era: st.era, date: s }) : s;
  }
  function name(a) { return Core.artistName(a, lang()); }
  function dirName(id) { var d = D.DIR_BY_ID[id]; return d ? L(d.name) : String(id); }
  function dirIcon(id) { var d = D.DIR_BY_ID[id]; return d ? d.icon : "?"; }
  function statName(s) { return L(D.STAT_NAMES[s]); }
  function hallName(h) { return Core.artistName({ rosterId: h.rosterId || null, nameSeed: h.nameSeed || 0, gender: h.gender || "f" }, lang()); }
  function rivalName(st, id) {
    var r = id ? Core.rivalById(st, id) : null;
    return r ? Core.rivalName(r, lang()) : t("sv_rival_gone");
  }

  function courseName(id) {
    var c = D.COURSE_BY_ID[id];
    return c ? t("sv_course_" + c.level, { stat: statName(c.stat) }) : String(id);
  }

  // a 可以是藝人，也可以是名錄項目（兩者都有 look／rarity／dir）
  function avatar(a, size) {
    var d = D.DIR_BY_ID[a.dir];
    var node = el("span", { class: "sv-ava sv-ava-" + String(a.rarity).toLowerCase(), style: "--sv-size:" + (size || 56) + "px" });
    node.innerHTML = Avatar.svg(a.look, { bg: d ? d.color : "#7c4dff" });
    return node;
  }
  function rarity(r) { return el("span", { class: "sv-rar sv-rar-" + String(r).toLowerCase(), text: r }); }
  function bar(v, max, cls) {
    var pct = max > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0;
    return el("span", { class: "sv-bar" + (cls ? " " + cls : "") }, [el("span", { style: "width:" + pct + "%" })]);
  }
  function btn(label, onclick, cls, attrs) {
    var a = {};
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    a.type = "button";
    a.class = "sv-btn" + (cls ? " " + cls : "");
    a.text = label;
    a.onclick = onclick;
    return el("button", a);
  }
  // options：[{ value, label, disabled }]
  function select(options, value, onchange, attrs) {
    var a = { class: "sv-select" };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    var s = el("select", a, options.map(function (o) {
      return el("option", { value: o.value, disabled: !!o.disabled, selected: String(o.value) === String(value) }, [o.label]);
    }));
    if (onchange) s.addEventListener("change", function () { onchange(s.value); });
    return s;
  }

  // ---- 彈窗佇列 ----
  var queue = [];
  var open = null;
  function host() { return document.querySelector(".sv-root") || document.body; }
  function openModal(build, opts) {
    queue.push({ build: build, opts: opts || {} });
    if (!open) next();
  }
  function next() {
    var m = queue.shift();
    if (!m) { open = null; return; }
    var box = el("div", { class: "sv-modal" + (m.opts.cls ? " " + m.opts.cls : ""), role: "dialog" });
    var layer = el("div", { class: "sv-modal-layer" }, [box]);
    if (!m.opts.locked) layer.addEventListener("click", function (e) { if (e.target === layer) closeModal(); });
    host().appendChild(layer);
    open = { layer: layer, box: box, m: m };
    m.build(box, closeModal);
  }
  function closeModal() {
    if (!open) return;
    var cb = open.m.opts.onClose;
    if (open.layer.parentNode) open.layer.parentNode.removeChild(open.layer);
    open = null;
    if (cb) cb();
    if (!open) next();
  }
  function refreshModal() {
    if (!open || !open.m.opts.live) return;
    var o = open, y = o.box.scrollTop;
    o.box.innerHTML = "";
    o.m.build(o.box, closeModal);
    if (open === o) o.box.scrollTop = y;
  }
  function modalHead(title, close) {
    return el("div", { class: "sv-modal-head" }, [
      el("h2", { class: "sv-modal-title", text: title }),
      btn("✕", close, "sv-btn-icon", { "data-act": "modal-close", "aria-label": t("sv_close") })
    ]);
  }

  function toast(text, kind) {
    var wrap = document.querySelector(".sv-toasts");
    if (!wrap) { wrap = el("div", { class: "sv-toasts" }); host().appendChild(wrap); }
    var n = el("div", { class: "sv-toast" + (kind ? " sv-toast-" + kind : ""), text: text });
    wrap.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 2600);
  }

  // ---- 分頁、附加元件、離線報告的登記 ----
  var views = [];
  var extras = [];
  var reportHandler = null;
  var topItems = [];
  var logWatchers = [];
  function register(v) { views.push(v); views.sort(function (x, y) { return x.order - y.order; }); }

  window.PriTestStarvUI = {
    t: t, lang: lang, L: L, el: el, num: num, money: money, dateText: dateText, name: name,
    dirName: dirName, dirIcon: dirIcon, statName: statName, courseName: courseName, rivalName: rivalName, hallName: hallName,
    avatar: avatar, rarity: rarity, bar: bar, btn: btn, select: select,
    openModal: openModal, closeModal: closeModal, refreshModal: refreshModal, modalHead: modalHead, toast: toast,
    register: register, views: function () { return views.slice(); },
    addExtra: function (fn) { extras.push(fn); }, extras: function () { return extras.slice(); },
    setReportHandler: function (fn) { reportHandler = fn; },
    showReport: function (App, rep) { if (reportHandler) reportHandler(App, rep); },
    modalIsOpen: function () { return !!open; },
    addTopItem: function (fn) { topItems.push(fn); },
    topItems: function () { return topItems.slice(); },
    addLogWatcher: function (fn) { logWatchers.push(fn); },
    logWatchers: function () { return logWatchers.slice(); }
  };
})();
