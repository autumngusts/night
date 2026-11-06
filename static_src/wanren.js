// 萬人迷（wanren）：畫面。標題 → 每天（早上迷妹 → 上課／考試 → 自由時間＝3D 校園 → 晚上）→ 學期報告。
// 規則在 wanren_core.js、資料在 wanren_data.js、3D 在 wanren_3d.js。沒有 WebGL 時自由時間改用地點按鈕。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  var C = window.PriTestWanrenCore;
  var V3 = window.PriTestWanren3D;
  var NET = window.PriTestWanrenNet;
  var app = document.getElementById("wr-app");
  if (!app || !D || !C) return;

  function t(k, p) { return window.I18N.t(k, p); }
  function L(o) { return D.L(o); }
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
  function btn(label, onclick, cls, attrs) {
    var a = { class: cls || "wr-btn", type: "button", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function money(n) { return "¥" + Math.round(n).toLocaleString(); }
  function hex(c) { return "#" + ("000000" + c.toString(16)).slice(-6); }
  function hname(hid) { return L(D.HEROINE_BY_ID[hid].name); }
  var GROUP_COLOR = { classmate: "#e76f9a", senior: "#8a6ad0", teacher: "#3f8fd0", parent: "#e0943a", kouhai: "#4fb0a0", friend: "#5ea84a", bestie: "#d4553e", fanclub: "#d0569f" };

  var S = null;   // 遊戲狀態
  var ui = { screen: "title", loc: null, focus: null, topicFor: null, giftFor: null, msg: null, modal: null, shop: false, dateMoment: null, eveningPick: null, lengthId: "sfull", name: "" };
  var view = null, view3dState = "none";   // none | loading | ready | fail

  // ---------------- 外框 ----------------
  var topEl = el("div", { class: "wr-top" });
  var stageEl = el("div", { class: "wr-stage" });
  var stage3d = el("div", { class: "wr-stage-3d" });
  var hudEl = el("div", { class: "wr-hud" });
  var msgEl = el("div", { class: "wr-msg-host" });
  var fallbackEl = el("div", { class: "wr-fallback" });
  stageEl.appendChild(stage3d); stageEl.appendChild(fallbackEl); stageEl.appendChild(hudEl); stageEl.appendChild(msgEl);
  var panelEl = el("div", { class: "wr-panel" });
  var modalEl = el("div", { class: "wr-modal-host" });
  var mainEl = el("div", { class: "wr-main" }, [stageEl, panelEl]);
  app.appendChild(topEl); app.appendChild(mainEl); app.appendChild(modalEl);

  function init3d() {
    if (view3dState !== "none") return;
    if (!V3 || !V3.available()) { view3dState = "fail"; render(); return; }
    view3dState = "loading";
    V3.load().then(function () {
      try {
        view = V3.create(stage3d, {
          drawPhoto: photoCanvas,
          onPick: function (hid) { ui.focus = hid; if (S && S.phase === "free") render(); },
          onLocation: function (loc) {
            if (ui.loc === loc) return;
            ui.loc = loc;
            ui.topicFor = null; ui.giftFor = null; ui.shop = false;
            if (S && S.phase === "free") {
              var r = C.arrive(S, loc);   // 約定見面
              if (r) { say(r); save(); }
              render();
            }
            else renderHud();
          },
          // 在校園走了一段路：機率觸發隨機遭遇（第 9 項）
          onWalk: function () {
            if (!S || S.phase !== "free" || ui.msg || ui.modal) return;
            if (Math.random() < 0.45 && C.encounter(S, ui.loc)) { save(); render(); }
          }
        });
        view3dState = "ready";
      } catch (e) {
        view3dState = "fail";
        if (window.console) console.error(e);
      }
      render();
    }, function () { view3dState = "fail"; render(); });
  }

  function save() { if (S) C.save(S); }
  function say(lines) {
    if (!lines || !lines.length) return;
    ui.msg = lines.slice();
  }
  function act(fn) {
    var ap0 = S && S.today && S.phase === "free" ? S.today.ap : null;
    var out = fn();
    if (out) say(out);
    // 自由時間做完一件事（用掉行動點）後，也有機率發生校園遭遇（2026-11-03：事件更頻繁；沒有 3D 時也會發生）
    if (S && ap0 !== null && S.phase === "free" && S.today.ap < ap0 && S.today.ap > 0 && Math.random() < 0.2) C.encounter(S, ui.loc);
    achievementToast();
    save();
    render();
  }
  // 成就解鎖的提示（第 8 項）
  var toastEl = el("div", { class: "wr-toasts" });
  app.appendChild(toastEl);
  function achievementToast() {
    if (!S) return;
    C.checkAchievements(S).forEach(function (id) {
      var a = D.ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      var tEl = el("div", { class: "wr-toast" }, [el("b", {}, [a.icon + " " + t("wr_ach_unlocked")]), " ", a.name]);
      toastEl.appendChild(tEl);
      setTimeout(function () { if (tEl.parentNode) tEl.parentNode.removeChild(tEl); }, 4200);
    });
  }

  // ---------------- 3D 同步 ----------------
  function sync3d() {
    if (!view) return;
    var ph = !S || ui.screen === "title" ? "free" : S.phase === "report" || S.phase === "yearreport" ? "report" : S.phase === "night" ? "evening" : S.phase === "exam" ? "class" : S.phase;
    if (sync3d.ph !== ph) { view.setPhase(ph); sync3d.ph = ph; }
    var list = [];
    if (S && S.today && S.phase !== "report" && S.phase !== "yearreport") {
      D.HEROINES.forEach(function (hd) {
        var loc = C.whereIs(S, hd.id);
        if (!loc) return;
        var h = S.h[hd.id];
        var hearts = h.dating ? "💕" : h.aff >= 80 ? "❤❤❤" : h.aff >= 60 ? "❤❤" : h.aff >= 40 ? "❤" : "";
        var pf = C.photoOf(S.seed, hd.id);
        list.push({ id: hd.id, loc: loc, photo: pf ? photoUrl(pf) : null, sil: !h.met, label: h.met ? hname(hd.id) : "？？？", sub: h.met ? C.stageName(S, hd.id) + (hearts ? " " + hearts : "") : L(D.GROUPS.filter(function (g) { return g.id === hd.group; })[0].name), color: GROUP_COLOR[hd.group] });
      });
    }
    var sig = JSON.stringify(list);
    if (sync3d.sig !== sig) { view.setHeroines(list); sync3d.sig = sig; }
    // 季節與天氣（第 11 項）
    var sea = S && S.today ? C.season(S) + "|" + S.today.weather : "spring|sunny";
    if (sync3d.sea !== sea) { view.setSeason(sea.split("|")[0], sea.split("|")[1]); sync3d.sea = sea; }
    view.setEnabled(!!S && S.phase === "free" && ui.screen === "game");
  }

  // ---------------- 上方列 ----------------
  function renderTop() {
    topEl.innerHTML = "";
    var left = el("div", { class: "wr-brand" }, [el("span", { class: "wr-logo" }, ["💘"]), el("h1", { class: "wr-title" }, [t("wr_title")])]);
    topEl.appendChild(left);
    if (!S || ui.screen === "title") return;
    if (S.today) {
      var kind = S.today.kind, sp = C.special(S);
      var badge = sp ? sp.icon + " " + L(sp.name) : { midterm: t("wr_kind_midterm"), final: t("wr_kind_final"), weekend: t("wr_kind_weekend") }[kind];
      topEl.appendChild(el("div", { class: "wr-date" }, [
        el("span", { class: "wr-term" }, [C.termName(S)]),
        el("b", {}, [C.dateLabel(S, S.day)]), " ",
        el("span", { class: "wr-muted" }, [t("wr_day_of", { d: S.day + 1, n: S.length })]),
        badge ? el("span", { class: "wr-badge wr-badge-" + kind }, [badge]) : null,
        el("span", { class: "wr-weather", title: L(C.WEATHER_INFO[S.today.weather].name) }, [C.WEATHER_INFO[S.today.weather].icon]),
        S.today.examWeek ? el("span", { class: "wr-badge wr-badge-midterm" }, ["📚 " + t("wr_exam_week")]) : null,
        el("span", { class: "wr-phase" }, [t("wr_phase_" + S.phase)])
      ]));
    }
    var stats = el("div", { class: "wr-stats" });
    C.STATS.forEach(function (st) {
      var v = S.stats[st.id];
      var txt = st.id === "money" ? money(v) : st.id === "rep" ? (v > 0 ? "+" : "") + Math.round(v) : Math.round(v);
      var chip = el("span", { class: "wr-stat wr-stat-" + st.id, title: L(st.name) }, [st.icon + " ", el("small", {}, [L(st.name)]), " ", el("b", {}, [txt])]);
      if (st.id !== "money" && st.id !== "rep") chip.appendChild(el("i", { class: "wr-statbar", style: "width:" + clamp(v, 0, 100) + "%" }));
      stats.appendChild(chip);
    });
    stats.appendChild(el("span", { class: "wr-stat wr-stat-fans", title: t("wr_fans") }, ["📣 ", el("small", {}, [t("wr_fans")]), " ", el("b", {}, [S.fans])]));
    topEl.appendChild(stats);
    topEl.appendChild(el("div", { class: "wr-topbtns" }, [
      btn("🧑‍🎓 " + t("wr_me"), function () { ui.modal = { type: "me" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      btn("👭 " + t("wr_people"), function () { ui.modal = { type: "people" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      phoneBtn("wr-btn wr-btn-ghost"),
      btn("📔 " + t("wr_album"), function () { ui.modal = { type: "album", tab: "ach" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      btn((ui.net ? "🟢 " : "🌐 ") + t("wr_online"), function () { ui.modal = { type: "net" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      btn("🎒 " + t("wr_bag"), function () { ui.modal = { type: "bag" }; renderModal(); }, "wr-btn wr-btn-ghost"),
      btn("🏠 " + t("wr_to_title"), function () { save(); ui.screen = "title"; render(); }, "wr-btn wr-btn-ghost")
    ]));
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // ---------------- 3D 上的 HUD ----------------
  function renderHud() {
    hudEl.innerHTML = "";
    if (view3dState === "loading") hudEl.appendChild(el("div", { class: "wr-hud-center" }, [t("wr_loading3d")]));
    if (!S || ui.screen === "title") {
      hudEl.appendChild(el("div", { class: "wr-hud-hero" }, [el("div", { class: "wr-hud-hero-t" }, ["萬人迷"]), el("div", { class: "wr-hud-hero-s" }, [t("wr_tagline")])]));
      return;
    }
    if (S.phase === "free") {
      var loc = ui.loc ? D.LOC_BY_ID[ui.loc] : null;
      hudEl.appendChild(el("div", { class: "wr-hud-loc" }, [loc ? loc.icon + " " + L(loc.name) : t("wr_walking")]));
      var pips = el("div", { class: "wr-hud-ap", title: t("wr_ap") }, [t("wr_ap") + " "]);
      for (var i = 0; i < S.today.apMax; i++) pips.appendChild(el("i", { class: i < S.today.ap ? "on" : "" }));
      hudEl.appendChild(pips);
      if (view && !ui.msg) hudEl.appendChild(el("div", { class: "wr-hud-hint" }, [t("wr_hint_walk")]));
    }
  }
  function renderMsg() {
    msgEl.innerHTML = "";
    if (!ui.msg) return;
    var box = el("div", { class: "wr-msg", role: "dialog", onclick: closeMsg },
      ui.msg.map(function (ln) { return el("p", { class: /^（/.test(ln) ? "wr-msg-note" : /^【/.test(ln) ? "wr-msg-head" : "" }, [ln]); }).concat([el("span", { class: "wr-msg-next" }, ["▼ " + t("wr_tap")])]));
    msgEl.appendChild(box);
  }
  // 關掉對話框後整個重畫：排隊中的事件要在這時候出現
  function closeMsg() { ui.msg = null; render(); }
  function renderFallback() {
    fallbackEl.innerHTML = "";
    fallbackEl.style.display = view3dState === "ready" ? "none" : "";
    if (view3dState === "ready") return;
    var loc = S && S.phase === "free" && ui.loc ? D.LOC_BY_ID[ui.loc] : null;
    fallbackEl.className = "wr-fallback wr-sky-" + (!S ? "free" : S.phase);
    fallbackEl.appendChild(el("div", { class: "wr-fallback-icon" }, [loc ? loc.icon : "🏫"]));
    fallbackEl.appendChild(el("div", { class: "wr-fallback-name" }, [loc ? L(loc.name) : "私立音夣學園大學"]));
    if (view3dState === "fail") fallbackEl.appendChild(el("div", { class: "wr-small wr-muted" }, [t("wr_no3d")]));
  }

  // ---------------- 主畫面 ----------------
  function render() {
    renderTop();
    panelEl.innerHTML = "";
    if (ui.screen === "title" || !S) renderTitle();
    else if (S.phase === "report") renderReport(null);
    else if (S.phase === "yearreport") renderReport(S.yearReport);
    else {
      if (S.doki && !ui.msg && S.today) renderDoki();
      else if (S.events.length && !ui.msg && S.today) renderEvent();
      else if (S.phase === "morning") renderMorning();
      else if (S.phase === "class") renderClass();
      else if (S.phase === "exam") renderExam();
      else if (S.phase === "free") renderFree();
      else if (S.phase === "evening") renderEvening();
      else if (S.phase === "night") renderNight();
    }
    renderHud(); renderMsg(); renderFallback(); renderModal();
    sync3d();
    app.setAttribute("data-phase", S && ui.screen !== "title" ? S.phase : "title");
  }
  function section(title, children, cls) {
    return el("section", { class: "wr-sec " + (cls || "") }, [title ? el("h2", {}, [title]) : null].concat(children));
  }

  // ---------------- 標題 ----------------
  function renderTitle() {
    var saved = C.load();
    var nameIn = el("input", { class: "wr-input", type: "text", maxlength: "12", placeholder: t("wr_name_ph"), value: ui.name });
    nameIn.addEventListener("input", function () { ui.name = nameIn.value; });
    var lenSel = el("div", { class: "wr-seg" }, C.LENGTHS.map(function (l) {
      return btn(L(l.name) + "・" + (l.time ? L(l.time) : t("wr_hours", { n: l.hours })), function () { ui.lengthId = l.id; render(); }, "wr-seg-btn" + (ui.lengthId === l.id ? " on" : "") + (l.slow ? " wr-seg-slow" : ""));
    }));
    var meta = C.loadMeta();
    var ngBox = null;
    if (meta.clears > 0) {
      var cb = el("input", { type: "checkbox", checked: ui.inherit ? true : null });
      cb.addEventListener("change", function () { ui.inherit = cb.checked; });
      ngBox = el("label", { class: "wr-field wr-ng" }, [cb, el("span", {}, ["🔁 " + t("wr_ng", { n: meta.clears })]), el("small", { class: "wr-muted" }, [t("wr_ng_note")])]);
    }
    panelEl.appendChild(section(null, [
      el("p", { class: "wr-intro" }, [t("wr_intro")]),
      el("ul", { class: "wr-rules" }, [1, 2, 3, 4, 5, 6].map(function (i) { return el("li", {}, [t("wr_rule" + i)]); })),
      el("label", { class: "wr-field" }, [el("span", {}, [t("wr_name")]), nameIn]),
      el("div", { class: "wr-field" }, [el("span", {}, [t("wr_length")]), lenSel]),
      ngBox,
      el("div", { class: "wr-row" }, [
        btn("✨ " + t("wr_new_game"), function () {
          if (saved && saved.phase !== "report" && !window.confirm(t("wr_overwrite"))) return;
          S = C.newGame({ name: (ui.name || "").trim() || t("wr_default_name"), length: ui.lengthId, inherit: !!ui.inherit });
          ui.screen = "game"; ui.msg = [t("wr_open_1"), t("wr_open_2", { name: S.name })]; save();
          if (view) view.teleport("gate");
          render();
        }, "wr-btn wr-btn-main"),
        saved ? btn("▶ " + t("wr_continue") + "（" + C.termName(saved, Math.min(saved.day, saved.length - 1)) + " " + C.dateLabel(saved, Math.min(saved.day, saved.length - 1)) + "・" + saved.name + "）", function () {
          S = saved; ui.screen = "game"; ui.msg = null; if (view) view.teleport("gate"); render();
        }, "wr-btn") : null,
        btn("📔 " + t("wr_album"), function () { ui.modal = { type: "album", tab: "ach" }; renderModal(); }, "wr-btn wr-btn-ghost"),
        btn((ui.net ? "🟢 " : "🌐 ") + t("wr_online"), function () { ui.modal = { type: "net" }; renderModal(); }, "wr-btn wr-btn-ghost")
      ])
    ], "wr-title-sec"));
    // 女主角介紹
    var cast = el("div", { class: "wr-cast" });
    D.GROUPS.forEach(function (g) {
      cast.appendChild(el("h3", { style: "color:" + GROUP_COLOR[g.id] }, [L(g.name)]));
      var row = el("div", { class: "wr-cast-row" });
      D.HEROINES.filter(function (hd) { return hd.group === g.id && !hd.dyn; }).forEach(function (hd) {
        var secret = hd.hidden && !meta.ach.hiyori;   // 隱藏女主角：解鎖前只顯示剪影
        row.appendChild(el("div", { class: "wr-cast-card" + (secret ? " secret" : "") }, [face(hd, 44, null, secret ? "sil" : true), el("div", {}, [el("b", {}, [secret ? "？？？" : L(hd.name)]), el("div", { class: "wr-small wr-muted" }, [secret ? t("wr_hidden_hint") : L(hd.title)])])]));
      });
      cast.appendChild(row);
    });
    panelEl.appendChild(section(t("wr_cast"), [cast]));
  }
  // 頭像：2026-11-05 使用者指定改用時間管理大師（jikan）的女生照片，每次重開遊戲亂數打亂。
  // 照片的分配在 core（C.photoOf：以 S.seed 洗牌，同一場含讀檔固定）。標題畫面還沒開始遊戲時用每次載入的隨機種子。
  // 還沒認識的人顯示剪影（剪影尋人），認識之後才看得到照片。
  var IMG_BASE = app.getAttribute("data-img") || "../static/images/jikan/";
  var titleSeed = Math.floor(Math.random() * 2147483647) | 0;
  function curSeed() { return S ? S.seed : titleSeed; }
  function photoUrl(file) { return IMG_BASE + file + ".webp"; }
  // 剪影：從邊緣把白色背景去掉，其餘改成深紫色的雙色調（結果快取起來，3D 名牌也共用）
  var photoJobs = {};
  function photoCanvas(url, sil, cb) {
    var key = url + (sil ? "|s" : ""), job = photoJobs[key];
    if (job && job.done) { cb(job.out); return; }
    if (job) { job.q.push(cb); return; }
    job = photoJobs[key] = { done: false, q: [cb], out: null };
    var img = new Image();
    img.onload = function () {
      var out = img;
      if (sil) {
        var N = 128, c = document.createElement("canvas"); c.width = N; c.height = N;
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0, N, N);
        try {
          var id = g.getImageData(0, 0, N, N), d = id.data, seen = new Uint8Array(N * N), stack = [], i, k;
          var white = function (p) { return d[p * 4] > 222 && d[p * 4 + 1] > 222 && d[p * 4 + 2] > 222; };
          for (i = 0; i < N; i++) stack.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
          while (stack.length) {
            k = stack.pop();
            if (seen[k] || !white(k)) continue;
            seen[k] = 1;
            var x = k % N, y = (k / N) | 0;
            if (x > 0) stack.push(k - 1); if (x < N - 1) stack.push(k + 1); if (y > 0) stack.push(k - N); if (y < N - 1) stack.push(k + N);
          }
          for (k = 0; k < N * N; k++) {
            if (seen[k]) d[k * 4 + 3] = 0;
            else {
              // 雙色調暗影：保留明暗（看得出髮型、輪廓），看不出顏色
              var lu = Math.pow((d[k * 4] * 0.3 + d[k * 4 + 1] * 0.59 + d[k * 4 + 2] * 0.11) / 255, 1.3);
              d[k * 4] = 28 + lu * 120; d[k * 4 + 1] = 20 + lu * 110; d[k * 4 + 2] = 48 + lu * 140; d[k * 4 + 3] = 255;
            }
          }
          g.putImageData(id, 0, 0);
        } catch (e) { g.globalCompositeOperation = "source-in"; g.fillStyle = "#3a2a4a"; g.fillRect(0, 0, N, N); }
        out = c;
      }
      job.done = true; job.out = out;
      job.q.forEach(function (f) { f(out); }); job.q = [];
    };
    img.onerror = function () { delete photoJobs[key]; };
    img.src = url;
  }
  function photoImg(file, size, fallback, sil) {
    var s = size || 40;
    if (sil) {
      var c = el("canvas", { class: "wr-face wr-face-photo wr-face-sil", width: s * 2, height: s * 2, style: "width:" + s + "px;height:" + s + "px", "aria-label": "？" });
      photoCanvas(photoUrl(file), true, function (cv) { var g = c.getContext("2d"); if (g) { g.clearRect(0, 0, s * 2, s * 2); g.drawImage(cv, 0, 0, s * 2, s * 2); } });
      return c;
    }
    var im = el("img", { class: "wr-face wr-face-photo", src: photoUrl(file), alt: "", width: s, height: s, loading: "lazy", style: "width:" + s + "px;height:" + s + "px" });
    im.addEventListener("error", function () { if (im.parentNode) im.parentNode.replaceChild(fallback(), im); });
    return im;
  }
  // reveal：一律顯示照片（標題、回憶錄等跨存檔的畫面）
  function face(hd, size, look, reveal) {
    if (!hd) return drawnFace(hd, size, look);
    var file = C.photoOf(curSeed(), hd.id);
    if (!file) return drawnFace(hd, size, look);
    var sil = reveal === "sil" || (!reveal && S && ui.screen !== "title" && S.h[hd.id] && !S.h[hd.id].met);
    return photoImg(file, size, function () { return drawnFace(hd, size, look); }, sil);
  }
  // 迷妹頭像：特別迷妹沿用該女主角的照片，其餘從剩下的照片依名字挑一張
  function admirerFace(a, size, look) {
    if (a.special && D.HEROINE_BY_ID[a.special]) return face(D.HEROINE_BY_ID[a.special], size, look, true);
    return photoImg(C.photoOfAdmirer(curSeed(), a.name, a.role), size, function () { return drawnFace(null, size, look); });
  }
  // 備用頭像（照片載入失敗時用 3D 外觀的配色畫一個小圓臉）
  function drawnFace(hd, size, look) {
    var lk = look || hd.look;
    var s = size || 40;
    var c = el("canvas", { class: "wr-face", width: s * 2, height: s * 2, style: "width:" + s + "px;height:" + s + "px" });
    var g = c.getContext("2d");
    if (g) {
      var W = s * 2;
      g.fillStyle = hex(lk.top || 0x2a3358); g.beginPath(); g.arc(W / 2, W * 1.08, W * 0.46, 0, Math.PI * 2); g.fill();
      g.fillStyle = hex(lk.hair); g.beginPath(); g.arc(W / 2, W * 0.46, W * 0.33, 0, Math.PI * 2); g.fill();
      if (/long|wavy|curl/.test(lk.style || "")) g.fillRect(W * 0.17, W * 0.45, W * 0.66, W * 0.42);
      g.fillStyle = hex(lk.skin || 0xf6dcc8); g.beginPath(); g.arc(W / 2, W * 0.52, W * 0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = hex(lk.hair); g.beginPath(); g.ellipse(W / 2, W * 0.34, W * 0.27, W * 0.12, 0, 0, Math.PI * 2); g.fill();
      if (lk.style === "twin") { g.beginPath(); g.arc(W * 0.16, W * 0.56, W * 0.09, 0, Math.PI * 2); g.arc(W * 0.84, W * 0.56, W * 0.09, 0, Math.PI * 2); g.fill(); }
      if (/pony/.test(lk.style || "")) { g.beginPath(); g.arc(W * 0.8, W * 0.3, W * 0.1, 0, Math.PI * 2); g.fill(); }
      if (lk.style === "bun" || lk.style === "updo") { g.beginPath(); g.arc(W / 2, W * 0.15, W * 0.11, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#2a1e2a";
      g.beginPath(); g.ellipse(W * 0.42, W * 0.55, W * 0.03, W * 0.045, 0, 0, Math.PI * 2); g.ellipse(W * 0.58, W * 0.55, W * 0.03, W * 0.045, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(242,140,160,0.55)"; g.beginPath(); g.arc(W * 0.36, W * 0.63, W * 0.04, 0, Math.PI * 2); g.arc(W * 0.64, W * 0.63, W * 0.04, 0, Math.PI * 2); g.fill();
      if (lk.glasses) { g.strokeStyle = "#333"; g.lineWidth = W * 0.02; g.beginPath(); g.arc(W * 0.42, W * 0.55, W * 0.07, 0, Math.PI * 2); g.moveTo(W * 0.65, W * 0.55); g.arc(W * 0.58, W * 0.55, W * 0.07, 0, Math.PI * 2); g.stroke(); }
    }
    return c;
  }

  // ---------------- 事件 ----------------
  function renderEvent() {
    var ev = S.events[0], v = C.eventView(S, ev);
    panelEl.appendChild(section(v.title, [
      ev.type === "fanPromote" ? el("div", { class: "wr-ev-face" }, [admirerFace({ name: ev.who, role: ev.role }, 64, { hair: ev.hair || 0x2a1e1a })]) :
      ev.hid ? el("div", { class: "wr-ev-face" }, [face(D.HEROINE_BY_ID[ev.hid], 64)]) : ev.type === "shura" ? el("div", { class: "wr-ev-face" }, [face(D.HEROINE_BY_ID[ev.a], 56), el("span", { class: "wr-vs" }, ["⚡"]), face(D.HEROINE_BY_ID[ev.b], 56)]) : null,
      el("p", { class: "wr-ev-text" }, v.text.split("\n").map(function (ln, i) { return i ? el("span", { class: "wr-ev-line" }, [ln]) : ln; })),
      el("div", { class: "wr-col" }, v.opts.map(function (o, i) { return btn(o, function () { act(function () { return C.resolveEvent(S, i); }); }, "wr-btn wr-btn-opt"); }))
    ], "wr-event wr-event-" + ev.type));
  }

  // ---------------- 💓 心跳時刻（2026-11-06） ----------------
  // 第 1 步：選做法（大膽／溫柔／含蓄）。她最心動的做法猜中一次之後會標 ♥。
  // 第 2 步：節拍小遊戲——她的心跳（BPM 隨好感變快），圓圈縮到愛心上的瞬間按 💓（也可以按空白鍵、點愛心）。
  var dokiRaf = 0, dokiKey = null, dokiRun = null;
  function dokiStop() {
    if (dokiRaf) cancelAnimationFrame(dokiRaf);
    dokiRaf = 0;
    if (dokiKey) { document.removeEventListener("keydown", dokiKey); dokiKey = null; }
  }
  function renderDoki() {
    dokiStop();
    var dk = S.doki, sit = C.dokiSit(S), hid = dk.hid, hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
    var nm = hname(hid), confess = dk.sit === "confess";
    var head = el("div", { class: "wr-doki-head" }, [face(hd, 64), el("div", {}, [
      el("div", { class: "wr-doki-kicker" }, [confess ? "💘 " + t("wr_doki_confess") : "💓 " + t("wr_doki")]),
      el("b", {}, [sit.title]), el("div", { class: "wr-small wr-muted" }, [nm + "・" + C.stageName(S, hid)])
    ])]);
    var text = el("p", { class: "wr-ev-text" }, [C.fmt(sit.text, { n: nm })]);
    if (dk.step === "choose") {
      var known = h.dokiTone;
      panelEl.appendChild(section(null, [head, text,
        el("div", { class: "wr-col" }, D.DOKI_TONES.map(function (tn, i) {
          return btn(el("span", {}, [el("b", {}, [tn.icon + " " + L(tn.name) + (known === tn.id ? " ♥" : "")]), el("small", {}, [sit.opts[i]])]), function () {
            C.dokiChoose(S, tn.id); save(); render();
          }, "wr-btn wr-btn-card wr-doki-opt" + (known === tn.id ? " wr-doki-known" : ""));
        })),
        el("p", { class: "wr-small wr-muted" }, [t(known ? "wr_doki_known" : "wr_doki_hint", { n: nm })])
      ], "wr-event wr-doki"));
      return;
    }
    // 節拍
    var bpm = C.dokiBpm(S, hid), period = 60000 / bpm, B = D.DOKI_BEAT, taps = B.taps;
    // 重繪（3D 點擊等）時延續同一輪節拍，不要重來
    if (!dokiRun || dokiRun.dk !== dk) dokiRun = { dk: dk, got: [], pts: 0, done: false, t0: performance.now() + 600 };
    var run = dokiRun, got = run.got, t0 = run.t0;
    var ring = el("div", { class: "wr-doki-ring" });
    var heart = el("div", { class: "wr-doki-heart" }, ["💗"]);
    var judge = el("div", { class: "wr-doki-judge" }, [" "]);
    var dots = el("div", { class: "wr-doki-dots" });
    function drawDots() {
      dots.innerHTML = "";
      for (var i = 0; i < taps; i++) dots.appendChild(el("span", { class: "wr-doki-dot" + (got[i] === 2 ? " p" : got[i] === 1 ? " g" : got[i] === 0 ? " m" : "") }, [got[i] === 2 ? "💖" : got[i] === 1 ? "💗" : got[i] === 0 ? "💔" : "♡"]));
    }
    drawDots();
    function finish() {
      if (run.done) return;
      run.done = true; dokiStop();
      setTimeout(function () { if (S.doki === dk) act(function () { return C.dokiFinish(S, run.pts); }); }, 650);
    }
    function tap() {
      if (run.done) return;
      var now = performance.now();
      if (now < t0 - period * 0.25) return;   // 開始前
      var ph = (((now - t0) % period) + period) % period / period, dist = Math.min(ph, 1 - ph);
      var r = dist < B.perfect ? 2 : dist < B.good ? 1 : 0;
      got.push(r); run.pts += r;
      judge.textContent = r === 2 ? "PERFECT 💖" : r === 1 ? "GOOD 💗" : "MISS 💔";
      judge.className = "wr-doki-judge j" + r;
      drawDots();
      if (got.length >= taps) finish();
    }
    // 按鈕用 pointerdown（比 click 早、手機上不延遲）；鍵盤由 document 的 keydown 處理，避免空白鍵按一次算兩次
    var tapBtn = el("button", { type: "button", class: "wr-btn wr-btn-main wr-doki-tapbtn", tabindex: "-1" }, ["💓 " + t("wr_doki_tap")]);
    tapBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
    var pad = el("div", { class: "wr-doki-pad", role: "button", tabindex: "0", "aria-label": t("wr_doki_tap") }, [ring, heart]);
    pad.addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
    dokiKey = function (e) { if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); tap(); } };
    document.addEventListener("keydown", dokiKey);
    var limit = t0 + period * (taps + 4);   // 太久沒按：剩下的都算沒按到
    function frame() {
      if (!pad.isConnected) { dokiStop(); return; }
      var now = performance.now();
      var ph = now < t0 ? 1 - (t0 - now) / 600 : (((now - t0) % period) / period);
      var beat = Math.max(0, 1 - Math.min(ph, 1 - ph) / 0.12);
      heart.style.transform = "scale(" + (1 + beat * 0.32).toFixed(3) + ")";
      ring.style.transform = "scale(" + (1 + 1.6 * (1 - ph)).toFixed(3) + ")";
      ring.style.opacity = (0.25 + 0.75 * ph).toFixed(2);
      if (now > limit && !run.done) { while (got.length < taps) got.push(0); judge.textContent = "MISS 💔"; drawDots(); finish(); return; }
      dokiRaf = requestAnimationFrame(frame);
    }
    panelEl.appendChild(section(null, [head, text,
      el("div", { class: "wr-doki-bpm" }, [t("wr_doki_bpm", { n: nm, bpm: bpm })]),
      pad, judge, dots,
      tapBtn,
      el("p", { class: "wr-small wr-muted" }, [t("wr_doki_beat_hint")])
    ], "wr-event wr-doki wr-doki-beat"));
    dokiRaf = requestAnimationFrame(frame);
  }

  // ---------------- 早上 ----------------
  function renderMorning() {
    var sp = C.special(S);
    if (sp && sp.text) panelEl.appendChild(el("div", { class: "wr-special" }, [el("b", {}, [sp.icon + " " + L(sp.name)]), " ", sp.text]));
    if (S.summary && S.summary.lines.length && S.summary.day === S.day - 1) {
      panelEl.appendChild(section(t("wr_last_night"), [el("ul", { class: "wr-loglist" }, S.summary.lines.map(function (l) { return el("li", {}, [l]); }))], "wr-sec-sum"));
    }
    var list = el("div", { class: "wr-admirers" });
    S.today.admirers.forEach(function (a, i) {
      var ap = C.approachOf(a.ap);
      var lk = a.special ? D.HEROINE_BY_ID[a.special].look : { hair: a.hair, skin: 0xf6dcc8, top: 0x2a3358, style: ["long", "twin", "ponytail", "bob", "bun"][a.name.length % 5] };
      var ty = D.ADMIRER_TYPES.filter(function (x) { return x.id === (a.type || "pure"); })[0];
      var card = el("div", { class: "wr-adm" + (a.choice !== null ? " done" : "") + (a.special ? " special" : "") }, [
        el("div", { class: "wr-adm-head" }, [admirerFace(a, 40, lk), el("div", {}, [el("b", {}, [a.name]), " ", el("span", { class: "wr-small wr-muted" }, [a.role]),
          a.special ? el("span", { class: "wr-badge wr-badge-festival" }, ["🌙 " + t("wr_adm_special", { n: S.flags.hiyoriN || 0 })]) : el("span", { class: "wr-badge wr-adm-type wr-adm-" + ty.id, title: t("wr_adm_type_note") }, [ty.icon + " " + L(ty.name)]),
          a.ret ? el("span", { class: "wr-badge" }, [a.ret === "fan" ? t("wr_adm_fan") : t("wr_adm_again")]) : null])]),
        el("p", { class: "wr-adm-text" }, [ap.icon + " ", a.ret ? D.RETURN_TEXT[a.ret] + " " : "", ap.text]),
        a.choice !== null ? el("div", { class: "wr-adm-res" }, ["→ " + ap.opts[a.choice].label]) :
          el("div", { class: "wr-row wr-adm-opts" }, ap.opts.map(function (o, oi) {
            return btn((oi === 0 ? "💗 " : oi === ap.opts.length - 1 ? "🙈 " : "🙇 ") + o.label, function () { act(function () { return C.answerAdmirer(S, i, oi); }); }, "wr-btn wr-btn-sm" + (oi === 0 ? " wr-btn-pink" : ""));
          }))
      ]);
      list.appendChild(card);
    });
    var left = S.today.admirers.filter(function (a) { return a.choice === null; }).length;
    panelEl.appendChild(section(t("wr_morning_title", { n: S.today.admirers.length }), [
      el("p", { class: "wr-small wr-muted" }, [t("wr_morning_note")]),
      C.chatUnread(S) ? el("div", { class: "wr-row" }, [phoneBtn("wr-btn wr-btn-sm wr-btn-pink")]) : null,
      list,
      el("div", { class: "wr-row" }, [btn((left ? "🙈 " + t("wr_ignore_rest", { n: left }) + " → " : "") + t(S.today.kind === "weekday" ? "wr_go_class" : S.today.kind === "midterm" || S.today.kind === "final" ? "wr_go_exam" : "wr_go_free"), function () {
        act(function () { C.finishMorning(S); if (view) view.teleport(S.phase === "free" ? "gate" : "classroom"); return null; });
      }, "wr-btn wr-btn-main")])
    ]));
  }

  // ---------------- 上課 ----------------
  function renderClass() {
    panelEl.appendChild(section(t("wr_class_title"), [
      el("p", { class: "wr-small wr-muted" }, [t("wr_class_note")]),
      el("div", { class: "wr-grid2" }, D.CLASS_OPTS.map(function (o) {
        return btn(el("span", {}, [el("b", {}, [o.icon + " " + L(o.name)]), el("small", {}, [o.note])]), function () {
          act(function () { var r = C.doClass(S, o.id); if (view) view.teleport("classroom"); return r; });
        }, "wr-btn wr-btn-card");
      }))
    ]));
  }
  function renderExam() {
    var fin = S.today.kind === "final";
    panelEl.appendChild(section(fin ? t("wr_kind_final") : t("wr_kind_midterm"), [
      el("p", {}, [t("wr_exam_note", { s: Math.round(S.stats.study) })]),
      el("div", { class: "wr-grid2" }, [
        btn(el("span", {}, [el("b", {}, ["🔥 " + t("wr_exam_hard")]), el("small", {}, [t("wr_exam_hard_n")])]), function () { act(function () { return C.doExam(S, true); }); }, "wr-btn wr-btn-card"),
        btn(el("span", {}, [el("b", {}, ["📝 " + t("wr_exam_norm")]), el("small", {}, [t("wr_exam_norm_n")])]), function () { act(function () { return C.doExam(S, false); }); }, "wr-btn wr-btn-card")
      ])
    ]));
  }

  // ---------------- 自由時間 ----------------
  function renderFree() {
    var loc = ui.loc ? D.LOC_BY_ID[ui.loc] : null;
    var ap = S.today.ap;
    var head = el("div", { class: "wr-free-head" }, [
      el("h2", {}, [loc ? loc.icon + " " + L(loc.name) : "🚶 " + t("wr_walking")]),
      el("span", { class: "wr-apnum" }, [t("wr_ap") + " ", el("b", {}, [ap]), " / " + S.today.apMax]),
      S.today.date ? el("span", { class: "wr-badge wr-badge-date" }, ["💌 " + t("wr_date_tonight", { n: hname(S.today.date) })]) : null
    ]);
    panelEl.appendChild(head);
    // 約好見面的提醒（第 10 項）
    var mu = S.today.meetup;
    if (mu && !mu.done) {
      var used = S.today.apMax - S.today.ap;
      panelEl.appendChild(el("div", { class: "wr-special wr-meetup" + (used > mu.by ? " late" : "") }, ["⏰ " + t(used > mu.by ? "wr_meetup_late" : "wr_meetup", { n: hname(mu.hid), l: L(D.LOC_BY_ID[mu.loc].name), k: Math.max(0, mu.by - used) })]));
    }
    // 剪影尋人（2026-11-05）
    var hu = S.today.hunt, huHd = hu && D.HEROINE_BY_ID[hu.hid];
    if (huHd) {
      var huG = D.GROUPS.filter(function (g) { return g.id === huHd.group; })[0];
      panelEl.appendChild(el("div", { class: "wr-hunt" + (hu.done ? " done" : "") }, [
        photoImg(C.photoOf(S.seed, hu.hid), 52, function () { return drawnFace(huHd, 52); }, !hu.done),
        el("div", {}, [
          el("b", {}, [hu.done ? "✅ " + t("wr_hunt_done", { n: hname(hu.hid) }) : "🔍 " + t("wr_hunt")]),
          hu.done ? null : el("div", { class: "wr-small" }, [t("wr_hunt_hint", { g: huG ? L(huG.name) : "", l: hu.loc ? L(D.LOC_BY_ID[hu.loc].name) : "？" })]),
          hu.done ? null : el("div", { class: "wr-small wr-muted" }, [t("wr_hunt_reward")])
        ])
      ]));
    }
    if (!loc) {
      panelEl.appendChild(el("p", { class: "wr-small wr-muted" }, [view ? t("wr_free_hint3d") : t("wr_free_hint")]));
    } else {
      renderLocation(loc);
    }
    // 快速前往
    var go = el("div", { class: "wr-golist" });
    D.LOCATIONS.forEach(function (l) {
      var here = C.heroinesAt(S, l.id);
      var b = btn(el("span", {}, [l.icon + " " + L(l.name), el("span", { class: "wr-go-faces" }, here.map(function (hid) {
        var h = S.h[hid];
        return el("i", { class: "wr-dot" + (h.met ? "" : " unknown") + (h.dating ? " lover" : ""), title: h.met ? hname(hid) : "？", style: "background:" + (h.met ? GROUP_COLOR[D.HEROINE_BY_ID[hid].group] : "#bbb") });
      }))]), function () {
        if (view) view.teleport(l.id);
        else { ui.loc = l.id; ui.topicFor = null; ui.giftFor = null; ui.shop = false; var r = C.arrive(S, l.id); if (r) { say(r); save(); } render(); }
      }, "wr-btn wr-btn-go" + (ui.loc === l.id ? " on" : ""));
      go.appendChild(b);
    });
    panelEl.appendChild(section(t("wr_goto"), [go, el("p", { class: "wr-small wr-muted" }, [t("wr_goto_note")])], "wr-sec-go"));
    panelEl.appendChild(el("div", { class: "wr-row wr-endrow" }, [btn("🌆 " + t("wr_end_free") + (ap ? "（" + t("wr_ap_left", { n: ap }) + "）" : ""), function () {
      if (ap > 0 && !window.confirm(t("wr_end_free_confirm", { n: ap }))) return;
      act(function () { var r = C.endFree(S); if (view) view.teleport("plaza"); return r; });
    }, "wr-btn wr-btn-main")]));
  }
  function renderLocation(loc) {
    var a = loc.act;
    var acts = el("div", { class: "wr-row" });
    if (a) acts.appendChild(btn(el("span", {}, [el("b", {}, [L(a.name)]), el("small", {}, [a.note + (a.ap ? "・" + t("wr_ap") + " " + a.ap : "")])]), function () {
      act(function () { var r = C.locAction(S, loc.id); if (S.phase !== "free" && view) view.teleport("plaza"); return r; });
    }, "wr-btn wr-btn-card", { disabled: a.ap > S.today.ap }));
    if (loc.shop) acts.appendChild(btn(el("span", {}, [el("b", {}, ["🛒 " + t("wr_shop")]), el("small", {}, [t("wr_shop_note")])]), function () { ui.modal = { type: "shop" }; renderModal(); }, "wr-btn wr-btn-card"));
    // 社團（第 5 項）：活動日在社團的地點可以參加；社團大樓可以加入／更換
    var club = S.club && D.CLUB_BY_ID[S.club];
    if (club && club.loc === loc.id) {
      var can = C.canClubAction(S, loc.id);
      acts.appendChild(btn(el("span", {}, [el("b", {}, [club.icon + " " + t("wr_club_act")]), el("small", {}, [can ? t("wr_club_act_note") : S.today.clubDone ? t("wr_club_done") : t("wr_club_days")])]), function () {
        act(function () { return C.clubAction(S, loc.id); });
      }, "wr-btn wr-btn-card wr-btn-club", { disabled: !can || S.today.ap < 1 }));
    }
    if (loc.id === "club") acts.appendChild(btn(el("span", {}, [el("b", {}, ["🎪 " + t(S.club ? "wr_club_change" : "wr_club_join")]), el("small", {}, [club ? club.icon + " " + L(club.name) : t("wr_club_none")])]), function () { ui.modal = { type: "club" }; renderModal(); }, "wr-btn wr-btn-card"));
    panelEl.appendChild(acts);
    // 地點型任務
    C.locQuests(S, loc.id).forEach(function (hid) {
      var q = C.questOf(S, hid);
      panelEl.appendChild(el("div", { class: "wr-quest" }, [
        el("b", {}, ["📜 " + t("wr_quest") + "：" + q.title]), el("span", { class: "wr-small" }, ["（" + hname(hid) + "）"]),
        el("p", { class: "wr-small" }, [q.desc]),
        btn(t("wr_do_quest"), function () { act(function () { return C.doQuest(S, hid, loc.id); }); }, "wr-btn wr-btn-pink wr-btn-sm", { disabled: S.today.ap < 1 })
      ]));
    });
    var here = C.heroinesAt(S, loc.id);
    if (!here.length) { panelEl.appendChild(el("p", { class: "wr-muted wr-small" }, [t("wr_nobody")])); return; }
    // 雙人互動
    C.pairsAt(S, loc.id).forEach(function (p) {
      panelEl.appendChild(el("div", { class: "wr-pair" }, [face(D.HEROINE_BY_ID[p.a], 32), face(D.HEROINE_BY_ID[p.b], 32),
        btn("👭 " + t("wr_pair_talk", { a: hname(p.a), b: hname(p.b) }), function () { act(function () { return C.pairTalk(S, p.a, p.b); }); }, "wr-btn wr-btn-sm", { disabled: S.today.ap < 1 })]));
    });
    here.forEach(function (hid) { panelEl.appendChild(heroineCard(hid, loc.id)); });
  }
  function affBar(hid) {
    var h = S.h[hid], cap = C.affCap(S, hid);
    return el("div", { class: "wr-aff", title: t("wr_aff") + " " + h.aff }, [
      el("i", { class: "wr-aff-fill" + (h.dating ? " lover" : ""), style: "width:" + h.aff + "%" }),
      cap < 100 ? el("i", { class: "wr-aff-cap", style: "left:" + cap + "%" }) : null,
      el("span", {}, [h.aff])
    ]);
  }
  function heroineCard(hid, locId) {
    var hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
    var noAp = S.today.ap < 1;
    var card = el("div", { class: "wr-hcard" + (ui.focus === hid ? " focus" : "") + (h.dating ? " lover" : ""), style: "--wr-g:" + GROUP_COLOR[hd.group] });
    card.appendChild(el("div", { class: "wr-hcard-head" }, [
      face(hd, 52),
      el("div", { class: "wr-hcard-info" }, [
        el("div", {}, [el("b", {}, [h.met ? L(hd.name) : "？？？"]), " ", el("span", { class: "wr-badge" }, [C.stageName(S, hid)])]),
        el("div", { class: "wr-small wr-muted" }, [h.met ? L(hd.title) : L(D.GROUPS.filter(function (g) { return g.id === hd.group; })[0].name)]),
        h.met ? affBar(hid) : null
      ])
    ]));
    if (!h.met) {
      card.appendChild(el("div", { class: "wr-row" }, [btn("👋 " + t("wr_meet"), function () { act(function () { return C.meet(S, hid); }); }, "wr-btn wr-btn-pink", { disabled: noAp })]));
      return card;
    }
    // 連擊與隱藏對話的提示（第 2 項）、交往階段（第 7 項）
    var combo = S.day - (h.comboDay === undefined ? -99 : h.comboDay) <= 3 ? (h.combo || 0) : 0;
    var ht = D.HIDDEN_TALKS[hid];
    var tags = el("div", { class: "wr-row wr-tags" }, [
      h.dating ? el("span", { class: "wr-badge wr-badge-date" }, ["💞 " + L(D.REL_STAGES[h.rel || 1].name)]) : null,
      combo >= 1 ? el("span", { class: "wr-badge wr-combo" }, ["🔥 " + t("wr_combo", { n: combo })]) : null,
      combo >= 2 && ht && !h.hiddenSeen && (!ht.needMet || S.h[ht.needMet].met) ? el("span", { class: "wr-small wr-hidden-hint" }, ["✨ " + t("wr_hidden_talk_hint")]) : null,
      S.club && D.CLUB_BY_ID[S.club].members.indexOf(hid) >= 0 ? el("span", { class: "wr-badge" }, [D.CLUB_BY_ID[S.club].icon + " " + t("wr_club_mate")]) : null
    ]);
    if (tags.childNodes.length) card.appendChild(tags);
    var row = el("div", { class: "wr-row" });
    row.appendChild(btn("💬 " + t("wr_talk") + ((S.today.talked[hid] || 0) ? " ×" + S.today.talked[hid] : ""), function () { ui.topicFor = ui.topicFor === hid ? null : hid; ui.giftFor = null; render(); }, "wr-btn wr-btn-sm" + (ui.topicFor === hid ? " on" : ""), { disabled: noAp }));
    row.appendChild(btn("🎁 " + t("wr_gift"), function () { ui.giftFor = ui.giftFor === hid ? null : hid; ui.topicFor = null; render(); }, "wr-btn wr-btn-sm" + (ui.giftFor === hid ? " on" : ""), { disabled: noAp || S.today.gifted[hid] }));
    if (C.canInvite(S, hid)) row.appendChild(btn("💌 " + t(C.isWeekend(S) ? "wr_invite_day" : "wr_invite"), function () { act(function () { return C.invite(S, hid); }); }, "wr-btn wr-btn-sm", { disabled: noAp }));
    else if (!S.today.date && !S.today.invited[hid] && h.aff < C.inviteMin(hid)) row.appendChild(el("span", { class: "wr-small wr-muted" }, [t("wr_invite_need", { n: C.inviteMin(hid) })]));
    var q = C.questOf(S, hid);
    if (q && q.req.type !== "loc" && !S.today.quests[hid]) {
      var ok = C.reqMet(S, q.req, locId);
      card.appendChild(el("div", { class: "wr-quest" }, [
        el("b", {}, ["📜 " + t("wr_quest") + "：" + q.title]),
        el("p", { class: "wr-small" }, [q.desc]),
        el("div", { class: "wr-small" + (ok ? " wr-good" : " wr-bad") }, [t("wr_req") + "：" + C.reqText(q.req)]),
        btn(t("wr_do_quest"), function () { act(function () { return C.doQuest(S, hid, locId); }); }, "wr-btn wr-btn-pink wr-btn-sm", { disabled: !ok || noAp })
      ]));
    } else if (q && q.req.type === "loc" && !S.today.quests[hid]) {
      card.appendChild(el("div", { class: "wr-small wr-quest-mini" }, ["📜 " + q.title + "：" + C.reqText(q.req)]));
    }
    if (C.canConfess(S, hid)) {
      var lack = C.confessReq(S, hid);
      card.appendChild(el("div", { class: "wr-confess" }, [
        btn("💘 " + t("wr_confess"), function () { if (window.confirm(t("wr_confess_confirm", { n: hname(hid) }))) act(function () { return C.confessStart(S, hid); }); }, "wr-btn wr-btn-pink", { disabled: noAp || lack.length > 0 }),
        lack.length ? el("span", { class: "wr-small wr-bad" }, [t("wr_confess_need") + "：" + lack.join("、")]) : el("span", { class: "wr-small wr-good" }, [t("wr_confess_ok")])
      ]));
    }
    card.appendChild(row);
    if (ui.topicFor === hid) {
      var tp = el("div", { class: "wr-topics" }, [el("div", { class: "wr-small wr-muted" }, [t("wr_pick_topic")])]);
      C.talkTopics(S, hid).forEach(function (tid) {
        var k = h.known.topics[tid];
        tp.appendChild(btn(el("span", {}, [L(D.TOPIC_BY_ID[tid].name), k ? el("i", { class: "wr-pref wr-pref-" + k }, [k === "like" ? "♥" : k === "bad" ? "✕" : "・"]) : null]), function () {
          act(function () { return C.talk(S, hid, tid); });
        }, "wr-btn wr-btn-topic"));
      });
      card.appendChild(tp);
    }
    if (ui.giftFor === hid) {
      var items = Object.keys(S.inv);
      var gp = el("div", { class: "wr-topics" }, [el("div", { class: "wr-small wr-muted" }, [items.length ? t("wr_pick_gift") : t("wr_no_items")])]);
      items.forEach(function (iid) {
        var it = D.ITEM_BY_ID[iid], k = h.known.gifts[iid];
        gp.appendChild(btn(el("span", {}, [it.icon + " " + L(it.name) + " ×" + S.inv[iid], k ? el("i", { class: "wr-pref wr-pref-" + k }, [k === "like" ? "♥" : k === "bad" ? "✕" : "・"]) : null]), function () {
          act(function () { ui.giftFor = null; return C.gift(S, hid, iid); });
        }, "wr-btn wr-btn-topic"));
      });
      card.appendChild(gp);
    }
    return card;
  }

  // ---------------- 晚上 ----------------
  function renderEvening() {
    var td = S.today;
    if (td.date) {
      var hid = td.date, hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
      if (td.dateRun && !td.dateRun.done) {
        // 約會：依地點出 2〜3 題，她當天的心情會影響喜歡的回答（第 1 項）
        var run = td.dateRun, m = C.dateMoment(S), sp = D.DATE_BY_ID[run.spot];
        var mood = D.MOODS.filter(function (x) { return x.id === run.mood; })[0];
        var sk = C.skillAnswer(S);
        var opts = ["romantic", "funny", "earnest"].map(function (k) {
          return btn(m.opts[k], function () { act(function () { return C.answerDate(S, k); }); }, "wr-btn wr-btn-opt");
        });
        if (sk) opts.push(btn("🌟 " + t("wr_date_skill", { s: L(D.SKILL_BY_ID[sk].name) }), function () { act(function () { return C.answerDate(S, "skill"); }); }, "wr-btn wr-btn-opt wr-btn-skill"));
        panelEl.appendChild(section("💕 " + t("wr_date_with", { n: hname(hid) }) + "・" + sp.icon + " " + L(sp.name), [
          el("div", { class: "wr-ev-face" }, [face(hd, 72)]),
          el("div", { class: "wr-row wr-date-meta" }, [el("span", { class: "wr-badge" }, [t("wr_date_step", { i: run.step + 1, n: run.list.length })]), el("span", { class: "wr-small wr-muted" }, [mood.icon + " " + mood.hint])]),
          el("p", { class: "wr-ev-text" }, [m.text]),
          el("div", { class: "wr-col" }, opts)
        ], "wr-event"));
        return;
      }
      var spots = el("div", { class: "wr-grid2" });
      C.dateSpots(S).forEach(function (sp) {
        spots.appendChild(btn(el("span", {}, [el("b", {}, [sp.icon + " " + L(sp.name) + (C.outfitFits(S, sp.id) ? " 👔" : "")]), el("small", {}, [(sp.cost ? money(sp.cost) : t("wr_free_cost")) + (C.outfitFits(S, sp.id) ? "・" + t("wr_date_fit") : "")])]), function () {
          var r = C.startDate(S, sp.id);
          if (r && r.error) say([r.error]);
          save(); render();
        }, "wr-btn wr-btn-card", { disabled: S.stats.money < sp.cost }));
      });
      panelEl.appendChild(section("💌 " + t("wr_date_with", { n: hname(hid) }), [
        el("div", { class: "wr-hcard-head" }, [face(hd, 52), el("div", {}, [el("b", {}, [L(hd.name)]), affBar(hid)])]),
        el("p", { class: "wr-small wr-muted" }, [t("wr_date_pick")]),
        C.specialEvening(S) ? el("p", { class: "wr-small wr-special" }, [t("wr_date_special", { e: C.specialEvening(S).title })]) : null,
        spots,
        outfitRow(),
        el("div", { class: "wr-row" }, [btn("🙇 " + t("wr_date_cancel"), function () { if (window.confirm(t("wr_date_cancel_confirm"))) act(function () { return C.cancelDate(S); }); }, "wr-btn wr-btn-ghost")])
      ]));
      return;
    }
    var spEv = C.specialEvening(S);
    if (spEv) {
      var can = D.HEROINES.filter(function (hd) { return S.h[hd.id].met && S.h[hd.id].aff >= 40; });
      panelEl.appendChild(section((C.special(S).icon || "🔥") + " " + spEv.title, [
        el("p", {}, [spEv.note]),
        can.length ? el("div", { class: "wr-cast-row" }, can.map(function (hd) {
          return btn(el("span", { class: "wr-pickface" }, [face(hd, 40), L(hd.name)]), function () { act(function () { return C.festDance(S, hd.id); }); }, "wr-btn wr-btn-card");
        })) : el("p", { class: "wr-muted wr-small" }, [t("wr_fest_none")])
      ]));
    }
    if (ui.eveningPick === "sns") {
      var lv = C.loversOf(S), posts = el("div", { class: "wr-grid2" });
      D.SNS_POSTS.forEach(function (p) {
        var go = function (arg) { return function () { ui.eveningPick = null; act(function () { return C.doEvening(S, "sns", arg); }); }; };
        if (p.need === "lover") {
          if (!lv.length) posts.appendChild(btn(el("span", {}, [el("b", {}, [p.icon + " " + L(p.name)]), el("small", {}, [t("wr_sns_lover_none")])]), null, "wr-btn wr-btn-card", { disabled: true }));
          lv.forEach(function (hid) { posts.appendChild(btn(el("span", { class: "wr-pickface" }, [face(D.HEROINE_BY_ID[hid], 32), el("span", {}, [el("b", {}, [p.icon + " " + L(p.name) + "：" + hname(hid)]), el("small", {}, [p.note])])]), go("lover:" + hid), "wr-btn wr-btn-card")); });
          return;
        }
        posts.appendChild(btn(el("span", {}, [el("b", {}, [p.icon + " " + L(p.name) + (S.lastPost === p.id ? "（" + t("wr_sns_again") + "）" : "")]), el("small", {}, [p.note])]), go(p.id), "wr-btn wr-btn-card", { disabled: p.need === "club" && !S.club }));
      });
      panelEl.appendChild(section("📱 " + t("wr_sns_pick", { n: S.sns.toLocaleString() }), [posts, btn(t("wr_back"), function () { ui.eveningPick = null; render(); }, "wr-btn wr-btn-ghost")]));
      return;
    }
    if (ui.eveningPick === "message") {
      var tg = D.HEROINES.filter(function (hd) { return S.h[hd.id].met && S.h[hd.id].aff >= 20; });
      panelEl.appendChild(section("💬 " + t("wr_msg_pick"), [
        tg.length ? el("div", { class: "wr-cast-row" }, tg.map(function (hd) {
          return btn(el("span", { class: "wr-pickface" }, [face(hd, 40), L(hd.name)]), function () {
            ui.eveningPick = null;
            // 2026-11-05：直接打開手機，在聊天室裡聊 3 回合
            act(function () { var r = C.doEvening(S, "message", hd.id); if (r) ui.modal = { type: "phone", hid: hd.id }; return null; });
          }, "wr-btn wr-btn-card");
        })) : el("p", { class: "wr-muted" }, [t("wr_msg_none")]),
        btn(t("wr_back"), function () { ui.eveningPick = null; render(); }, "wr-btn wr-btn-ghost")
      ]));
      return;
    }
    panelEl.appendChild(section("🌙 " + t("wr_evening_title"), [
      el("div", { class: "wr-grid2" }, D.EVENING_OPTS.map(function (o) {
        var dis = o.eff.money < 0 && S.stats.money < -o.eff.money;
        return btn(el("span", {}, [el("b", {}, [o.icon + " " + L(o.name)]), el("small", {}, [o.note])]), function () {
          if (o.id === "message" || o.id === "sns") { ui.eveningPick = o.id; render(); return; }
          act(function () { return C.doEvening(S, o.id); });
        }, "wr-btn wr-btn-card", { disabled: dis });
      })),
      // 練專長（第 6 項）
      el("h3", {}, ["🎓 " + t("wr_skill_practice")]),
      el("div", { class: "wr-grid2" }, D.SKILL_EVENINGS.map(function (o) {
        var dis = o.eff.money < 0 && S.stats.money < -o.eff.money;
        return btn(el("span", {}, [el("b", {}, [o.icon + " " + L(o.name)]), el("small", {}, [o.note + "（" + Math.round(S.skills[o.skill]) + "）"])]), function () {
          act(function () { return C.doEvening(S, o.id); });
        }, "wr-btn wr-btn-card", { disabled: dis });
      }))
    ]));
  }
  function renderNight() {
    var yearEnd = S.day + 1 < S.length && C.cal(S, S.day + 1).year !== C.cal(S).year;
    var next = S.day + 1 >= S.length ? t("wr_to_report") : yearEnd ? t("wr_to_year_report") : t("wr_sleep");
    panelEl.appendChild(section("🌃 " + t("wr_night_title"), [
      el("p", { class: "wr-small wr-muted" }, [t("wr_night_note")]),
      C.chatUnread(S) ? el("div", { class: "wr-row" }, [phoneBtn("wr-btn wr-btn-pink"), el("span", { class: "wr-small wr-muted" }, [t("wr_phone_before_sleep")])]) : null,
      el("div", { class: "wr-row" }, [btn("😴 " + next, function () {
        C.endDay(S);
        ui.loc = null; ui.focus = null; ui.topicFor = null; ui.giftFor = null;
        if (view) view.teleport("gate");
        save(); render();
      }, "wr-btn wr-btn-main")])
    ]));
  }

  // ---------------- 報告 ----------------
  // year＝null 是最後的總報告；數字是該學年的中間報告
  function renderReport(year) {
    var r = C.report(S, year);
    setTimeout(achievementToast, 0);
    var head = el("div", { class: "wr-rep-head" }, [
      el("div", { class: "wr-rep-rank wr-rank-" + r.rank }, [r.rank]),
      el("div", {}, [el("div", { class: "wr-small wr-muted" }, [t("wr_rep_title_label")]), el("div", { class: "wr-rep-title" }, ["「" + r.title + "」"]), el("p", { class: "wr-small" }, [r.titleComment])])
    ]);
    var nums = el("div", { class: "wr-rep-nums" }, [
      num(t("wr_rep_grade"), r.letter, r.grade + " / 100"),
      num(t("wr_rep_exam"), r.examAvg, t("wr_rep_exam_n", { n: r.exams.length }) + (r.exams.length ? "・" + t("wr_rep_exam_best", { n: Math.max.apply(null, r.exams.map(function (e) { return e.score; })) }) : "")),
      num(t("wr_rep_att"), r.attRate + "%", ""),
      num(t("wr_rep_score"), r.score, t("wr_rep_rank") + " " + r.rank),
      num("💕 " + t("wr_rep_lovers"), r.lovers, t("wr_rep_met", { n: r.met, m: r.rows.length })),
      num("📣 " + t("wr_fans"), r.fans, t("wr_rep_adm", { n: r.admirers })),
      num("⚡ " + t("wr_rep_shura"), r.shura, t("wr_rep_breakups", { n: r.breakups })),
      num("🗣 " + L(C.STAT_BY_ID.rep.name), Math.round(r.rep), "✨ " + L(C.STAT_BY_ID.charm.name) + " " + Math.round(r.charm))
    ]);
    var rows = el("div", { class: "wr-rep-rows" });
    // 追加的 50 人只列出已認識的（主要 15 人一律列出）
    r.rows.filter(function (row) { return row.met || !D.HEROINE_BY_ID[row.id].ext; }).sort(function (a, b) { return (b.dating - a.dating) || (b.aff - a.aff); }).forEach(function (row) {
      var hd = D.HEROINE_BY_ID[row.id];
      rows.appendChild(el("div", { class: "wr-rep-row" + (row.dating ? " lover" : "") + (!row.met ? " none" : ""), style: "--wr-g:" + GROUP_COLOR[hd.group] }, [
        face(hd, 44),
        el("div", { class: "wr-rep-row-main" }, [
          el("div", {}, [el("b", {}, [row.met ? row.name : "？？？"]), " ", el("span", { class: "wr-badge" }, [row.stage]), row.relName && row.rel >= 2 ? el("span", { class: "wr-badge wr-badge-date" }, ["💞 " + row.relName]) : null, row.dates ? el("span", { class: "wr-small wr-muted" }, [" " + t("wr_rep_dates", { n: row.dates })]) : null]),
          row.met ? affBar(row.id) : null,
          row.line ? el("p", { class: "wr-rep-line" }, [row.line]) : el("p", { class: "wr-small wr-muted" }, [t("wr_rep_notmet")])
        ])
      ]));
    });
    panelEl.appendChild(section("📋 " + (r.interim ? t("wr_year_report", { name: r.name, y: r.yearName }) : t("wr_report_title", { name: r.name })), [
      head, nums,
      el("div", { class: "wr-rep-comment" }, [el("h3", {}, ["👩‍🏫 " + t("wr_rep_teacher")]), el("p", {}, [r.teacher])]),
      el("div", { class: "wr-rep-comment" }, [el("h3", {}, ["💘 " + t("wr_rep_love")])].concat(r.love.map(function (l) { return el("p", {}, [l]); }))),
      el("div", { class: "wr-rep-comment wr-rep-sum" }, [el("h3", {}, ["📝 " + t("wr_rep_summary")]), el("p", {}, [r.summary])]),
      chart(),
      el("div", { class: "wr-rep-comment" }, [el("h3", {}, ["🎓 " + t("wr_rep_skills")]), skillBars(r.skills),
        el("p", { class: "wr-small" }, [r.club ? D.CLUB_BY_ID[r.club].icon + " " + L(D.CLUB_BY_ID[r.club].name) + (r.clubWins ? "・" + t("wr_rep_clubwins", { n: r.clubWins }) : "") : t("wr_club_none")])]),
      el("h3", {}, [t("wr_rep_each")]), rows,
      el("div", { class: "wr-row" }, [btn("🖼 " + t("wr_share"), function () { shareReport(r); }, "wr-btn")]),
      el("div", { class: "wr-row" }, [r.interim ?
        btn("🌸 " + t("wr_next_year"), function () { C.nextYear(S); ui.msg = null; if (view) view.teleport("gate"); save(); render(); }, "wr-btn wr-btn-main") :
        btn("🔁 " + t("wr_again"), function () { C.clearSave(); S = null; ui.screen = "title"; render(); }, "wr-btn wr-btn-main")])
    ], "wr-report"));
  }
  function num(label, big, sub) { return el("div", { class: "wr-num" }, [el("small", {}, [label]), el("b", {}, [String(big)]), sub ? el("span", { class: "wr-small wr-muted" }, [sub]) : null]); }
  // 學業與魅力的變化（小折線圖）
  function chart() {
    var hs = S.history;
    if (hs.length < 2) return null;
    var W = 600, H = 140, P = 24;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("class", "wr-chart"); svg.setAttribute("role", "img");
    function line(key, cls) {
      var d = hs.map(function (h, i) { return (i ? "L" : "M") + (P + i / (hs.length - 1) * (W - P * 2)).toFixed(1) + " " + (H - P - h[key] / 100 * (H - P * 2)).toFixed(1); }).join(" ");
      var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); svg.appendChild(p);
    }
    [0, 50, 100].forEach(function (v) {
      var y = H - P - v / 100 * (H - P * 2);
      var g = document.createElementNS(ns, "line"); g.setAttribute("x1", P); g.setAttribute("x2", W - P); g.setAttribute("y1", y); g.setAttribute("y2", y); g.setAttribute("class", "wr-chart-grid"); svg.appendChild(g);
      var tx = document.createElementNS(ns, "text"); tx.setAttribute("x", 2); tx.setAttribute("y", y + 4); tx.setAttribute("class", "wr-chart-t"); tx.textContent = v; svg.appendChild(tx);
    });
    line("study", "wr-chart-study"); line("charm", "wr-chart-charm");
    return el("div", { class: "wr-chart-box" }, [el("h3", {}, [t("wr_rep_chart")]), svg, el("div", { class: "wr-small" }, [el("i", { class: "wr-key wr-key-study" }), L(C.STAT_BY_ID.study.name), " ", el("i", { class: "wr-key wr-key-charm" }), L(C.STAT_BY_ID.charm.name)])]);
  }

  // ---------------- 視窗：人物、背包、購買部 ----------------
  function renderModal() {
    modalEl.innerHTML = "";
    if (!ui.modal || (!S && ["album", "net"].indexOf(ui.modal.type) < 0)) return;
    var m = ui.modal, body;
    function close() { ui.modal = null; renderModal(); }
    if (m.type === "people") body = peopleView();
    else if (m.type === "bag") body = bagView();
    else if (m.type === "shop") body = shopView();
    else if (m.type === "profile") body = profileView(m.hid);
    else if (m.type === "me") body = meView();
    else if (m.type === "album") body = albumView(m.tab || "ach");
    else if (m.type === "club") body = clubView();
    else if (m.type === "net") body = netView();
    else if (m.type === "phone") body = phoneView(m.hid);
    var box = el("div", { class: "wr-modal" }, [el("button", { class: "wr-modal-x", type: "button", onclick: close, "aria-label": t("wr_close") }, ["✕"]), body]);
    var back = el("div", { class: "wr-modal-back", onclick: function (e) { if (e.target === back) close(); } }, [box]);
    modalEl.appendChild(back);
  }
  function skillBars(sk) {
    return el("div", { class: "wr-skills" }, D.SKILLS.map(function (k) {
      var v = Math.round(sk[k.id] || 0);
      return el("div", { class: "wr-skill" }, [el("span", {}, [k.icon + " " + L(k.name)]), el("div", { class: "wr-aff" }, [el("i", { class: "wr-aff-fill wr-skill-fill", style: "width:" + v + "%" }), el("span", {}, [v])])]);
    }));
  }
  // 我的狀態：專長、社團、交往中的人（第 5、6、7 項）
  function meView() {
    var club = S.club && D.CLUB_BY_ID[S.club];
    var lovers = C.loversOf(S);
    return el("div", {}, [el("h2", {}, ["🧑‍🎓 " + S.name]),
      el("p", { class: "wr-small wr-muted" }, [C.termName(S) + (S.ng ? "・🔁 " + t("wr_ng_badge", { n: S.ng }) : "")]),
      el("h3", {}, [t("wr_rep_skills")]), skillBars(S.skills),
      el("p", { class: "wr-small wr-muted" }, [t("wr_skill_note")]),
      el("h3", {}, [t("wr_club")]),
      el("p", {}, [club ? club.icon + " " + L(club.name) + "・" + t("wr_club_info", { d: S.clubDays, w: S.clubWins }) : t("wr_club_none")]),
      el("p", { class: "wr-small wr-muted" }, [t("wr_club_note")]),
      el("h3", {}, ["💞 " + t("wr_lovers")]),
      lovers.length ? el("ul", { class: "wr-bag" }, lovers.map(function (hid) {
        var h = S.h[hid];
        return el("li", {}, [hname(hid) + "：" + L(D.REL_STAGES[h.rel || 1].name) + "（" + t("wr_since", { n: Math.max(0, S.day - h.since) }) + "）"]);
      })) : el("p", { class: "wr-muted" }, [t("wr_no_lovers")]),
      el("p", { class: "wr-small wr-muted" }, [t("wr_rel_note")]),
      // 2026-11-05 擴充：SNS、尋人、傳聞、穿搭、房間
      el("h3", {}, ["📱 " + t("wr_me_more")]),
      el("p", { class: "wr-small" }, [t("wr_me_stats", { f: S.sns.toLocaleString(), p: S.snsPosts, h: S.hunts, g: S.rumorGood, b: S.rumorBad, c: S.polaroids })]),
      el("h3", {}, ["👔 " + t("wr_outfit")]),
      el("div", { class: "wr-shop" }, D.OUTFITS.map(function (o) {
        var have = !!S.outfits[o.id], on = S.outfit === o.id;
        return el("div", { class: "wr-shop-item" + (on ? " on" : "") }, [el("span", { class: "wr-shop-icon" }, [o.icon]), el("span", {}, [el("b", {}, [L(o.name)]), el("small", {}, [o.note + (have ? "" : "・" + money(o.price))])]),
          btn(on ? t("wr_outfit_wearing") : have ? t("wr_outfit_wear") : t("wr_buy"), function () { shopAct(C.buyOutfit(S, o.id)); }, "wr-btn wr-btn-sm", { disabled: on || (!have && S.stats.money < o.price) })]);
      })),
      el("h3", {}, ["🏠 " + t("wr_room", { n: C.comfort(S) })]),
      el("p", { class: "wr-small wr-muted" }, [t("wr_room_note", { n: D.ROOM_VISIT.need })]),
      el("div", { class: "wr-shop" }, D.FURNITURE.map(function (f) {
        var have = !!S.room[f.id];
        return el("div", { class: "wr-shop-item" + (have ? " on" : "") }, [el("span", { class: "wr-shop-icon" }, [f.icon]), el("span", {}, [el("b", {}, [L(f.name)]), el("small", {}, [f.note + (have ? "" : "・" + money(f.price))])]),
          btn(have ? t("wr_room_have") : t("wr_buy"), function () { shopAct(C.buyFurniture(S, f.id)); }, "wr-btn wr-btn-sm", { disabled: have || S.stats.money < f.price })]);
      }))
    ]);
  }
  function shopAct(r) { if (r) { achievementToast(); save(); renderTop(); renderModal(); if (S.phase === "evening") render(); } }
  // 約會前換穿搭（有兩套以上才顯示）
  function outfitRow() {
    var own = D.OUTFITS.filter(function (o) { return S.outfits[o.id]; });
    if (own.length < 2) return el("p", { class: "wr-small wr-muted" }, [t("wr_date_outfit_hint")]);
    return el("div", { class: "wr-row" }, [el("span", { class: "wr-small" }, ["👔 " + t("wr_outfit") + "："])].concat(own.map(function (o) {
      return btn(o.icon + " " + L(o.name), function () { C.buyOutfit(S, o.id); save(); render(); }, "wr-btn wr-btn-sm" + (S.outfit === o.id ? " on" : ""));
    })));
  }
  function clubView() {
    return el("div", {}, [el("h2", {}, ["🎪 " + t("wr_club")]),
      el("p", { class: "wr-small" }, [t("wr_club_note")]),
      el("div", { class: "wr-col" }, D.CLUBS.map(function (c) {
        var mates = c.members.filter(function (m) { return C.available(S, m); }).map(function (m) { return S.h[m].met ? hname(m) : "？？？"; }).join("、");
        return btn(el("span", {}, [el("b", {}, [c.icon + " " + L(c.name) + (S.club === c.id ? "（" + t("wr_club_current") + "）" : "")]),
          el("small", {}, [t("wr_club_skills") + "：" + Object.keys(c.skills).map(function (k) { return L(D.SKILL_BY_ID[k].name); }).join("・") + "／" + t("wr_club_members") + "：" + mates + "／" + L(D.LOC_BY_ID[c.loc].name)])]), function () {
          act(function () { ui.modal = null; return C.joinClub(S, c.id); });
        }, "wr-btn wr-btn-card", { disabled: S.club === c.id });
      }).concat(S.club ? [btn(t("wr_club_leave"), function () { act(function () { ui.modal = null; return C.joinClub(S, null); }); }, "wr-btn wr-btn-ghost")] : []))
    ]);
  }
  // 回憶錄：成就、回憶、結局、稱號（第 8 項；跨存檔）
  function albumView(tab) {
    var meta = C.loadMeta();
    var tabs = el("div", { class: "wr-seg" }, [["ach", "wr_album_ach"], ["photo", "wr_album_photo"], ["pol", "wr_album_pol"], ["mem", "wr_album_mem"], ["end", "wr_album_end"], ["title", "wr_album_title"]].map(function (x) {
      return btn(t(x[1]), function () { ui.modal = { type: "album", tab: x[0] }; renderModal(); }, "wr-seg-btn" + (tab === x[0] ? " on" : ""));
    }));
    var body;
    if (tab === "ach") {
      var got = D.ACHIEVEMENTS.filter(function (a) { return meta.ach[a.id]; }).length;
      body = el("div", {}, [el("p", {}, [t("wr_album_progress", { a: got, b: D.ACHIEVEMENTS.length })]),
        el("div", { class: "wr-ach" }, D.ACHIEVEMENTS.map(function (a) {
          var on = !!meta.ach[a.id];
          return el("div", { class: "wr-ach-item" + (on ? " on" : "") }, [el("span", { class: "wr-ach-icon" }, [on ? a.icon : "🔒"]), el("span", {}, [el("b", {}, [a.name]), el("small", {}, [a.desc])])]);
        }))]);
    } else if (tab === "photo") {
      // 照片圖鑑：175 張，認識過的人才會解鎖；同一張照片每一輪扮演的人不同
      var ph = meta.ph || {}, files = C.PHOTO_POOL;
      var pgot = files.filter(function (f) { return ph[f]; }).length, plov = files.filter(function (f) { return ph[f] && ph[f].l.length; }).length;
      body = el("div", {}, [el("p", {}, [t("wr_photo_progress", { a: pgot, b: files.length, c: plov })]), el("p", { class: "wr-small wr-muted" }, [t("wr_photo_note")]),
        el("div", { class: "wr-photos" }, files.map(function (f) {
          var e = ph[f];
          return el("div", { class: "wr-photo" + (e ? " on" : "") + (e && e.l.length ? " lover" : ""), title: e ? e.n.join("、") + "・" + t("wr_aff") + " " + e.a : "？" }, [
            photoImg(f, 60, function () { return el("span", {}, ["？"]); }, !e),
            el("small", {}, [e ? e.n[e.n.length - 1] : "？？？"]),
            e && e.l.length ? el("i", {}, ["💕" + (e.l.length > 1 ? "×" + e.l.length : "")]) : null
          ]);
        }))]);
    } else if (tab === "pol") {
      var pols = meta.pol || [];
      body = pols.length ? el("div", { class: "wr-pols" }, pols.map(function (p) {
        var sp = D.DATE_BY_ID[p.spot];
        return el("div", { class: "wr-pol" }, [p.file ? photoImg(p.file, 96, function () { return el("span", {}, ["📸"]); }) : el("span", {}, ["📸"]),
          el("b", {}, [p.name]), el("small", {}, [(sp ? sp.icon + " " + L(sp.name) + "・" : "") + p.date])]);
      })) : el("p", { class: "wr-muted" }, [t("wr_pol_empty")]);
    } else if (tab === "mem") {
      var ids = Object.keys(meta.mem).sort(function (a, b) { return meta.mem[b].at - meta.mem[a].at; });
      body = ids.length ? el("div", { class: "wr-mem" }, ids.map(function (id) {
        var m = meta.mem[id], hd = m.hid && D.HEROINE_BY_ID[m.hid];
        return el("div", { class: "wr-mem-card", style: hd ? "--wr-g:" + GROUP_COLOR[hd.group] : "" }, [hd ? face(hd, 40) : el("span", { class: "wr-ach-icon" }, ["📷"]), el("div", {}, [el("b", {}, [m.title]), el("p", { class: "wr-small" }, [m.text])])]);
      })) : el("p", { class: "wr-muted" }, [t("wr_album_empty")]);
    } else if (tab === "end") {
      var names = { lover4: t("wr_end_lover4"), lover: t("wr_end_lover"), high: t("wr_end_high"), mid: t("wr_end_mid") };
      body = el("div", { class: "wr-people" }, D.HEROINES.filter(function (hd) { return !hd.dyn; }).map(function (hd) {
        var e = meta.endings[hd.id], secret = hd.hidden && !meta.ach.hiyori;
        return el("div", { class: "wr-person" + (e === "lover4" || e === "lover" ? " lover" : "") + (secret ? " secret" : "") }, [face(hd, 40, null, secret ? "sil" : true), el("span", {}, [el("b", {}, [secret ? "？？？" : L(hd.name)]), el("small", {}, [e ? names[e] : t("wr_end_none")])])]);
      }));
    } else {
      body = el("div", {}, D.TITLES.map(function (ti) {
        var n = meta.titles[ti.name] || 0;
        return el("div", { class: "wr-ach-item" + (n ? " on" : "") }, [el("span", { class: "wr-ach-icon" }, [n ? "🏅" : "🔒"]), el("span", {}, [el("b", {}, [n ? ti.name : "？？？"]), el("small", {}, [n ? t("wr_title_count", { n: n }) + "・" + ti.comment : t("wr_title_locked")])])]);
      }));
    }
    return el("div", {}, [el("h2", {}, ["📔 " + t("wr_album")]), el("p", { class: "wr-small wr-muted" }, [t("wr_album_note", { n: meta.clears })]), tabs, body]);
  }
  // 分享報告：畫成一張圖（第 13 項）
  function shareReport(r) {
    var c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
    var g = c.getContext("2d");
    var grd = g.createLinearGradient(0, 0, 1080, 1350); grd.addColorStop(0, "#ffe3ef"); grd.addColorStop(1, "#e6dcff");
    g.fillStyle = grd; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = "#3a2a3a"; g.textAlign = "center";
    g.font = "bold 72px 'Noto Sans TC',sans-serif"; g.fillText("💘 萬人迷", 540, 130);
    g.font = "36px 'Noto Sans TC',sans-serif"; g.fillText("私立音夣學園大學・" + r.name + (r.interim ? "・" + r.yearName : ""), 540, 200);
    g.font = "bold 220px sans-serif"; g.fillStyle = "#e76f9a"; g.fillText(r.rank, 540, 460);
    g.font = "bold 64px 'Noto Sans TC',sans-serif"; g.fillStyle = "#8a6ad0"; g.fillText("「" + r.title + "」", 540, 580);
    g.font = "40px 'Noto Sans TC',sans-serif"; g.fillStyle = "#3a2a3a";
    var lines = [t("wr_rep_grade") + " " + r.letter + "　" + t("wr_rep_score") + " " + r.score,
      "💕 " + t("wr_rep_lovers") + " " + r.lovers + "　📣 " + t("wr_fans") + " " + r.fans + "　⚡ " + t("wr_rep_shura") + " " + r.shura];
    lines.forEach(function (ln, i) { g.fillText(ln, 540, 680 + i * 64); });
    var lovers = r.rows.filter(function (x) { return x.dating; }).map(function (x) { return x.name + (x.rel >= 2 ? "（" + x.relName + "）" : ""); });
    g.font = "34px 'Noto Sans TC',sans-serif";
    (lovers.length ? lovers : [t("wr_no_lovers")]).slice(0, 8).forEach(function (ln, i) { g.fillText(ln, 540, 860 + i * 52); });
    g.font = "28px sans-serif"; g.fillStyle = "#8a7a88"; g.fillText(location.host + location.pathname, 540, 1300);
    c.toBlob(function (blob) {
      if (!blob) return;
      var file = null;
      try { file = new File([blob], "wanren_report.png", { type: "image/png" }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: "萬人迷" }).catch(function () { /* 取消 */ }); return; }
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "wanren_report.png";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, "image/png");
  }
  // 同一個校園（第 13 項）：只同步位置與打招呼
  var net = null, netTimer = null;
  function myTitle() { return S ? C.termName(S) : ""; }
  function joinNet(roomId) {
    if (!NET || net) return;
    net = NET.open({ roomId: roomId, name: (S && S.name) || ui.name || t("wr_default_name"), title: myTitle(), onChange: function (others) {
      if (view) view.setOthers(others);
      if (ui.modal && ui.modal.type === "net") renderModal();
    } });
    if (!net) return;
    ui.net = net.id;
    try { history.replaceState(null, "", location.pathname + "?room=" + net.id); } catch (e) { /* ignore */ }
    netTimer = setInterval(function () { if (view && net) net.pose(view.getPose(), ui.loc); }, 400);
    render();
  }
  function leaveNet() {
    if (!net) return;
    net.close(); net = null; ui.net = null;
    clearInterval(netTimer);
    if (view) view.setOthers([]);
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
    render();
  }
  function netView() {
    if (!NET) return el("p", {}, [t("wr_net_unavailable")]);
    var wrap = el("div", {}, [el("h2", {}, ["🌐 " + t("wr_online")]), el("p", { class: "wr-small" }, [t("wr_net_note")])]);
    if (!net) {
      var input = el("input", { class: "wr-input", type: "text", placeholder: t("wr_net_room_ph") });
      wrap.appendChild(el("div", { class: "wr-row" }, [btn("✨ " + t("wr_net_create"), function () { joinNet(null); }, "wr-btn wr-btn-main")]));
      wrap.appendChild(el("div", { class: "wr-row" }, [input, btn(t("wr_net_join"), function () {
        var v = (input.value || "").trim(), m = v.match(/g[0-9a-f]{32}/);
        if (!m) { window.alert(t("wr_net_bad")); return; }
        joinNet(m[0]);
      }, "wr-btn")]));
      return wrap;
    }
    var link = location.origin + location.pathname + "?room=" + net.id;
    var others = net.others();
    wrap.appendChild(el("p", {}, [t("wr_net_in", { n: others.length + 1 })]));
    wrap.appendChild(el("div", { class: "wr-row" }, [el("input", { class: "wr-input wr-net-link", type: "text", readonly: true, value: link }),
      btn("📋 " + t("wr_net_copy"), function () { try { navigator.clipboard.writeText(link); } catch (e) { /* ignore */ } }, "wr-btn")]));
    wrap.appendChild(el("ul", { class: "wr-bag" }, others.map(function (o) { return el("li", {}, ["🎓 " + o.name + (o.loc && D.LOC_BY_ID[o.loc] ? "・" + L(D.LOC_BY_ID[o.loc].name) : "")]); })));
    wrap.appendChild(el("div", { class: "wr-row" }, ["👋", "💕", "😂", "📚", "🎉"].map(function (e) {
      return btn(e, function () { net.emote(e); }, "wr-btn wr-btn-sm");
    }).concat([btn(t("wr_net_leave"), leaveNet, "wr-btn wr-btn-ghost")])));
    return wrap;
  }
  function peopleView() {
    var onlyMet = !!ui.peopleMet;
    var all = D.HEROINES.filter(function (hd) { return C.available(S, hd.id); });
    var metN = all.filter(function (hd) { return S.h[hd.id].met; }).length;
    var wrap = el("div", {}, [el("h2", {}, ["👭 " + t("wr_people")]),
      el("div", { class: "wr-row" }, [
        el("span", { class: "wr-small" }, [t("wr_people_count", { a: metN, b: all.length })]),
        btn(onlyMet ? t("wr_people_all") : t("wr_people_met"), function () { ui.peopleMet = !onlyMet; renderModal(); }, "wr-btn wr-btn-sm" + (onlyMet ? " on" : ""))
      ])]);
    D.GROUPS.forEach(function (g) {
      var list = all.filter(function (hd) { return hd.group === g.id && (!onlyMet || S.h[hd.id].met); });
      if (!list.length) return;
      var gm = list.filter(function (hd) { return S.h[hd.id].met; }).length;
      wrap.appendChild(el("h3", { style: "color:" + GROUP_COLOR[g.id] }, [L(g.name) + "（" + gm + "／" + all.filter(function (hd) { return hd.group === g.id; }).length + "）"]));
      var row = el("div", { class: "wr-people" });
      list.forEach(function (hd) {
        var h = S.h[hd.id], where = S.today ? C.whereIs(S, hd.id) : null;
        row.appendChild(el("button", { type: "button", class: "wr-person" + (h.dating ? " lover" : ""), onclick: function () { ui.modal = { type: "profile", hid: hd.id }; renderModal(); } }, [
          face(hd, 44),
          el("span", {}, [el("b", {}, [h.met ? L(hd.name) : "？？？"]), el("small", {}, [C.stageName(S, hd.id) + (h.met ? "・" + h.aff : "")]),
            el("small", { class: "wr-muted" }, [h.met ? (where ? "📍 " + L(D.LOC_BY_ID[where].name) : t("wr_absent")) : ""])])
        ]));
      });
      wrap.appendChild(row);
    });
    // 傳聞網路（2026-11-05）
    wrap.appendChild(el("h3", {}, ["📣 " + t("wr_rumor_log")]));
    wrap.appendChild(S.rumorLog.length ? el("ul", { class: "wr-bag wr-rumors" }, S.rumorLog.map(function (r) {
      return el("li", { class: r.good ? "wr-good" : "wr-bad" }, [(r.good ? "😊 " : "😠 ") + C.dateLabel(S, r.day) + "：" + r.text]);
    })) : el("p", { class: "wr-small wr-muted" }, [t("wr_rumor_none")]));
    return wrap;
  }
  function profileView(hid) {
    var hd = D.HEROINE_BY_ID[hid], h = S.h[hid];
    var known = function (map, src, nameOf) {
      var ks = Object.keys(map);
      if (!ks.length) return el("span", { class: "wr-muted wr-small" }, [t("wr_unknown")]);
      return el("span", {}, ks.map(function (k) { return el("span", { class: "wr-tag wr-pref-" + map[k] }, [(map[k] === "like" ? "♥ " : map[k] === "bad" ? "✕ " : "") + nameOf(k)]); }));
    };
    var where = S.today ? C.whereIs(S, hid) : null;
    return el("div", { class: "wr-profile", style: "--wr-g:" + GROUP_COLOR[hd.group] }, [
      el("div", { class: "wr-hcard-head" }, [face(hd, 72), el("div", {}, [
        el("h2", {}, [h.met ? L(hd.name) : "？？？"]),
        el("div", { class: "wr-small" }, [L(hd.title) + "・" + hd.age + t("wr_age")]),
        el("span", { class: "wr-badge" }, [C.stageName(S, hid)]), h.met ? affBar(hid) : null
      ])]),
      h.met ? el("p", {}, [hd.intro]) : el("p", { class: "wr-muted" }, [t("wr_not_met_yet")]),
      h.met ? el("div", { class: "wr-small" }, ["📍 " + t("wr_today") + "：" + (where ? L(D.LOC_BY_ID[where].name) : t("wr_absent"))]) : null,
      h.met ? el("div", { class: "wr-prof-row" }, [el("b", {}, ["📣 " + t("wr_circle")]), (function () {
        var cs = C.circleOf(hid).filter(function (x) { return C.available(S, x); });
        return cs.length ? el("span", {}, cs.map(function (x) { return el("span", { class: "wr-tag" }, [S.h[x].met ? hname(x) : "？？？"]); })) : el("span", { class: "wr-muted wr-small" }, [t("wr_circle_none")]);
      })()]) : null,
      h.met ? el("div", { class: "wr-prof-row" }, [el("b", {}, [t("wr_known_topics")]), known(h.known.topics, D.TOPIC_BY_ID, function (k) { return L(D.TOPIC_BY_ID[k].name); })]) : null,
      h.met ? el("div", { class: "wr-prof-row" }, [el("b", {}, [t("wr_known_gifts")]), known(h.known.gifts, D.ITEM_BY_ID, function (k) { return D.ITEM_BY_ID[k].icon + L(D.ITEM_BY_ID[k].name); })]) : null,
      h.met ? el("div", {}, [el("h3", {}, ["📜 " + t("wr_quest")]), el("ol", { class: "wr-qlist" }, hd.quests.map(function (q, i) {
        var st = i < h.quest ? "done" : i === h.quest ? (h.aff >= q.at ? "now" : "lock") : "lock";
        return el("li", { class: "wr-q-" + st }, [
          st === "lock" ? t("wr_quest_lock", { n: q.at }) + (C.questLock(S, i) ? "・" + t("wr_quest_term", { t: C.questLock(S, i) }) : "") :
          st === "now" && C.questLock(S, i) ? el("span", {}, [el("b", {}, [q.title]), el("br"), el("small", {}, [t("wr_quest_term", { t: C.questLock(S, i) })])]) : el("span", {}, [el("b", {}, [q.title]), st === "done" ? " ✅" : "", el("br"), el("small", {}, [st === "now" ? q.desc + "（" + C.reqText(q.req) + "）" : q.done])])
        ]);
      })), h.quest >= hd.quests.length && !h.dating ? el("p", { class: "wr-small" }, [t("wr_confess_hint") + (C.confessReq(S, hid).length ? "（" + C.confessReq(S, hid).join("、") + "）" : "")]) : null]) : null
    ]);
  }
  // ---------------- 手機（2026-11-05） ----------------
  function phoneBtn(cls) {
    var n = S ? C.chatUnread(S) : 0;
    return btn(el("span", {}, ["📱 " + t("wr_phone"), n ? el("i", { class: "wr-phone-badge" }, [n]) : null]), function () { ui.modal = { type: "phone" }; renderModal(); }, cls);
  }
  function phoneView(hid) {
    var hd = hid && D.HEROINE_BY_ID[hid];
    if (hd && S.h[hid]) {
      C.chatRead(S, hid);
      var c = S.chat[hid] || { log: [], pend: null }, close = C.isClose(S, hid);
      var log = el("div", { class: "wr-chat-log" }, c.log.map(function (m) {
        if (m.f === "s") return el("div", { class: "wr-chat-sys" }, [m.t]);
        var mine = m.f === "m";
        return el("div", { class: "wr-chat-row" + (mine ? " me" : "") }, [mine ? null : face(hd, 30),
          el("div", { class: "wr-bubble" }, [m.p ? photoImg(C.photoOf(S.seed, hid), 132, function () { return el("span", {}, ["📷"]); }) : null, m.p ? el("br") : null, m.t])]);
      }));
      setTimeout(function () { log.scrollTop = log.scrollHeight; }, 0);
      var p = c.pend, mood = C.moodOf(S, hid);
      var done = function (tone) { return function () { C.chatReply(S, hid, tone); achievementToast(); save(); renderTop(); renderModal(); if (S.phase === "night" || S.phase === "morning") render(); }; };
      var reply = p ? el("div", { class: "wr-chat-reply" }, D.CHAT_TONES.map(function (tn) {
        return btn(el("span", {}, [el("small", {}, [tn.icon + " " + L(tn.name)]), " ", p.opts[tn.id]]), done(tn.id), "wr-btn wr-btn-opt");
      }).concat([btn("🙈 " + t("wr_phone_ignore"), done("ignore"), "wr-btn wr-btn-ghost wr-btn-sm")])) : el("p", { class: "wr-small wr-muted" }, [t("wr_phone_wait")]);
      return el("div", { class: "wr-phone" }, [
        el("div", { class: "wr-chat-head" }, [btn("‹ " + t("wr_phone_back"), function () { ui.modal = { type: "phone" }; renderModal(); }, "wr-btn wr-btn-ghost wr-btn-sm"),
          face(hd, 36), el("div", {}, [el("b", {}, [L(hd.name)]), el("div", { class: "wr-small wr-muted" }, [C.stageName(S, hid) + (close ? "・🫶 " + t("wr_phone_close") : "")])])]),
        log,
        p ? el("div", { class: "wr-small wr-muted wr-chat-mood" }, [mood.icon + " " + mood.hint + (p.ev ? "・" + t("wr_phone_round", { a: p.round, b: p.max }) : "")]) : null,
        reply
      ]);
    }
    var ids = Object.keys(S.chat || {}).filter(function (k) { return D.HEROINE_BY_ID[k] && S.h[k] && S.chat[k].log.length; })
      .sort(function (a, b) { return (S.chat[b].pend ? 1 : 0) - (S.chat[a].pend ? 1 : 0) || S.chat[b].last - S.chat[a].last; });
    return el("div", { class: "wr-phone" }, [el("h2", {}, ["📱 " + t("wr_phone")]),
      el("p", { class: "wr-small wr-muted" }, [t("wr_phone_note")]),
      ids.length ? el("div", { class: "wr-col" }, ids.map(function (k) {
        var c = S.chat[k], last = c.log.filter(function (m) { return m.f !== "s"; }).slice(-1)[0];
        return el("button", { type: "button", class: "wr-chat-item" + (c.pend ? " pend" : ""), onclick: function () { ui.modal = { type: "phone", hid: k }; renderModal(); } }, [
          face(D.HEROINE_BY_ID[k], 40),
          el("span", {}, [el("b", {}, [hname(k)]), el("small", {}, [last ? (last.f === "m" ? t("wr_phone_you") + "：" : "") + last.t : ""])]),
          c.pend ? el("i", { class: "wr-phone-badge" }, ["!"]) : null
        ]);
      })) : el("p", { class: "wr-muted" }, [t("wr_phone_none")])
    ]);
  }
  function bagView() {
    var items = Object.keys(S.inv);
    return el("div", {}, [el("h2", {}, ["🎒 " + t("wr_bag")]),
      el("p", {}, [t("wr_money") + "：" + money(S.stats.money)]),
      items.length ? el("ul", { class: "wr-bag" }, items.map(function (iid) { var it = D.ITEM_BY_ID[iid]; return el("li", {}, [it.icon + " " + L(it.name) + " ×" + S.inv[iid]]); })) : el("p", { class: "wr-muted" }, [t("wr_no_items")]),
      el("p", { class: "wr-small wr-muted" }, [t("wr_bag_note")])
    ]);
  }
  function shopView() {
    return el("div", {}, [el("h2", {}, ["🛒 " + t("wr_shop")]),
      el("p", {}, [t("wr_money") + "：", el("b", {}, [money(S.stats.money)])]),
      el("div", { class: "wr-shop" }, D.ITEMS.map(function (it) {
        return el("div", { class: "wr-shop-item" }, [el("span", { class: "wr-shop-icon" }, [it.icon]), el("span", {}, [el("b", {}, [L(it.name)]), el("small", {}, [money(it.price) + (S.inv[it.id] ? "・" + t("wr_have", { n: S.inv[it.id] }) : "")])]),
          btn(t("wr_buy"), function () { var r = C.buy(S, it.id); if (r) { save(); renderTop(); renderModal(); } }, "wr-btn wr-btn-sm", { disabled: S.stats.money < it.price })]);
      }))
    ]);
  }
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (ui.modal) { ui.modal = null; renderModal(); } else if (ui.msg) closeMsg(); }
    if ((e.key === "Enter" || e.key === " ") && ui.msg && !/input|textarea|button|select/i.test(e.target.tagName)) { e.preventDefault(); closeMsg(); }
  });
  window.addEventListener("i18n:change", function () { sync3d.sig = null; render(); });

  // 測試用
  window.PriTestWanren = {
    get state() { return S; }, ui: ui, core: C,
    view: function () { return view; }, render: render
  };

  render();
  init3d();
  var roomParam = (location.search.match(/[?&]room=(g[0-9a-f]{32})/) || [])[1];
  if (roomParam && NET) setTimeout(function () { joinNet(roomParam); }, 0);
})();
