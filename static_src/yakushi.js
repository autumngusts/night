// 少女藥師的獨語（yakushi）：畫面、存檔、操作。
(function () {
  "use strict";
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function boot() {
    var app = document.getElementById("ys-app");
    if (!app) return;
    app.innerHTML = '<p class="ys-loading">' + t("ys_loading") + "</p>";
  }
  window.PriTestYakushi = { _debugState: function () { return null; }, _debugRun: function () { return null; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
