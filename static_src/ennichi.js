// ============================================================================
// 緣日樂園：畫面（HUD、面板、小地圖、murmur 牆）。Task 15 會整檔改寫；這裡先放骨架確認建置。
// ============================================================================
(function () {
  "use strict";
  var root = document.getElementById("en-game");
  if (!root) return;
  root.innerHTML = '<h1 class="en-title" data-i18n="en_title"></h1>';
  if (window.I18N) window.I18N.applyI18n();
})();
