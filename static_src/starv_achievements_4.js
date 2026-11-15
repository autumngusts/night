// 明星經紀 starV：成就 v4（動圖圖鑑 3 項）。判定類型 motions／motionFull 由 starv_motion.js 經 Core.achCheck() 登記；
// 沒載入 starv_motion.js 的環境（例：sim.js）找不到判定函式，這幾項只是不會達成。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(id, name, desc, type, n, tickets) {
    return { id: id, addedIn: "v4", name: T(name), desc: T(desc), cond: { type: type, n: n }, reward: { tickets: tickets } };
  }

  root.PriTestStarvAchievements.add([
    A("motion_first", "第一支動圖|はじめてのモーション", "動圖圖鑑解鎖第 1 個動作|モーション図鑑で初めて動作を解放", "motions", 1, 2),
    A("motion_trio_full", "看家本領|十八番", "1 位御三家的 3 個動作全部解鎖|御三家 1 人の 3 動作をすべて解放", "motionFull", 1, 5),
    A("motion_all", "御三家全收藏|御三家コンプリート", "御三家 9 個動作全部解鎖|御三家の 9 動作をすべて解放", "motions", 9, 10)
  ]);
})();
