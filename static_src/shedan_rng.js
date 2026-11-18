// 射彈宇宙（shedan）：種子亂數。肉鴿層的亂數全部從這裡來，移植到 RMD 時照這個演算法改寫成 Go（mulberry32＋FNV-1a）。
// 瀏覽器掛在 window.PriTestShedanRng；Node 測試用 require 載入。
(function () {
  "use strict";

  // mulberry32：回傳 [0, 1) 的函式
  function make(seed) {
    var a = (seed == null ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a 32 位元：字串（例如每日星圖的日期）→ 種子
  function hashStr(s) {
    var h = 0x811C9DC5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function shuffle(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var api = { make: make, hashStr: hashStr, int: int, pick: pick, shuffle: shuffle };
  var root = typeof window !== "undefined" ? window : globalThis;
  root.PriTestShedanRng = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
