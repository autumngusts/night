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
      if (src) box.appendChild(el("span", { class: "sv-motion-play", text: "▶" }));
      else box.title = t("sv_motion_pending");
      return box;
    }
    if (!src) { placeholder(); return box; }
    var v = el("video", { class: "sv-motion-video", src: src, muted: "", loop: "", playsinline: "", autoplay: "", preload: "auto" });
    v.muted = true;
    v.addEventListener("error", placeholder);
    box.appendChild(v);
    return box;
  }

  function play(s, i) {
    UI.openModal(function (box, close) {
      box.appendChild(UI.modalHead(UI.L(s.name) + "・" + UI.L(s.moves[i].name), close));
      box.appendChild(clip(s, i, true));
      box.appendChild(el("p", { class: "sv-small sv-muted", text: UI.L(s.desc) }));
    }, { cls: "sv-motion-modal" });
  }

  function lockText(st, s, i) {
    var m = Motion.ensure(st), n = i + 1;
    if (m.pick === s.id || !m.pick) return t(n === 1 ? "sv_motion_need_pick" : n === 2 ? "sv_motion_need_award" : "sv_motion_need_mid", { lv: M.midLevel });
    if (n === 1) return t("sv_motion_need_award");
    if (n === 2) return t("sv_motion_need_mid", { lv: M.midLevel });
    return t("sv_motion_need_next");
  }

  function galleryView(st) {
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
            if (i < lv) return el("button", { type: "button", class: "sv-motion-move", "data-act": "motion-" + s.id + "-" + (i + 1), onclick: function () { play(s, i); } },
              [clip(s, i, false), el("span", { class: "sv-small", text: "▶ " + UI.L(mv.name) })]);
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
  function openPicker(App) {
    picking = true;
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
            var err = App.act(function (x) { return Motion.choose(x, s.id); });
            if (err && err !== "motionPicked") { UI.toast(t("sv_err_" + err), "bad"); return; }
            unloadVideos(box);
            close();
          }, "sv-btn-primary sv-btn-big", { "data-act": "motion-pick-ok" })
        ]));
      }
      draw();
    }, { cls: "sv-motion-modal", locked: true, onClose: function () { picking = false; } });
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
    var ar = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 2 / 3;
    var h = Math.sqrt(M.popupArea * box.w * box.h / ar), w = h * ar;   // 面積 ＝ popupArea × 可見範圍
    if (h > box.h * 0.75) { h = box.h * 0.75; w = h * ar; }
    if (w > box.w * 0.6) { w = box.w * 0.6; h = w / ar; }
    v.style.width = w + "px"; v.style.height = h + "px";
    v.style.left = (box.r - w - 8) + "px"; v.style.top = (box.b - h - 8) + "px";
    v.style.visibility = v.videoWidth ? "" : "hidden";
  }
  function closePopup() {
    var v = popup.node;
    popup.node = null;
    popup.last = Date.now();
    window.removeEventListener("scroll", fitPopup, true);
    window.removeEventListener("resize", fitPopup);
    if (!v) return;
    v.classList.add("sv-motion-popup-out");
    setTimeout(function () { unloadVideo(v); if (v.parentNode) v.parentNode.removeChild(v); }, 400);
  }
  function showPartner() {
    var st = appRef && appRef.st();
    if (!st || popup.node) return false;
    var m = Motion.ensure(st), s = m && m.pick && M.BY_ID[m.pick], lv = s ? m.lv[s.id] : 0;
    var src = lv ? moveSrc(s, lv - 1) : "";
    popup.last = Date.now();
    if (!src) return false;   // 還沒有 webm：略過這一輪
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
    v.addEventListener("error", function () { if (popup.node === v) closePopup(); });
    document.body.appendChild(v);
    window.addEventListener("scroll", fitPopup, true);
    window.addEventListener("resize", fitPopup);
    fitPopup();
    var pr = v.play();
    if (pr && pr.catch) pr.catch(function () { if (popup.node === v) closePopup(); });
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

  window.PriTestStarvMotionUI = {
    openPicker: openPicker,
    showPartner: showPartner,
    closePartner: closePopup,
    open: function (App) { if (window.PriTestStarvHallView) window.PriTestStarvHallView.open(App, "motion"); }
  };
})();
