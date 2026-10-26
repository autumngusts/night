(function () {
  var STRINGS = __I18N_DATA__;
  var DEFAULT_LANG = "zh";
  var STORAGE_KEY = "pritest-lang";

  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    applyI18n();
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: lang } }));
  }

  function t(key, params) {
    var lang = getLang();
    var table = STRINGS[lang] || STRINGS[DEFAULT_LANG];
    var text = table[key] || (STRINGS[DEFAULT_LANG] && STRINGS[DEFAULT_LANG][key]) || key;
    if (params) {
      Object.keys(params).forEach(function (key2) {
        text = text.split("{" + key2 + "}").join(params[key2]);
      });
    }
    return text;
  }

  function applyI18n() {
    var lang = getLang();
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll(".lang-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".lang-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setLang(btn.getAttribute("data-lang"));
      });
    });
    applyI18n();
  });

  // 各遊戲的字串（static/i18n/<遊戲>.js）在 i18n.js 之後載入時併進來，每個遊戲分開更新、互不影響
  function extend(more) {
    Object.keys(more || {}).forEach(function (lang) {
      var table = STRINGS[lang] || (STRINGS[lang] = {});
      Object.keys(more[lang]).forEach(function (k) { table[k] = more[lang][k]; });
    });
  }

  window.I18N = { t: t, getLang: getLang, setLang: setLang, applyI18n: applyI18n, extend: extend };
})();
