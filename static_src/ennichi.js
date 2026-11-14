// ============================================================================
// 緣日樂園：遊戲畫面（window.PriTestEnnichiGame）。
//   * 規則全部在 ennichi_core.js／ennichi_sim.js：玩家操作一律走 Core.applyIntent(s, {a: ...})，這裡只負責
//     畫面（標題、HUD、天氣預報、dock 與浮動視窗、小地圖、跟拍、日結算、季末）與時間推進。
//   * 版面（2026-11-14）：只留上方導覽列，3D 舞台滿版；操作一律在浮在舞台上的視窗（建造／工房／樂園／繪馬／murmur、
//     設施詳細、跟拍）。寬螢幕可拖曳標題列、可同時開多個；寬度 < 860px 改成一次一個的底部抽屜。
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
  var M = D.MAP, CELL = 20, STEP_SEC = 0.4, SAVE_KEY = "pritest-ennichi-save";
  var WICON = { sun: "☀", cloud: "☁", rain: "☂", wind: "🌀" };
  var NEEDS = ["fun", "hunger", "thirst", "toilet", "fatigue", "dry"];
  var TABS = ["area", "build", "work", "park", "wish", "murmur"];
  var DOCK_ICON = { area: "🗺", build: "🔨", work: "⚙", park: "🎡", wish: "⛩", murmur: "💬" };
  var NARROW = 860; // 未滿此寬度：視窗改成底部抽屜、不能拖曳

  var s = null; // 遊戲狀態
  var speed = 1, lastSpeed = 1, acc = 0, lastT = 0;
  var area = 0; // 目前觀看的區域（D.AREAS 的索引；規格 §6.3.1）
  var lastRot = 0; // 最後一次放置用的方向（換設施時沿用）
  var wins = {}, winZ = 20, modeHidBuild = false, mode = null, selSid = null, followGid = null, treeItem = null, mmFilter = "all";
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
  // 浮動視窗：標題列（可拖曳）＋關閉鈕＋內容
  function win(k, titleKey, body, extraCls) {
    return '<section class="en-g-win en-g-win-' + k + (extraCls ? " " + extraCls : "") + '" id="en-win-' + k + '" data-win="' + k + '" role="dialog" aria-labelledby="en-win-' + k + '-title" hidden>' +
      '<header class="en-g-win-head" data-drag><span class="en-g-win-icon" aria-hidden="true">' + (DOCK_ICON[k] || "") + '</span><b id="en-win-' + k + '-title" data-i18n="' + titleKey + '"></b>' +
      '<button type="button" class="en-g-x" data-win-close="' + k + '" data-close-label>×</button></header>' +
      '<div class="en-g-win-body">' + body + "</div></section>";
  }
  function buildSkeleton() {
    var dock = TABS.map(function (k) {
      return '<button type="button" class="en-g-dockbtn" id="en-tab-' + k + '" data-tab="' + k + '" aria-pressed="false">' +
        '<span class="en-g-dockicon" aria-hidden="true">' + DOCK_ICON[k] + '</span><span data-i18n="en_tab_' + k + '"></span></button>';
    }).join("");
    root.innerHTML =
      '<section id="en-title-screen" class="en-g-title">' +
        '<h1 class="en-title" data-i18n="en_title"></h1>' +
        '<p class="en-lead" data-i18n="en_title_lead"></p>' +
        '<div class="en-g-title-btns">' + btn("en-btn-new", "en_new", "is-on") + btn("en-btn-continue", "en_continue") + "</div>" +
      "</section>" +
      // 遊戲畫面：3D 舞台滿版，HUD、小地圖、dock、各種視窗都浮在舞台上
      '<section id="en-main" class="en-g-main" hidden>' +
        '<div id="en-stage" class="en-g-stage"><div id="en-stage-msg" class="en-g-stage-msg"></div></div>' +
        '<div class="en-g-top">' +
          '<div id="en-hud" class="en-g-hud">' +
            '<div class="en-g-hud-stats">' + stat("en-hud-day") + stat("en-hud-time") + stat("en-hud-weather") + stat("en-hud-cash") + stat("en-hud-rep") + stat("en-hud-guests") + "</div>" +
            '<div class="en-g-hud-ctl">' + btn("en-btn-open", "en_open", "en-g-open") + btn("en-btn-pause", "en_pause") +
              '<button type="button" id="en-btn-speed-1" class="en-btn en-g-speed" data-speed="1">×1</button>' +
              '<button type="button" id="en-btn-speed-2" class="en-btn en-g-speed" data-speed="2">×2</button>' +
              '<button type="button" id="en-btn-speed-4" class="en-btn en-g-speed" data-speed="4">×4</button>' +
            "</div>" +
          "</div>" +
          '<div class="en-g-toprow"><div id="en-area-bar" class="en-g-areabar" role="tablist"></div><div id="en-forecast" class="en-g-forecast"></div></div>' +
        "</div>" +
        '<div id="en-mode-bar" class="en-g-modebar" hidden><span id="en-mode-text"></span>' +
          '<button type="button" id="en-btn-rotate" class="en-btn"><span aria-hidden="true">↻ </span><span data-i18n="en_rotate"></span> <kbd>R</kbd></button>' + btn("en-btn-mode-cancel", "en_cancel") + "</div>" +
        '<div id="en-toast" class="en-g-toast" role="status" hidden></div>' +
        '<div id="en-mapbox" class="en-g-mapbox">' +
          '<button type="button" id="en-btn-map" class="en-g-maphead" aria-expanded="true"><span data-i18n="en_map"></span><i aria-hidden="true"></i></button>' +
          '<canvas id="en-minimap" width="' + M.W * CELL + '" height="' + M.H * CELL + '"></canvas>' +
        "</div>" +
        '<nav class="en-g-dock" role="toolbar">' + dock + "</nav>" +
        // 區域（購買、前往）
        win("area", "en_area_title", '<p class="en-note" data-i18n="en_area_note"></p><div id="en-area-list" class="en-g-list"></div>') +
        // 建造
        win("build", "en_tab_build",
          '<div class="en-g-row">' + btn("en-btn-path", "en_path") + btn("en-btn-unpath", "en_unpath") + btn("en-btn-cancel", "en_cancel") + "</div>" +
          '<p class="en-note" id="en-path-note"></p><div id="en-build-list" class="en-g-list"></div>') +
        // 工房
        win("work", "en_tab_work",
          '<h3 class="en-h3"><span data-i18n="en_machines"></span> <small id="en-machine-slots"></small></h3><div id="en-machine-list"></div>' +
          '<h3 class="en-h3" data-i18n="en_add_machine"></h3><div id="en-machine-add" class="en-g-chips"></div>' +
          '<h3 class="en-h3" data-i18n="en_market"></h3><div id="en-market" class="en-g-chips"></div>' +
          '<h3 class="en-h3"><span data-i18n="en_warehouse"></span> <small id="en-ware-total"></small></h3><div id="en-warehouse"></div>' +
          '<h3 class="en-h3" data-i18n="en_recipe_tree"></h3><div id="en-recipe-tree" class="en-g-tree"></div>') +
        // 樂園（入園費＋設施一覽；點設施開「設施詳細」視窗）
        win("park", "en_tab_park",
          '<label class="en-g-field"><span data-i18n="en_fee"></span> <input id="en-fee-input" type="number" min="0" max="2000" step="10" inputmode="numeric"></label>' +
          '<h3 class="en-h3" data-i18n="en_structs"></h3><div id="en-struct-list" class="en-g-list"></div>') +
        // 繪馬
        win("wish", "en_wish_title", '<div id="en-wish-board"></div>') +
        // murmur
        win("murmur", "en_tab_murmur", '<div id="en-mm-filters" class="en-g-chips"></div><ul id="en-murmur-wall" class="en-wall"></ul>') +
        // 設施詳細（點 3D／小地圖上的設施，或樂園視窗的設施一覽）
        '<section id="en-struct-panel" class="en-g-win en-g-win-struct" role="dialog" aria-labelledby="en-struct-title" hidden>' +
          '<header class="en-g-win-head" data-drag><span class="en-g-win-icon" aria-hidden="true">🔧</span><b id="en-struct-title" data-i18n="en_struct_win"></b>' +
          '<button type="button" class="en-g-x" data-struct-close data-close-label>×</button></header>' +
          '<div class="en-g-win-body">' +
            '<div id="en-struct-info"></div>' +
            '<div class="en-g-row" id="en-struct-ride">' +
              '<label class="en-g-field"><span data-i18n="en_price"></span> <input id="en-price-input" type="number" min="0" max="2000" step="10" inputmode="numeric"></label>' +
              '<button type="button" id="en-ticket-toggle" class="en-btn" aria-pressed="false"></button>' +
            "</div>" +
            '<div id="en-upgrade-list" class="en-g-list"></div>' +
            '<div class="en-g-row">' + btn("en-btn-repair", "en_repair") + btn("en-btn-demolish", "en_demolish", "en-g-danger") + "</div>" +
          "</div>" +
        "</section>" +
        // 跟拍（點客人或 murmur）
        '<section id="en-follow-panel" class="en-g-win en-g-win-follow" role="dialog" hidden></section>' +
      "</section>" +
      '<div id="en-day-summary" class="en-modal" hidden><div class="en-modal-box en-g-sum"><div id="en-day-summary-body"></div>' +
        btn("en-btn-next-day", "en_next_day", "is-on") + "</div></div>" +
      '<div id="en-season-summary" class="en-modal" hidden><div class="en-modal-box en-g-sum"><div id="en-season-summary-body"></div>' +
        btn("en-btn-restart", "en_restart", "is-on") + "</div></div>";
    ["en-btn-rotate", "en-area-bar", "en-area-list", "en-title-screen", "en-main", "en-stage", "en-stage-msg", "en-toast", "en-minimap", "en-mapbox", "en-btn-map", "en-mode-bar", "en-mode-text", "en-follow-panel", "en-forecast",
      "en-hud-day", "en-hud-time", "en-hud-weather", "en-hud-cash", "en-hud-rep", "en-hud-guests",
      "en-btn-open", "en-btn-pause", "en-btn-continue", "en-path-note", "en-build-list", "en-machine-slots", "en-machine-list", "en-machine-add",
      "en-market", "en-ware-total", "en-warehouse", "en-recipe-tree", "en-fee-input", "en-struct-panel", "en-struct-info", "en-struct-ride",
      "en-price-input", "en-ticket-toggle", "en-upgrade-list", "en-btn-repair", "en-btn-demolish", "en-struct-list", "en-wish-board",
      "en-mm-filters", "en-murmur-wall", "en-day-summary", "en-day-summary-body", "en-season-summary", "en-season-summary-body"
    ].forEach(function (id) { el[id.replace(/^en-/, "")] = $(id); });
    if (window.I18N) window.I18N.applyI18n();
    closeLabels();
    if (window.innerWidth < NARROW) setMapOpen(false); // 手機：小地圖預設收合
  }
  function closeLabels() {
    var xs = root.querySelectorAll("[data-close-label]");
    for (var i = 0; i < xs.length; i++) xs[i].setAttribute("aria-label", t("en_close"));
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
      var pa = Core.areaOf(it.y);
      if (!Core.areaOpen(s, pa) || it.x >= D.AREAS[pa].unlockX) return "locked";
      if (Core.isWater(it.x, it.y)) return "water";
      if (s.occ[Core.ti(it.x, it.y)] || s.tiles[Core.ti(it.x, it.y)] === 1) return "occupied";
      if (s.cash < D.PATH_COST) return "cash";
    }
    if (it.a === "buy") {
      if (s.cash < D.ITEMS[it.item].buy * it.n) return "cash";
      if (Core.wareTotal(s) + it.n > Core.wareCap(s)) return "full";
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
      if (it.a === "area") { toast(t("en_area_bought", { name: L(D.AREAS[Core.areaIndex(it.id)].name) })); setArea(Core.areaIndex(it.id)); }
      save();
    }
    mapDirty = true;
    refreshAll();
    return r;
  }

  // 放置／鋪路模式中先收起建造視窗（讓出畫面），取消模式時再打開
  function setMode(m) {
    mode = m;
    hover = null;
    if (three) three.ghost(null);
    mapDirty = true;
    if (m && wins.build) { modeHidBuild = true; showWin("build", false); }
    else if (!m && modeHidBuild) { modeHidBuild = false; showWin("build", true); }
    renderModeBar();
    renderBuildList();
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
    if (Core.areaOf(y) !== area && !mode) { setArea(Core.areaOf(y)); return; } // 點到遠方的其他區域：移動過去
    if (mode && mode.kind === "build") { doIntent({ a: "build", type: mode.type, x: x, y: y, rot: mode.rot }); return; }
    if (mode && mode.kind === "path") { pathAt(x, y); return; }
    var g = guestAt(x, y), sid = s.occ[Core.ti(x, y)];
    if (g && (preferGuest || !sid)) { follow(g.id); return; }
    if (sid) selectStruct(sid);
  }

  function selectStruct(sid) {
    selSid = sid;
    mapDirty = true;
    if (s && s.structs[sid]) toFront(el["struct-panel"]);
    refreshSide();
  }

  function follow(gid) {
    followGid = gid;
    if (gid != null) toFront(el["follow-panel"]);
    if (gid && s) for (var i = 0; i < s.guests.length; i++) if (s.guests[i].id === gid && (s.guests[i].area || 0) !== area) setArea(s.guests[i].area || 0, true);
    if (three) three.focusGuest(gid ? gid : null); // gid 0 = 小夜（不是客人，不移動鏡頭）
    mapDirty = true;
    renderFollow();
  }

  function setHover(p) {
    hover = p;
    mapDirty = true;
    if (!three) return;
    if (p && mode && mode.kind === "build") three.ghost(mode.type, p.x, p.y, Core.canBuild(s, mode.type, p.x, p.y, mode.rot).ok, mode.rot);
    else three.ghost(null);
  }

  // ---------------------------------------------------------------- 浮動視窗
  function toFront(node) { if (node) node.style.zIndex = String(++winZ); }
  function showWin(k, open) {
    // 窄螢幕的視窗是同高的底部抽屜：一次只開一個 dock 視窗
    if (open && window.innerWidth < NARROW) TABS.forEach(function (n) { if (n !== k && wins[n]) showWin(n, false); });
    wins[k] = !!open;
    var w = $("en-win-" + k), b = $("en-tab-" + k);
    w.hidden = !open;
    if (open) toFront(w);
    b.classList.toggle("is-on", !!open);
    b.setAttribute("aria-pressed", open ? "true" : "false");
  }
  // dock 按鈕：關著→打開；開著但被蓋住→拉到最前面；已在最前面→關閉
  function setTab(k) {
    if (k === "build" && mode) setMode(null); // 放置中按「建造」＝結束放置、回到建造視窗
    var w = $("en-win-" + k);
    if (wins[k] && +w.style.zIndex === winZ) showWin(k, false);
    else showWin(k, true);
    if (k === "build") modeHidBuild = false;
    refreshSide();
  }
  function closeAllWins() {
    TABS.forEach(function (k) { showWin(k, false); });
    modeHidBuild = false;
  }
  function setMapOpen(open) {
    el.mapbox.classList.toggle("is-min", !open);
    el["btn-map"].setAttribute("aria-expanded", open ? "true" : "false");
    mapDirty = true;
  }
  // 標題列拖曳（只在寬螢幕；位置以 left/top 存在 inline style，限制在遊戲畫面內）
  function bindDrag() {
    var cur = null;
    on(el.main, "pointerdown", function (e) {
      var w = closest(e, ".en-g-win");
      if (!w) return;
      toFront(w);
      var h = closest(e, "[data-drag]");
      if (!h || closest(e, "button") || window.innerWidth < NARROW) return;
      var r = w.getBoundingClientRect(), pr = el.main.getBoundingClientRect();
      cur = { w: w, dx: e.clientX - r.left, dy: e.clientY - r.top, pr: pr };
      w.style.right = "auto"; w.style.bottom = "auto";
      w.style.left = (r.left - pr.left) + "px"; w.style.top = (r.top - pr.top) + "px";
      w.classList.add("is-drag");
      if (h.setPointerCapture && e.pointerId != null) { try { h.setPointerCapture(e.pointerId); } catch (er) { /* 合成事件 */ } }
      e.preventDefault();
    });
    on(el.main, "pointermove", function (e) {
      if (!cur) return;
      var pr = cur.pr, ww = cur.w.offsetWidth;
      var x = Math.max(80 - ww, Math.min(pr.width - 80, e.clientX - pr.left - cur.dx));
      var y = Math.max(0, Math.min(pr.height - 40, e.clientY - pr.top - cur.dy));
      cur.w.style.left = x + "px"; cur.w.style.top = y + "px";
    });
    function end() { if (cur) { cur.w.classList.remove("is-drag"); cur = null; } }
    on(el.main, "pointerup", end);
    on(el.main, "pointercancel", end);
  }

  // 切換觀看的區域：3D 鏡頭移過去、小地圖與各視窗只顯示該區
  function setArea(a, keepFollow) {
    if (a < 0 || a >= D.AREAS.length) return;
    area = a;
    hover = null;
    if (selSid && s && s.structs[selSid] && Core.areaOf(s.structs[selSid].y) !== a) selSid = null;
    if (!keepFollow && followGid) follow(null);
    if (three) { three.ghost(null); three.setArea(a); }
    mapDirty = true;
    refreshAll();
  }

  // 放置中旋轉 90°（R 鍵或提示列的「↻」）：入口方向 下 → 左 → 上 → 右
  function rotateMode() {
    if (!mode || mode.kind !== "build") return;
    mode.rot = lastRot = (mode.rot + 1) % 4;
    setHover(hover);
    renderModeBar();
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
        three.setArea(area, true);
        syncWeather();
        return p;
      })
      .then(function () {
        threeState = "ok";
        el["stage-msg"].textContent = "";
      }, function (e) {
        // init 可能已經建了一半才失敗：不再呼叫 3D API（否則每一影格 three.sync 都丟例外、小地圖也不再更新）
        three = null;
        threeState = "error";
        el["stage-msg"].textContent = t("en_3d_error", { msg: e && e.message ? e.message : String(e) });
        el["stage-msg"].classList.add("is-error");
      });
  }

  // ---------------------------------------------------------------- HUD
  function statHTML(label, value, icon) { return (icon ? '<i aria-hidden="true">' + icon + "</i>" : "") + "<small>" + esc(label) + "</small><b>" + esc(value) + "</b>"; }
  function renderHud() {
    // 窄螢幕會隱藏 <small> 標籤，所以值本身要看得懂
    setHTML(el["hud-day"], '<i aria-hidden="true">📅</i><b>' + esc(t("en_day", { n: Math.min(s.day, D.SEASON_DAYS) })) + "</b><small>/" + D.SEASON_DAYS + "</small>");
    setHTML(el["hud-time"], '<i aria-hidden="true">🕘</i><b>' + hhmm(s.min) + "</b>" +
      (s.phase === "open" ? '<span class="en-g-dayprog"><span style="width:' + Math.round(Math.min(1, (s.min - D.DAY_START) / (D.DAY_END - D.DAY_START)) * 100) + '%"></span></span>' : ""));
    setHTML(el["hud-weather"], statHTML(t("en_weather"), L(D.WEATHER[weatherId()] ? D.WEATHER[weatherId()].name : null), WICON[weatherId()]));
    setHTML(el["hud-cash"], statHTML(t("en_cash"), yen(s.cash), "💴"));
    setHTML(el["hud-rep"], statHTML(t("en_rep"), s.rep + " · " + t("en_level", { n: Core.popLevel(s) }), "★"));
    setHTML(el["hud-guests"], statHTML(t("en_guests"), s.guests.length + (s.today && s.phase !== "plan" ? " / " + s.today.guests : ""), "👥"));
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
  function areaGuests(a) { var n = 0; s.guests.forEach(function (g) { if ((g.area || 0) === a) n++; }); return n; }
  function areaStructs(a) { var n = 0; for (var k in s.structs) if (Core.areaOf(s.structs[k].y) === a) n++; return n; }
  function renderAreaBar() {
    var h = "";
    D.AREAS.forEach(function (ar, a) {
      var open = Core.areaOpen(s, a);
      h += '<button type="button" class="en-g-areabtn' + (a === area ? " is-on" : "") + (open ? "" : " is-locked") + '" data-area="' + a + '" role="tab" aria-selected="' + (a === area) + '" title="' + esc(L(ar.name)) + '">' +
        '<span aria-hidden="true">' + (open ? ar.icon : "🔒") + "</span><span class=\"en-g-areaname\">" + esc(L(ar.name)) + "</span></button>";
    });
    setHTML(el["area-bar"], h);
  }
  function renderAreas() {
    var lv = Core.popLevel(s), h = "";
    D.AREAS.forEach(function (ar, a) {
      var open = Core.areaOpen(s, a), info, act;
      if (open) {
        info = '<span class="en-ok">' + esc(t("en_area_open")) + "</span> · " + esc(t("en_area_stat", { n: areaStructs(a), g: areaGuests(a) }));
        act = a === area ? '<span class="en-g-here">' + esc(t("en_area_here")) + "</span>" :
          '<button type="button" class="en-btn" data-area-go="' + a + '">' + esc(t("en_area_go")) + "</button>";
      } else {
        var c = Core.canUnlock(s, ar.id);
        info = '<span class="' + (lv >= ar.lv && s.cash >= ar.cash ? "en-ok" : "en-ng") + '">' + esc(t("en_area_need", { lv: ar.lv, cash: yen(ar.cash) })) + "</span>";
        act = '<button type="button" class="en-btn is-on" data-area-buy="' + ar.id + '"' + (c.ok ? "" : " disabled") + ">" + esc(t("en_area_buy", { cash: yen(ar.cash) })) + "</button>" +
          '<button type="button" class="en-btn" data-area-go="' + a + '">' + esc(t("en_area_go")) + "</button>";
      }
      var ex = [];
      for (var k in D.BUILD) if (D.BUILD[k].area === ar.id) ex.push(L(D.BUILD[k].name));
      h += '<div class="en-g-area' + (a === area ? " is-on" : "") + '"><div class="en-g-area-icon" aria-hidden="true">' + ar.icon + '</div><div class="en-g-area-main"><b>' + esc(L(ar.name)) + "</b><small>" + info + "</small>" +
        (ex.length ? '<small class="en-g-area-ex">' + esc(ex.join("・")) + "</small>" : "") + '</div><div class="en-g-area-act">' + act + "</div></div>";
    });
    setHTML(el["area-list"], h);
  }

  function renderModeBar() {
    var bar = el["mode-bar"];
    if (!mode) { bar.hidden = true; return; }
    bar.hidden = false;
    setText(el["mode-text"], mode.kind === "build" ? t("en_mode_build", { name: L(D.BUILD[mode.type].name), dir: t("en_dir_" + mode.rot) }) : t(mode.on ? "en_mode_path" : "en_mode_unpath"));
    el["btn-rotate"].hidden = mode.kind !== "build";
  }

  // ---------------------------------------------------------------- 側欄：建造
  function partsHTML(parts) {
    var h = "";
    for (var k in parts) {
      var n = s.ware[k] || 0;
      h += '<span class="' + (n >= parts[k] ? "en-ok" : "en-ng") + '">' + esc(itemName(k)) + " " + n + "/" + parts[k] + "</span>";
    }
    return h;
  }
  function renderBuildList() {
    if (!s) return;
    el["path-note"].textContent = t("en_path_cost", { n: D.PATH_COST });
    $("en-btn-path").classList.toggle("is-on", !!(mode && mode.kind === "path" && mode.on));
    $("en-btn-unpath").classList.toggle("is-on", !!(mode && mode.kind === "path" && !mode.on));
    var lv = Core.popLevel(s), h = "", ar = D.AREAS[area], ex = "", gen = "";
    if (!Core.areaOpen(s, area)) { setHTML(el["build-list"], '<p class="en-note en-ng">' + esc(t("en_err_locked")) + "</p>"); return; }
    for (var type in D.BUILD) {
      if (type === "shrine") continue;
      var b = D.BUILD[type];
      if (b.area && b.area !== ar.id) continue; // 其他區域的專屬設施不列出
      var meta = b.w + "×" + b.h + " · " + yen(b.cash) + (b.days ? " · " + t("en_build_days", { n: b.days }) : "") +
        (b.ware ? " · " + t("en_infra_ware", { n: b.ware }) : "") + (b.slots && b.kind === "infra" ? " · " + t("en_infra_slots", { n: b.slots }) : "");
      var ok = Core.have(s, b.parts) && s.cash >= b.cash && lv >= b.lv;
      h = '<button type="button" class="en-g-build' + (mode && mode.type === type ? " is-on" : "") + (ok ? "" : " is-short") + (b.large ? " is-large" : "") + (b.area ? " is-ex" : "") +
        '" data-build="' + type + '"><span class="en-g-build-kind" style="background:' + (b.large ? "#c8343a" : KIND_COLOR[b.kind] || "#999") + '" aria-hidden="true">' + (KIND_ICON[b.kind] || "") +
        '</span><span class="en-g-build-name">' + esc(L(b.name)) + '</span><span class="en-g-build-meta">' + esc(meta) +
        (lv < b.lv ? ' · <span class="en-ng">' + esc(t("en_need_lv", { n: b.lv })) + "</span>" : "") +
        '</span><span class="en-g-parts">' + partsHTML(b.parts) + "</span></button>";
      if (b.area) ex += h; else gen += h;
    }
    setHTML(el["build-list"], (ar.lake ? '<p class="en-note">' + esc(t("en_area_lake")) + "</p>" : "") +
      (ex ? '<h3 class="en-h3">' + esc(ar.icon + " " + t("en_area_exclusive")) + '</h3><div class="en-g-list">' + ex + '</div><h3 class="en-h3">' + esc(t("en_tab_build")) + "</h3>" : "") +
      '<div class="en-g-list">' + gen + "</div>");
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
        '<label class="en-g-limit"><span>' + esc(t("en_limit")) + '</span><input type="number" min="0" max="' + Core.wareCap(s) + '" data-limit="' + i +
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
    setText(el["ware-total"], t("en_ware_total", { n: Core.wareTotal(s), cap: Core.wareCap(s) }));
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
      ' <span class="' + (qty && n < qty ? "en-ng" : "en-ok") + '">' + esc(t("en_have", { n: n })) + "</span>";
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
    if (b.ware) return t("en_infra_ware", { n: b.ware });
    if (b.kind === "infra") return t("en_infra_slots", { n: b.slots });
    return "";
  }
  function renderPark() {
    if (document.activeElement !== el["fee-input"]) el["fee-input"].value = s.fee;
    el["fee-input"].disabled = s.phase !== "plan";
    var h = "", ids = Object.keys(s.structs).map(Number).filter(function (k) { return Core.areaOf(s.structs[k].y) === area; }).sort(function (a, b) { return a - b; });
    if (selSid && !s.structs[selSid]) selSid = null;
    ids.forEach(function (sid) {
      var st = s.structs[sid], stt = structStatus(st);
      h += '<button type="button" class="en-g-srow' + (sid === selSid ? " is-on" : "") + (st.broken ? " is-broken" : "") + '" data-struct="' + sid + '"><span>' +
        esc(L(D.BUILD[st.type].name)) + "</span><small>" + esc(stt) + "</small></button>";
    });
    setHTML(el["struct-list"], h);
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
    setHTML(el["struct-info"], "<h4>" + esc(L(b.name)) + (st.broken ? ' <span class="en-ng">' + esc(t("en_broken")) + "</span>" : "") + '</h4><dl class="en-g-dl">' + rows.join("") + "</dl>");
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
        '<span class="' + (have >= slot.n ? "en-ok" : "en-ng") + '">' + have + "/" + slot.n + "</span>") + "</small></button>";
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
      if (w.done) info = '<span class="en-ok">' + esc(t("en_wish_done")) + "</span>";
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
    var h = '<header class="en-g-win-head en-g-follow-head" data-drag>' + avatar(photo) + "<b>" + esc(t("en_follow") + "：" + name) +
      '</b><button type="button" class="en-g-x" data-follow-close aria-label="' + esc(t("en_close")) + '">×</button></header><div class="en-g-win-body">';
    if (g) {
      h += '<div class="en-g-needs"><span>' + esc(t("en_hap")) + '</span><span class="en-g-bar is-hap"><i style="width:' + Math.round(g.hap) + '%"></i></span><em>' + Math.round(g.hap) + "</em>";
      NEEDS.forEach(function (k) {
        var v = Math.round(Math.min(100, g.need[k] || 0));
        h += "<span>" + esc(t("en_need_" + k)) + '</span><span class="en-g-bar' + (v >= 70 ? " is-hot" : "") + '"><i style="width:' + v + '%"></i></span><em>' + v + "</em>";
      });
      h += "</div>";
    } else if (followGid !== 0) h += '<p class="en-note">' + esc(t("en_left")) + "</p>";
    if (mine.length) h += '<ul class="en-wall">' + mine.map(mmItem).join("") + "</ul>";
    setHTML(p, h + "</div>");
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

  // ---------------------------------------------------------------- 小地圖（2026-11-14 重新繪製：2 倍解析度、圓角建物與圖示、步道邊框、湖面波紋）
  var KIND_COLOR = { shrine: "#b23a2c", ride: "#e57a3c", stall: "#e8b830", qstall: "#d49a20", facility: "#3f8fc8", deco: "#8cc070", infra: "#7a8796" };
  var KIND_ICON = { shrine: "⛩", ride: "🎠", stall: "🏮", qstall: "🍡", facility: "🪑", deco: "✿", infra: "🏭" };
  var AREA_GROUND = { shrine: ["#78a557", "#7dab5c"], land: ["#86b85e", "#8fc066"], factory: ["#a3a39b", "#9b9b93"], water: ["#e2cf98", "#dcc890"], theme: ["#7c9c62", "#84a46a"] };
  var AREA_PATH = { shrine: "#e0cfa4", land: "#ecdcb6", factory: "#6f7076", water: "#c09060", theme: "#c46a56" };
  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }
  function drawMinimap() {
    var c = el.minimap, g = c.getContext("2d"), x, y, k, ar = D.AREAS[area], oy = area * M.H, open = Core.areaOpen(s, area);
    var gc = AREA_GROUND[ar.id] || AREA_GROUND.shrine, pc = AREA_PATH[ar.id] || AREA_PATH.shrine;
    // 地面：細格棋盤
    for (y = 0; y < M.H; y++) for (x = 0; x < M.W; x++) { g.fillStyle = gc[(x + y) % 2]; g.fillRect(x * CELL, y * CELL, CELL, CELL); }
    if (ar.lake) {
      var lk = ar.lake, lg = g.createLinearGradient(0, lk.y * CELL, 0, (lk.y + lk.h) * CELL);
      lg.addColorStop(0, "#3b7fc0"); lg.addColorStop(1, "#5aa6dc");
      g.fillStyle = lg; rrect(g, lk.x * CELL, lk.y * CELL, lk.w * CELL, lk.h * CELL, 8); g.fill();
      g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1.5;
      for (y = lk.y + 1; y < lk.y + lk.h; y += 2) {
        g.beginPath();
        for (x = lk.x * CELL + 6; x < (lk.x + lk.w) * CELL - 6; x += 4) g.lineTo(x, y * CELL + Math.sin(x * 0.25 + y) * 2);
        g.stroke();
      }
    }
    if (ar.unlockX < M.W) { g.fillStyle = "rgba(30,40,20,.35)"; g.fillRect(ar.unlockX * CELL, 0, (M.W - ar.unlockX) * CELL, c.height); }
    // 步道：先畫深色邊，再畫路面（相鄰格相連）
    var paths = [];
    for (y = 0; y < M.H; y++) for (x = 0; x < M.W; x++) if (s.tiles[Core.ti(x, y + oy)] === 1) paths.push([x, y]);
    g.fillStyle = "rgba(60,45,30,.35)";
    paths.forEach(function (p) { g.fillRect(p[0] * CELL - 1, p[1] * CELL - 1, CELL + 2, CELL + 2); });
    g.fillStyle = pc;
    paths.forEach(function (p) { g.fillRect(p[0] * CELL + 1, p[1] * CELL + 1, CELL - 2, CELL - 2); });
    g.fillStyle = "rgba(255,255,255,.18)";
    paths.forEach(function (p) { g.fillRect(p[0] * CELL + 1, p[1] * CELL + 1, CELL - 2, 3); });
    // 建物：圓角＋陰影＋圖示＋入口點
    g.textAlign = "center"; g.textBaseline = "middle";
    for (k in s.structs) {
      var st = s.structs[k];
      if (Core.areaOf(st.y) !== area) continue;
      var b = D.BUILD[st.type], dm = Core.dims(st.type, st.rot), px = st.x * CELL, py = (st.y - oy) * CELL, w = dm.w * CELL, h = dm.h * CELL;
      g.fillStyle = "rgba(0,0,0,.22)"; rrect(g, px + 3, py + 4, w - 4, h - 4, 5); g.fill();
      g.fillStyle = b.large ? "#c8343a" : KIND_COLOR[b.kind] || "#999"; rrect(g, px + 2, py + 2, w - 4, h - 4, 5); g.fill();
      g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1.5; g.stroke();
      if (st.build > 0) { // 施工中：斜線
        g.save(); rrect(g, px + 2, py + 2, w - 4, h - 4, 5); g.clip();
        g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 3; g.beginPath();
        for (var d = -h; d < w; d += 9) { g.moveTo(px + d, py + h); g.lineTo(px + d + h, py); }
        g.stroke(); g.restore();
      }
      if (Math.min(w, h) >= CELL * 2) { g.font = Math.min(w, h) * 0.45 + "px sans-serif"; g.fillText(KIND_ICON[b.kind] || "", px + w / 2, py + h / 2 + 1); }
      if (st.type !== "shrine") {
        var e = Core.entranceOf(st);
        g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(e.x * CELL + CELL / 2, (e.y - oy) * CELL + CELL / 2, 3, 0, Math.PI * 2); g.fill();
      }
      if (st.broken) {
        g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath();
        g.moveTo(px + 6, py + 6); g.lineTo(px + w - 6, py + h - 6); g.moveTo(px + w - 6, py + 6); g.lineTo(px + 6, py + h - 6); g.stroke();
      }
      if (+k === selSid) { g.strokeStyle = "#ffe14a"; g.lineWidth = 3; rrect(g, px + 1, py + 1, w - 2, h - 2, 6); g.stroke(); }
    }
    // 入口
    g.fillStyle = "#c8282e"; rrect(g, 0, M.GATE.y * CELL - 4, 6, CELL + 8, 2); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(9, M.GATE.y * CELL + 4); g.lineTo(15, M.GATE.y * CELL + CELL / 2); g.lineTo(9, M.GATE.y * CELL + CELL - 4); g.fill();
    // 客人
    s.guests.forEach(function (gu) {
      if ((gu.area || 0) !== area) return;
      var on = gu.id === followGid;
      g.fillStyle = on ? "#ffe14a" : "#ffffff"; g.strokeStyle = "rgba(43,34,48,.8)"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(gu.x * CELL + CELL / 2, (gu.y - oy) * CELL + CELL / 2, on ? 6 : 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
    });
    if (!open) { // 未開放：整張蓋暗並寫上條件
      g.fillStyle = "rgba(20,16,28,.62)"; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#fff"; g.font = "bold 36px sans-serif";
      g.fillText("🔒 " + t("en_area_need", { lv: ar.lv, cash: yen(ar.cash) }), c.width / 2, c.height / 2);
    }
    if (hover && mode && Core.areaOf(hover.y) === area) {
      var hy = hover.y - oy;
      if (mode.kind === "build") {
        var hd = Core.dims(mode.type, mode.rot), ok = Core.canBuild(s, mode.type, hover.x, hover.y, mode.rot).ok;
        g.fillStyle = ok ? "rgba(64,208,96,.55)" : "rgba(224,64,64,.55)";
        rrect(g, hover.x * CELL, hy * CELL, hd.w * CELL, hd.h * CELL, 5); g.fill();
        var he = Core.entranceAt(mode.type, hover.x, hover.y, mode.rot); // 入口格
        g.fillStyle = "rgba(255,224,64,.9)"; g.fillRect(he.x * CELL + 4, (he.y - oy) * CELL + 4, CELL - 8, CELL - 8);
      } else {
        g.strokeStyle = mode.on ? "#fff" : "#e04040"; g.lineWidth = 3;
        g.strokeRect(hover.x * CELL + 2, hy * CELL + 2, CELL - 4, CELL - 4);
      }
    }
    mapDirty = false;
  }
  function mapTile(e) {
    var r = el.minimap.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var x = Math.floor((e.clientX - r.left) / r.width * M.W), y = Math.floor((e.clientY - r.top) / r.height * M.H);
    if (y < 0 || y >= M.H) return null;
    y += area * M.H; // 小地圖只畫目前區域 → 換成世界座標
    return Core.inMap(x, y) ? { x: x, y: y } : null;
  }

  // ---------------------------------------------------------------- 刷新
  function refreshSide() {
    if (!s) return;
    sideAt = Date.now();
    renderAreaBar();
    if (wins.area) renderAreas();
    if (wins.build || mode) renderBuildList();
    if (wins.work) renderWork();
    if (wins.park) renderPark();
    if (wins.wish) renderWish();
    if (wins.murmur) renderMurmur();
    renderStructPanel();
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
    if (mapDirty) drawMinimap(); // 先畫小地圖：就算 3D 出錯，2D 介面也照常更新
    if (three) three.sync(s, s.phase === "open" ? Math.min(1, acc / stepSec) : 1);
  }

  // ---------------------------------------------------------------- 開始
  function startGame(ns) {
    s = ns;
    el["title-screen"].hidden = true;
    el.main.hidden = false;
    mode = null; selSid = null; followGid = null; treeItem = null; hover = null; acc = 0; area = 0;
    closeAllWins();
    speed = 1; lastSpeed = 1;
    var arr = s.today ? s.today.murmurs : [];
    lastMm = arr.length ? arr[arr.length - 1] : null;
    if (three) { three.focusGuest(null); three.setArea(0, true); }
    start3D();
    syncWeather();
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
    on($("en-btn-restart"), "click", newGame);
    on($("en-btn-path"), "click", function () { setMode({ kind: "path", on: true }); });
    on($("en-btn-unpath"), "click", function () { setMode({ kind: "path", on: false }); });
    on($("en-btn-cancel"), "click", function () { setMode(null); });
    on($("en-btn-mode-cancel"), "click", function () { setMode(null); });
    on(el["btn-rotate"], "click", rotateMode);
    on(el["btn-map"], "click", function () { setMapOpen(el.mapbox.classList.contains("is-min")); });
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
      if ((b = closest(e, "[data-area]"))) { var ai = +b.getAttribute("data-area"); if (Core.areaOpen(s, ai)) setArea(ai); else { setArea(ai); if (!wins.area) setTab("area"); } return; }
      if ((b = closest(e, "[data-area-go]"))) { setArea(+b.getAttribute("data-area-go")); return; }
      if ((b = closest(e, "[data-area-buy]"))) { doIntent({ a: "area", id: b.getAttribute("data-area-buy") }); return; }
      if ((b = closest(e, "[data-build]"))) { var ty = b.getAttribute("data-build"); setMode(mode && mode.type === ty ? null : { kind: "build", type: ty, rot: lastRot }); return; }
      if ((b = closest(e, "[data-buy]"))) { doIntent({ a: "buy", item: b.getAttribute("data-buy"), n: 10 }); return; }
      if ((b = closest(e, "[data-machine]"))) { doIntent({ a: "machine", type: b.getAttribute("data-machine") }); return; }
      if ((b = closest(e, "[data-tree]"))) { treeItem = b.getAttribute("data-tree"); renderWarehouse(); renderTree(); return; }
      if ((b = closest(e, "[data-struct]"))) { selectStruct(+b.getAttribute("data-struct")); return; }
      if ((b = closest(e, "[data-upgrade]"))) { if (selSid) doIntent({ a: "upgrade", sid: selSid, slot: b.getAttribute("data-upgrade") }); return; }
      if ((b = closest(e, "[data-mm-filter]"))) { mmFilter = b.getAttribute("data-mm-filter"); renderMurmur(); return; }
      if ((b = closest(e, "[data-follow-close]"))) { follow(null); return; }
      if ((b = closest(e, "[data-win-close]"))) { showWin(b.getAttribute("data-win-close"), false); return; }
      if ((b = closest(e, "[data-struct-close]"))) { selSid = null; mapDirty = true; refreshSide(); return; }
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
      if ((s.machines[mi].limit || null) !== (v || null)) doIntent({ a: "limit", mi: mi, n: v || null }, true); // 0＝不限（送 null）
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

    bindDrag();
    window.addEventListener("i18n:change", function () { closeLabels(); refreshAll(); });
    // Esc：先結束放置模式，否則關掉最前面的視窗
    document.addEventListener("keydown", function (e) {
      if ((e.key === "r" || e.key === "R") && mode && !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "")) { rotateMode(); return; }
      if (e.key !== "Escape" || !s) return;
      if (mode) { setMode(null); return; }
      var top = null, ws = el.main.querySelectorAll(".en-g-win:not([hidden])");
      for (var i = 0; i < ws.length; i++) if (!top || +ws[i].style.zIndex > +top.style.zIndex) top = ws[i];
      if (!top) return;
      if (top === el["struct-panel"]) { selSid = null; mapDirty = true; refreshSide(); }
      else if (top === el["follow-panel"]) follow(null);
      else showWin(top.getAttribute("data-win"), false);
    });
  }

  // ---------------------------------------------------------------- 測試用
  var api = {
    _state: function () { return s; },
    _intent: function (it) { var r = doIntent(it, true); return { ok: r.ok, err: r.err }; },
    _speed: function () { return speed; },
    _area: function (a) { if (a != null) setArea(a); return area; },
    _mode: function () { return mode; },
    _fast: undefined,
  };
  window.PriTestEnnichiGame = api;

  document.body.classList.add("en-body"); // 滿版：只留上方導覽列（css/ennichi.css 的 body.en-body）
  buildSkeleton();
  el["btn-continue"].disabled = !loadSave();
  bind();
  requestAnimationFrame(loop);
})();
