// 明星經紀 starV：SR／SSR 名錄登記器（§4）。
// 各名錄檔（starv_roster_1.js …）呼叫 add() 追加；ID 永不重用，重複就丟錯以免資料互相覆蓋。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var list = [];
  var map = {};

  function add(entries) {
    entries.forEach(function (e) {
      if (map[e.id]) throw new Error("starV roster: 重複的 ID " + e.id);
      map[e.id] = e;
      list.push(e);
    });
  }

  root.PriTestStarvRoster = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; },
    byRarity: function (r) { return list.filter(function (e) { return e.rarity === r; }); }
  };
})();
