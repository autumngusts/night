// 少女藥師的獨語（yakushi）：規則核心。不碰 DOM、不讀寫 localStorage；畫面（yakushi.js）只呼叫這裡。
// 規則依據 docs/yakushi_game_design.md。案件資料由 yakushi_case_*.js 用 registerCase() 登記。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  function H() { return root.PriTestYakushiHerbs; }

  // ---- 暫定數值（§5～§7） ----
  var START_STAMINA = 3;      // 體力：嚐 danger≥2 的藥材 -1，歸零強制休息
  var COLLAPSE_HOURS = 2;     // 體力歸零休息消耗的時辰
  var START_TRUST = 3;        // 指認時的信任
  var REMEDY_MAX_LEVEL = 3;   // 調藥錯誤惡化到這一級就被太醫接手
  var CASE_ORDER = ["case0", "case1", "case2", "case3"];
  var SLOTS = ["who", "what", "how", "why"];

  var cases = {};
  function registerCase(def) { cases[def.id] = def; }
  function getCase(id) { return cases[id] || null; }

  function newSave() { return { v: 1, unlocked: ["case0"], cases: {}, herbsSeen: {}, monologues: {}, castSeen: {} }; }
  function normalizeSave(raw) {
    var s = newSave();
    if (!raw || typeof raw !== "object") return s;
    if (Array.isArray(raw.unlocked) && raw.unlocked.length) s.unlocked = raw.unlocked.slice();
    ["cases", "herbsSeen", "monologues", "castSeen"].forEach(function (k) {
      if (raw[k] && typeof raw[k] === "object" && !Array.isArray(raw[k])) s[k] = raw[k];
    });
    return s;
  }

  function has(run, cardId) { return run.cards.indexOf(cardId) >= 0; }
  function addCard(run, id) { if (!has(run, id)) run.cards.push(id); }
  function spend(run, n) {
    run.hours = Math.max(0, run.hours - n);
    if (run.hours === 0 && run.phase === "investigate") run.phase = "board";
  }
  function findPlace(def, id) {
    for (var i = 0; i < def.places.length; i++) if (def.places[i].id === id) return def.places[i];
    return null;
  }
  function findSpot(def, spotId) {
    for (var i = 0; i < def.places.length; i++) {
      var sp = def.places[i].spots;
      for (var j = 0; j < sp.length; j++) if (sp[j].id === spotId) return { place: def.places[i], spot: sp[j] };
    }
    return null;
  }

  function startCase(save, caseId) {
    var def = getCase(caseId);
    if (!def) return { error: "case" };
    if (save.unlocked.indexOf(caseId) < 0) return { error: "locked" };
    var run = {
      caseId: caseId, hours: def.hours, stamina: START_STAMINA, trust: START_TRUST, place: def.startPlace,
      cards: (def.startCards || []).slice(), done: {}, identified: {}, tested: {}, patients: {},
      board: { who: null, what: null, how: null, why: null, deep: null },
      submits: 0, mispresent: 0, accuseFails: 0, accuseStep: 0, phase: "investigate", result: null
    };
    (def.patients || []).forEach(function (p) { run.patients[p.id] = { level: 0, cured: false, lost: false }; });
    save.cases[caseId] = save.cases[caseId] || {};
    save.cases[caseId].run = run;
    return run;
  }

  function cardInfo(def, id) {
    if (typeof id !== "string") return null;
    if (id.indexOf("herb:") === 0) {
      var h = H().get(id.slice(5));
      return h ? { id: id, kind: "herb", name: h.name, text: h.lore, tags: H().tagsOf(h), of: null, herb: h.id } : null;
    }
    var c = def.cards[id];
    if (!c) return null;
    return { id: id, kind: c.kind, name: c.name, text: c.text || "", tags: c.tags || [], of: c.of || null, herb: c.herb || null };
  }

  function spotOpen(run, spot) { return (spot.requires || []).every(function (c) { return has(run, c); }); }
  function move(run, placeId) {
    if (run.phase !== "investigate") return { error: "phase" };
    if (!findPlace(getCase(run.caseId), placeId)) return { error: "place" };
    if (run.place === placeId) return { ok: true, cost: 0 };
    run.place = placeId; spend(run, 1);
    return { ok: true, cost: 1 };
  }
  function visit(run, spotId) {
    if (run.phase !== "investigate") return { error: "phase" };
    var f = findSpot(getCase(run.caseId), spotId);
    if (!f) return { error: "spot" };
    if (f.place.id !== run.place) return { error: "place" };
    if (run.done[spotId]) return { error: "done" };
    if (!spotOpen(run, f.spot)) return { error: "locked" };
    run.done[spotId] = true;
    f.spot.gives.forEach(function (c) { addCard(run, c); });
    spend(run, f.spot.cost == null ? 1 : f.spot.cost);
    return { ok: true, text: f.spot.text, gives: f.spot.gives.slice() };
  }
  function toBoard(run) { if (run.phase === "investigate") run.phase = "board"; }

  // ---- 鑑定、試藥、調藥（Task 6） ----

  // ---- 推理板、指認、評價、結案（Task 7） ----

  var api = {
    CASE_ORDER: CASE_ORDER, SLOTS: SLOTS,
    registerCase: registerCase, getCase: getCase, newSave: newSave, normalizeSave: normalizeSave,
    startCase: startCase, cardInfo: cardInfo, spotOpen: spotOpen, move: move, visit: visit, toBoard: toBoard
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCore = api;
})();
