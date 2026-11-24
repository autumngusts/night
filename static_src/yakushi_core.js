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
  function evidenceTags(run, evidenceId) {
    var def = getCase(run.caseId), out = [];
    function push(tags) { (tags || []).forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); }); }
    if (def.cards[evidenceId]) push(def.cards[evidenceId].tags);
    run.cards.forEach(function (cid) {
      var c = def.cards[cid];
      if (c && c.of === evidenceId) push(c.tags);
    });
    return out;
  }
  function candidates(tags) { return H().filter(tags); }

  function identify(run, evidenceId, herbId) {
    if (run.phase !== "investigate") return { error: "phase" };
    var c = getCase(run.caseId).cards[evidenceId];
    if (!c || !c.herb) return { error: "evidence" };
    if (!has(run, evidenceId)) return { error: "missing" };
    if (!H().get(herbId)) return { error: "herb" };
    var prev = run.identified[evidenceId];
    run.identified[evidenceId] = herbId;
    if (prev && prev !== herbId) {
      var still = Object.keys(run.identified).some(function (e) { return run.identified[e] === prev; });
      if (!still) run.cards = run.cards.filter(function (x) { return x !== "herb:" + prev; });
    }
    addCard(run, "herb:" + herbId);
    if (herbId !== c.herb) spend(run, 1);     // §5.1：錯誤不公開，只多扣 1 時辰
    return { ok: true };
  }

  function runTest(run, evidenceId, method) {
    if (run.phase !== "investigate") return { error: "phase" };
    if (H().METHODS.indexOf(method) < 0) return { error: "method" };
    var def = getCase(run.caseId), c = def.cards[evidenceId];
    if (!c || !c.herb) return { error: "evidence" };
    if (!has(run, evidenceId)) return { error: "missing" };
    var key = evidenceId + "|" + method;
    if (key in run.tested) return { ok: true, text: run.tested[key], gives: null, collapsed: false, repeat: true };
    var entry = (def.tests || []).filter(function (t) { return t.evidence === evidenceId && t.method === method; })[0];
    var herb = H().get(c.herb);
    var text = entry ? entry.text : (herb && herb.tests && herb.tests[method]) || null;
    run.tested[key] = text;
    spend(run, 1);
    var collapsed = false;
    if (method === "taste" && herb && herb.danger >= 2) {
      run.stamina -= 1;
      if (run.stamina <= 0) { run.stamina = START_STAMINA; spend(run, COLLAPSE_HOURS); collapsed = true; }
    }
    var gives = entry && entry.gives ? entry.gives : null;
    if (gives) addCard(run, gives);
    return { ok: true, text: text, gives: gives, collapsed: collapsed, repeat: false };
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  function giveRemedy(run, patientId, herbIds) {
    if (run.phase !== "investigate") return { error: "phase" };
    var def = getCase(run.caseId);
    var p = (def.patients || []).filter(function (x) { return x.id === patientId; })[0];
    if (!p) return { error: "patient" };
    var st = run.patients[patientId];
    if (st.cured || st.lost) return { error: "done" };
    if (!herbIds || herbIds.length < 1 || herbIds.length > 3) return { error: "count" };
    if (!herbIds.every(function (h) { return def.medicineBox.indexOf(h) >= 0; })) return { error: "box" };
    if (sameSet(herbIds, p.remedy)) { st.cured = true; addCard(run, p.gives); return { ok: true, cured: true, lost: false }; }
    st.level += 1;
    if (st.level >= REMEDY_MAX_LEVEL) st.lost = true;
    spend(run, 1);
    return { ok: true, cured: false, lost: st.lost };
  }

  // ---- 推理板、指認、評價、結案（Task 7） ----

  function placeCard(run, slot, cardId) {
    if (run.phase !== "board" && !(slot === "deep" && run.phase === "accuse")) return { error: "phase" };
    if (SLOTS.indexOf(slot) < 0 && slot !== "deep") return { error: "slot" };
    if (cardId !== null && !has(run, cardId)) return { error: "card" };
    run.board[slot] = cardId;
    return { ok: true };
  }
  function submit(run) {
    if (run.phase !== "board") return { error: "phase" };
    if (SLOTS.some(function (s) { return !run.board[s]; })) return { error: "empty" };
    var sol = getCase(run.caseId).solution, n = 0;
    SLOTS.forEach(function (s) { if (run.board[s] === sol[s]) n++; });
    run.submits += 1;
    if (n === 4) { run.phase = "accuse"; run.accuseStep = 0; run.trust = START_TRUST; }
    return { correct: n };
  }
  function currentRebuttal(run) {
    if (run.phase !== "accuse") return null;
    return getCase(run.caseId).rebuttals[run.accuseStep] || null;
  }
  function present(run, cardId) {
    var r = currentRebuttal(run);
    if (!r) return { error: "phase" };
    if (has(run, cardId) && r.accepts.indexOf(cardId) >= 0) {
      run.accuseStep += 1;
      if (run.accuseStep >= getCase(run.caseId).rebuttals.length) run.phase = "done";
      return { ok: true, hit: true, reply: r.reply, done: run.phase === "done", reset: false, trust: run.trust };
    }
    run.mispresent += 1; run.trust -= 1;
    if (run.trust <= 0) {
      run.accuseFails += 1; run.trust = START_TRUST; run.accuseStep = 0;
      return { ok: true, hit: false, reply: null, done: false, reset: true, trust: run.trust };
    }
    return { ok: true, hit: false, reply: null, done: false, reset: false, trust: run.trust };
  }
  function rating(run) {
    var pts = 10 - Math.max(0, run.submits - 1) - run.mispresent - 2 * run.accuseFails + (run.hours >= 3 ? 1 : 0);
    return pts >= 10 ? "S" : pts >= 8 ? "A" : pts >= 5 ? "B" : "C";
  }
  function deepOption(def, run) {
    if (!def.deep) return null;
    var id = run.board.deep;
    for (var i = 0; i < def.deep.options.length; i++) if (id && def.deep.options[i].card === id) return def.deep.options[i];
    return { key: "none", card: null, monologue: def.deep.none };
  }
  function finish(save, run) {
    if (run.phase !== "done") return { error: "phase" };
    var def = getCase(run.caseId), entry = save.cases[run.caseId] || (save.cases[run.caseId] = {});
    var r = rating(run), order = "SABC";
    if (!entry.best || order.indexOf(r) < order.indexOf(entry.best)) entry.best = r;
    entry.cleared = true;
    Object.keys(run.identified).forEach(function (e) {
      var c = def.cards[e];
      if (c && c.herb === run.identified[e]) save.herbsSeen[c.herb] = true;
    });
    var monos = [run.caseId + ":main"];
    var opt = deepOption(def, run);
    if (opt) monos.push(run.caseId + ":" + opt.key);
    monos.forEach(function (k) { save.monologues[k] = true; });
    (def.cast || []).forEach(function (c) { save.castSeen[c] = true; });
    var next = CASE_ORDER[CASE_ORDER.indexOf(run.caseId) + 1];
    if (next && save.unlocked.indexOf(next) < 0) save.unlocked.push(next);
    run.result = { rating: r, monologues: monos };
    entry.last = run.result;
    entry.run = null;
    return run.result;
  }


  var api = {
    CASE_ORDER: CASE_ORDER, SLOTS: SLOTS,
    registerCase: registerCase, getCase: getCase, newSave: newSave, normalizeSave: normalizeSave,
    startCase: startCase, cardInfo: cardInfo, spotOpen: spotOpen, move: move, visit: visit, toBoard: toBoard,
    evidenceTags: evidenceTags, candidates: candidates, identify: identify, runTest: runTest, giveRemedy: giveRemedy,
    placeCard: placeCard, submit: submit, currentRebuttal: currentRebuttal, present: present,
    rating: rating, deepOption: deepOption, finish: finish
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCore = api;
})();
