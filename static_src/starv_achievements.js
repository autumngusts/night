// 明星經紀 starV：成就登記器（規格 §14）。成就之後會擴充（計畫 9 到 60 項、之後更多）：
// 資料分檔（starv_achievements_1.js、_2.js …）各自 add()；ID 永不重用。判定由核心依 cond.type 分派，資料不寫邏輯。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var list = [];
  var map = {};

  function add(items) {
    items.forEach(function (x) {
      if (map[x.id]) throw new Error("starV achievements: 重複的 ID " + x.id);
      map[x.id] = x;
      list.push(x);
    });
  }

  D.ACHIEVEMENTS = list;
  D.ACHIEVEMENT_BY_ID = map;
  root.PriTestStarvAchievements = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; }
  };
})();
