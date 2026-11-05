// 魔法變色龍（mahou）：畫面。規則在 mahou_core.js、繪製與上色在 mahou_figure.js、場景在 mahou_scenes.js、連線在 mahou_net.js。
//
// 「場次」（sess）把本機輪流與連線包成同一個介面：
//   sess.s＝目前整局狀態、sess.me()＝現在操作畫面的人、sess.send(意圖)。
//   本機：send 直接 Core.applyIntent（由畫面指定輪到誰）；連線房主：套用後廣播；連線其他人：送意圖給房主。
// 舞台（Stage）：照片＋小人物的 canvas，可縮放（滾輪／雙指／按鈕）與拖曳平移；點一下＝尋找、拖曳＝移動或上色。
(function () {
  "use strict";

  var D = window.PriTestMahouData, Core = window.PriTestMahouCore, F = window.PriTestMahouFigure, SC = window.PriTestMahouScenes, Net = window.PriTestMahouNet;
  var app = document.getElementById("mh-app");
  if (!app) return;
  var L = D.L;
  var NAME_KEY = "pritest-mahou-name", PREF_KEY = "pritest-mahou-pref";

  function t(k, p) { return window.I18N.t(k, p || {}); }
  function lsGet(k) { try { return window.localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 存不了也能玩 */ } }
  function pref() { try { return JSON.parse(lsGet(PREF_KEY) || "null") || {}; } catch (e) { return {}; } }
  function setPref(p) { var o = pref(); Object.keys(p).forEach(function (k) { o[k] = p[k]; }); lsSet(PREF_KEY, JSON.stringify(o)); }
  function GS() { return window.PriTestMahouFakeGS || window.PriTestGameStorage; }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function btn(label, onclick, cls, attrs) {
    var a = { type: "button", class: cls || "mh-btn", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function panel(title, children, cls) { return el("section", { class: "mh-panel" + (cls ? " " + cls : "") }, [title ? el("h2", null, [title]) : null].concat(children)); }
  function seg(options, value, onpick, cls) {
    return el("div", { class: "mh-seg" + (cls ? " " + cls : "") }, options.map(function (o) {
      return btn(o[1], function () { onpick(o[0]); }, "mh-chip" + (String(o[0]) === String(value) ? " mh-on" : ""), o[2] ? { title: o[2] } : null);
    }));
  }
  function secText(v) { return v ? t("mh_sec", { n: v }) : t("mh_unlimited"); }
  function fmtTime(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function toast(msg, cls) {
    var box = document.querySelector(".mh-toasts");
    if (!box) { box = el("div", { class: "mh-toasts" }); document.body.appendChild(box); }
    var x = el("div", { class: "mh-toast" + (cls ? " " + cls : "") }, [msg]);
    box.appendChild(x);
    setTimeout(function () { x.classList.add("mh-toast-out"); }, 2600);
    setTimeout(function () { if (x.parentNode) x.parentNode.removeChild(x); }, 3200);
  }

  var ui = { screen: "home", room: null, edit: null, lastEv: 0, marks: [], localNames: null, cfg: null, help: false };
  var sess = null, stage = null, gameRefs = {}, panelSig = "", timerId = 0;
  var localPhotos = {}, localFigs = {};
  var photoCache = { key: "", img: null }, figImgCache = {}, figRenderCache = {}, imgSeq = 0;

  function defaultCfg() { return Core.normCfg(pref().cfg || {}); }

  // ---------------- 舞台 ----------------
  function Stage(opts) {
    var self = this;
    this.opts = opts;
    this.wrap = el("div", { class: "mh-stage" });
    this.cv = el("canvas", { class: "mh-canvas" });
    this.wrap.appendChild(this.cv);
    this.zoomBox = el("div", { class: "mh-zoom" }, [
      btn("＋", function () { self.zoomAt(1.4); }, "mh-zbtn", { title: t("mh_zoom_in") }),
      btn("－", function () { self.zoomAt(1 / 1.4); }, "mh-zbtn", { title: t("mh_zoom_out") }),
      btn("⤢", function () { self.z = 1; self.ox = 0; self.oy = 0; self.dirty = true; }, "mh-zbtn", { title: t("mh_zoom_reset") })
    ]);
    this.wrap.appendChild(this.zoomBox);
    this.cover = null;
    this.z = 1; this.ox = 0; this.oy = 0; this.w = 300; this.h = 200; this.dpr = 1;
    this.ptrs = {}; this.drag = null; this.dirty = true; this.dead = false;
    var cv = this.cv;
    cv.addEventListener("pointerdown", function (e) { self.down(e); });
    cv.addEventListener("pointermove", function (e) { self.move(e); });
    cv.addEventListener("pointerup", function (e) { self.up(e); });
    cv.addEventListener("pointercancel", function (e) { self.up(e, true); });
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      self.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    this.onResize = function () { self.dirty = true; };
    window.addEventListener("resize", this.onResize);
    function loop() {
      if (self.dead) return;
      if (self.dirty || (self.opts.animating && self.opts.animating())) { self.dirty = false; self.render(); }
      window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
  }
  Stage.prototype.destroy = function () { this.dead = true; window.removeEventListener("resize", this.onResize); };
  Stage.prototype.layout = function () {
    var ar = this.opts.ar() || 1.5;
    var maxW = this.wrap.clientWidth || 300, maxH = Math.max(220, window.innerHeight * 0.72);
    var w = maxW, h = w / ar;
    if (h > maxH) { h = maxH; w = h * ar; }
    w = Math.floor(w); h = Math.floor(h);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.w !== w || this.h !== h || this.dpr !== dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.cv.style.width = w + "px"; this.cv.style.height = h + "px";
    }
    this.clampView();
  };
  Stage.prototype.unit = function () { return this.h * this.z; };
  Stage.prototype.clampView = function () {
    var u = this.unit(), ar = this.opts.ar() || 1.5;
    this.ox = Math.min(0, Math.max(this.w - ar * u, this.ox));
    this.oy = Math.min(0, Math.max(this.h - u, this.oy));
  };
  Stage.prototype.zoomAt = function (f, sx, sy) {
    if (sx === undefined) { sx = this.w / 2; sy = this.h / 2; }
    var nz = Math.max(1, Math.min(8, this.z * f));
    var px = (sx - this.ox) / this.unit(), py = (sy - this.oy) / this.unit();
    this.z = nz;
    this.ox = sx - px * this.unit(); this.oy = sy - py * this.unit();
    this.clampView();
    this.dirty = true;
  };
  Stage.prototype.toPhoto = function (e) {
    var r = this.cv.getBoundingClientRect(), u = this.unit();
    return [(e.clientX - r.left - this.ox) / u, (e.clientY - r.top - this.oy) / u];
  };
  Stage.prototype.toScreen = function (x, y) { var u = this.unit(); return [x * u + this.ox, y * u + this.oy]; };
  Stage.prototype.down = function (e) {
    this.cv.setPointerCapture && this.cv.setPointerCapture(e.pointerId);
    this.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(this.ptrs);
    if (ids.length === 2) {
      if (this.drag && this.drag.custom && this.opts.onCancel) this.opts.onCancel();
      var a = this.ptrs[ids[0]], b = this.ptrs[ids[1]];
      this.drag = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (ids.length > 2) return;
    var P = this.toPhoto(e);
    var custom = this.opts.onDown ? this.opts.onDown(P, e) : false;
    this.drag = { custom: !!custom, x: e.clientX, y: e.clientY, moved: false, ox: this.ox, oy: this.oy };
    this.dirty = true;
  };
  Stage.prototype.move = function (e) {
    if (!this.ptrs[e.pointerId]) { if (this.opts.onHover) this.opts.onHover(this.toPhoto(e)); return; }
    this.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var d = this.drag;
    if (!d) return;
    if (d.pinch) {
      var ids = Object.keys(this.ptrs);
      if (ids.length < 2) return;
      var a = this.ptrs[ids[0]], b = this.ptrs[ids[1]], nd = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var r = this.cv.getBoundingClientRect();
      this.ox += mx - d.mx; this.oy += my - d.my;
      if (d.d > 10) this.zoomAt(nd / d.d, mx - r.left, my - r.top);
      d.d = nd; d.mx = mx; d.my = my;
      this.clampView(); this.dirty = true;
      return;
    }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
    if (d.custom) { if (this.opts.onMove) this.opts.onMove(this.toPhoto(e), e); this.dirty = true; return; }
    if (d.moved) { this.ox = d.ox + (e.clientX - d.x); this.oy = d.oy + (e.clientY - d.y); this.clampView(); this.dirty = true; }
  };
  Stage.prototype.up = function (e, cancel) {
    delete this.ptrs[e.pointerId];
    var d = this.drag;
    if (!d) return;
    if (d.pinch) { if (!Object.keys(this.ptrs).length) this.drag = null; return; }
    this.drag = null;
    if (d.custom) { if (this.opts.onUp) this.opts.onUp(this.toPhoto(e), e); }
    else if (!d.moved && !cancel && this.opts.onTap) this.opts.onTap(this.toPhoto(e), e);
    this.dirty = true;
  };
  Stage.prototype.render = function () {
    this.layout();
    var g = this.cv.getContext("2d"), u = this.unit(), dpr = this.dpr, ar = this.opts.ar() || 1.5;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#222"; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(u * dpr, 0, 0, u * dpr, this.ox * dpr, this.oy * dpr);
    var photo = this.opts.photo();
    if (photo) { g.imageSmoothingQuality = "high"; g.drawImage(photo, 0, 0, ar, 1); }
    else { g.fillStyle = "#444"; g.fillRect(0, 0, ar, 1); }
    if (this.opts.draw) this.opts.draw(g, this);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.opts.overlay) this.opts.overlay(g, this);
  };
  Stage.prototype.sample = function (P) {
    var s = this.toScreen(P[0], P[1]), g = this.cv.getContext("2d");
    try { var d = g.getImageData(Math.round(s[0] * this.dpr), Math.round(s[1] * this.dpr), 1, 1).data; return F.rgbHex(d[0], d[1], d[2]); } catch (e) { return null; }
  };

  // ---------------- 素材：照片與小人物 ----------------
  function photoOf(s) {
    if (!s || !s.photo) return null;
    var p = s.photo;
    if (p.k === "scene") return SC.render(p.id, p.seed);
    if (sess && sess.local) return localPhotos[p.rev] || null;
    var room = ui.room;
    if (!room || !room.photo || room.photo.rev !== p.rev) return null;
    var key = p.rev + ":" + room.photo.img.length;
    if (photoCache.key !== key) {
      photoCache.key = key;
      var img = new Image();
      photoCache.img = null;
      img.onload = function () { if (photoCache.key === key) { photoCache.img = img; if (stage) stage.dirty = true; refreshPanelSoon(); } };
      img.src = room.photo.img;
    }
    return photoCache.img;
  }
  function paintOf(s, pid) {
    if (sess.local) return localFigs[pid] || null;
    var f = ui.room && ui.room.figs[pid];
    if (!f || f.r !== s.round) return null;
    var c = figImgCache[pid];
    if (!c || c.src !== f.img) {
      c = figImgCache[pid] = { src: f.img, img: null };
      var img = new Image();
      img.onload = function () { if (figImgCache[pid] === c) { img._k = ++imgSeq; c.img = img; if (stage) stage.dirty = true; } };
      img.src = f.img;
    }
    return c.img;
  }
  function figCanvas(s, pid, outline) {
    var h = s.hide[pid], paint = paintOf(s, pid);
    var key = s.round + ":" + (paint ? (paint._k ? "i" + paint._k : "c" + (paint._rev || 0)) : "none") + ":" + h.fig.p + ":" + h.fig.e + ":" + (outline || "");
    var c = figRenderCache[pid];
    if (c && c.key === key) return c.cv;
    var cv = F.render(paint, h.fig.p, h.fig.e, { outline: outline, eyeSeed: F.seedOf(pid + ":" + s.round) });
    figRenderCache[pid] = { key: key, cv: cv };
    return cv;
  }

  // ---------------- 場次 ----------------
  function now() { return sess && !sess.local && GS() && GS().serverNow ? GS().serverNow() : Date.now(); }
  function localSession(players, cfg) {
    var S = {
      local: true, s: Core.newGame({ cfg: cfg, players: players, local: true, now: Date.now() }),
      me: function () { var s = S.s; return Core.currentTurn(s) || (s.phase === "photo" ? s.ph : ""); },
      admin: function () { return true; },
      send: function (it) {
        it.as = it.as || S.me();
        var ok = Core.applyIntent(S.s, it.as, it, Date.now(), { admin: true });
        if (ok) onState();
        return ok;
      }
    };
    return S;
  }
  function netSession(room) {
    var S = {
      local: false, s: null, room: room,
      me: function () { return room.pid; },
      admin: function () { return room.isHost(); },
      send: function (it) {
        if (room.isHost()) {
          if (S.s && Core.applyIntent(S.s, room.pid, it, now(), { admin: true })) { pushState(); onState(); }
        } else room.sendIntent(it);
      }
    };
    return S;
  }
  function pushState() { if (ui.room && ui.room.isHost() && sess && sess.s) ui.room.writeState(Core.serialize(sess.s)); }
  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      if (!sess || !sess.s) return;
      if (sess.admin() && Core.tick(sess.s, now())) { if (!sess.local) pushState(); onState(); }
      updateDyn();
    }, 300);
  }
  function stopTimer() { if (timerId) clearInterval(timerId); timerId = 0; }

  // ---------------- 畫面切換 ----------------
  function go(screen) {
    if (stage && screen !== "game" && screen !== "practice") { stage.destroy(); stage = null; }
    ui.screen = screen;
    render();
  }
  function render() {
    if (stage && ui.screen !== "game" && ui.screen !== "practice") { stage.destroy(); stage = null; }
    app.innerHTML = "";
    var top = el("div", { class: "mh-top" }, [
      el("h1", { class: "mh-title" }, ["🦎 " + t("mh_title")]),
      ui.room ? el("span", { class: "mh-roomtag" }, [t("mh_room_tag", { id: ui.room.id.slice(1, 7) })]) : null,
      ui.screen !== "home" ? btn(t("mh_back"), function () { leaveAll(); go("home"); }, "mh-btn mh-small") : null
    ]);
    app.appendChild(top);
    if (ui.screen === "home") renderHome();
    else if (ui.screen === "local") renderLocalSetup();
    else if (ui.screen === "lobby") renderLobby();
    else if (ui.screen === "game") renderGame();
    else if (ui.screen === "practice") renderPractice();
  }
  function leaveAll() {
    stopTimer();
    if (ui.room) { ui.room.close(); ui.room = null; }
    sess = null; ui.edit = null;
    try { if (window.location.search.indexOf("room=") >= 0) window.history.replaceState(null, "", window.location.href.split(/[?#]/)[0]); } catch (e) { /* 改不了網址也沒關係 */ }
  }

  // ---------------- 首頁 ----------------
  function helpPanel() {
    return panel(t("mh_how_title"), [el("ol", { class: "mh-rules" }, [1, 2, 3, 4, 5, 6, 7].map(function (i) { return el("li", null, [t("mh_help_" + i)]); }))]);
  }
  function renderHome() {
    app.appendChild(panel("", [el("p", { class: "mh-intro" }, [t("mh_intro")])]));
    app.appendChild(el("div", { class: "mh-menu" }, [
      btn(el("span", null, [el("b", null, ["🌐 " + t("mh_menu_online")]), el("small", null, [t("mh_menu_online_d")])]), function () { enterRoom(null); }, "mh-card mh-primary"),
      btn(el("span", null, [el("b", null, ["📱 " + t("mh_menu_local")]), el("small", null, [t("mh_menu_local_d")])]), function () { go("local"); }, "mh-card"),
      btn(el("span", null, [el("b", null, ["🎨 " + t("mh_menu_practice")]), el("small", null, [t("mh_menu_practice_d")])]), function () { ui.practice = null; go("practice"); }, "mh-card")
    ]));
    app.appendChild(panel(t("mh_modes_title"), [el("ul", { class: "mh-modes" }, D.MODES.map(function (m) { return el("li", null, [el("b", null, [m.icon + " " + L(m.name)]), "：" + L(m.desc)]); }))]));
    app.appendChild(helpPanel());
  }

  // ---------------- 房間設定（本機與連線共用） ----------------
  function cfgFields(cfg, onchange, editable, nPlayers) {
    function row(label, node) { return el("div", { class: "mh-field" }, [el("span", { class: "mh-flabel" }, [label]), node]); }
    function set(k, v) { cfg[k] = v; onchange(); }
    if (!editable) {
      var m = D.MODES.filter(function (x) { return x.id === cfg.mode; })[0] || D.MODES[0];
      return el("div", { class: "mh-cfgview" }, [
        el("p", null, [el("b", null, [m.icon + " " + L(m.name)]), "　" + L(m.desc)]),
        el("p", { class: "mh-small" }, [t("mh_cfg_view", { d: secText(cfg.draw), s: secText(cfg.seek), m: cfg.miss ? t("mh_times", { n: cfg.miss }) : t("mh_unlimited"), r: cfg.rounds || t("mh_rounds_auto") })
          + (cfg.mode === "normal" ? "・" + t("mh_seekers_n", { n: cfg.seekers }) : "") + (cfg.clone ? "" : "・" + t("mh_no_clone"))])
      ]);
    }
    var nodes = [
      row(t("mh_cfg_mode"), seg(D.MODES.map(function (m) { return [m.id, m.icon + " " + L(m.name), L(m.desc)]; }), cfg.mode, function (v) { set("mode", v); })),
      el("p", { class: "mh-small mh-muted mh-full" }, [L((D.MODES.filter(function (x) { return x.id === cfg.mode; })[0] || D.MODES[0]).desc)])
    ];
    if (cfg.mode === "normal") {
      var maxK = Math.max(1, Math.min(D.MAX_PLAYERS - 1, (nPlayers || 3) - 1));
      var ks = []; for (var k = 1; k <= Math.max(maxK, cfg.seekers); k++) ks.push([k, String(k)]);
      nodes.push(row(t("mh_cfg_seekers"), seg(ks, cfg.seekers, function (v) { set("seekers", v); })));
    }
    nodes.push(row(t("mh_cfg_draw"), seg(D.DRAW_TIMES.map(function (v) { return [v, secText(v)]; }), cfg.draw, function (v) { set("draw", v); })));
    nodes.push(row(t("mh_cfg_seek"), seg(D.SEEK_TIMES.map(function (v) { return [v, secText(v)]; }), cfg.seek, function (v) { set("seek", v); })));
    nodes.push(row(t("mh_cfg_miss"), seg(D.MISS_LIMITS.map(function (v) { return [v, v ? t("mh_times", { n: v }) : t("mh_unlimited")]; }), cfg.miss, function (v) { set("miss", v); })));
    nodes.push(row(t("mh_cfg_rounds"), seg(D.ROUNDS.map(function (v) { return [v, v ? String(v) : t("mh_rounds_auto")]; }), cfg.rounds, function (v) { set("rounds", v); })));
    nodes.push(row(t("mh_cfg_clone"), seg([[1, t("mh_on")], [0, t("mh_off")]], cfg.clone ? 1 : 0, function (v) { set("clone", !!v); })));
    return el("div", { class: "mh-cfg" }, nodes);
  }

  // ---------------- 本機輪流 ----------------
  function renderLocalSetup() {
    if (!ui.localNames) ui.localNames = (pref().names || [t("mh_player_n", { n: 1 }), t("mh_player_n", { n: 2 }), t("mh_player_n", { n: 3 })]).slice(0, D.MAX_PLAYERS);
    if (!ui.cfg) ui.cfg = defaultCfg();
    var names = ui.localNames;
    app.appendChild(panel(t("mh_menu_local"), [
      el("p", { class: "mh-small mh-muted" }, [t("mh_local_note")]),
      el("ol", { class: "mh-names" }, names.map(function (n, i) {
        return el("li", null, [
          el("input", { class: "mh-input", maxlength: "16", value: n, oninput: function (e) { names[i] = e.target.value; } }),
          names.length > 2 ? btn("✕", function () { names.splice(i, 1); render(); }, "mh-btn mh-small") : null
        ]);
      })),
      names.length < D.MAX_PLAYERS ? btn("＋ " + t("mh_add_player"), function () { names.push(t("mh_player_n", { n: names.length + 1 })); render(); }, "mh-btn") : null
    ]));
    app.appendChild(panel(t("mh_room_cfg"), [
      cfgFields(ui.cfg, function () { setPref({ cfg: ui.cfg }); render(); }, true, names.length),
      el("div", { class: "mh-actions mh-next" }, [btn(t("mh_start"), function () {
        var ps = names.map(function (n, i) { return { pid: "p" + ("000000000000000" + (i + 1)).slice(-16), name: (n || "").trim() || t("mh_player_n", { n: i + 1 }) }; });
        setPref({ names: names, cfg: ui.cfg });
        localPhotos = {}; localFigs = {};
        sess = localSession(ps, ui.cfg);
        ui.lastEv = sess.s.ev;
        enterGame();
      }, "mh-btn mh-big mh-primary")])
    ]));
  }

  // ---------------- 連線房間 ----------------
  function roomUrl(id) { return window.location.href.split(/[?#]/)[0] + "?room=" + id; }
  function enterRoom(roomId) {
    if (!Net || !GS()) { toast(t("mh_no_net"), "mh-bad"); return; }
    leaveAll();
    var room = Net.open({
      roomId: roomId, name: lsGet(NAME_KEY), cfg: defaultCfg(),
      onChange: function () { onRoomChange(); },
      onIntent: function (pid, it) {
        if (!room.isHost() || !sess || !sess.s) return;
        if (Core.applyIntent(sess.s, pid, it, now(), { admin: false })) { pushState(); onState(); }
      },
      onState: function (w) {
        if (!sess || sess.room !== room) return;
        var s = Core.restore(w.s);
        if (!s) return;
        if (!room.isHost() || !sess.s) { sess.s = s; onState(); }
      },
      onHost: function () { if (sess && sess.s) startTimer(); },
      onPhoto: function () { if (stage) stage.dirty = true; refreshPanelSoon(); },
      onFigs: function () { if (stage) stage.dirty = true; }
    });
    ui.room = room;
    sess = netSession(room);
    try { window.history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* 同上 */ }
    go("lobby");
  }
  var joinSent = 0;
  function onRoomChange() {
    var room = ui.room;
    if (!room || !sess) return;
    if (!sess.s && room.wrap && room.wrap.s) { sess.s = Core.restore(room.wrap.s); if (sess.s) ui.lastEv = sess.s.ev; }
    var st = room.status();
    if (st === "game" && ui.screen === "lobby" && sess.s) { ui.lastEv = sess.s.ev; enterGame(); return; }
    if (st === "lobby" && ui.screen === "game") { go("lobby"); return; }
    if (ui.screen === "game" && sess.s && sess.s.names[sess.me()] === undefined && Date.now() - joinSent > 3000) {
      joinSent = Date.now(); sess.send({ a: "join", name: lsGet(NAME_KEY) || room.me.name || "" });
    }
    if (ui.screen === "lobby") render();
    else if (ui.screen === "game") onState();
  }
  function renderLobby() {
    var room = ui.room;
    if (!room) { go("home"); return; }
    if (room.missing) { app.appendChild(panel(t("mh_menu_online"), [el("p", null, [t("mh_room_missing")]), btn(t("mh_back"), function () { leaveAll(); go("home"); })])); return; }
    if (!room.loaded) { app.appendChild(panel(t("mh_menu_online"), [el("p", { class: "mh-muted" }, [t("mh_connecting")])])); return; }
    var host = room.isHost(), url = roomUrl(room.id);
    var qr = el("canvas", { class: "mh-qr" });
    try { window.PriTestQRCode.renderToCanvas(qr, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { qr = null; }
    app.appendChild(panel(t("mh_menu_online"), [
      el("div", { class: "mh-lobby" }, [
        qr,
        el("div", { class: "mh-grow" }, [
          el("p", null, [t("mh_room_share")]),
          el("input", { class: "mh-input mh-url", readonly: true, value: url, onclick: function (e) { e.target.select(); } }),
          el("div", { class: "mh-actions" }, [btn(t("mh_copy"), function () { try { navigator.clipboard.writeText(url); toast(t("mh_copied")); } catch (e) { /* 不支援就手動複製 */ } })])
        ])
      ]),
      el("label", { class: "mh-field" }, [el("span", { class: "mh-flabel" }, [t("mh_name")]), el("input", { class: "mh-input", maxlength: "16", value: lsGet(NAME_KEY), placeholder: t("mh_name_ph"), onchange: function (e) {
        var v = e.target.value.trim(); lsSet(NAME_KEY, v); room.update({ name: v });
        if (sess.s && sess.s.names[sess.me()] !== undefined) sess.send({ a: "name", name: v });
      } })])
    ]));
    var list = room.list();
    app.appendChild(panel(t("mh_players") + "（" + list.length + "）", [
      el("ul", { class: "mh-plist" }, list.map(function (p) { return el("li", null, [(p.cid === room.meta.host ? "👑 " : "🦎 ") + (p.name || t("mh_noname")) + (p.cid === room.cid ? t("mh_you") : "")]); })),
      list.length > D.MAX_PLAYERS ? el("p", { class: "mh-warn mh-small" }, [t("mh_room_full", { n: D.MAX_PLAYERS })]) : null
    ]));
    var cfg = room.cfg || defaultCfg();
    var s = sess.s;
    app.appendChild(panel(t("mh_room_cfg"), [
      cfgFields(cfg, function () { room.setCfg(cfg); setPref({ cfg: cfg }); render(); }, host, list.length),
      host ? el("div", { class: "mh-actions mh-next" }, [
        list.length < 2 ? el("span", { class: "mh-muted mh-small" }, [t("mh_need_two")]) : null,
        btn(t("mh_start_online"), function () {
          var ps = list.slice(0, D.MAX_PLAYERS).map(function (p) { return { pid: p.pid, name: p.name || t("mh_noname") }; });
          var seen = {}; ps = ps.filter(function (p) { if (seen[p.pid]) return false; seen[p.pid] = 1; return true; });
          var ns = Core.newGame({ cfg: cfg, players: ps, now: now() });
          sess.s = ns; ui.lastEv = ns.ev;
          room.clearBig();
          room.startGame(Core.serialize(ns));
          enterGame();
        }, "mh-btn mh-big mh-primary", list.length < 2 ? { disabled: true } : null)
      ]) : el("div", null, [
        el("p", { class: "mh-muted" }, [room.status() === "game" ? t("mh_game_running") : t("mh_wait_host")]),
        room.status() === "game" && s ? btn(t("mh_join_game"), function () { enterGame(); }, "mh-btn mh-big mh-primary") : null
      ])
    ]));
  }

  // ---------------- 遊戲畫面 ----------------
  function enterGame() {
    ui.edit = null; ui.marks = []; panelSig = "";
    figRenderCache = {};
    ui.screen = "game";
    render();
    startTimer();
  }
  function onState() {
    if (ui.screen !== "game" || !sess || !sess.s) return;
    processEvents();
    syncEditor();
    if (stage) stage.dirty = true;
    refreshPanel();
  }
  var refreshQueued = false;
  function refreshPanelSoon() { if (refreshQueued) return; refreshQueued = true; setTimeout(function () { refreshQueued = false; refreshPanel(); }, 30); }

  function nameOf(pid) { var s = sess.s; return (s && s.names[pid]) || t("mh_noname"); }
  function myRole() { return Core.roleOf(sess.s, sess.me()); }
  function amSeekerActive() {
    var s = sess.s, me = sess.me(), k = s.seek[me];
    if (s.phase !== "seek" || !k || k.out) return false;
    if (sess.local && (s.q[0] !== me || !s.qr)) return false;
    return true;
  }
  function amHiding() {
    var s = sess.s, me = sess.me();
    if (s.phase !== "hide" || !s.hide[me]) return false;
    if (sess.local) return s.q[0] === me && s.qr;
    return true;
  }
  // 誰的小人物要畫、怎麼畫
  function revealAll() {
    var s = sess.s, me = sess.me();
    if (s.phase === "result" || s.phase === "end") return true;
    if (s.phase !== "seek") return false;
    if (sess.local) return false;
    if (amSeekerActive()) return false;
    if (s.cfg.mode === "infect" && s.hide[me] && !Core.isFound(s, me)) return false;
    return true;
  }
  function figsToDraw() {
    var s = sess.s, me = sess.me(), out = [];
    if (s.phase === "hide") return out;   // 躲藏中只看得到自己（另外畫）
    if (s.phase !== "seek" && s.phase !== "result" && s.phase !== "end") return out;
    var reveal = revealAll();
    Core.zOrder(s).forEach(function (pid) {
      var h = s.hide[pid];
      var found = s.cfg.mode === "sync" ? (s.phase === "seek" ? !!h.found[me] : Object.keys(h.found).length > 0) : Core.isFound(s, pid);
      var mine = pid === me && !sess.local;
      out.push({ pid: pid, fig: h.fig, found: found, mine: mine, label: reveal || found || mine });
    });
    return out;
  }

  function renderGame() {
    var s = sess && sess.s;
    if (!s) { app.appendChild(panel("", [el("p", { class: "mh-muted" }, [t("mh_connecting")])])); return; }
    gameRefs = {};
    var bar = el("div", { class: "mh-bar" }, [
      gameRefs.round = el("span", { class: "mh-pill" }),
      gameRefs.phase = el("span", { class: "mh-pill mh-phase" }),
      gameRefs.timer = el("span", { class: "mh-pill mh-timer" }),
      el("span", { class: "mh-grow" }),
      gameRefs.score = el("span", { class: "mh-small mh-scoreline" })
    ]);
    app.appendChild(bar);
    var main = el("div", { class: "mh-main" });
    var left = el("div", { class: "mh-left" });
    if (stage) stage.destroy();
    stage = new Stage({
      ar: function () { return sess && sess.s && sess.s.photo ? sess.s.photo.ar : SC.AR; },
      photo: function () { return sess && sess.s ? photoOf(sess.s) : null; },
      draw: drawWorld, overlay: drawOverlay,
      animating: function () { return ui.marks.length > 0 || !!(ui.edit && ui.edit.painter.stroke); },
      onDown: stageDown, onMove: stageMove, onUp: stageUp, onTap: stageTap, onCancel: stageCancel
    });
    left.appendChild(stage.wrap);
    gameRefs.cover = el("div", { class: "mh-cover", hidden: true });
    stage.wrap.appendChild(gameRefs.cover);
    gameRefs.under = el("div", { class: "mh-under" });
    left.appendChild(gameRefs.under);
    gameRefs.side = el("div", { class: "mh-side" });
    main.appendChild(left); main.appendChild(gameRefs.side);
    app.appendChild(main);
    panelSig = "";
    syncEditor();
    refreshPanel();
  }

  // 主要面板：只有在「階段／身分／輪到誰」改變時才重建，其他數字由 updateDyn() 更新
  function refreshPanel() {
    if (ui.screen !== "game" || !sess || !sess.s || !gameRefs.side) return;
    var s = sess.s, me = sess.me();
    var sig = [s.round, s.phase, me, myRole(), s.q.join(","), s.qr, s.hide[me] ? s.hide[me].done : "", s.seek[me] ? s.seek[me].out : "", !!photoOf(s), sess.admin(), ui.edit ? ui.edit.tab : "", ui.edit ? ui.edit.tool : "", ui.lang || ""].join("|");
    if (sig !== panelSig) {
      panelSig = sig;
      gameRefs.side.innerHTML = "";
      gameRefs.under.innerHTML = "";
      buildSide(gameRefs.side, gameRefs.under);
    }
    updateDyn();
  }
  function updateDyn() {
    if (ui.screen !== "game" || !sess || !sess.s || !gameRefs.round) return;
    var s = sess.s, me = sess.me();
    var m = D.MODES.filter(function (x) { return x.id === s.cfg.mode; })[0];
    gameRefs.round.textContent = m.icon + " " + t("mh_round", { r: s.round, n: s.total });
    gameRefs.phase.textContent = t("mh_phase_" + s.phase);
    var left = s.dl ? s.dl - now() : 0;
    gameRefs.timer.textContent = s.dl ? "⏱ " + fmtTime(left) : (s.phase === "hide" || s.phase === "seek") ? "⏱ ∞" : "";
    gameRefs.timer.classList.toggle("mh-hurry", !!s.dl && left < 10000);
    gameRefs.timer.hidden = !gameRefs.timer.textContent;
    gameRefs.score.textContent = Core.ranking(s).slice(0, 6).map(function (p) { return nameOf(p) + " " + (s.scores[p] || 0); }).join("・");
    // 封面：本機輪流交接時遮住照片
    var cover = gameRefs.cover;
    var showCover = sess.local && ((s.phase === "hide" || s.phase === "seek") && s.q.length && !s.qr);
    cover.hidden = !showCover;
    if (showCover) { cover.textContent = ""; cover.appendChild(el("div", null, [el("div", { class: "mh-cover-icon" }, ["🙈"]), el("p", null, [t(s.phase === "hide" ? "mh_handoff_hide" : "mh_handoff_seek", { name: nameOf(s.q[0]) })])])); }
    if (gameRefs.dyn) gameRefs.dyn();
  }

  function buildSide(side, under) {
    var s = sess.s, me = sess.me(), admin = sess.admin();
    gameRefs.dyn = null;
    if (s.phase === "photo") buildPhotoPanel(side, s, me, admin);
    else if (s.phase === "hide") buildHidePanel(side, under, s, me, admin);
    else if (s.phase === "seek") buildSeekPanel(side, s, me, admin);
    else if (s.phase === "result") buildResultPanel(side, s, admin);
    else if (s.phase === "end") buildEndPanel(side, s, admin);
  }
  function forceBtn(label) {
    return btn(label, function () { sess.send({ a: "next", active: activeList() }); }, "mh-btn mh-small mh-force");
  }
  function activeList() {
    if (sess.local || !ui.room) return null;
    return ui.room.list().map(function (p) { return p.pid; });
  }
  function rolesLine(s) {
    var seekers = Core.seekerList(s).map(nameOf).join("、");
    return el("p", { class: "mh-small" }, [t("mh_roles_line", { ph: nameOf(s.ph), k: seekers || "-" })]);
  }

  // ---- 出照片 ----
  function buildPhotoPanel(side, s, me, admin) {
    var isPh = me === s.ph;
    if (!isPh) {
      side.appendChild(panel(t("mh_phase_photo"), [
        rolesLine(s),
        el("p", { class: "mh-wait" }, [t("mh_wait_photo", { name: nameOf(s.ph) })]),
        admin ? forceBtn(t("mh_force_scene")) : null
      ]));
      return;
    }
    var status = el("p", { class: "mh-small mh-muted" });
    function onFile(e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      status.textContent = t("mh_photo_loading");
      loadPhotoFile(f, function (res) { if (!res) { status.textContent = t("mh_photo_bad"); return; } usePhoto(res); });
    }
    var file = el("input", { type: "file", accept: "image/*", class: "mh-file", onchange: onFile });
    var cam = el("input", { type: "file", accept: "image/*", capture: "environment", class: "mh-file", onchange: onFile });
    var scenes = el("div", { class: "mh-scenes" }, D.SCENES.map(function (sc) {
      var b = btn(el("span", null, [SC.thumb(sc.id, 132), el("small", null, [L(sc.name)])]), function () {
        sess.send({ a: "photo", k: "scene", id: sc.id, seed: Core.newSeed(), ar: SC.AR });
      }, "mh-scene");
      return b;
    }));
    side.appendChild(panel(t("mh_your_photo"), [
      rolesLine(s),
      el("p", null, [t(s.cfg.mode === "sync" ? "mh_photo_hint_sync" : "mh_photo_hint")]),
      el("div", { class: "mh-actions" }, [
        el("label", { class: "mh-btn mh-primary mh-filebtn" }, ["🖼 " + t("mh_upload"), file]),
        el("label", { class: "mh-btn mh-filebtn" }, ["📷 " + t("mh_camera"), cam])
      ]),
      status,
      el("h3", null, [t("mh_or_scene")]),
      scenes,
      btn("🎲 " + t("mh_random_scene"), function () { var sc = D.SCENES[Math.floor(Math.random() * D.SCENES.length)]; sess.send({ a: "photo", k: "scene", id: sc.id, seed: Core.newSeed(), ar: SC.AR }); }, "mh-btn")
    ]));
  }
  function usePhoto(res) {
    var rev = (Math.floor(Math.random() * 1e9) + 1);
    if (sess.local) { localPhotos[rev] = res.canvas; sess.send({ a: "photo", k: "img", rev: rev, ar: res.ar }); return; }
    var room = ui.room;
    // 先放進快取，自己不用等 Firebase 回呼
    photoCache.key = rev + ":" + res.url.length; photoCache.img = res.canvas;
    room.setPhoto(rev, res.url);
    sess.send({ a: "photo", k: "img", rev: rev, ar: res.ar });
  }
  // 讀照片：長邊縮到 1280 以內、長寬比限制在 0.5〜2.4（超過就裁中間），壓成 JPEG
  function loadPhotoFile(f, cb) {
    var url = URL.createObjectURL(f), img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { cb(null); return; }
      var sx = 0, sy = 0, sw = w, sh = h, ar = w / h;
      if (ar > 2.4) { sw = h * 2.4; sx = (w - sw) / 2; ar = 2.4; }
      if (ar < 0.5) { sh = w / 0.5; sy = (h - sh) / 2; ar = 0.5; }
      var maxSide = 1280, q = 0.72, out, c;
      for (var tries = 0; tries < 4; tries++) {
        var k = Math.min(1, maxSide / Math.max(sw, sh));
        c = F.mk(Math.round(sw * k), Math.round(sh * k));
        c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", q);
        if (out.length < 700000) break;
        maxSide *= 0.8; q -= 0.08;
      }
      cb({ canvas: c, url: out, ar: c.width / c.height });
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  // ---- 躲藏 ----
  function syncEditor() {
    if (!sess || !sess.s) return;
    var s = sess.s, me = sess.me();
    if (!amHiding()) {
      if (ui.edit && (s.phase !== "hide" || ui.edit.pid !== me)) ui.edit = null;
      return;
    }
    if (ui.edit && ui.edit.pid === me && ui.edit.round === s.round) return;
    var idx = s.order.indexOf(me);
    var fig = s.hide[me].fig ? Core.clone(s.hide[me].fig) : Core.defaultFig(s.photo.ar, idx * 3 + s.round);
    ui.edit = newEditor(me, s.round, fig, s.photo.ar, function () { return photoOf(sess.s); }, s.cfg.clone);
    queueFigSend(true);
  }
  function newEditor(pid, round, fig, ar, getPhoto, allowClone) {
    var E = {
      pid: pid, round: round, fig: fig, ar: ar, tab: "pose", tool: "brush", outline: true, camo: -1, camoAt: 0,
      getPhoto: getPhoto, allowClone: allowClone, recent: [], pal: null, underKey: "", under: F.mk(F.PX),
      seed: F.seedOf(pid + ":" + round)
    };
    E.jitter = F.cloneJitter(E.seed);
    E.srcOff = null; E.armSrc = false; E.heat = false;
    E.painter = new F.Painter({
      getUnderlay: function () { return underFor(E); },
      getStamp: function () { return stampFor(E); },
      getEnv: function () { return envFor(E); }
    });
    return E;
  }
  // 取樣拓印的來源：把小人物「平移到取樣點」時身體底下的照片（取樣點跟著小人物一起移動）
  function stampFor(E) {
    if (!E.srcOff || !E.getPhoto()) return null;
    var key = JSON.stringify(E.fig) + ":" + E.srcOff.join(",");
    if (E.stampKey !== key) {
      E.stampKey = key;
      var f = Core.clone(E.fig); f.x += E.srcOff[0]; f.y += E.srcOff[1];
      E.stampCv = F.underlay(E.getPhoto(), f, E.stampCv || F.mk(F.PX), E.jitter);
    }
    return E.stampCv;
  }
  function envFor(E) {
    var u = underFor(E);
    if (E.envKey !== E.underKey) { E.envKey = E.underKey; E.envCv = F.envLayer(u, E.envCv || F.mk(F.PX)); }
    return E.envCv;
  }
  function underFor(E) {
    var key = JSON.stringify(E.fig) + ":" + (E.getPhoto() ? 1 : 0);
    if (E.underKey !== key) { E.underKey = key; F.underlay(E.getPhoto(), E.fig, E.under, E.jitter); }
    return E.under;
  }
  var figSendT = 0;
  function queueFigSend(now0) {
    if (figSendT) clearTimeout(figSendT);
    figSendT = setTimeout(function () { figSendT = 0; sendFig(false); }, now0 ? 50 : 900);
  }
  function sendFig(done) {
    var E = ui.edit;
    if (!E || !sess || !sess.s || sess.s.phase !== "hide" || E.pid !== sess.me()) return;
    updateCamo(true);
    if (sess.local) {
      var c = F.mk(F.PX); c.getContext("2d").drawImage(E.painter.paint, 0, 0); c._rev = E.painter.rev;
      localFigs[E.pid] = c;
    } else if (ui.room) ui.room.setFig(sess.s.round, E.painter.exportUrl());
    var it = { a: "fig", fig: E.fig, camo: E.camo >= 0 ? E.camo : 0 };
    if (done !== null) it.done = !!done;
    sess.send(it);
  }
  function updateCamo(force) {
    var E = ui.edit;
    if (!E) return;
    var photo = E.getPhoto();
    if (!photo) return;
    var key = E.painter.rev + ":" + JSON.stringify(E.fig);
    if (!force && (E.camoKey === key || Date.now() - E.camoAt < 350)) return;
    E.camoKey = key; E.camoAt = Date.now();
    E.camo = F.camoScore(E.painter.paint, photo, E.fig);
    if (E.heat) { E.heatCv = F.camoHeat(E.painter.paint, photo, E.fig, E.heatCv || F.mk(F.PX)); if (stage) stage.dirty = true; }
    if (gameRefs.camo) setCamo(gameRefs.camo, E.camo);
    if (practiceRefs.camo) setCamo(practiceRefs.camo, E.camo);
  }
  function setCamo(node, v) {
    node.textContent = "";
    var lv = v >= 85 ? "mh_camo_5" : v >= 70 ? "mh_camo_4" : v >= 55 ? "mh_camo_3" : v >= 35 ? "mh_camo_2" : "mh_camo_1";
    node.appendChild(el("div", { class: "mh-camo-bar" }, [el("i", { style: "width:" + Math.max(2, v) + "%" })]));
    node.appendChild(el("span", null, [t("mh_camo", { n: v }) + "・" + t(lv)]));
  }

  function buildHidePanel(side, under, s, me, admin) {
    var hider = !!s.hide[me];
    if (sess.local && s.q.length && !s.qr) {
      side.appendChild(panel(t("mh_phase_hide"), [
        rolesLine(s),
        el("p", { class: "mh-wait" }, [t("mh_handoff_hide", { name: nameOf(s.q[0]) })]),
        btn(t("mh_im_ready", { name: nameOf(s.q[0]) }), function () { sess.send({ a: "turn" }); }, "mh-btn mh-big mh-primary"),
        el("p", { class: "mh-small mh-muted" }, [t("mh_queue", { list: s.q.map(nameOf).join(" → ") })])
      ]));
      return;
    }
    if (!hider || !ui.edit) {
      var list = el("ul", { class: "mh-plist" });
      gameRefs.dyn = function () {
        list.textContent = "";
        Object.keys(sess.s.hide).forEach(function (p) { var h = sess.s.hide[p]; list.appendChild(el("li", null, [(h.done ? "✅ " : "🎨 ") + nameOf(p)])); });
      };
      side.appendChild(panel(t("mh_phase_hide"), [
        rolesLine(s),
        el("p", { class: "mh-wait" }, [t("mh_wait_hide")]),
        list,
        admin ? forceBtn(t("mh_force_seek")) : null
      ]));
      return;
    }
    var E = ui.edit, done = s.hide[me].done;
    buildEditor(side, under, E, {
      done: done,
      onDone: function () { sendFig(true); },
      onUndone: function () { sess.send({ a: "fig", done: false }); },
      changed: function () { queueFigSend(false); },
      extra: [rolesLine(s), admin && !sess.local ? forceBtn(t("mh_force_seek")) : null],
      doneList: !sess.local
    });
  }

  // 編輯器面板（躲藏與練習共用）
  var practiceRefs = {};
  function buildEditor(side, under, E, o) {
    var refs = o.practice ? practiceRefs : gameRefs;
    refs.camo = el("div", { class: "mh-camo" });
    setCamo(refs.camo, E.camo >= 0 ? E.camo : 0);
    setTimeout(function () { updateCamo(true); }, 30);
    var tabs = seg([["pose", "🕺 " + t("mh_tab_pose")], ["place", "📐 " + t("mh_tab_place")], ["paint", "🎨 " + t("mh_tab_paint")]], E.tab, function (v) { E.tab = v; rebuild(); });
    function rebuild() { if (o.practice) renderPracticeSide(); else { panelSig = ""; refreshPanel(); } }
    function changed() { if (stage) stage.dirty = true; updateCamo(false); if (o.changed) o.changed(); }
    E.onChanged = changed;
    E.onRebuild = rebuild;
    var body;
    if (E.tab === "pose") body = poseTab(E, changed);
    else if (E.tab === "place") body = placeTab(E, changed);
    else body = paintTab(E, changed, rebuild);
    var doneRow = o.done
      ? el("div", { class: "mh-donebox" }, [el("p", null, ["✅ " + t("mh_hidden_ok")]), btn(t("mh_edit_more"), o.onUndone, "mh-btn")])
      : btn(o.doneLabel || ("🙈 " + t("mh_done_hide")), o.onDone, "mh-btn mh-big mh-primary mh-donebtn");
    side.appendChild(panel(o.title || t("mh_your_turn_hide"), [
      el("p", { class: "mh-small mh-muted" }, [t("mh_hide_hint")]),
      refs.camo,
      tabs, body,
      el("label", { class: "mh-check" }, [el("input", { type: "checkbox", checked: E.outline ? true : null, onchange: function (e) { E.outline = e.target.checked; if (stage) stage.dirty = true; } }), " " + t("mh_show_outline")]),
      el("label", { class: "mh-check", title: t("mh_heat_hint") }, [el("input", { type: "checkbox", "data-act": "heat", checked: E.heat ? true : null, onchange: function (e) { E.heat = e.target.checked; E.camoKey = ""; updateCamo(true); if (stage) stage.dirty = true; } }), " " + t("mh_heat")]),
      doneRow
    ].concat(o.extra || [])));
    if (o.doneList) {
      var list = el("ul", { class: "mh-plist mh-small" });
      refs.dyn = function () {
        list.textContent = "";
        Object.keys(sess.s.hide).forEach(function (p) { var h = sess.s.hide[p]; list.appendChild(el("li", null, [(h.done ? "✅ " : "🎨 ") + nameOf(p)])); });
      };
      side.appendChild(panel(t("mh_hiders"), [list]));
    }
    void under;
  }
  function poseTab(E, changed) {
    var grid = el("div", { class: "mh-poses" }, D.POSES.map(function (p) {
      return btn(el("span", null, [F.poseIcon(p.id, 46, "#6fb36a"), el("small", null, [L(p.name)])]), function () {
        E.fig.p = p.id; changed();
        Array.prototype.forEach.call(grid.children, function (b, i) { b.classList.toggle("mh-on", D.POSES[i].id === p.id); });
      }, "mh-pose" + (E.fig.p === p.id ? " mh-on" : ""), { title: L(p.name) });
    }));
    var eyes = seg(D.EYES.map(function (e) { return [e.id, L(e.name)]; }), E.fig.e, function (v) { E.fig.e = v; changed(); Array.prototype.forEach.call(eyes.children, function (b, i) { b.classList.toggle("mh-on", D.EYES[i].id === v); }); });
    return el("div", null, [el("h3", null, [t("mh_pose_title", { n: D.POSES.length })]), grid, el("h3", null, [t("mh_eyes")]), eyes, el("p", { class: "mh-small mh-muted" }, [t("mh_eyes_note")])]);
  }
  function slider(label, min, max, step, val, oninput, fmt) {
    var out = el("span", { class: "mh-sval" }, [fmt ? fmt(val) : String(val)]);
    var inp = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(val), oninput: function (e) { var v = Number(e.target.value); out.textContent = fmt ? fmt(v) : String(v); oninput(v); } });
    return el("label", { class: "mh-slider" }, [el("span", { class: "mh-flabel" }, [label]), inp, out]);
  }
  function placeTab(E, changed) {
    return el("div", null, [
      el("p", { class: "mh-small mh-muted" }, [t("mh_place_hint")]),
      slider(t("mh_size"), Core.S_MIN, Core.S_MAX, 0.05, E.fig.s, function (v) { E.fig.s = v; changed(); }, function (v) { return Math.round(v * 100) + "%"; }),
      slider(t("mh_rotate"), -180, 180, 1, E.fig.r, function (v) { E.fig.r = v; changed(); }, function (v) { return v + "°"; }),
      el("div", { class: "mh-actions" }, [
        btn("↔ " + t("mh_flip"), function () { E.fig.f = !E.fig.f; changed(); }, "mh-btn"),
        btn("⟲ 0°", function () { E.fig.r = 0; changed(); rebuildPlace(); }, "mh-btn"),
        btn("🎯 " + t("mh_center"), function () { E.fig.x = E.ar / 2; E.fig.y = 0.5; changed(); }, "mh-btn")
      ])
    ]);
    function rebuildPlace() { if (E.onRebuild) E.onRebuild(); }
  }
  function colorInput(val, onchange) {
    return el("input", { type: "color", class: "mh-color", value: val, oninput: function (e) { onchange(e.target.value); } });
  }
  function paintTab(E, changed, rebuild) {
    var P = E.painter;
    var tools = D.TOOLS.filter(function (x) { return !x.photo || E.allowClone; });
    var toolGrid = el("div", { class: "mh-tools" }, tools.map(function (x) {
      return btn(el("span", null, [el("b", null, [x.icon]), el("small", null, [L(x.name)])]), function () { E.tool = x.id; P.tool = x.id; rebuild(); }, "mh-tool" + (E.tool === x.id ? " mh-on" : ""), { title: L(x.tip) });
    }));
    P.tool = E.tool;
    var tipObj = D.TOOLS.filter(function (x) { return x.id === E.tool; })[0];
    var c1 = colorInput(P.c1, function (v) { P.c1 = v; sw1.style.background = v; }), c2 = colorInput(P.c2, function (v) { P.c2 = v; });
    var sw1 = el("span", { class: "mh-cur", style: "background:" + P.c1 });
    function pick(col) {
      P.c1 = col; c1.value = col; sw1.style.background = col;
      E.recent = [col].concat(E.recent.filter(function (x) { return x !== col; })).slice(0, 10);
      drawRecent();
    }
    E.pickColor = pick;
    var recentBox = el("div", { class: "mh-swatches" });
    function drawRecent() {
      recentBox.textContent = "";
      E.recent.forEach(function (col) { recentBox.appendChild(el("button", { type: "button", class: "mh-sw", style: "background:" + col, title: col, onclick: function () { pick(col); } })); });
    }
    drawRecent();
    var photo = E.getPhoto();
    if (!E.pal && photo) { try { E.pal = F.palette(photo, 18); } catch (e) { E.pal = []; } }
    function swatchRow(list) { return el("div", { class: "mh-swatches" }, (list || []).map(function (col) { return el("button", { type: "button", class: "mh-sw", style: "background:" + col, title: col, onclick: function () { pick(col); } }); })); }
    var patSel = seg(D.PATTERNS.map(function (p) { return [p.id, L(p.name)]; }), P.pat, function (v) { P.pat = v; rebuild(); });
    function adj(label, f) { return btn(label, function () { f(); changed(); }, "mh-btn mh-small"); }
    var sizeRow = slider(t("mh_brush_size"), 1, 40, 1, P.size, function (v) { P.size = v; });
    var nodes = [
      toolGrid,
      tipObj ? el("p", { class: "mh-small mh-tip" }, [tipObj.icon + " " + L(tipObj.tip)]) : null,
      el("div", { class: "mh-colors" }, [
        el("label", null, [t("mh_color1"), " ", sw1, c1]),
        btn("⇄", function () { var a = P.c1; P.c1 = P.c2; P.c2 = a; c1.value = P.c1; c2.value = P.c2; sw1.style.background = P.c1; }, "mh-btn mh-small", { title: t("mh_swap") }),
        el("label", null, [t("mh_color2"), " ", c2])
      ]),
      el("div", null, [el("span", { class: "mh-small mh-muted" }, [t("mh_recent")]), recentBox]),
      E.pal && E.pal.length ? el("div", null, [el("span", { class: "mh-small mh-muted" }, [t("mh_photo_palette")]), swatchRow(E.pal)]) : null,
      el("details", { class: "mh-more" }, [el("summary", null, [t("mh_more_colors")]), swatchRow(D.SWATCHES)]),
      sizeRow,
      slider(t("mh_opacity"), 5, 100, 5, Math.round(P.opacity * 100), function (v) { P.opacity = v / 100; }, function (v) { return v + "%"; }),
      slider(t("mh_hardness"), 0, 100, 5, Math.round(P.hard * 100), function (v) { P.hard = v / 100; }, function (v) { return v + "%"; })
    ];
    if (E.tool === "stamp") {
      nodes.push(el("div", { class: "mh-stampbox" }, [
        el("span", { class: "mh-small" + (E.srcOff ? "" : " mh-warn") }, [E.srcOff ? (E.armSrc ? t("mh_stamp_arm") : t("mh_stamp_ok")) : t("mh_stamp_need")]),
        btn("🎯 " + t("mh_stamp_set"), function () { E.armSrc = true; rebuild(); }, "mh-btn mh-small" + (E.armSrc ? " mh-primary" : ""), { "data-act": "stamp-set" })
      ]));
    }
    if (E.tool === "pattern") {
      nodes.push(el("div", null, [el("h3", null, [t("mh_pattern")]), patSel]));
      nodes.push(slider(t("mh_pattern_scale"), 0.4, 3, 0.1, P.patScale, function (v) { P.patScale = v; }, function (v) { return Math.round(v * 100) + "%"; }));
      var pv = F.pattern(P.pat, P.c1, P.c2, P.patScale), pc = F.mk(64); pc.getContext("2d").drawImage(pv, 0, 0, 128, 128, 0, 0, 64, 64);
      pc.className = "mh-patprev";
      nodes.push(pc);
    }
    nodes.push(el("label", { class: "mh-check" }, [el("input", { type: "checkbox", checked: P.mirror ? true : null, onchange: function (e) { P.mirror = e.target.checked; } }), " " + t("mh_mirror")]));
    nodes.push(el("div", { class: "mh-actions" }, [
      btn("↶ " + t("mh_undo"), function () { if (P.doUndo()) changed(); }, "mh-btn"),
      btn("↷ " + t("mh_redo"), function () { if (P.doRedo()) changed(); }, "mh-btn")
    ]));
    nodes.push(el("details", { class: "mh-more", open: E.adjOpen ? true : null, ontoggle: function (e) { E.adjOpen = e.target.open; } }, [
      el("summary", null, [t("mh_whole_body")]),
      el("div", { class: "mh-actions" }, [
        adj("🪣 " + t("mh_fill_all"), function () { P.fillAll(); }),
        adj("🧩 " + t("mh_pattern_all"), function () { P.fillPattern(); }),
        E.allowClone ? adj("🦎 " + t("mh_clone_all"), function () { cloneAll(E); }) : null,
        adj("🎨 " + t("mh_match_tone"), function () { P.matchTone(underFor(E), E.fig.p, 0.85); }),
        E.allowClone ? adj("🌗 " + t("mh_edge_blend"), function () { P.edgeBlend(underFor(E), E.fig.p, 6, 0.8); }) : null,
        adj("🎯 " + t("mh_quantize"), function () { if (E.pal && E.pal.length) P.quantize(E.pal, 0.7); }),
        adj("🧽 " + t("mh_reset_base"), function () { P.clear(P.c1); })
      ]),
      el("div", { class: "mh-actions" }, [
        adj(t("mh_hue") + " ◀", function () { P.adjust({ hue: -20 }); }), adj(t("mh_hue") + " ▶", function () { P.adjust({ hue: 20 }); }),
        adj(t("mh_bright") + " −", function () { P.adjust({ bri: 90 }); }), adj(t("mh_bright") + " ＋", function () { P.adjust({ bri: 110 }); }),
        adj(t("mh_sat") + " −", function () { P.adjust({ sat: 80 }); }), adj(t("mh_sat") + " ＋", function () { P.adjust({ sat: 120 }); }),
        adj(t("mh_contrast") + " −", function () { P.adjust({ con: 88 }); }), adj(t("mh_contrast") + " ＋", function () { P.adjust({ con: 112 }); }),
        adj("✨ " + t("mh_noise"), function () { P.noise(24); }), adj("🌫 " + t("mh_soften"), function () { P.adjust({ blur: 1.6 }); })
      ])
    ]));
    nodes.push(el("p", { class: "mh-small mh-muted" }, [t("mh_paint_keys")]));
    return el("div", null, nodes);
  }
  // 「全身拓印」：只在房間允許變色拓印時出現，而且只印 60%，還是要自己修
  function cloneAll(E) {
    if (!E.allowClone) return;
    var P = E.painter;
    P.snapshot();
    P.g.globalAlpha = 0.6;
    P.g.drawImage(underFor(E), 0, 0);
    P.g.globalAlpha = 1;
    P.changed();
  }

  // ---- 舞台互動 ----
  function editActive() { return ui.edit && (ui.screen === "practice" || amHiding()) && !(ui.screen === "game" && sess.s.hide[sess.me()] && sess.s.hide[sess.me()].done); }
  function paintPx(E, P) { var l = Core.toLocal(E.fig, P[0], P[1]); return F.toPx(l); }
  var dragFig = null;
  function stageDown(P, e) {
    if (!editActive() || (e.button !== undefined && e.button > 0)) return false;   // 右鍵／中鍵＝平移
    var E = ui.edit;
    if (E.tab !== "paint") {
      if (Core.hitFig(E.fig, P[0], P[1], 10)) { dragFig = { dx: E.fig.x - P[0], dy: E.fig.y - P[1] }; return true; }
      return false;
    }
    if (E.tool === "stamp" && (E.armSrc || !E.srcOff || e.altKey)) {
      E.srcOff = [P[0] - E.fig.x, P[1] - E.fig.y];
      E.armSrc = false; E.stampKey = "";
      toast(t("mh_stamp_ok"));
      if (E.onRebuild) E.onRebuild();
      return true;
    }
    if (E.tool === "picker" || e.altKey) {
      var col = stage.sample(P);
      if (col && E.pickColor) E.pickColor(col);
      return true;
    }
    var p = paintPx(E, P);
    E.painter.begin(p[0], p[1]);
    if (E.tool === "fill") E.onChanged();
    return true;
  }
  function stageMove(P) {
    var E = ui.edit;
    if (!E) return;
    if (dragFig) { E.fig.x = Math.max(0, Math.min(E.ar, P[0] + dragFig.dx)); E.fig.y = Math.max(0, Math.min(1, P[1] + dragFig.dy)); stage.dirty = true; return; }
    if (E.painter.stroke) { var p = paintPx(E, P); E.painter.move(p[0], p[1]); }
  }
  function stageUp() {
    var E = ui.edit;
    if (!E) return;
    if (dragFig) { dragFig = null; E.onChanged(); return; }
    if (E.painter.stroke) { E.painter.end(); E.onChanged(); }
  }
  function stageCancel() {
    var E = ui.edit;
    dragFig = null;
    if (E && E.painter.stroke) { E.painter.end(); E.painter.doUndo(); E.painter.redo = []; }
  }
  function stageTap(P) {
    if (ui.screen !== "game" || !sess || !sess.s) return;
    if (amSeekerActive()) sess.send({ a: "tap", x: P[0], y: P[1] });
  }

  // ---- 舞台繪製 ----
  function drawWorld(g, st) {
    var u = st.unit();
    if (ui.screen === "practice" || (ui.screen === "game" && sess && sess.s && sess.s.phase === "hide")) {
      var E = ui.edit;
      if (E && (ui.screen === "practice" || amHiding())) {
        var cv = F.render(E.painter.current(), E.fig.p, E.fig.e, { outline: E.outline ? "rgba(255,255,255,0.9)" : null, outlineW: 1.6 / Math.max(0.6, Core.figK(E.fig) * u / 1.6), into: E.liveCv || (E.liveCv = F.mk(F.PX)), eyeSeed: E.seed });
        F.place(g, cv, E.fig);
        if (E.heat && E.heatCv) F.place(g, E.heatCv, E.fig);
      }
      return;
    }
    if (ui.screen !== "game") return;
    var s = sess.s;
    figsToDraw().forEach(function (d) {
      F.place(g, figCanvas(s, d.pid, d.mine && s.phase === "seek" ? "rgba(255,255,255,0.85)" : null), d.fig);
    });
  }
  // 取樣拓印的取樣點（十字準星，跟著小人物移動）
  function editOverlay(g, st) {
    var E = ui.edit;
    if (!E || !E.srcOff || E.tool !== "stamp" || E.tab !== "paint" || !editActive()) return;
    var p = st.toScreen(E.fig.x + E.srcOff[0], E.fig.y + E.srcOff[1]);
    g.strokeStyle = "#fff"; g.lineWidth = 3;
    g.beginPath(); g.arc(p[0], p[1], 10, 0, Math.PI * 2); g.moveTo(p[0] - 16, p[1]); g.lineTo(p[0] + 16, p[1]); g.moveTo(p[0], p[1] - 16); g.lineTo(p[0], p[1] + 16); g.stroke();
    g.strokeStyle = "#ff3d7f"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(p[0], p[1], 10, 0, Math.PI * 2); g.moveTo(p[0] - 16, p[1]); g.lineTo(p[0] + 16, p[1]); g.moveTo(p[0], p[1] - 16); g.lineTo(p[0], p[1] + 16); g.stroke();
  }
  function drawOverlay(g, st) {
    editOverlay(g, st);
    if (ui.screen !== "game" || !sess || !sess.s) return;
    var s = sess.s, nowT = Date.now();
    figsToDraw().forEach(function (d) {
      if (!d.label) return;
      var c = st.toScreen(d.fig.x, d.fig.y), r = Math.max(14, Core.figK(d.fig) * 58 * st.unit());
      g.lineWidth = 3;
      g.strokeStyle = d.found ? "#ff4d6d" : d.mine ? "#ffffff" : "#ffd23f";
      g.setLineDash(d.found ? [] : [6, 5]);
      g.beginPath(); g.arc(c[0], c[1], r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      var txt = (d.found ? "🔍 " : d.mine ? "🙋 " : "") + nameOf(d.pid);
      g.font = "bold 13px sans-serif";
      var w = g.measureText(txt).width + 10;
      g.fillStyle = "rgba(0,0,0,0.65)";
      g.fillRect(c[0] - w / 2, c[1] - r - 22, w, 19);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(txt, c[0], c[1] - r - 12.5);
      g.textAlign = "start"; g.textBaseline = "alphabetic";
    });
    ui.marks = ui.marks.filter(function (m) { return nowT - m.t < 1400; });
    ui.marks.forEach(function (m) {
      var p = st.toScreen(m.x, m.y), a = 1 - (nowT - m.t) / 1400;
      g.globalAlpha = Math.max(0, a);
      if (m.k === "miss") {
        g.strokeStyle = "#ff3b3b"; g.lineWidth = 4;
        g.beginPath(); g.moveTo(p[0] - 12, p[1] - 12); g.lineTo(p[0] + 12, p[1] + 12); g.moveTo(p[0] + 12, p[1] - 12); g.lineTo(p[0] - 12, p[1] + 12); g.stroke();
      } else {
        g.strokeStyle = "#7CFF6B"; g.lineWidth = 4;
        g.beginPath(); g.arc(p[0], p[1], 18 + (1 - a) * 40, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    });
  }

  // ---- 事件（找到、失誤、感染） ----
  function processEvents() {
    var s = sess.s, me = sess.me();
    var evs = s.log.filter(function (e) { return e.n > ui.lastEv; });
    if (!evs.length) return;
    ui.lastEv = s.ev;
    evs.forEach(function (e) {
      if (e.k === "found") {
        ui.marks.push({ k: "found", x: e.x, y: e.y, t: Date.now() });
        if (s.cfg.mode === "sync" && e.a !== me && e.b !== me && !sess.local) return;
        toast(t("mh_ev_found", { a: nameOf(e.a), b: nameOf(e.b), g: e.g }), "mh-good");
      } else if (e.k === "miss") {
        if (e.a === me || sess.local) ui.marks.push({ k: "miss", x: e.x, y: e.y, t: Date.now() });
      } else if (e.k === "infect") toast(t("mh_ev_infect", { a: nameOf(e.a) }), "mh-bad");
      else if (e.k === "out") toast(t("mh_ev_out", { a: nameOf(e.a) }), "mh-bad");
      else if (e.k === "giveup") toast(t("mh_ev_giveup", { a: nameOf(e.a) }));
      else if (e.k === "timeout") toast(t("mh_ev_timeout"));
      else if (e.k === "join") toast(t("mh_ev_join", { a: nameOf(e.a) }));
    });
    if (stage) stage.dirty = true;
  }

  // ---- 尋找 ----
  function buildSeekPanel(side, s, me, admin) {
    if (sess.local && s.q.length && !s.qr) {
      side.appendChild(panel(t("mh_phase_seek"), [
        el("p", { class: "mh-wait" }, [t("mh_handoff_seek", { name: nameOf(s.q[0]) })]),
        btn(t("mh_im_ready", { name: nameOf(s.q[0]) }), function () { sess.send({ a: "turn" }); }, "mh-btn mh-big mh-primary"),
        el("p", { class: "mh-small mh-muted" }, [t("mh_queue", { list: s.q.map(nameOf).join(" → ") })])
      ]));
      return;
    }
    var info = el("div", { class: "mh-seekinfo" }), board = el("ul", { class: "mh-plist mh-small" });
    gameRefs.dyn = function () {
      var S = sess.s, k = S.seek[me];
      info.textContent = "";
      if (k && S.phase === "seek") {
        var left = Core.targetsFor(S, me).length;
        info.appendChild(el("div", { class: "mh-stat" }, [el("b", null, [String(k.finds)]), el("small", null, [t("mh_found_n")])]));
        info.appendChild(el("div", { class: "mh-stat" }, [el("b", null, [String(left)]), el("small", null, [t("mh_left_n")])]));
        info.appendChild(el("div", { class: "mh-stat" + (S.cfg.miss && S.cfg.miss - k.miss <= 1 ? " mh-hurry" : "") }, [el("b", null, [S.cfg.miss ? Math.max(0, S.cfg.miss - k.miss) + "/" + S.cfg.miss : "∞"]), el("small", null, [t("mh_miss_left")])]));
      }
      board.textContent = "";
      Core.seekerList(S).forEach(function (p) { var q = S.seek[p]; board.appendChild(el("li", null, [(q.inf ? "🧟 " : "👹 ") + nameOf(p) + "　" + t("mh_board_seek", { f: q.finds, m: q.miss }) + (q.out ? "　" + t("mh_out") : "")])); });
      Core.zOrder(S).forEach(function (p) {
        if (S.seek[p] && S.cfg.mode !== "sync") return;
        var cnt = Object.keys(S.hide[p].found).length;
        var shown = S.cfg.mode === "sync" ? (cnt ? t("mh_found_by_n", { n: cnt }) : t("mh_safe")) : (cnt ? t("mh_found") : t("mh_safe"));
        board.appendChild(el("li", null, ["🦎 " + nameOf(p) + "　" + shown]));
      });
    };
    var active = amSeekerActive(), k = s.seek[me];
    var title = active ? t("mh_your_turn_seek") : t("mh_phase_seek");
    var msg = active ? t(s.cfg.mode === "sync" ? "mh_seek_hint_sync" : "mh_seek_hint")
      : k && k.out ? t("mh_you_out")
      : s.hide[me] && !Core.isFound(s, me) ? t("mh_hiding_wait")
      : t("mh_watching");
    side.appendChild(panel(title, [
      el("p", { class: active ? "mh-hint" : "mh-wait" }, [msg]),
      info,
      active ? btn("🏳 " + t("mh_giveup"), function () { if (window.confirm(t("mh_giveup_confirm"))) sess.send({ a: "giveup" }); }, "mh-btn") : null,
      admin && !sess.local ? forceBtn(t("mh_force_result")) : null
    ]));
    side.appendChild(panel(t("mh_status"), [board]));
  }

  // ---- 結果 ----
  function buildResultPanel(side, s, admin) {
    var rows = (s.res || []).map(function (r) {
      var fate = !r.hid ? "" : s.cfg.mode === "sync" ? (r.by.length ? t("mh_found_by", { list: r.by.map(nameOf).join("、") }) : t("mh_nobody_found")) : r.found ? t("mh_found_by", { list: r.by.map(nameOf).join("、") }) : t("mh_survived");
      return el("tr", null, [
        el("td", null, [nameOf(r.pid)]),
        el("td", null, [(r.seeker ? (r.inf ? "🧟" : "👹") : "") + (r.hid ? "🦎" : "")]),
        el("td", { class: "mh-small" }, [fate + (r.seeker ? (fate ? "／" : "") + t("mh_board_seek", { f: r.finds, m: r.miss }) : "")]),
        el("td", { class: "mh-num" }, [r.hid && r.camo >= 0 ? r.camo + "%" : "-"]),
        el("td", { class: "mh-num mh-delta" }, ["+" + (r.delta || 0)])
      ]);
    });
    var last = s.round >= s.total;
    side.appendChild(panel(t("mh_result_title", { r: s.round }), [
      el("table", { class: "mh-table" }, [el("thead", null, [el("tr", null, [t("mh_col_name"), t("mh_col_role"), t("mh_col_fate"), t("mh_col_camo"), t("mh_col_score")].map(function (h) { return el("th", null, [h]); }))]), el("tbody", null, rows)]),
      el("p", { class: "mh-small mh-muted" }, [t("mh_result_note")]),
      admin ? btn(last ? t("mh_final") : t("mh_next_round"), function () { sess.send({ a: "next", active: activeList() }); }, "mh-btn mh-big mh-primary") : el("p", { class: "mh-muted" }, [t("mh_wait_host_next")])
    ]));
    side.appendChild(scorePanel(s));
  }
  function scorePanel(s) {
    return panel(t("mh_scores"), [el("ol", { class: "mh-rank" }, Core.ranking(s).map(function (p) { return el("li", null, [nameOf(p), el("b", null, [String(s.scores[p] || 0)])]); }))]);
  }
  function buildEndPanel(side, s, admin) {
    var rk = Core.ranking(s);
    side.appendChild(panel("🏆 " + t("mh_end_title"), [
      el("div", { class: "mh-podium" }, rk.slice(0, 3).map(function (p, i) { return el("div", { class: "mh-pod mh-pod" + (i + 1) }, [el("div", { class: "mh-medal" }, [["🥇", "🥈", "🥉"][i]]), el("b", null, [nameOf(p)]), el("span", null, [t("mh_pts", { n: s.scores[p] || 0 })])]); })),
      el("ol", { class: "mh-rank" }, rk.map(function (p) { return el("li", null, [nameOf(p), el("b", null, [String(s.scores[p] || 0)])]); })),
      sess.local ? btn(t("mh_play_again"), function () { leaveAll(); go("local"); }, "mh-btn mh-big mh-primary")
        : admin ? btn(t("mh_back_lobby"), function () { ui.room.backToLobby(); go("lobby"); }, "mh-btn mh-big mh-primary") : el("p", { class: "mh-muted" }, [t("mh_wait_host")])
    ]));
  }

  // ---------------- 上色練習 ----------------
  function renderPractice() {
    var pr = ui.practice;
    if (!pr) {
      app.appendChild(panel(t("mh_menu_practice"), [
        el("p", null, [t("mh_practice_intro")]),
        el("div", { class: "mh-actions" }, [el("label", { class: "mh-btn mh-primary mh-filebtn" }, ["🖼 " + t("mh_upload"), el("input", { type: "file", accept: "image/*", class: "mh-file", onchange: function (e) {
          var f = e.target.files && e.target.files[0];
          if (f) loadPhotoFile(f, function (res) { if (res) startPractice(res.canvas, res.ar); });
        } })])]),
        el("h3", null, [t("mh_or_scene")]),
        el("div", { class: "mh-scenes" }, D.SCENES.map(function (sc) {
          return btn(el("span", null, [SC.thumb(sc.id, 132), el("small", null, [L(sc.name)])]), function () { startPractice(SC.render(sc.id, Core.newSeed()), SC.AR); }, "mh-scene");
        }))
      ]));
      return;
    }
    var main = el("div", { class: "mh-main" }), left = el("div", { class: "mh-left" });
    if (stage) stage.destroy();
    stage = new Stage({
      ar: function () { return pr.ar; }, photo: function () { return pr.photo; },
      draw: drawWorld, overlay: function (g, st) {
        editOverlay(g, st);
        if (!pr.reveal) return;
        var c = st.toScreen(ui.edit.fig.x, ui.edit.fig.y), r = Math.max(14, Core.figK(ui.edit.fig) * 58 * st.unit());
        g.strokeStyle = "#ffd23f"; g.lineWidth = 3; g.beginPath(); g.arc(c[0], c[1], r, 0, Math.PI * 2); g.stroke();
      },
      animating: function () { return !!(ui.edit && ui.edit.painter.stroke); },
      onDown: stageDown, onMove: stageMove, onUp: stageUp, onCancel: stageCancel
    });
    left.appendChild(stage.wrap);
    practiceRefs.side = el("div", { class: "mh-side" });
    main.appendChild(left); main.appendChild(practiceRefs.side);
    app.appendChild(main);
    renderPracticeSide();
  }
  function startPractice(photo, ar) {
    ui.practice = { photo: photo, ar: ar, reveal: false };
    ui.edit = newEditor("me" + Math.floor(Math.random() * 1e6), 1, Core.defaultFig(ar, Math.floor(Math.random() * 20)), ar, function () { return ui.practice && ui.practice.photo; }, true);
    render();
  }
  function renderPracticeSide() {
    var side = practiceRefs.side, pr = ui.practice;
    if (!side) return;
    side.innerHTML = "";
    buildEditor(side, null, ui.edit, {
      practice: true, title: t("mh_menu_practice"),
      doneLabel: "🔍 " + t("mh_practice_check"),
      onDone: function () { updateCamo(true); pr.reveal = !pr.reveal; if (stage) stage.dirty = true; toast(t("mh_practice_score", { n: ui.edit.camo })); },
      extra: [btn(t("mh_practice_new"), function () { ui.practice = null; ui.edit = null; render(); }, "mh-btn")]
    });
  }

  // ---------------- 鍵盤 ----------------
  document.addEventListener("keydown", function (e) {
    var E = ui.edit;
    if (!E || !editActive()) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" && e.target.type !== "range" && e.target.type !== "checkbox") return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey ? E.painter.doRedo() : E.painter.doUndo()) E.onChanged(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); if (E.painter.doRedo()) E.onChanged(); }
    else if (e.key === "[") { E.painter.size = Math.max(1, E.painter.size - 2); }
    else if (e.key === "]") { E.painter.size = Math.min(40, E.painter.size + 2); }
  });

  window.addEventListener("i18n:change", function (e) {
    ui.lang = e && e.detail ? e.detail.lang : "";
    if (ui.screen === "game") { panelSig = ""; refreshPanel(); }
    else if (ui.screen === "practice") renderPracticeSide();
    else render();
  });

  // 測試用（Playwright）
  window.PriTestMahou = {
    ui: ui, sess: function () { return sess; }, state: function () { return sess && sess.s; }, stage: function () { return stage; },
    send: function (it) { return sess && sess.send(it); }, editor: function () { return ui.edit; }, sendFig: sendFig
  };

  var rid = Net && Net.roomFromUrl(window.location.href);
  if (rid && Net.validRoomId(rid)) enterRoom(rid);
  else render();
})();
