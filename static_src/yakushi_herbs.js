// 少女藥師的獨語（yakushi）：藥材 registry。資料由 yakushi_herbs_<cat>.js 登記。規則依據 docs/yakushi_game_design.md §4。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var byId = {}, order = [];
  function register(list) {
    list.forEach(function (h) {
      if (byId[h.id]) throw new Error("yakushi: 藥材 id 重複 " + h.id);
      byId[h.id] = h; order.push(h.id);
    });
  }
  function get(id) { return byId[id] || null; }
  function list() { return order.map(get); }
  function byCat(cat) { return list().filter(function (h) { return h.cat === cat; }); }
  function byGroup(g) { return list().filter(function (h) { return h.group === g; }); }
  function tagsOf(h) {
    var t = h.traits || {};
    var out = [].concat(t.form || [], t.smell || [], t.taste || [], t.symptom || []);
    if (t.onset) out.push("onset:" + t.onset);
    return out;
  }
  function filter(tags) {
    return list().filter(function (h) {
      var own = tagsOf(h);
      return tags.every(function (x) { return own.indexOf(x) >= 0; });
    });
  }
  function search(q) {
    q = String(q || "");
    return list().filter(function (h) {
      return h.name.indexOf(q) >= 0 || (h.alias || []).some(function (a) { return a.indexOf(q) >= 0; });
    });
  }
  function _reset() { byId = {}; order = []; }
  var api = {
    CATS: ["poison", "mineral", "animal", "tonic", "clear", "boudoir"],
    METHODS: ["look", "smell", "taste", "silver", "water", "heat", "animal"],
    register: register, get: get, list: list, byCat: byCat, byGroup: byGroup,
    tagsOf: tagsOf, filter: filter, search: search, _reset: _reset
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiHerbs = api;
})();
