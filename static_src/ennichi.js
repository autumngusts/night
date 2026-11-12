// ============================================================================
// 緣日樂園：遊戲畫面（window.PriTestEnnichiGame）。
//   * 規則全部在 ennichi_core.js／ennichi_sim.js：玩家操作一律走 Core.applyIntent(s, {a: ...})，這裡只負責
//     畫面（標題、HUD、天氣預報、側欄五個分頁、小地圖、跟拍、日結算、季末）與時間推進。
//   * 時間：營業中每真實 0.4 秒推進「速度」遊戲分鐘（實作上每 0.4／速度 秒推進 1 分鐘，速率相同、3D 內插較順）；
//     測試可設 _fast，改成每 0.4 秒推進 max(速度, _fast) 分鐘。3D 以 requestAnimationFrame 內插（sync(s, alpha)）。
//   * 3D：進入遊戲時才動態載入 three.min.js → ennichi_vrm.js，再 PriTestEnnichi3D.init；
//     失敗時只顯示一行錯誤，小地圖照樣可以玩。
//   * 存檔：localStorage["pritest-ennichi-save"]（applyIntent 成功、打烊、換日後寫入；讀寫包 try/catch）。
// 選擇器（#en-*、[data-*]）是 Task 16 測試與 css/ennichi.css 共用的介面，不得改名。
// ============================================================================
(function () {
  "use strict";
  var root = document.getElementById("en-game");
  if (!root) return;
  var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore;
  var Murmur = window.PriTestEnnichiMurmur;
  var M = D.MAP, CELL = 10, STEP_SEC = 0.4, SAVE_KEY = "pritest-ennichi-save";
  var WICON = { sun: "☀", cloud: "☁", rain: "☂", wind: "🌀" };
  var NEEDS = ["fun", "hunger", "thirst", "toilet", "fatigue", "dry"];
  var TABS = ["build", "work", "park", "wish", "murmur"];

  var s = null; // 遊戲狀態
  var speed = 1, lastSpeed = 1, acc = 0, lastT = 0;
  var tab = "build", mode = null, selSid = null, followGid = null, treeItem = null, mmFilter = "all";
  var hover = null, dragging = false, stageDown = null, lastMm = null;
  var three = null, threeState = "none";
  var toastTimer = null, sideAt = 0, mapDirty = true;
  var el = {};

  // ---------------------------------------------------------------- 小工具
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function has(k) { return t(k) !== k; }
  function lang() { return window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh"; }
  function L(o) { return o ? (lang() === "ja" ? o.ja : o.zh) : ""; }
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(id) { return document.getElementById(id); }
  function yen(n) { return "¥" + Math.round(n).toLocaleString("en-US"); }
  function hhmm(min) { var h = Math.floor(min / 60), m = min % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  function itemName(id) { return D.ITEMS[id] ? L(D.ITEMS[id].name) : id; }
  function weatherId() { return s.today && s.phase !== "plan" ? s.today.weather : Core.weatherOf(s, s.day); }
  function weatherLabel(id) { return (WICON[id] || "") + " " + L(D.WEATHER[id] ? D.WEATHER[id].name : null); }
  function jikan() { return root.getAttribute("data-jikan") || "../static/images/jikan/"; }
  function avatar(photo) { return photo ? '<img src="' + esc(jikan() + photo + ".webp") + '" alt="" loading="lazy">' : '<span class="en-g-noface">巫</span>'; }
  // innerHTML 只在內容改變時更新；焦點在裡面的輸入框時先不動（避免打字或下拉選單被重建打斷）
  function setHTML(node, html) {
    if (!node || node._h === html) return;
    var a = document.activeElement;
    if (a && a !== node && node.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    node.innerHTML = html;
    node._h = html;
  }
  function setText(node, txt) { if (node && node.textContent !== txt) node.textContent = txt; }
  function topicLabel(k) {
    if (has("en_topic_" + k)) return t("en_topic_" + k);
    if (D.BUILD[k]) return L(D.BUILD[k].name);
    if (has("en_need_" + k)) return t("en_need_" + k);
    return k;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = src;
      sc.onload = resolve;
      sc.onerror = function () { reject(new Error("load failed: " + src)); };
      document.head.appendChild(sc);
    });
  }

  // ---------------------------------------------------------------- 存檔
  function save() {
    if (!s) return;
    try { localStorage.setItem(SAVE_KEY, Core.serialize(s)); } catch (e) { /* 私密模式等：存不了就算了 */ }
  }
  function loadSave() {
    try { var str = localStorage.getItem(SAVE_KEY); return str ? Core.restore(str) : null; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 骨架
  function btn(id, key, cls) { return '<button type="button" id="' + id + '" class="en-btn' + (cls ? " " + cls : "") + '" data-i18n="' + key + '"></button>'; }
  function stat(id) { return '<span class="en-g-stat" id="' + id + '"></span>'; }
  function buildSkeleton() {
    var tabs = TABS.map(function (k) {
      return '<button type="button" class="en-g-tab" id="en-tab-' + k + '" data-tab="' + k + '" role="tab" data-i18n="en_tab_' + k + '"></button>';
    }).join("");
    root.innerHTML =
      '<section id="en-title-screen" class="en-g-title">' +
        '<h1 class="en-title" data-i18n="en_title"></h1>' +
        '<p class="en-lead" data-i18n="en_title_lead"></p>' +
        '<div class="en-g-title-btns">' + btn("en-btn-new", "en_new", "is-on") + btn("en-btn-continue", "en_continue") + "</div>" +
      "</section>" +
      '<section id="en-main" class="en-g-main" hidden>' +
        '<div id="en-hud" class="en-g-hud">' +
          '<div class="en-g-hud-stats">' + stat("en-hud-day") + stat("en-hud-time") + stat("en-hud-weather") + stat("en-hud-cash") + stat("en-hud-rep") + stat("en-hud-guests") + "</div>" +
          '<div class="en-g-hud-ctl">' + btn("en-btn-open", "en_open", "en-g-open") + btn("en-btn-pause", "en_pause") +
            '<button type="button" id="en-btn-speed-1" class="en-btn en-g-speed" data-speed="1">×1</button>' +
            '<button type="button" id="en-btn-speed-2" class="en-btn en-g-speed" data-speed="2">×2</button>' +
            '<button type="button" id="en-btn-speed-4" class="en-btn en-g-speed" data-speed="4">×4</button>' +
          "</div>" +
        "</div>" +
        '<div id="en-forecast" class="en-g-forecast"></div>' +
        '<div class="en-g-layout">' +
          '<div class="en-g-left">' +
            '<div id="en-stage" class="en-g-stage"><div id="en-stage-msg" class="en-g-stage-msg"></div></div>' +
            '<div id="en-toast" class="en-g-toast" role="status" hidden></div>' +
          "</div>" +
          '<aside class="en-g-side">' +
            '<div class="en-g-mapbox"><canvas id="en-minimap" width="' + M.W * CELL + '" height="' + M.H * CELL + '"></canvas>' +
              '<div id="en-mode-bar" class="en-g-modebar" hidden></div></div>' +
            '<div id="en-follow-panel" class="en-g-box en-g-follow" hidden></div>' +
            '<div class="en-g-tabs" role="tablist">' + tabs + "</div>" +
            // 建造
            '<div class="en-g-panel" data-panel="build">' +
              '<div class="en-g-row">' + btn("en-btn-path", "en_path") + btn("en-btn-unpath", "en_unpath") + btn("en-btn-cancel", "en_cancel") + "</div>" +
              '<p class="en-note" id="en-path-note"></p><div id="en-build-list" class="en-g-list"></div>' +
            "</div>" +
            // 工房
            '<div class="en-g-panel" data-panel="work" hidden>' +
              '<h3 class="en-h3"><span data-i18n="en_machines"></span> <small id="en-machine-slots"></small></h3><div id="en-machine-list"></div>' +
              '<h3 class="en-h3" data-i18n="en_add_machine"></h3><div id="en-machine-add" class="en-g-chips"></div>' +
              '<h3 class="en-h3" data-i18n="en_market"></h3><div id="en-market" class="en-g-chips"></div>' +
              '<h3 class="en-h3"><span data-i18n="en_warehouse"></span> <small id="en-ware-total"></small></h3><div id="en-warehouse"></div>' +
              '<h3 class="en-h3" data-i18n="en_recipe_tree"></h3><div id="en-recipe-tree" class="en-g-tree"></div>' +
            "</div>" +
            // 樂園
            '<div class="en-g-panel" data-panel="park" hidden>' +
              '<label class="en-g-field"><span data-i18n="en_fee"></span> <input id="en-fee-input" type="number" min="0" max="2000" step="10" inputmode="numeric"></label>' +
              '<div id="en-struct-panel" class="en-g-box" hidden>' +
                '<div id="en-struct-info"></div>' +
                '<div class="en-g-row" id="en-struct-ride">' +
                  '<label class="en-g-field"><span data-i18n="en_price"></span> <input id="en-price-input" type="number" min="0" max="2000" step="10" inputmode="numeric"></label>' +
                  '<button type="button" id="en-ticket-toggle" class="en-btn" aria-pressed="false"></button>' +
                "</div>" +
                '<div id="en-upgrade-list" class="en-g-list"></div>' +
                '<div class="en-g-row">' + btn("en-btn-repair", "en_repair") + btn("en-btn-demolish", "en_demolish", "en-g-danger") + "</div>" +
              "</div>" +
              '<h3 class="en-h3" data-i18n="en_structs"></h3><div id="en-struct-list" class="en-g-list"></div>' +
            "</div>" +
            // 繪馬
            '<div class="en-g-panel" data-panel="wish" hidden><h3 class="en-h3" data-i18n="en_wish_title"></h3><div id="en-wish-board"></div></div>' +
            // murmur
            '<div class="en-g-panel" data-panel="murmur" hidden><div id="en-mm-filters" class="en-g-chips"></div><ul id="en-murmur-wall" class="en-wall"></ul></div>' +
          "</aside>" +
        "</div>" +
      "</section>" +
      '<div id="en-day-summary" class="en-modal" hidden><div class="en-modal-box en-g-sum"><div id="en-day-summary-body"></div>' +
        btn("en-btn-next-day", "en_next_day", "is-on") + "</div></div>" +
      '<div id="en-season-summary" class="en-modal" hidden><div class="en-modal-box en-g-sum"><div id="en-season-summary-body"></div>' +
        btn("en-btn-restart", "en_restart", "is-on") + "</div></div>";
    ["en-title-screen", "en-main", "en-stage", "en-stage-msg", "en-toast", "en-minimap", "en-mode-bar", "en-follow-panel", "en-forecast",
      "en-hud-day", "en-hud-time", "en-hud-weather", "en-hud-cash", "en-hud-rep", "en-hud-guests",
      "en-btn-open", "en-btn-pause", "en-btn-continue", "en-path-note", "en-build-list", "en-machine-slots", "en-machine-list", "en-machine-add",
      "en-market", "en-ware-total", "en-warehouse", "en-recipe-tree", "en-fee-input", "en-struct-panel", "en-struct-info", "en-struct-ride",
      "en-price-input", "en-ticket-toggle", "en-upgrade-list", "en-btn-repair", "en-btn-demolish", "en-struct-list", "en-wish-board",
      "en-mm-filters", "en-murmur-wall", "en-day-summary", "en-day-summary-body", "en-season-summary", "en-season-summary-body"
    ].forEach(function (id) { el[id.replace(/^en-/, "")] = $(id); });
    if (window.I18N) window.I18N.applyI18n();
  }

  // ---------------------------------------------------------------- 操作
  function toast(msg) {
    if (!msg) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3000);
  }

  // applyIntent 只回 "rejected" 的操作，依目前狀態推測原因（只用來選錯誤訊息）
  function failReason(it) {
    var planOnly = { path: 1, buy: 1, machine: 1, fee: 1, repair: 1, upgrade: 1, demolish: 1, build: 1 };
    if (planOnly[it.a] && s.phase !== "plan") return "phase";
    if (it.a === "path" && it.on) {
      if (!Core.inMap(it.x, it.y)) return "bounds";
      if (it.x >= M.UNLOCK_X) return "locked";
      if (s.occ[Core.ti(it.x, it.y)] || s.tiles[Core.ti(it.x, it.y)] === 1) return "occupied";
      if (s.cash < D.PATH_COST) return "cash";
    }
    if (it.a === "buy") {
      if (s.cash < D.ITEMS[it.item].buy * it.n) return "cash";
      if (Core.wareTotal(s) + it.n > D.WARE_CAP) return "full";
    }
    if (it.a === "machine" && D.MACHINES[it.type] && s.cash < D.MACHINES[it.type].cost) return "cash";
    if (it.a === "repair" || it.a === "upgrade") return "parts";
    return "rejected";
  }

  function doIntent(it, quiet) {
    if (!s) return { ok: false, err: "nogame" };
    var r = Core.applyIntent(s, it);
    if (!r.ok) {
      if (!quiet) toast(t("en_err_" + (r.err && r.err !== "rejected" && r.err !== "unknown" ? r.err : failReason(it))));
    } else {
      if (it.a === "open") { acc = 0; lastMm = null; syncWeather(); }
      if (it.a === "next") { syncWeather(); lastMm = null; }
      if (it.a === "demolish" && it.sid === selSid) selSid = null;
      save();
    }
    mapDirty = true;
    refreshAll();
    return r;
  }

  function setMode(m) {
    mode = m;
    hover = null;
    if (three) three.ghost(null);
    mapDirty = true;
    renderModeBar();
    renderBuildList();
    if (m && window.innerWidth < 860 && el.minimap.scrollIntoView) el.minimap.scrollIntoView({ block: "nearest" });
  }

  function pathAt(x, y) {
    if (!mode || mode.kind !== "path" || !Core.inMap(x, y)) return;
    var isP = s.tiles[Core.ti(x, y)] === 1;
    if (mode.on === isP) return; // 已經是想要的狀態
    doIntent({ a: "path", x: x, y: y, on: mode.on }, dragging);
  }

  function guestAt(x, y) {
    for (var i = 0; i < s.guests.length; i++) if (s.guests[i].x === x && s.guests[i].y === y) return s.guests[i];
    return null;
  }

  function tileClick(x, y, preferGuest) {
    if (!s || !Core.inMap(x, y)) return;
    if (mode && mode.kind === "build") { doIntent({ a: "build", type: mode.type, x: x, y: y }); return; }
    if (mode && mode.kind === "path") { pathAt(x, y); return; }
    var g = guestAt(x, y), sid = s.occ[Core.ti(x, y)];
    if (g && (preferGuest || !sid)) { follow(g.id); return; }
    if (sid) selectStruct(sid);
  }

  function selectStruct(sid) {
    selSid = sid;
    setTab("park");
    mapDirty = true;
    if (el["struct-panel"].scrollIntoView) el["struct-panel"].scrollIntoView({ block: "nearest" });
  }

  function follow(gid) {
    followGid = gid;
    if (three) three.focusGuest(gid ? gid : null); // gid 0 = 小夜（不是客人，不移動鏡頭）
    mapDirty = true;
    renderFollow();
  }

  function setHover(p) {
    hover = p;
    mapDirty = true;
    if (!three) return;
    if (p && mode && mode.kind === "build") three.ghost(mode.type, p.x, p.y, Core.canBuild(s, mode.type, p.x, p.y).ok);
    else three.ghost(null);
  }

  function setTab(k) {
    tab = k;
    TABS.forEach(function (n) {
      var b = $("en-tab-" + n);
      b.classList.toggle("is-on", n === k);
      b.setAttribute("aria-selected", n === k ? "true" : "false");
    });
    var ps = root.querySelectorAll(".en-g-panel");
    for (var i = 0; i < ps.length; i++) ps[i].hidden = ps[i].getAttribute("data-panel") !== k;
    refreshSide();
  }

  function setSpeed(n) {
    if (n > 0) lastSpeed = n;
    speed = n;
    renderControls();
  }

  // ---------------------------------------------------------------- 3D
  function syncWeather() {
    if (three && s) three.setWeather(weatherId());
  }
  function start3D() {
    if (threeState !== "none") return;
    threeState = "loading";
    el["stage-msg"].textContent = t("en_loading");
    loadScript(root.getAttribute("data-three-src"))
      .then(function () { return loadScript(root.getAttribute("data-vendor-src")); })
      .then(function () {
        var api3 = window.PriTestEnnichi3D;
        var p = api3.init(el.stage, { modelUrl: root.getAttribute("data-model"), crowdModelUrl: root.getAttribute("data-model-crowd") });
        three = api3; // 場景在 init 內同步建好，模型載入期間就可以 sync
        syncWeather();
        return p;
      })
      .then(function () {
        threeState = "ok";
        el["stage-msg"].textContent = "";
      }, function (e) {
        threeState = "error";
        el["stage-msg"].textContent = t("en_3d_error", { msg: e && e.message ? e.message : String(e) });
        el["stage-msg"].classList.add("is-error");
      });
  }

  // ---------------------------------------------------------------- HUD
  function statHTML(label, value) { return "<small>" + esc(label) + "</small><b>" + esc(value) + "</b>"; }
  function renderHud() {
    // 窄螢幕會隱藏 <small> 標籤，所以值本身要看得懂
    setHTML(el["hud-day"], "<b>" + esc(t("en_day", { n: Math.min(s.day, D.SEASON_DAYS) })) + "</b><small>/" + D.SEASON_DAYS + "</small>");
    setHTML(el["hud-time"], "<b>" + hhmm(s.min) + "</b>");
    setHTML(el["hud-weather"], statHTML(t("en_weather"), weatherLabel(weatherId())));
    setHTML(el["hud-cash"], statHTML(t("en_cash"), yen(s.cash)));
    setHTML(el["hud-rep"], statHTML(t("en_rep"), "★ " + s.rep + " · " + t("en_level", { n: Core.popLevel(s) })));
    setHTML(el["hud-guests"], statHTML(t("en_guests"), "👥 " + s.guests.length + (s.today && s.phase !== "plan" ? " / " + s.today.guests : "")));
  }
  function renderControls() {
    el["btn-open"].disabled = s.phase !== "plan";
    el["btn-open"].hidden = s.phase !== "plan";
    el["btn-pause"].classList.toggle("is-on", speed === 0);
    [1, 2, 4].forEach(function (n) { $("en-btn-speed-" + n).classList.toggle("is-on", speed === n); });
  }
  function renderForecast() {
    el.forecast.hidden = s.phase !== "plan";
    var h = '<span class="en-g-fc-title">' + esc(t("en_forecast")) + "</span>";
    for (var d = s.day; d < s.day + 3 && d <= D.SEASON_DAYS; d++) {
      var w = Core.weatherOf(s, d);
      h += '<span class="en-g-fc-day en-g-w-' + w + '" data-day="' + d + '"><small>' + esc(d === s.day ? t("en_today") : t("en_day", { n: d })) +
        "</small><b>" + esc(weatherLabel(w)) + "</b></span>";
    }
    setHTML(el.forecast, h);
  }
  function renderModeBar() {
    var bar = el["mode-bar"];
    if (!mode) { bar.hidden = true; return; }
    bar.hidden = false;
    setText(bar, mode.kind === "build" ? t("en_mode_build", { name: L(D.BUILD[mode.type].name) }) : t(mode.on ? "en_mode_path" : "en_mode_unpath"));
  }

  // ---------------------------------------------------------------- 側欄：建造
  function partsHTML(parts) {
    var h = "";
    for (var k in parts) {
      var n = s.ware[k] || 0;
      h += '<span class="' + (n >= parts[k] ? "is-ok" : "is-ng") + '">' + esc(itemName(k)) + " " + n + "/" + parts[k] + "</span>";
    }
    return h;
  }
  function renderBuildList() {
    if (!s) return;
    el["path-note"].textContent = t("en_path_cost", { n: D.PATH_COST });
    $("en-btn-path").classList.toggle("is-on", !!(mode && mode.kind === "path" && mode.on));
    $("en-btn-unpath").classList.toggle("is-on", !!(mode && mode.kind === "path" && !mode.on));
    var lv = Core.popLevel(s), h = "";
    for (var type in D.BUILD) {
      if (type === "shrine") continue;
      var b = D.BUILD[type];
      var meta = b.w + "×" + b.h + " · " + yen(b.cash) + (b.days ? " · " + t("en_build_days", { n: b.days }) : "");
      var ok = Core.have(s, b.parts) && s.cash >= b.cash && lv >= b.lv;
      h += '<button type="button" class="en-g-build' + (mode && mode.type === type ? " is-on" : "") + (ok ? "" : " is-short") + (b.large ? " is-large" : "") +
        '" data-build="' + type + '"><span class="en-g-build-name">' + esc(L(b.name)) + '</span><span class="en-g-build-meta">' + esc(meta) +
        (lv < b.lv ? ' · <span class="is-ng">' + esc(t("en_need_lv", { n: b.lv })) + "</span>" : "") +
        '</span><span class="en-g-parts">' + partsHTML(b.parts) + "</span></button>";
    }
    setHTML(el["build-list"], h);
  }

  // ---------------------------------------------------------------- 側欄：工房
  function recipeLabel(rid) {
    var r = D.RECIPES[rid], ins = [];
    for (var k in r.in) ins.push(itemName(k) + "×" + r.in[k]);
    return itemName(rid) + "×" + r.out[rid] + " ← " + ins.join("+") + "（" + r.t + "）";
  }
  function machineProgress(m) {
    var r = m.rid && D.RECIPES[m.rid];
    if (!r) return { pct: 0, txt: t("en_idle"), cls: "is-idle" };
    if (m.t === null) {
      var over = false;
      if (m.limit) for (var k in r.out) if ((s.ware[k] || 0) >= m.limit) over = true;
      return { pct: 0, txt: over ? t("en_wait_limit") : (s.phase === "open" ? t("en_wait_mat") : t("en_idle")), cls: over ? "is-limit" : "is-wait" };
    }
    return { pct: Math.round(m.t / r.t * 100), txt: m.t + "/" + r.t, cls: "is-run" };
  }
  function renderWork() {
    setText(el["machine-slots"], t("en_slots", { n: s.machines.length, max: Core.machineSlots(s) }));
    var h = "";
    s.machines.forEach(function (m, i) {
      var opts = '<option value="">' + esc(t("en_idle")) + "</option>";
      for (var rid in D.RECIPES) if (D.RECIPES[rid].m === m.type) opts += '<option value="' + rid + '"' + (m.rid === rid ? " selected" : "") + ">" + esc(recipeLabel(rid)) + "</option>";
      h += '<div class="en-g-mach"><div class="en-g-mach-head"><b>' + esc(L(D.MACHINES[m.type].name)) + '</b><div class="en-g-prog" data-progress="' + i + '"></div></div>' +
        '<select data-recipe="' + i + '" aria-label="' + esc(t("en_recipe")) + '">' + opts + "</select>" +
        '<label class="en-g-limit"><span>' + esc(t("en_limit")) + '</span><input type="number" min="0" max="' + D.WARE_CAP + '" data-limit="' + i +
        '" placeholder="' + esc(t("en_unlimited")) + '" value="' + (m.limit || "") + '"></label></div>';
    });
    setHTML(el["machine-list"], h);
    // 進度條每次刷新都更新（不重建 select／input）
    s.machines.forEach(function (m, i) {
      var node = el["machine-list"].querySelector('[data-progress="' + i + '"]');
      if (!node) return;
      var p = machineProgress(m);
      setHTML(node, '<span class="en-g-bar ' + p.cls + '"><i style="width:' + p.pct + '%"></i></span><em>' + esc(p.txt) + "</em>");
    });
    var ha = "";
    for (var type in D.MACHINES) ha += '<button type="button" class="en-g-chip" data-machine="' + type + '">' + esc(L(D.MACHINES[type].name)) + " <b>" + yen(D.MACHINES[type].cost) + "</b></button>";
    setHTML(el["machine-add"], ha);
    var hm = "";
    for (var id in D.ITEMS) if (D.ITEMS[id].kind === "mat") hm += '<button type="button" class="en-g-chip" data-buy="' + id + '">' + esc(itemName(id)) + " <b>" + yen(D.ITEMS[id].buy * 10) + "</b></button>";
    setHTML(el.market, hm);
    renderWarehouse();
    renderTree();
  }
  function tierKey(id) {
    var k = D.ITEMS[id].kind;
    if (k === "mat") return "0";
    if (k === "module") return "3";
    if (k === "upgrade") return "upgrade";
    if (k === "part") return String(D.tierOf(id));
    return "goods";
  }
  function renderWarehouse() {
    setText(el["ware-total"], t("en_ware_total", { n: Core.wareTotal(s), cap: D.WARE_CAP }));
    var groups = { "0": [], "1": [], "2": [], "3": [], upgrade: [], goods: [] };
    for (var id in D.ITEMS) groups[tierKey(id)].push(id);
    var h = "";
    ["0", "1", "2", "3", "upgrade", "goods"].forEach(function (g) {
      h += '<div class="en-g-tier" data-tier="' + g + '"><h4>' + esc(t("en_tier_" + g)) + '</h4><div class="en-g-chips">';
      groups[g].forEach(function (id) {
        var n = s.ware[id] || 0;
        h += '<button type="button" class="en-g-chip' + (n ? "" : " is-zero") + (treeItem === id ? " is-on" : "") + '" data-tree="' + id + '">' + esc(itemName(id)) + " <b>" + n + "</b></button>";
      });
      h += "</div></div>";
    });
    setHTML(el.warehouse, h);
  }
  function treeNode(id, qty, depth) {
    var it = D.ITEMS[id], r = D.RECIPES[id], n = s.ware[id] || 0;
    var h = '<li><button type="button" class="en-g-link" data-tree="' + id + '">' + esc(itemName(id)) + "</button>" + (qty ? " ×" + qty : "") +
      ' <span class="' + (qty && n < qty ? "is-ng" : "is-ok") + '">' + esc(t("en_have", { n: n })) + "</span>";
    if (it.kind === "mat" || !r) h += ' <small>' + esc(t("en_tree_raw", { n: it.buy || 0 })) + "</small>";
    else {
      h += ' <small>' + esc(t("en_tree_line", { machine: L(D.MACHINES[r.m].name), t: r.t, n: r.out[id] })) + "</small>";
      if (depth < 6) {
        h += "<ul>";
        for (var k in r.in) h += treeNode(k, r.in[k], depth + 1);
        h += "</ul>";
      }
    }
    return h + "</li>";
  }
  function renderTree() {
    setHTML(el["recipe-tree"], treeItem ? "<ul>" + treeNode(treeItem, 0, 0) + "</ul>" : '<p class="en-note">' + esc(t("en_tree_hint")) + "</p>");
  }

  // ---------------------------------------------------------------- 側欄：樂園
  function structStatus(st) {
    var b = D.BUILD[st.type];
    if (st.build > 0) return t("en_building", { n: st.build });
    if (st.broken) return t("en_broken");
    if (s.today && s.phase === "open" && s.today.closed && s.today.closed.indexOf(st.type) >= 0) return t("en_wind_stop");
    if (b.kind === "ride") return t("en_wear") + " " + Math.round(st.wear) + "%";
    return "";
  }
  function renderPark() {
    if (document.activeElement !== el["fee-input"]) el["fee-input"].value = s.fee;
    el["fee-input"].disabled = s.phase !== "plan";
    var h = "", ids = Object.keys(s.structs).map(Number).sort(function (a, b) { return a - b; });
    if (selSid && !s.structs[selSid]) selSid = null;
    ids.forEach(function (sid) {
      var st = s.structs[sid], stt = structStatus(st);
      h += '<button type="button" class="en-g-srow' + (sid === selSid ? " is-on" : "") + (st.broken ? " is-broken" : "") + '" data-struct="' + sid + '"><span>' +
        esc(L(D.BUILD[st.type].name)) + "</span><small>" + esc(stt) + "</small></button>";
    });
    setHTML(el["struct-list"], h);
    renderStructPanel();
  }
  function renderStructPanel() {
    var p = el["struct-panel"], st = selSid && s.structs[selSid];
    if (!st) { p.hidden = true; return; }
    p.hidden = false;
    var b = D.BUILD[st.type], ride = b.kind === "ride", rows = [];
    function row(k, v) { rows.push("<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>"); }
    if (st.build > 0) row("🔨", t("en_building", { n: st.build }));
    if (ride) {
      row(t("en_wear"), Math.round(st.wear) + "%" + (st.broken ? "（" + t("en_broken") + "）" : ""));
      row(t("en_queue"), String(st.q.length));
      row(t("en_last_wait"), t("en_minutes", { n: st.lastWait || 0 }));
      var e = Core.effStats(st);
      row("★", "thrill " + e.thrill + " · charm " + e.charm + " · photo " + e.photo);
    }
    if (b.sells) row(t("en_tier_goods"), b.sells.map(itemName).join("、"));
    setHTML(el["struct-info"], "<h4>" + esc(L(b.name)) + (st.broken ? ' <span class="is-ng">' + esc(t("en_broken")) + "</span>" : "") + '</h4><dl class="en-g-dl">' + rows.join("") + "</dl>");
    el["struct-ride"].hidden = !ride;
    if (ride) {
      if (document.activeElement !== el["price-input"]) el["price-input"].value = st.price;
      el["ticket-toggle"].setAttribute("aria-pressed", st.ticket ? "true" : "false");
      el["ticket-toggle"].classList.toggle("is-on", !!st.ticket);
      setText(el["ticket-toggle"], t("en_ticket") + "：" + t(st.ticket ? "en_on" : "en_off"));
    }
    var hu = "";
    if (b.slots) for (var sl in b.slots) {
      var slot = b.slots[sl], done = !!st.mods[sl], have = s.ware[slot.mod] || 0;
      hu += '<button type="button" class="en-g-upg' + (done ? " is-done" : "") + '" data-upgrade="' + sl + '"' + (done ? " disabled" : "") + "><b>" +
        esc(t("en_upgrade") + "：" + itemName(slot.mod)) + "</b><small>" + (done ? esc(t("en_upgraded")) :
        '<span class="' + (have >= slot.n ? "is-ok" : "is-ng") + '">' + have + "/" + slot.n + "</span>") + "</small></button>";
    }
    setHTML(el["upgrade-list"], hu);
    el["btn-repair"].hidden = !ride;
    if (ride) setText(el["btn-repair"], t("en_repair") + "（" + Object.keys(b.fix).map(function (k) { return itemName(k) + "×" + b.fix[k]; }).join("、") + "）");
    el["btn-repair"].disabled = !ride || s.phase !== "plan" || (!st.broken && !st.wear);
    el["btn-demolish"].hidden = st.type === "shrine";
    el["btn-demolish"].disabled = s.phase !== "plan";
  }

  // ---------------------------------------------------------------- 側欄：繪馬
  function renderWish() {
    var list = s.wishes.slice().sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.id - a.id; });
    if (!list.length) { setHTML(el["wish-board"], '<p class="en-note">' + esc(t("en_wish_empty")) + "</p>"); return; }
    var h = '<ul class="en-g-wishes">';
    list.forEach(function (w) {
      var info;
      if (w.done) info = '<span class="is-ok">' + esc(t("en_wish_done")) + "</span>";
      else {
        info = esc(t("en_wish_days", { n: Math.max(0, D.WISH.EXPIRE - (s.day - w.day)) }));
        if (w.kind === "sell") info = '<span class="en-g-bar"><i style="width:' + Math.min(100, Math.round(w.prog / w.n * 100)) + '%"></i></span> ' + w.prog + "/" + w.n + " · " + info;
      }
      h += '<li class="en-g-wish' + (w.done ? " is-done" : "") + '" data-wish="' + w.id + '">' + avatar(w.photo) + "<div><p>" + esc(L(w.text)) + "</p><small>" + info + "</small></div></li>";
    });
    setHTML(el["wish-board"], h + "</ul>");
  }

  // ---------------------------------------------------------------- 側欄：murmur 牆
  function mmItem(m) {
    return '<li class="en-wall-item" data-gid="' + (m.gid || 0) + '">' + avatar(m.photo) + '<div><span class="en-mm-type en-mm-' + m.type + '">' + esc(t("en_mm_" + m.type)) +
      "</span> <small>" + hhmm(m.t) + "</small><p>" + esc(L(m.text)) + "</p></div></li>";
  }
  function renderMurmur() {
    var fh = '<button type="button" class="en-g-chip' + (mmFilter === "all" ? " is-on" : "") + '" data-mm-filter="all">' + esc(t("en_mm_all")) + "</button>";
    Murmur.TYPES.forEach(function (k) {
      fh += '<button type="button" class="en-g-chip' + (mmFilter === k ? " is-on" : "") + '" data-mm-filter="' + k + '">' + esc(t("en_mm_" + k)) + "</button>";
    });
    setHTML(el["mm-filters"], fh);
    var arr = s.today ? s.today.murmurs : [], h = "", n = 0;
    for (var i = arr.length - 1; i >= 0 && n < 80; i--) {
      if (mmFilter !== "all" && arr[i].type !== mmFilter) continue;
      h += mmItem(arr[i]);
      n++;
    }
    setHTML(el["murmur-wall"], h || '<li class="en-note">' + esc(t("en_mm_empty")) + "</li>");
  }

  // ---------------------------------------------------------------- 跟拍
  function renderFollow() {
    var p = el["follow-panel"];
    if (followGid == null || !s) { p.hidden = true; return; }
    p.hidden = false;
    var g = null, i;
    for (i = 0; i < s.guests.length; i++) if (s.guests[i].id === followGid) g = s.guests[i];
    var mine = (s.today ? s.today.murmurs : []).filter(function (m) { return (m.gid || 0) === followGid; }).slice(-4).reverse();
    var photo = g ? g.photo : (mine[0] ? mine[0].photo : null);
    var name = followGid === 0 ? t("en_sayo") : (g ? L(window.PriTestEnnichiSim.guestType(g).name) : "") + " #" + followGid;
    var h = '<div class="en-g-follow-head">' + avatar(photo) + "<b>" + esc(t("en_follow") + "：" + name) + '</b><button type="button" class="en-g-x" data-follow-close aria-label="close">×</button></div>';
    if (g) {
      h += '<div class="en-g-needs"><span>' + esc(t("en_hap")) + '</span><span class="en-g-bar is-hap"><i style="width:' + Math.round(g.hap) + '%"></i></span><em>' + Math.round(g.hap) + "</em>";
      NEEDS.forEach(function (k) {
        var v = Math.round(Math.min(100, g.need[k] || 0));
        h += "<span>" + esc(t("en_need_" + k)) + '</span><span class="en-g-bar' + (v >= 70 ? " is-hot" : "") + '"><i style="width:' + v + '%"></i></span><em>' + v + "</em>";
      });
      h += "</div>";
    } else if (followGid !== 0) h += '<p class="en-note">' + esc(t("en_left")) + "</p>";
    if (mine.length) h += '<ul class="en-wall">' + mine.map(mmItem).join("") + "</ul>";
    setHTML(p, h);
  }

  // ---------------------------------------------------------------- 結算
  function dl(rows) { return '<dl class="en-g-dl">' + rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>"; }
  function renderModals() {
    var showDay = s.phase === "close", showSeason = s.phase === "season";
    el["day-summary"].hidden = !showDay;
    el["season-summary"].hidden = !showSeason;
    if (showDay) {
      var h = s.history[s.history.length - 1];
      if (!h) return;
      var topics = (h.topTopics || []).map(function (x) { return "<li>" + esc(topicLabel(x[0])) + " <small>×" + x[1] + "</small></li>"; }).join("");
      setHTML(el["day-summary-body"], "<h2>" + esc(t("en_summary_title", { n: h.day })) + "</h2>" + dl([
        [t("en_weather"), weatherLabel(h.weather)],
        [t("en_summary_guests"), String(h.guests)],
        [t("en_summary_rev"), yen(h.rev)],
        [t("en_summary_hap"), String(h.avgHap)],
        [t("en_summary_rep"), (h.repDelta >= 0 ? "+" : "") + h.repDelta + " → " + s.rep],
        [t("en_summary_wishes"), String(h.wishesDone || 0)],
        [t("en_summary_sns"), String(h.sns)],
      ]) + "<h3 class=\"en-h3\">" + esc(t("en_summary_topics")) + "</h3>" + (topics ? '<ol class="en-g-topics">' + topics + "</ol>" : '<p class="en-note">—</p>'));
    }
    if (showSeason) {
      var r = Core.seasonResult(s);
      setHTML(el["season-summary-body"], "<h2>" + esc(t("en_season_title")) + "</h2>" + dl([
        [t("en_summary_guests"), String(r.guests)],
        [t("en_summary_rev"), yen(r.rev)],
        [t("en_summary_hap"), String(r.avgHap)],
        [t("en_rep"), r.rep + " · " + t("en_level", { n: r.level })],
        [t("en_summary_wishes"), String(r.wishes)],
      ]));
    }
  }

  // ---------------------------------------------------------------- 小地圖
  var KIND_COLOR = { shrine: "#9a3324", ride: "#e0703a", stall: "#e8b830", qstall: "#d49a20", facility: "#3f8fc8", deco: "#b0d080" };
  function drawMinimap() {
    var c = el.minimap, g = c.getContext("2d"), x, y, k;
    g.fillStyle = "#79a556";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgba(30,40,20,.45)";
    g.fillRect(M.UNLOCK_X * CELL, 0, (M.W - M.UNLOCK_X) * CELL, c.height);
    g.fillStyle = "#d8c49a";
    for (y = 0; y < M.H; y++) for (x = 0; x < M.W; x++) if (s.tiles[Core.ti(x, y)] === 1) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    g.strokeStyle = "rgba(0,0,0,.06)";
    g.lineWidth = 1;
    g.beginPath();
    for (x = 1; x < M.W; x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, c.height); }
    for (y = 1; y < M.H; y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(c.width, y * CELL + 0.5); }
    g.stroke();
    for (k in s.structs) {
      var st = s.structs[k], b = D.BUILD[st.type], px = st.x * CELL, py = st.y * CELL, w = b.w * CELL, h = b.h * CELL;
      g.fillStyle = b.large ? "#c8282e" : KIND_COLOR[b.kind] || "#999";
      g.fillRect(px + 1, py + 1, w - 2, h - 2);
      if (st.build > 0) { // 施工中：斜線
        g.save();
        g.beginPath(); g.rect(px + 1, py + 1, w - 2, h - 2); g.clip();
        g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 2;
        g.beginPath();
        for (var d = -h; d < w; d += 5) { g.moveTo(px + d, py + h); g.lineTo(px + d + h, py); }
        g.stroke();
        g.restore();
      }
      if (st.broken) {
        g.strokeStyle = "#200"; g.lineWidth = 2;
        g.beginPath(); g.moveTo(px + 2, py + 2); g.lineTo(px + w - 2, py + h - 2); g.moveTo(px + w - 2, py + 2); g.lineTo(px + 2, py + h - 2); g.stroke();
      }
      if (+k === selSid) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(px + 1, py + 1, w - 2, h - 2); }
    }
    g.fillStyle = "#c8282e";
    g.fillRect(M.GATE.x * CELL, M.GATE.y * CELL - 2, 3, CELL + 4);
    s.guests.forEach(function (gu) {
      var on = gu.id === followGid;
      g.fillStyle = on ? "#ffe14a" : "#ffffff";
      g.strokeStyle = "#2b2230"; g.lineWidth = 1;
      g.beginPath(); g.arc(gu.x * CELL + 5, gu.y * CELL + 5, on ? 3.5 : 2.2, 0, Math.PI * 2); g.fill(); g.stroke();
    });
    if (hover && mode) {
      if (mode.kind === "build") {
        var bb = D.BUILD[mode.type], ok = Core.canBuild(s, mode.type, hover.x, hover.y).ok;
        g.fillStyle = ok ? "rgba(64,208,96,.55)" : "rgba(224,64,64,.55)";
        g.fillRect(hover.x * CELL, hover.y * CELL, bb.w * CELL, bb.h * CELL);
        g.fillStyle = "rgba(255,255,255,.9)"; // 入口格
        g.fillRect((hover.x + Math.floor(bb.w / 2)) * CELL + 3, (hover.y + bb.h) * CELL + 3, 4, 4);
      } else {
        g.strokeStyle = mode.on ? "#fff" : "#e04040"; g.lineWidth = 2;
        g.strokeRect(hover.x * CELL + 1, hover.y * CELL + 1, CELL - 2, CELL - 2);
      }
    }
    mapDirty = false;
  }
  function mapTile(e) {
    var r = el.minimap.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var x = Math.floor((e.clientX - r.left) / r.width * M.W), y = Math.floor((e.clientY - r.top) / r.height * M.H);
    return Core.inMap(x, y) ? { x: x, y: y } : null;
  }

  // ---------------------------------------------------------------- 刷新
  function refreshSide() {
    if (!s) return;
    sideAt = Date.now();
    if (tab === "build") renderBuildList();
    else if (tab === "work") renderWork();
    else if (tab === "park") renderPark();
    else if (tab === "wish") renderWish();
    else renderMurmur();
    renderFollow();
  }
  function refreshAll() {
    if (!s) return;
    renderHud();
    renderControls();
    renderForecast();
    renderModeBar();
    refreshSide();
    renderModals();
    mapDirty = true;
  }

  // ---------------------------------------------------------------- 時間推進
  function afterTick() {
    mapDirty = true;
    var arr = s.today ? s.today.murmurs : [], i = lastMm ? arr.lastIndexOf(lastMm) : -1;
    var fresh = arr.slice(i + 1);
    lastMm = arr.length ? arr[arr.length - 1] : null;
    if (three) fresh.slice(-3).forEach(function (m) { three.bubble(m); });
  }
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastT ? Math.min(1, (now - lastT) / 1000) : 0;
    lastT = now;
    if (!s) return;
    var fast = api._fast || 0, stepSec = fast ? STEP_SEC : STEP_SEC / Math.max(1, speed);
    if (s.phase === "open" && speed > 0) {
      acc += dt;
      var guard = 0;
      while (acc >= stepSec && s.phase === "open" && guard++ < 60) {
        acc -= stepSec;
        Core.tick(s, fast ? Math.max(speed, fast) : 1);
        afterTick();
      }
      if (s.phase !== "open") { // 打烊（tick 內 closeDay）
        acc = 0;
        save();
        refreshAll();
      } else if (Date.now() - sideAt > 300) refreshSide();
      renderHud();
    }
    if (three) three.sync(s, s.phase === "open" ? Math.min(1, acc / stepSec) : 1);
    if (mapDirty) drawMinimap();
  }

  // ---------------------------------------------------------------- 開始
  function startGame(ns) {
    s = ns;
    el["title-screen"].hidden = true;
    el.main.hidden = false;
    mode = null; selSid = null; followGid = null; treeItem = null; hover = null; acc = 0;
    speed = 1; lastSpeed = 1;
    var arr = s.today ? s.today.murmurs : [];
    lastMm = arr.length ? arr[arr.length - 1] : null;
    if (three) three.focusGuest(null);
    start3D();
    syncWeather();
    setTab(tab);
    refreshAll();
    save();
  }
  function newGame() { startGame(Core.newGame({ seed: (Date.now() % 2147483647) | 0 })); }

  // ---------------------------------------------------------------- 事件
  function on(node, ev, fn) { node.addEventListener(ev, fn); }
  function closest(e, sel) { return e.target && e.target.closest ? e.target.closest(sel) : null; }
  function bind() {
    on($("en-btn-new"), "click", newGame);
    on(el["btn-continue"], "click", function () { var ls = loadSave(); if (ls) startGame(ls); });
    on(el["btn-open"], "click", function () { doIntent({ a: "open" }); });
    on(el["btn-pause"], "click", function () { setSpeed(speed > 0 ? 0 : lastSpeed); });
    [1, 2, 4].forEach(function (n) { on($("en-btn-speed-" + n), "click", function () { setSpeed(n); }); });
    on($("en-btn-next-day"), "click", function () { doIntent({ a: "next" }); });
    on($("en-btn-restart"), "click", function () { setTab("build"); newGame(); });
    on($("en-btn-path"), "click", function () { setMode({ kind: "path", on: true }); });
    on($("en-btn-unpath"), "click", function () { setMode({ kind: "path", on: false }); });
    on($("en-btn-cancel"), "click", function () { setMode(null); });
    on(el["btn-repair"], "click", function () { if (selSid) doIntent({ a: "repair", sid: selSid }); });
    on(el["btn-demolish"], "click", function () { if (selSid) doIntent({ a: "demolish", sid: selSid }); });
    on(el["ticket-toggle"], "click", function () { var st = selSid && s.structs[selSid]; if (st) doIntent({ a: "ticket", sid: selSid, on: !st.ticket }); });

    function numInput(node, fn) {
      function apply() { var v = parseInt(node.value, 10); if (!isNaN(v)) fn(v); }
      on(node, "change", apply);
      on(node, "input", apply);
    }
    numInput(el["fee-input"], function (v) { if (v !== s.fee) doIntent({ a: "fee", fee: v }, true); });
    numInput(el["price-input"], function (v) { var st = selSid && s.structs[selSid]; if (st && v !== st.price) doIntent({ a: "price", sid: selSid, price: v }, true); });

    // 側欄內的動態按鈕：事件委派
    on(root, "click", function (e) {
      var b;
      if ((b = closest(e, "[data-tab]"))) { setTab(b.getAttribute("data-tab")); return; }
      if ((b = closest(e, "[data-build]"))) { var ty = b.getAttribute("data-build"); setMode(mode && mode.type === ty ? null : { kind: "build", type: ty }); return; }
      if ((b = closest(e, "[data-buy]"))) { doIntent({ a: "buy", item: b.getAttribute("data-buy"), n: 10 }); return; }
      if ((b = closest(e, "[data-machine]"))) { doIntent({ a: "machine", type: b.getAttribute("data-machine") }); return; }
      if ((b = closest(e, "[data-tree]"))) { treeItem = b.getAttribute("data-tree"); renderWarehouse(); renderTree(); return; }
      if ((b = closest(e, "[data-struct]"))) { selectStruct(+b.getAttribute("data-struct")); return; }
      if ((b = closest(e, "[data-upgrade]"))) { if (selSid) doIntent({ a: "upgrade", sid: selSid, slot: b.getAttribute("data-upgrade") }); return; }
      if ((b = closest(e, "[data-mm-filter]"))) { mmFilter = b.getAttribute("data-mm-filter"); renderMurmur(); return; }
      if ((b = closest(e, "[data-follow-close]"))) { follow(null); return; }
      if ((b = closest(e, ".en-bubble[data-gid], .en-wall-item[data-gid]"))) { follow(+b.getAttribute("data-gid")); return; }
    });
    on(root, "change", function (e) {
      var sel = closest(e, "select[data-recipe]");
      if (sel) { doIntent({ a: "recipe", mi: +sel.getAttribute("data-recipe"), rid: sel.value || null }); return; }
    });
    on(root, "input", function (e) {
      var inp = closest(e, "input[data-limit]");
      if (!inp) return;
      var v = inp.value === "" ? null : parseInt(inp.value, 10), mi = +inp.getAttribute("data-limit");
      if (v !== null && isNaN(v)) return;
      if ((s.machines[mi].limit || null) !== (v || null)) doIntent({ a: "limit", mi: mi, n: v }, true);
    });

    // 小地圖：點選＝放置／選取；步道模式可拖曳
    var mm = el.minimap;
    on(mm, "click", function (e) { var p = mapTile(e); if (p) tileClick(p.x, p.y, false); });
    on(mm, "pointerdown", function (e) {
      if (!mode || mode.kind !== "path") return;
      var p = mapTile(e);
      if (p) pathAt(p.x, p.y); // 第一格失敗要顯示原因；之後拖曳經過的格子不再逐格提示
      dragging = true;
      if (mm.setPointerCapture && e.pointerId != null) { try { mm.setPointerCapture(e.pointerId); } catch (er) { /* 合成事件沒有指標 */ } }
    });
    on(mm, "pointermove", function (e) {
      var p = mapTile(e);
      if (!hover || !p || hover.x !== p.x || hover.y !== p.y) setHover(p);
      if (dragging && p) pathAt(p.x, p.y);
    });
    function endDrag() { dragging = false; }
    on(mm, "pointerup", endDrag);
    on(mm, "pointercancel", endDrag);
    on(mm, "pointerleave", function () { endDrag(); setHover(null); });

    // 3D 舞台：點地面（拖曳旋轉鏡頭不算）＝放置／跟拍客人／選取設施
    var stg = el.stage;
    on(stg, "pointerdown", function (e) { stageDown = closest(e, ".en-bubble") ? null : { x: e.clientX, y: e.clientY }; });
    on(stg, "pointerup", function (e) {
      var d = stageDown;
      stageDown = null;
      if (!d || !three || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6) return;
      var p = three.pickTile(e.clientX, e.clientY);
      if (p) tileClick(p.x, p.y, true);
    });
    on(stg, "pointermove", function (e) {
      if (!three || !mode || mode.kind !== "build" || stageDown) return;
      var p = three.pickTile(e.clientX, e.clientY);
      if (!hover || !p || hover.x !== p.x || hover.y !== p.y) setHover(p);
    });

    window.addEventListener("i18n:change", function () { refreshAll(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && mode) setMode(null); });
  }

  // ---------------------------------------------------------------- 測試用
  var api = {
    _state: function () { return s; },
    _intent: function (it) { var r = doIntent(it, true); return { ok: r.ok, err: r.err }; },
    _speed: function () { return speed; },
    _fast: undefined,
  };
  window.PriTestEnnichiGame = api;

  buildSkeleton();
  el["btn-continue"].disabled = !loadSave();
  bind();
  requestAnimationFrame(loop);
})();
