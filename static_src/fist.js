// 鐵拳教育（fist）：畫面。規則全部在 fist_core.js，資料在 fist_data.js，連線在 fist_net.js。
//   本機模式：一台裝置操作所有老師，狀態存在 localStorage["pritest-fist-state"]。
//   連線模式：fist/index.html?room=<g+32hex>，每人扮演一位（或多位）老師；畫面只畫房主同步來的狀態。
// 每次狀態變動都整個重畫。出拳、必殺技等演出用 log 流水號比對新增的紀錄後播放（爽快動作系：使用者指定 2026-10-25）。
(function () {
  "use strict";

  var D = window.PriTestFistData;
  var Core = window.PriTestFistCore;
  var app = document.getElementById("fe-app");
  if (!app || !D || !Core) return;

  var STORAGE_KEY = "pritest-fist-state";
  var NETNAME_KEY = "pritest-fist-netname";

  var mode = null;          // null | "local" | "net" | "raid"（搜打撤：畫面在 fist_raid.js）
  var localSt = null;
  var room = null;
  var ui = {
    tab: null,              // 正在操作的老師 seat
    pick: null,             // null | "move" | "cctv"：在地圖上選格子（move＝點一下自己的老師後點格子）
    ignoreClick: false,     // 拖曳放開後瀏覽器會多送一次 click，忽略它
    inspect: null,          // 點選查看的格子 id
    seenLog: 0,
    logOpen: false,
    setup: [{ cls: "pe", name: "" }, { cls: "counselor", name: "" }, null, null],
    joinText: "", joinBad: false, copied: false, confirmQuit: false, err: "",
    classic: false          // 入口展開「經典回合制」（2026-10-26 起主要模式是搜打撤）
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
      return st && st.v === 1 && st.phase !== "win" && st.phase !== "lose" ? st : null;
    } catch (e) { return null; }
  }

  function send(action) {
    var st = game();
    if (!st) return;
    var err;
    if (mode === "local") { err = Core.apply(st, "local", action); if (!err) saveLocal(); }
    else err = room.send(action);
    ui.err = err ? t("fe_err_" + err) : "";
    ui.pick = null;
    render();
  }

  // 按鈕能不能按：在複本上試做一次（狀態很小，複製很便宜）
  function can(st, action) {
    var copy = JSON.parse(JSON.stringify(st));
    return Core.apply(copy, myCtrl(), action) === null;
  }

  // ---------------- 名稱 ----------------
  function clsName(id) { return L(D.CLASS[id].name); }
  function tName(h) { return h ? (h.name || clsName(h.cls)) : ""; }
  function tNameSeat(st, s) { return tName(Core.teacher(st, s)); }
  function eName(id) { var d = D.ENEMY[id]; return d ? L(d.name) : id; }
  function tileName(id) { var x = D.TILE[id]; return x ? L(x.name) : id; }
  function vName(i) { var list = D.VICTIM_NAMES[lang()] || D.VICTIM_NAMES.zh; return list[i % list.length]; }

  // ---------------- 小元件 ----------------
  function bar(cur, max, cls) {
    var pct = max > 0 ? Math.round(100 * cur / max) : 0;
    return el("span", { class: "fe-bar " + (cls || "") }, [el("span", { class: "fe-bar-fill", style: "width:" + pct + "%" })]);
  }
  function pips(n, max, cls) {
    var out = [];
    for (var i = 0; i < max; i++) out.push(el("span", { class: "fe-pip " + (cls || "") + (i < n ? " fe-on" : "") }));
    return el("span", { class: "fe-pips" }, out);
  }

  function teacherGrid(cur, taken, onPick, allowEmpty) {
    var grid = el("div", { class: "fe-class-grid" });
    D.CLASSES.forEach(function (c) {
      var isTaken = taken.indexOf(c.id) >= 0;
      grid.appendChild(el("button", { type: "button", class: "fe-class-btn" + (cur === c.id ? " fe-on" : ""), disabled: isTaken ? true : null,
        style: "--fe-c:" + c.color, onclick: function () { onPick(c.id); } }, [el("span", { class: "fe-class-icon", text: c.icon }), el("span", { text: L(c.name) })]));
    });
    if (allowEmpty) grid.appendChild(el("button", { type: "button", class: "fe-class-btn" + (cur ? "" : " fe-on"), onclick: function () { onPick(null); } }, [el("span", { text: t("fe_seat_none") })]));
    return grid;
  }

  function classInfo(id) {
    var c = D.CLASS[id];
    if (!c) return null;
    return el("div", { class: "fe-class-info", style: "--fe-c:" + c.color }, [
      el("div", { class: "fe-class-head" }, [el("span", { class: "fe-class-icon", text: c.icon }), el("strong", { text: L(c.name) }),
        el("span", { class: "fe-muted fe-small", text: t("fe_stats", { hp: c.hp, pow: c.pow, talk: c.talk, sense: c.sense }) })]),
      el("div", { class: "fe-small", text: L(c.desc) }),
      el("div", { class: "fe-small" }, [el("b", { text: t("fe_skill") + "「" + L(c.skill.name) + "」" }), " " + L(c.skill.desc)]),
      el("div", { class: "fe-small" }, [el("b", { text: t("fe_ult") + "「" + L(c.ult.name) + "」" }), " " + L(c.ult.desc)])
    ]);
  }

  // ---------------- 入口 ----------------
  // 入口：選模式。搜打撤是主要模式（使用者指定 2026-10-26），經典回合制保留成另一個模式
  function renderEntry() {
    var wrap = el("div", { class: "fe-entry" });
    wrap.appendChild(el("p", { class: "fe-intro", text: t("fe_intro") }));
    var Raid = window.PriTestFistRaid;
    var modes = el("div", { class: "fe-modes" });
    if (Raid) modes.appendChild(el("button", { type: "button", class: "fe-mode fe-mode-main", onclick: function () { mode = "raid"; render(); } }, [
      el("span", { class: "fe-mode-icon", text: "🌙" }),
      el("strong", { text: t("fr_mode_name") }),
      el("span", { class: "fe-small", text: t("fr_mode_desc") }),
      Raid.hasRun() ? el("span", { class: "fe-good fe-small", text: t("fr_mode_running") }) : null
    ]));
    modes.appendChild(el("button", { type: "button", class: "fe-mode" + (ui.classic ? " fe-on" : ""), onclick: function () { ui.classic = !ui.classic; render(); } }, [
      el("span", { class: "fe-mode-icon", text: "🏫" }),
      el("strong", { text: t("fe_classic_name") }),
      el("span", { class: "fe-small", text: t("fe_classic_desc") })
    ]));
    wrap.appendChild(modes);
    if (!ui.classic && Raid) return wrap;
    wrap.appendChild(renderClassicEntry());
    return wrap;
  }

  function renderClassicEntry() {
    var wrap = el("div", { class: "fe-classic" });
    var saved = loadLocal();
    if (saved) {
      wrap.appendChild(el("div", { class: "fe-panel fe-saved" }, [
        el("span", { text: t("fe_saved_found", { ch: saved.chapter + 1, r: saved.round }) }),
        el("button", { type: "button", class: "fe-primary", text: t("fe_continue"), onclick: function () { localSt = saved; mode = "local"; ui.seenLog = saved.logSeq; render(); } })
      ]));
    }

    var local = el("div", { class: "fe-panel" });
    local.appendChild(el("h2", { text: t("fe_local_title") }));
    local.appendChild(el("p", { class: "fe-muted", text: t("fe_local_desc") }));
    ui.setup.forEach(function (s, seat) {
      var taken = ui.setup.filter(function (x, i) { return x && i !== seat; }).map(function (x) { return x.cls; });
      var box = el("div", { class: "fe-seat" });
      box.appendChild(el("div", { class: "fe-seat-head", text: t("fe_seat_n", { n: seat + 1 }) }));
      box.appendChild(teacherGrid(s ? s.cls : null, taken, function (cls) { ui.setup[seat] = cls ? { cls: cls, name: s ? s.name : "" } : null; render(); }, seat > 0));
      if (s) {
        var inp = el("input", { type: "text", maxlength: "16", placeholder: t("fe_name_ph"), value: s.name || "" });
        inp.addEventListener("input", function () { s.name = inp.value; });
        box.appendChild(inp);
        box.appendChild(classInfo(s.cls));
      }
      local.appendChild(box);
    });
    var count = ui.setup.filter(Boolean).length;
    local.appendChild(el("div", { class: "fe-actions" }, [
      el("button", { type: "button", class: "fe-primary", disabled: count ? null : true, text: t("fe_start_local"), onclick: function () {
        localSt = Core.create({ seats: ui.setup.map(function (s) { return s ? { cls: s.cls, name: s.name, ctrl: "local" } : null; }), hostCtrl: "local" });
        mode = "local"; ui.seenLog = localSt.logSeq; ui.tab = null;
        saveLocal(); render();
      } }),
      count === 1 ? el("span", { class: "fe-muted fe-small", text: t("fe_solo_hint") }) : null
    ]));
    wrap.appendChild(local);

    var net = el("div", { class: "fe-panel" });
    net.appendChild(el("h2", { text: t("fe_net_title") }));
    net.appendChild(el("p", { class: "fe-muted", text: t("fe_net_desc") }));
    var join = el("input", { type: "text", placeholder: t("fe_net_join_ph"), value: ui.joinText });
    join.addEventListener("input", function () { ui.joinText = join.value; ui.joinBad = false; });
    net.appendChild(el("div", { class: "fe-actions" }, [
      el("button", { type: "button", class: "fe-primary", text: t("fe_net_create"), onclick: function () { openRoom(null); } })
    ]));
    net.appendChild(el("div", { class: "fe-actions" }, [
      join,
      el("button", { type: "button", text: t("fe_net_join"), onclick: function () {
        var raw = ui.joinText.trim();
        var Net = window.PriTestFistNet;
        var id = Net.roomFromUrl(raw) || (Net.validRoomId(raw) ? raw : null);
        if (!id) { ui.joinBad = true; render(); return; }
        openRoom(id);
      } })
    ]));
    if (ui.joinBad) net.appendChild(el("div", { class: "fe-bad", text: t("fe_net_join_bad") }));
    wrap.appendChild(net);
    wrap.appendChild(rulesPanel());
    return wrap;
  }

  function rulesPanel() {
    var d = el("details", { class: "fe-panel fe-rules" });
    d.appendChild(el("summary", { text: t("fe_rules_title") }));
    var ul = el("ul");
    for (var i = 1; i <= 10; i++) ul.appendChild(el("li", { text: t("fe_rule_" + i, { dark: D.MAX_DARK, comp: D.MAX_COMP, boss: D.BOSS_ROUND }) }));
    d.appendChild(ul);
    var cls = el("div", { class: "fe-class-list" });
    D.CLASSES.forEach(function (c) { cls.appendChild(classInfo(c.id)); });
    d.appendChild(cls);
    return d;
  }

  // ---------------- 連線 ----------------
  function netName() { try { return localStorage.getItem(NETNAME_KEY) || ""; } catch (e) { return ""; } }
  function setNetName(n) { try { localStorage.setItem(NETNAME_KEY, n); } catch (e) { /* 只是記不住 */ } }
  function roomUrl(id) { return location.href.split(/[?#]/)[0] + "?room=" + id; }

  function openRoom(id) {
    var Net = window.PriTestFistNet;
    if (!Net) return;
    mode = "net";
    ui.tab = null;
    room = Net.open({ roomId: id, name: netName(), onChange: onRoomChange });
    try { history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* file:// 等 */ }
    render();
  }

  function leaveRoom() {
    if (room) room.leave();
    room = null; mode = null; ui.tab = null;
    try { history.replaceState(null, "", location.href.split(/[?#]/)[0]); } catch (e) { /* file:// 等 */ }
    render();
  }

  // 正在輸入名字時不要整個重畫（會吃掉輸入框焦點）
  var renderPending = false;
  function onRoomChange() {
    var a = document.activeElement;
    if (a && a.tagName === "INPUT" && app.contains(a)) { renderPending = true; return; }
    renderPending = false;
    render();
  }

  function renderLobby() {
    var wrap = el("div", { class: "fe-panel" });
    if (!room.loaded) { wrap.appendChild(el("p", { text: t("fe_net_connecting") })); return wrap; }
    if (room.missing) {
      wrap.appendChild(el("p", { class: "fe-bad", text: t("fe_net_missing") }));
      wrap.appendChild(el("button", { type: "button", text: t("fe_back"), onclick: leaveRoom }));
      return wrap;
    }
    wrap.appendChild(el("h2", { text: t("fe_lobby_title") }));
    var url = roomUrl(room.id);
    var urlInput = el("input", { type: "text", readonly: true, value: url, class: "fe-url" });
    wrap.appendChild(el("div", { class: "fe-muted", text: t("fe_lobby_share") }));
    wrap.appendChild(el("div", { class: "fe-actions" }, [
      urlInput,
      el("button", { type: "button", text: ui.copied ? t("fe_copied") : t("fe_copy"), onclick: function () {
        try { navigator.clipboard.writeText(url).catch(function () { urlInput.select(); }); } catch (e) { urlInput.select(); }
        ui.copied = true; render();
      } })
    ]));
    var canvas = el("canvas", { class: "fe-qr" });
    try { window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { canvas = null; }
    if (canvas) wrap.appendChild(canvas);
    var nameInp = el("input", { type: "text", maxlength: "16", placeholder: t("fe_name_ph"), value: room.name || "" });
    nameInp.addEventListener("change", function () { setNetName(nameInp.value); room.setName(nameInp.value); });
    nameInp.addEventListener("blur", function () { if (renderPending) setTimeout(render, 0); });
    wrap.appendChild(el("div", { class: "fe-actions" }, [el("span", { text: t("fe_name") }), nameInp]));

    room.seats.forEach(function (s, seat) {
      var on = s && room.online[s.cid];
      var isMe = s && s.cid === room.cid;
      var taken = room.seats.filter(function (x, i) { return x && i !== seat && room.online[x.cid]; }).map(function (x) { return x.cls; });
      var box = el("div", { class: "fe-seat" + (isMe ? " fe-me" : "") });
      var who = s && on ? (room.nameOf(s.cid) || t("fe_anon")) + (isMe ? t("fe_you") : "") : t("fe_seat_free");
      box.appendChild(el("div", { class: "fe-seat-head", text: t("fe_seat_n", { n: seat + 1 }) + "：" + who }));
      if (!s || !on || isMe) {
        box.appendChild(teacherGrid(s && (isMe || !on) && on ? s.cls : null, taken, function (cls) {
          if (cls) room.takeSeat(seat, cls); else room.leaveSeat(seat);
        }, isMe));
      }
      if (s && on) box.appendChild(classInfo(s.cls));
      if (s && !on && room.isHost()) box.appendChild(el("button", { type: "button", class: "fe-link", text: t("fe_clear_seat"), onclick: function () { room.leaveSeat(seat); } }));
      wrap.appendChild(box);
    });
    var ps = room.list();
    wrap.appendChild(el("div", { class: "fe-muted", text: t("fe_lobby_people", { n: ps.length }) + ps.map(function (p) { return (p.name || t("fe_anon")) + (room.meta && p.cid === room.meta.host ? "👑" : ""); }).join("、") }));
    wrap.appendChild(el("div", { class: "fe-actions" }, [
      room.isHost() ? el("button", { type: "button", class: "fe-primary", disabled: room.canStart() ? null : true, text: t("fe_start_net"), onclick: function () { room.start(); } })
        : el("span", { class: "fe-muted", text: t("fe_wait_host") }),
      el("button", { type: "button", text: t("fe_leave_room"), onclick: leaveRoom })
    ]));
    return wrap;
  }

  // ---------------- 對局畫面 ----------------
  function topBar(st) {
    var ch = D.CHAPTERS[st.chapter];
    var bits = [el("strong", { text: L(ch.name) })];
    if (st.phase === "play") {
      bits.push(el("span", { text: t("fe_round_n", { n: st.round }) }));
      if (!Core.boss(st) && st.round < D.BOSS_ROUND) bits.push(el("span", { class: "fe-muted fe-small", text: t("fe_boss_in", { n: D.BOSS_ROUND - st.round }) }));
    }
    if (FF()) bits.push(el("button", { type: "button", class: "fe-link fe-sfx", title: t("fe_sfx"), text: FF().sfx.on ? "🔊" : "🔇", onclick: function () { FF().sfx.toggle(); render(); } }));
    if (mode === "net" && room) {
      if (!room.hostOnline()) bits.push(el("span", { class: "fe-bad", text: t("fe_host_gone") }));
      bits.push(el("button", { type: "button", class: "fe-link", text: t("fe_leave_room"), onclick: leaveRoom }));
    } else if (ui.confirmQuit) {
      bits.push(el("span", { text: t("fe_confirm_quit") }));
      bits.push(el("button", { type: "button", class: "fe-link fe-bad", text: t("fe_yes"), onclick: quitLocal }));
      bits.push(el("button", { type: "button", class: "fe-link", text: t("fe_no"), onclick: function () { ui.confirmQuit = false; render(); } }));
    } else {
      bits.push(el("button", { type: "button", class: "fe-link", text: t("fe_quit"), onclick: function () { ui.confirmQuit = true; render(); } }));
    }
    return el("div", { class: "fe-topbar" }, bits);
  }

  function meters(st) {
    var warnD = st.dark >= D.MAX_DARK - 5, warnC = st.comp >= D.MAX_COMP - 3;
    return el("div", { class: "fe-meters" }, [
      el("div", { class: "fe-meter" + (warnD ? " fe-warn" : ""), title: t("fe_dark_tip") }, [el("span", { text: "🌑 " + t("fe_dark") }), bar(st.dark, D.MAX_DARK, "fe-bar-dark"), el("b", { text: st.dark + "/" + D.MAX_DARK })]),
      el("div", { class: "fe-meter" + (warnC ? " fe-warn" : ""), title: t("fe_comp_tip") }, [el("span", { text: "📨 " + t("fe_comp") }), bar(st.comp, D.MAX_COMP, "fe-bar-comp"), el("b", { text: st.comp + "/" + D.MAX_COMP })]),
      el("div", { class: "fe-meter fe-meter-n", title: t("fe_evid_tip") }, [el("span", { text: "📎 " + t("fe_evid") }), el("b", { text: String(st.evid) })]),
      el("div", { class: "fe-meter fe-meter-n", title: t("fe_hope_tip") }, [el("span", { text: "✨ " + t("fe_hope") }), el("b", { text: String(st.hope) })])
    ]);
  }

  function currentTeacher(st) {
    var h = ui.tab !== null ? Core.teacher(st, ui.tab) : null;
    if (h) return h;
    var hs = Core.teachers(st);
    h = hs.filter(function (x) { return mine(x) && !x.down && !x.done; })[0] || hs.filter(mine)[0] || hs[0];
    ui.tab = h ? h.seat : null;
    return h;
  }

  function pickRange(st, h) {
    if (!h || ui.pick !== "move") return null;
    return h.steps;
  }

  function tileClick(st, h, tile) {
    if (ui.ignoreClick) return;
    if (ui.pick === "move" && h) { send({ t: "move", s: h.seat, x: tile.x, y: tile.y }); return; }
    if (ui.pick === "cctv" && h) { send({ t: "skill", s: h.seat, x: tile.x, y: tile.y }); return; }
    ui.inspect = ui.inspect === tile.id ? null : tile.id;
    render();
  }

  // 走直角路線（先橫後直）：地圖沒有牆，任何最短路線步數都一樣，只是畫路線用
  function pathTiles(from, to) {
    var out = [], x = from.x, y = from.y;
    while (x !== to.x) { x += to.x > x ? 1 : -1; out.push(Core.tileAt(x, y)); }
    while (y !== to.y) { y += to.y > y ? 1 : -1; out.push(Core.tileAt(x, y)); }
    return out;
  }

  function canDrag(st, h) { return st.phase === "play" && mine(h) && !h.down && !h.done && h.steps > 0; }

  // 拖曳移動（使用者指定 2026-10-26）：按住自己的老師拖到目的地，放開就跑過去；只點一下＝進入點格子移動模式
  function startDrag(st, h, ev) {
    ev.preventDefault();
    ev.stopPropagation();
    var sx = ev.clientX, sy = ev.clientY, moved = false, target = null;
    var c = D.CLASS[h.cls];
    var ghost = el("div", { class: "fe-ghost", style: "--fe-c:" + c.color }, [el("span", { class: "fe-ghost-icon", text: c.icon }), el("span", { class: "fe-ghost-label" })]);
    var label = ghost.lastChild;
    var tiles = Array.prototype.slice.call(app.querySelectorAll("[data-tile]"));
    function tileUnder(x, y) {
      var n = document.elementFromPoint(x, y);
      n = n && n.closest ? n.closest("[data-tile]") : null;
      return n ? D.TILE[n.getAttribute("data-tile")] : null;
    }
    function onMove(e) {
      if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 8) return;
      if (!moved) {
        moved = true;
        document.body.appendChild(ghost);
        tiles.forEach(function (n) { var tt = D.TILE[n.getAttribute("data-tile")]; if (Core.canMoveTo(h, tt.x, tt.y, h.steps)) n.classList.add("fe-reach"); });
      }
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      var tt = tileUnder(e.clientX, e.clientY);
      tiles.forEach(function (n) { n.classList.remove("fe-path", "fe-path-end"); });
      target = tt && Core.canMoveTo(h, tt.x, tt.y, h.steps) ? tt : null;
      if (target) {
        var path = pathTiles(h, target);
        path.forEach(function (p, i) { var n = app.querySelector('[data-tile="' + p.id + '"]'); if (n) n.classList.add(i === path.length - 1 ? "fe-path-end" : "fe-path"); });
        label.textContent = t("fe_steps_n", { n: path.length, left: h.steps - path.length });
        ghost.classList.remove("fe-ghost-bad");
      } else {
        label.textContent = tt && !(tt.x === h.x && tt.y === h.y) ? t("fe_too_far") : "";
        ghost.classList.toggle("fe-ghost-bad", !!label.textContent);
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ui.ignoreClick = true;
      setTimeout(function () { ui.ignoreClick = false; }, 0);
      ui.tab = h.seat;
      if (!moved) { ui.pick = ui.pick === "move" ? null : "move"; render(); return; }
      if (target) send({ t: "move", s: h.seat, x: target.x, y: target.y });
      else render();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function renderMap(st) {
    var h = currentTeacher(st);
    var range = pickRange(st, h);
    var grid = el("div", { class: "fe-map", style: "--fe-cols:" + D.W });
    D.TILES.forEach(function (tile) {
      var ts = Core.teachers(st).filter(function (x) { return x.x === tile.x && x.y === tile.y; });
      var bs = Core.bulliesAt(st, tile.x, tile.y);
      var vs = Core.victimsAt(st, tile.x, tile.y);
      var target = false;
      if (range !== null) target = Core.canMoveTo(h, tile.x, tile.y, range);
      else if (ui.pick === "cctv") target = bs.some(function (b) { return !b.boss; });
      var cls = "fe-tile fe-t-" + tile.type;
      if (bs.length) cls += " fe-danger";
      if (h && h.x === tile.x && h.y === tile.y) cls += " fe-here";
      if (target) cls += " fe-target";
      if (ui.pick && !target) cls += " fe-dim";
      if (ui.inspect === tile.id) cls += " fe-inspect";
      var marks = [];
      if (Core.hasProof(st, tile.x, tile.y)) marks.push(st.rec[Core.key(tile.x, tile.y)] ? "🎙️" : "📎");
      var node = el("button", { type: "button", class: cls, "data-tile": tile.id,
        title: tileName(tile.id), onclick: function () { if (ui.ignoreClick) return; if (ui.pick && !target) { ui.pick = null; render(); return; } tileClick(st, h, tile); } }, [
        el("span", { class: "fe-tile-name", text: tileName(tile.id) }),
        marks.length ? el("span", { class: "fe-tile-mark", text: marks.join("") }) : null,
        el("span", { class: "fe-tile-units" }, [].concat(
          bs.map(function (b) {
            var d = D.ENEMY[b.id];
            return el("span", { class: "fe-u fe-u-bully" + (b.boss ? " fe-u-boss" : "") + (b.stun ? " fe-stun" : ""), "data-u": "b" + b.u, title: eName(b.id) + " " + b.hp + "/" + b.max + (b.boss ? " 🧱" + b.wall : "") },
              [d.icon, el("small", { text: b.boss && b.wall > 0 ? "🧱" + b.wall : String(b.hp) })]);
          }),
          vs.map(function (v) { return el("span", { class: "fe-u fe-u-victim", "data-u": "v" + v.u, title: vName(v.name) + " " + v.hp + "/" + v.max }, ["😢", el("small", { text: String(v.hp) })]); }),
          ts.map(function (x) {
            var c = D.CLASS[x.cls];
            var drag = canDrag(st, x);
            return el("span", { class: "fe-u fe-u-teacher" + (x.down ? " fe-down" : "") + (x.seat === ui.tab ? " fe-sel" : "") + (drag ? " fe-draggable" : ""), "data-u": "t" + x.seat, style: "--fe-c:" + c.color, title: tName(x) + (drag ? "　" + t("fe_drag_tip") : ""),
              onpointerdown: drag ? function (ev) { startDrag(st, x, ev); } : null }, [c.icon]);
          })
        ))
      ]);
      grid.appendChild(node);
    });
    var wrap = el("div", { class: "fe-map-wrap" }, [grid]);
    if (ui.pick) wrap.appendChild(el("div", { class: "fe-pick-hint" }, [t("fe_pick_" + ui.pick, { n: h ? h.steps : 0 }), " ", el("button", { type: "button", class: "fe-link", text: t("fe_cancel"), onclick: function () { ui.pick = null; render(); } })]));
    else if (h && canDrag(st, h)) wrap.appendChild(el("div", { class: "fe-pick-hint", text: t("fe_drag_hint") }));
    return wrap;
  }

  function inspectPanel(st) {
    if (!ui.inspect) return null;
    var tile = D.TILE[ui.inspect];
    var bs = Core.bulliesAt(st, tile.x, tile.y);
    var vs = Core.victimsAt(st, tile.x, tile.y);
    var box = el("div", { class: "fe-panel fe-inspect-panel" });
    box.appendChild(el("div", { class: "fe-row" }, [el("strong", { text: tileName(tile.id) }), el("span", { class: "fe-muted fe-small", text: t("fe_type_" + tile.type) }),
      el("button", { type: "button", class: "fe-link", text: "✕", onclick: function () { ui.inspect = null; render(); } })]));
    if (Core.hasProof(st, tile.x, tile.y)) box.appendChild(el("div", { class: "fe-small", text: st.rec[Core.key(tile.x, tile.y)] ? t("fe_has_rec") : t("fe_has_proof") }));
    bs.forEach(function (b) { box.appendChild(el("div", { class: "fe-small" }, [bullyLine(b)])); });
    vs.forEach(function (v) { box.appendChild(el("div", { class: "fe-small" }, ["😢 " + t("fe_victim", { name: vName(v.name) }) + " ", bar(v.hp, v.max, "fe-bar-heart"), " " + v.hp + "/" + v.max])); });
    if (!bs.length && !vs.length) box.appendChild(el("div", { class: "fe-muted fe-small", text: t("fe_tile_quiet") }));
    return box;
  }

  function bullyLine(b) {
    var d = D.ENEMY[b.id];
    var tags = [];
    if (d.fierce) tags.push(t("fe_tag_fierce"));
    if (d.coward) tags.push(t("fe_tag_coward"));
    if (d.stubborn) tags.push(t("fe_tag_stubborn"));
    if (d.summon) tags.push(t("fe_tag_summon"));
    if (b.stun) tags.push(t("fe_tag_stun"));
    return el("span", { class: "fe-bully-line" }, [
      d.icon + " " + eName(b.id) + " ",
      b.boss && b.wall > 0 ? el("span", { class: "fe-wall", text: "🧱 " + t("fe_wall") + " " + b.wall + "/" + b.wallMax }) : null,
      " ", bar(b.hp, b.max, "fe-bar-bully"), " " + b.hp + "/" + b.max,
      el("span", { class: "fe-muted", text: " ⚔" + d.atk + (tags.length ? "・" + tags.join("・") : "") })
    ]);
  }

  function teacherTabs(st) {
    var tabs = el("div", { class: "fe-tabs" });
    Core.teachers(st).forEach(function (x) {
      var c = D.CLASS[x.cls];
      var state = x.down ? t("fe_down_short") : x.done ? t("fe_done_short") : t("fe_ap_short", { n: x.ap });
      tabs.appendChild(el("button", { type: "button", class: "fe-tab" + (x.seat === ui.tab ? " fe-on" : "") + (mine(x) ? " fe-mine" : ""), style: "--fe-c:" + c.color,
        onclick: function () { ui.tab = x.seat; ui.pick = null; render(); } }, [
        el("span", { text: c.icon + " " + tName(x) }),
        el("span", { class: "fe-small fe-muted", text: " " + x.hp + "/" + x.max + " · " + state }),
        mode === "net" && room && !room.online[x.ctrl] ? el("span", { class: "fe-bad fe-small", text: t("fe_offline") }) : null
      ]));
    });
    return tabs;
  }

  function actionBtn(st, label, action, opts) {
    opts = opts || {};
    var ok = can(st, action);
    return el("button", { type: "button", class: "fe-act" + (opts.cls ? " " + opts.cls : ""), disabled: ok ? null : true, title: opts.title || null,
      "data-act": action.t + (action.b ? "-" + action.b : ""),
      onclick: function () { if (opts.onclick) opts.onclick(); else send(action); } }, [label]);
  }

  // 開打：切到格鬥畫面，打完把結果送進規則引擎
  var activeFight = null;
  function startFight(st, h) {
    if (activeFight || !FF() || !can(st, { t: "fight", s: h.seat, r: {} })) return;
    var c = D.CLASS[h.cls];
    var foes = Core.bulliesAt(st, h.x, h.y).map(function (b) {
      var d = D.ENEMY[b.id];
      return { u: b.u, id: b.id, icon: d.icon, name: eName(b.id), hp: b.hp, max: b.max, atk: d.atk, boss: !!b.boss, wall: b.wall || 0, stun: !!b.stun };
    });
    var seat = h.seat;
    activeFight = FF().open({
      teacher: { icon: c.icon, color: c.color, name: tName(h), pow: h.pow, talk: h.talk, hp: h.hp, max: h.max, heat: h.heat, ult: { id: c.ult.id, name: L(c.ult.name) } },
      foes: foes, place: tileName(Core.tileAt(h.x, h.y).id), proof: Core.hasProof(st, h.x, h.y),
      seed: (st.seed ^ Math.imul(st.logSeq + 1, 2654435761)) | 0,
      onDone: function (r) { activeFight = null; send({ t: "fight", s: seat, r: r }); }
    });
  }

  function renderPanel(st) {
    var h = currentTeacher(st);
    if (!h) return null;
    var c = D.CLASS[h.cls];
    var wrap = el("div", { class: "fe-panel fe-teacher", style: "--fe-c:" + c.color });
    wrap.appendChild(teacherTabs(st));
    var tile = Core.tileAt(h.x, h.y);
    wrap.appendChild(el("div", { class: "fe-row fe-stats-row" }, [
      el("span", { class: "fe-class-icon", text: c.icon }),
      el("strong", { text: tName(h) }),
      el("span", { class: "fe-small", text: "📍" + tileName(tile.id) }),
      el("span", { class: "fe-small" }, ["❤️ ", bar(h.hp, h.max, "fe-bar-hp"), " " + h.hp + "/" + h.max]),
      el("span", { class: "fe-small" }, ["👟 " + t("fe_steps") + " ", pips(h.steps, Math.max(h.steps, Core.stepsOf(st)), "fe-pip-step")]),
      el("span", { class: "fe-small" }, [t("fe_ap") + " ", pips(h.ap, Math.max(h.ap, Core.apOf(st)), "fe-pip-ap")]),
      el("span", { class: "fe-small" }, ["🔥 " + t("fe_heat") + " ", pips(h.heat, D.MAX_HEAT, "fe-pip-heat")]),
      el("span", { class: "fe-small fe-muted", text: t("fe_stats_short", { pow: h.pow, talk: h.talk, sense: h.sense }) })
    ]));
    if (h.down) { wrap.appendChild(el("div", { class: "fe-bad", text: t("fe_is_down", { n: h.down }) })); return wrap; }
    if (!mine(h)) {
      wrap.appendChild(el("div", { class: "fe-muted", text: t("fe_not_mine") }));
      if (mode === "net" && room && room.isHost() && !room.online[h.ctrl]) wrap.appendChild(el("button", { type: "button", text: t("fe_takeover"), onclick: function () { send({ t: "take", s: h.seat }); } }));
      return wrap;
    }
    if (h.done) {
      wrap.appendChild(el("div", { class: "fe-actions" }, [
        el("span", { class: "fe-muted", text: t("fe_waiting", { n: Core.active(st).filter(function (x) { return !x.done; }).length }) }),
        el("button", { type: "button", text: t("fe_unend"), onclick: function () { send({ t: "end", s: h.seat, on: false }); } })
      ]));
      return wrap;
    }

    // 同格的霸凌者：大大的「開打！」＋每人一顆說服
    var bs = Core.bulliesAt(st, h.x, h.y);
    if (bs.length) {
      var proof = Core.hasProof(st, h.x, h.y);
      var onlyBoss = bs.every(function (b) { return b.boss; });
      var fightBox = el("div", { class: "fe-fight-box" });
      fightBox.appendChild(el("button", { type: "button", class: "fe-fight-btn", "data-act": "fight", disabled: can(st, { t: "fight", s: h.seat, r: {} }) ? null : true,
        onclick: function () { startFight(st, h); } }, [el("span", { class: "fe-fight-main", text: "👊 " + t("fe_fight") }), el("span", { class: "fe-fight-sub", text: t("fe_fight_sub") })]));
      fightBox.appendChild(el("div", { class: "fe-small " + (proof || onlyBoss ? "fe-good" : "fe-bad"), text: proof || onlyBoss ? t("fe_punch_tip") : t("fe_punch_tip_comp") }));
      wrap.appendChild(fightBox);
      var list = el("div", { class: "fe-targets" });
      bs.forEach(function (b) {
        list.appendChild(el("div", { class: "fe-target-row" }, [
          bullyLine(b),
          el("span", { class: "fe-target-btns" }, [
            actionBtn(st, "🗣️ " + t("fe_talk"), { t: "talk", s: h.seat, b: b.u }, { title: Core.walled(b) ? t("fe_wall_tip") : t("fe_talk_tip") })
          ])
        ]));
      });
      wrap.appendChild(list);
    }
    var vs = Core.victimsAt(st, h.x, h.y);
    if (vs.length) wrap.appendChild(el("div", { class: "fe-small" }, vs.map(function (v) { return el("span", { class: "fe-victim-chip" }, ["😢 " + vName(v.name) + " ", bar(v.hp, v.max, "fe-bar-heart"), " " + v.hp + "/" + v.max]); })));

    var acts = el("div", { class: "fe-actions fe-act-grid" });
    acts.appendChild(actionBtn(st, "🔍 " + t("fe_search"), { t: "search", s: h.seat }, { title: t("fe_search_tip") }));
    acts.appendChild(actionBtn(st, "🛡️ " + t("fe_guard"), { t: "guard", s: h.seat }, { title: t("fe_guard_tip") }));
    acts.appendChild(actionBtn(st, "☕ " + t("fe_rest"), { t: "rest", s: h.seat }, { title: t("fe_rest_tip") }));
    if (Core.boss(st)) acts.appendChild(actionBtn(st, "📢 " + t("fe_expose"), { t: "expose", s: h.seat }, { title: t("fe_expose_tip") }));
    var sk = c.skill;
    var skillLabel = "✦ " + L(sk.name) + (h.cd ? "（" + t("fe_cd", { n: h.cd }) + "）" : "");
    if (sk.id === "cctv") {
      var anyTarget = st.bullies.some(function (b) { return !b.boss; });
      acts.appendChild(el("button", { type: "button", class: "fe-act fe-act-skill", disabled: h.cd || h.ap < 1 || !anyTarget ? true : null, title: L(sk.desc), "data-act": "skill",
        onclick: function () { ui.pick = ui.pick === "cctv" ? null : "cctv"; render(); } }, [skillLabel]));
    } else acts.appendChild(actionBtn(st, skillLabel, { t: "skill", s: h.seat }, { cls: "fe-act-skill", title: L(sk.desc) }));
    if (D.FIGHT_ULTS[c.ult.id]) {
      // 打人的必殺技在格鬥畫面裡放
      acts.appendChild(el("span", { class: "fe-act fe-act-note" + (h.heat >= D.MAX_HEAT ? " fe-ready" : ""), title: L(c.ult.desc) }, ["🔥 " + L(c.ult.name) + " ", el("small", { text: h.heat >= D.MAX_HEAT ? t("fe_ult_ready_fight") : t("fe_ult_in_fight") })]));
    } else acts.appendChild(actionBtn(st, "🔥 " + L(c.ult.name), { t: "ult", s: h.seat }, { cls: "fe-act-ult", title: L(c.ult.desc) + " " + t("fe_ult_cost") }));
    wrap.appendChild(acts);
    wrap.appendChild(el("div", { class: "fe-actions" }, [
      el("button", { type: "button", class: "fe-primary fe-end", "data-act": "end", text: t("fe_end_turn"), onclick: function () { send({ t: "end", s: h.seat, on: true }); } }),
      el("span", { class: "fe-muted fe-small", text: t("fe_waiting", { n: Core.active(st).filter(function (x) { return !x.done; }).length }) })
    ]));
    if (ui.err) wrap.appendChild(el("div", { class: "fe-bad", text: ui.err }));
    return wrap;
  }

  function bossBanner(st) {
    var b = Core.boss(st);
    if (!b) return null;
    var d = D.ENEMY[b.id];
    return el("div", { class: "fe-boss-banner" }, [
      el("span", { class: "fe-boss-icon", text: d.icon }),
      el("div", {}, [
        el("strong", { text: eName(b.id) + "　📍" + tileName(d.at) }),
        el("div", { class: "fe-small fe-quote", text: L(D.CHAPTERS[st.chapter].bossLine) }),
        el("div", { class: "fe-small" }, [
          b.wall > 0 ? el("span", { class: "fe-wall", text: "🧱 " + t("fe_wall") + " " + b.wall + "/" + b.wallMax + "　" }) : el("span", { class: "fe-good", text: t("fe_wall_broken") + "　" }),
          "❤️ ", bar(b.hp, b.max, "fe-bar-bully"), " " + b.hp + "/" + b.max
        ]),
        b.wall > 0 ? el("div", { class: "fe-small fe-muted", text: t("fe_wall_hint") }) : null
      ])
    ]);
  }

  function renderStory(st) {
    var ch = D.CHAPTERS[st.chapter];
    var box = el("div", { class: "fe-panel fe-story" });
    box.appendChild(el("h2", { text: L(ch.name) }));
    if (st.chapter > 0) box.appendChild(el("p", { class: "fe-muted", text: L(D.CHAPTERS[st.chapter - 1].clear) }));
    box.appendChild(el("p", { text: L(ch.intro) }));
    box.appendChild(el("p", { class: "fe-small fe-muted", text: t("fe_story_goal", { boss: eName(ch.boss), place: tileName(D.ENEMY[ch.boss].at), n: D.BOSS_ROUND }) }));
    var canGo = can(st, { t: "go" });
    box.appendChild(el("div", { class: "fe-actions" }, [
      canGo ? el("button", { type: "button", class: "fe-primary", "data-act": "go", text: t("fe_go"), onclick: function () { send({ t: "go" }); } }) : el("span", { class: "fe-muted", text: t("fe_wait_host") })
    ]));
    return box;
  }

  function renderPerk(st) {
    var wrap = el("div", { class: "fe-panel fe-perk" });
    wrap.appendChild(el("h2", { text: t("fe_clear_title") }));
    wrap.appendChild(el("p", { text: L(D.CHAPTERS[st.chapter].clear) }));
    wrap.appendChild(el("p", { class: "fe-muted", text: t("fe_perk_desc") }));
    Core.teachers(st).forEach(function (h) {
      var c = D.CLASS[h.cls];
      var box = el("div", { class: "fe-seat", style: "--fe-c:" + c.color });
      box.appendChild(el("div", { class: "fe-seat-head", text: c.icon + " " + tName(h) }));
      var picked = st.perkPicked[h.seat];
      if (picked) box.appendChild(el("div", { class: "fe-good", text: "✓ " + t("fe_perk_" + picked) }));
      else if (!mine(h)) box.appendChild(el("div", { class: "fe-muted", text: t("fe_perk_wait") }));
      else box.appendChild(el("div", { class: "fe-actions" }, (st.perkOpts[h.seat] || []).map(function (k) {
        return el("button", { type: "button", class: "fe-perk-btn", "data-perk": k, onclick: function () { send({ t: "perk", s: h.seat, k: k }); } }, [el("b", { text: t("fe_perk_" + k) }), el("span", { class: "fe-small fe-muted", text: t("fe_perk_" + k + "_d") })]);
      })));
      wrap.appendChild(box);
    });
    return wrap;
  }

  function renderEnd(st) {
    var win = st.phase === "win";
    var wrap = el("div", { class: "fe-panel fe-end-panel " + (win ? "fe-win" : "fe-lose") });
    wrap.appendChild(el("h2", { text: t(win ? "fe_win_title" : "fe_lose_title") }));
    wrap.appendChild(el("p", { text: win ? L(D.CHAPTERS[D.CHAPTERS.length - 1].clear) : t("fe_lose_" + (st.loseWhy || "dark")) }));
    wrap.appendChild(el("p", { class: "fe-muted", text: t("fe_result", { ch: st.chapter + 1, hope: st.hope }) }));
    var acts = el("div", { class: "fe-actions" });
    if (mode === "local") acts.appendChild(el("button", { type: "button", class: "fe-primary", text: t("fe_new_game"), onclick: quitLocal }));
    else if (room && room.isHost()) acts.appendChild(el("button", { type: "button", class: "fe-primary", text: t("fe_back_lobby"), onclick: function () { room.backToLobby(); } }));
    else acts.appendChild(el("span", { class: "fe-muted", text: t("fe_wait_host") }));
    wrap.appendChild(acts);
    return wrap;
  }

  function quitLocal() {
    localSt = null; mode = null; ui.confirmQuit = false; ui.tab = null; ui.pick = null;
    saveLocal();
    render();
  }

  // ---------------- 紀錄 ----------------
  function logText(st, e) {
    var p = {};
    if (e.s !== undefined) p.who = tNameSeat(st, e.s);
    if (e.e) p.e = eName(e.e);
    if (e.t) p.place = tileName(e.t);
    if (e.v !== undefined) p.v = vName(e.v);
    ["d", "n", "left"].forEach(function (k) { if (e[k] !== undefined) p[k] = e[k]; });
    switch (e.k) {
      case "fight": p.combo = e.combo; return t("fe_log_fight", p) + (e.comp ? t("fe_log_comp") : "");
      case "defeat": return t(e.how === "talk" ? "fe_log_defeat_talk" : "fe_log_defeat", p);
      case "expose": return t(e.bc ? "fe_log_expose_bc" : "fe_log_expose", p);
      case "skill": p.sk = L(D.CLASS[Core.teacher(st, e.s).cls].skill.name); return t("fe_log_skill", p) + (e.t ? "（" + p.place + "）" : "");
      case "ult": p.sk = L(D.CLASS[Core.teacher(st, e.s).cls].ult.name); return t("fe_log_ult", p);
      case "perk": return t("fe_log_perk", { who: p.who, perk: t("fe_perk_" + e.pk) });
      case "clear": return t("fe_log_clear", { ch: L(D.CHAPTERS[e.ch].name) });
      case "chapter": return t("fe_log_chapter", { ch: L(D.CHAPTERS[e.ch].name) });
      case "lose": return t("fe_lose_" + e.why);
    }
    return t("fe_log_" + e.k, p);
  }

  function renderLog(st) {
    var d = el("details", { class: "fe-panel fe-log" });
    if (ui.logOpen) d.setAttribute("open", "");
    d.addEventListener("toggle", function () { ui.logOpen = d.open; });
    d.appendChild(el("summary", { text: t("fe_log_title") }));
    var ul = el("ul");
    st.log.slice(-50).reverse().forEach(function (e) {
      if (e.k === "school") { ul.appendChild(el("li", { class: "fe-log-sep", text: t("fe_log_school", { n: e.n }) })); return; }
      if (e.k === "round") { ul.appendChild(el("li", { class: "fe-log-sep", text: t("fe_round_n", { n: e.n }) })); return; }
      ul.appendChild(el("li", { class: "fe-log-" + e.k, text: logText(st, e) }));
    });
    d.appendChild(ul);
    return d;
  }

  // 最近一次校園階段之後發生的事（不展開紀錄也看得到）
  function recentStrip(st) {
    var lastSchool = st.log.filter(function (e) { return e.k === "school"; }).slice(-1)[0];
    if (!lastSchool) return null;
    var fresh = st.log.filter(function (e) { return e.i > lastSchool.i; });
    var lines = fresh.filter(function (e) { return ["hitV", "broken", "hitT", "downT", "spawn", "boss", "pressure", "rescue", "summon", "flee", "rec", "reviveT"].indexOf(e.k) >= 0; }).slice(-6);
    if (!lines.length) return null;
    return el("div", { class: "fe-strip" }, lines.map(function (e) { return el("div", { class: "fe-small fe-log-" + e.k, text: logText(st, e) }); }));
  }

  // ---------------- 演出 ----------------
  var BIG = { fight: 1, ult: 1, defeat: 1, boss: 1, rescue: 1, clear: 1, expose: 1 };
  function FF() { return window.PriTestFistFight; }

  // 自己剛打完的格鬥，格鬥畫面已經演過了：地圖上不再重播大字（隊友的格鬥照樣播）
  function ownFightEntry(st, e) {
    if (e.s === undefined || !mine(Core.teacher(st, e.s))) return false;
    if (e.k === "fight") return true;
    if (e.k === "ult") return !!D.FIGHT_ULTS[e.sk];
    return e.k === "defeat" && e.how === "fist";
  }

  function playFx(st) {
    var fresh = st.log.filter(function (e) { return e.i > ui.seenLog; });
    ui.seenLog = st.logSeq;
    if (!fresh.length) return;
    var shake = false;
    var shown = 0;
    fresh.forEach(function (e) {
      if (e.k === "move" && e.fx !== undefined) runAnim(st, e);
      // 格子上浮出數字
      var node = null, text = null, cls = "";
      if (e.k === "fight" && e.d) { text = "−" + e.d; cls = "fe-float-fist"; }
      if (e.k === "talk") { text = "−" + e.d; cls = "fe-float-talk"; }
      if (e.k === "hitT" || e.k === "hitV") { text = "−" + e.d; cls = "fe-float-hurt"; }
      if (e.k === "rescue") { text = "✨"; cls = "fe-float-good"; if (FF()) FF().sfx.play("rescue"); }
      if (text) {
        node = findUnitTile(st, e);
        if (node) {
          var f = el("span", { class: "fe-float " + cls, text: text });
          node.appendChild(f);
          node.classList.add("fe-hit");
          setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); node.classList.remove("fe-hit"); }, 1300);
        }
      }
      if (ownFightEntry(st, e)) return;
      if (e.k === "fight" && e.d > 0) shake = true;
      // 地圖上放的必殺技、隊友的必殺技：老師大頭切入
      if (e.k === "ult" && FF()) {
        var h = Core.teacher(st, e.s), c = D.CLASS[h.cls];
        var delayU = shown * 420;
        shown += 1;
        setTimeout(function () { FF().cutIn(c.icon, c.color, L(c.ult.name) + "!!", tName(h)); }, delayU);
        shake = true;
        return;
      }
      if (e.k === "defeat" && D.ENEMY[e.e].boss && FF() && e.s !== undefined) {
        var hb = Core.teacher(st, e.s), cb = D.CLASS[hb.cls];
        FF().cutIn(cb.icon, cb.color, t("fe_fx_boss_down"), eName(e.e));
        return;
      }
      if (BIG[e.k] && shown < 3 && bigLabel(st, e)) {
        var lab = bigLabel(st, e);
        var delay = shown * 420;
        shown += 1;
        setTimeout(function () { showBig(lab.text, lab.sub, lab.cls, lab.color); }, delay);
      }
    });
    if (shake) {
      app.classList.remove("fe-shake");
      void app.offsetWidth;
      app.classList.add("fe-shake");
      setTimeout(function () { app.classList.remove("fe-shake"); }, 600);
    }
  }

  // 跑步動畫：老師沿路線一格一格跑過去（所有人的畫面都會播）
  function runAnim(st, e) {
    var h = Core.teacher(st, e.s);
    if (!h || !D.TILE[e.t]) return;
    var c = D.CLASS[h.cls];
    var path = [Core.tileAt(e.fx, e.fy)].concat(pathTiles({ x: e.fx, y: e.fy }, D.TILE[e.t]));
    var rects = path.map(function (p) { var n = app.querySelector('[data-tile="' + p.id + '"]'); return n ? n.getBoundingClientRect() : null; });
    if (rects.some(function (r) { return !r; })) return;
    var dest = app.querySelector('[data-u="t' + h.seat + '"]');
    if (dest) dest.style.visibility = "hidden";
    var runner = el("div", { class: "fe-runner", style: "--fe-c:" + c.color, text: c.icon });
    var place = function (r) { runner.style.left = (r.left + r.width / 2) + "px"; runner.style.top = (r.top + r.height / 2) + "px"; };
    place(rects[0]);
    document.body.appendChild(runner);
    var i = 0;
    var step = function () {
      i += 1;
      if (i >= rects.length) {
        setTimeout(function () {
          if (runner.parentNode) runner.parentNode.removeChild(runner);
          var d2 = app.querySelector('[data-u="t' + h.seat + '"]');
          if (d2) { d2.style.visibility = ""; d2.classList.add("fe-land"); }
        }, 120);
        return;
      }
      place(rects[i]);
      runner.classList.toggle("fe-runner-flip", i % 2 === 0);
      if (FF()) FF().sfx.play("step");
      setTimeout(step, 115);
    };
    setTimeout(step, 30);
  }

  function findUnitTile(st, e) {
    var tid = null;
    if (e.s !== undefined) { var h = Core.teacher(st, e.s); if (h) tid = Core.tileAt(h.x, h.y).id; }
    if (e.k === "hitV" || e.k === "rescue") {
      tid = null;
      var v = st.victims.filter(function (x) { return x.name === e.v; })[0];
      if (v) tid = Core.tileAt(v.x, v.y).id;
    }
    if (e.k === "hitT") { var ht = Core.teacher(st, e.s); tid = ht ? Core.tileAt(ht.x, ht.y).id : null; }
    return tid ? app.querySelector('[data-tile="' + tid + '"]') : null;
  }

  function hue() { return "hsl(" + Math.floor(Math.random() * 360) + ", 95%, 60%)"; }
  function bigLabel(st, e) {
    switch (e.k) {
      case "fight":
        if (!e.d) return null;
        return { text: e.combo >= 5 ? t("fe_fx_combo", { n: e.combo }) : t("fe_fx_punch"), sub: tNameSeat(st, e.s) + (e.n ? "　K.O. ×" + e.n : "　−" + e.d), cls: "fe-big-fist", color: hue() };
      case "defeat": return D.ENEMY[e.e].boss ? { text: t("fe_fx_boss_down"), sub: eName(e.e), cls: "fe-big-ult" } : { text: t(e.how === "talk" ? "fe_fx_repent" : "fe_fx_ko"), sub: eName(e.e), cls: "fe-big-ko", color: hue() };
      case "boss": return { text: t("fe_fx_boss"), sub: eName(e.e), cls: "fe-big-boss" };
      case "rescue": return { text: t("fe_fx_rescue"), sub: vName(e.v), cls: "fe-big-good" };
      case "expose": return { text: t("fe_fx_expose"), sub: "🧱 −" + e.n, cls: "fe-big-good" };
      case "clear": return { text: t("fe_fx_clear"), sub: L(D.CHAPTERS[e.ch].name), cls: "fe-big-ult" };
    }
    return null;
  }

  var bigLayer = null;
  function showBig(text, sub, cls, color) {
    if (!bigLayer || !bigLayer.parentNode) { bigLayer = el("div", { class: "fe-big-layer", "aria-hidden": "true" }); document.body.appendChild(bigLayer); }
    var main = el("div", { class: "fe-big-main", text: text });
    if (color) main.style.color = color;
    var n = el("div", { class: "fe-big " + cls }, [main, sub ? el("div", { class: "fe-big-sub", text: sub }) : null]);
    bigLayer.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1100);
  }

  // ---------------- 主畫面 ----------------
  function render() {
    var scrollY = window.scrollY;
    app.innerHTML = "";
    if (!mode) { app.appendChild(renderEntry()); return; }
    if (mode === "raid") { window.PriTestFistRaid.render(app); return; }
    if (mode === "net" && (!room.loaded || room.missing || !room.meta || room.meta.status !== "play" || !room.game)) {
      app.appendChild(renderLobby());
      return;
    }
    var st = game();
    // 剛加入／換了一局：不要把舊紀錄的演出全部重播
    if (!ui.seenLog || st.logSeq < ui.seenLog) ui.seenLog = st.logSeq;
    app.appendChild(topBar(st));
    app.appendChild(meters(st));
    if (st.phase === "story") app.appendChild(renderStory(st));
    else if (st.phase === "play") {
      var bb = bossBanner(st);
      if (bb) app.appendChild(bb);
      var strip = recentStrip(st);
      if (strip) app.appendChild(strip);
      app.appendChild(renderMap(st));
      var ip = inspectPanel(st);
      if (ip) app.appendChild(ip);
      app.appendChild(renderPanel(st));
    } else if (st.phase === "perk") app.appendChild(renderPerk(st));
    else app.appendChild(renderEnd(st));
    app.appendChild(renderLog(st));
    window.scrollTo(0, scrollY);
    playFx(st);
  }

  window.addEventListener("i18n:change", render);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !activeFight && (ui.pick || ui.inspect)) { ui.pick = null; ui.inspect = null; render(); }
  });

  if (window.PriTestFistRaid) window.PriTestFistRaid.onExit = function () { window.PriTestFistRaid.leave(); mode = null; render(); };
  var rid = window.PriTestFistNet ? window.PriTestFistNet.roomFromUrl(location.href) : null;
  if (rid) openRoom(rid);
  else {
    // 潛入到一半關掉頁面：直接回到那一局
    if (window.PriTestFistRaid && window.PriTestFistRaid.hasRun()) mode = "raid";
    render();
  }

  // 測試用（tools/fist_check/）
  window.PriTestFist = { state: function () { return game(); }, mode: function () { return mode; }, room: function () { return room; }, fight: function () { return activeFight; } };
})();
