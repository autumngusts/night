// 少女藥師的獨語（yakushi）：藥材資料（clear 類）。只寫常識，不寫劑量、提煉、取得方法。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var LIST = [];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs && root.PriTestYakushiHerbs.register) root.PriTestYakushiHerbs.register(LIST);
})();
