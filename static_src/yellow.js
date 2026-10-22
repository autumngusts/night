// 黃牌 Yellow Card：畫面。規則全部在 yellow_core.js，資料在 yellow_data.js，連線在 yellow_net.js。
//   本機模式：一台裝置操作所有英雄，狀態存在 localStorage["pritest-yellow-state"]。
//   連線模式：yellow/index.html?room=<g+32hex>，每人選一位（或多位）英雄；畫面只畫房主同步來的狀態。
// 戰場是圓形（使用者指定 2026-10-22）：英雄在中心，依人數切成等分的扇形區（淺色區分），內圈近、外圈遠，
// 敵人用絕對定位放在各自扇形區的內／外圈上。每次狀態變動都整個重畫；傷害／回復數字用 log 流水號比對新增的紀錄後浮出。
(function () {
  "use strict";

  var D = window.PriTestYellowData;
  var Core = window.PriTestYellowCore;
  var app = document.getElementById("yc-app");
  if (!app || !D || !Core) return;

  var STORAGE_KEY = "pritest-yellow-state";
  var NETNAME_KEY = "pritest-yellow-netname";
  // 圓形戰場的半徑（佔容器寬度的 %）：中心英雄區 / 內外圈分界 / 外緣，以及敵人放置的半徑
  var R_CORE = 21, R_MID = 35, R_EDGE = 49.5, R_NEAR = 27.5, R_FAR = 43, R_HERO = 12.5;

  var mode = null;          // null | "local" | "net"
  var localSt = null;
  var room = null;
  var ui = {
    sel: null,              // { s: seat, u: card uid } 選中的手牌
    tab: null,              // 下方手牌區正在看的英雄 seat
    seenLog: 0,             // 已經浮出數字的 log 流水號
    logOpen: false,
    deckView: null,         // 正在看牌組的 seat
    setup: [{ cls: "paladin", name: "" }, { cls: "mage", name: "" }, null, null],
    focusHero: "paladin",   // 選角畫面正在看的英雄
    joinText: "", joinBad: false, copied: false, confirmQuit: false, err: ""
  };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function L(obj) { if (!obj) return ""; var l = lang(); return obj[l] || obj.zh || ""; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
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
  function svg(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  // ---------------- 狀態存取 ----------------
  function game() { return mode === "local" ? localSt : mode === "net" && room ? room.game : null; }
  function myCtrl() { return mode === "net" && room ? room.cid : "local"; }
  function mine(h) { return !!h && h.ctrl === myCtrl(); }

  function saveLocal() {
    try {
      if (localSt) localStorage.setItem(STORAGE_KEY, JSON.stringify(localSt));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 私密模式等：只是記不住 */ }
  }
  function loadLocal() {
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      var st = s ? JSON.parse(s) : null;
      return st && st.v === 2 ? st : null; // 舊版（四角象限）的存檔不相容
    } catch (e) { return null; }
  }

  function send(action) {
    var st = game();
    if (!st) return;
    var err;
    if (mode === "local") { err = Core.apply(st, "local", action); if (!err) saveLocal(); }
    else err = room.send(action);
    ui.err = err ? t("yc_err_" + err) : "";
    ui.sel = null;
    render();
  }

  // ---------------- 名稱 ----------------
  function heroDef(id) { return D.CLASS[id]; }
  function heroName(h) { return h ? (h.name || L(heroDef(h.cls).name)) : ""; }
  function heroLabel(st, seat) {
    var h = Core.hero(st, seat);
    return h ? heroDef(h.cls).icon + heroName(h) : "?";
  }
  function enemyName(id) { var d = D.ENEMY[id]; return d ? L(d.name) : id; }
  function cardName(c) { var d = D.CARD[c.id]; return d ? L(d.name) + (c.up ? "+" : "") : c.id; }
  function stName(s) { return t("yc_st_" + s); }
  function pathName(cls, pid) {
    var hd = heroDef(cls);
    var p = hd && hd.paths.filter(function (x) { return x.id === pid; })[0];
    return p ? L(p.name) : "";
  }

  // ---------------- 卡牌說明（依 fx 自動產生） ----------------
  var DMG_OPS = { dmg: 1, dmgAll: 1, dmgSec: 1, dmgExec: 1 };
  function fxText(d, f, h, ring) {
    var p = { n: f.n, h: f.h || 1, s: f.s ? stName(f.s) : "", r: t("yc_rng_" + (f.r || d.rng || "any")), k: f.k, per: f.per || 1 };
    // 有英雄時顯示實際數值（力量、鷹眼、狂熱、虛弱都算進去）
    if (h && DMG_OPS[f.o]) p.n = Core.heroHitValue(h, f.n, ring || (f.r === "far" ? "far" : "near"), null);
    if ((f.o === "dmg" || f.o === "dmgAll") && (f.h || 1) > 1) return t("yc_fx_" + f.o + "_multi", p);
    if (f.o === "pow") return t("yc_pow_" + f.p, p);
    if ((f.o === "st" || f.o === "stAll") && f.s === "stun") return t(f.o === "st" ? "yc_fx_stun" : "yc_fx_stunAll", p);
    if (f.o === "sac") return t("yc_fx_sac_" + f.k, p);
    if (f.o === "finale") return t("yc_fx_finale_" + f.k, p) + (h ? t("yc_fx_now_mel", { m: h.mel }) : "");
    if (h && (f.o === "dmgSpirit" || f.o === "blkSpirit")) return t("yc_fx_" + f.o, p) + t("yc_fx_now_sp", { m: h.sp });
    if (h && f.o === "dmgMel") return t("yc_fx_dmgMel", p) + t("yc_fx_now_mel", { m: h.mel });
    if (f.o === "dmgBlock" && h) return t("yc_fx_dmgBlock_now", { n: Core.heroHitValue(h, h.blk * f.n, "near", null) });
    return t("yc_fx_" + f.o, p);
  }

  function cardText(d, h) {
    var sep = t("yc_sep");
    var parts = [];
    if (d.near) parts.push(t("yc_ring_near_lbl") + d.near.map(function (f) { return fxText(d, f, h, "near"); }).join(t("yc_sep_inner")));
    if (d.far) parts.push(t("yc_ring_far_lbl") + d.far.map(function (f) { return fxText(d, f, h, "far"); }).join(t("yc_sep_inner")));
    d.fx.forEach(function (f) { parts.push(fxText(d, f, h, d.rng === "far" ? "far" : d.rng === "near" ? "near" : null)); });
    if (d.unplayable) parts.unshift(t("yc_kw_unplayable"));
    if (d.ethereal) parts.push(t("yc_kw_ethereal"));
    if (d.id === "t_yellow") parts.push(t("yc_kw_redcard", { n: D.RED_CARD_DMG }));
    if (d.exhaust) parts.push(t("yc_kw_exhaust"));
    return parts.join(sep);
  }

  function rangeTag(d) {
    if (d.near || d.far) return t("yc_rngtag_split");
    if (!d.rng) return null;
    return t("yc_rngtag_" + d.rng);
  }

  function cardEl(c, opts) {
    opts = opts || {};
    var d = Core.cardDef(c);
    var hd = heroDef(d.cls);
    var classes = "yc-card yc-type-" + d.type + " yc-rar-" + d.rar;
    if (opts.selected) classes += " yc-card-sel";
    if (opts.disabled) classes += " yc-card-off";
    if (c.up) classes += " yc-card-up";
    var meta = [t("yc_type_" + d.type)];
    var rt = rangeTag(d);
    if (rt) meta.push(rt);
    if (d.tgt === "ally") meta.push(t("yc_tgt_ally"));
    if (d.tgt === "down") meta.push(t("yc_tgt_down"));
    return el(opts.button === false ? "div" : "button", {
      type: opts.button === false ? null : "button", class: classes,
      style: hd ? "--yc-cls:" + hd.color : null,
      "data-u": c.u, title: opts.title || null,
      onclick: opts.onclick || null, disabled: opts.button !== false && opts.disabled && !opts.onclick ? true : null
    }, [
      d.unplayable ? null : el("span", { class: "yc-card-cost", text: d.cost }),
      el("span", { class: "yc-card-name", text: cardName(c) }),
      el("span", { class: "yc-card-meta", text: meta.join(" · ") }),
      d.path ? el("span", { class: "yc-card-path", text: pathName(d.cls, d.path) }) : null,
      el("span", { class: "yc-card-text", text: cardText(d, opts.hero || null) })
    ]);
  }

  // ---------------- 遺物 ----------------
  function relicName(id) { var r = D.RELIC[id]; return r ? L(r.name) : id; }
  function relicEl(id, opts) {
    var r = D.RELIC[id];
    if (!r) return null;
    opts = opts || {};
    return el(opts.onclick ? "button" : "div", { type: opts.onclick ? "button" : null, class: "yc-relic yc-relic-" + r.rar + (opts.sold ? " yc-sold" : ""),
      disabled: opts.disabled ? true : null, onclick: opts.onclick || null }, [
      el("span", { class: "yc-relic-icon", text: r.icon }),
      el("span", { class: "yc-relic-body" }, [
        el("strong", { text: L(r.name) }),
        el("span", { class: "yc-small yc-muted", text: t("yc_rar_" + r.rar) }),
        el("span", { class: "yc-small", text: L(r.desc) })
      ]),
      opts.price ? el("span", { class: "yc-price", text: "💰" + opts.price }) : null
    ]);
  }
  // 小圖示一排（滑過看說明）
  function relicRow(h) {
    if (!h.relics || !h.relics.length) return null;
    return el("div", { class: "yc-relic-row" }, h.relics.map(function (id) {
      var r = D.RELIC[id];
      return el("span", { class: "yc-relic-chip", title: L(r.name) + "：" + L(r.desc), text: r.icon });
    }));
  }

  // ---------------- 英雄選擇 ----------------
  // taken：已被其他座位選走的英雄 id（同一隊不能重複）
  function heroGrid(cur, taken, onPick, allowEmpty) {
    var grid = el("div", { class: "yc-hero-pick" });
    D.CLASSES.forEach(function (c) {
      var off = taken.indexOf(c.id) >= 0 && cur !== c.id;
      grid.appendChild(el("button", { type: "button", class: "yc-hero-btn" + (cur === c.id ? " yc-on" : ""), style: "--yc-cls:" + c.color,
        disabled: off ? true : null, title: L(c.desc),
        onclick: function () { ui.focusHero = c.id; onPick(c.id); } }, [el("span", { class: "yc-class-icon", text: c.icon }), el("span", { text: L(c.name) })]));
    });
    if (allowEmpty) grid.appendChild(el("button", { type: "button", class: "yc-hero-btn" + (cur ? "" : " yc-on"), onclick: function () { onPick(null); } }, [el("span", { text: t("yc_seat_none") })]));
    return grid;
  }

  function heroInfo(id) {
    var c = heroDef(id);
    if (!c) return null;
    var ps = c.passive;
    var box = el("div", { class: "yc-hero-info", style: "--yc-cls:" + c.color });
    box.appendChild(el("div", { class: "yc-hero-info-head" }, [
      el("span", { class: "yc-hero-info-icon", text: c.icon }),
      el("div", {}, [el("strong", { text: L(c.name) }), el("div", { class: "yc-muted yc-small", text: "HP " + c.hp + " · " + t("yc_passive") + "：" + t("yc_pas_" + ps.p, { n: ps.n }) })])
    ]));
    box.appendChild(el("p", { class: "yc-small", text: L(c.desc) }));
    var paths = el("div", { class: "yc-paths" });
    c.paths.forEach(function (p) {
      var cards = D.CARDS.filter(function (x) { return x.cls === c.id && x.path === p.id; });
      paths.appendChild(el("div", { class: "yc-path" }, [
        el("strong", { text: L(p.name) }),
        el("span", { class: "yc-small yc-muted", text: cards.map(function (x) { return L(x.name); }).join("・") })
      ]));
    });
    box.appendChild(el("div", { class: "yc-small yc-muted", text: t("yc_paths_title") }));
    box.appendChild(paths);
    box.appendChild(el("div", { class: "yc-small yc-muted", text: t("yc_start_deck") + "：" + c.start.map(function (id) { return L(D.CARD[id].name); }).join("・") }));
    return box;
  }

  // ---------------- 入口畫面 ----------------
  function renderEntry() {
    var saved = loadLocal();
    var wrap = el("div", { class: "yc-entry" });
    wrap.appendChild(el("p", { class: "yc-intro", text: t("yc_intro") }));

    if (saved && saved.phase !== "win" && saved.phase !== "lose") {
      wrap.appendChild(el("div", { class: "yc-panel yc-saved" }, [
        el("span", { text: t("yc_saved_found", { act: saved.act + 1, floor: saved.floor + 1 }) }),
        el("button", { type: "button", class: "yc-primary", text: t("yc_continue"), onclick: function () { localSt = saved; mode = "local"; ui.seenLog = saved.logSeq; render(); } })
      ]));
    }

    // 本機
    var local = el("div", { class: "yc-panel" });
    local.appendChild(el("h2", { text: t("yc_local_title") }));
    local.appendChild(el("p", { class: "yc-muted", text: t("yc_local_desc") }));
    var grid = el("div", { class: "yc-seat-grid" });
    ui.setup.forEach(function (s, seat) {
      var taken = ui.setup.filter(function (x, i) { return x && i !== seat; }).map(function (x) { return x.cls; });
      var box = el("div", { class: "yc-seat" + (s ? "" : " yc-seat-empty") });
      box.appendChild(el("div", { class: "yc-seat-pos", text: t("yc_player_n", { n: seat + 1 }) }));
      box.appendChild(heroGrid(s ? s.cls : null, taken, function (cls) { ui.setup[seat] = cls ? { cls: cls, name: s ? s.name : "" } : null; render(); }, true));
      if (s) {
        var inp = el("input", { type: "text", class: "yc-text", maxlength: "16", placeholder: L(heroDef(s.cls).name) });
        inp.value = s.name || "";
        inp.addEventListener("input", function () { s.name = inp.value; });
        box.appendChild(inp);
      }
      grid.appendChild(box);
    });
    local.appendChild(grid);
    local.appendChild(heroInfo(ui.focusHero));
    var count = ui.setup.filter(Boolean).length;
    local.appendChild(el("div", { class: "yc-actions" }, [
      el("button", { type: "button", class: "yc-primary", disabled: count ? null : true, text: t("yc_start_local"), onclick: function () {
        localSt = Core.create({ seats: ui.setup.map(function (s) { return s ? { cls: s.cls, name: s.name, ctrl: "local" } : null; }) });
        mode = "local"; ui.seenLog = localSt.logSeq; ui.tab = null;
        saveLocal();
        render();
      } }),
      count === 1 ? el("span", { class: "yc-muted", text: t("yc_solo_hint") }) : null
    ]));
    wrap.appendChild(local);

    // 連線
    var net = el("div", { class: "yc-panel" });
    net.appendChild(el("h2", { text: t("yc_net_title") }));
    net.appendChild(el("p", { class: "yc-muted", text: t("yc_net_desc") }));
    var join = el("input", { type: "text", class: "yc-text yc-join", placeholder: t("yc_net_join_ph") });
    join.value = ui.joinText;
    join.addEventListener("input", function () { ui.joinText = join.value; ui.joinBad = false; });
    net.appendChild(el("div", { class: "yc-actions" }, [
      el("button", { type: "button", class: "yc-primary", text: t("yc_net_create"), onclick: function () { openRoom(null); } })
    ]));
    net.appendChild(el("div", { class: "yc-actions" }, [
      join,
      el("button", { type: "button", text: t("yc_net_join"), onclick: function () {
        var Net = window.PriTestYellowNet;
        var raw = String(ui.joinText || "").trim();
        var id = Net.roomFromUrl(raw) || (Net.validRoomId(raw) ? raw : null);
        if (!id) { ui.joinBad = true; render(); return; }
        openRoom(id);
      } }),
      ui.joinBad ? el("span", { class: "yc-bad", text: t("yc_net_join_bad") }) : null
    ]));
    wrap.appendChild(net);

    wrap.appendChild(rulesPanel());
    return wrap;
  }

  function rulesPanel() {
    var d = el("details", { class: "yc-panel yc-rules" });
    d.appendChild(el("summary", { text: t("yc_rules_title") }));
    var ul = el("ul");
    for (var i = 1; i <= 11; i++) ul.appendChild(el("li", { text: t("yc_rule_" + i, { n: D.RED_CARD_DMG }) }));
    d.appendChild(ul);
    return d;
  }

  // ---------------- 連線大廳 ----------------
  function netName() { try { return localStorage.getItem(NETNAME_KEY) || ""; } catch (e) { return ""; } }
  function setNetName(n) { try { localStorage.setItem(NETNAME_KEY, n); } catch (e) { /* 只是記不住 */ } }
  function roomUrl(id) { return location.href.split(/[?#]/)[0] + "?room=" + id; }

  function openRoom(id) {
    var Net = window.PriTestYellowNet;
    if (!Net) return;
    if (room) room.leave();
    room = Net.open({ roomId: id, name: netName(), onChange: onRoomChange });
    mode = "net";
    ui.seenLog = 0; ui.tab = null; ui.sel = null;
    try { history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* file:// 等 */ }
    render();
  }

  function leaveRoom() {
    if (room) room.leave();
    room = null; mode = null;
    try { history.replaceState(null, "", location.href.split(/[?#]/)[0]); } catch (e) { /* ignore */ }
    render();
  }

  var renderPending = false;
  function onRoomChange() {
    var act = document.activeElement;
    // 正在輸入名字時先不重畫（會搶走焦點）
    if (act && act.classList && act.classList.contains("yc-name-input")) { renderPending = true; return; }
    renderPending = false;
    render();
  }

  function renderLobby() {
    var wrap = el("div", { class: "yc-panel yc-lobby" });
    if (!room.loaded) { wrap.appendChild(el("p", { text: t("yc_net_connecting") })); return wrap; }
    if (room.missing) {
      wrap.appendChild(el("p", { class: "yc-bad", text: t("yc_net_missing") }));
      wrap.appendChild(el("button", { type: "button", text: t("yc_back"), onclick: leaveRoom }));
      return wrap;
    }
    wrap.appendChild(el("h2", { text: t("yc_lobby_title") }));
    var url = roomUrl(room.id);
    var canvas = el("canvas", { class: "yc-qr" });
    try { window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { canvas = null; }
    var urlInput = el("input", { type: "text", class: "yc-text yc-url", readonly: true, value: url });
    wrap.appendChild(el("div", { class: "yc-share" }, [
      canvas,
      el("div", {}, [
        el("div", { class: "yc-muted", text: t("yc_lobby_share") }),
        urlInput,
        el("button", { type: "button", text: ui.copied ? t("yc_copied") : t("yc_copy"), onclick: function () {
          try { navigator.clipboard.writeText(url).catch(function () { urlInput.select(); }); } catch (e) { urlInput.select(); }
          ui.copied = true; render();
        } })
      ])
    ]));

    var nameInp = el("input", { type: "text", class: "yc-text yc-name-input", maxlength: "16", placeholder: t("yc_name_ph") });
    nameInp.value = room.name || "";
    nameInp.addEventListener("change", function () { setNetName(nameInp.value); room.setName(nameInp.value); });
    nameInp.addEventListener("blur", function () { if (renderPending) setTimeout(render, 0); });
    wrap.appendChild(el("div", { class: "yc-actions" }, [el("label", { text: t("yc_name") }), nameInp]));

    var grid = el("div", { class: "yc-seat-grid" });
    room.seats.forEach(function (s, seat) {
      var on = s && room.online[s.cid];
      var isMe = s && s.cid === room.cid;
      var taken = room.seats.filter(function (x, i) { return x && i !== seat && room.online[x.cid]; }).map(function (x) { return x.cls; });
      var box = el("div", { class: "yc-seat" + (s ? "" : " yc-seat-empty") + (isMe ? " yc-seat-me" : "") });
      box.appendChild(el("div", { class: "yc-seat-pos", text: t("yc_player_n", { n: seat + 1 }) }));
      if (!s || isMe || !on) {
        box.appendChild(heroGrid(s && (isMe || !on) ? s.cls : null, taken, function (cls) {
          if (cls) room.takeSeat(seat, cls); else room.leaveSeat(seat);
        }, isMe));
      }
      if (s) {
        var c = heroDef(s.cls);
        box.appendChild(el("div", { class: "yc-seat-who" }, [
          el("span", { class: "yc-class-icon", text: c ? c.icon : "?" }),
          el("strong", { text: c ? L(c.name) : "" }),
          el("span", { text: " — " + (room.nameOf(s.cid) || t("yc_anon")) + (isMe ? t("yc_you") : "") + (on ? "" : t("yc_offline")) })
        ]));
      } else box.appendChild(el("div", { class: "yc-muted yc-small", text: t("yc_seat_free") }));
      grid.appendChild(box);
    });
    wrap.appendChild(grid);
    wrap.appendChild(heroInfo(ui.focusHero));

    var ps = room.list();
    wrap.appendChild(el("div", { class: "yc-muted", text: t("yc_lobby_people", { n: ps.length }) + ps.map(function (p) { return (p.name || t("yc_anon")) + (room.meta && p.cid === room.meta.host ? "👑" : ""); }).join("、") }));
    wrap.appendChild(el("div", { class: "yc-actions" }, [
      room.isHost() ? el("button", { type: "button", class: "yc-primary", disabled: room.canStart() ? null : true, text: t("yc_start_net"), onclick: function () { room.start(); } })
        : el("span", { class: "yc-muted", text: t("yc_wait_host") }),
      el("button", { type: "button", text: t("yc_leave_room"), onclick: leaveRoom })
    ]));
    return el("div", {}, [wrap, rulesPanel()]);
  }

  // ---------------- 戰場 ----------------
  function incomingBySeat(st) {
    var by = {};
    st.enemies.forEach(function (e) {
      Core.effActs(st, e).forEach(function (a) {
        if (a.k !== "atk") return;
        Core.actTargets(st, e, a).forEach(function (s) { by[s] = (by[s] || 0) + Core.enemyHitValue(st, e, a.n, s) * (a.h || 1); });
      });
    });
    return by;
  }

  function selection(st) {
    if (!ui.sel) return null;
    var h = Core.hero(st, ui.sel.s);
    if (!h || st.phase !== "battle") { ui.sel = null; return null; }
    var c = null;
    h.hand.forEach(function (x) { if (x.u === ui.sel.u) c = x; });
    if (!c || !Core.canPlay(st, h, c)) { ui.sel = null; return null; }
    var d = Core.cardDef(c);
    var vt = Core.validTargets(st, h, c);
    // 不需要目標的範圍牌：預覽會打到誰
    var area = [];
    function add(list) { list.forEach(function (e) { if (area.indexOf(e.u) < 0) area.push(e.u); }); }
    d.fx.forEach(function (f) {
      if (f.o === "dmgAll" || f.o === "stAll") add(Core.inRange(st, f.r || d.rng || "any"));
      if (f.o === "pushAll") add(Core.inRange(st, "near").filter(function (e) { return !Core.isBoss(e); }));
      if (f.o === "pullSec") add(st.enemies.filter(function (e) { return e.ring === "far" && e.sec === Core.secOf(st, h.seat) && !Core.isBoss(e); }));
      if ((f.o === "sac" && f.k === "dmgAll") || (f.o === "finale" && f.k === "dmgAll")) add(Core.inRange(st, "any"));
    });
    var allyArea = d.fx.some(function (f) { return f.o === "blkAll" || f.o === "healAll" || f.o === "strAll" || f.o === "cleanseAll" || (f.o === "finale" && /All$/.test(f.k)) || (f.o === "sac" && f.k === "healAll"); });
    return { h: h, c: c, d: d, vt: vt, area: area, allyArea: allyArea };
  }

  function clickCard(st, h, c) {
    if (!mine(h) || !Core.canPlay(st, h, c)) return;
    var d = Core.cardDef(c);
    if (ui.sel && ui.sel.u === c.u) {
      // 再按一次：不需要目標的牌直接打出；需要目標的牌取消選取
      if (d.tgt === "self" || d.tgt === "none") { send({ t: "play", s: h.seat, u: c.u, tg: null }); return; }
      ui.sel = null;
    } else {
      ui.sel = { s: h.seat, u: c.u };
      // 場上只剩一個敵人且是合法目標時直接打出
      var vt = Core.validTargets(st, h, c);
      if (d.tgt === "enemy" && vt.e.length === 1 && st.enemies.length === 1) { send({ t: "play", s: h.seat, u: c.u, tg: { e: vt.e[0] } }); return; }
    }
    render();
  }

  function statusBadges(obj, isHero) {
    var row = el("div", { class: "yc-badges" });
    if (obj.blk > 0) row.appendChild(el("span", { class: "yc-badge yc-badge-blk", title: t("yc_block"), text: "🛡" + obj.blk }));
    if (obj.str) row.appendChild(el("span", { class: "yc-badge yc-badge-str", title: t("yc_str"), text: "💪" + obj.str }));
    ["weak", "vuln", "poison", "burn", "stun", "regen"].forEach(function (s) {
      if (obj.st && obj.st[s] > 0) row.appendChild(el("span", { class: "yc-badge yc-badge-" + s, title: stName(s) + "：" + t("yc_st_desc_" + s), text: t("yc_sti_" + s) + obj.st[s] }));
    });
    if (isHero) {
      if (obj.sp) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_spirits_desc", { n: 2 + (obj.pw.spirit || 0) }), text: "🦉" + obj.sp }));
      if (obj.mel) row.appendChild(el("span", { class: "yc-badge yc-badge-mel", title: t("yc_melody_desc"), text: "♪" + obj.mel }));
      if (obj.trap) row.appendChild(el("span", { class: "yc-badge yc-badge-trap", title: t("yc_trap_desc", { n: obj.trap }), text: "🪤" + obj.trap }));
      Object.keys(obj.pw || {}).forEach(function (p) {
        if (obj.pw[p]) row.appendChild(el("span", { class: "yc-badge yc-badge-pow", title: t("yc_pow_" + p, { n: obj.pw[p] }), text: "✦" + obj.pw[p] }));
      });
      if (obj.taunt) row.appendChild(el("span", { class: "yc-badge yc-badge-taunt", title: t("yc_taunt_desc"), text: "🎯" }));
    }
    return row;
  }

  function hpBar(cur, max) {
    var pct = max ? Math.max(0, Math.min(100, cur / max * 100)) : 0;
    return el("div", { class: "yc-hp" }, [el("div", { class: "yc-hp-fill", style: "width:" + pct + "%" }), el("span", { class: "yc-hp-text", text: cur + " / " + max })]);
  }

  function intentText(st, e, a) {
    var tg = function () {
      if (a.tgt === "all") return t("yc_tg_all");
      return Core.actTargets(st, e, a).map(function (s) { return heroLabel(st, s); }).join("、");
    };
    switch (a.k) {
      case "atk":
        var seats = Core.actTargets(st, e, a);
        var v = seats.length === 1 ? Core.enemyHitValue(st, e, a.n, seats[0]) : Core.enemyHitValue(st, e, a.n, -1);
        return "⚔" + v + ((a.h || 1) > 1 ? "×" + a.h : "") + "→" + tg();
      case "blk": return "🛡" + a.n + (a.all ? t("yc_int_allies") : "");
      case "buff": return "💪+" + a.str + (a.all ? t("yc_int_allies") : "");
      case "heal": return "💚" + a.n + (a.all ? t("yc_int_allies") : "");
      case "debuff": return t("yc_sti_" + a.s) + stName(a.s) + a.n + "→" + tg();
      case "curse": return "🃏" + L(D.CARD[a.card].name) + "×" + a.n + "→" + tg();
      case "yellow": return "🟨" + t("yc_int_yellow") + "→" + tg();
      case "summon": return "➕" + t("yc_int_summon", { name: enemyName(a.id) });
      case "move": return (a.to === "near" ? "⇣" : "⇡") + t(a.to === "near" ? "yc_int_advance" : "yc_int_retreat");
      case "stun": return "💫" + t("yc_int_stun");
    }
    return a.k;
  }

  // 角度（度，0＝正上方、順時針）→ 容器內的 left/top %
  function polar(deg, r) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) };
  }
  function secSpan(st) { return 360 / Core.sectorCount(st); }
  // 第 i 區的起始角度：第 0 區置中於正上方
  function secStart(st, i) { var span = secSpan(st); return i * span - span / 2; }

  function enemyEl(st, e, sel, pos) {
    var d = D.ENEMY[e.id];
    var valid = sel && sel.vt.e.indexOf(e.u) >= 0;
    var area = sel && sel.area.indexOf(e.u) >= 0;
    var acts = Core.effActs(st, e);
    var classes = "yc-enemy yc-kind-" + d.kind + (d.elite ? " yc-elite" : "") + (d.boss ? " yc-boss" : "") + (valid ? " yc-valid" : "") + (area ? " yc-area" : "") + (sel && sel.d.tgt === "enemy" && !valid ? " yc-dim" : "");
    var title = enemyName(e.id) + "（" + t("yc_kind_" + d.kind) + "）\n" + acts.map(function (a) { return intentText(st, e, a); }).join("\n");
    return el("div", { class: classes, "data-ref": "e" + e.u, title: title, style: "left:" + pos.x.toFixed(2) + "%;top:" + pos.y.toFixed(2) + "%",
      onclick: valid ? function () { send({ t: "play", s: sel.h.seat, u: sel.c.u, tg: { e: e.u } }); } : null }, [
      el("div", { class: "yc-enemy-top" }, [
        el("span", { class: "yc-enemy-icon", text: d.icon }),
        el("span", { class: "yc-enemy-name", text: enemyName(e.id) }),
        el("span", { class: "yc-kind-tag", text: t("yc_kindi_" + d.kind) })
      ]),
      hpBar(e.hp, e.max),
      statusBadges(e, false),
      el("div", { class: "yc-intents" }, acts.map(function (a) { return el("div", { class: "yc-int yc-int-" + a.k, text: intentText(st, e, a) }); }))
    ]);
  }

  function heroChip(st, h, incoming, sel, pos) {
    var c = heroDef(h.cls);
    var valid = sel && sel.vt.s.indexOf(h.seat) >= 0;
    var area = sel && sel.allyArea && !h.down;
    var classes = "yc-hero" + (h.down ? " yc-down" : "") + (h.done && !h.down ? " yc-done" : "") + (valid ? " yc-valid" : "") + (area ? " yc-area" : "") + (mine(h) ? " yc-mine" : "") + (ui.tab === h.seat ? " yc-hero-tab" : "");
    var warn = incoming[h.seat] ? Math.max(0, incoming[h.seat] - h.blk) : 0;
    var offline = mode === "net" && room && !room.online[h.ctrl];
    return el("div", { class: classes, style: "--yc-cls:" + c.color + ";left:" + pos.x.toFixed(2) + "%;top:" + pos.y.toFixed(2) + "%", "data-ref": "h" + h.seat,
      title: heroName(h) + " — " + L(c.name), onclick: function () {
        if (valid) { send({ t: "play", s: sel.h.seat, u: sel.c.u, tg: { s: h.seat } }); return; }
        ui.tab = h.seat; ui.sel = null; render();
      } }, [
      el("div", { class: "yc-hero-head" }, [
        el("span", { class: "yc-hero-icon", text: h.down ? "💀" : c.icon }),
        el("span", { class: "yc-hero-name", text: heroName(h) }),
        h.done && !h.down ? el("span", { class: "yc-tag-done", text: "✓" }) : null
      ]),
      hpBar(h.hp, h.max),
      el("div", { class: "yc-hero-sub" }, [
        h.blk ? el("span", { text: "🛡" + h.blk }) : null,
        el("span", { title: t("yc_mana"), text: "🔷" + h.mana }),
        warn ? el("span", { class: "yc-incoming", title: t("yc_incoming_desc"), text: "⚠" + warn }) : null,
        offline ? el("span", { class: "yc-tag-off", text: t("yc_offline") }) : null
      ]),
      offline && room && room.isHost() ? el("button", { type: "button", class: "yc-small-btn", text: t("yc_takeover"), onclick: function (ev) { ev.stopPropagation(); send({ t: "take", s: h.seat }); } }) : null
    ]);
  }

  function arenaBackground(st) {
    var n = Core.sectorCount(st);
    var s = svg("svg", { viewBox: "0 0 100 100", class: "yc-arena-bg", "aria-hidden": "true" });
    function arcPath(a0, a1, r0, r1) {
      var p1 = polar(a0, r1), p2 = polar(a1, r1), p3 = polar(a1, r0), p4 = polar(a0, r0);
      var large = a1 - a0 > 180 ? 1 : 0;
      return "M" + p1.x + " " + p1.y + " A" + r1 + " " + r1 + " 0 " + large + " 1 " + p2.x + " " + p2.y +
        " L" + p3.x + " " + p3.y + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + p4.x + " " + p4.y + " Z";
    }
    st.secs.forEach(function (seat, i) {
      var h = Core.hero(st, seat);
      var color = heroDef(h.cls).color;
      if (n === 1) {
        s.appendChild(svg("circle", { cx: 50, cy: 50, r: (R_MID + R_EDGE) / 2, fill: "none", stroke: color, "stroke-opacity": 0.13, "stroke-width": R_EDGE - R_MID }));
        s.appendChild(svg("circle", { cx: 50, cy: 50, r: (R_CORE + R_MID) / 2, fill: "none", stroke: color, "stroke-opacity": 0.24, "stroke-width": R_MID - R_CORE }));
        return;
      }
      var a0 = secStart(st, i), a1 = a0 + secSpan(st);
      s.appendChild(svg("path", { d: arcPath(a0, a1, R_MID, R_EDGE), fill: color, "fill-opacity": 0.13 }));
      s.appendChild(svg("path", { d: arcPath(a0, a1, R_CORE, R_MID), fill: color, "fill-opacity": 0.24 }));
      var pa = polar(a0, R_CORE), pb = polar(a0, R_EDGE);
      s.appendChild(svg("line", { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: "yc-arena-line" }));
    });
    [R_CORE, R_MID, R_EDGE].forEach(function (r) { s.appendChild(svg("circle", { cx: 50, cy: 50, r: r, class: "yc-arena-ring" })); });
    return s;
  }

  function renderBoard(st) {
    var sel = selection(st);
    var incoming = incomingBySeat(st);
    var n = Core.sectorCount(st);
    var board = el("div", { class: "yc-arena" + (sel ? " yc-targeting" : "") });
    board.appendChild(arenaBackground(st));
    // 內外圈標示
    // 內外圈標示放在第 0 區的起始邊界上（避開敵人；單人時放正下方）
    var la = n === 1 ? 180 : secStart(st, 0);
    [["near", (R_CORE + R_MID) / 2], ["far", (R_MID + R_EDGE) / 2]].forEach(function (x) {
      var p = polar(la, x[1]);
      board.appendChild(el("span", { class: "yc-ring-label", style: "left:" + p.x.toFixed(2) + "%;top:" + p.y.toFixed(2) + "%", text: t("yc_zone_" + x[0]) }));
    });
    // 敵人：依扇形區與內外圈平均分布在弧上
    for (var i = 0; i < n; i++) {
      ["near", "far"].forEach(function (ring) {
        var list = st.enemies.filter(function (e) { return e.sec === i && e.ring === ring; });
        var span = secSpan(st), start = secStart(st, i);
        list.forEach(function (e, j) {
          var ang = n === 1 ? (360 * j / Math.max(1, list.length)) : start + span * (j + 1) / (list.length + 1);
          board.appendChild(enemyEl(st, e, sel, polar(ang, ring === "near" ? R_NEAR : R_FAR)));
        });
      });
    }
    // 英雄：在中心，朝向自己扇形區
    st.secs.forEach(function (seat, i) {
      var h = Core.hero(st, seat);
      var pos = n === 1 ? { x: 50, y: 50 } : polar(secStart(st, i) + secSpan(st) / 2, R_HERO);
      board.appendChild(heroChip(st, h, incoming, sel, pos));
    });
    return el("div", { class: "yc-arena-wrap" }, [board]);
  }

  // ---------------- 手牌區 ----------------
  function defaultTab(st) {
    var hs = Core.heroes(st);
    if (ui.tab !== null && Core.hero(st, ui.tab)) return ui.tab;
    var m = hs.filter(function (h) { return mine(h) && !h.down && !h.done; })[0] || hs.filter(mine)[0] || hs[0];
    return m ? m.seat : null;
  }

  function renderHands(st) {
    var tab = ui.tab = defaultTab(st);
    var wrap = el("div", { class: "yc-hands" });
    var tabs = el("div", { class: "yc-tabs" });
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      tabs.appendChild(el("button", { type: "button", class: "yc-tab" + (h.seat === tab ? " yc-on" : "") + (mine(h) ? " yc-tab-mine" : ""), style: "--yc-cls:" + c.color,
        onclick: function () { ui.tab = h.seat; ui.sel = null; render(); } }, [
        c.icon + " " + heroName(h), h.down ? " 💀" : h.done ? " ✓" : mine(h) ? " ●" : ""
      ]));
    });
    wrap.appendChild(tabs);
    var h = Core.hero(st, tab);
    if (!h) return wrap;
    var own = mine(h);
    var sel = selection(st);
    var info = el("div", { class: "yc-hand-info" }, [
      el("span", { class: "yc-mana-big", title: t("yc_mana") }, [t("yc_mana") + " ", el("strong", { text: h.mana })]),
      el("span", { class: "yc-muted", text: t("yc_piles", { d: h.draw.length, c: h.disc.length, x: h.exh.length }) }),
      el("button", { type: "button", class: "yc-link", text: t("yc_view_deck"), onclick: function () { ui.deckView = h.seat; render(); } }),
      own ? null : el("span", { class: "yc-muted", text: t("yc_not_yours") })
    ]);
    wrap.appendChild(info);
    wrap.appendChild(statusBadges(h, true));
    var rr = relicRow(h);
    if (rr) wrap.appendChild(rr);
    var hint = "";
    if (sel && sel.h.seat === h.seat) hint = sel.d.tgt === "enemy" ? t("yc_hint_enemy") : (sel.d.tgt === "ally" || sel.d.tgt === "down") ? t("yc_hint_ally") : t("yc_hint_again");
    else if (own && !h.done && !h.down) hint = t("yc_hint_pick");
    if (ui.err) hint = ui.err;
    wrap.appendChild(el("div", { class: "yc-hint" + (ui.err ? " yc-bad" : ""), text: hint }));
    var hand = el("div", { class: "yc-hand" });
    h.hand.forEach(function (c) {
      var playable = own && Core.canPlay(st, h, c);
      var vt = Core.validTargets(st, h, c);
      var d = Core.cardDef(c);
      var noTarget = (d.tgt === "enemy" && !vt.e.length) || ((d.tgt === "ally" || d.tgt === "down") && !vt.s.length);
      hand.appendChild(cardEl(c, {
        hero: h, selected: ui.sel && ui.sel.u === c.u,
        disabled: !playable || noTarget,
        title: noTarget && playable ? t("yc_no_target") : null,
        onclick: playable && !noTarget ? function () { clickCard(st, h, c); } : null
      }));
    });
    if (!h.hand.length) hand.appendChild(el("div", { class: "yc-muted", text: h.down ? t("yc_is_down") : t("yc_empty_hand") }));
    wrap.appendChild(hand);
    if (own && !h.down) {
      wrap.appendChild(el("div", { class: "yc-actions" }, [
        el("button", { type: "button", class: h.done ? "" : "yc-primary yc-end", text: h.done ? t("yc_unend") : t("yc_end_turn"), onclick: function () { send({ t: "end", s: h.seat, on: !h.done }); } }),
        el("span", { class: "yc-muted", text: t("yc_waiting", { n: Core.alive(st).filter(function (x) { return !x.done; }).length }) })
      ]));
    }
    return wrap;
  }

  // ---------------- 紀錄 ----------------
  function refName(st, r) {
    if (!r) return "";
    if (r.k === "h") return heroLabel(st, r.s);
    return D.ENEMY[r.id] ? D.ENEMY[r.id].icon + enemyName(r.id) : "?";
  }

  function logText(st, e) {
    var to = refName(st, e.to);
    switch (e.t) {
      case "play": return t(e.to ? "yc_log_play_to" : "yc_log_play", { a: heroLabel(st, e.s), c: L(D.CARD[e.c].name) + (e.up ? "+" : ""), b: refName(st, e.to) }) + (e.ring ? t("yc_log_ring_" + e.ring) : "");
      case "dmg": return t(e.b ? "yc_log_dmg_blk" : "yc_log_dmg", { to: to, n: e.n, b: e.b });
      case "st": return t("yc_log_st", { to: to, n: e.n, s: stName(e.s) });
      case "move": return t("yc_log_move", { to: to, z: t("yc_zone_" + e.z) });
      case "curse": return t("yc_log_curse", { to: to, n: e.n, c: L(D.CARD[e.c].name) });
      case "red": return t("yc_log_red", { to: to, n: D.RED_CARD_DMG });
      case "pow": return t("yc_log_pow", { to: to, p: t("yc_pow_" + e.p, { n: e.n }) });
      case "trapHit": case "spirit": return t("yc_log_" + e.t, { to: to, a: heroLabel(st, e.s) });
      case "relic": return t("yc_log_relic", { to: to, r: relicName(e.id) });
      case "buyRelic": return t("yc_log_buy", { to: to, c: relicName(e.id), n: e.n });
      case "buy": return t("yc_log_buy", { to: to, c: L(D.CARD[e.c].name), n: e.n });
      case "removeCard": return t("yc_log_removeCard", { to: to, c: L(D.CARD[e.c].name) });
      case "round": return t("yc_log_round", { n: e.r });
      case "battle": return t("yc_log_battle", { kind: t("yc_node_" + e.kind) });
      case "node": return t("yc_log_node", { kind: t("yc_node_" + e.kind), f: e.floor + 1 });
      case "act": return t("yc_log_act", { act: L(D.ACTS[e.act].name) });
      default: return t("yc_log_" + e.t, { to: to, n: e.n });
    }
  }

  function renderLog(st) {
    var d = el("details", { class: "yc-log", open: ui.logOpen ? true : null });
    d.addEventListener("toggle", function () { ui.logOpen = d.open; });
    d.appendChild(el("summary", { text: t("yc_log") }));
    var list = el("ol", { class: "yc-log-list" });
    st.log.slice(-40).reverse().forEach(function (e) {
      list.appendChild(el("li", { class: "yc-log-" + e.t, text: logText(st, e) }));
    });
    d.appendChild(list);
    return d;
  }

  // 新紀錄的傷害／回復／護盾數字浮在對應的英雄或敵人上
  function floatNumbers(st) {
    var fresh = st.log.filter(function (e) { return e.i > ui.seenLog; });
    ui.seenLog = st.logSeq;
    if (fresh.length > 30) fresh = fresh.slice(-30);
    var stack = {};
    fresh.forEach(function (e) {
      if (!e.to || (e.t !== "dmg" && e.t !== "heal" && e.t !== "blk")) return;
      if (e.t === "dmg" && !e.n && !e.b) return;
      var ref = e.to.k === "h" ? "h" + e.to.s : "e" + e.to.u;
      var node = app.querySelector('[data-ref="' + ref + '"]');
      if (!node) return;
      var txt = e.t === "dmg" ? (e.n ? "-" + e.n : "🛡" + e.b) : e.t === "heal" ? "+" + e.n : "🛡+" + e.n;
      var k = stack[ref] = (stack[ref] || 0) + 1;
      var f = el("span", { class: "yc-float yc-float-" + e.t, text: txt, style: "animation-delay:" + ((k - 1) * 0.18) + "s" });
      node.appendChild(f);
      if (e.t === "dmg" && e.n) node.classList.add("yc-hit");
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); node.classList.remove("yc-hit"); }, 1600 + k * 180);
    });
  }

  // ---------------- 地圖／選擇 ----------------
  function floorTrack(st) {
    var row = el("ol", { class: "yc-track" });
    D.FLOORS.forEach(function (f, i) {
      row.appendChild(el("li", { class: "yc-track-node" + (i < st.floor ? " yc-past" : i === st.floor ? " yc-now" : ""), text: t("yc_floor_" + f) }));
    });
    return row;
  }

  function renderMap(st) {
    var wrap = el("div", { class: "yc-panel yc-map" });
    wrap.appendChild(el("h2", { text: L(D.ACTS[st.act].name) + " — " + t("yc_floor_n", { n: st.floor + 1, total: D.FLOORS.length }) }));
    wrap.appendChild(floorTrack(st));
    wrap.appendChild(el("p", { class: "yc-muted", text: st.options.length > 1 ? t("yc_map_vote") : t("yc_map_go") }));
    var row = el("div", { class: "yc-nodes" });
    var ctrls = Core.controllers(st);
    st.options.forEach(function (k, i) {
      var voters = ctrls.filter(function (c) { return st.votes[c] === i; });
      var mineVote = st.votes[myCtrl()] === i;
      row.appendChild(el("button", { type: "button", class: "yc-node yc-node-" + k + (mineVote ? " yc-on" : ""), onclick: function () { send({ t: "vote", i: i }); } }, [
        el("span", { class: "yc-node-icon", text: t("yc_nodei_" + k) }),
        el("strong", { text: t("yc_node_" + k) }),
        el("span", { class: "yc-small", text: t("yc_node_desc_" + k) }),
        voters.length ? el("span", { class: "yc-votes", text: t("yc_votes", { n: voters.length }) + (mode === "net" ? "：" + voters.map(function (c) { return room.nameOf(c) || t("yc_anon"); }).join("、") : "") }) : null
      ]));
      if (mode === "net" && room && room.isHost() && ctrls.length > 1) {
        row.appendChild(el("button", { type: "button", class: "yc-link", text: t("yc_force"), onclick: function () { send({ t: "vote", i: i, force: true }); } }));
      }
    });
    wrap.appendChild(row);
    wrap.appendChild(partyPanel(st));
    return wrap;
  }

  // 牌組依成長方向計數（看出這局往哪個方向組）
  function pathCounts(h) {
    var hd = heroDef(h.cls);
    return hd.paths.map(function (p) {
      var n = h.deck.filter(function (c) { return D.CARD[c.id] && D.CARD[c.id].path === p.id; }).length;
      return L(p.name) + " " + n;
    }).join(" · ");
  }

  function partyPanel(st) {
    var row = el("div", { class: "yc-party" });
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      row.appendChild(el("div", { class: "yc-party-hero", style: "--yc-cls:" + c.color }, [
        el("div", {}, [el("span", { text: c.icon + " " }), el("strong", { text: heroName(h) })]),
        hpBar(h.hp, h.max),
        el("div", { class: "yc-small yc-muted", text: pathCounts(h) }),
        el("div", { class: "yc-small" }, [el("span", { class: "yc-gold", text: "💰" + (h.gold || 0) }), " ",
          el("button", { type: "button", class: "yc-link", text: t("yc_deck_n", { n: h.deck.length }), onclick: function () { ui.deckView = h.seat; render(); } })]),
        relicRow(h)
      ]));
    });
    return row;
  }

  function renderChoices(st) {
    var wrap = el("div", { class: "yc-panel yc-choices" });
    wrap.appendChild(el("h2", { text: t("yc_phase_" + st.phase) }));
    wrap.appendChild(floorTrack(st));
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      var box = el("div", { class: "yc-choice-hero", style: "--yc-cls:" + c.color });
      box.appendChild(el("h3", {}, [c.icon + " " + heroName(h) + " ", el("span", { class: "yc-muted yc-small", text: "HP " + h.hp + "/" + h.max + " · " + pathCounts(h) + " · " }), el("span", { class: "yc-gold yc-small", text: "💰" + (h.gold || 0) })]));
      var rrow = relicRow(h);
      if (rrow) box.appendChild(rrow);
      var p = h.pend;
      if (!p) { box.appendChild(el("div", { class: "yc-good", text: t("yc_choice_done") })); wrap.appendChild(box); return; }
      if (!mine(h)) { box.appendChild(el("div", { class: "yc-muted", text: t("yc_choice_waiting") })); wrap.appendChild(box); return; }
      var choose = function (ch) { send({ t: "choose", s: h.seat, c: ch }); };
      var canUpgrade = h.deck.some(function (x) { return !x.up; });
      if (p.k === "relic") {
        box.appendChild(el("div", { class: "yc-muted", text: t("yc_pick_relic") }));
        box.appendChild(el("div", { class: "yc-relic-list" }, p.opts.map(function (id) { return relicEl(id, { onclick: function () { choose({ id: id }); } }); })));
        box.appendChild(el("div", { class: "yc-actions" }, [el("button", { type: "button", text: t("yc_skip"), onclick: function () { choose({ skip: true }); } })]));
      } else if (p.k === "shop") {
        box.appendChild(el("div", { class: "yc-muted", text: t("yc_shop_intro") }));
        var srow = el("div", { class: "yc-hand" });
        p.cards.forEach(function (it, i) {
          var off = it.sold || it.price > h.gold;
          srow.appendChild(el("div", { class: "yc-shop-item" + (it.sold ? " yc-sold" : "") }, [
            cardEl({ id: it.id, u: 0 }, { disabled: off, onclick: off ? null : function () { choose({ buy: "card", i: i }); } }),
            el("span", { class: "yc-price" + (it.price > h.gold && !it.sold ? " yc-bad" : ""), text: it.sold ? t("yc_sold") : "💰" + it.price })
          ]));
        });
        box.appendChild(srow);
        box.appendChild(el("div", { class: "yc-relic-list" }, p.relics.map(function (it, i) {
          var off = it.sold || it.price > h.gold;
          return relicEl(it.id, { price: it.sold ? null : it.price, sold: it.sold, disabled: off, onclick: function () { choose({ buy: "relic", i: i }); } });
        })));
        var rp = Core.removePrice(h);
        box.appendChild(el("div", { class: "yc-actions" }, [
          el("button", { type: "button", disabled: h.gold < rp || h.deck.length <= 5 ? true : null, text: t("yc_shop_remove", { n: rp }), onclick: function () { choose({ kind: "remove" }); } }),
          el("button", { type: "button", class: "yc-primary", text: t("yc_shop_leave"), onclick: function () { choose({ done: true }); } })
        ]));
      } else if (p.k === "card" || p.k === "treasure") {
        box.appendChild(el("div", { class: "yc-muted", text: t(p.k === "card" ? "yc_pick_card" : "yc_pick_treasure") }));
        var row = el("div", { class: "yc-hand" });
        p.opts.forEach(function (id) { row.appendChild(cardEl({ id: id, u: 0 }, { onclick: function () { choose({ id: id }); } })); });
        box.appendChild(row);
        var acts = el("div", { class: "yc-actions" });
        if (p.k === "card") {
          acts.appendChild(el("button", { type: "button", disabled: canUpgrade ? null : true, text: t("yc_reward_upgrade"), onclick: function () { choose({ kind: "upgrade" }); } }));
          acts.appendChild(el("button", { type: "button", text: t("yc_skip"), onclick: function () { choose({ skip: true }); } }));
        } else {
          acts.appendChild(el("button", { type: "button", text: t("yc_tr_maxhp"), onclick: function () { choose({ kind: "maxhp" }); } }));
          if (p.relic) box.appendChild(el("div", { class: "yc-relic-list" }, [relicEl(p.relic, { onclick: function () { choose({ kind: "relic" }); } })]));
          acts.appendChild(el("button", { type: "button", disabled: h.deck.length <= 5 ? true : null, text: t("yc_tr_remove"), onclick: function () { choose({ kind: "remove" }); } }));
        }
        box.appendChild(acts);
      } else if (p.k === "rest") {
        box.appendChild(el("div", { class: "yc-actions" }, [
          el("button", { type: "button", class: "yc-primary", text: t("yc_rest_heal", { n: Math.min(h.max - h.hp, Math.ceil(h.max * 0.3)) }), onclick: function () { choose({ kind: "heal" }); } }),
          el("button", { type: "button", disabled: canUpgrade ? null : true, text: t("yc_rest_upgrade"), onclick: function () { choose({ kind: "upgrade" }); } })
        ]));
      } else if (p.k === "upgrade" || p.k === "remove") {
        box.appendChild(el("div", { class: "yc-muted", text: t(p.k === "upgrade" ? "yc_pick_upgrade" : p.back === "shop" ? "yc_pick_remove_paid" : "yc_pick_remove", { n: Core.removePrice(h) }) }));
        var grid = el("div", { class: "yc-hand yc-deck-grid" });
        h.deck.forEach(function (x) {
          if (p.k === "upgrade" && x.up) return;
          grid.appendChild(cardEl(p.k === "upgrade" ? { id: x.id, u: x.u, up: true } : x, { onclick: function () { choose({ u: x.u }); } }));
        });
        box.appendChild(grid);
        box.appendChild(el("div", { class: "yc-actions" }, [el("button", { type: "button", text: t("yc_back"), onclick: function () { choose({ back: true }); } })]));
      }
      wrap.appendChild(box);
    });
    return wrap;
  }

  function renderEnd(st) {
    var win = st.phase === "win";
    var wrap = el("div", { class: "yc-panel yc-end-panel " + (win ? "yc-win" : "yc-lose") });
    wrap.appendChild(el("h2", { text: t(win ? "yc_win_title" : "yc_lose_title") }));
    wrap.appendChild(el("p", { text: t(win ? "yc_win_desc" : "yc_lose_desc", { act: L(D.ACTS[Math.min(st.act, D.ACTS.length - 1)].name), f: st.floor + 1 }) }));
    wrap.appendChild(partyPanel(st));
    var acts = el("div", { class: "yc-actions" });
    if (mode === "local") acts.appendChild(el("button", { type: "button", class: "yc-primary", text: t("yc_new_game"), onclick: quitLocal }));
    else if (room && room.isHost()) acts.appendChild(el("button", { type: "button", class: "yc-primary", text: t("yc_back_lobby"), onclick: function () { room.backToLobby(); } }));
    else acts.appendChild(el("span", { class: "yc-muted", text: t("yc_wait_host") }));
    wrap.appendChild(acts);
    return wrap;
  }

  function quitLocal() {
    localSt = null; mode = null; ui.confirmQuit = false; ui.sel = null; ui.tab = null;
    saveLocal();
    render();
  }

  function renderDeckView(st) {
    var h = Core.hero(st, ui.deckView);
    if (!h) { ui.deckView = null; return null; }
    var close = function () { ui.deckView = null; render(); };
    var box = el("div", { class: "yc-modal-box" });
    box.appendChild(el("div", { class: "yc-modal-head" }, [el("h3", { text: t("yc_deck_of", { name: heroName(h), n: h.deck.length }) }), el("button", { type: "button", text: "✕", onclick: close })]));
    box.appendChild(el("div", { class: "yc-small yc-muted", text: pathCounts(h) }));
    var grid = el("div", { class: "yc-hand yc-deck-grid" });
    h.deck.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }).forEach(function (c) { grid.appendChild(cardEl(c, { button: false })); });
    box.appendChild(grid);
    if (st.phase === "battle" && h.draw.length) {
      box.appendChild(el("h4", { text: t("yc_draw_pile", { n: h.draw.length }) }));
      box.appendChild(el("div", { class: "yc-muted", text: h.draw.map(cardName).sort().join("、") }));
    }
    return el("div", { class: "yc-modal", onclick: function (ev) { if (ev.target === ev.currentTarget) close(); } }, [box]);
  }

  function topBar(st) {
    var bits = [el("strong", { text: L(D.ACTS[Math.min(st.act, D.ACTS.length - 1)].name) }), el("span", { text: t("yc_floor_n", { n: st.floor + 1, total: D.FLOORS.length }) })];
    if (st.phase === "battle") bits.push(el("span", { text: t("yc_node_" + st.battleKind) + " · " + t("yc_round", { n: st.round }) }));
    if (mode === "net" && room) {
      if (!room.hostOnline()) bits.push(el("span", { class: "yc-bad", text: t("yc_host_gone") }));
      bits.push(el("button", { type: "button", class: "yc-link", text: t("yc_leave_room"), onclick: leaveRoom }));
    } else if (ui.confirmQuit) {
      bits.push(el("span", { text: t("yc_confirm_quit") }));
      bits.push(el("button", { type: "button", class: "yc-link yc-bad", text: t("yc_yes"), onclick: quitLocal }));
      bits.push(el("button", { type: "button", class: "yc-link", text: t("yc_no"), onclick: function () { ui.confirmQuit = false; render(); } }));
    } else {
      bits.push(el("button", { type: "button", class: "yc-link", text: t("yc_quit"), onclick: function () { ui.confirmQuit = true; render(); } }));
    }
    return el("div", { class: "yc-topbar" }, bits);
  }

  // ---------------- 主畫面 ----------------
  function render() {
    var scrollY = window.scrollY;
    app.innerHTML = "";
    if (!mode) { app.appendChild(renderEntry()); return; }
    if (mode === "net" && (!room.loaded || room.missing || !room.meta || room.meta.status !== "play" || !room.game)) {
      app.appendChild(renderLobby());
      return;
    }
    var st = game();
    app.appendChild(topBar(st));
    if (st.phase === "battle") {
      app.appendChild(renderBoard(st));
      app.appendChild(renderHands(st));
    } else if (st.phase === "map") app.appendChild(renderMap(st));
    else if (st.phase === "win" || st.phase === "lose") app.appendChild(renderEnd(st));
    else app.appendChild(renderChoices(st));
    app.appendChild(renderLog(st));
    if (ui.deckView !== null) { var m = renderDeckView(st); if (m) app.appendChild(m); }
    window.scrollTo(0, scrollY);
    floatNumbers(st);
  }

  window.addEventListener("i18n:change", render);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && (ui.sel || ui.deckView !== null)) { ui.sel = null; ui.deckView = null; render(); }
  });

  // 網址帶 ?room= 直接加入
  var rid = window.PriTestYellowNet ? window.PriTestYellowNet.roomFromUrl(location.href) : null;
  if (rid) openRoom(rid); else render();

  // 測試用（tools/yellow_check/ui_check.js）
  window.PriTestYellow = { state: function () { return game(); }, mode: function () { return mode; }, room: function () { return room; } };
})();
