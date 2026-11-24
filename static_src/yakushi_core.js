// 少女藥師的獨語（yakushi）：規則核心。不碰 DOM、不讀寫 localStorage。規則依據 docs/yakushi_game_design.md。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var api = {};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCore = api;
})();
