// 明星經紀 starV：動圖圖鑑「御三家」畫面（規格 docs/superpowers/specs/2026-11-15-starv-motion-codex.md）。
// ・開局（新存檔、新紀元、舊存檔第一次載入）彈出御三家選擇視窗
// ・殿堂分頁的「動圖」子分頁：3 位 × 3 個動作，已解鎖的可以播放 webm（src 空白時顯示佔位畫面）
// ・解鎖時跳出提示
// ・本命彈出：一般遊戲中每 1 分鐘在遊戲畫面右下角播放本命最高等級的動作兩輪（不擋操作）
// ・解鎖等級另外鏡射到 localStorage["pritest-starv-motion"]：按「重新開始」清掉存檔後，新存檔仍保留已解鎖的動作
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var UI = window.PriTestStarvUI;
  var Motion = window.PriTestStarvMotion;
  if (!D || !D.MOTION || !UI || !Motion) return;
  var M = D.MOTION;
  var t = UI.t, el = UI.el;
  var MIRROR_KEY = "pritest-starv-motion";
  var BASE = (function () {
    var app = document.getElementById("sv-app");
    return (app && app.getAttribute("data-motion-base")) || "../static/";
  })();

  // ---- 鏡射 ----
  function readMirror() { try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || "null"); } catch (e) { return null; } }
  function writeMirror(lv) { try { localStorage.setItem(MIRROR_KEY, JSON.stringify(lv)); } catch (e) { /* 私密模式：只是記不住 */ } }
  var mergedFor = null;
  function syncMirror(App) {
    var st = App.st();
    if (!st || App.readOnly()) return;
    var m = Motion.ensure(st);
    if (!m) return;
    if (mergedFor !== st) {   // 每個 state（新存檔、雲端接回、匯入）只併一次
      mergedFor = st;
      if (Motion.merge(st, readMirror())) App.saveNow();
    }
    var cur = readMirror() || {}, out = {}, diff = false;
    M.STARTERS.forEach(function (s) { out[s.id] = Math.max(m.lv[s.id], Number(cur[s.id]) || 0); if (out[s.id] !== Number(cur[s.id])) diff = true; });
    if (diff) writeMirror(out);
  }

  function moveSrc(s, i) { var mv = s.moves[i]; return mv && mv.src ? BASE + mv.src : ""; }
  function moveAnim(s, i) { var mv = s.moves[i]; return mv && mv.anim ? BASE + mv.anim : ""; }
  function hasMotion(s, i) { return !!(moveSrc(s, i) || moveAnim(s, i)); }
  // Safari／iOS（WebKit）的 VP9 webm 不支援透明通道（黑底或無法播放），不支援 VP9 的瀏覽器也一樣
  // → 這些環境直接用動態 WebP；其他瀏覽器用 webm，載入失敗時再退回動態 WebP
  var PREFER_ANIM = (function () {
    var ua = navigator.userAgent || "";
    var iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var safari = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
    var vp9 = false;
    try { var tv = document.createElement("video"); vp9 = !!(tv.canPlayType && tv.canPlayType('video/webm; codecs="vp9"')); } catch (e) { /* 忽略 */ }
    return iOS || safari || !vp9;
  })();
  function asset(p) { return p ? BASE + p : ""; }

  // 影片元素離開畫面前先停止下載：同一個 webm 同時被兩個 <video> 讀取時，
  // 不支援 Range 的伺服器（本機 http.server）會讓後面那個一直卡在載入中
  function unloadVideo(v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) { /* 忽略 */ } }
  function unloadVideos(root) { Array.prototype.forEach.call(root.querySelectorAll("video"), unloadVideo); }

  // 靜止圖：still → 圖片；沒有 still 但允許用第一格且有動作 1 的 webm → 影片第一格（不播放）；都沒有 → 圖示
  function still(s, path, useFirstFrame) {
    if (path) {
      var img = el("img", { class: "sv-motion-still", src: asset(path), alt: "", loading: "lazy" });
      img.addEventListener("error", function () { img.replaceWith(el("span", { class: "sv-motion-ph-icon", text: s.icon })); });
      return img;
    }
    var src = useFirstFrame ? moveSrc(s, 0) : "";
    if (src) {
      var v = el("video", { class: "sv-motion-still", src: src + "#t=0.1", muted: "", playsinline: "", preload: "metadata" });
      v.muted = true;
      v.addEventListener("error", function () { v.replaceWith(el("span", { class: "sv-motion-ph-icon", text: s.icon })); });
      return v;
    }
    return el("span", { class: "sv-motion-ph-icon", text: s.icon });
  }

  // 動作畫面：大畫面（播放視窗）有 src 就自動循環播放，沒有 src 或載入失敗就顯示「動畫準備中」；
  // 縮圖只放靜止圖（動作的 still → 角色的 still → 圖示），有影片時加 ▶，不建立會播放的 <video>
  function clip(s, i, big) {
    var box = el("div", { class: "sv-motion-clip" + (big ? " sv-motion-clip-big" : ""), style: "--sv-motion-color:" + s.color });
    var src = moveSrc(s, i);
    var stillPath = (s.moves[i] && s.moves[i].still) || s.still;
    function placeholder() {
      box.innerHTML = "";
      box.appendChild(still(s, stillPath, false));
      if (big) box.appendChild(el("span", { class: "sv-small sv-motion-pending", text: t("sv_motion_pending") }));
    }
    if (!big) {
      box.appendChild(still(s, stillPath, false));
      if (hasMotion(s, i)) box.appendChild(el("span", { class: "sv-motion-play", text: "▶" }));
      else box.title = t("sv_motion_pending");
      return box;
    }
    var anim = moveAnim(s, i);
    function animImg() {   // 動態 WebP 本身就無限循環
      box.innerHTML = "";
      var im = el("img", { class: "sv-motion-video", src: anim, alt: "" });
      im.addEventListener("error", placeholder);
      box.appendChild(im);
    }
    if (!src && !anim) { placeholder(); return box; }
    if (!src || (anim && PREFER_ANIM)) { animImg(); return box; }
    var v = el("video", { class: "sv-motion-video", src: src, muted: "", loop: "", playsinline: "", autoplay: "", preload: "auto" });
    v.muted = true;
    v.addEventListener("error", function () { unloadVideo(v); if (anim) animImg(); else placeholder(); });
    box.appendChild(v);
    return box;
  }

  // ---- 畫面上顯示的動作（「設為預設」）----
  // st.codex.motion.show ＝ "s1-2"（御三家 ID-動作編號）：3D 演出、公司內部右下角與本命彈出都播這個動作。
  // 沒設定或已失效（還沒解鎖）時：本局選的御三家目前最高的動作。
  function preferred(st) {
    var m = st && Motion.ensure(st);
    if (!m) return null;
    var p = /^(\w+)-(\d)$/.exec(m.show || ""), s = p && M.BY_ID[p[1]], n = p ? +p[2] : 0;
    if (s && n >= 1 && n <= m.lv[s.id]) return { s: s, n: n };
    s = m.pick && M.BY_ID[m.pick];
    return s && m.lv[s.id] ? { s: s, n: m.lv[s.id] } : null;
  }
  function isPreferred(st, s, i) { var p = preferred(st); return !!p && p.s === s && p.n === i + 1; }

  // 圖鑑的預覽視窗：播放所選動作，按「設為預設」才會換成畫面上顯示的動作
  // opts.st()：讀狀態；opts.setDefault(id)：寫入（動圖測試面板傳入只改假狀態的版本）；opts.onClose
  function play(s, i, opts) {
    opts = opts || {};
    UI.openModal(function (box, close) {
      box.appendChild(UI.modalHead(UI.L(s.name) + "・" + UI.L(s.moves[i].name), close));
      box.appendChild(clip(s, i, true));
      box.appendChild(el("p", { class: "sv-small sv-muted", text: UI.L(s.desc) }));
      if (!opts.setDefault) return;
      var row = el("div", { class: "sv-row sv-row-end" });
      function drawBtn() {
        row.innerHTML = "";
        var on = isPreferred(opts.st(), s, i);
        row.appendChild(on
          ? el("span", { class: "sv-chip sv-chip-title", "data-act": "motion-default-on", text: t("sv_motion_default_on") })
          : UI.btn(t("sv_motion_default_set"), function () { opts.setDefault(s.id + "-" + (i + 1)); drawBtn(); }, "sv-btn-primary", { "data-act": "motion-default-set" }));
      }
      drawBtn();
      box.appendChild(row);
    }, { cls: "sv-motion-modal", onClose: opts.onClose });
  }
  function hallPlayOpts(App) {
    return {
      st: function () { return App.st(); },
      setDefault: App.readOnly && App.readOnly() ? null : function (id) { App.act(function (x) { var m = Motion.ensure(x); if (m) m.show = id; return null; }); }
    };
  }

  function lockText(st, s, i) {
    var m = Motion.ensure(st), n = i + 1;
    if (m.pick === s.id || !m.pick) return t(n === 1 ? "sv_motion_need_pick" : n === 2 ? "sv_motion_need_award" : "sv_motion_need_mid", { lv: M.midLevel });
    if (n === 1) return t("sv_motion_need_award");
    if (n === 2) return t("sv_motion_need_mid", { lv: M.midLevel });
    return t("sv_motion_need_next");
  }

  // 殿堂子分頁呼叫 galleryView(st, App)；動圖測試面板另外傳 ctx.onPlay（面板本身是視窗，要先關掉再開預覽視窗）
  function galleryView(st, App, ctx) {
    var onPlay = ctx && ctx.onPlay;
    var m = Motion.ensure(st), stg = Motion.stage(st);
    var next = stg === 1 ? t("sv_motion_next_award") : stg === 2 ? t("sv_motion_next_mid", { lv: M.midLevel }) : stg === 3 ? t("sv_motion_next_done") : t("sv_motion_next_pick");
    return el("div", {}, [
      el("p", { class: "sv-small", text: t("sv_motion_summary", { n: Motion.total(st), total: M.STARTERS.length * Motion.MAX }) }),
      el("p", { class: "sv-small sv-muted", text: (m.pick ? t("sv_motion_pick_now", { name: UI.L(M.BY_ID[m.pick].name) }) + "・" : "") + next }),
      el("div", { class: "sv-motion-grid" }, M.STARTERS.map(function (s) {
        var lv = m.lv[s.id];
        return el("div", { class: "sv-card sv-motion-card" + (m.pick === s.id ? " sv-motion-picked" : ""), style: "--sv-motion-color:" + s.color }, [
          el("div", { class: "sv-motion-head" }, [
            el("span", { class: "sv-motion-icon", text: s.icon }),
            el("b", { class: "sv-grow", text: UI.L(s.name) }),
            m.pick === s.id ? el("span", { class: "sv-chip sv-chip-title", text: t("sv_motion_partner") }) : null,
            el("span", { class: "sv-chip", text: lv + " / " + Motion.MAX })
          ]),
          el("div", { class: "sv-motion-moves" }, s.moves.map(function (mv, i) {
            var def = i < lv && isPreferred(st, s, i);
            if (i < lv) return el("button", { type: "button", class: "sv-motion-move" + (def ? " sv-motion-default" : ""), "data-act": "motion-" + s.id + "-" + (i + 1),
              onclick: function () { if (onPlay) onPlay(s, i); else play(s, i, App ? hallPlayOpts(App) : null); } },
              [clip(s, i, false), el("span", { class: "sv-small", text: (def ? "★ " : "▶ ") + UI.L(mv.name) })]);
            return el("div", { class: "sv-motion-move sv-motion-locked" }, [
              el("div", { class: "sv-motion-clip" }, [el("span", { class: "sv-motion-ph-icon", text: "🔒" })]),
              el("span", { class: "sv-small sv-muted", text: lockText(st, s, i) })
            ]);
          }))
        ]);
      }))
    ]);
  }

  // ---- 開局選擇 ----
  // 第 1 步：三張卡片（靜止圖）；第 2 步：點進去先看動作 1，再按「確定選擇」或「返回」
  var picking = false;
  // preview：動圖測試面板用，App 是假的、不鎖視窗、「確定」只關閉
  function openPicker(App, preview) {
    if (!preview) picking = true;
    var detail = null;
    UI.openModal(function (box, close) {
      function draw() {
        unloadVideos(box);
        box.innerHTML = "";
        var st = App.st();
        if (detail) drawDetail(st, M.BY_ID[detail]); else drawList(st);
      }
      function lvChip(st, s) {
        var lv = Motion.level(st, s.id);
        return lv ? el("span", { class: "sv-chip", text: lv >= Motion.MAX ? t("sv_motion_done") : t("sv_motion_have", { n: lv, max: Motion.MAX }) }) : null;
      }
      function drawList(st) {
        box.appendChild(el("h2", { class: "sv-modal-title", text: t("sv_motion_pick_title") }));
        box.appendChild(el("p", { class: "sv-small", text: t(st.era > 1 || Motion.total(st) ? "sv_motion_pick_again" : "sv_motion_pick_intro") }));
        box.appendChild(el("div", { class: "sv-motion-grid" }, M.STARTERS.map(function (s) {
          return el("button", { type: "button", class: "sv-card sv-motion-card sv-motion-choice", style: "--sv-motion-color:" + s.color, "data-act": "motion-pick-" + s.id,
            onclick: function () { detail = s.id; draw(); } }, [
            el("div", { class: "sv-motion-clip sv-motion-portrait", style: "--sv-motion-color:" + s.color }, [still(s, s.still, true)]),
            el("b", { text: s.icon + " " + UI.L(s.name) }),
            el("span", { class: "sv-small sv-muted", text: UI.L(s.desc) }),
            lvChip(st, s),
            el("span", { class: "sv-small sv-motion-peek", text: t("sv_motion_pick_peek") })
          ]);
        })));
        box.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_motion_pick_rule", { lv: M.midLevel }) }));
      }
      function drawDetail(st, s) {
        box.appendChild(el("h2", { class: "sv-modal-title", text: s.icon + " " + UI.L(s.name) + "・" + UI.L(s.moves[0].name) }));
        box.appendChild(clip(s, 0, true));
        box.appendChild(el("p", { class: "sv-small", text: UI.L(s.desc) }));
        var chip = lvChip(st, s);
        if (chip) box.appendChild(el("p", {}, [chip]));
        box.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_motion_pick_confirm_q", { name: UI.L(s.name) }) }));
        box.appendChild(el("div", { class: "sv-row sv-row-end" }, [
          UI.btn(t("sv_motion_pick_back"), function () { detail = null; draw(); }, "sv-btn-ghost", { "data-act": "motion-pick-back" }),
          UI.btn(t("sv_motion_pick_ok_name", { name: UI.L(s.name) }), function () {
            var err = preview ? null : App.act(function (x) { return Motion.choose(x, s.id); });
            if (err && err !== "motionPicked") { UI.toast(t("sv_err_" + err), "bad"); return; }
            unloadVideos(box);
            close();
          }, "sv-btn-primary sv-btn-big", { "data-act": "motion-pick-ok" })
        ]));
      }
      draw();
    }, preview ? { cls: "sv-motion-modal" } : { cls: "sv-motion-modal", locked: true, onClose: function () { picking = false; } });
  }

  // ---- 本命彈出 ----
  // 一般遊戲中每隔 M.popupEveryMs（現實時間），在「遊戲畫面目前看得到的範圍」右下角播放本命目前最高等級的動作，
  // 播 M.popupLoops 輪後關閉。面積最多佔可見範圍的 M.popupArea，pointer-events: none 不擋操作。
  // 掛在 body（#sv-app 每次重畫都會清空）；有視窗開著、3D 演出的右下角短片正在顯示時順延；分頁在背景時不播。
  var appRef = null;
  var popup = { node: null, last: Date.now(), plays: 0 };
  function visibleRect() {
    var app = document.getElementById("sv-app");
    if (!app) return null;
    var r = app.getBoundingClientRect();
    var L = Math.max(r.left, 0), R = Math.min(r.right, window.innerWidth), T = Math.max(r.top, 0), B = Math.min(r.bottom, window.innerHeight);
    return R - L >= 120 && B - T >= 120 ? { r: R, b: B, w: R - L, h: B - T } : null;
  }
  function fitPopup() {
    var v = popup.node, box = visibleRect();
    if (!v) return;
    if (!box) { v.style.visibility = "hidden"; return; }
    var nw = v.videoWidth || v.naturalWidth, nh = v.videoHeight || v.naturalHeight;
    var ar = nw && nh ? nw / nh : 2 / 3;
    var h = Math.sqrt(M.popupArea * box.w * box.h / ar), w = h * ar;   // 面積 ＝ popupArea × 可見範圍
    if (h > box.h * 0.75) { h = box.h * 0.75; w = h * ar; }
    if (w > box.w * 0.6) { w = box.w * 0.6; h = w / ar; }
    v.style.width = w + "px"; v.style.height = h + "px";
    v.style.left = (box.r - w - 8) + "px"; v.style.top = (box.b - h - 8) + "px";
    v.style.visibility = nw ? "" : "hidden";
  }
  function closePopup() {
    var v = popup.node;
    popup.node = null;
    popup.last = Date.now();
    window.removeEventListener("scroll", fitPopup, true);
    window.removeEventListener("resize", fitPopup);
    clearTimeout(popup.timer);
    if (!v) return;
    v.classList.add("sv-motion-popup-out");
    setTimeout(function () { if (v.tagName === "VIDEO") unloadVideo(v); if (v.parentNode) v.parentNode.removeChild(v); }, 400);
  }
  function closePopupNow() {
    var v = popup.node;
    closePopup();
    if (v) { if (v.tagName === "VIDEO") unloadVideo(v); if (v.parentNode) v.parentNode.removeChild(v); }
  }
  function showPartner() {
    var st = appRef && appRef.st();
    if (!st || popup.node) return false;
    var p = preferred(st);
    return p ? playPopup(p.s, p.n) : false;
  }
  // 在右下角播放 s 的動作 lv（1〜3）；本命彈出與動圖測試面板共用
  function playPopup(s, lv) {
    if (popup.node) closePopupNow();
    var src = lv ? moveSrc(s, lv - 1) : "", anim = lv ? moveAnim(s, lv - 1) : "";
    popup.last = Date.now();
    if (!src && !anim) return false;   // 還沒有素材：略過這一輪
    if (!src || (anim && PREFER_ANIM)) return showPartnerImg(s, lv, anim);
    var v = el("video", { class: "sv-motion-popup", src: src, muted: "", playsinline: "", preload: "auto", "data-act": "motion-popup", "data-move": s.id + "-" + lv, "aria-hidden": "true" });
    v.muted = true;
    popup.node = v;
    popup.plays = 0;
    v.addEventListener("loadedmetadata", fitPopup);
    v.addEventListener("ended", function () {
      if (popup.node !== v) return;
      popup.plays++;
      if (popup.plays < M.popupLoops) {
        try { v.currentTime = 0; } catch (e) { /* 忽略 */ }
        var p = v.play();
        if (p && p.catch) p.catch(closePopup);
      } else closePopup();
    });
    v.addEventListener("error", function () {
      if (popup.node !== v) return;
      if (!anim) { closePopup(); return; }
      unloadVideo(v); if (v.parentNode) v.parentNode.removeChild(v);   // webm 失敗 → 改用動態 WebP
      popup.node = null;
      window.removeEventListener("scroll", fitPopup, true);
      window.removeEventListener("resize", fitPopup);
      showPartnerImg(s, lv, anim);
    });
    document.body.appendChild(v);
    window.addEventListener("scroll", fitPopup, true);
    window.addEventListener("resize", fitPopup);
    fitPopup();
    var pr = v.play();
    if (pr && pr.catch) pr.catch(function () { if (popup.node === v) closePopup(); });
    return true;
  }
  // 動態 WebP 版：無法偵測播完，改用 動作長度（ms）× popupLoops 計時後關閉
  function showPartnerImg(s, lv, anim) {
    var im = el("img", { class: "sv-motion-popup", src: anim, alt: "", "data-act": "motion-popup", "data-move": s.id + "-" + lv, "aria-hidden": "true" });
    var ms = (s.moves[lv - 1].ms || 4000) * M.popupLoops;
    popup.node = im;
    popup.plays = 0;
    im.addEventListener("load", function () {
      if (popup.node !== im) return;
      fitPopup();
      clearTimeout(popup.timer);
      popup.timer = setTimeout(function () { if (popup.node === im) closePopup(); }, ms);
    });
    im.addEventListener("error", function () { if (popup.node === im) closePopup(); });
    document.body.appendChild(im);
    window.addEventListener("scroll", fitPopup, true);
    window.addEventListener("resize", fitPopup);
    fitPopup();
    return true;
  }
  function stageClipShowing() { return !!document.querySelector(".sv-stage-clip:not([hidden])"); }
  setInterval(function () {
    if (popup.node) return;
    var st = appRef && appRef.st();
    if (!st || appRef.readOnly() || document.visibilityState === "hidden") return;
    if (Date.now() - popup.last < M.popupEveryMs) return;
    if (UI.modalIsOpen() || stageClipShowing()) return;   // 順延到下一次檢查（每秒）
    showPartner();
  }, 1000);
  // 切到背景：收起並重新計時，回來後再等滿 1 分鐘
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { if (popup.node) closePopup(); else popup.last = Date.now(); } });

  // 每次重畫都會經過：同步鏡射；需要選擇時排入選擇視窗（唯讀中不問）
  UI.addExtra(function (App) {
    var st = App.st();
    appRef = App;
    if (!st) return null;
    syncMirror(App);
    if (!picking && !App.readOnly() && Motion.needsPick(st)) setTimeout(function () { if (!picking && Motion.needsPick(App.st())) openPicker(App); }, 0);
    return null;
  });

  // ---- 動圖測試面板（?motiontest=1，或 ?debug=1 公司分頁的按鈕）----
  // 用假的狀態顯示真正的選擇畫面、圖鑑與右下角彈出；不寫入任何存檔，也不碰鏡射
  function fakeState(pick, n) {
    var lv = {};
    M.STARTERS.forEach(function (s) { lv[s.id] = n; });
    return { era: 1, company: { level: M.midLevel }, awards: { history: [{}] }, codex: { motion: { lv: lv, pick: pick || null, pickEra: 1, picks: [] } } };
  }
  var testState = fakeState("s1", Motion.MAX);
  function openTest() {
    UI.openModal(function (box, close) {
      box.appendChild(UI.modalHead(t("sv_motion_test"), close));
      box.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_motion_test_note") }));
      box.appendChild(el("h3", { text: t("sv_motion_test_pick") }));
      box.appendChild(el("div", { class: "sv-row" }, [
        UI.btn(t("sv_motion_test_pick_new"), function () { close(); var f = fakeState(null, 0); openPicker({ st: function () { return f; } }, true); }, "", { "data-act": "motion-test-pick" })
      ]));
      box.appendChild(el("h3", { text: t("sv_motion_test_popup") }));
      M.STARTERS.forEach(function (s) {
        box.appendChild(el("div", { class: "sv-row" }, [el("span", { text: s.icon + " " + UI.L(s.name) })].concat(s.moves.map(function (mv, i) {
          return UI.btn(UI.L(mv.name), function () { close(); setTimeout(function () { playPopup(s, i + 1); }, 400); }, "sv-btn-ghost", { "data-act": "motion-test-popup-" + s.id + "-" + (i + 1) });
        }))));
      });
      box.appendChild(el("h3", { text: t("sv_motion_test_gallery") }));
      var f = testState;
      box.appendChild(galleryView(f, null, { onPlay: function (s, i) {
        close();
        play(s, i, { st: function () { return f; }, setDefault: function (id) { f.codex.motion.show = id; }, onClose: function () { setTimeout(openTest, 0); } });
      } }));
    }, { cls: "sv-motion-modal" });
  }
  if (/[?&]motiontest=1(&|$)/.test(location.search)) setTimeout(openTest, 300);

  if (window.PriTestStarvHallView) window.PriTestStarvHallView.addSub("motion", galleryView, "codex");

  // 日誌參數：sv_log_motion_unlock 用 {name}{move}
  if (window.PriTestStarvLog) window.PriTestStarvLog.addParams(function (st, e, p) {
    if (e.type !== "motion_unlock") return;
    var s = M.BY_ID[e.data.sid];
    p.name = s ? UI.L(s.name) : e.data.sid;
    p.move = s && s.moves[e.data.n - 1] ? UI.L(s.moves[e.data.n - 1].name) : String(e.data.n);
  });

  UI.addLogWatcher(function (App, rep) {
    var n = rep.logs.filter(function (e) { return e.type === "motion_unlock"; });
    if (!n.length) return;
    var s = M.BY_ID[n[0].data.sid];
    UI.toast("🎞️ " + t("sv_motion_toast", { name: s ? UI.L(s.name) : "", n: n.length }), "gold");
  });

  // Stage.clip（3D 演出與公司內部右下角）用：目前要顯示的御三家動作，與 motionX 是否可以出現
  function clipSource() {
    var st = appRef && appRef.st(), p = preferred(st);
    if (!p) return null;
    var src = moveSrc(p.s, p.n - 1), anim = moveAnim(p.s, p.n - 1);
    if (!src && !anim) return null;
    return { id: p.s.id + "-" + p.n, video: PREFER_ANIM && anim ? "" : src, img: anim, ms: p.s.moves[p.n - 1].ms || 4000 };
  }
  function extraClipAllowed() {
    var st = appRef && appRef.st(), m = st && Motion.ensure(st);
    return !!m && M.STARTERS.some(function (s) { return m.lv[s.id] >= Motion.MAX; });
  }

  window.PriTestStarvMotionUI = {
    clipSource: clipSource,
    preferAnim: PREFER_ANIM,
    extraClipAllowed: extraClipAllowed,
    preferred: function () { return preferred(appRef && appRef.st()); },
    openPicker: openPicker,
    showPartner: showPartner,
    closePartner: closePopup,
    openTest: openTest,
    playPopup: playPopup,
    open: function (App) { if (window.PriTestStarvHallView) window.PriTestStarvHallView.open(App, "motion"); }
  };
})();
