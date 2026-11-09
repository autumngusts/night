// 深夜居酒屋（izakaya）：畫面。規則在 izakaya_core.js、劇情在 izakaya_story*.js、3D 在 izakaya_3d.js、連線在 izakaya_net.js。
//
// 「場次」（sess）把單機與連線包成同一個介面：sess.s＝整局狀態、sess.pid＝自己、sess.send(意圖)、sess.host＝要不要推進模擬。
//   單機：send 直接 Core.applyIntent；連線房主：套用後廣播；連線其他人：送意圖給房主，畫面用房主廣播的快照。
// 遊戲畫面只建一次骨架（HUD、3D 舞台、側邊面板、劇情／筆記本視窗），之後每一影格用「簽名」判斷要不要重建面板，
// 避免按鈕每影格被重建而吃掉點擊。尖峰的計時與進度條每影格直接改樣式。
// 測試用選擇器（data-act／data-buy／data-board……）見 docs/superpowers/plans/2026-11-09-izakaya-1a.md Task 14，名稱不得改。
(function () {
  "use strict";

  var D = window.PriTestIzakayaData, Core = window.PriTestIzakayaCore, Cast = window.PriTestIzakayaCast;
  var Story = window.PriTestIzakayaStory, Rush = window.PriTestIzakayaRush, V3 = window.PriTestIzakaya3D, Net = window.PriTestIzakayaNet;
  var app = document.getElementById("iz-app");
  if (!app) return;
  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-izakaya-save", NAME_KEY = "pritest-izakaya-name", PREF_KEY = "pritest-izakaya-pref";
  // 跨局記憶（完成幾輪、看過的劇情、達成的結局、解開的祕密）：新局帶進 s.legacy，一年結束時合併回來
  var LEGACY_KEY = "pritest-izakaya-legacy";
  function legacy() { try { return JSON.parse(lsGet(LEGACY_KEY) || "null") || Core.emptyLegacy(); } catch (e) { return Core.emptyLegacy(); } }
  function recordLegacy(s) { if (s && s.end) lsSet(LEGACY_KEY, JSON.stringify(Core.mergeLegacy(legacy(), s))); }
  var L = D.L;

  function t(k, p) { return window.I18N.t(k, p || {}); }
  function lsGet(k) { try { return window.localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* 存不了也能玩 */ } }
  function pref() { try { return JSON.parse(lsGet(PREF_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setPref(p) { var o = pref(); Object.keys(p).forEach(function (k) { o[k] = p[k]; }); lsSet(PREF_KEY, JSON.stringify(o)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); });
    return e;
  }
  function btn(label, onclick, cls, attrs) {
    var a = { type: "button", class: cls || "iz-btn", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function panel(title, children, cls) { return el("section", { class: "iz-panel " + (cls || "") }, [title ? el("h2", null, [title]) : null].concat(children)); }
  function yen(n) { return "¥" + Math.round(n).toLocaleString(); }
  function photo(s, id, cls) { var p = Core.photoOf(s, id); return el("img", { class: "iz-ph " + (cls || ""), src: p ? IMG + p + ".webp" : "", alt: "" }); }
  function nameOf(s, id) { var c = Cast.byId(id); if (c) return L(c.name); var g = s.pool.filter(function (x) { return x.id === id; })[0]; return g ? L(g.name) : id; }
  function hearts(n) { return "♥".repeat(Math.round((n || 0) / 20)) + "♡".repeat(5 - Math.round((n || 0) / 20)); }

  var ui = { screen: "home", tab: "date", datePick: null, devSel: [], devM: "yaki", crSel: [], line: 0, lineId: "", notes: false, noteSel: null, toast: [], quality: pref().quality || "high", want: pref().role || "hall" };
  var sess = null, view3 = null, lastPush = 0, refs = {}, sig = {}, raf = 0, lastT = 0;

  // ---------------- 場次 ----------------
  function soloSession(s) {
    return { solo: true, pid: "me", host: true, s: s,
      send: function (it) { var ok = Core.applyIntent(this.s, "me", it); if (ok) saveSolo(); return ok; } };
  }
  function netSession(room) {
    var se = {
      solo: false, room: room, pid: room.pid, s: null,
      get host() { return room.isHost(); },
      send: function (it) {
        if (room.isHost()) { var ok = this.s && Core.applyIntent(this.s, room.pid, it); if (ok) pushState(true); return ok; }
        room.sendIntent(it);
        return true;
      }
    };
    if (room.wrap && room.wrap.s) se.s = Core.restore(room.wrap.s);
    return se;
  }
  function saveSolo() { if (sess && sess.solo && sess.s) lsSet(SAVE_KEY, sess.s.phase === "end" ? null : Core.serialize(sess.s)); }
  function pushState(now) {
    if (!ui.room || !ui.room.isHost() || !sess || !sess.s) return;
    var tn = Date.now();
    if (!now && tn - lastPush < 100) return;
    lastPush = tn;
    ui.room.writeState(Core.serialize(sess.s));
  }
  function S() { return sess && sess.s; }
  function me() { return sess ? sess.pid : ""; }
  function has(role) { var s = S(); return !!s && Core.hasRole(s, me(), role); }
  // 送出後立刻重繪（不等下一影格），避免畫面上留著已經過時的按鈕被點到
  function send(it) { if (sess) sess.send(it); sig = {}; if (ui.screen === "game") update(); }

  // ---------------- 畫面切換 ----------------
  function go(screen) {
    if (view3) { view3.dispose(); view3 = null; }
    ui.screen = screen; refs = {}; sig = {};
    render();
  }
  function render() {
    if (ui.screen === "game") { renderGame(); return; }
    app.innerHTML = "";
    app.appendChild(topBar());
    if (ui.screen === "home") renderHome();
    else if (ui.screen === "lobby") renderLobby();
  }
  function topBar() {
    return el("div", { class: "iz-top" }, [
      el("h1", { class: "iz-title" }, ["🏮 " + t("iz_title")]),
      ui.room ? el("span", { class: "iz-roomtag" }, ["👥 " + t("iz_room_tag", { n: ui.room.list().length })]) : null,
      ui.screen !== "home" ? btn(t("iz_back"), function () { if (ui.room && ui.screen === "game") go("lobby"); else { leaveRoom(); go("home"); } }, "iz-link") : null
    ]);
  }

  // ---------------- 首頁 ----------------
  function renderHome() {
    var saved = Core.restore(lsGet(SAVE_KEY));
    app.appendChild(el("div", { class: "iz-hero" }, [
      el("div", { class: "iz-hero-art" }, [el("span", { class: "iz-lantern" }, ["🏮"]), el("span", { class: "iz-noren" }, [t("iz_title")])]),
      el("div", null, [el("p", { class: "iz-intro" }, [t("iz_intro")])])
    ]));
    app.appendChild(panel(null, [el("div", { class: "iz-menu" }, [
      saved ? btn(t("iz_continue", { d: saved.day, s: saved.maxStar }), function () { startSolo(saved); }, "iz-big iz-primary", { "data-act": "continue" }) : null,
      btn("🍶 " + t("iz_new"), function () { startSolo(Core.newGame({ seed: (Math.random() * 4294967295) >>> 0, players: [{ pid: "me", name: lsGet(NAME_KEY) || t("iz_you"), want: "hall" }], legacy: legacy() })); }, "iz-big" + (saved ? "" : " iz-primary"), { "data-act": "new" }),
      btn("👥 " + t("iz_coop"), function () { enterRoom(null); }, "iz-big", { "data-act": "coop" })
    ])]));
    app.appendChild(panel(t("iz_how_title"), [el("ol", { class: "iz-rules" }, [1, 2, 3, 4, 5, 6].map(function (i) { return el("li", null, [t("iz_how_" + i)]); }))]));
    // 結局收集與輪數（多重結局、要好幾輪才串得到最深處的祕密）
    var lg = legacy();
    app.appendChild(panel(t("iz_endings_title"), [
      el("p", { class: "iz-small" }, [t("iz_runs", { n: lg.runs || 0 }) + "・" + t("iz_endings_n", { n: Object.keys(lg.endings).length, m: D.ENDINGS.length })]),
      el("ul", { class: "iz-endings" }, D.ENDINGS.map(function (e) { return el("li", { class: lg.endings[e.id] ? "" : "iz-muted" }, [lg.endings[e.id] ? "🏆 " + L(e.name) : "？？？"]); }))
    ], "iz-endings-panel"));
    app.appendChild(panel(t("iz_stars_title"), [el("ul", { class: "iz-stars" }, D.STARS.map(function (st, i) {
      return el("li", null, [el("b", null, ["★".repeat(i + 1)]), " " + L(st.unlock), st.love ? el("span", { class: "iz-love" }, ["💗 " + L(st.love)]) : null]);
    }))]));
  }
  function startSolo(s) {
    if (ui.room) leaveRoom();
    sess = soloSession(s);
    saveSolo();
    go("game");
  }

  // ---------------- 遊戲畫面 ----------------
  function renderGame() {
    var s = S();
    app.innerHTML = "";
    app.appendChild(topBar());
    if (!s) { app.appendChild(panel(null, [el("p", { class: "iz-muted" }, [t("iz_connecting")])])); return; }
    refs.hud = el("div", { class: "iz-hud" });
    refs.stage = el("div", { class: "iz-stage", id: "iz-stage" }, [refs.toast = el("div", { class: "iz-toasts" })]);
    refs.side = el("div", { class: "iz-side", id: "iz-side" });
    refs.story = el("div", { class: "iz-overlay-host" });
    refs.notes = el("div", { class: "iz-overlay-host" });
    app.appendChild(refs.hud);
    app.appendChild(el("div", { class: "iz-game" }, [refs.stage, refs.side]));
    app.appendChild(refs.story);
    app.appendChild(refs.notes);
    sig = {};
    update();
    if (V3.available()) {
      var stage = refs.stage, msg = el("p", { class: "iz-center" }, [t("iz_loading")]);
      stage.appendChild(msg);
      V3.load().then(function () {
        if (ui.screen !== "game" || refs.stage !== stage || view3) return;
        msg.remove();
        view3 = V3.create(stage, { getState: S, getUi: function () { return { hiSeat: ui.hiSeat }; }, onPick: onPick, imgBase: IMG, quality: ui.quality });
      }, function () { msg.textContent = t("iz_no_webgl"); });
    } else refs.stage.appendChild(el("p", { class: "iz-center" }, [t("iz_no_webgl")]));
  }
  // 3D 點擊：尖峰時點座位＝上菜／開做第一個能做的，點工作站格子＝起鍋
  function onPick(kind, a, b) {
    var s = S();
    if (!s || !s.rush) return;
    if (kind === "slot") send({ a: "rt", st: a, slot: b });
    else if (kind === "seat") {
      var se = s.rush.seats[a];
      if (!se) return;
      var k = se.items.findIndex(function (it) { return it.s === "ready"; });
      if (k >= 0) { send({ a: "rs", seat: a, k: k }); return; }
      k = se.items.findIndex(function (it) { return it.s === "wait"; });
      if (k >= 0) send({ a: "rc", seat: a, k: k });
    }
  }

  // 每一影格：房主推進尖峰、連線房主廣播、依簽名更新畫面
  function loop(now) {
    raf = requestAnimationFrame(loop);
    var dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0); lastT = now;
    var s = S();
    if (ui.screen !== "game" || !s) return;
    if (sess.host && s.rush) {
      Core.tick(s, dt);
      if (sess.solo) { if (!s.rush) saveSolo(); } else pushState(false);
    }
    update();
  }
  function update() {
    var s = S();
    if (!s || !refs.hud) return;
    var lang = window.I18N.getLang ? window.I18N.getLang() : "zh";
    var hs = [s.day, s.phase, s.cash, s.rep, s.maxStar, s.star, lang].join("|");
    if (hs !== sig.hud) { sig.hud = hs; drawHud(s); }
    var ss = sideSig(s) + "|" + lang;
    if (ss !== sig.side) { sig.side = ss; drawSide(s); }
    var st = s.story.cur ? JSON.stringify(s.story.cur) + ui.line + lang : "";
    if (st !== sig.story) { sig.story = st; drawStory(s); }
    var ns = ui.notes ? "n" + ui.noteSel + Object.keys(s.notes).length + JSON.stringify(s.story.links) + lang : "";
    if (ns !== sig.notes) { sig.notes = ns; drawNotes(s); }
    if (s.rush) tickRush(s);
  }
  function sideSig(s) {
    var g = Core.curGroup(s), R = s.rush;
    var rs = R ? R.seats.map(function (se) { return se.gid + se.items.map(function (it) { return it.s; }).join(""); }).join(",") + "/" +
      Rush.STATIONS.map(function (k) { return R.st[k].map(function (sl) { return sl ? sl.d + (R.t - sl.t0 >= sl.cook ? "!" : "") : "-"; }).join(""); }).join(",") : "";
    return JSON.stringify([s.phase, s.day, s.board, s.prepped, s.known && Object.keys(s.known).length, s.fridge && Core.fridgeCount(s), s.cash, s.ready, s.sig,
      s.night && s.night.i, g && g.step, g && g.last, s.night && s.night.hints, s.lastDev, s.lastLove, s.date, s.staff, s.rel, s.today, rs,
      ui.tab, ui.datePick, ui.devSel, ui.devM, ui.crSel, s.lastCreate, s.atelier, ui.room ? ui.room.list().length : 0, !!s.story.cur]);
  }
  function drawHud(s) {
    var next = D.STAR_REP[s.star] , prev = D.STAR_REP[s.star - 1] || 0;
    var pct = next ? Math.round((s.rep - prev) / (next - prev) * 100) : 100;
    var roles = (s.roles[me()] || []).map(function (r) { return D.ROLES[r].icon; }).join("");
    refs.hud.innerHTML = "";
    [
      el("span", null, ["📅 " + t("iz_day", { d: s.day, n: D.DAYS }) + "・" + L(D.SEASONS[Core.seasonOf(s.day)])]),
      el("span", { class: "iz-starbar", title: t("iz_rep") + " " + s.rep }, [el("b", null, ["★".repeat(s.star) + "☆".repeat(5 - s.star)]), el("i", { class: "iz-repbar" }, [el("i", { style: "width:" + Math.max(0, Math.min(100, pct)) + "%" })])]),
      el("span", null, ["💴 " + yen(s.cash)]),
      el("span", { title: t("iz_my_roles") }, [roles]),
      btn("📒 " + t("iz_notes"), function () { ui.notes = !ui.notes; sig.notes = null; update(); }, "iz-btn iz-small", { "data-act": "notes" })
    ].forEach(function (x) { refs.hud.appendChild(x); });
  }

  // ---------------- 側邊面板（依階段）----------------
  function drawSide(s) {
    var box = refs.side;
    box.innerHTML = "";
    var kids;
    if (s.phase === "market") kids = sideMarket(s);
    else if (s.phase === "prep") kids = sidePrep(s);
    else if (s.phase === "service") kids = s.rush ? sideRush(s) : sideService(s);
    else if (s.phase === "close") kids = sideClose(s);
    else if (s.phase === "holiday") kids = sideHoliday(s);
    else if (s.phase === "end") kids = sideEnd(s);
    (kids || []).forEach(function (k) { if (k) box.appendChild(k); });
  }
  function readyBar(s, label) {
    var mine = !!s.ready[me()];
    var others = s.order.map(function (p) { return (s.ready[p] ? "✅" : "…") + (s.players[p].name || "?"); }).join("　");
    return el("div", { class: "iz-ready" }, [
      btn(mine ? t("iz_unready") : (label || t("iz_ready")), function () { send({ a: "ready", v: !mine }); }, "iz-btn iz-primary", { "data-act": "ready" }),
      s.order.length > 1 ? el("span", { class: "iz-small iz-muted" }, [others]) : null
    ]);
  }
  function roleNeed(role) { return el("p", { class: "iz-small iz-muted" }, [t("iz_role_need", { r: D.ROLES[role].icon + L(D.ROLES[role].name) })]); }

  // 市場
  var ING_CATS = [["veg", "iz_cat_veg"], ["meat", "iz_cat_meat"], ["sea", "iz_cat_sea"], ["other", "iz_cat_other"], ["drink", "iz_cat_drink"]];
  function sideMarket(s) {
    var can = has("buyer"), se = Core.seasonOf(s.day);
    var head = el("div", { class: "iz-row iz-between" }, [el("b", null, ["🧺 " + t("iz_market")]), el("span", { class: "iz-small" }, [t("iz_fridge", { n: Core.fridgeCount(s), m: Core.fridgeCap(s) })])]);
    var need = needIngs(s);
    var groups = ING_CATS.map(function (c) {
      var ids = Object.keys(D.INGS).filter(function (k) { return D.INGS[k].cat === c[0]; });
      return el("div", { class: "iz-ing-group" }, [el("h3", null, [t(c[1])]), el("div", { class: "iz-ings" }, ids.map(function (k) {
        var g = D.INGS[k], st = Core.stock(s, k), exp = st ? s.fridge[k][0] : 0;
        return el("div", { class: "iz-ing" + (need[k] ? " iz-need" : "") }, [
          el("span", { class: "iz-ing-n" }, [L(g.name), g.season === se ? el("em", { class: "iz-shun" }, [t("iz_shun")]) : null]),
          el("span", { class: "iz-small" }, [yen(s.mk[k])]),
          el("span", { class: "iz-small iz-muted" }, [st ? "×" + st + (exp - s.day <= 1 ? " ⚠" : "") : ""]),
          btn("+1", function () { send({ a: "buy", id: k, n: 1 }); }, "iz-btn iz-small", { "data-buy": k, disabled: !can || s.cash < s.mk[k] || Core.fridgeCount(s) >= Core.fridgeCap(s) ? true : null })
        ]);
      }))]);
    });
    return [panel(null, [head, can ? el("p", { class: "iz-small iz-muted" }, [t("iz_market_hint")]) : roleNeed("buyer")].concat(groups).concat([readyBar(s, t("iz_to_prep"))]))];
  }
  // 黑板上的菜還缺的食材（市場標示用；黑板還沒排就不標）
  function needIngs(s) {
    var out = {};
    s.board.forEach(function (id) {
      Object.keys(D.DISHES[id].ing).forEach(function (k) { if (Core.stock(s, k) < 2) out[k] = 1; });
    });
    return out;
  }
  function flavor(d) {
    return el("span", { class: "iz-flavor", title: D.DIMS.map(function (k, i) { return L(D.DIM_NAMES[k]) + d.f[i]; }).join(" ") },
      D.DIMS.map(function (k, i) { return el("i", { class: "iz-f-" + k, style: "height:" + (2 + d.f[i] * 5) + "px" }); }));
  }
  // 準備
  var DISH_CATS = ["yakitori", "sashimi", "nimono", "agemono", "kobachi", "meshi", "creative", "drink"];
  function sidePrep(s) {
    var hall = has("hall"), chef = has("chef");
    var board = el("div", { class: "iz-board" }, [el("b", null, ["📋 " + t("iz_board", { n: s.board.length, m: D.BOARD_MAX })]), el("div", { class: "iz-chips" }, s.board.map(function (id) {
      return el("span", { class: "iz-chip" + (s.sig === id ? " iz-sig" : "") }, [L(D.DISHES[id].name) + (s.prepped[id] ? " (" + s.prepped[id] + ")" : "")]);
    }))]);
    var lists = DISH_CATS.map(function (c) {
      var ids = Object.keys(s.known).filter(function (k) { return D.DISHES[k].cat === c; });
      if (!ids.length) return null;
      return el("div", { class: "iz-dish-group" }, [el("h3", null, [t("iz_dc_" + c)]), el("div", { class: "iz-dishes" }, ids.map(function (k) {
        var d = D.DISHES[k], on = s.board.indexOf(k) >= 0;
        return el("div", { class: "iz-dish" + (on ? " iz-on" : "") + (Core.canMake(s, k) ? "" : " iz-cant") }, [
          btn((on ? "✓ " : "") + L(d.name), function () {
            var ids2 = s.board.slice(), i = ids2.indexOf(k);
            if (i >= 0) ids2.splice(i, 1); else ids2.push(k);
            send({ a: "board", ids: ids2 });
          }, "iz-dish-b", { "data-board": k, disabled: !hall || (!on && s.board.length >= D.BOARD_MAX) ? true : null }),
          flavor(d), el("span", { class: "iz-small" }, [yen(d.price)]),
          d.prep ? btn(t("iz_prep_b") + (s.prepped[k] ? "(" + s.prepped[k] + ")" : ""), function () { send({ a: "prep", id: k }); }, "iz-btn iz-small", { "data-prep": k, disabled: !chef || !Core.hasIngs(s, d.ing) ? true : null }) : null,
          s.maxStar >= 3 && c !== "drink" ? btn(s.sig === k ? "⭐" : "☆", function () { send({ a: "sig", id: k }); }, "iz-btn iz-small", { "data-sig": k, title: t("iz_sig"), disabled: !hall ? true : null }) : null
        ]);
      }))]);
    });
    return [panel(null, [board, hall ? el("p", { class: "iz-small iz-muted" }, [t("iz_board_hint")]) : roleNeed("hall")].concat(lists).concat([readyBar(s, t("iz_open_shop"))])), devPanel(s)];
  }
  var METHODS = ["yaki", "nama", "ni", "age", "ae", "meshi"];
  function devPanel(s) {
    var chef = has("chef"), bar = has("bar");
    var ings = Object.keys(s.fridge).filter(function (k) { return D.INGS[k].cat !== "drink"; });
    ui.devSel = ui.devSel.filter(function (k) { return Core.stock(s, k) > 0; });
    var ld = s.lastDev && s.lastDev.pid === me() ? el("p", { class: s.lastDev.ok ? "iz-good" : "iz-muted" }, [s.lastDev.ok ? "🎉 " + t("iz_dev_ok", { n: L(D.DISHES[s.lastDev.id].name) }) : t("iz_dev_fail")]) : null;
    var locked = Object.keys(D.DISHES).filter(function (k) { return D.DISHES[k].cat === "drink" && !s.known[k]; });
    return panel("🧪 " + t("iz_dev"), [
      chef ? el("p", { class: "iz-small iz-muted" }, [t("iz_dev_hint")]) : roleNeed("chef"),
      el("div", { class: "iz-chips" }, ings.map(function (k) {
        var on = ui.devSel.indexOf(k) >= 0;
        return btn((on ? "✓" : "") + L(D.INGS[k].name), function () { var i = ui.devSel.indexOf(k); if (i >= 0) ui.devSel.splice(i, 1); else if (ui.devSel.length < 3) ui.devSel.push(k); sig.side = null; update(); }, "iz-btn iz-small" + (on ? " iz-on" : ""), { "data-dev-ing": k, disabled: !chef ? true : null });
      })),
      el("div", { class: "iz-seg" }, METHODS.map(function (m) { return btn(t("iz_m_" + m), function () { ui.devM = m; sig.side = null; update(); }, "iz-btn iz-small" + (ui.devM === m ? " iz-on" : ""), { "data-dev-m": m, disabled: !chef ? true : null }); })),
      btn(t("iz_dev_try"), function () { send({ a: "dev", ings: ui.devSel.slice(), m: ui.devM }); ui.devSel = []; }, "iz-btn iz-primary", { "data-act": "dev", disabled: !chef || !ui.devSel.length ? true : null }),
      ld,
      createBox(s, chef),
      el("h3", null, ["🍶 " + t("iz_dev_drink")]),
      bar ? null : roleNeed("bar"),
      el("div", { class: "iz-chips" }, locked.map(function (k) {
        var d = D.DISHES[k];
        return btn(L(d.name) + "（" + Object.keys(d.ing).map(function (i) { return L(D.INGS[i].name); }).join("＋") + "）", function () { send({ a: "devDrink", id: k }); }, "iz-btn iz-small", { "data-dev-drink": k, disabled: !bar || !Core.hasIngs(s, d.ing) ? true : null });
      }))
    ], "iz-dev");
  }

  // 創作料理（規格第 2 期）：兩種素材查「世界美食」的配方；做出料理就上得了黑板，半成品收進工坊
  function createBox(s, chef) {
    var mats = Core.materials(s);
    if (!mats.length) return null;
    ui.crSel = ui.crSel.filter(function (g) { return mats.some(function (m) { return m.id === g; }); });
    var lc = s.lastCreate && s.lastCreate.pid === me() ? s.lastCreate : null;
    var res = !lc ? null : lc.kind === "dish" ? el("p", { class: "iz-good" }, ["✨ " + t(lc.first ? "iz_create_ok" : "iz_create_more", { n: L(D.DISHES[lc.id].name) })])
      : lc.kind === "prep" ? el("p", null, ["🧪 " + t("iz_create_prep", { n: L(Core.gName(lc.gid)) })]) : el("p", { class: "iz-muted" }, [t("iz_create_fail")]);
    function chip(m) {
      var on = ui.crSel.indexOf(m.id) >= 0;
      return btn((on ? "✓" : "") + L(Core.gName(m.id)) + (m.src === "atelier" ? "×" + m.n : ""), function () {
        var i = ui.crSel.indexOf(m.id);
        if (i >= 0) ui.crSel.splice(i, 1); else if (ui.crSel.length < 2) ui.crSel.push(m.id);
        sig.side = null; update();
      }, "iz-btn iz-small" + (on ? " iz-on" : ""), { "data-cr": m.id, disabled: !chef ? true : null });
    }
    return el("div", { class: "iz-create" }, [
      el("h3", null, ["✨ " + t("iz_create")]),
      el("p", { class: "iz-small iz-muted" }, [t("iz_create_hint")]),
      el("div", { class: "iz-small" }, [t("iz_basic")]), el("div", { class: "iz-chips" }, mats.filter(function (m) { return m.src === "basic"; }).map(chip)),
      el("div", { class: "iz-small" }, [t("iz_fridge_mats")]), el("div", { class: "iz-chips" }, mats.filter(function (m) { return m.src === "ing"; }).map(chip)),
      mats.some(function (m) { return m.src === "atelier"; }) ? el("div", { class: "iz-small" }, [t("iz_atelier")]) : null,
      el("div", { class: "iz-chips" }, mats.filter(function (m) { return m.src === "atelier"; }).map(chip)),
      btn(t("iz_create_try"), function () { send({ a: "create", g1: ui.crSel[0], g2: ui.crSel[1] || ui.crSel[0] }); ui.crSel = []; }, "iz-btn iz-primary", { "data-act": "create", disabled: !chef || !ui.crSel.length ? true : null }),
      res
    ]);
  }

  // 營業（回合制）
  var OPEN_LINES = { genki: "iz_open_genki", cool: "iz_open_cool", shy: "iz_open_shy", otona: "iz_open_otona", tsundere: "iz_open_tsundere", tennen: "iz_open_tennen", majime: "iz_open_majime", gossip: "iz_open_gossip", romantic: "iz_open_romantic", cynical: "iz_open_cynical", care: "iz_open_romantic" };
  function reqText(g) {
    if (!g.req) return "";
    var w = g.req.want[0], a = g.req.avoid[0];
    if (w && a) return t("iz_req_both", { d: L(D.DIM_NAMES[w]), e: L(D.DIM_NAMES[a]) });
    if (w) return t("iz_req_want", { d: L(D.DIM_NAMES[w]) });
    if (a) return t("iz_req_avoid", { d: L(D.DIM_NAMES[a]) });
    return t("iz_req_any");
  }
  function guestCard(s, g) {
    var guest = Core.guestOf(s, g), c = Cast.byId(g.gid);
    return el("div", { class: "iz-guest" }, [
      photo(s, g.gid, "iz-ph-l"),
      el("div", null, [
        el("b", null, [nameOf(s, g.gid) + (g.n > 1 ? " ×" + g.n : "") + (g.critic ? " 🖊" : "") + (g.resv ? " 📞" : "")]),
        el("div", { class: "iz-small iz-muted" }, [L(guest.job) + (c ? "・" + t("iz_regular") + " " + hearts(s.players[me()] ? s.players[me()].aff[g.gid] : 0) : "")]),
        el("div", { class: "iz-satbar" }, [el("i", { style: "width:" + g.sat + "%" })])
      ])
    ]);
  }
  function lastResult(s) {
    var n = s.night, g = n && n.groups[n.i - 1];
    if (!g || !g.last || g.kind === "rush") return null;
    return el("p", { class: "iz-small iz-muted" }, ["🧾 " + nameOf(s, g.gid) + "：" + yen(g.bill) + "・" + t("iz_sat") + g.sat]);
  }
  function reaction(g) {
    if (!g.last) return null;
    if (g.last.taboo) return el("p", { class: "iz-bad" }, [t("iz_react_taboo")]);
    var c = g.last.clue;
    if (!c || c.k !== "pref") return el("p", null, [g.last.delta >= 0 ? t("iz_react_ok") : t("iz_react_meh")]);
    return el("p", { class: g.last.delta >= 10 ? "iz-good" : g.last.delta < 0 ? "iz-bad" : "" }, [g.last.delta >= 0 ? t("iz_react_good", { d: L(D.DIM_NAMES[c.d]) }) : t("iz_react_bad", { d: L(D.DIM_NAMES[c.d]) })]);
  }
  function sideService(s) {
    var g = Core.curGroup(s);
    if (!g) return [panel(null, [el("p", null, [t("iz_closing")])])];
    if (g.kind === "rush") {
      return [panel("🔥 " + t("iz_rush"), [el("p", null, [t("iz_rush_intro")]),
        has("hall") ? btn(t("iz_rush_start"), function () { send({ a: "rush" }); }, "iz-big iz-primary", { "data-act": "rush" }) : el("p", { class: "iz-muted" }, [t("iz_wait_hall")])])];
    }
    if (g.step === "story") return [panel(null, [guestCard(s, g), el("p", { class: "iz-muted" }, [t("iz_story_now")])])];
    var guest = Core.guestOf(s, g), kids = [guestCard(s, g)];
    var hall = has("hall");
    if (g.step === "talk") {
      kids.push(el("p", { class: "iz-say" }, [t(OPEN_LINES[guest.persona] || "iz_open_cool")]));
      kids.push(el("div", { class: "iz-choices" }, g.topics.map(function (tp, i) {
        return btn("💬 " + L(D.TOPICS[tp]), function () { send({ a: "talk", c: i }); }, "iz-btn", { "data-talk": String(i), disabled: !hall ? true : null });
      })));
      if (!hall) kids.push(roleNeed("hall"));
    } else {
      if (g.picked) kids.push(el("p", { class: "iz-small" }, [g.liked ? t("iz_talk_liked") : t("iz_talk_meh")]));
      if (g.saidTaboo) kids.push(el("p", { class: "iz-say" }, [t("iz_say_taboo_" + g.saidTaboo)]));
      if (g.step === "drink") kids.push(reaction(g));
      var drinkStep = g.step === "drink";
      kids.push(el("p", { class: "iz-say" }, [drinkStep ? (guest.drink === 0 ? t("iz_req_nodrink") : t("iz_req_drink")) : reqText(g)]));
      var role = drinkStep ? "bar" : "chef", mine = has(role);
      var opts = s.board.filter(function (k) { return (D.DISHES[k].cat === "drink") === drinkStep; });
      var hints = s.night.hints || {};
      kids.push(el("div", { class: "iz-serve" }, opts.map(function (k) {
        var d = D.DISHES[k], hinted = Object.keys(hints).filter(function (p) { return hints[p] === k; }).map(function (p) { return s.players[p].name; });
        return el("div", { class: "iz-serve-row" }, [
          btn(L(d.name), function () { send({ a: "serve", id: k }); }, "iz-btn" + (s.sig === k ? " iz-sig" : ""), { "data-serve": k, disabled: !mine || !Core.canMake(s, k) ? true : null }),
          flavor(d),
          d.tags.length ? el("span", { class: "iz-small iz-muted" }, [d.tags.map(function (x) { return L(D.TAG_NAMES[x]); }).join("・")]) : null,
          hinted.length ? el("span", { class: "iz-hinted" }, ["👉 " + hinted.join("、")]) : null,
          !has("hall") && !mine ? btn("👉", function () { send({ a: "hint", c: k }); }, "iz-btn iz-small", { "data-hint": k, title: t("iz_hint") }) : null
        ]);
      })));
      if (!mine) kids.push(roleNeed(role));
      if (!opts.some(function (k) { return Core.canMake(s, k); }) && hall) kids.push(btn(t("iz_skip"), function () { send({ a: "skip" }); }, "iz-btn", { "data-act": "skip" }));
      kids.push(notesMini(s, g.gid));
    }
    kids.push(lastResult(s));
    kids.push(el("p", { class: "iz-small iz-muted" }, [t("iz_group_n", { i: s.night.i + 1, n: s.night.groups.length })]));
    return [panel(null, kids)];
  }
  // 推理筆記（目前客人）
  function notesMini(s, gid) {
    var n = s.notes[gid];
    if (!n) return el("p", { class: "iz-small iz-muted" }, ["📒 " + t("iz_notes_none")]);
    var tags = [];
    D.DIMS.forEach(function (k) { var p = n.pref[k]; if (p) tags.push(el("span", { class: "iz-clue iz-clue-" + p.lv }, [(p.v > 0 ? "👍" : "👎") + L(D.DIM_NAMES[k]) + (p.lv === "s" ? "?" : "")])); });
    if (n.taboo) tags.push(el("span", { class: "iz-clue iz-clue-c iz-bad" }, ["🚫" + L(D.TAG_NAMES[n.taboo])]));
    if (n.topic) { var gu = Core.guestOf(s, { kind: Cast.byId(gid) ? "reg" : "walk", gid: gid }); tags.push(el("span", { class: "iz-clue iz-clue-c" }, ["💬" + L(D.TOPICS[gu.topic])])); }
    return el("div", { class: "iz-notes-mini" }, ["📒 "].concat(tags));
  }

  // 尖峰
  function sideRush(s) {
    var R = s.rush;
    var seats = el("div", { class: "iz-tickets" }, R.seats.filter(function (se) { return se.gid; }).map(function (se) {
      return el("div", { class: "iz-ticket" }, [
        photo(s, se.gid, "iz-ph-s"),
        el("div", { class: "iz-pat" }, [el("i", { "data-pat": String(se.id) })]),
        el("div", null, se.items.map(function (it, k) {
          var d = D.DISHES[it.d], role = Rush.STATION_ROLE[d.st];
          var b = it.s === "wait" ? btn("▶ " + L(d.name), function () { send({ a: "rc", seat: se.id, k: k }); }, "iz-btn iz-small", { "data-rc": se.id + ":" + k, disabled: !has(role) ? true : null })
            : it.s === "ready" ? btn("🍽 " + L(d.name), function () { send({ a: "rs", seat: se.id, k: k }); }, "iz-btn iz-small iz-primary", { "data-rs": se.id + ":" + k, disabled: !has("hall") ? true : null })
            : el("span", { class: "iz-small iz-muted" }, [(it.s === "done" ? "✓ " : "♨ ") + L(d.name)]);
          return el("div", null, [b]);
        }))
      ]);
    }));
    var stations = el("div", { class: "iz-stations" }, Rush.STATIONS.map(function (k) {
      return el("div", { class: "iz-station" }, [el("b", { class: "iz-small" }, [t("iz_st_" + k) + " " + D.ROLES[Rush.STATION_ROLE[k]].icon]), el("div", null, R.st[k].map(function (sl, i) {
        if (!sl) return el("div", { class: "iz-slot iz-empty" }, ["—"]);
        var done = R.t - sl.t0 >= sl.cook;
        return el("div", { class: "iz-slot" }, [
          el("span", { class: "iz-small" }, [L(D.DISHES[sl.d].name)]),
          el("i", { class: "iz-prog" }, [el("i", { "data-prog": k + ":" + i })]),
          btn(done ? "⬆" : "…", function () { send({ a: "rt", st: k, slot: i }); }, "iz-btn iz-small" + (done ? " iz-primary" : ""), { "data-rt": k + ":" + i, disabled: !done || !has(Rush.STATION_ROLE[k]) ? true : null })
        ]);
      }))]);
    }));
    return [el("section", { class: "iz-panel", id: "iz-rush" }, [
      el("div", { class: "iz-row iz-between" }, [el("b", null, ["🔥 " + t("iz_rush")]), el("span", { class: "iz-rush-time", "data-rush-t": "1" }, [""]), el("span", { class: "iz-small" }, ["🍽 " + R.stats.served + "・🔥" + R.stats.burnt + "・🚪" + R.stats.left])]),
      el("p", { class: "iz-small iz-muted" }, [t("iz_rush_hint")]),
      seats, stations
    ])];
  }
  function tickRush(s) {
    var R = s.rush, box = refs.side;
    var tt = box.querySelector("[data-rush-t]");
    if (tt) tt.textContent = "⏱ " + Math.max(0, Math.ceil(R.dur - R.t)) + "s";
    R.seats.forEach(function (se) {
      var b = box.querySelector('[data-pat="' + se.id + '"]');
      if (b && se.max) { var f = Math.max(0, se.pat) / se.max; b.style.width = Math.round(f * 100) + "%"; b.className = f > 0.5 ? "" : f > 0.25 ? "iz-warn" : "iz-danger"; }
    });
    Rush.STATIONS.forEach(function (k) {
      R.st[k].forEach(function (sl, i) {
        var b = box.querySelector('[data-prog="' + k + ":" + i + '"]');
        if (!b || !sl) return;
        var el2 = R.t - sl.t0, f = Math.min(1, el2 / sl.cook);
        b.style.width = Math.round(f * 100) + "%";
        b.className = f < 1 ? "" : (k === "grill" || k === "fry") && el2 > sl.cook * 1.4 ? "iz-burn" : "iz-done";
      });
    });
  }

  // 打烊
  function sideClose(s) {
    var d = s.today || {};
    var kids = [
      el("div", { class: "iz-close-grid" }, [
        el("div", null, [el("small", null, [t("iz_rev")]), el("b", null, [yen(d.rev || 0)])]),
        el("div", null, [el("small", null, [t("iz_cost")]), el("b", null, [yen(d.cost || 0)])]),
        el("div", null, [el("small", null, [t("iz_sat")]), el("b", null, [String(d.sat || 0)])]),
        el("div", null, [el("small", null, [t("iz_rep")]), el("b", null, [String(s.rep)])])
      ]),
      d.rush ? el("p", { class: "iz-small" }, ["🔥 " + t("iz_rush_res", { a: d.rush.served, b: d.rush.burnt, c: d.rush.left })]) : null,
      d.unlock ? el("div", { class: "iz-starup" }, [el("b", null, ["★".repeat(d.unlock) + " " + t("iz_star_up")]), el("p", null, [L(D.STARS[d.unlock - 1].unlock)]), D.STARS[d.unlock - 1].love ? el("p", { class: "iz-love" }, ["💗 " + L(D.STARS[d.unlock - 1].love)]) : null]) : null,
      s.star < 5 ? el("p", { class: "iz-small iz-muted" }, [t("iz_next_star", { n: D.STAR_REP[s.star] - s.rep })]) : null,
      readyBar(s, Core.dowOf(s.day) === 6 ? t("iz_to_holiday") : t("iz_next_day"))
    ];
    return [el("section", { class: "iz-panel", id: "iz-close" }, [el("h2", null, ["🏮 " + t("iz_close_title", { d: s.day })])].concat(kids))];
  }

  // 公休日
  function sideHoliday(s) {
    var tabs = el("div", { class: "iz-seg" }, [["date", "💗 " + t("iz_tab_date")], ["dev", "🧪 " + t("iz_dev")], ["staff", "🧑‍🍳 " + t("iz_tab_staff")]].map(function (x) {
      return btn(x[1], function () { ui.tab = x[0]; sig.side = null; update(); }, "iz-btn" + (ui.tab === x[0] ? " iz-on" : ""), { "data-tab": x[0] });
    }));
    var body = ui.tab === "dev" ? [devPanel(s)] : ui.tab === "staff" ? [staffPanel(s)] : [datePanel(s)];
    return [panel("🌸 " + t("iz_holiday"), [tabs])].concat(body).concat([panel(null, [readyBar(s, t("iz_next_day"))])]);
  }
  function datePanel(s) {
    var pid = me(), dt = s.date[pid];
    if (s.maxStar < 3) return panel(null, [el("p", { class: "iz-muted" }, [t("iz_date_need")])]);
    if (dt && !dt.done) {
      var spot = D.SPOTS.filter(function (x) { return x.id === dt.spot; })[0], round = spot.rounds[dt.r];
      return panel("💗 " + L(spot.name), [
        el("div", { class: "iz-guest" }, [photo(s, dt.cid, "iz-ph-l"), el("b", null, [nameOf(s, dt.cid)])]),
        dt.log.length ? el("p", { class: "iz-small" }, [dt.log[dt.log.length - 1].liked ? t("iz_date_liked") : t("iz_date_meh")]) : null,
        el("p", { class: "iz-say" }, [round.q]),
        el("div", { class: "iz-choices" }, round.ch.map(function (o, i) { return btn(o.t, function () { send({ a: "dc", c: i }); }, "iz-btn", { "data-dc": String(i) }); }))
      ]);
    }
    if (dt && dt.done) {
      var c = Cast.byId(dt.cid);
      return panel("💗 " + t("iz_date_done"), [
        el("div", { class: "iz-guest" }, [photo(s, dt.cid, "iz-ph-l"), el("div", null, [el("b", null, [nameOf(s, dt.cid)]), el("div", null, [hearts(Core.affOf(s, pid, dt.cid))])])]),
        // 心動：在角色最愛的地點會演專屬場景（劇情視窗）；其他地點用該地點的通用描寫＋角色台詞
        dt.heart ? el("div", { class: "iz-heart" }, [el("b", null, [t("iz_heart")]),
          // 批次 F 後每人每地點都有心動場景（劇情視窗演過了）；沒有場景時才補地點的通用描寫
          !Story.all().some(function (x) { return x.at === "date" && x.who[0] === dt.cid && x.cond.spot === dt.spot; }) ? el("p", { class: "iz-small" }, [D.SPOTS.filter(function (x) { return x.id === dt.spot; })[0].heart]) : null,
          el("p", null, [c.lines.heart])]) : null,
        lovePanel(s, dt.cid)
      ]);
    }
    var cands = Cast.REGULARS.filter(function (c) { return !c.noLove; }).concat(Cast.STAFF.filter(function (c) { return s.staff.met[c.id]; }));
    var list = el("div", { class: "iz-cands" }, cands.map(function (c) {
      var ok = Core.canDate(s, pid, c.id), aff = Core.affOf(s, pid, c.id), rel = s.rel[c.id];
      return el("div", { class: "iz-cand" + (ui.datePick === c.id ? " iz-on" : "") }, [
        photo(s, c.id, "iz-ph-s"),
        el("div", null, [el("b", null, [L(c.name)]), el("div", { class: "iz-small" }, [hearts(aff) + (rel ? " " + t("iz_rel_" + rel.stage) + (rel.pid !== pid ? "（" + s.players[rel.pid].name + "）" : "") : "")])]),
        btn(t("iz_date_ask"), function () { ui.datePick = c.id; sig.side = null; update(); }, "iz-btn iz-small", { "data-date": c.id, disabled: !ok ? true : null })
      ]);
    }));
    var kids = [el("p", { class: "iz-small iz-muted" }, [t("iz_date_pick", { n: D.DATE_AFF })]), list];
    if (ui.datePick && Core.canDate(s, pid, ui.datePick)) {
      kids.push(el("h3", null, [t("iz_date_spot")]));
      kids.push(el("div", { class: "iz-spots" }, D.SPOTS.map(function (sp) { return btn(L(sp.name), function () { send({ a: "date", cid: ui.datePick, spot: sp.id }); ui.datePick = null; }, "iz-btn", { "data-spot": sp.id }); })));
      kids.push(lovePanel(s, ui.datePick));
    }
    var ll = s.lastLove && s.lastLove.pid === pid ? el("p", { class: s.lastLove.ok ? "iz-good" : "iz-muted" }, [s.lastLove.tri ? t("iz_tri") : s.lastLove.ok ? t("iz_love_ok_" + s.lastLove.kind, { n: nameOf(s, s.lastLove.cid) }) : t("iz_love_no")]) : null;
    if (ll) kids.push(ll);
    return panel(null, kids);
  }
  function lovePanel(s, cid) {
    if (s.maxStar < 5 || !cid) return null;
    var pid = me(), r = s.rel[cid], c = Cast.byId(cid), mine = r && r.pid === pid;
    var kids = [];
    if (!mine) kids.push(btn("💌 " + t("iz_confess"), function () { send({ a: "confess", cid: cid }); }, "iz-btn", { "data-love": "confess", disabled: Core.affOf(s, pid, cid) < D.CONFESS_AFF ? true : null }));
    if (mine && r.stage === 1) kids.push(btn("💍 " + t("iz_propose"), function () { send({ a: "propose", cid: cid }); }, "iz-btn", { "data-love": "propose" }));
    if (mine && r.stage === 2) kids.push(btn("💒 " + t("iz_wedding"), function () { send({ a: "wedding", cid: cid }); }, "iz-btn iz-primary", { "data-love": "wedding" }));
    if (mine && r.stage === 3) kids.push(el("p", { class: "iz-love" }, ["💒 " + c.lines.wedding]));
    else if (mine && r.stage === 2) kids.push(el("p", { class: "iz-love" }, [c.lines.propose]));
    else if (mine) kids.push(el("p", { class: "iz-love" }, [c.lines.confess]));
    return el("div", { class: "iz-lovebox" }, [el("small", null, [t("iz_love_need", { a: D.CONFESS_AFF, b: D.PROPOSE_AFF })])].concat(kids));
  }
  function staffPanel(s) {
    var met = Cast.STAFF.filter(function (c) { return s.staff.met[c.id]; }), hall = has("hall");
    if (!met.length) return panel(null, [el("p", { class: "iz-muted" }, [t("iz_staff_none")])]);
    return panel(null, [el("p", { class: "iz-small iz-muted" }, [s.maxStar < 4 ? t("iz_staff_need") : t("iz_crew_n", { n: s.staff.crew.length, m: Core.maxCrew(s) })]), el("div", { class: "iz-cands" }, met.map(function (c) {
      var hired = s.staff.crew.indexOf(c.id) >= 0;
      return el("div", { class: "iz-cand" + (hired ? " iz-on" : "") }, [
        photo(s, c.id, "iz-ph-s"),
        el("div", null, [el("b", null, [L(c.name)]), el("div", { class: "iz-small" }, [t("iz_ab_" + c.ability) + "・" + t("iz_wage") + yen(c.wage)]), el("div", { class: "iz-small iz-muted" }, [L(c.bio)])]),
        hired ? btn(t("iz_fire"), function () { send({ a: "fire", id: c.id }); }, "iz-btn iz-small", { "data-fire": c.id, disabled: !hall ? true : null })
          : btn(t("iz_hire"), function () { send({ a: "hire", id: c.id }); }, "iz-btn iz-small", { "data-hire": c.id, disabled: !hall || !Core.canHire(s, c.id) ? true : null })
      ]);
    }))]);
  }

  // 結局
  function sideEnd(s) {
    var e = s.end || {}, pid = me(), partner = Core.partnerOf(s, pid);
    // 事件線的結局：看過該線的高潮段落就算完成（1b：六條線）
    var arcs = [["band_06", "iz_end_band"], ["contest_06", "iz_end_contest"], ["dance_06", "iz_end_dance"], ["invest_06", "iz_end_invest"],
      ["will_06", "iz_end_will"], ["master_06", "iz_end_master"],
      ["bride_06", "iz_end_bride"], ["critic_06", "iz_end_critic"], ["idol_06", "iz_end_idol"]].filter(function (x) { return s.story.seen[x[0]]; }).map(function (x) { return t(x[1]); });
    lsSet(SAVE_KEY, null);
    if (ui.recorded !== s.seed) { ui.recorded = s.seed; recordLegacy(s); }
    var ed = D.ENDINGS.filter(function (x) { return x.id === e.ending; })[0];
    return [el("section", { class: "iz-panel", id: "iz-end" }, [
      el("h2", null, ["🎆 " + t("iz_end_title")]),
      ed ? el("div", { class: "iz-ending" }, [el("b", null, ["〈" + L(ed.name) + "〉"]), el("p", null, [L(ed.desc)])]) : null,
      el("p", { class: "iz-big-star" }, ["★".repeat(e.star || 1) + "☆".repeat(5 - (e.star || 1))]),
      el("p", null, [t("iz_end_" + (e.star || 1))]),
      el("p", null, [t("iz_end_cash", { n: yen(e.cash || 0) })]),
      arcs.length ? el("ul", null, arcs.map(function (a) { return el("li", null, [a]); })) : null,
      partner ? el("div", { class: "iz-guest" }, [photo(s, partner, "iz-ph-l"), el("p", { class: "iz-love" }, [t("iz_end_partner", { n: nameOf(s, partner) }) + " " + Cast.byId(partner).lines.wedding])]) : null,
      btn(t("iz_again"), function () { leaveRoom(); go("home"); }, "iz-big iz-primary")
    ])];
  }

  // ---------------- 劇情視窗 ----------------
  function drawStory(s) {
    var host = refs.story;
    host.innerHTML = "";
    var cur = s.story.cur;
    if (!cur) { ui.lineId = ""; return; }
    var sc = Story.byId(cur.id);
    if (!sc) return;
    if (ui.lineId !== cur.id) { ui.lineId = cur.id; ui.line = 0; }
    var priv = cur.pid && cur.pid !== me();
    if (priv) {
      host.appendChild(el("div", { class: "iz-overlay", id: "iz-story" }, [el("div", { class: "iz-story-box" }, [el("p", null, [t("iz_private", { n: s.players[cur.pid].name })])])]));
      return;
    }
    var shown = sc.lines.slice(0, ui.line + 1), last = ui.line >= sc.lines.length - 1;
    var sp = shown[shown.length - 1][0];
    var votes = cur.votes || {}, myVote = votes[me()];
    var choices = sc.ch || [{ t: t("iz_continue_story") }];
    host.appendChild(el("div", { class: "iz-overlay", id: "iz-story" }, [el("div", { class: "iz-story-box" }, [
      sp ? el("div", { class: "iz-story-who" }, [photo(s, sp, "iz-ph-l"), el("b", null, [nameOf(s, sp)])]) : null,
      el("div", { class: "iz-story-lines" }, shown.map(function (l, i) { return el("p", { class: (l[0] ? "iz-line" : "iz-narr") + (i === shown.length - 1 ? " iz-cur" : "") }, [(l[0] && i !== shown.length - 1 ? nameOf(s, l[0]) + "：" : "") + l[1]]); })),
      !last ? btn(t("iz_next"), function () { ui.line++; sig.story = null; update(); }, "iz-btn iz-primary", { "data-next": "1" }) : el("div", { class: "iz-choices" }, choices.map(function (o, i) {
        var who = Object.keys(votes).filter(function (p) { return votes[p] === i; }).map(function (p) { return s.players[p].name; });
        return btn(o.t + (s.order.length > 1 && who.length ? "（" + who.join("、") + "）" : ""), function () { send({ a: "vote", c: i }); }, "iz-btn" + (myVote === i ? " iz-on" : ""), { "data-choice": String(i) });
      })),
      last && s.order.length > 1 && !cur.pid ? el("p", { class: "iz-small iz-muted" }, [t("iz_vote_wait", { n: Object.keys(votes).length, m: s.order.length })]) : null,
      last && s.order.length > 1 && s.order[0] === me() && Object.keys(votes).length ? btn(t("iz_force"), function () { send({ a: "vforce" }); }, "iz-btn iz-small", { "data-act": "vforce" }) : null
    ])]));
  }

  // ---------------- 筆記本與關係圖 ----------------
  function drawNotes(s) {
    var host = refs.notes;
    host.innerHTML = "";
    if (!ui.notes) return;
    var pid = me();
    var regs = Cast.REGULARS.filter(function (c) { return !c.run || ((s.legacy && s.legacy.runs) || 0) >= c.run; }).concat(Cast.STAFF.filter(function (c) { return s.staff.met[c.id]; }));
    var walks = s.pool.filter(function (g) { return s.notes[g.id]; });
    function row(id, sub) {
      return btn("", function () { ui.noteSel = ui.noteSel === id ? null : id; sig.notes = null; update(); }, "iz-note-row" + (ui.noteSel === id ? " iz-on" : ""), { "data-note": id });
    }
    var list = el("div", { class: "iz-note-list" }, regs.map(function (c) {
      var b = row(c.id), seen = Story.all().filter(function (x) { return x.who[0] === c.id && s.story.seen[x.id]; }).length;
      var total = Story.all().filter(function (x) { return x.who[0] === c.id; }).length;
      b.appendChild(photo(s, c.id, "iz-ph-s")); b.appendChild(el("span", null, [L(c.name), el("br"), el("small", null, [hearts(Core.affOf(s, pid, c.id)) + " 📖" + seen + "/" + total])]));
      return b;
    }).concat(walks.map(function (g) {
      var b = row(g.id);
      b.appendChild(photo(s, g.id, "iz-ph-s")); b.appendChild(el("span", null, [L(g.name), el("br"), el("small", null, [L(g.job) + "・" + t("iz_visits", { n: s.notes[g.id].visits || 0 })])]));
      return b;
    })));
    var detail = ui.noteSel ? el("div", { class: "iz-note-detail" }, [el("b", null, [nameOf(s, ui.noteSel)]), notesMini(s, ui.noteSel),
      Cast.byId(ui.noteSel) ? el("p", { class: "iz-small" }, [L(Cast.byId(ui.noteSel).bio)]) : null]) : null;
    host.appendChild(el("div", { class: "iz-overlay", id: "iz-notes", onclick: function (e) { if (e.target.id === "iz-notes") { ui.notes = false; sig.notes = null; update(); } } }, [el("div", { class: "iz-notes-box" }, [
      el("div", { class: "iz-row iz-between" }, [el("h2", null, ["📒 " + t("iz_notes")]), btn("✕", function () { ui.notes = false; sig.notes = null; update(); }, "iz-btn")]),
      el("p", { class: "iz-small iz-muted" }, [t("iz_notes_hint")]),
      el("div", { class: "iz-notes-cols" }, [list, el("div", null, [detail, relGraph(s)])])
    ])]));
  }
  // 人物關係圖：照片排成圓形，關係線用 inline SVG（只有線用 SVG，頭像仍是照片）
  function relGraph(s) {
    var ids = Cast.REGULARS.filter(function (c) { return !c.run || ((s.legacy && s.legacy.runs) || 0) >= c.run; }).concat(Cast.STAFF.filter(function (c) { return s.staff.met[c.id]; })).map(function (c) { return c.id; });
    var R = 120, C0 = 150, pos = {};
    ids.forEach(function (id, i) { var a = i / ids.length * Math.PI * 2 - Math.PI / 2; pos[id] = [C0 + Math.cos(a) * R, C0 + Math.sin(a) * R]; });
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 300 300"); svg.setAttribute("class", "iz-rel-svg");
    Object.keys(s.story.links).forEach(function (k) {
      var ab = k.split("|"), p = pos[ab[0]], q = pos[ab[1]];
      if (!p || !q) return;
      var line = document.createElementNS(NS, "line");
      line.setAttribute("x1", p[0]); line.setAttribute("y1", p[1]); line.setAttribute("x2", q[0]); line.setAttribute("y2", q[1]);
      line.setAttribute("class", "iz-rel-line iz-rel-" + s.story.links[k]); svg.appendChild(line);
      var tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", (p[0] + q[0]) / 2); tx.setAttribute("y", (p[1] + q[1]) / 2 - 3); tx.setAttribute("class", "iz-rel-text");
      tx.textContent = L(Story.RELS[s.story.links[k]]); svg.appendChild(tx);
    });
    var wrap = el("div", { class: "iz-rel", id: "iz-rel" }, [svg]);
    ids.forEach(function (id) {
      var im = photo(s, id, "iz-rel-ph");
      // 人數多時（1b 常客 12 人＋店員）照片縮小，避免蓋住關係名稱
      im.setAttribute("style", "left:" + (pos[id][0] / 3) + "%;top:" + (pos[id][1] / 3) + "%" + (ids.length > 10 ? ";width:" + Math.max(7, 13 - (ids.length - 10) * 0.5) + "%" : ""));
      im.setAttribute("title", nameOf(s, id));
      wrap.appendChild(im);
    });
    if (!Object.keys(s.story.links).length) wrap.appendChild(el("p", { class: "iz-rel-empty iz-small iz-muted" }, [t("iz_rel_empty")]));
    return wrap;
  }

  // ---------------- 合作連線 ----------------
  function roomUrl(id) { return window.location.href.split(/[?#]/)[0] + "?room=" + id; }
  function enterRoom(roomId) {
    if (!Net) return;
    if (ui.room) leaveRoom();
    var room = Net.open({
      roomId: roomId, name: lsGet(NAME_KEY), role: ui.want,
      onChange: function () { onRoomChange(); },
      onIntent: function (pid, it) { if (room.isHost() && sess && sess.s && Core.applyIntent(sess.s, pid, it)) pushState(true); },
      onState: function (w) {
        if (!sess || sess.room !== room) return;
        var s = Core.restore(w.s);
        if (s && (!room.isHost() || !sess.s)) sess.s = s;
      }
    });
    ui.room = room;
    sess = netSession(room);
    try { window.history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* 改不了網址也沒關係 */ }
    go("lobby");
  }
  function onRoomChange() {
    var room = ui.room;
    if (!room) return;
    if (!sess.s && room.wrap && room.wrap.s) sess.s = Core.restore(room.wrap.s);
    var st = room.status();
    if (st === "game" && ui.screen === "lobby" && sess.s && !room.isHost()) { go("game"); return; }
    if (st === "lobby" && ui.screen === "game") { go("lobby"); return; }
    if (ui.screen === "lobby") render();
  }
  function leaveRoom() {
    if (ui.room) { ui.room.close(); ui.room = null; }
    sess = null;
    try { if (window.location.search.indexOf("room=") >= 0) window.history.replaceState(null, "", window.location.href.split(/[?#]/)[0]); } catch (e) { /* 同上 */ }
  }
  function renderLobby() {
    var room = ui.room;
    if (!room) { go("home"); return; }
    if (room.missing) { app.appendChild(panel(t("iz_coop"), [el("p", null, [t("iz_room_missing")]), btn(t("iz_back"), function () { leaveRoom(); go("home"); })])); return; }
    if (!room.loaded) { app.appendChild(panel(t("iz_coop"), [el("p", { class: "iz-muted" }, [t("iz_connecting")])])); return; }
    var host = room.isHost(), url = roomUrl(room.id), list = room.list();
    var qr = el("canvas", { class: "iz-qr" });
    try { window.PriTestQRCode.renderToCanvas(qr, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { qr = null; }
    app.appendChild(panel(t("iz_coop"), [
      el("div", { class: "iz-lobby" }, [qr, el("div", null, [
        el("p", null, [t("iz_room_share")]),
        el("input", { class: "iz-input", readonly: true, value: url, onclick: function (e) { e.target.select(); } })
      ])]),
      el("label", { class: "iz-field" }, [t("iz_name") + " ", el("input", { class: "iz-input", maxlength: "16", value: lsGet(NAME_KEY), onchange: function (e) { var v = e.target.value.trim(); lsSet(NAME_KEY, v); room.update({ name: v }); } })])
    ]));
    var preview = Core.assignRoles(list.slice(0, 4).map(function (p) { return { pid: p.pid, want: p.role }; }));
    app.appendChild(panel(t("iz_players"), [
      el("ul", { class: "iz-plist" }, list.map(function (p) {
        return el("li", null, [(p.cid === room.meta.host ? "👑 " : "") + (p.name || t("iz_noname")) + (p.cid === room.cid ? t("iz_you_mark") : "") + "：" + (preview[p.pid] || []).map(function (r) { return D.ROLES[r].icon + L(D.ROLES[r].name); }).join("＋")]);
      })),
      el("p", { class: "iz-small" }, [t("iz_role_pick")]),
      el("div", { class: "iz-seg" }, D.ROLE_ORDER.map(function (r) {
        return btn(D.ROLES[r].icon + L(D.ROLES[r].name), function () { ui.want = r; setPref({ role: r }); room.update({ role: r }); render(); }, "iz-btn" + ((room.me.role || ui.want) === r ? " iz-on" : ""), { "data-role": r });
      })),
      el("p", { class: "iz-small iz-muted" }, [t("iz_role_note")]),
      list.length > 4 ? el("p", { class: "iz-bad iz-small" }, [t("iz_room_full")]) : null
    ]));
    var s = sess.s;
    app.appendChild(panel(null, [host ? el("div", { class: "iz-actions" }, [
      s && s.phase !== "end" ? btn(t("iz_resume_coop"), function () { room.startGame(Core.serialize(s)); go("game"); }, "iz-big") : null,
      btn(t("iz_start_coop"), function () {
        var ps = list.slice(0, 4).map(function (p) { return { pid: p.pid, name: p.name, want: p.role }; });
        var ns = Core.newGame({ seed: (Math.random() * 4294967295) >>> 0, players: ps, legacy: legacy() });
        sess.s = ns; room.startGame(Core.serialize(ns)); go("game");
      }, "iz-big iz-primary", { "data-act": "start" })
    ]) : el("p", { class: "iz-muted" }, [room.status() === "game" ? t("iz_game_running") : t("iz_wait_host")])]));
  }

  window.addEventListener("i18n:change", function () { sig = {}; if (ui.screen !== "game") render(); else update(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ui.notes) { ui.notes = false; sig.notes = null; update(); }
  });

  // 測試用（Playwright）
  window.PriTestIzakaya = { ui: ui, state: S, send: function (it) { return sess && sess.send(it); } };

  raf = requestAnimationFrame(loop);
  var rid = Net && Net.roomFromUrl(window.location.href);
  if (rid && Net.validRoomId(rid)) enterRoom(rid);
  else render();
})();
