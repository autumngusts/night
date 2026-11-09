// 深夜居酒屋（izakaya）：畫面。規則在 izakaya_core.js、3D 在 izakaya_3d.js、連線在 izakaya_net.js。
(function () {
  "use strict";
  var app = document.getElementById("iz-app");
  if (!app) return;
  app.textContent = window.I18N.t("iz_title");
})();
