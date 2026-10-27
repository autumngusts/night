// 明星經紀 starV：雲端存檔的畫面（規格 §18）：公司分頁的雲端卡、?cloud=<ID> 連結的接回確認、其他裝置進行中時的唯讀遮罩。
// 同步規則在 starv_cloud.js；這裡建立控制器、接上 PriTestGameStorage 與 App，並決定上傳時機：
// 每 30 秒、重要時點（App.onChange → ctl.changed：抽卡、頒獎、新紀元）、切到背景時、網路恢復時。
// 沒有啟用雲端時不呼叫任何 GameStorage 函式，所以不會載入 Firebase SDK。
(function () {
  "use strict";

  var Cloud = window.PriTestStarvCloud;
  var UI = window.PriTestStarvUI;
  var GS = window.PriTestGameStorage;
  if (!Cloud || !UI || !GS) { window.PriTestStarvCloudUI = { boot: function () {}, card: function () { return null; }, ctl: function () { return null; } }; return; }

  var t = UI.t, el = UI.el;
  var UPLOAD_EVERY_MS = 30000;
  var ctl = null, app = null, lockEl = null;
  var ui = { idText: "" };

  function safeStorage() { try { return window.localStorage; } catch (e) { return null; } }
  function savedText(serverMs) { return new Date(serverMs - GS.serverTimeOffset()).toLocaleString(); }
  function copy(text) {
    try { navigator.clipboard.writeText(text).then(function () { UI.toast(t("sv_save_copied")); }); } catch (e) { /* 不支援就手動複製 */ }
  }

  function statusText(info) {
    if (info.locked) return t("sv_cloud_status_locked");
    if (info.pending) return t("sv_cloud_status_pending");
    if (info.lastSync) return t("sv_cloud_status_synced", { time: savedText(info.lastSync) });
    return t("sv_cloud_status_never");
  }

  // 唯讀遮罩直接掛在 .sv-root（不走彈窗佇列，也不會被 render() 清掉），蓋在所有彈窗上面
  function removeLock() { if (lockEl && lockEl.parentNode) lockEl.parentNode.removeChild(lockEl); lockEl = null; }
  function renderLock(info) {
    if (!info.locked) { removeLock(); return; }
    if (lockEl) return;
    lockEl = el("div", { class: "sv-cloud-lock", role: "dialog" }, [
      el("div", { class: "sv-cloud-lock-box" }, [
        el("h2", { text: t("sv_cloud_lock_title") }),
        el("p", { text: t("sv_cloud_lock_body") }),
        UI.btn(t("sv_cloud_takeover"), function () {
          ctl.takeover().then(function (ok) { if (!ok) UI.toast(t("sv_cloud_err_net"), "bad"); });
        }, "sv-btn-primary sv-btn-big", { "data-act": "cloud-takeover" })
      ])
    ]);
    (document.querySelector(".sv-root") || document.body).appendChild(lockEl);
  }

  function onStatus(info) {
    renderLock(info);
    if (app && app.st()) app.render();
  }

  function askConnect(id) {
    if (!Cloud.validId(id)) { UI.toast(t("sv_cloud_err_id"), "bad"); return; }
    ctl.preview(id).then(function (env) {
      if (!env) { UI.toast(t("sv_cloud_err_notfound"), "bad"); return; }
      UI.openModal(function (box, close) {
        box.appendChild(UI.modalHead(t("sv_cloud_confirm_title"), close));
        box.appendChild(el("p", { text: t("sv_cloud_confirm_body", { name: env.name || t("sv_company_default"), date: UI.dateText(env.day), saved: savedText(env.savedAt) }) }));
        box.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_cloud_confirm_note") }));
        box.appendChild(el("div", { class: "sv-row sv-row-end" }, [
          UI.btn(t("sv_cancel"), close, "sv-btn-ghost", { "data-act": "cloud-connect-cancel" }),
          UI.btn(t("sv_cloud_confirm_go"), function () {
            close();
            ctl.connect(id, env).then(function (ok) {
              ui.idText = "";
              UI.toast(ok ? t("sv_cloud_connected") : t("sv_cloud_err_net"), ok ? "gold" : "bad");
            }, function () { UI.toast(t("sv_err_import"), "bad"); });
          }, "sv-btn-danger", { "data-act": "cloud-connect-confirm" })
        ]));
      });
    }, function () { UI.toast(t("sv_cloud_err_net"), "bad"); });
  }

  function card(App) {
    if (!ctl) return null;
    var info = ctl.info();
    var rows = [el("h3", { text: t("sv_cloud") }), el("p", { class: "sv-small sv-muted", text: t("sv_cloud_hint") })];
    if (!info.enabled) {
      rows.push(el("div", { class: "sv-row" }, [UI.btn(t("sv_cloud_enable"), function () {
        ctl.enable().then(function (id) {
          UI.toast(id ? t("sv_cloud_enabled") : t("sv_cloud_err_net"), id ? "gold" : "bad");
          App.render();
        });
      }, "sv-btn-primary", { "data-act": "cloud-enable" })]));
      var input = el("input", { class: "sv-input", placeholder: t("sv_cloud_id_ph"), value: ui.idText, "data-act": "cloud-id-input",
        oninput: function () { ui.idText = input.value.trim(); } });
      rows.push(el("label", { class: "sv-field" }, [el("span", { text: t("sv_cloud_id_label") }), input]));
      rows.push(el("div", { class: "sv-row" }, [UI.btn(t("sv_cloud_connect"), function () { askConnect(ui.idText); }, "", { "data-act": "cloud-connect" })]));
    } else {
      var link = Cloud.linkFor(location.href, info.id);
      var canvas = el("canvas", { class: "sv-cloud-qr", "data-act": "cloud-qr" });
      try { window.PriTestQRCode.renderToCanvas(canvas, link, { level: "L", scale: 4, margin: 2 }); } catch (e) { /* 沒有 QR 也能輸入 ID */ }
      rows.push(el("label", { class: "sv-field" }, [el("span", { text: t("sv_cloud_id_label") }),
        el("input", { class: "sv-input sv-cloud-id", readonly: true, value: info.id, "data-act": "cloud-id" })]));
      rows.push(el("div", { class: "sv-row" }, [
        UI.btn(t("sv_save_copy"), function () { copy(info.id); }, "sv-btn-ghost", { "data-act": "cloud-copy" }),
        UI.btn(t("sv_cloud_copy_link"), function () { copy(link); }, "sv-btn-ghost", { "data-act": "cloud-copy-link" })
      ]));
      rows.push(canvas);
      rows.push(el("p", { class: "sv-small sv-muted", text: t("sv_cloud_qr_hint") }));
      rows.push(el("p", { class: "sv-small sv-cloud-warn", text: t("sv_cloud_warn") }));
      rows.push(el("div", { class: "sv-small", "data-act": "cloud-status", text: statusText(info) }));
      rows.push(el("div", { class: "sv-row sv-row-end" }, [
        UI.btn(t("sv_cloud_upload"), function () { ctl.upload().then(function (ok) { if (ok) UI.toast(t("sv_cloud_uploaded")); }); }, "", { "data-act": "cloud-upload" }),
        UI.btn(t("sv_cloud_disable"), function () { ctl.disable(); App.render(); }, "sv-btn-ghost", { "data-act": "cloud-disable" })
      ]));
    }
    return el("div", { class: "sv-card sv-cloud" }, rows);
  }

  function boot(App) {
    app = App;
    ctl = Cloud.create({ gs: GS, storage: safeStorage(), app: App, onStatus: onStatus });
    App.onChange(function () { ctl.changed(); });
    ctl.attach();
    setInterval(function () { if (document.visibilityState !== "hidden") ctl.tick(); }, UPLOAD_EVERY_MS);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") ctl.upload(); });
    window.addEventListener("online", function () { ctl.onOnline(); });
    window.addEventListener("i18n:change", function () { if (lockEl) { removeLock(); renderLock(ctl.info()); } });
    // QR／連結：?cloud=<ID> → 先從網址拿掉（重新整理不會再問），再詢問是否接回
    var id = Cloud.idFromSearch(location.search);
    if (id !== null) {
      try { history.replaceState(null, "", location.pathname + Cloud.stripCloudParam(location.search) + location.hash); } catch (e) { /* 舊瀏覽器 */ }
      askConnect(id);
    }
  }

  window.PriTestStarvCloudUI = { boot: boot, card: card, ctl: function () { return ctl; } };
})();
