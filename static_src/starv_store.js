// 明星經紀 starV：存檔（規格 §17）。
// localStorage["pritest-starv-save"] 存整個 state JSON；每次寫入前把舊的搬到 -backup，主存檔壞掉時讀備份。
// 匯出字串＝"SV1." + base64url(UTF-8 JSON)，給換裝置用。讀到的存檔一律經過 Core.migrate 補齊欄位。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var Core = root.PriTestStarvCore;
  var KEY = "pritest-starv-save";
  var BACKUP = KEY + "-backup";
  var PREFIX = "SV1.";

  function defaultStorage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function valid(st) {
    return !!st && typeof st === "object" && typeof st.version === "number" &&
      !!st.company && typeof st.company === "object" && Array.isArray(st.artists);
  }
  function parse(text) {
    var st = JSON.parse(text);
    if (!valid(st)) throw new Error("starV: 存檔格式不正確");
    return Core.migrate(st);
  }

  function load(storage) {
    storage = storage || defaultStorage();
    if (!storage) return null;
    var keys = [KEY, BACKUP];
    for (var i = 0; i < keys.length; i++) {
      try {
        var text = storage.getItem(keys[i]);
        if (text) return parse(text);
      } catch (e) { /* 這份壞了，試下一份 */ }
    }
    return null;
  }

  function save(st, storage) {
    storage = storage || defaultStorage();
    if (!storage) return false;
    try {
      var prev = storage.getItem(KEY);
      if (prev) storage.setItem(BACKUP, prev);
      storage.setItem(KEY, JSON.stringify(st));
      return true;
    } catch (e) { return false; }   // 私密模式或容量不足：只是記不住
  }

  function clear(storage) {
    storage = storage || defaultStorage();
    if (!storage) return;
    try { storage.removeItem(KEY); storage.removeItem(BACKUP); } catch (e) { /* 忽略 */ }
  }

  function toB64(str) { return root.btoa(unescape(encodeURIComponent(str))); }
  function fromB64(b64) { return decodeURIComponent(escape(root.atob(b64))); }

  function encode(st) {
    return PREFIX + toB64(JSON.stringify(st)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decode(code) {
    var s = String(code || "").replace(/\s+/g, "");
    if (s.indexOf(PREFIX) !== 0) throw new Error("starV: 不是 starV 的存檔字串");
    var body = s.slice(PREFIX.length);
    if (!body || !/^[A-Za-z0-9_-]+$/.test(body)) throw new Error("starV: 存檔字串含有無效字元");
    var b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return parse(fromB64(b64));
  }

  root.PriTestStarvStore = { KEY: KEY, BACKUP: BACKUP, load: load, save: save, clear: clear, encode: encode, decode: decode, parse: parse };
})();
