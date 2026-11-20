// 煉金術士（atelier）：畫面、存檔、相機操作。規則全部在 atelier_core.js／atelier_method_board.js。
(function () {
  "use strict";
  var D = window.PriTestAtelierData, C = window.PriTestAtelierCore, H = window.PriTestAtelierHosts;
  var CAM = window.PriTestAtelierCamera, COLORS = window.PriTestAtelierColors;
  var KEY = "pritest-atelier-save-v1";
  var TABS = ["gather", "box", "lab", "tasks", "dex", "book", "shop"];
  var app = document.getElementById("at-app");
  if (!app) return;

  var save = load();
  var ui = { tab: "gather", swatches: null, picks: [], scene: null, recipe: null, slots: [], cauldron: "copper", session: null,
    sel: -1, rot: 0, ghost: null, traits: [], result: null, line: null, dev: false, resetArm: false, msg: "", wbMode: false, subs: [],
    catalyst: "", catalystEl: "fire", challengeResult: null, replay: null,
    harmony: null, rainbow: false, filter: false, page: "goldfish", region: null };
  var replayTimer = null;

  // ---------- 共用 ----------
  function now() { return Date.now() + (save.offsetMs || 0); }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function loc(o) { var l = lang(); return o[l] || (l === "en" && o.ja) || o.zh || o.ja || ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el(id) { for (var i = 0; i < D.ELEMENTS.length; i++) if (D.ELEMENTS[i].id === id) return D.ELEMENTS[i]; return null; }
  function colorOf(id) { for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i]; return null; }
  function host() { return H[save.host]; }
  function say(key) { var arr = host().lines[key] || host().lines.ok; ui.line = arr[Math.floor(Math.random() * arr.length)]; }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1 && Array.isArray(s.mats)) return C.migrate(s);
    } catch (e) { /* 壞檔就重建 */ }
    return C.newSave(Date.now());
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 容量不足時只保留記憶體中的狀態 */ } }
  function recipeName(id) { return loc(C.recipe(id).name); }
  // C3：每次操作後檢查有沒有想到新配方
  function addMsg(text) { ui.msg = (ui.msg ? ui.msg + "　" : "") + text; }
  function ideas() {
    var got = C.checkIdeas(save);
    if (got.length) { say("idea"); addMsg(t("at_idea_new", { names: got.map(recipeName).join("、") })); }
    var titles = C.checkTitles(save);                                   // §10.8 稱號
    if (titles.length) {
      say("title");
      addMsg(t("at_title_new", { names: titles.map(function (id) { return loc(titleById(id).name); }).join("、") }));
    }
    return got;
  }
  function titleById(id) { return D.TITLES.filter(function (x) { return x.id === id; })[0]; }
  function matName(m) {
    if (m.fromItem) return "★" + recipeName(m.fromItem);
    if (m.rainbow) return t("at_rainbow_mat");
    return loc(colorOf(m.colorId).name);
  }

  // 素材形狀的小圖（色覺友善：同時顯示屬性圖形）
  function shapeHtml(m, cls) {
    var w = 0, h = 0;
    m.shape.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
    var on = {}; m.shape.forEach(function (c) { on[c[0] + "," + c[1]] = true; });
    var out = '<span class="at-shape ' + (cls || "") + '" style="grid-template-columns:repeat(' + w + ',1fr)">';
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
      out += on[x + "," + y] ? '<i style="background:' + m.hex + '">' + el(m.element).icon + "</i>" : "<i class=\"at-off\"></i>";
    return out + "</span>";
  }
  function matHtml(m) {
    var e = el(m.element);
    return '<span class="at-mat-name">' + esc(matName(m)) + "</span>" +
      '<span class="at-tag" style="border-color:' + e.color + '">' + e.icon + " " + t("at_el_" + m.element) + "</span>" +
      '<span class="at-tag">' + t("at_cat_" + m.category) + "</span>" +
      '<span class="at-tag">' + t("at_quality", { n: m.quality }) + "</span>" +
      '<span class="at-tag">' + t("at_power", { n: m.power }) + "</span>" +
      m.traits.map(function (tr) { return '<span class="at-tag at-trait">' + esc(loc(D.TRAITS[tr].name)) + "</span>"; }).join("");
  }
  function fxText(e) { return e.kind ? t("at_fx_" + e.kind, { n: e.n }) : t("at_fx_none"); }
  function ideaHint(r) {
    var i = r.idea;
    if (i.seen) return t("at_idea_seen", { color: loc(colorOf(i.seen).name) });
    if (i.seenCount) return t("at_idea_seenCount", { n: i.seenCount });
    if (i.seenEl) return t("at_idea_seenEl", { n: i.seenEl.n, el: t("at_el_" + i.seenEl.el) });
    if (i.made) return t("at_idea_made", { recipe: recipeName(i.made) });
    if (i.quality) return t("at_idea_quality", { recipe: recipeName(i.quality.recipe), n: i.quality.n });
    return "";
  }

  // ---------- 畫面 ----------
  function render() {
    C.refillBasket(save, now());
    var h = host(), hs = save.hosts[save.host];
    var tutStep = save.host === "ruri" ? save.tutorial : (hs.tut || 0);
    var tutorial = ui.tab === "lab" && tutStep < h.tutorial.length ? h.tutorial[tutStep] : null;
    var line = tutorial || ui.line || h.lines.greet[0];
    var html = '<header class="at-head">' +
      '<div class="at-avatar" style="background:' + h.color + '">' + h.glyph + "</div>" +
      '<div class="at-who"><b>' + esc(loc(h.name)) + "</b> <small>" + esc(loc(h.title)) + "</small><br><small>" +
      t("at_level", { n: C.level(save) }) + "・" + t("at_aff", { n: hs.aff }) + "・" + t("at_ash", { n: save.ash }) + "・" + t("at_coins", { n: save.coins }) +
      (save.title ? '<br><span class="at-title-tag" id="at-title">〈' + esc(loc(titleById(save.title).name)) + "〉</span>" : "") + "</small></div>" +
      '<p id="at-line" class="at-bubble' + (tutorial ? " at-tutorial" : "") + '">' + esc(loc(line)) + "</p></header>" +
      '<nav class="at-tabs">' + TABS.map(function (k) {
        return '<button type="button" data-at-tab="' + k + '" class="' + (ui.tab === k ? "at-on" : "") + '">' + t("at_tab_" + k) + "</button>";
      }).join("") + "</nav>";
    if (ui.msg) html += '<p class="at-msg" id="at-msg">' + esc(ui.msg) + "</p>";
    if (ui.replay) html += renderReplay();
    html += '<section class="at-body">' + ({ gather: renderGather, box: renderBox, lab: renderLab, tasks: renderTasks, dex: renderDex, book: renderBook, shop: renderShop })[ui.tab]() + "</section>";
    html += renderDev();
    var video = app.querySelector("#at-video");
    app.innerHTML = html;
    // 相機播放中時保留同一個 <video>，避免每次重繪都斷線
    var slot = app.querySelector("#at-video-slot");
    if (slot) {
      if (!video) { video = document.createElement("video"); video.id = "at-video"; video.className = "at-video"; }
      slot.appendChild(video);
      if (CAM.isOpen() && video.paused) video.play().catch(function () { /* 重新掛上後自動播放失敗時，等使用者再按一次 */ });
    }
  }

  function renderGather() {
    var b = save.basket, n = now(), mins = b.n >= D.BASKET_MAX ? 0 : Math.ceil((b.at + D.BASKET_REFILL_MS - n) / 60000);
    var daily = C.dailyColor(n), doneToday = save.daily.date === C.jstDate(n);
    var st = save.streak, stN = st.date && C.dayDiff(st.date, C.jstDate(n)) <= 1 ? st.n : 0;
    var out = '<div class="at-daily" id="at-daily"><span class="at-chip" style="background:' + daily.hex + '"></span>' +
      t("at_daily", { name: loc(daily.name) }) + (doneToday ? " " + t("at_daily_done") : "") + "</div>" +
      '<p class="at-basket" id="at-basket">' + t("at_basket", { n: b.n, max: D.BASKET_MAX }) +
      (mins > 0 ? "　" + t("at_basket_next", { m: mins }) : "") + "<br>" +
      '<span id="at-streak">' + t("at_streak", { n: stN, b: C.streakBonus(stN) }) + "</span><br>" +
      '<span id="at-wb-status">' + (C.wbActive(save, n) ? t("at_wb_on", { m: Math.ceil((save.wb.until - n) / 60000) }) : "") + "</span></p>" +
      '<div id="at-video-slot" class="at-video-slot' + (CAM.isOpen() ? "" : " at-hidden") + '"><span class="at-reticle"></span></div>' +
      '<div class="at-row">' +
      (CAM.supported() ? (CAM.isOpen()
        ? '<button type="button" id="at-cam-shot" class="at-main">' + t(ui.wbMode ? "at_wb" : "at_cam_shot") + '</button><button type="button" id="at-cam-close">' + t("at_cam_close") + "</button>"
        : '<button type="button" id="at-cam-open" class="at-main">' + t("at_cam_open") + "</button>") : "") +
      '<label class="at-file">' + t("at_upload") + '<input type="file" id="at-file" accept="image/*"></label>' +
      '<button type="button" id="at-walk">' + t("at_walk") + "</button>" +
      '<button type="button" id="at-wb" class="' + (ui.wbMode ? "at-on" : "") + '">' + t("at_wb") + "</button>" +
      (save.tools.glasses ? '<button type="button" id="at-filter" class="' + (ui.filter ? "at-on" : "") + '">' + t("at_filter") + "</button>" : "") + "</div>";
    if (save.tools.loupe) out += '<p class="at-hint" id="at-loupe">' + t("at_loupe") + "</p>";
    var season = C.seasonOf(n);
    out += '<p class="at-season" id="at-season">' + t("at_season", { season: t("at_season_" + season) }) +
      D.SEASONS[season].colors.map(function (id) { var c = colorOf(id); return '<span class="at-chip at-chip-s" title="' + esc(loc(c.name)) + '" style="background:' + c.hex + '"></span>'; }).join("") + "</p>";
    if (ui.wbMode) out += '<p class="at-hint" id="at-wb-hint">' + t("at_wb_hint") + "</p>";
    if (ui.swatches && ui.harmony) out += '<p class="at-push" id="at-harmony">' + t("at_harmony", { kind: t("at_harmony_" + ui.harmony) }) + "</p>";
    if (ui.swatches && ui.rainbow) out += '<p class="at-push" id="at-rainbow">' + t("at_rainbow") + "</p>";
    if (ui.scene) out += '<img class="at-scene" id="at-scene" alt="" src="' + ui.scene + '">';
    if (ui.swatches) {
      out += '<p class="at-hint">' + t("at_pick_hint", { n: D.PICK_MAX }) + '</p><ul class="at-swatches" id="at-swatches">';
      ui.swatches.forEach(function (s, i) {
        var m = C.makeMaterial(s, n, 0, { daily: C.isDailyHit(s.rgb, n) }), on = ui.picks.indexOf(i) >= 0;
        out += '<li><button type="button" data-at-pick="' + i + '" class="at-swatch' + (on ? " at-on" : "") + '">' +
          '<span class="at-chip" style="background:' + s.hex + '"></span>' + shapeHtml(m) + matHtml(m) +
          (save.seen[m.colorId] ? "" : '<span class="at-tag at-new">' + t("at_new") + "</span>") +
          '<span class="at-tag">' + Math.round(s.frac * 100) + "%</span></button></li>";
      });
      out += '</ul><button type="button" id="at-collect" class="at-main"' + (ui.picks.length && b.n > 0 ? "" : " disabled") + ">" + t("at_collect") + "</button>";
    }
    return out;
  }

  function renderBox() {
    var out = "<h3>" + t("at_tab_box") + " (" + save.mats.length + "/" + C.matMax(save) + ')</h3><p class="at-hint">' + t("at_sublimate_hint") + '</p><ul class="at-list" id="at-mats">';
    if (!save.mats.length) out += "<li>" + t("at_box_empty") + "</li>";
    save.mats.forEach(function (m) {
      out += '<li data-at-uid="' + m.uid + '"><label class="at-subpick"><input type="checkbox" data-at-sub="' + m.uid + '"' +
        (ui.subs.indexOf(m.uid) >= 0 ? " checked" : "") + "></label>" + shapeHtml(m) + matHtml(m) + "</li>";
    });
    out += '</ul><button type="button" id="at-sublimate"' + (ui.subs.length === D.SUBLIMATE_N ? "" : " disabled") + ">" + t("at_sublimate") + "</button>";
    out += "<h3>" + t("at_items") + '</h3><ul class="at-list" id="at-items">';
    if (!save.items.length) out += "<li>" + t("at_items_empty") + "</li>";
    save.items.forEach(function (it) {
      out += "<li>" + itemHtml(it) + (it.replay ? ' <button type="button" data-at-replay="' + it.uid + '">' + t("at_replay") + "</button>" : "") + "</li>";
    });
    return out + "</ul>";
  }
  function itemHtml(it) {
    return '<span class="at-mat-name">' + (it.great ? "✨" : "") + esc(recipeName(it.recipe)) + "</span>" +
      '<span class="at-tag">' + t("at_quality", { n: it.quality }) + "</span>" +
      it.effects.map(function (e) { return '<span class="at-tag" style="border-color:' + el(e.el).color + '">' + el(e.el).icon + " " + esc(fxText(e)) + "</span>"; }).join("") +
      it.traits.map(function (tr) { return '<span class="at-tag at-trait">' + esc(loc(D.TRAITS[tr].name)) + "</span>"; }).join("");
  }

  function renderLab() {
    if (ui.result) {
      return '<div id="at-result" class="at-result' + (ui.result.great ? " at-great" : "") + '"><h3>' + t("at_result") + "</h3>" +
        (ui.result.great ? '<p class="at-great-text" id="at-great">' + t("at_great") + "</p>" : "") +
        (ui.result.overheat ? '<p class="at-warn" id="at-overheat-result">' + t("at_overheat_done") + "</p>" : "") +
        "<p>" + itemHtml(ui.result) + "</p><p>" +
        t("at_best", { n: save.best[ui.result.recipe] }) + (ui.result.ash ? "　" + t("at_ash_gain", { n: ui.result.ash }) : "") +
        '</p><div class="at-row"><button type="button" data-at-replay="' + ui.result.uid + '">' + t("at_replay") + "</button>" +
        '<button type="button" id="at-result-close" class="at-main">' + t("at_back") + "</button></div></div>";
    }
    if (ui.challengeResult) {
      var cr = ui.challengeResult;
      return '<div id="at-challenge-result" class="at-result"><h3>' + t("at_weekly_done", { score: cr.score, best: cr.best }) + "</h3>" +
        (cr.first ? "<p>" + t("at_weekly_first", { n: D.WEEKLY_EXP }) + "</p>" : "") +
        '<button type="button" id="at-challenge-close" class="at-main">' + t("at_back") + "</button></div>";
    }
    if (ui.session) return renderBoard();
    var left = save.cooldownUntil - now();
    if (left > 0) return '<p id="at-cooldown" class="at-cooldown">' + t("at_cooldown", { m: Math.ceil(left / 60000) }) + "</p>";
    if (!ui.recipe) {
      return "<h3>" + t("at_recipes") + '</h3><ul class="at-list" id="at-recipes">' + D.RECIPES.map(function (r) {
        var lvOk = r.lv <= C.level(save), known = C.recipeKnown(save, r), ok = C.recipeAvailable(save, r, now());
        var note = !lvOk ? t("at_recipe_locked", { n: r.lv }) + (known ? "" : "　" + ideaHint(r)) : !known ? t("at_recipe_idea") + "　" + ideaHint(r) :
          (save.best[r.id] ? t("at_best", { n: save.best[r.id] }) : "");
        if (r.season) note = t("at_recipe_season", { season: t("at_season_" + r.season) }) + (note ? "　" + note : "");
        return '<li><button type="button" data-at-recipe="' + r.id + '"' + (ok ? "" : " disabled") + ">" +
          esc(known ? loc(r.name) : "？？？") + (note ? " — " + esc(note) : "") + "</button></li>";
      }).join("") + "</ul>";
    }
    var r = C.recipe(ui.recipe), out = "<h3>" + esc(loc(r.name)) + "</h3>";
    out += '<label class="at-slot">' + t("at_cauldron") + '<select id="at-cauldron">' + D.CAULDRON_ORDER.filter(function (id) { return C.cauldronLv(save, id); }).map(function (id) {
      var c = D.CAULDRONS[id], good = c.affinity.indexOf(r.id) >= 0;
      return '<option value="' + id + '"' + (ui.cauldron === id ? " selected" : "") + ">" + esc(loc(c.name)) + " Lv" + C.cauldronLv(save, id) +
        " (" + c.pattern.length + "×" + c.pattern.length + ")" + (good ? " ★" + t("at_affinity") : "") + "</option>";
    }).join("") + "</select></label><div id=\"at-slots\">";
    var pool = save.mats.concat(save.items.filter(function (it) { return !C.displayed(save, it.uid); }).map(C.itemAsMaterial));
    r.needs.forEach(function (need, i) {
      out += '<label class="at-slot">' + t("at_slot", { n: i + 1, need: need === "*" ? t("at_any") : t("at_cat_" + need) }) +
        '<select data-at-slot="' + i + '"><option value="">' + t("at_choose") + "</option>";
      pool.forEach(function (m) {
        if (!C.slotOk(need, m)) return;
        if (ui.slots.some(function (u, j) { return j !== i && u === m.uid; })) return;
        out += '<option value="' + m.uid + '"' + (ui.slots[i] === m.uid ? " selected" : "") + ">" +
          esc(matName(m)) + " / " + el(m.element).icon + " / " + t("at_quality", { n: m.quality }) + " / " + t("at_cells", { n: m.shape.length }) + "</option>";
      });
      out += "</select></label>";
    });
    if (C.level(save) >= D.ADVANCED_LV) {
      out += '<label class="at-slot">' + t("at_catalyst") + '<select id="at-catalyst"><option value="">' + t("at_catalyst_none") + "</option>" +
        D.CATALYST_ORDER.filter(function (id) { return save.catalysts[id] > 0; }).map(function (id) {
          return '<option value="' + id + '"' + (ui.catalyst === id ? " selected" : "") + ">" + esc(loc(D.CATALYSTS[id].name)) + " ×" + save.catalysts[id] + "</option>";
        }).join("") + "</select></label>";
      if (ui.catalyst && D.CATALYSTS[ui.catalyst].needsEl) {
        out += '<label class="at-slot">' + t("at_catalyst_el") + '<select id="at-catalyst-el">' + D.ELEMENTS.map(function (e) {
          return '<option value="' + e.id + '"' + (ui.catalystEl === e.id ? " selected" : "") + ">" + e.icon + " " + t("at_el_" + e.id) + "</option>";
        }).join("") + "</select></label>";
      }
    }
    var ready = r.needs.every(function (n, i) { return ui.slots[i]; });
    return out + '</div><div class="at-row"><button type="button" id="at-back">' + t("at_back") + '</button><button type="button" id="at-start" class="at-main"' +
      (ready ? "" : " disabled") + ">" + t("at_start") + "</button></div>";
  }

  // 棋盤格（調和與回放共用）。id＝null 時不加 data-at-cell（回放用）
  function boardHtml(s, ghostSet, id) {
    var out = '<div class="at-board' + (id ? "" : " at-board-mini") + '"' + (id ? ' id="' + id + '"' : "") + ' style="grid-template-columns:repeat(' + s.size + ',1fr)">';
    for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) {
      var idx = y * s.size + x, cell = s.cells[idx], o = s.owner[idx], cls = "at-cell";
      var bg = cell.color ? el(cell.color).color : "";
      var inner = cell.color ? el(cell.color).icon : "";
      if (!cell.color) cls += " at-plain";
      if (cell.bonus) cls += " at-bonus";
      if (o >= 0) { cls += " at-filled"; bg = s.mats[o].hex; inner = el(s.mats[o].element).icon; }
      if (ghostSet[x + "," + y]) cls += " at-ghost";
      out += (id ? '<button type="button" data-at-cell="' + x + "," + y + '"' : "<span") + ' class="' + cls + '" style="--at-c:' + (bg || "var(--at-line)") + '">' + inner + (id ? "</button>" : "</span>");
    }
    return out + "</div>";
  }
  // §11 各調和方式的畫面。interactive＝false 時用在回放（不可點）
  function cellButton(interactive, x, cls, style, inner) {
    return interactive ? '<button type="button" data-at-cell="' + x + ',0" class="' + cls + '"' + style + ">" + inner + "</button>"
      : '<span class="' + cls + '"' + style + ">" + inner + "</span>";
  }
  function ringHtml(s, ghostSet, interactive) {
    var out = '<div class="at-ring" id="' + (interactive ? "at-ring" : "") + '">';
    s.nodes.forEach(function (node, i) {
      var e = el(node.el), segs = "", used = 0;
      node.fill.forEach(function (f) { used += f.n; segs += '<i style="flex:' + f.n + ";background:" + s.mats[f.mi].hex + '"></i>'; });
      if (used < D.RING_CAP) segs += '<i class="at-empty" style="flex:' + (D.RING_CAP - used) + '"></i>';
      out += cellButton(interactive, i, "at-node" + (ghostSet[i + ",0"] ? " at-ghost" : "") + (used >= D.RING_CAP ? " at-closed" : ""),
        ' style="--at-c:' + e.color + '"', '<b>' + e.icon + "</b><span class=\"at-fill\">" + segs + "</span><small>" + used + "/" + D.RING_CAP + "</small>");
    });
    return out + "</div>";
  }
  function brewHtml(s, ghost, interactive) {
    var impl = C.method("brew"), sel = interactive && ui.sel >= 0 ? s.mats[ui.sel] : null, pct = function (v) { return Math.round(v / D.BREW_MAX * 100); };
    var zones = s.recipe.gauges.map(function (g) { return g.el; });
    if (sel && zones.indexOf(sel.element) < 0) zones.push(sel.element);
    var out = '<div class="at-thermo" id="' + (interactive ? "at-brew" : "") + '">' + zones.map(function (z) {
      var r = D.BREW_ZONES[z];
      return '<span class="at-zone" style="left:' + pct(r[0]) + "%;width:" + (pct(r[1]) - pct(r[0])) + "%;background:" + el(z).color + '">' + el(z).icon + "</span>";
    }).join("") + '<span class="at-temp" style="left:' + pct(s.temp) + '%"></span>' +
      (ghost && ghost.after && ghost.after.temp !== undefined ? '<span class="at-temp at-temp-ghost" style="left:' + pct(ghost.after.temp) + '%"></span>' : "") +
      '</div><p class="at-hint" id="at-temp">' + t("at_temp", { t: s.temp }) + (s.temp >= D.BREW_BOIL ? "　" + t("at_boil") : "") + "</p>";
    if (interactive && sel) {
      out += '<div class="at-row" id="at-heats">' + D.BREW_HEATS.map(function (h, x) {
        var r = impl.heatResult(s.temp, sel, x);
        return cellButton(true, x, "at-heat" + (ghost && ghost.x === x ? " at-ghost" : ""), "", t("at_heat_" + x) + " " + t("at_temp_after", { t: r.temp }) + " ×" + r.mult);
      }).join("") + "</div>";
    }
    return out;
  }
  function paletteHtml(s, ghost, interactive) {
    var ev = ghost && ghost.after ? ghost.after : C.method("palette").evaluate(s, false), hex = function (c) { return c ? C.rgbToHex(c) : "#ffffff"; };
    var out = '<div class="at-palette" id="' + (interactive ? "at-palette" : "") + '"><span class="at-chip at-chip-l" style="background:' + hex(s.target) + '"></span>' + t("at_target") +
      '　<span class="at-chip at-chip-l" style="background:' + hex(ev.mixRgb) + '"></span>' + t("at_mixcolor") +
      (ev.dE !== null && ev.dE !== undefined ? '　<b id="at-de">' + t("at_de", { d: Math.round(ev.dE) }) + "</b>" : "") + "</div>";
    if (interactive && ui.sel >= 0) {
      out += '<div class="at-row" id="at-parts">';
      for (var x = 1; x <= D.PALETTE_MAX_PARTS; x++) out += cellButton(true, x, "at-part" + (ghost && ghost.x === x ? " at-ghost" : ""), "", t("at_parts", { n: x }));
      out += "</div>";
    }
    return out;
  }
  function methodView(s, ghost, interactive) {
    var ghostSet = {}; if (ghost && ghost.cells) ghost.cells.forEach(function (c) { ghostSet[c[0] + "," + c[1]] = true; });
    if (s.method === "ring") return ringHtml(s, ghostSet, interactive);
    if (s.method === "brew") return brewHtml(s, ghost, interactive);
    if (s.method === "palette") return paletteHtml(s, ghost, interactive);
    return boardHtml(s, ghostSet, interactive ? "at-board" : null);   // board、gravity
  }
  function usesGrid(s) { return s.method === "board" || s.method === "gravity"; }

  // B8 回放：成品的第 k 手時的棋盤
  function replayAt(item, k) {
    var copy = JSON.parse(JSON.stringify(item));
    copy.replay.moves = copy.replay.moves.slice(0, k);
    return C.replaySession(copy);
  }
  function findItem(uid) { return save.items.filter(function (it) { return it.uid === uid; })[0] || (ui.result && ui.result.uid === uid ? ui.result : null); }
  function renderReplay() {
    var item = findItem(ui.replay.uid);
    if (!item || !item.replay) { ui.replay = null; return ""; }
    var total = item.replay.moves.length, s = replayAt(item, ui.replay.step);
    return '<div class="at-replay" id="at-replay"><h3>' + t("at_replay") + "：" + esc(recipeName(item.recipe)) + "</h3>" + methodView(s, null, false) +
      '<p id="at-replay-step">' + t("at_replay_step", { n: ui.replay.step, total: total }) + '</p><div class="at-row">' +
      '<button type="button" id="at-replay-prev"' + (ui.replay.step > 0 ? "" : " disabled") + ">" + t("at_replay_prev") + "</button>" +
      '<button type="button" id="at-replay-next"' + (ui.replay.step < total ? "" : " disabled") + ">" + t("at_replay_next") + "</button>" +
      '<button type="button" id="at-replay-play">' + t("at_replay_play") + '</button><button type="button" id="at-replay-close">' + t("at_replay_close") + "</button></div></div>";
  }
  function stopReplay() { if (replayTimer) { clearInterval(replayTimer); replayTimer = null; } }

  function renderBoard() {
    var s = ui.session, impl = C.method(s.method), ghost = ui.ghost;
    var ev = ghost ? ghost.after : impl.evaluate(s, impl.done(s));
    var ghostSet = {}; if (ghost) ghost.cells.forEach(function (c) { ghostSet[c[0] + "," + c[1]] = true; });
    var out = (s.challenge ? '<p class="at-hint" id="at-challenge-banner">' + t("at_weekly", { key: s.challenge }) + "</p>" : "") +
      '<p class="at-hint" id="at-method">' + t("at_method_" + s.method) + "</p>" + methodView(s, ghost, true);
    out += '<ul class="at-gauges" id="at-gauges">';
    C.effectLevels(s.recipe, ev.gauges).forEach(function (g) {
      var e = el(g.el), val = ev.gauges[g.el], top = s.recipe.gauges.filter(function (x) { return x.el === g.el; })[0].steps.slice(-1)[0].at;
      out += '<li><span style="color:' + e.color + '">' + e.icon + " " + t("at_el_" + g.el) + "</span> " +
        '<meter min="0" max="' + top + '" value="' + Math.min(val, top) + '"></meter> <b>' + val + "</b> Lv" + g.level +
        " <small>" + (g.next ? t("at_gauge_next", { n: g.next }) : t("at_gauge_max")) + "</small></li>";
    });
    out += "</ul>";
    if (ev.mult > 1) out += '<p class="at-hint" id="at-affinity">' + t("at_affinity_on", { m: ev.mult }) + "</p>";
    if (usesGrid(s) && s.rules && (s.rules.mix || s.rules.complement)) out += '<p class="at-hint" id="at-mix">' + t("at_mix", { mix: ev.mix, clash: ev.clash }) + "</p>";
    if (s.rules && s.rules.great && ev.overheat) out += '<p class="at-warn" id="at-overheat">' + t(s.method === "brew" ? "at_boil" : "at_overheat") + "</p>";
    if (ev.lines) out += '<p class="at-push" id="at-lines">' + t("at_lines", { n: ev.lines }) + "</p>";
    if (s.method === "ring" && ev.lost) out += '<p class="at-hint" id="at-lost">' + t("at_lost", { n: ev.lost }) + "</p>";
    if (ev.push) out += '<p class="at-push" id="at-push">' + t("at_final_push", { el: t("at_el_" + ev.dominant), n: ev.push }) + "</p>";
    out += '<p class="at-hint">' + t("at_quality", { n: ev.quality }) + "　" + t("at_tap_hint") + "</p>";
    if (!impl.done(s)) {
      out += '<div class="at-tray" id="at-tray">' + s.mats.map(function (m, i) {
        if (s.placed[i]) return "";
        var shown = { shape: C.rotateShape(m.shape, i === ui.sel ? ui.rot : 0), hex: m.hex, element: m.element };
        return '<button type="button" data-at-mat="' + i + '" class="' + (i === ui.sel ? "at-on" : "") + '">' + shapeHtml(shown) + "</button>";
      }).join("") + "</div>";
    }
    out += '<div class="at-row">' + (usesGrid(s) ? '<button type="button" id="at-rot"' + (ui.sel < 0 ? " disabled" : "") + ">" + t("at_rotate") + "</button>" : "") +
      '<button type="button" id="at-undo"' + (s.history.length ? "" : " disabled") + ">" + t("at_undo") + "</button>" +
      '<button type="button" id="at-abort">' + t("at_back") + "</button>" +
      (!s.challenge && ui.sel >= 0 && C.helpAvailable(save, s) ? '<button type="button" id="at-help">' + t("at_help") + "</button>" : "") + "</div>";
    if (impl.done(s) && s.challenge) {
      out += '<button type="button" id="at-finish" class="at-main">' + t("at_finish_challenge") + "</button>";
    } else if (impl.done(s)) {
      var choices = C.traitChoices(s), used = C.traitCost(ui.traits), fused = C.fuseTraits(ui.traits);
      var fusedNew = fused.filter(function (k) { return ui.traits.indexOf(k) < 0; });
      out += '<div id="at-traits"><p>' + t("at_traits", { used: used, cap: C.traitCap(save), max: D.MAX_TRAITS }) + "</p>" +
        (fusedNew.length ? '<p class="at-push" id="at-fusion">' + t("at_fusion", { names: fusedNew.map(function (k) { return loc(D.TRAITS[k].name); }).join("、") }) + "</p>" : "") +
        (s.rules && s.rules.great ? '<p class="at-hint" id="at-great-chance">' + t("at_great_chance", { p: Math.round(C.greatChance(save, s) * 100) }) + "</p>" : "") +
        choices.map(function (k) {
          return '<label class="at-tag"><input type="checkbox" data-at-trait="' + k + '"' + (ui.traits.indexOf(k) >= 0 ? " checked" : "") + "> " +
            esc(loc(D.TRAITS[k].name)) + " (" + D.TRAITS[k].cost + ")</label>";
        }).join("") + '</div><button type="button" id="at-finish" class="at-main"' +
        (C.traitsValid(save, s, ui.traits) ? "" : " disabled") + ">" + t("at_finish") + "</button>";
    }
    return out;
  }

  function renderWeekly() {
    var wc = C.weeklyChallenge(now()), w = save.weekly.key === wc.key ? save.weekly : { best: 0, plays: 0 };
    return '<div class="at-weekly" id="at-weekly"><h3>' + t("at_weekly", { key: wc.key }) + "</h3><p>" +
      t("at_weekly_info", { recipe: recipeName(wc.recipe), best: w.best, plays: w.plays }) + '</p><button type="button" id="at-weekly-start">' + t("at_weekly_start") + "</button></div>";
  }
  function renderTasks() {
    var task = C.currentTask(save);
    if (!task) return '<p id="at-task">' + t("at_task_done") + "</p>" + renderWeekly();
    var out = renderWeekly() + '<div id="at-task"><h3>' + t("at_task_now") + "</h3><p>" + esc(loc(task.text)) + "</p><p><small>" +
      t("at_task_need", { recipe: recipeName(task.recipe), q: task.minQuality }) +
      (task.minLevel ? t("at_task_lv", { n: task.minLevel }) : "") + '</small></p></div><ul class="at-list">';
    save.items.forEach(function (it) {
      var ok = C.taskMet(task, it);
      out += "<li>" + itemHtml(it) + ' <button type="button" data-at-deliver="' + it.uid + '"' + (ok ? "" : " disabled") + ">" + t("at_deliver") + "</button></li>";
    });
    return out + "</ul>";
  }

  // C2 圖鑑：依色系分組，沒拍過的只顯示「？」
  function renderDex() {
    var p = C.dexProgress(save), out = '<h3 id="at-dex-progress">' + t("at_dex_progress", { seen: p.seen, total: p.total }) + '</h3><div id="at-dex">';
    C.dexGroups().forEach(function (g) {
      out += "<h4>" + t("at_dex_" + g.id) + '</h4><ul class="at-dex-grid">' + g.colors.map(function (c) {
        return save.seen[c.id]
          ? '<li class="at-dex-on" data-at-dex="' + c.id + '"><span class="at-chip" style="background:' + c.hex + '"></span>' + esc(loc(c.name)) +
            (c.rarity > 1 ? " " + new Array(c.rarity).join("★") : "") + "</li>"
          : '<li class="at-dex-off"><span class="at-chip"></span>？</li>';
      }).join("") + "</ul>";
    });
    return out + "</div>";
  }

  // §10.4 C6 著色繪本：上方是 SVG（純顯示），下方是區域按鈕與可用素材
  function renderBook() {
    var pg = C.page(ui.page), filled = save.coloring[pg.id] || {}, pr = C.pageProgress(save, pg.id);
    var out = '<div class="at-row" id="at-pages">' + D.PAGES.map(function (x) {
      return '<button type="button" data-at-page="' + x.id + '" class="' + (x.id === ui.page ? "at-on" : "") + '">' + esc(loc(x.name)) +
        (save.pagesDone[x.id] ? " ✓" : "") + "</button>";
    }).join("") + "</div>";
    out += '<svg class="at-book" id="at-book" viewBox="0 0 6 6" role="img" aria-label="' + esc(loc(pg.name)) + '">' + pg.regions.map(function (r) {
      var fill = filled[r.id] || "#ffffff";
      return '<g class="' + (ui.region === r.id ? "at-region-on" : "") + '">' + r.rects.map(function (q) {
        return '<rect x="' + q[0] + '" y="' + q[1] + '" width="' + q[2] + '" height="' + q[3] + '" fill="' + fill + '" stroke="#8a7f6c" stroke-width="0.04"' +
          (filled[r.id] ? "" : ' stroke-dasharray="0.12 0.08"') + "></rect>";
      }).join("") + "</g>";
    }).join("") + "</svg>";
    out += '<p id="at-book-progress">' + t("at_book_progress", { filled: pr.filled, total: pr.total }) + (save.pagesDone[pg.id] ? "　" + t("at_book_done") : "") + "</p>";
    out += '<div class="at-row" id="at-regions">' + pg.regions.map(function (r) {
      return '<button type="button" data-at-region="' + r.id + '" class="' + (ui.region === r.id ? "at-on" : "") + '"' + (filled[r.id] ? " disabled" : "") + ">" +
        (filled[r.id] ? '<span class="at-chip" style="background:' + filled[r.id] + '"></span>' : "") + t("at_region", { group: t("at_dex_" + r.group) }) + "</button>";
    }).join("") + "</div>";
    if (ui.region && !filled[ui.region]) {
      var region = pg.regions.filter(function (r) { return r.id === ui.region; })[0];
      var mats = save.mats.filter(function (m) { return m.colorId && C.dexGroup(colorOf(m.colorId)) === region.group; });
      out += '<ul class="at-list" id="at-paints">' + (mats.length ? mats.map(function (m) {
        return '<li><span class="at-chip" style="background:' + m.hex + '"></span>' + esc(matName(m)) +
          ' <button type="button" data-at-paint="' + m.uid + '">' + t("at_paint") + "</button></li>";
      }).join("") : "<li>" + t("at_no_paint") + "</li>") + "</ul>";
    }
    return out;
  }
  function decoLabel(ref) {
    var parts = ref.split(":");
    if (parts[0] === "page") return t("at_deco_page", { name: loc(C.page(parts[1]).name) });
    var it = save.items.filter(function (x) { return x.uid === +parts[1]; })[0];
    return it ? (it.great ? "✨" : "") + recipeName(it.recipe) + " (" + t("at_quality", { n: it.quality }) + ")" : "";
  }
  // §10.8 稱號、§10.5 裝飾、§10.6 店鋪
  function renderStore() {
    var n = now(), opts = C.decoOptions(save), hot = C.hotElement(n);
    var out = "<h3>" + t("at_titles") + '</h3><p><select id="at-title-select"><option value="">' + t("at_title_none") + "</option>" +
      D.TITLES.filter(function (x) { return save.titles[x.id]; }).map(function (x) {
        return '<option value="' + x.id + '"' + (save.title === x.id ? " selected" : "") + ">" + esc(loc(x.name)) + "</option>";
      }).join("") + "</select></p>";
    out += "<h3>" + t("at_deco") + '</h3><div id="at-decos">';
    for (var i = 0; i < D.DECO_SLOTS; i++) {
      out += '<label class="at-slot">' + t("at_deco_slot", { n: i + 1 }) + '<select data-at-deco="' + i + '"><option value="">' + t("at_deco_empty") + "</option>" +
        opts.map(function (o) { return '<option value="' + o.ref + '"' + (save.deco[i] === o.ref ? " selected" : "") + ">" + esc(decoLabel(o.ref)) + "</option>"; }).join("") +
        "</select></label>";
    }
    out += "</div><h3>" + t("at_shop") + '</h3><p id="at-coins">' + t("at_coins", { n: save.coins }) + '　<span id="at-hot">' +
      t("at_hot", { el: el(hot).icon + t("at_el_" + hot) }) + '</span></p><ul class="at-list" id="at-sells">';
    if (!save.items.length) out += "<li>" + t("at_items_empty") + "</li>";
    save.items.forEach(function (it) {
      var shown = C.displayed(save, it.uid);
      out += "<li>" + itemHtml(it) + ' <button type="button" data-at-sell="' + it.uid + '"' + (shown ? " disabled" : "") + ">" +
        (shown ? t("at_displayed") : t("at_sell", { price: C.priceOf(it, n) })) + "</button></li>";
    });
    out += '</ul><div class="at-row">' + '<button type="button" id="at-buy-basket"' + (save.coins >= D.BASKET_COINS && save.basket.n < D.BASKET_MAX ? "" : " disabled") + ">" +
      t("at_buy_basket", { coins: D.BASKET_COINS }) + "</button>" +
      (C.level(save) >= D.ADVANCED_LV ? D.CATALYST_ORDER.map(function (id) {
        return '<button type="button" data-at-buycat="' + id + '"' + (save.coins >= D.CATALYST_COINS[id] ? "" : " disabled") + ">" +
          t("at_buy_cat", { name: loc(D.CATALYSTS[id].name), coins: D.CATALYST_COINS[id] }) + "</button>";
      }).join("") : "") + "</div>";
    return out;
  }

  // C5 錬金釜、B6 升級、C10 灰燼
  function renderHosts() {
    return "<h3>" + t("at_hosts") + '</h3><ul class="at-list" id="at-hosts">' + D.HOST_ORDER.map(function (id) {
      var h = H[id], open = C.hostUnlocked(save, id), here = save.host === id;
      return '<li><span class="at-avatar at-avatar-s" style="background:' + h.color + '">' + h.glyph + "</span><b>" + esc(loc(h.name)) + "</b> <small>" +
        esc(loc(h.title)) + "・" + t("at_method_" + h.method) + "<br>" + esc(loc(h.abilityText)) + "</small> " +
        (here ? "<small>" + t("at_host_here") + "</small>" : '<button type="button" data-at-host="' + id + '"' + (open ? "" : " disabled") + ">" +
          (open ? t("at_host_go") : t("at_host_locked", { n: h.unlock.lv })) + "</button>") + "</li>";
    }).join("") + "</ul>";
  }
  function renderShop() {
    var out = renderHosts() + '<h3 id="at-ash">' + t("at_ash", { n: save.ash }) + '</h3><ul class="at-list" id="at-cauldrons">';
    D.CAULDRON_ORDER.forEach(function (id) {
      var c = D.CAULDRONS[id], lv = C.cauldronLv(save, id), eff = C.effectiveCauldron(save, id);
      out += "<li><b>" + esc(loc(c.name)) + "</b> <small>" +
        t("at_cauldron_info", { size: c.pattern.length, q: eff ? eff.qualityPerCell : c.qualityPerCell, lv: lv || "-" }) + "<br>" +
        t("at_affinity") + "：" + c.affinity.map(function (rid) { return C.recipeKnown(save, C.recipe(rid)) ? esc(recipeName(rid)) : "？？？"; }).join("、") + "</small> ";
      if (!lv) out += '<button type="button" data-at-unlock="' + id + '"' + (C.canUnlockCauldron(save, id) ? "" : " disabled") + ">" + t("at_unlock", { lv: c.unlock.lv, ash: c.unlock.ash }) + "</button>";
      else {
        var cost = C.upgradeCost(save, id);
        out += cost === null ? "<small>" + t("at_max") + "</small>"
          : '<button type="button" data-at-upgrade="' + id + '"' + (save.ash >= cost ? "" : " disabled") + ">" + t("at_upgrade", { ash: cost }) + "</button>";
      }
      out += "</li>";
    });
    out += "</ul>";
    if (C.level(save) >= D.ADVANCED_LV) {
      out += '<p><label><input type="checkbox" id="at-advanced"' + (save.settings.advanced ? " checked" : "") + "> " + t("at_advanced") + "</label></p>" +
        "<h3>" + t("at_catalysts") + '</h3><ul class="at-list" id="at-catalysts">' + D.CATALYST_ORDER.map(function (id) {
          var c = D.CATALYSTS[id];
          return "<li><b>" + esc(loc(c.name)) + "</b> <small>" + t("at_owned", { n: save.catalysts[id] || 0 }) + "</small> " +
            '<button type="button" data-at-make="' + id + '"' + (save.ash >= c.ash ? "" : " disabled") + ">" + t("at_make", { ash: c.ash }) + "</button></li>";
        }).join("");
    } else {
      out += '<p class="at-hint" id="at-advanced-locked">' + t("at_advanced_locked") + "</p><ul class=\"at-hidden\">";
    }
    var sc = C.shelfCost(save);
    out += '</ul><p>' + t("at_box_cap", { n: C.matMax(save) }) + " " + (sc === null ? "<small>" + t("at_shelf_max") + "</small>"
      : '<button type="button" id="at-shelf"' + (save.ash >= sc ? "" : " disabled") + ">" + t("at_shelf", { n: D.SHELF_STEP, ash: sc }) + "</button>") + "</p>";
    return out + renderStore();
  }

  function renderDev() {
    return '<details class="at-dev"' + (ui.dev ? " open" : "") + '><summary id="at-dev-toggle">' + t("at_dev") + "</summary>" +
      '<button type="button" id="at-dev-time">' + t("at_dev_time") + '</button><button type="button" id="at-dev-day">' + t("at_dev_day") + "</button>" +
      '<button type="button" id="at-dev-cool">' + t("at_dev_cool") + '</button><button type="button" id="at-dev-ash">' + t("at_dev_ash") + "</button>" +
      '<button type="button" id="at-reset">' + t(ui.resetArm ? "at_reset_confirm" : "at_reset") + "</button></details>";
  }

  // ---------- 操作 ----------
  function showSwatches(rgba, sceneUrl) {
    var n = now();
    if (ui.wbMode) {                          // O2：這一張當作白紙校正
      C.setWhiteBalance(save, C.whiteBalanceGains(rgba, D.SRC_SIZE, D.SRC_SIZE), n);
      ui.wbMode = false; ui.msg = t("at_wb_set"); persist(); render();
      return;
    }
    if (C.wbActive(save, n)) rgba = C.applyGains(rgba, save.wb.gains);
    ui.rainbow = C.rainbowOf(rgba);                                            // §10.2 B2
    if (ui.filter && save.tools.glasses) rgba = C.shiftHue(rgba, D.FILTER_SHIFT);   // §10.3 濾色眼鏡
    ui.swatches = C.analyze(rgba, D.SRC_SIZE, D.SRC_SIZE, String(n), C.analyzeOpts(save));
    ui.harmony = C.harmonyOf(ui.swatches);                                     // §10.1 B1
    ui.picks = []; ui.scene = sceneUrl || null; ui.msg = "";
    render();
  }
  function collect() {
    var r = C.captureEx(save, ui.picks.map(function (k) { return ui.swatches[k]; }), now(), { harmony: ui.harmony, rainbow: ui.rainbow }), msgs = [];
    if (r.error) { ui.msg = t(r.error === "basket" ? "at_collect_fail_basket" : r.error === "full" ? "at_collect_fail_full" : "at_err_pick"); render(); return; }
    ui.swatches = null; ui.scene = null; ui.picks = [];
    msgs.push(t("at_collect_ok", { n: r.mats.length }));
    if (r.newColors.length) msgs.push(t("at_new_colors", { names: r.newColors.map(function (id) { return loc(colorOf(id).name); }).join("、") }));
    if (r.daily) { msgs.push(t("at_daily_hit", { n: D.DAILY_EXP })); say("daily"); }
    else if (r.rainbow) { msgs.push(t("at_rainbow_got")); say("rainbow"); }
    else if (r.harmony) say("harmony");
    ui.harmony = null; ui.rainbow = false;
    ui.msg = msgs.join("　");
    ideas(); persist(); render();
  }
  function startSession() {
    var cat = ui.catalyst ? { id: ui.catalyst, el: D.CATALYSTS[ui.catalyst].needsEl ? ui.catalystEl : null } : null;
    var res = C.startSynthesis(save, ui.recipe, ui.slots.slice(), ui.cauldron, now(), { catalyst: cat });
    if (res.error) { ui.msg = t("at_err_" + res.error); say(res.error === "cooldown" ? "cooldown" : "miss"); render(); return; }
    ui.session = res; ui.sel = 0; ui.rot = 0; ui.ghost = null; ui.traits = []; ui.msg = "";
    render();
  }
  function pickCauldron(recipeId) {
    var owned = D.CAULDRON_ORDER.filter(function (id) { return C.cauldronLv(save, id); });
    var good = owned.filter(function (id) { return D.CAULDRONS[id].affinity.indexOf(recipeId) >= 0; });
    return good[0] || owned[0];
  }
  function tapCell(x, y) {
    var s = ui.session, impl = C.method(s.method);
    if (ui.sel < 0) return;
    if (ui.ghost && ui.ghost.x === x && ui.ghost.y === y) {   // 第 2 次點同一格：放下
      var before = impl.evaluate(s, false), info = impl.place(s, ui.sel, x, y, ui.rot);
      if (info.ok) {
        say(C.react(save, before, impl.evaluate(s, impl.done(s)), info));
        ui.sel = s.placed.indexOf(false); ui.rot = 0;
      }
      ui.ghost = null;
    } else {
      var p = impl.preview(s, ui.sel, x, y, ui.rot);
      ui.ghost = p ? { x: x, y: y, cells: p.cells, after: p.after } : null;
    }
    render();
  }

  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("button, summary");
    if (!b || b.disabled) return;
    var d = b.dataset, s = ui.session;
    if (d.atTab) { ui.tab = d.atTab; ui.msg = ""; ui.subs = []; if (ui.tab !== "gather") CAM.close(app.querySelector("#at-video")); render(); return; }
    if (b.id === "at-cam-open") {
      CAM.open(app.querySelector("#at-video")).then(render, function () { ui.msg = t("at_cam_denied"); render(); });
      render(); return;
    }
    if (b.id === "at-cam-close") { CAM.close(app.querySelector("#at-video")); render(); return; }
    if (b.id === "at-cam-shot") { showSwatches(CAM.grab(app.querySelector("#at-video"))); return; }
    if (b.id === "at-walk") { ui.wbMode = false; var w = CAM.walkScene(now()); showSwatches(w.rgba, w.url); return; }
    if (b.id === "at-wb") { ui.wbMode = !ui.wbMode; ui.swatches = null; render(); return; }
    if (d.atPick !== undefined) {
      var i = +d.atPick, at = ui.picks.indexOf(i);
      if (at >= 0) ui.picks.splice(at, 1); else if (ui.picks.length < D.PICK_MAX) ui.picks.push(i);
      render(); return;
    }
    if (b.id === "at-collect") { collect(); return; }
    if (d.atRecipe) { ui.recipe = d.atRecipe; ui.slots = []; ui.cauldron = pickCauldron(d.atRecipe); render(); return; }
    if (b.id === "at-back") { ui.recipe = null; ui.slots = []; render(); return; }
    if (b.id === "at-start") { startSession(); return; }
    if (d.atCell) { var xy = d.atCell.split(","); tapCell(+xy[0], +xy[1]); return; }
    if (d.atMat !== undefined) { ui.sel = +d.atMat; ui.rot = 0; ui.ghost = null; render(); return; }
    if (b.id === "at-rot") {
      ui.rot = (ui.rot + 1) % 4;
      if (ui.ghost) { var p = C.method(s.method).preview(s, ui.sel, ui.ghost.x, ui.ghost.y, ui.rot); ui.ghost = p ? { x: ui.ghost.x, y: ui.ghost.y, cells: p.cells, after: p.after } : null; }
      render(); return;
    }
    if (b.id === "at-undo") { C.method(s.method).undo(s); ui.sel = s.placed.indexOf(false); ui.rot = 0; ui.ghost = null; ui.traits = []; render(); return; }
    if (b.id === "at-abort") { ui.session = null; ui.ghost = null; render(); return; }
    if (b.id === "at-help") {
      var hinfo = C.useHelp(save, s, ui.sel);
      if (hinfo) { say("help"); ui.sel = s.placed.indexOf(false); ui.rot = 0; ui.ghost = null; }
      render(); return;
    }
    if (b.id === "at-finish" && s && s.challenge) {
      var cr = C.finishChallenge(save, s, now());
      if (cr.error) { ui.msg = t("at_err_" + cr.error); render(); return; }
      ui.challengeResult = cr; ui.session = null; ideas(); persist(); render(); return;
    }
    if (b.id === "at-challenge-close") { ui.challengeResult = null; render(); return; }
    if (b.id === "at-weekly-start") {
      ui.session = C.startChallenge(save, now()); ui.sel = 0; ui.rot = 0; ui.ghost = null; ui.traits = []; ui.result = null;
      ui.tab = "lab"; ui.msg = ""; render(); return;
    }
    if (d.atReplay) { stopReplay(); ui.replay = { uid: +d.atReplay, step: 0 }; render(); return; }
    if (b.id === "at-replay-prev") { stopReplay(); ui.replay.step--; render(); return; }
    if (b.id === "at-replay-next") { stopReplay(); ui.replay.step++; render(); return; }
    if (b.id === "at-replay-play") {
      stopReplay(); ui.replay.step = 0; render();
      replayTimer = setInterval(function () {
        var it = ui.replay && findItem(ui.replay.uid);
        if (!it || ui.replay.step >= it.replay.moves.length) { stopReplay(); return; }
        ui.replay.step++; render();
      }, 600);
      return;
    }
    if (b.id === "at-replay-close") { stopReplay(); ui.replay = null; render(); return; }
    if (d.atMake) { if (C.makeCatalyst(save, d.atMake)) { say("upgrade"); persist(); } render(); return; }
    if (b.id === "at-filter") { ui.filter = !ui.filter; ui.swatches = null; render(); return; }
    if (d.atPage) { ui.page = d.atPage; ui.region = null; render(); return; }
    if (d.atRegion) { ui.region = d.atRegion; render(); return; }
    if (d.atPaint) {
      var pr = C.colorRegion(save, ui.page, ui.region, +d.atPaint);
      if (pr.error) ui.msg = t("at_err_" + pr.error);
      else {
        ui.region = null; ui.msg = "";
        if (pr.done) { say("page_done"); addMsg(t("at_page_done", { name: loc(C.page(ui.page).name), exp: D.PAGE_REWARD.exp, ash: D.PAGE_REWARD.ash })); }
        ideas(); persist();
      }
      render(); return;
    }
    if (d.atSell) {
      var price = C.sell(save, +d.atSell, now());
      if (price !== null) { ui.msg = t("at_sold", { n: price }); say("sold"); ideas(); persist(); }
      render(); return;
    }
    if (d.atHost) {
      if (C.setHost(save, d.atHost)) {
        ui.session = null; ui.recipe = null; ui.slots = []; ui.result = null; ui.ghost = null;
        ui.line = null; say("greet"); ui.msg = t("at_host_moved", { name: loc(host().name) }); persist();
      }
      render(); return;
    }
    if (d.atBuycat) { if (C.buyCatalyst(save, d.atBuycat)) { say("upgrade"); persist(); } render(); return; }
    if (b.id === "at-buy-basket") { if (C.buyBasket(save, now())) persist(); render(); return; }
    if (b.id === "at-finish") {
      var item = C.finishSynthesis(save, s, ui.traits, now());
      if (item.error) { ui.msg = t("at_err_" + item.error); render(); return; }
      ui.result = item; ui.session = null; ui.recipe = null; ui.slots = []; ui.msg = ""; ui.catalyst = "";
      say(item.great ? "great" : item.overheat ? "overheat" : item.quality >= 50 ? "finish_good" : "finish_bad");
      ideas(); persist(); render(); return;
    }
    if (b.id === "at-result-close") { ui.result = null; render(); return; }
    if (d.atDeliver) { if (C.deliver(save, +d.atDeliver)) { say("finish_good"); ideas(); persist(); } render(); return; }
    if (b.id === "at-sublimate") {
      var m = C.sublimate(save, ui.subs.slice(), now());
      if (m.error) ui.msg = t("at_err_" + m.error);
      else { ui.msg = t("at_sublimate_ok", { q: m.quality }); say("sublimate"); persist(); }
      ui.subs = []; render(); return;
    }
    if (d.atUnlock) { if (C.unlockCauldron(save, d.atUnlock)) { say("upgrade"); persist(); } render(); return; }
    if (d.atUpgrade) { if (C.upgradeCauldron(save, d.atUpgrade)) { say("upgrade"); persist(); } render(); return; }
    if (b.id === "at-shelf") { if (C.upgradeShelf(save)) { say("upgrade"); persist(); } render(); return; }
    if (b.id === "at-dev-toggle") { ui.dev = !ui.dev; return; }
    if (b.id === "at-dev-time") { save.offsetMs = (save.offsetMs || 0) + 20 * 60000; persist(); render(); return; }
    if (b.id === "at-dev-day") { save.offsetMs = (save.offsetMs || 0) + 86400000; persist(); render(); return; }
    if (b.id === "at-dev-cool") { save.cooldownUntil = 0; persist(); render(); return; }
    if (b.id === "at-dev-ash") { save.ash += 20; persist(); render(); return; }
    if (b.id === "at-reset") {
      if (!ui.resetArm) { ui.resetArm = true; render(); return; }
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      save = C.newSave(Date.now()); ui.resetArm = false; ui.session = null; ui.result = null; ui.recipe = null; render();
    }
  });
  app.addEventListener("change", function (ev) {
    var x = ev.target;
    if (x.id === "at-file" && x.files && x.files[0]) {
      CAM.fromFile(x.files[0]).then(function (rgba) { showSwatches(rgba); }, function () { ui.msg = t("at_err_image"); render(); });
      return;
    }
    if (x.id === "at-cauldron") { ui.cauldron = x.value; render(); return; }
    if (x.id === "at-catalyst") { ui.catalyst = x.value; render(); return; }
    if (x.id === "at-catalyst-el") { ui.catalystEl = x.value; render(); return; }
    if (x.id === "at-advanced") { C.setAdvanced(save, x.checked); persist(); render(); return; }
    if (x.id === "at-title-select") { C.setTitle(save, x.value); persist(); render(); return; }
    if (x.dataset.atDeco !== undefined) {
      var re = C.setDeco(save, +x.dataset.atDeco, x.value || null);
      if (re) { say(re === "like" ? "deco_like" : re === "dislike" ? "deco_dislike" : "deco_ok"); persist(); }
      render(); return;
    }
    if (x.dataset.atSlot !== undefined) { ui.slots[+x.dataset.atSlot] = x.value ? +x.value : undefined; render(); return; }
    if (x.dataset.atSub) {
      var u = +x.dataset.atSub, k = ui.subs.indexOf(u);
      if (x.checked && k < 0 && ui.subs.length < D.SUBLIMATE_N) ui.subs.push(u); else if (!x.checked && k >= 0) ui.subs.splice(k, 1);
      render(); return;
    }
    if (x.dataset.atTrait) {
      var tk = x.dataset.atTrait, at = ui.traits.indexOf(tk);
      if (x.checked && at < 0) ui.traits.push(tk); else if (!x.checked && at >= 0) ui.traits.splice(at, 1);
      render();
    }
  });
  window.addEventListener("i18n:change", render);
  setInterval(function () { if (ui.tab === "gather" || (ui.tab === "lab" && !ui.session)) { if (!CAM.isOpen()) render(); } }, 30000);

  var visit = C.dailyVisit(save, now());                                       // §10.5 每天第一次開啟
  if (visit && visit.aff > 0) { say("visit"); ui.msg = t("at_visit", { n: visit.aff }); }
  ideas();
  persist();
  window.PriTestAtelier = { _debugState: function () { return save; }, _debugUi: function () { return ui; } };
  render();
})();
