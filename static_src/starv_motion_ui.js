// 明星經紀 starV：動圖圖鑑「御三家」畫面（規格 docs/superpowers/specs/2026-11-15-starv-motion-codex.md）。
// ・開局（新存檔、新紀元、舊存檔第一次載入）彈出御三家選擇視窗
// ・殿堂分頁的「動圖」子分頁：3 位 × 3 個動作，已解鎖的可以播放 webm（src 空白時顯示佔位畫面）
// ・解鎖時跳出提示
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

  // 動作畫面：大畫面（播放視窗）有 src 就自動循環播放，沒有 src 或載入失敗就顯示「動畫準備中」；
  // 縮圖只放圖示（有影片時加 ▶），不建立 <video>：圖鑑一次 9 格，全部預載太重
  function clip(s, i, big) {
    var box = el("div", { class: "sv-motion-clip" + (big ? " sv-motion-clip-big" : ""), style: "--sv-motion-color:" + s.color });
    var src = moveSrc(s, i);
    function placeholder() {
      box.innerHTML = "";
      box.appendChild(el("span", { class: "sv-motion-ph-icon", text: s.icon }));
      if (big) box.appendChild(el("span", { class: "sv-small", text: t("sv_motion_pending") }));
    }
    if (!big) {
      box.appendChild(el("span", { class: "sv-motion-ph-icon", text: s.icon }));
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
  var picking = false;
  function openPicker(App) {
    picking = true;
    var chosen = null;
    UI.openModal(function (box, close) {
      var st = App.st();
      box.appendChild(el("h2", { class: "sv-modal-title", text: t("sv_motion_pick_title") }));
      box.appendChild(el("p", { class: "sv-small", text: t(st.era > 1 || Motion.total(st) ? "sv_motion_pick_again" : "sv_motion_pick_intro") }));
      var cards = el("div", { class: "sv-motion-grid" });
      var ok = UI.btn(t("sv_motion_pick_ok"), function () {
        if (!chosen) return;
        var err = App.act(function (s) { return Motion.choose(s, chosen); });
        if (err && err !== "motionPicked") { UI.toast(t("sv_err_" + err), "bad"); return; }
        close();
      }, "sv-btn-primary sv-btn-big", { "data-act": "motion-pick-ok", disabled: "" });
      M.STARTERS.forEach(function (s) {
        var lv = Motion.level(st, s.id);
        var card = el("button", { type: "button", class: "sv-card sv-motion-card sv-motion-choice", style: "--sv-motion-color:" + s.color, "data-act": "motion-pick-" + s.id,
          onclick: function () {
            chosen = s.id;
            Array.prototype.forEach.call(cards.children, function (n) { n.classList.toggle("sv-motion-picked", n === card); });
            ok.disabled = false;
          } }, [
          clip(s, 0, false),
          el("b", { text: s.icon + " " + UI.L(s.name) }),
          el("span", { class: "sv-small sv-muted", text: UI.L(s.desc) }),
          lv ? el("span", { class: "sv-chip", text: lv >= Motion.MAX ? t("sv_motion_done") : t("sv_motion_have", { n: lv, max: Motion.MAX }) }) : null
        ]);
        cards.appendChild(card);
      });
      box.appendChild(cards);
      box.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_motion_pick_rule", { lv: M.midLevel }) }));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [ok]));
    }, { cls: "sv-motion-modal", locked: true, onClose: function () { picking = false; } });
  }

  // 每次重畫都會經過：同步鏡射；需要選擇時排入選擇視窗（唯讀中不問）
  UI.addExtra(function (App) {
    var st = App.st();
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
    open: function (App) { if (window.PriTestStarvHallView) window.PriTestStarvHallView.open(App, "motion"); }
  };
})();
