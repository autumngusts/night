// 射彈宇宙（shedan）：畫面流程。滿版畫面與導覽列切換（Task 1 骨架；戰鬥流程在 Task 5 補上）。
(function () {
  "use strict";

  function t(key, params) { return window.I18N ? window.I18N.t(key, params) : key; }

  // 導覽列平時藏在畫面上方，☰ 展開；點導覽列以外的地方收起（使用者指定 2026-11-18）
  function setupNav() {
    document.body.classList.add("sd-body");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "sd-nav-toggle";
    btn.textContent = "☰";
    btn.setAttribute("aria-label", t("sd_nav"));
    btn.setAttribute("aria-expanded", "false");
    document.body.appendChild(btn);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setNavOpen(!isNavOpen());
    });
    document.addEventListener("pointerdown", function (e) {
      if (!isNavOpen()) return;
      var header = document.querySelector(".site-header");
      if (e.target === btn || (header && header.contains(e.target))) return;
      setNavOpen(false);
    }, true);
  }
  function isNavOpen() { return document.body.classList.contains("sd-nav-open"); }
  function setNavOpen(open) {
    document.body.classList.toggle("sd-nav-open", open);
    var btn = document.getElementById("sd-nav-toggle");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  window.PriTestShedanApp = { isNavOpen: isNavOpen, setNavOpen: setNavOpen };

  setupNav();
})();
