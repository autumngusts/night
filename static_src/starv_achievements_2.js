// 明星經紀 starV：成就 v2——大型企劃。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(id, name, desc, type, n, tickets) {
    return { id: id, addedIn: "v2", name: T(name), desc: T(desc), cond: { type: type, n: n }, reward: { tickets: tickets } };
  }

  root.PriTestStarvAchievements.add([
    A("first_project", "大製作|ビッグプロジェクト", "完成第一件大型企劃|初めての大型企画を完遂", "projects", 1, 5),
    A("great_project", "傳說級企劃|伝説の企画", "大型企劃大成功|大型企画で大成功", "projectsGreat", 1, 10)
  ]);
})();
