// 東正小遊戲：標的卡（經典／內線）與滿分對象卡的「朗讀」按鈕（Web Speech API 的 speechSynthesis）。
// 朗讀內容直接從卡片 DOM 取（第幾題／類別、名稱、簡介、特徵標籤、滿分男的爆料句），兩種卡共用。
// 語音：標準＋5 種角色預設（音高／語速不同，裝置有多個同語言語音時也會換成不同的聲音）。
// 選擇存在 localStorage（純個人偏好，不進遊戲 state、不同步）。
(function () {
  "use strict";

  var STORE_KEY = "pritest-toushou-tts-voice";
  // slot：同語言語音清單中優先使用第幾個；gender：依語音名稱猜測男女（猜不到就用 slot）
  var PRESETS = [
    { id: "std", rate: 1, pitch: 1, slot: 0, gender: "" },
    { id: "anchor", rate: 1.05, pitch: 0.95, slot: 1, gender: "f" },
    { id: "auction", rate: 1.45, pitch: 1.15, slot: 2, gender: "m" },
    { id: "uncle", rate: 0.85, pitch: 0.55, slot: 1, gender: "m" },
    { id: "girl", rate: 1.15, pitch: 1.65, slot: 0, gender: "f" },
    { id: "elder", rate: 0.72, pitch: 0.7, slot: 2, gender: "m" }
  ];
  var MALE = /male\b(?!.*female)|otoya|ichiro|kenji|keita|daichi|naoki|yunjhe|zhiwei|kangkang|yunxi|yunyang|daniel|alex|fred|david|guy|mark|george/i;
  var FEMALE = /female|kyoko|ayumi|haruka|sayaka|nanami|mizuki|mei-?jia|yating|hanhan|huihui|xiaoxiao|hsiaochen|tingting|samantha|zira|aria|jenny|susan|karen|victoria/i;

  var speaking = false;
  var token = 0;

  function t(key, params) { return window.I18N.t(key, params); }
  function supported() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }
  function speechLang() {
    var l = window.I18N.getLang();
    return l === "zh" ? "zh-TW" : (l === "ja" ? "ja-JP" : "en-US");
  }

  function currentPresetId() {
    var id = null;
    try { id = localStorage.getItem(STORE_KEY); } catch (e) { /* 忽略 */ }
    return PRESETS.some(function (p) { return p.id === id; }) ? id : "std";
  }
  function presetById(id) { return PRESETS.filter(function (p) { return p.id === id; })[0] || PRESETS[0]; }

  function langVoices() {
    var want = speechLang().toLowerCase();
    var base = want.split("-")[0];
    var all = window.speechSynthesis.getVoices() || [];
    var exact = all.filter(function (v) { return String(v.lang).toLowerCase().replace("_", "-") === want; });
    var loose = all.filter(function (v) { return String(v.lang).toLowerCase().indexOf(base) === 0 && exact.indexOf(v) < 0; });
    return exact.concat(loose);
  }

  function pickVoice(preset) {
    var list = langVoices();
    if (!list.length) return null;
    if (preset.gender) {
      var re = preset.gender === "m" ? MALE : FEMALE;
      var byGender = list.filter(function (v) { return re.test(v.name); });
      if (byGender.length) return byGender[preset.slot % byGender.length];
    }
    return list[preset.slot % list.length];
  }

  // 長文切段（Chrome 長句朗讀可能中途停掉）
  function chunks(text) {
    return String(text).replace(/([。！？!?\n])/g, "$1\u0001").split("\u0001").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function stop() {
    token++;
    speaking = false;
    if (supported()) window.speechSynthesis.cancel();
    syncButtons();
  }

  function speak(text, presetId) {
    if (!supported() || !text) return;
    var preset = presetById(presetId || currentPresetId());
    var parts = chunks(text);
    var my = ++token;
    window.speechSynthesis.cancel();
    speaking = true;
    syncButtons();
    var i = 0;
    function next() {
      if (my !== token) return;
      if (i >= parts.length) { speaking = false; syncButtons(); return; }
      var u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = speechLang();
      var v = pickVoice(preset);
      if (v) u.voice = v;
      u.rate = preset.rate;
      u.pitch = preset.pitch;
      u.onend = next;
      u.onerror = next;
      window.speechSynthesis.speak(u);
    }
    next();
  }

  function syncButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".ts-tts-btn"), function (b) {
      b.textContent = t(speaking ? "ts_tts_stop" : "ts_tts_read");
    });
  }

  // 從卡片 DOM 組朗讀文字
  function cardText(card) {
    if (!card) return "";
    function txt(sel) { var n = card.querySelector(sel); return n ? n.textContent.trim() : ""; }
    var lines = [txt(".ts-lot"), txt("h2"), txt(".ts-summary")];
    var tags = Array.prototype.map.call(card.querySelectorAll(".ts-tags span"), function (s) { return s.textContent.trim(); })
      .filter(Boolean);
    if (tags.length) lines.push(t("ts_tts_tags", { list: tags.join("、") }));
    lines.push(txt(".ts-hooks"));
    lines.push(txt("#ts-mf-sentence"));
    return lines.filter(Boolean).map(function (s) { return /[。！？!?.]$/.test(s) ? s : s + "。"; }).join("\n");
  }

  // 卡片上的朗讀列：按鈕＋語音選單
  function bar() {
    var wrap = document.createElement("div");
    wrap.className = "ts-tts";
    if (!supported()) {
      var p = document.createElement("span");
      p.className = "ts-tts-note";
      p.textContent = t("ts_tts_unsupported");
      wrap.appendChild(p);
      return wrap;
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ts-tts-btn";
    btn.id = "ts-tts-read";
    btn.textContent = t(speaking ? "ts_tts_stop" : "ts_tts_read");
    btn.addEventListener("click", function () {
      if (speaking) { stop(); return; }
      speak(cardText(btn.closest(".ts-target-card")));
    });
    var sel = document.createElement("select");
    sel.className = "ts-tts-voice";
    sel.id = "ts-tts-voice";
    sel.setAttribute("aria-label", t("ts_tts_voice"));
    var cur = currentPresetId();
    PRESETS.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = t("ts_tts_v_" + p.id);
      if (p.id === cur) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      try { localStorage.setItem(STORE_KEY, sel.value); } catch (e) { /* 忽略 */ }
      // 換語音時試聽一句
      speak(t("ts_tts_sample"), sel.value);
    });
    wrap.appendChild(btn);
    wrap.appendChild(sel);
    return wrap;
  }

  // 有些瀏覽器的語音清單是非同步載入的
  if (supported() && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener("voiceschanged", function () { /* 下次朗讀時重新挑選即可 */ });
  }
  window.addEventListener("i18n:change", stop);

  window.PriTestToushouTTS = {
    bar: bar, speak: speak, stop: stop, cardText: cardText, presets: function () { return PRESETS.slice(); },
    _pickVoice: function (id) { var v = pickVoice(presetById(id)); return v ? v.name : null; }
  };
})();
