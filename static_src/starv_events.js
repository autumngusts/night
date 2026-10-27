// 明星經紀 starV：重大事件登記器（規格 §7；使用者指定 2026-10-27：事件之後要擴充到上千種）。
// 事件資料分檔（starv_events_1.js、_2.js …），各自呼叫 add() 追加；ID 永不重用，重複就丟錯。
// 登記時同步維護 PriTestStarvData 的 EVENTS／EVENT_BY_ID／EVENT_CATS，核心只讀這三個欄位。
// byTarget(key) 先依目標篩選鍵分好組，抽隨機事件時每個篩選鍵只需對藝人算一次。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var CATS = ["scandal", "chance", "poach", "net", "health", "company", "special"];
  var list = [];
  var map = {};
  var byTarget = {};

  function add(events) {
    events.forEach(function (ev) {
      if (map[ev.id]) throw new Error("starV events: 重複的 ID " + ev.id);
      map[ev.id] = ev;
      list.push(ev);
      if (ev.trigger === "random") (byTarget[ev.target] || (byTarget[ev.target] = [])).push(ev);
    });
  }

  D.EVENTS = list;
  D.EVENT_BY_ID = map;
  D.EVENT_CATS = CATS;
  root.PriTestStarvEvents = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; },
    byTarget: function (key) { return (byTarget[key] || []).slice(); },
    targets: function () { return Object.keys(byTarget); },
    CATS: CATS
  };
})();
