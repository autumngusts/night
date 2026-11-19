// 煉金術士（atelier）：畫面（Task 6 換成正式版）
(function () {
  "use strict";
  var app = document.getElementById("at-app");
  if (app) app.textContent = window.I18N ? window.I18N.t("at_title") : "Atelier";
})();
