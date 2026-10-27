// 明星經紀 starV：大型企劃登記器（規格 §12）。企劃之後會擴充：資料分檔（starv_projects_1.js、_2.js …）各自 add()，ID 永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var list = [];
  var map = {};

  function add(items) {
    items.forEach(function (p) {
      if (map[p.id]) throw new Error("starV projects: 重複的 ID " + p.id);
      map[p.id] = p;
      list.push(p);
    });
  }

  D.PROJECTS = list;
  D.PROJECT_BY_ID = map;
  root.PriTestStarvProjects = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; }
  };
})();
