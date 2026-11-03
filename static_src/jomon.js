// 繩文帝國（jomon）：畫面與互動。資料在 jomon_data.js，規則與 state 在 jomon_core.js，3D 村落在 jomon_scene3d.js。
// 即時遊戲：每 100ms 推進模擬（依倍速），每 250ms 更新畫面。
// 面板只在「結構」改變（分頁、時代、可研究項目、目標清單……）時整個重畫；平常只就地更新數字與按鈕狀態
// （dyn() 登錄的更新函式），這樣按鈕不會在按下的瞬間被換掉、輸入框也不會失去焦點。
// 狀態存在 localStorage["pritest-jomon-save"]（jomon_core.js 的 SAVE_KEY），每 10 秒與離開頁面時自動存檔。
(function () {
  "use strict";

  var D = window.PriTestJomonData;
  var Core = window.PriTestJomonCore;
  var Scene3D = window.PriTestJomonScene;
  var app = document.getElementById("jm-app");
  if (!app || !D || !Core) return;

  var state = null;
  var scene = null;
  var ui = {
    tab: "village",
    modal: null,
    updaters: [],
    sig: "",
    army: {},
    tradeFrom: "food",
    tradeTo: "wood",
    toastSeen: 0,
    difficulty: "normal",
    autoRotate: false,
    reportOpen: null,
  };

  var SPEEDS = [1, 2, 4, 8];
  var DAY_LENGTH = 300; // 遊戲內一天 300 秒

  // ---------------- 小工具 ----------------

  function t(key, params) {
    if (!window.I18N) return key;
    var p = null;
    if (params) {
      p = {};
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        p[k] = v && typeof v === "object" && (v.zh || v.ja) ? L(v) : typeof v === "number" ? fmt(v) : v;
      });
    }
    return window.I18N.t(key, p);
  }
  function L(obj) {
    return D.localizedText(obj);
  }
  function lang() {
    return (window.I18N && window.I18N.getLang()) || "zh";
  }

  function fmt(n) {
    if (n == null || isNaN(n)) return "0";
    var neg = n < 0;
    n = Math.abs(n);
    var s;
    if (lang() === "en") {
      if (n >= 1e9) s = (n / 1e9).toFixed(2) + "B";
      else if (n >= 1e6) s = (n / 1e6).toFixed(2) + "M";
      else if (n >= 1e4) s = (n / 1e3).toFixed(1) + "K";
      else s = Math.floor(n).toLocaleString("en");
    } else {
      var man = lang() === "ja" ? "万" : "萬";
      if (n >= 1e8) s = (n / 1e8).toFixed(2) + "億";
      else if (n >= 1e4) s = (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + man;
      else s = Math.floor(n).toLocaleString("en");
    }
    return (neg ? "-" : "") + s.replace(/\.0(?=[^0-9]|$)/, "").replace(/\.00(?=[^0-9]|$)/, "");
  }
  function fmtRate(n) {
    var a = Math.abs(n);
    var s = a < 10 ? a.toFixed(1) : fmt(a);
    return (n < 0 ? "−" : "+") + s;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = (m < 10 && h ? "0" : "") + m;
    var ss = (s < 10 ? "0" : "") + s;
    return h ? h + ":" + mm + ":" + ss : mm + ":" + ss;
  }
  function pct(x) {
    return Math.round(x * 100) + "%";
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else if (k === "style") node.setAttribute("style", v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  // 登錄一個每 tick 執行的更新函式（只在節點還在畫面上時有效）
  function dyn(node, fn) {
    ui.updaters.push({ node: node, fn: fn });
    fn(node);
    return node;
  }

  function costView(cost) {
    var wrap = el("span", { class: "jm-cost" });
    Object.keys(cost || {}).forEach(function (r) {
      var chip = el("span", { class: "jm-cost-item" }, [D.RESOURCE_ICONS[r] + fmt(cost[r])]);
      dyn(chip, function (n) {
        n.classList.toggle("jm-lack", state.res[r] < cost[r]);
      });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function bar(fracFn, extraClass) {
    var fill = el("div", { class: "jm-bar-fill" });
    var b = el("div", { class: "jm-bar" + (extraClass ? " " + extraClass : "") }, [fill]);
    dyn(fill, function (n) {
      n.style.width = clampPct(fracFn()) + "%";
    });
    return b;
  }
  function clampPct(f) {
    return Math.max(0, Math.min(100, f * 100));
  }

  function button(label, onclick, opts) {
    opts = opts || {};
    var b = el("button", { type: "button", class: opts.cls || "jm-btn", onclick: onclick, title: opts.title || null }, [label]);
    if (opts.enabled) {
      dyn(b, function (n) {
        n.disabled = !opts.enabled();
      });
    }
    return b;
  }

  function uniqueBase() {
    var cv = state.civ && D.civ(state.civ);
    return cv ? cv.unique.base : null;
  }

  function civColorHex() {
    var cv = state.civ && D.civ(state.civ);
    return cv ? cv.color : 0xc0392b;
  }

  function unitName(cls) {
    var u = Core.unitDef(state, cls);
    return u ? L(u.name) : cls;
  }
  function unitIcon(cls) {
    var u = Core.unitDef(state, cls);
    if (u) return u.icon;
    var sp = D.SPECIAL_UNITS[cls];
    return sp ? sp.icon : "";
  }
  function anyUnitName(cls, tier) {
    if (D.UNITS[cls]) return L(D.UNITS[cls].names[Math.min(tier, 8)]);
    if (D.SPECIAL_UNITS[cls]) return L(D.SPECIAL_UNITS[cls].names[0]);
    if (cls === "unique") return unitName("unique");
    return cls;
  }
  function anyUnitIcon(cls) {
    if (D.UNITS[cls]) return D.UNITS[cls].icon;
    if (D.SPECIAL_UNITS[cls]) return D.SPECIAL_UNITS[cls].icon;
    return unitIcon(cls);
  }

  function allClasses() {
    return D.UNIT_CLASSES.concat(state.civ ? ["unique"] : []);
  }

  // ---------------- 開始畫面 ----------------

  function renderTitle() {
    destroyScene();
    app.innerHTML = "";
    var saved = Core.load();
    var diffs = ["easy", "normal", "hard"];
    var box = el("div", { class: "jm-title" }, [
      el("div", { class: "jm-title-art" }, [el("div", { class: "jm-title-sun" }), el("div", { class: "jm-title-hill" }), el("div", { class: "jm-title-house" })]),
      el("h1", { class: "jm-title-name", text: t("jm_title") }),
      el("p", { class: "jm-title-sub", text: t("jm_subtitle") }),
      el("p", { class: "jm-intro", text: t("jm_intro") }),
      el("ul", { class: "jm-intro-list" }, [
        el("li", { text: t("jm_intro_1") }),
        el("li", { text: t("jm_intro_2") }),
        el("li", { text: t("jm_intro_3") }),
        el("li", { text: t("jm_intro_4") }),
      ]),
      el("div", { class: "jm-age-strip" }, D.AGES.map(function (a, i) {
        return el("span", { class: "jm-age-chip" }, [el("b", { text: L(a.name) }), a.popToNext ? el("small", { text: "→ " + fmt(a.popToNext) }) : el("small", { text: "🏆" })]);
      })),
      el("div", { class: "jm-title-row" }, [
        el("span", { text: t("jm_difficulty") }),
        el(
          "div",
          { class: "jm-seg" },
          diffs.map(function (d) {
            return el("button", { type: "button", class: "jm-seg-btn" + (ui.difficulty === d ? " jm-on" : ""), onclick: function () {
              ui.difficulty = d;
              renderTitle();
            } }, [t("jm_diff_" + d)]);
          })
        ),
      ]),
      el("div", { class: "jm-title-row" }, [
        saved ? el("button", { type: "button", class: "jm-primary", onclick: function () {
          startGame(saved, true);
        } }, [t("jm_continue", { age: L(D.AGES[saved.age].name), pop: Core.population(saved) })]) : null,
        el("button", { type: "button", class: saved ? "jm-secondary" : "jm-primary", onclick: function () {
          if (saved && !window.confirm(t("jm_new_confirm"))) return;
          Core.clearSave();
          startGame(Core.newState(ui.difficulty), false);
        } }, [t("jm_new_game")]),
      ]),
    ]);
    app.appendChild(box);
  }

  // ---------------- 遊戲主畫面 ----------------

  var loopTimer = null;
  var uiTimer = null;
  var saveTimer = null;
  var lastTick = 0;

  function startGame(s, resumed) {
    state = s;
    state.paused = false;
    if (!state.speed) state.speed = 1;
    var offline = resumed ? Core.catchUp(state) : null;
    ui.toastSeen = state.log.length ? state.log[0].id || 0 : 0;
    buildLayout();
    initScene();
    if (offline && offline.seconds > 0) openModal("offline", offline);
    lastTick = performance.now();
    clearInterval(loopTimer);
    clearInterval(uiTimer);
    clearInterval(saveTimer);
    loopTimer = setInterval(tick, 100);
    uiTimer = setInterval(refresh, 250);
    saveTimer = setInterval(function () {
      Core.save(state);
    }, 10000);
    refresh(true);
  }

  function tick() {
    var now = performance.now();
    var real = Math.min(1, (now - lastTick) / 1000);
    lastTick = now;
    if (!state || state.paused || ui.modal === "victory") return;
    var game = real * state.speed;
    while (game > 0) {
      var dt = Math.min(0.5, game);
      Core.step(state, dt);
      game -= dt;
    }
    if (state.victory && !state.victoryShown) {
      state.victoryShown = true;
      openModal("victory");
    }
  }

  function buildLayout() {
    app.innerHTML = "";
    ui.top = el("div", { class: "jm-top" });
    ui.view = el("div", { class: "jm-view" });
    ui.overlay = el("div", { class: "jm-overlay" });
    ui.view.appendChild(ui.overlay);
    ui.tabs = el("div", { class: "jm-tabs" });
    ui.panel = el("div", { class: "jm-panel" });
    ui.toasts = el("div", { class: "jm-toasts" });
    ui.modalRoot = el("div", { class: "jm-modal-root" });
    var side = el("div", { class: "jm-side" }, [ui.tabs, ui.panel]);
    var main = el("div", { class: "jm-main" }, [ui.view, side]);
    app.appendChild(el("div", { class: "jm-game" }, [ui.top, main, ui.toasts, ui.modalRoot]));
    renderTop();
    renderOverlay();
    renderTabs();
    ui.sig = "";
  }

  function initScene() {
    destroyScene();
    if (!Scene3D || !Scene3D.supported()) {
      ui.view.classList.add("jm-no3d");
      ui.view.insertBefore(el("div", { class: "jm-no3d-msg", text: t("jm_no3d") }), ui.overlay);
      return;
    }
    var loadingNode = el("div", { class: "jm-loading", text: t("jm_loading3d") });
    ui.view.insertBefore(loadingNode, ui.overlay);
    Scene3D.load(app.getAttribute("data-three-src"))
      .then(function () {
        if (!state) return;
        if (loadingNode.parentNode) loadingNode.parentNode.removeChild(loadingNode);
        scene = Scene3D.create(ui.view);
        ui.view.insertBefore(scene.renderer.domElement, ui.overlay);
        scene.setAutoRotate(ui.autoRotate);
        pushView();
      })
      .catch(function () {
        loadingNode.textContent = t("jm_no3d");
      });
  }

  function destroyScene() {
    if (scene) {
      scene.dispose();
      scene = null;
    }
  }

  function viewModel() {
    var rt = Core.rates(state);
    var exps = state.expeditions.map(function (ex) {
      var classes = [];
      Object.keys(ex.army).forEach(function (c) {
        if (ex.army[c] > 0) classes.push(c);
      });
      return { id: ex.id, phase: ex.phase, frac: 1 - ex.t / ex.total, angle: ex.angle, n: Core.sumArmy(ex.army), classes: classes.length ? classes : ["spear"] };
    });
    var raid = null;
    if (state.raid) {
      raid = { frac: 1 - state.raid.t / state.raid.total, angle: state.raid.angle, n: Core.sumArmy(state.raid.army), classes: Object.keys(state.raid.army) };
    }
    return {
      age: state.age,
      sky: D.AGES[state.age].sky,
      civColor: civColorHex(),
      buildings: state.buildings,
      wallLevel: state.wallLevel,
      landmarks: state.landmarks.map(function (id) {
        var lm = D.landmark(id);
        return lm ? lm.model : "x";
      }),
      houses: state.buildings.house,
      workers: rt.workers,
      villagers: state.villagers,
      soldiers: state.soldiers,
      uniqueBase: uniqueBase(),
      expeditions: exps,
      raid: raid,
      timeOfDay: (state.time / DAY_LENGTH + 0.08) % 1,
      speed: state.speed,
      paused: state.paused,
    };
  }

  function pushView() {
    if (scene) scene.update(viewModel());
  }

  // ---------------- 上方列 ----------------

  function renderTop() {
    var top = ui.top;
    top.innerHTML = "";
    var ageName = el("div", { class: "jm-age-name" });
    dyn(ageName, function (n) {
      var a = D.AGES[state.age];
      n.textContent = L(a.name);
      n.title = L(a.era);
    });
    var popText = el("div", { class: "jm-pop-text" });
    dyn(popText, function (n) {
      var a = D.AGES[state.age];
      var pop = Core.population(state);
      n.textContent = a.popToNext ? t("jm_pop_progress", { pop: pop, need: a.popToNext }) : t("jm_pop_final", { pop: pop });
    });
    var ageBox = el("div", { class: "jm-age-box" }, [
      ageName,
      popText,
      bar(function () {
        var a = D.AGES[state.age];
        return a.popToNext ? Core.population(state) / a.popToNext : 1;
      }, "jm-bar-age"),
    ]);
    var resBox = el("div", { class: "jm-res-box" });
    D.RESOURCES.forEach(function (r) {
      var amt = el("b");
      var rate = el("small");
      var chip = el("div", { class: "jm-res", title: t("jm_res_" + r) }, [el("span", { class: "jm-res-icon", text: D.RESOURCE_ICONS[r] }), amt, rate]);
      dyn(chip, function () {
        var rt = Core.rates(state);
        amt.textContent = fmt(state.res[r]);
        rate.textContent = fmtRate(rt.net[r]) + "/s";
        rate.className = rt.net[r] < 0 ? "jm-neg" : "";
        chip.classList.toggle("jm-dim", r === "gold" && state.age < D.GOLD_AGE);
      });
      resBox.appendChild(chip);
    });
    var popChip = el("div", { class: "jm-res", title: t("jm_housing") }, [el("span", { class: "jm-res-icon", text: "👥" }), el("b"), el("small")]);
    dyn(popChip, function (n) {
      var pop = Core.population(state);
      var cap = Core.housing(state);
      n.children[1].textContent = fmt(pop);
      n.children[2].textContent = "/ " + fmt(cap);
      n.classList.toggle("jm-warn", pop >= cap);
    });
    resBox.appendChild(popChip);

    var speedBox = el("div", { class: "jm-speed" });
    var pauseBtn = el("button", { type: "button", class: "jm-speed-btn", onclick: function () {
      state.paused = !state.paused;
      refresh(true);
    } });
    dyn(pauseBtn, function (n) {
      n.textContent = state.paused ? "▶" : "⏸";
      n.title = state.paused ? t("jm_resume") : t("jm_pause");
      n.classList.toggle("jm-on", !!state.paused);
    });
    speedBox.appendChild(pauseBtn);
    SPEEDS.forEach(function (s) {
      var b = el("button", { type: "button", class: "jm-speed-btn", onclick: function () {
        state.speed = s;
        state.paused = false;
      } }, [s + "×"]);
      dyn(b, function (n) {
        n.classList.toggle("jm-on", state.speed === s && !state.paused);
      });
      speedBox.appendChild(b);
    });
    var clock = el("span", { class: "jm-clock" });
    dyn(clock, function (n) {
      var tod = (state.time / DAY_LENGTH + 0.08) % 1;
      n.textContent = (tod > 0.02 && tod < 0.48 ? "☀️ " : "🌙 ") + fmtTime(state.time);
    });
    speedBox.appendChild(clock);
    speedBox.appendChild(el("button", { type: "button", class: "jm-speed-btn", title: t("jm_help"), onclick: function () {
      openModal("help");
    } }, ["?"]));
    speedBox.appendChild(el("button", { type: "button", class: "jm-speed-btn", title: t("jm_menu"), onclick: function () {
      openModal("menu");
    } }, ["☰"]));
    top.appendChild(ageBox);
    top.appendChild(resBox);
    top.appendChild(speedBox);
  }

  // ---------------- 3D 畫面上的疊層 ----------------

  function renderOverlay() {
    var ov = ui.overlay;
    ov.innerHTML = "";
    var raid = el("div", { class: "jm-raid-alert" });
    dyn(raid, function (n) {
      if (!state.raid) {
        n.style.display = "none";
        return;
      }
      n.style.display = "";
      n.textContent = t("jm_raid_alert", { name: state.raid.name, n: Core.sumArmy(state.raid.army), s: Math.ceil(state.raid.t) });
    });
    var ageUp = el("div", { class: "jm-ageup-alert" });
    dyn(ageUp, function (n) {
      if (!state.ageUp) {
        n.style.display = "none";
        return;
      }
      n.style.display = "";
      n.textContent = t("jm_ageup_progress", { name: D.AGES[state.age + 1].name, s: Math.ceil(state.ageUp.t) });
    });
    var starve = el("div", { class: "jm-starve-alert", text: t("jm_starving") });
    dyn(starve, function (n) {
      n.style.display = state.starving ? "" : "none";
    });
    var cam = el("div", { class: "jm-cam" }, [
      el("button", { type: "button", title: t("jm_cam_reset"), onclick: function () {
        if (scene) scene.resetView();
      } }, ["⌂"]),
      el("button", { type: "button", title: t("jm_cam_rotate"), onclick: function (e) {
        ui.autoRotate = !ui.autoRotate;
        if (scene) scene.setAutoRotate(ui.autoRotate);
        e.currentTarget.classList.toggle("jm-on", ui.autoRotate);
      } }, ["⟳"]),
    ]);
    var hint = el("div", { class: "jm-cam-hint", text: t("jm_cam_hint") });
    ov.appendChild(el("div", { class: "jm-alerts" }, [raid, ageUp, starve]));
    ov.appendChild(cam);
    ov.appendChild(hint);
  }

  // ---------------- 分頁 ----------------

  var TABS = ["village", "build", "tech", "army", "expedition", "log"];

  function renderTabs() {
    ui.tabs.innerHTML = "";
    TABS.forEach(function (id) {
      var b = el("button", { type: "button", class: "jm-tab" + (ui.tab === id ? " jm-on" : ""), onclick: function () {
        ui.tab = id;
        renderTabs();
        refresh(true);
      } }, [t("jm_tab_" + id)]);
      if (id === "expedition") {
        var badge = el("span", { class: "jm-badge" });
        dyn(badge, function (n) {
          var k = state.expeditions.length;
          n.textContent = k ? String(k) : "";
          n.style.display = k ? "" : "none";
        });
        b.appendChild(badge);
      }
      if (id === "log") {
        var badge2 = el("span", { class: "jm-badge jm-badge-bad" });
        dyn(badge2, function (n) {
          n.textContent = state.raid ? "!" : "";
          n.style.display = state.raid ? "" : "none";
        });
        b.appendChild(badge2);
      }
      ui.tabs.appendChild(b);
    });
  }

  function panelSig() {
    var s = [ui.tab, state.age, state.civ, lang(), !!state.ageUp];
    if (ui.tab === "village") s.push(state.buildings.market > 0, state.age >= D.GOLD_AGE);
    if (ui.tab === "build") s.push(state.constructing.length, state.wallLevel, !!state.wallBuild);
    if (ui.tab === "tech") s.push(Object.keys(state.techs).length, state.researching.length);
    if (ui.tab === "army")
      s.push(
        D.BUILDINGS.map(function (b) {
          return state.buildings[b.id] > 0 ? 1 : 0;
        }).join("")
      );
    if (ui.tab === "expedition")
      s.push(
        state.expeditions
          .map(function (e) {
            return e.id + e.phase;
          })
          .join(","),
        D.TARGETS.map(function (tg) {
          var ts = state.targets[tg.id];
          return (Core.targetAvailable(state, tg.id) ? 1 : 0) + ":" + ts.level;
        }).join(",")
      );
    if (ui.tab === "log") s.push(state.reports.length ? state.reports[0].time : 0, state.log.length ? state.log[0].t : 0);
    return s.join("|");
  }

  function refresh(force) {
    if (!state) return;
    var sig = panelSig();
    if (force || sig !== ui.sig) {
      ui.sig = sig;
      // 只重畫面板：上方列與疊層的更新函式保留
      ui.updaters = ui.updaters.filter(function (u) {
        return !ui.panel.contains(u.node);
      });
      var scroll = ui.panel.scrollTop;
      ui.panel.innerHTML = "";
      ui.panel.appendChild(renderPanel());
      ui.panel.scrollTop = scroll;
    }
    ui.updaters = ui.updaters.filter(function (u) {
      return document.body.contains(u.node);
    });
    ui.updaters.forEach(function (u) {
      u.fn(u.node);
    });
    if (state.justAged) {
      state.justAged = false;
      renderTabs();
    }
    showToasts();
    pushView();
  }

  function renderPanel() {
    switch (ui.tab) {
      case "build":
        return renderBuild();
      case "tech":
        return renderTech();
      case "army":
        return renderArmy();
      case "expedition":
        return renderExpedition();
      case "log":
        return renderLog();
      default:
        return renderVillage();
    }
  }

  function section(title, children, extra) {
    return el("section", { class: "jm-sec" + (extra ? " " + extra : "") }, [title ? el("h3", { text: title }) : null].concat(children));
  }

  // ---------------- 村落分頁 ----------------

  function renderVillage() {
    var wrap = el("div");
    // 升時代
    var a = D.AGES[state.age];
    var ageChildren = [];
    if (a.popToNext) {
      var next = D.AGES[state.age + 1];
      ageChildren.push(el("p", { class: "jm-muted", text: t("jm_next_age", { name: next.name, pop: a.popToNext }) }));
      var reqPop = el("div", { class: "jm-req" });
      dyn(reqPop, function (n) {
        var pop = Core.population(state);
        n.textContent = (pop >= a.popToNext ? "✅ " : "⬜ ") + t("jm_req_pop", { pop: pop, need: a.popToNext });
      });
      ageChildren.push(reqPop);
      var st = Core.ageUpStatus(state);
      ageChildren.push(el("div", { class: "jm-req" }, [t("jm_req_cost") + " ", costView(st.cost)]));
      if (st.needCiv) ageChildren.push(el("p", { class: "jm-note", text: t("jm_civ_notice") }));
      if (state.ageUp) {
        ageChildren.push(bar(function () {
          return state.ageUp ? 1 - state.ageUp.t / state.ageUp.total : 1;
        }));
        ageChildren.push(el("p", { class: "jm-muted", text: t("jm_ageup_landmark", { name: D.landmark(state.ageUp.landmark).name }) }));
      } else {
        ageChildren.push(button(t("jm_ageup_btn", { name: next.name }), function () {
          openModal("ageup");
        }, { cls: "jm-primary jm-wide", enabled: function () {
          return Core.ageUpStatus(state).ok;
        } }));
      }
    } else {
      ageChildren.push(el("p", { class: "jm-good", text: t("jm_final_age") }));
    }
    var civLine = state.civ ? el("p", { class: "jm-civ-line" }, [D.civ(state.civ).icon + " " + t("jm_civ_label") + "：", el("b", { text: L(D.civ(state.civ).name) })]) : null;
    wrap.appendChild(section(L(a.name) + " · " + L(a.era), [civLine].concat(ageChildren), "jm-sec-age"));

    // 村民
    var vilInfo = el("div", { class: "jm-kv" });
    dyn(vilInfo, function (n) {
      var m = Core.mods(state);
      var room = Core.room(state, m);
      var lines = [
        [t("jm_villagers"), fmt(state.villagers)],
        [t("jm_soldiers"), fmt(Core.soldiersHome(state)) + (Core.soldiersAway(state) ? " (+" + fmt(Core.soldiersAway(state)) + " " + t("jm_away") + ")" : "")],
        [t("jm_housing"), fmt(Core.population(state)) + " / " + fmt(Core.housing(state, m))],
        [t("jm_vil_rate"), (state.autoVillagers ? Core.villagerRate(state, m).toFixed(2) : "0") + "/s · " + D.RESOURCE_ICONS.food + Core.villagerCost(state)],
        [t("jm_birth_rate"), Core.birthRate(state, m).toFixed(2) + "/s"],
      ];
      n.innerHTML = "";
      lines.forEach(function (l) {
        n.appendChild(el("div", {}, [el("span", { text: l[0] }), el("b", { text: l[1] })]));
      });
      if (room <= 0) n.appendChild(el("div", { class: "jm-warn-line", text: t("jm_housing_full") }));
    });
    var auto = el("input", { type: "checkbox", onchange: function (e) {
      state.autoVillagers = e.target.checked;
    } });
    auto.checked = state.autoVillagers;
    wrap.appendChild(section(t("jm_sec_villagers"), [vilInfo, el("label", { class: "jm-check" }, [auto, " " + t("jm_auto_villagers")])]));

    // 工作分配
    var allocRows = el("div", { class: "jm-alloc" });
    D.RESOURCES.forEach(function (r) {
      var locked = r === "gold" && state.age < D.GOLD_AGE;
      var range = el("input", { type: "range", min: "0", max: "100", step: "1", value: String(state.alloc[r]), disabled: locked || null, oninput: function (e) {
        state.alloc[r] = parseInt(e.target.value, 10) || 0;
      } });
      var info = el("div", { class: "jm-alloc-info" });
      dyn(info, function (n) {
        if (locked) {
          n.textContent = t("jm_gold_locked");
          return;
        }
        var rt = Core.rates(state);
        var eff = rt.eff[r];
        n.textContent = t("jm_alloc_info", { n: Math.round(rt.workers[r]), rate: fmtRate(rt.gross[r]), eff: pct(eff) });
        n.classList.toggle("jm-warn", eff < 0.95);
      });
      allocRows.appendChild(el("div", { class: "jm-alloc-row" + (locked ? " jm-dim" : "") }, [el("span", { class: "jm-alloc-label", text: D.RESOURCE_ICONS[r] + " " + t("jm_res_" + r) }), range, info]));
    });
    var presets = el("div", { class: "jm-btn-row" });
    [
      ["jm_preset_balance", { food: 50, wood: 25, stone: 12, gold: 13 }],
      ["jm_preset_food", { food: 75, wood: 15, stone: 5, gold: 5 }],
      ["jm_preset_wood", { food: 40, wood: 50, stone: 5, gold: 5 }],
      ["jm_preset_mine", { food: 40, wood: 15, stone: 22, gold: 23 }],
    ].forEach(function (p) {
      presets.appendChild(button(t(p[0]), function () {
        state.alloc = { food: p[1].food, wood: p[1].wood, stone: p[1].stone, gold: p[1].gold };
        refresh(true);
      }, { cls: "jm-btn jm-small" }));
    });
    var foodNote = el("p", { class: "jm-muted jm-small" });
    dyn(foodNote, function (n) {
      var rt = Core.rates(state);
      n.textContent = t("jm_upkeep_note", { up: fmt(rt.upkeep), farm: Math.round(rt.farmers), cap: Math.round(rt.caps.paddy) }) + (rt.trade > 0 ? " " + t("jm_trade_note", { g: fmtRate(rt.trade) }) : "");
    });
    wrap.appendChild(section(t("jm_sec_alloc"), [el("p", { class: "jm-muted jm-small", text: t("jm_alloc_hint") }), allocRows, presets, foodNote]));

    // 市集
    if (state.buildings.market > 0) wrap.appendChild(renderMarket());

    // 統計
    var stats = el("div", { class: "jm-kv jm-small" });
    dyn(stats, function (n) {
      var s = state.stats;
      n.innerHTML = "";
      [
        [t("jm_stat_peak"), fmt(s.peakPop)],
        [t("jm_stat_conquests"), fmt(s.conquests)],
        [t("jm_stat_kills"), fmt(s.kills)],
        [t("jm_stat_raids"), s.raidsWon + " / " + s.raidsLost],
        [t("jm_stat_captives"), fmt(s.captives)],
        [t("jm_stat_lost"), fmt(s.lost)],
      ].forEach(function (l) {
        n.appendChild(el("div", {}, [el("span", { text: l[0] }), el("b", { text: l[1] })]));
      });
    });
    wrap.appendChild(section(t("jm_sec_stats"), [stats]));
    return wrap;
  }

  function renderMarket() {
    var avail = D.RESOURCES.filter(function (r) {
      return r !== "gold" || state.age >= D.GOLD_AGE;
    });
    function sel(val, onchange) {
      var s = el(
        "select",
        { onchange: onchange },
        avail.map(function (r) {
          return el("option", { value: r, selected: r === val || null }, [D.RESOURCE_ICONS[r] + " " + t("jm_res_" + r)]);
        })
      );
      return s;
    }
    var from = sel(ui.tradeFrom, function (e) {
      ui.tradeFrom = e.target.value;
    });
    var to = sel(ui.tradeTo, function (e) {
      ui.tradeTo = e.target.value;
    });
    var quote = el("div", { class: "jm-muted jm-small" });
    dyn(quote, function (n) {
      n.textContent = t("jm_market_quote", { fee: pct(Core.marketFee(state)), a: 100, from: t("jm_res_" + ui.tradeFrom), b: Core.tradeQuote(state, ui.tradeFrom, ui.tradeTo, 100), to: t("jm_res_" + ui.tradeTo) });
    });
    var btns = el("div", { class: "jm-btn-row" });
    [
      ["100", function () {
        return 100;
      }],
      ["1000", function () {
        return 1000;
      }],
      ["10%", function () {
        return state.res[ui.tradeFrom] * 0.1;
      }],
      ["50%", function () {
        return state.res[ui.tradeFrom] * 0.5;
      }],
    ].forEach(function (p) {
      btns.appendChild(button(p[0], function () {
        var got = Core.trade(state, ui.tradeFrom, ui.tradeTo, p[1]());
        if (got > 0) toast(t("jm_market_done", { n: got, res: t("jm_res_" + ui.tradeTo) }), "info");
      }, { cls: "jm-btn jm-small", enabled: function () {
        return ui.tradeFrom !== ui.tradeTo && state.res[ui.tradeFrom] >= 1;
      } }));
    });
    return section(t("jm_sec_market"), [el("div", { class: "jm-trade" }, [from, el("span", { text: "→" }), to]), quote, btns]);
  }

  // ---------------- 建造分頁 ----------------

  function renderBuild() {
    var wrap = el("div");
    if (state.constructing.length || state.wallBuild) {
      var q = el("div", { class: "jm-queue" });
      state.constructing.forEach(function (c) {
        q.appendChild(el("div", { class: "jm-queue-item" }, [
          el("span", { text: D.building(c.id).icon + " " + L(D.building(c.id).name) + " ×" + c.n }),
          bar(function () {
            return 1 - c.t / c.total;
          }),
        ]));
      });
      if (state.wallBuild) {
        var wb = state.wallBuild;
        q.appendChild(el("div", { class: "jm-queue-item" }, [
          el("span", { text: "🧱 " + L(D.WALL_LEVELS[state.wallLevel + 1].name) }),
          bar(function () {
            return state.wallBuild ? 1 - wb.t / wb.total : 1;
          }),
        ]));
      }
      wrap.appendChild(section(t("jm_sec_constructing"), [q]));
    }
    var list = el("div", { class: "jm-cards" });
    D.BUILDINGS.forEach(function (bd) {
      var locked = state.age < bd.age;
      var count = el("span", { class: "jm-count" });
      dyn(count, function (n) {
        var built = state.buildings[bd.id];
        var all = Core.buildingCount(state, bd.id);
        var lim = Core.buildingLimit(state, bd.id);
        n.textContent = "×" + fmt(built) + (all > built ? " (+" + (all - built) + ")" : "") + (lim !== Infinity ? " / " + lim : "");
      });
      var extra = el("div", { class: "jm-muted jm-small" });
      dyn(extra, function (n) {
        n.textContent = buildingExtra(bd.id);
      });
      var btns = el("div", { class: "jm-btn-row" });
      if (!locked) {
        [1, 5, 25].forEach(function (k) {
          btns.appendChild(button("+" + k, function () {
            Core.build(state, bd.id, k);
            refresh(true);
          }, { cls: "jm-btn jm-small", enabled: function () {
            return Core.canBuild(state, bd.id) && Core.canAfford(state, Core.buildingCost(state, bd.id));
          } }));
        });
        btns.appendChild(button(t("jm_max"), function () {
          Core.build(state, bd.id, Core.maxAffordable(state, Core.buildingCost(state, bd.id)));
          refresh(true);
        }, { cls: "jm-btn jm-small", enabled: function () {
          return Core.canBuild(state, bd.id) && Core.canAfford(state, Core.buildingCost(state, bd.id));
        } }));
      }
      list.appendChild(el("div", { class: "jm-card" + (locked ? " jm-locked" : "") }, [
        el("div", { class: "jm-card-head" }, [el("span", { class: "jm-card-icon", text: bd.icon }), el("b", { text: L(bd.name) }), count]),
        el("div", { class: "jm-small", text: L(bd.desc) }),
        locked ? el("div", { class: "jm-muted jm-small", text: t("jm_unlock_age", { name: D.AGES[bd.age].name }) }) : el("div", { class: "jm-card-cost" }, [costView(Core.buildingCost(state, bd.id))]),
        extra,
        btns,
      ]));
    });
    wrap.appendChild(section(t("jm_sec_buildings"), [list]));

    // 柵
    var wl = D.WALL_LEVELS;
    var cur = state.wallLevel > 0 ? L(wl[state.wallLevel].name) : t("jm_wall_none");
    var next = wl[state.wallLevel + 1];
    var wallChildren = [el("p", {}, [t("jm_wall_current") + "：", el("b", { text: cur }), " · " + t("jm_wall_def", { p: pct(state.wallLevel * Core.WALL_DEF) })])];
    if (next) {
      if (state.age < next.age) wallChildren.push(el("p", { class: "jm-muted", text: t("jm_wall_next_locked", { name: next.name, age: D.AGES[next.age].name }) }));
      else {
        wallChildren.push(el("div", { class: "jm-req" }, [t("jm_wall_next", { name: next.name }) + " ", costView(next.cost)]));
        wallChildren.push(button(t("jm_wall_build"), function () {
          Core.buildWall(state);
          refresh(true);
        }, { cls: "jm-btn", enabled: function () {
          return Core.canWall(state);
        } }));
      }
    }
    wrap.appendChild(section(t("jm_sec_wall"), wallChildren));
    return wrap;
  }

  function buildingExtra(id) {
    var m = Core.mods(state);
    var rt = Core.rates(state, m);
    var a = D.AGES[state.age];
    switch (id) {
      case "house":
        return t("jm_extra_house", { n: Math.floor(a.houseCap * (1 + Core.mod(m, "housing"))) });
      case "tc":
        return t("jm_extra_tc", { b: a.tcBatch, rate: Core.villagerRate(state, m).toFixed(2) });
      case "foodcamp":
        return t("jm_extra_camp", { w: Math.round(rt.workers.food), cap: Math.round(rt.caps.food), eff: pct(rt.eff.food) });
      case "woodcamp":
        return t("jm_extra_camp", { w: Math.round(rt.workers.wood), cap: Math.round(rt.caps.wood), eff: pct(rt.eff.wood) });
      case "minecamp":
        return t("jm_extra_camp", { w: Math.round(rt.workers.stone + rt.workers.gold), cap: Math.round(rt.caps.mine), eff: pct(rt.eff.stone) });
      case "paddy":
        return t("jm_extra_paddy", { w: Math.round(rt.farmers), cap: Math.round(rt.caps.paddy) });
      case "tower":
        return t("jm_extra_tower", { n: state.buildings.tower * Core.TOWER_ARCHERS });
      default:
        return "";
    }
  }

  // ---------------- 研究分頁 ----------------

  function renderTech() {
    var wrap = el("div");
    if (state.researching.length) {
      var q = el("div", { class: "jm-queue" });
      state.researching.forEach(function (r) {
        q.appendChild(el("div", { class: "jm-queue-item" }, [
          el("span", { text: "🔬 " + L(D.tech(r.id).name) }),
          bar(function () {
            return 1 - r.t / r.total;
          }),
        ]));
      });
      wrap.appendChild(section(t("jm_sec_researching"), [q]));
    }
    var maxAge = Math.min(state.age + 1, D.AGES.length - 1);
    for (var ag = 0; ag <= maxAge; ag++) {
      var techs = D.TECHS.filter(function (tc) {
        return tc.age === ag && (!tc.civ || tc.civ === state.civ);
      });
      if (!techs.length) continue;
      var cards = el("div", { class: "jm-cards" });
      techs.forEach(function (tc) {
        var done = !!state.techs[tc.id];
        var busy = state.researching.some(function (r) {
          return r.id === tc.id;
        });
        var locked = state.age < tc.age;
        var card = el("div", { class: "jm-card" + (done ? " jm-done" : "") + (locked ? " jm-locked" : "") }, [
          el("div", { class: "jm-card-head" }, [el("b", { text: (tc.civ ? "★ " : "") + L(tc.name) }), done ? el("span", { class: "jm-good", text: "✓" }) : null]),
          el("div", { class: "jm-small", text: L(tc.desc) }),
        ]);
        if (!done && !busy && !locked) {
          card.appendChild(el("div", { class: "jm-card-cost" }, [costView(Core.techCost(state, tc.id)), el("span", { class: "jm-muted jm-small", text: " ⏱" + Math.round(tc.time / (1 + Core.mod(Core.mods(state), "researchSpeed"))) + "s" })]));
          card.appendChild(button(t("jm_research"), function () {
            Core.research(state, tc.id);
            refresh(true);
          }, { cls: "jm-btn jm-small", enabled: function () {
            return Core.techAvailable(state, tc.id) && Core.canAfford(state, Core.techCost(state, tc.id));
          } }));
        } else if (busy) card.appendChild(el("div", { class: "jm-muted jm-small", text: t("jm_researching") }));
        cards.appendChild(card);
      });
      var title = L(D.AGES[ag].name) + (ag > state.age ? " · " + t("jm_preview") : "");
      wrap.appendChild(section(title, [cards]));
    }
    // 已生效的加成總覽
    var m = Core.mods(state);
    var keys = Object.keys(m).filter(function (k) {
      return Math.abs(m[k]) > 1e-9;
    });
    if (keys.length) {
      keys.sort();
      wrap.appendChild(section(t("jm_sec_bonuses"), [el("div", { class: "jm-bonus-list" }, keys.map(function (k) {
        return el("span", { class: "jm-bonus" }, [modLabel(k) + " " + (m[k] > 0 ? "+" : "") + pct(m[k])]);
      }))]));
    }
    return wrap;
  }

  function modLabel(k) {
    var parts = k.split(".");
    if (parts.length === 2) {
      var what = parts[1] === "all" ? t("jm_mod_all") : D.RESOURCES.indexOf(parts[1]) >= 0 ? t("jm_res_" + parts[1]) : anyUnitName(parts[1], state.age);
      return t("jm_mod_" + parts[0], { what: what });
    }
    return t("jm_mod_" + k);
  }

  // ---------------- 軍事分頁 ----------------

  function renderArmy() {
    var wrap = el("div");
    var cards = el("div", { class: "jm-cards" });
    allClasses().forEach(function (cls) {
      var u = Core.unitDef(state, cls);
      if (!u) return;
      var lockedAge = state.age < u.age;
      var lockedB = state.buildings[u.building] <= 0;
      var info = el("div", { class: "jm-small" });
      dyn(info, function (n) {
        var s = Core.unitStats(state, cls);
        n.textContent = t("jm_unit_stats", { atk: s.atk.toFixed(1), hp: Math.round(s.hp) }) + " · " + L(u.note);
      });
      var count = el("span", { class: "jm-count" });
      dyn(count, function (n) {
        var q = state.trainQueue[cls] || 0;
        n.textContent = "×" + fmt(state.soldiers[cls] || 0) + (q ? " (+" + fmt(q) + ")" : "");
      });
      var card = el("div", { class: "jm-card" + (lockedAge || lockedB ? " jm-locked" : "") + (cls === "unique" ? " jm-unique" : "") }, [
        el("div", { class: "jm-card-head" }, [el("span", { class: "jm-card-icon", text: u.icon }), el("b", { text: L(u.name) }), count]),
        info,
      ]);
      if (lockedAge) card.appendChild(el("div", { class: "jm-muted jm-small", text: t("jm_unlock_age", { name: D.AGES[u.age].name }) }));
      else if (lockedB) card.appendChild(el("div", { class: "jm-muted jm-small", text: t("jm_need_building", { name: D.building(u.building).name }) }));
      else {
        var rate = el("span", { class: "jm-muted jm-small" });
        dyn(rate, function (n) {
          n.textContent = " · " + t("jm_train_rate", { r: Core.trainRate(state, cls).toFixed(2) });
        });
        card.appendChild(el("div", { class: "jm-card-cost" }, [costView(Core.unitCost(state, cls)), rate]));
        var btns = el("div", { class: "jm-btn-row" });
        [1, 10, 100].forEach(function (k) {
          btns.appendChild(button("+" + k, function () {
            Core.train(state, cls, k);
          }, { cls: "jm-btn jm-small", enabled: function () {
            return Core.canAfford(state, Core.unitCost(state, cls));
          } }));
        });
        btns.appendChild(button(t("jm_max"), function () {
          Core.train(state, cls, Core.maxAffordable(state, Core.unitCost(state, cls)));
        }, { cls: "jm-btn jm-small", enabled: function () {
          return Core.canAfford(state, Core.unitCost(state, cls));
        } }));
        btns.appendChild(button(t("jm_cancel_queue"), function () {
          Core.cancelTrain(state, cls);
        }, { cls: "jm-btn jm-small jm-ghost", enabled: function () {
          return (state.trainQueue[cls] || 0) > 0;
        } }));
        card.appendChild(btns);
      }
      cards.appendChild(card);
    });
    var popNote = el("p", { class: "jm-muted jm-small" });
    dyn(popNote, function (n) {
      n.textContent = t("jm_army_note", { room: fmt(Core.room(state)) });
    });
    wrap.appendChild(section(t("jm_sec_train"), [popNote, cards]));

    // 防衛
    var def = el("div", { class: "jm-kv" });
    dyn(def, function (n) {
      var m = Core.mods(state);
      var defMul = state.wallLevel * Core.WALL_DEF + Core.mod(m, "defense");
      n.innerHTML = "";
      [
        [t("jm_def_home"), fmt(Core.soldiersHome(state))],
        [t("jm_def_militia"), fmt(Math.floor(state.villagers * 0.08))],
        [t("jm_def_towers"), fmt(state.buildings.tower * Core.TOWER_ARCHERS + state.buildings.tc * 2)],
        [t("jm_def_bonus"), "+" + pct(defMul)],
        [t("jm_def_next"), state.age < 1 ? t("jm_def_peace") : state.raid ? t("jm_def_incoming", { s: Math.ceil(state.raid.t) }) : state.nextRaid != null ? "~" + fmtTime(state.nextRaid) : "—"],
      ].forEach(function (l) {
        n.appendChild(el("div", {}, [el("span", { text: l[0] }), el("b", { text: l[1] })]));
      });
    });
    wrap.appendChild(section(t("jm_sec_defense"), [el("p", { class: "jm-muted jm-small", text: t("jm_defense_hint") }), def]));

    // 相剋表
    var tbl = el("div", { class: "jm-counter-list jm-small" }, D.UNIT_CLASSES.map(function (c) {
      return el("div", {}, [D.UNITS[c].icon + " " + anyUnitName(c, state.age) + "：" + L(D.UNITS[c].note)]);
    }));
    wrap.appendChild(section(t("jm_sec_counters"), [tbl]));
    return wrap;
  }

  // ---------------- 遠征分頁 ----------------

  function renderExpedition() {
    var wrap = el("div");
    if (state.expeditions.length) {
      var list = el("div", { class: "jm-queue" });
      state.expeditions.forEach(function (ex) {
        var tg = D.target(ex.target);
        var label = el("span");
        dyn(label, function (n) {
          n.textContent = tg.icon + " " + L(tg.name) + " · " + (ex.phase === "go" ? t("jm_exp_going") : t("jm_exp_returning")) + " · " + fmt(Core.sumArmy(ex.army)) + t("jm_people") + " · " + Math.ceil(ex.t) + "s";
        });
        var row = el("div", { class: "jm-queue-item" }, [label, bar(function () {
          return 1 - ex.t / ex.total;
        }, ex.phase === "go" ? "" : "jm-bar-back")]);
        if (ex.report) row.appendChild(el("div", { class: ex.report.win ? "jm-good jm-small" : "jm-bad jm-small", text: ex.report.win ? t("jm_exp_won_short") : t("jm_exp_lost_short") }));
        list.appendChild(row);
      });
      wrap.appendChild(section(t("jm_sec_active_exp"), [list]));
    }
    var cards = el("div", { class: "jm-cards" });
    D.TARGETS.forEach(function (tg) {
      if (tg.age > state.age + 1) return;
      var ts = Core.targetState(state, tg.id);
      var locked = tg.age > state.age;
      var army = Core.targetArmy(state, tg.id);
      var armyLine = el("div", { class: "jm-army-line" }, Object.keys(army).map(function (c) {
        return el("span", { class: "jm-army-chip", title: anyUnitName(c, tg.tier) }, [anyUnitIcon(c) + fmt(army[c])]);
      }));
      var reward = Core.targetReward(state, tg.id);
      var rewardLine = el("div", { class: "jm-small" }, [t("jm_exp_reward") + " "].concat(Object.keys(reward).map(function (r) {
        return el("span", { class: "jm-cost-item" }, [D.RESOURCE_ICONS[r] + fmt(reward[r])]);
      })).concat(tg.captives ? [el("span", { class: "jm-cost-item" }, ["👥~" + fmt(Math.floor(Core.sumArmy(army) * tg.captives))])] : []));
      var meta = el("div", { class: "jm-muted jm-small" });
      dyn(meta, function (n) {
        var parts = [t("jm_exp_level", { n: ts.level + 1 }), t("jm_exp_dist", { s: Math.round(tg.dist) })];
        if (tg.fort) parts.push(t("jm_exp_fort", { p: pct(tg.fort) }));
        if (ts.strength < 0.999) parts.push(t("jm_exp_weakened", { p: pct(ts.strength) }));
        if (ts.cooldown > 0) parts.push(t("jm_exp_cooldown", { s: Math.ceil(ts.cooldown) }));
        n.textContent = parts.join(" · ");
      });
      var card = el("div", { class: "jm-card" + (locked ? " jm-locked" : "") }, [
        el("div", { class: "jm-card-head" }, [el("span", { class: "jm-card-icon", text: tg.icon }), el("b", { text: L(tg.name) }), ts.wins ? el("span", { class: "jm-good jm-small", text: "🏳 ×" + ts.wins }) : null]),
        el("div", { class: "jm-small", text: L(tg.desc) }),
        armyLine,
        rewardLine,
        meta,
      ]);
      if (locked) card.appendChild(el("div", { class: "jm-muted jm-small", text: t("jm_unlock_age", { name: D.AGES[tg.age].name }) }));
      else
        card.appendChild(button(t("jm_exp_send"), function () {
          ui.army = {};
          openModal("expedition", tg.id);
        }, { cls: "jm-btn", enabled: function () {
          return Core.targetAvailable(state, tg.id) && Core.soldiersHome(state) > 0 && !state.expeditions.some(function (e) {
            return e.target === tg.id && e.phase === "go";
          });
        } }));
      cards.appendChild(card);
    });
    wrap.appendChild(section(t("jm_sec_targets"), [el("p", { class: "jm-muted jm-small", text: t("jm_exp_hint") }), cards]));
    return wrap;
  }

  // 自動編成：依兵種比例，找出「預估會贏且損失少於 40%」的最小兵力
  function autoArmy(targetId) {
    var home = {};
    allClasses().forEach(function (c) {
      if (state.soldiers[c] > 0) home[c] = state.soldiers[c];
    });
    var total = Core.sumArmy(home);
    if (!total) return {};
    function scaled(f) {
      var a = {};
      Object.keys(home).forEach(function (c) {
        a[c] = Math.max(0, Math.min(home[c], Math.ceil(home[c] * f)));
      });
      return a;
    }
    var full = Core.previewBattle(state, targetId, home);
    if (!full || !full.win) return home;
    var lo = 0;
    var hi = 1;
    for (var i = 0; i < 18; i++) {
      var mid = (lo + hi) / 2;
      var p = Core.previewBattle(state, targetId, scaled(mid));
      if (p && p.win && p.lost / Math.max(1, p.sent) < 0.4) hi = mid;
      else lo = mid;
    }
    return scaled(hi);
  }

  // ---------------- 紀錄分頁 ----------------

  function renderLog() {
    var wrap = el("div");
    if (state.reports.length) {
      var list = el("div", { class: "jm-report-list" });
      state.reports.forEach(function (rp, i) {
        list.appendChild(el("button", { type: "button", class: "jm-report-item " + (rp.win ? "jm-win" : "jm-lose"), onclick: function () {
          openModal("report", i);
        } }, [
          el("span", { text: (rp.kind === "raid" ? "🛡 " : "⚔ ") + L(rp.name) }),
          el("b", { text: rp.win ? t("jm_win") : t("jm_lose") }),
          el("small", { text: fmtTime(rp.time) }),
        ]));
      });
      wrap.appendChild(section(t("jm_sec_reports"), [list]));
    }
    var logList = el("ul", { class: "jm-log" }, state.log.map(function (e) {
      return el("li", { class: "jm-log-" + e.kind }, [el("small", { text: fmtTime(e.t) + " " }), t(e.key, e.params)]);
    }));
    wrap.appendChild(section(t("jm_sec_log"), [state.log.length ? logList : el("p", { class: "jm-muted", text: t("jm_log_empty") })]));
    return wrap;
  }

  // ---------------- 提示 ----------------

  function toast(text, kind, action) {
    var node = el("div", { class: "jm-toast jm-toast-" + (kind || "info") }, [el("span", { text: text })]);
    if (action) node.appendChild(el("button", { type: "button", class: "jm-btn jm-small", onclick: action.fn }, [action.label]));
    ui.toasts.appendChild(node);
    while (ui.toasts.children.length > 4) ui.toasts.removeChild(ui.toasts.firstChild);
    setTimeout(function () {
      node.classList.add("jm-toast-out");
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 400);
    }, action ? 7000 : 4200);
  }

  function showToasts() {
    var fresh = [];
    for (var i = 0; i < state.log.length; i++) {
      if ((state.log[i].id || 0) <= ui.toastSeen) break;
      fresh.push(state.log[i]);
    }
    if (state.log.length) ui.toastSeen = state.log[0].id || 0;
    fresh.reverse().forEach(function (e) {
      if (e.kind === "info" && e.key === "jm_log_built") return;
      var act = null;
      if (e.key === "jm_log_expedition_win" || e.key === "jm_log_expedition_lose" || e.key === "jm_log_raid_won" || e.key === "jm_log_raid_lost") {
        act = { label: t("jm_view_report"), fn: function () {
          openModal("report", 0);
        } };
      }
      toast(t(e.key, e.params), e.kind, act);
    });
  }

  // ---------------- 視窗 ----------------

  function openModal(kind, arg) {
    ui.modal = kind;
    ui.modalArg = arg;
    var root = ui.modalRoot;
    root.innerHTML = "";
    var box = el("div", { class: "jm-modal" });
    var close = function () {
      closeModal();
    };
    var content;
    switch (kind) {
      case "ageup":
        content = modalAgeUp(close);
        break;
      case "expedition":
        content = modalExpedition(arg, close);
        break;
      case "report":
        content = modalReport(state.reports[arg], close);
        break;
      case "offline":
        content = modalOffline(arg, close);
        break;
      case "victory":
        content = modalVictory(close);
        break;
      case "help":
        content = modalHelp(close);
        break;
      default:
        content = modalMenu(close);
    }
    box.appendChild(content);
    var back = el("div", { class: "jm-modal-back", onclick: function (e) {
      if (e.target === back && kind !== "victory") close();
    } }, [box]);
    root.appendChild(back);
  }

  function closeModal() {
    ui.modal = null;
    ui.modalRoot.innerHTML = "";
    ui.updaters = ui.updaters.filter(function (u) {
      return document.body.contains(u.node);
    });
    refresh(true);
  }

  function modalHead(title, close) {
    return el("div", { class: "jm-modal-head" }, [el("h2", { text: title }), close ? el("button", { type: "button", class: "jm-x", onclick: close }, ["×"]) : null]);
  }

  function modalAgeUp(close) {
    var st = Core.ageUpStatus(state);
    var next = D.AGES[state.age + 1];
    var opts = D.LANDMARKS[st.nextId] || [];
    var pick = { landmark: opts[0] && opts[0].id, civ: null };
    var wrap = el("div");
    wrap.appendChild(modalHead(t("jm_ageup_title", { name: next.name }), close));
    wrap.appendChild(el("p", { class: "jm-muted", text: t("jm_ageup_desc") }));
    var lmBox = el("div", { class: "jm-choice-grid" });
    function paintLm() {
      Array.prototype.forEach.call(lmBox.children, function (c) {
        c.classList.toggle("jm-on", c.getAttribute("data-id") === pick.landmark);
      });
    }
    opts.forEach(function (lm) {
      lmBox.appendChild(el("button", { type: "button", class: "jm-choice", "data-id": lm.id, onclick: function () {
        pick.landmark = lm.id;
        paintLm();
      } }, [el("b", { text: L(lm.name) }), el("span", { text: L(lm.desc) })]));
    });
    paintLm();
    wrap.appendChild(el("h3", { text: t("jm_choose_landmark") }));
    wrap.appendChild(lmBox);
    var civBox = null;
    if (st.needCiv) {
      civBox = el("div", { class: "jm-choice-grid jm-civ-grid" });
      var paintCiv = function () {
        Array.prototype.forEach.call(civBox.children, function (c) {
          c.classList.toggle("jm-on", c.getAttribute("data-id") === pick.civ);
        });
        confirmBtn.disabled = !pick.civ;
      };
      D.CIVS.forEach(function (cv) {
        civBox.appendChild(el("button", { type: "button", class: "jm-choice", "data-id": cv.id, style: "--jm-civ:#" + ("000000" + cv.color.toString(16)).slice(-6), onclick: function () {
          pick.civ = cv.id;
          paintCiv();
        } }, [
          el("b", { text: cv.icon + " " + L(cv.name) }),
          el("span", { text: L(cv.desc) }),
          el("span", { class: "jm-small" }, [t("jm_civ_unique") + "：", el("b", { text: cv.unique.icon + " " + L(cv.unique.name) }), " — " + L(cv.unique.note)]),
        ]));
      });
      wrap.appendChild(el("h3", { text: t("jm_choose_civ") }));
      wrap.appendChild(el("p", { class: "jm-muted jm-small", text: t("jm_choose_civ_desc") }));
      wrap.appendChild(civBox);
    }
    wrap.appendChild(el("div", { class: "jm-req" }, [t("jm_req_cost") + " ", costView(st.cost)]));
    var confirmBtn = el("button", { type: "button", class: "jm-primary jm-wide", onclick: function () {
      if (Core.startAgeUp(state, pick.landmark, pick.civ)) {
        toast(t("jm_ageup_started", { name: next.name }), "age");
        close();
      }
    } }, [t("jm_ageup_confirm")]);
    if (st.needCiv) confirmBtn.disabled = true;
    wrap.appendChild(confirmBtn);
    return wrap;
  }

  function modalExpedition(targetId, close) {
    var tg = D.target(targetId);
    var wrap = el("div");
    wrap.appendChild(modalHead(t("jm_exp_title", { name: tg.name }), close));
    var army = Core.targetArmy(state, targetId);
    wrap.appendChild(el("p", { class: "jm-small" }, [t("jm_exp_enemy") + " "].concat(Object.keys(army).map(function (c) {
      return el("span", { class: "jm-army-chip" }, [anyUnitIcon(c) + " " + anyUnitName(c, tg.tier) + " " + fmt(army[c])]);
    }))));
    if (tg.fort) wrap.appendChild(el("p", { class: "jm-muted jm-small", text: t("jm_exp_fort_hint", { p: pct(tg.fort) }) }));
    var rows = el("div", { class: "jm-exp-rows" });
    var inputs = {};
    allClasses().forEach(function (c) {
      var have = state.soldiers[c] || 0;
      if (!have) return;
      var input = el("input", { type: "number", min: "0", max: String(have), step: "1", value: String(ui.army[c] || 0), oninput: function (e) {
        ui.army[c] = Math.max(0, Math.min(have, parseInt(e.target.value, 10) || 0));
        updatePreview();
      } });
      inputs[c] = input;
      rows.appendChild(el("div", { class: "jm-exp-row" }, [
        el("span", { text: unitIcon(c) + " " + unitName(c) }),
        input,
        el("span", { class: "jm-muted jm-small", text: "/ " + fmt(have) }),
        el("button", { type: "button", class: "jm-btn jm-small", onclick: function () {
          ui.army[c] = have;
          input.value = String(have);
          updatePreview();
        } }, [t("jm_all")]),
        el("button", { type: "button", class: "jm-btn jm-small jm-ghost", onclick: function () {
          ui.army[c] = 0;
          input.value = "0";
          updatePreview();
        } }, ["0"]),
      ]));
    });
    if (!rows.children.length) rows.appendChild(el("p", { class: "jm-muted", text: t("jm_exp_no_soldiers") }));
    wrap.appendChild(rows);
    wrap.appendChild(el("div", { class: "jm-btn-row" }, [
      el("button", { type: "button", class: "jm-btn", onclick: function () {
        var a = autoArmy(targetId);
        Object.keys(inputs).forEach(function (c) {
          ui.army[c] = a[c] || 0;
          inputs[c].value = String(ui.army[c]);
        });
        updatePreview();
      } }, [t("jm_exp_auto")]),
    ]));
    var preview = el("div", { class: "jm-preview" });
    wrap.appendChild(preview);
    var sendBtn = el("button", { type: "button", class: "jm-primary jm-wide", onclick: function () {
      if (Core.sendExpedition(state, targetId, ui.army)) {
        ui.army = {};
        close();
      }
    } }, [t("jm_exp_go")]);
    wrap.appendChild(sendBtn);
    function updatePreview() {
      var sent = Core.sumArmy(ui.army);
      sendBtn.disabled = sent <= 0;
      preview.innerHTML = "";
      if (sent <= 0) {
        preview.appendChild(el("p", { class: "jm-muted", text: t("jm_exp_pick") }));
        return;
      }
      var p = Core.previewBattle(state, targetId, ui.army);
      var time = Core.travelTime(state, targetId, ui.army);
      preview.appendChild(el("p", { class: p && p.win ? "jm-good" : "jm-bad", text: p && p.win ? t("jm_exp_predict_win", { lost: p.lost, sent: p.sent }) : t("jm_exp_predict_lose") }));
      preview.appendChild(el("p", { class: "jm-muted jm-small", text: t("jm_exp_travel", { s: Math.round(time), back: Math.round(time * 2) }) }));
    }
    updatePreview();
    return wrap;
  }

  function modalReport(rp, close) {
    var wrap = el("div");
    if (!rp) {
      wrap.appendChild(modalHead(t("jm_sec_reports"), close));
      return wrap;
    }
    wrap.appendChild(modalHead((rp.kind === "raid" ? t("jm_report_raid") : t("jm_report_exp")) + "：" + L(rp.name), close));
    wrap.appendChild(el("p", { class: rp.win ? "jm-result jm-good" : "jm-result jm-bad", text: rp.win ? t("jm_win") : rp.retreated ? t("jm_retreated") : t("jm_lose") }));
    function side(title, data, tier) {
      var rows = Object.keys(data).map(function (c) {
        var d = data[c];
        var frac = d.start ? d.end / d.start : 0;
        return el("div", { class: "jm-rep-row" }, [
          el("span", { text: anyUnitIcon(c) + " " + (c === "militia" ? anyUnitName(c, 0) : tier == null ? unitName(c) : anyUnitName(c, tier)) }),
          el("div", { class: "jm-bar" }, [el("div", { class: "jm-bar-fill", style: "width:" + clampPct(frac) + "%" })]),
          el("b", { text: fmt(d.end) + " / " + fmt(d.start) }),
        ]);
      });
      return el("div", { class: "jm-rep-side" }, [el("h3", { text: title })].concat(rows));
    }
    var enemyTier = rp.kind === "expedition" ? D.target(rp.target).tier : null;
    wrap.appendChild(el("div", { class: "jm-rep-grid" }, [side(t("jm_report_mine"), rp.mine, null), side(t("jm_report_theirs"), rp.theirs, enemyTier == null ? state.age : enemyTier)]));
    // 戰況曲線
    if (rp.rounds && rp.rounds.length) {
      var w = 300;
      var h = 70;
      var maxA = Math.max.apply(null, rp.rounds.map(function (r) {
        return r.a;
      }).concat([1]));
      var maxB = Math.max.apply(null, rp.rounds.map(function (r) {
        return r.b;
      }).concat([1]));
      var n = rp.rounds.length;
      function path(key, max) {
        return rp.rounds.map(function (r, i) {
          return (i ? "L" : "M") + ((i / Math.max(1, n - 1)) * w).toFixed(1) + "," + (h - (r[key] / max) * (h - 4)).toFixed(1);
        }).join(" ");
      }
      var svg = '<svg viewBox="0 0 ' + w + " " + h + '" class="jm-curve" preserveAspectRatio="none"><path d="' + path("a", maxA) + '" class="jm-curve-a"/><path d="' + path("b", maxB) + '" class="jm-curve-b"/></svg>';
      wrap.appendChild(el("div", { class: "jm-curve-wrap" }, [el("div", { html: svg }), el("small", { class: "jm-muted", text: t("jm_report_curve", { n: n }) })]));
    }
    var extra = [];
    if (rp.reward && Object.keys(rp.reward).length)
      extra.push(el("p", {}, [t("jm_exp_reward") + " "].concat(Object.keys(rp.reward).map(function (r) {
        return el("span", { class: "jm-cost-item" }, [D.RESOURCE_ICONS[r] + fmt(rp.reward[r])]);
      }))));
    if (rp.captives) extra.push(el("p", { text: t("jm_report_captives", { n: rp.captives }) + (rp.kind === "expedition" && rp.captivesJoined == null ? " " + t("jm_report_on_return") : "") }));
    if (rp.lostRes && Object.keys(rp.lostRes).length) {
      extra.push(el("p", { class: "jm-bad" }, [t("jm_report_lost_res") + " "].concat(Object.keys(rp.lostRes).map(function (r) {
        return el("span", { class: "jm-cost-item" }, [D.RESOURCE_ICONS[r] + fmt(rp.lostRes[r])]);
      }))));
      extra.push(el("p", { class: "jm-bad", text: t("jm_report_lost_vil", { n: rp.lostVillagers }) }));
    }
    extra.forEach(function (e) {
      wrap.appendChild(e);
    });
    wrap.appendChild(el("button", { type: "button", class: "jm-primary jm-wide", onclick: close }, [t("jm_ok")]));
    return wrap;
  }

  function modalOffline(o, close) {
    var wrap = el("div");
    wrap.appendChild(modalHead(t("jm_offline_title"), close));
    wrap.appendChild(el("p", { text: t("jm_offline_desc", { time: fmtTime(o.seconds) }) }));
    wrap.appendChild(el("p", {}, D.RESOURCES.filter(function (r) {
      return Math.abs(o.res[r]) >= 1;
    }).map(function (r) {
      return el("span", { class: "jm-cost-item" }, [D.RESOURCE_ICONS[r] + fmtRate(o.res[r])]);
    }).concat([el("span", { class: "jm-cost-item" }, ["👥" + fmtRate(o.pop)])])));
    wrap.appendChild(el("button", { type: "button", class: "jm-primary jm-wide", onclick: close }, [t("jm_ok")]));
    return wrap;
  }

  function modalVictory(close) {
    var wrap = el("div", { class: "jm-victory" });
    wrap.appendChild(modalHead(t("jm_victory_title"), null));
    wrap.appendChild(el("p", { text: t("jm_victory_desc", { time: fmtTime(state.victory ? state.victory.time : state.time), civ: state.civ ? D.civ(state.civ).name : "—" }) }));
    var s = state.stats;
    wrap.appendChild(el("div", { class: "jm-kv" }, [
      [t("jm_stat_peak"), fmt(s.peakPop)],
      [t("jm_stat_conquests"), fmt(s.conquests)],
      [t("jm_stat_kills"), fmt(s.kills)],
      [t("jm_stat_raids"), s.raidsWon + " / " + s.raidsLost],
    ].map(function (l) {
      return el("div", {}, [el("span", { text: l[0] }), el("b", { text: l[1] })]);
    })));
    wrap.appendChild(el("button", { type: "button", class: "jm-primary jm-wide", onclick: close }, [t("jm_victory_continue")]));
    return wrap;
  }

  function modalHelp(close) {
    var wrap = el("div");
    wrap.appendChild(modalHead(t("jm_help"), close));
    for (var i = 1; i <= 8; i++) wrap.appendChild(el("p", { class: "jm-help-p", text: t("jm_help_" + i) }));
    return wrap;
  }

  function modalMenu(close) {
    var wrap = el("div");
    wrap.appendChild(modalHead(t("jm_menu"), close));
    wrap.appendChild(el("p", { class: "jm-muted", text: t("jm_menu_diff", { d: t("jm_diff_" + state.difficulty) }) }));
    wrap.appendChild(el("div", { class: "jm-menu-btns" }, [
      el("button", { type: "button", class: "jm-btn", onclick: function () {
        Core.save(state);
        toast(t("jm_saved"), "info");
        close();
      } }, [t("jm_save")]),
      el("button", { type: "button", class: "jm-btn", onclick: function () {
        Core.save(state);
        stopGame();
        renderTitle();
      } }, [t("jm_to_title")]),
      el("button", { type: "button", class: "jm-btn jm-danger", onclick: function () {
        if (!window.confirm(t("jm_restart_confirm"))) return;
        Core.clearSave();
        stopGame();
        renderTitle();
      } }, [t("jm_restart")]),
    ]));
    return wrap;
  }

  function stopGame() {
    clearInterval(loopTimer);
    clearInterval(uiTimer);
    clearInterval(saveTimer);
    destroyScene();
    state = null;
    ui.modal = null;
    ui.updaters = [];
  }

  // ---------------- 啟動 ----------------

  window.addEventListener("i18n:change", function () {
    if (!state) {
      renderTitle();
      return;
    }
    ui.updaters = [];
    renderTop();
    renderOverlay();
    renderTabs();
    if (ui.modal && ui.modal !== "expedition" && ui.modal !== "ageup") openModal(ui.modal, ui.modalArg);
    refresh(true);
  });
  document.addEventListener("visibilitychange", function () {
    if (state && document.hidden) Core.save(state);
    lastTick = performance.now();
  });
  window.addEventListener("beforeunload", function () {
    if (state) Core.save(state);
  });

  // 測試用：Playwright 可直接讀 state
  window.PriTestJomon = {
    state: function () {
      return state;
    },
    scene: function () {
      return scene;
    },
  };

  renderTitle();
})();
