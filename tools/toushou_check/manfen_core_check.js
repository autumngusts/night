// ============================================================================
// toushou 滿分男模式（manfen）的 Node 單元檢查：資料與規則引擎。
// 執行：node tools/toushou_check/manfen_core_check.js
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
// 載入順序與頁面 TOUSHOU_SCRIPTS 相同
var FILES = [
  "toushou_data.js",
  "toushou_data_sengoku.js",
  "toushou_data_celebrity.js",
  "toushou_data_company.js",
  "toushou_data_region.js",
  "toushou_data_food.js",
  "toushou_data_anime.js",
  "toushou_data_culture.js",
  "toushou_data_taiwan.js",
  "toushou_data_ext.js",
  "toushou_data_manfen.js",
  "toushou_core.js",
  "toushou_core_manfen.js"
].filter(function (f) { return fs.existsSync(path.join(SRC, f)); });

var win = {};
FILES.forEach(function (f) { new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win); });
var D = win.PriTestToushouData;
var Core = win.PriTestToushouCore;
var M = win.PriTestToushouManfen;

var results = { pass: 0, fail: 0 };
function check(name, fn) {
  try { fn(); results.pass++; console.log("  ok   " + name); }
  catch (err) { results.fail++; console.log("  FAIL " + name + "\n       " + (err && err.message)); }
}

var MF_IDS = ["mf_man", "mf_woman", "mf_job", "mf_home", "mf_roommate", "mf_travel"];

check("manfen categories registered in order with phrase containing {flaw}", function () {
  assert.deepStrictEqual(D.MANFEN_CATEGORIES.map(function (c) { return c.id; }), MF_IDS);
  D.MANFEN_CATEGORIES.forEach(function (c) {
    assert.ok(c.phrase.zh.indexOf("{flaw}") >= 0 && c.phrase.ja.indexOf("{flaw}") >= 0, c.id);
    assert.ok(c.name.zh && c.name.ja, c.id);
  });
  assert.ok(D.MANFEN_CLASSIC_PHRASE.zh.indexOf("{target}") >= 0 && D.MANFEN_CLASSIC_PHRASE.zh.indexOf("{flaw}") >= 0);
});

check("manfen categories are not mixed into classic CATEGORIES", function () {
  D.CATEGORIES.forEach(function (c) { assert.ok(MF_IDS.indexOf(c.id) < 0, c.id); });
});

check("each manfen category has exactly 40 targets and 32 own flaw cards, bilingual", function () {
  MF_IDS.forEach(function (id) {
    var ts = D.MANFEN_TARGETS.filter(function (t) { return t.category === id; });
    assert.strictEqual(ts.length, 40, id + " targets " + ts.length);
    ts.forEach(function (t) {
      assert.ok(t.name.zh && t.name.ja && t.summary.zh && t.summary.ja, t.id);
      assert.ok(t.tags.length >= 2 && t.tags.length <= 3, t.id);
    });
    var fs2 = D.FLAW_CARDS.filter(function (f) { return f.category === id; });
    assert.strictEqual(fs2.length, 32, id + " flaws " + fs2.length);
    fs2.forEach(function (f) { assert.ok(f.text.zh && f.text.ja, f.id); });
  });
});

check("common flaw cards: exactly 30, category null, bilingual", function () {
  var common = D.FLAW_CARDS.filter(function (f) { return f.category === null; });
  assert.strictEqual(common.length, 30, String(common.length));
  common.forEach(function (f) { assert.ok(f.text.zh && f.text.ja, f.id); });
});

// 只檢查新資料：既有資料的 id 不在本計畫範圍
check("manfen ids are unique and do not collide with classic targets / news cards", function () {
  var classicT = {};
  D.TARGETS.forEach(function (t) { classicT[t.id] = 1; });
  var seen = {};
  D.MANFEN_TARGETS.forEach(function (t) { assert.ok(!seen[t.id] && !classicT[t.id], "dup " + t.id); seen[t.id] = 1; });
  var news = {};
  D.NEWS_CARDS.forEach(function (c) { news[c.id] = 1; });
  seen = {};
  D.FLAW_CARDS.forEach(function (c) { assert.ok(!seen[c.id] && !news[c.id], "dup " + c.id); seen[c.id] = 1; });
});

check("manfen swan deck: 15 events + calm, composition calm 5", function () {
  var ids = D.MANFEN_SWAN_CARDS.map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ["circuit", "hype", "whale", "fomo", "panic", "lull", "exhausted", "rumor",
    "gag", "extra", "reverse", "trial", "cancel", "upset", "bailout", "calm"]);
  assert.deepStrictEqual(D.MANFEN_SWAN_COMPOSITION, { calm: 5 });
  D.MANFEN_SWAN_CARDS.forEach(function (c) { assert.ok(c.name.zh && c.name.ja && c.text.zh && c.text.ja, c.id); });
});

// ---- 規則引擎（Task 3 起） ----
if (M) {
  function game(n, opts) {
    opts = opts || {};
    var players = [];
    for (var i = 0; i < n; i++) players.push({ name: "P" + (i + 1), chips: opts.chips || 1000 });
    var targets = M.pickTargets(opts.mfCats || ["mf_man"], opts.classicCats || [], opts.targets || n, 7);
    return Core.newGame({ mode: "manfen", players: players, targets: targets, minBet: opts.minBet || 100,
      windEnabled: !!opts.wind, blackSwanEnabled: !!opts.swan, seed: opts.seed || 12345 });
  }
  function R(s, a) { return Core.reduce(s, a); }
  function playableCard(s, pid) {
    var p = s.players.filter(function (x) { return x.id === pid; })[0];
    return p.hand.filter(function (id) { return M.flawPlayable(s, id); })[0] || null;
  }
  // 開始本題並由爆料者用自訂缺點爆料；event／wind 可指定（把牌放在牌堆頂＝陣列尾端）
  function exposed(s, opts) {
    opts = opts || {};
    s = R(s, { type: "startBetting" });
    if (opts.event) s.mfSwanDeck.push(opts.event);
    if (opts.wind) s.windDeck.push(opts.wind);
    return R(s, { type: "mfExpose", playerId: s.current.blamerId, cardId: null, edited: false, text: "每天都要跟你報備行程" });
  }
  function sum(o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); }

  check("manfen engine loaded", function () { assert.ok(M); });

  check("newGame manfen: config, hands, blamerOffset, decks only when enabled", function () {
    var s = game(3);
    assert.strictEqual(s.config.mode, "manfen");
    assert.strictEqual(s.phase, "reveal_target");
    assert.strictEqual(s.config.missionsEnabled, false);
    assert.strictEqual(s.config.sectorLinkEnabled, false);
    s.players.forEach(function (p) { assert.strictEqual(p.hand.length, D.HAND_SIZE); });
    assert.ok(s.blamerOffset >= 0 && s.blamerOffset < 3);
    assert.deepStrictEqual(s.windDeck, []);
    assert.deepStrictEqual(s.mfSwanDeck, []);
    var s2 = game(3, { wind: true, swan: true });
    // 牌庫張數由資料的組成表算出，不硬編
    assert.strictEqual(s2.windDeck.length, sum(D.WIND_COMPOSITION));
    var expectSwan = D.MANFEN_SWAN_CARDS.reduce(function (a, c) { return a + (D.MANFEN_SWAN_COMPOSITION[c.id] || 1); }, 0);
    assert.strictEqual(s2.mfSwanDeck.length, expectSwan);
  });

  check("deck pool: common + own-category flaws + classic down-tone news of chosen classic categories", function () {
    var s = game(3, { mfCats: ["mf_man"], classicCats: ["jp_company"], targets: 6 });
    var all = s.deck.concat(s.discard);
    s.players.forEach(function (p) { all = all.concat(p.hand); });
    all.forEach(function (id) {
      var f = D.FLAW_CARDS.filter(function (c) { return c.id === id; })[0];
      if (f) { assert.ok(f.category === null || f.category === "mf_man", id); return; }
      var n = Core.cardById(id);
      assert.ok(n && n.tone === "down" && n.category === "jp_company", id);
    });
  });

  check("classic and insider newGame unaffected (no blamerOffset / mfSwanDeck)", function () {
    var t = Core.pickRandomTargets(["jp_company"], 2, 1);
    var c = Core.newGame({ players: [{ name: "a", chips: 1000 }, { name: "b", chips: 1000 }], targets: t, minBet: 100, seed: 5 });
    assert.strictEqual(c.config.mode, "classic");
    assert.strictEqual(c.blamerOffset, undefined);
    assert.strictEqual(c.mfSwanDeck, undefined);
  });

  check("blamer rotates by seat from blamerOffset", function () {
    var s = game(3, { targets: 3 });
    for (var k = 0; k < 3; k++) assert.strictEqual(M.blamerFor(s, k), s.players[(k + s.blamerOffset) % 3].id);
    s = R(s, { type: "startBetting" });
    assert.strictEqual(s.phase, "mf_expose");
    assert.strictEqual(s.current.blamerId, M.blamerFor(s, 0));
  });

  check("expose: only the blamer, playable rule, text required, card replaced", function () {
    var s = R(game(3), { type: "startBetting" });
    var b = s.current.blamerId;
    var other = s.players.filter(function (p) { return p.id !== b; })[0].id;
    assert.strictEqual(M.exposeError(s, other, null, "x", false), "ts_err_not_your_turn");
    assert.strictEqual(M.exposeError(s, b, null, "  ", false), "ts_err_empty_news");
    var card = playableCard(s, b);
    assert.ok(card, "blamer should hold a playable flaw (common cards are always playable)");
    var s2 = R(s, { type: "mfExpose", playerId: b, cardId: card, edited: false, text: "報備" });
    var me = s2.players.filter(function (p) { return p.id === b; })[0];
    assert.strictEqual(me.hand.length, D.HAND_SIZE);
    assert.ok(s2.discard.indexOf(card) >= 0);
    assert.deepStrictEqual(s2.current.flaw, { cardId: card, edited: false, text: "報備" });
    assert.strictEqual(s2.phase, "mf_rate");
  });

  check("flawPlayable: other manfen category flaw needs edit", function () {
    var s = R(game(2, { mfCats: ["mf_man"] }), { type: "startBetting" });
    var foreign = D.FLAW_CARDS.filter(function (f) { return f.category === "mf_job"; })[0].id;
    assert.strictEqual(M.flawPlayable(s, foreign), false);
    var common = D.FLAW_CARDS.filter(function (f) { return f.category === null; })[0].id;
    assert.strictEqual(M.flawPlayable(s, common), true);
  });

  check("expose draws swan and wind; neutral wind has no holder", function () {
    var s = exposed(game(3, { wind: true, swan: true }), { event: "hype", wind: "up" });
    assert.strictEqual(s.current.event, "hype");
    assert.strictEqual(s.current.windCard, "up");
    assert.ok(s.players.some(function (p) { return p.id === s.current.windHolder; }));
    var s2 = exposed(game(3, { wind: true }), { wind: "neutral" });
    assert.strictEqual(s2.current.windCard, "neutral");
    assert.strictEqual(s2.current.windHolder, null);
    var s3 = exposed(game(3));
    assert.strictEqual(s3.current.event, null);
    assert.strictEqual(s3.current.windCard, null);
  });

  function rateAll(s, fn) {
    M.pendingRaters(s).forEach(function (pid, i) {
      s = R(s, { type: "mfRate", playerId: pid, value: fn ? fn(pid, i, s) : M.allowedRatings(s, pid)[0] });
    });
    return s;
  }

  check("rating: only 0/2/5/10, once per player, seat order pending", function () {
    var s = exposed(game(3));
    assert.deepStrictEqual(M.pendingRaters(s), ["p0", "p1", "p2"]);
    assert.strictEqual(M.rateError(s, "p0", 3), "ts_err_mf_rating");
    s = R(s, { type: "mfRate", playerId: "p1", value: 5 });
    assert.strictEqual(M.rateError(s, "p1", 5), "ts_err_not_your_turn");
    assert.deepStrictEqual(M.pendingRaters(s), ["p0", "p2"]);
    assert.strictEqual(s.phase, "mf_rate");
  });

  check("wind holder rating restricted: up -> 0/2, down -> 5/10; others free", function () {
    var s = exposed(game(3, { wind: true }), { wind: "up" });
    var h = s.current.windHolder;
    assert.deepStrictEqual(M.allowedRatings(s, h), [0, 2]);
    assert.strictEqual(M.rateError(s, h, 5), "ts_err_mf_rating");
    var other = s.players.filter(function (p) { return p.id !== h; })[0].id;
    assert.deepStrictEqual(M.allowedRatings(s, other), [0, 2, 5, 10]);
    var s2 = exposed(game(3, { wind: true }), { wind: "down" });
    assert.deepStrictEqual(M.allowedRatings(s2, s2.current.windHolder), [5, 10]);
  });

  check("all rated -> mf_mind; no forced reveal without event", function () {
    var s = rateAll(exposed(game(3)));
    assert.strictEqual(s.phase, "mf_mind");
    assert.deepStrictEqual(s.current.revealed, {});
  });

  check("trial forces blamer reveal; reverse forces poorest (seat tiebreak)", function () {
    var s = rateAll(exposed(game(3, { swan: true }), { event: "trial" }));
    var rv = {}; rv[s.current.blamerId] = "forced";
    assert.deepStrictEqual(s.current.revealed, rv);
    var g = game(3, { swan: true });
    g.players[2].chips = 300; g.players[1].chips = 300;
    s = rateAll(exposed(g, { event: "reverse" }));
    assert.deepStrictEqual(s.current.revealed, { p1: "forced" });
  });

  check("all players broke at startBetting -> final", function () {
    var s = game(2);
    s.players.forEach(function (p) { p.chips = 0; });
    s = R(s, { type: "startBetting" });
    assert.strictEqual(s.phase, "final");
  });

  // ---- Task 5：心理戰（封口費競價） ----
  function chipsOf(s) { var o = {}; s.players.forEach(function (p) { o[p.id] = p.chips; }); return o; }
  function totalChips(s) {
    var n = s.current ? s.current.mindPot + s.current.pot : 0;
    s.players.forEach(function (p) { n += p.chips; });
    return n;
  }
  function mind(opts) { return rateAll(exposed(game(3, opts), opts)); }

  check("requestMin: half of minBet, quarter with extra", function () {
    assert.strictEqual(M.requestMin(mind()), 50);
    assert.strictEqual(M.requestMin(mind({ swan: true, event: "extra" })), 25);
  });

  check("request validation", function () {
    var s = mind();
    assert.strictEqual(M.requestError(s, "p0", "p0", 50), "ts_err_mf_request_self");
    assert.strictEqual(M.requestError(s, "p0", "p1", 49), "ts_err_mf_offer");
    assert.strictEqual(M.requestError(s, "p0", "p1", 1001), "ts_err_mf_offer");
    assert.strictEqual(M.requestError(s, "p0", "p1", 50.5), "ts_err_int");
    assert.strictEqual(M.requestError(s, "p0", "p1", 50), null);
  });

  check("reveal: requester pays offer into mindPot, target revealed, chips conserved", function () {
    var s = mind();
    var before = totalChips(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 80 });
    assert.strictEqual(M.requestError(s, "p2", "p0", 50), "ts_err_mf_request_pending");
    assert.strictEqual(M.respondError(s, "p0", "reveal"), "ts_err_mf_not_target");
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "reveal" });
    assert.strictEqual(s.current.revealed.p1, "paid");
    assert.strictEqual(s.current.mindPot, 80);
    assert.deepStrictEqual(s.current.mindPaid, { p0: 80 });
    assert.strictEqual(chipsOf(s).p0, 920);
    assert.deepStrictEqual(s.current.requests, [{ from: "p0", to: "p1", offers: [80], outcome: "revealed" }]);
    assert.strictEqual(s.current.pendingRequest, null);
    assert.strictEqual(totalChips(s), before);
    assert.strictEqual(M.requestError(s, "p0", "p2", 50), "ts_err_mf_request_used");
    assert.strictEqual(M.requestError(s, "p2", "p1", 50), "ts_err_mf_request_revealed");
  });

  check("refuse -> raise -> refuse: both pay each round; request closed", function () {
    var s = mind();
    var before = totalChips(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 60 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "refuse" });
    assert.strictEqual(s.current.pendingRequest.awaitingRaise, true);
    assert.strictEqual(s.current.mindPot, 120);
    assert.strictEqual(M.raiseError(s, "p1", 100), "ts_err_mf_not_requester");
    assert.strictEqual(M.raiseError(s, "p0", 60), "ts_err_mf_offer");
    s = R(s, { type: "mfRaise", playerId: "p0", offer: 100 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "refuse" });
    assert.strictEqual(s.current.mindPot, 320);
    assert.deepStrictEqual(s.current.mindPaid, { p0: 160, p1: 160 });
    assert.deepStrictEqual(s.current.requests, [{ from: "p0", to: "p1", offers: [60, 100], outcome: "refused" }]);
    assert.strictEqual(s.current.revealed.p1, undefined);
    assert.strictEqual(totalChips(s), before);
    // mindPaid 的總和必須等於 mindPot
    assert.strictEqual(sum(s.current.mindPaid), s.current.mindPot);
  });

  check("drop after refusal closes as refused; raise then reveal", function () {
    var s = mind();
    var before = totalChips(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 60 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "refuse" });
    s = R(s, { type: "mfDrop", playerId: "p0" });
    assert.strictEqual(s.current.requests[0].outcome, "refused");
    s = R(s, { type: "mfRequest", from: "p1", to: "p2", offer: 50 });
    s = R(s, { type: "mfRespond", playerId: "p2", choice: "refuse" });
    s = R(s, { type: "mfRaise", playerId: "p1", offer: 70 });
    s = R(s, { type: "mfRespond", playerId: "p2", choice: "reveal" });
    assert.strictEqual(s.current.revealed.p2, "paid");
    assert.deepStrictEqual(s.current.requests[1].offers, [50, 70]);
    assert.strictEqual(totalChips(s), before);
    assert.strictEqual(sum(s.current.mindPaid), s.current.mindPot);
  });

  check("target cannot refuse without enough chips", function () {
    var g = game(3);
    g.players[1].chips = 40;
    var s = rateAll(exposed(g));
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 50 });
    assert.strictEqual(M.respondError(s, "p1", "refuse"), "ts_err_mf_refuse_chips");
    assert.strictEqual(M.respondError(s, "p1", "reveal"), null);
  });

  check("end mind: blocked while pending; bettors = players with chips", function () {
    var s = mind();
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 50 });
    assert.throws(function () { R(s, { type: "mfEndMind" }); }, /ts_err_mf_pending_open/);
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "reveal" });
    s.players[2].chips = 0;
    s = R(s, { type: "mfEndMind" });
    assert.strictEqual(s.phase, "bet");
    assert.deepStrictEqual(s.current.bettors, ["p0", "p1"]);
  });
  // ---- Task 6：下注與結算 ----
  // 指定每人評分 → 結束心理戰 → 依 bets 下注（{pid: [amount, predict10]}）
  function playRound(s, ratings, bets, opts) {
    opts = opts || {};
    s = exposed(s, opts);
    s = rateAll(s, function (pid, i, cur) {
      return ratings[pid] !== undefined ? ratings[pid] : M.allowedRatings(cur, pid)[0];
    });
    if (opts.beforeEnd) s = opts.beforeEnd(s);
    s = R(s, { type: "mfEndMind" });
    s.current.bettors.forEach(function (pid) {
      var b = bets[pid] || [100, 50];
      s = R(s, { type: "placeBet", playerId: pid, amount: b[0], predict: b[1] });
    });
    return s;
  }
  // 結算後 current 仍保留（內含 pot），所以只加總玩家籌碼，不能用會把 pot 算進去的 totalChips
  function chipSum(s) { return s.players.reduce(function (n, p) { return n + p.chips; }, 0); }
  var R3 = { p0: 0, p1: 5, p2: 10 };

  check("bet: predict range 0..100, 150 with fomo", function () {
    var s = R(rateAll(exposed(game(3))), { type: "mfEndMind" });
    assert.strictEqual(M.betError(s, "p0", 100, 101), "ts_err_mf_predict_range");
    assert.strictEqual(M.betError(s, "p0", 100, 100), null);
    assert.strictEqual(M.betError(s, "p0", 50, 50), "ts_err_bet_min");
    var f = R(rateAll(exposed(game(3, { swan: true }), { event: "fomo" })), { type: "mfEndMind" });
    assert.strictEqual(M.predictMax(f), 150);
    assert.strictEqual(M.betError(f, "p0", 100, 150), null);
  });

  check("plain average (x10, round half up) and pot split via settleTarget", function () {
    var s = playRound(game(3), R3, { p0: [100, 50], p1: [100, 40], p2: [100, 90] });
    var h = s.lastSettlement;
    assert.strictEqual(s.phase, "settle");
    assert.strictEqual(h.mode, "manfen");
    assert.strictEqual(h.avg10, 50);
    assert.strictEqual(h.finalPrice, 50);
    assert.strictEqual(h.pot, 300);
    assert.deepStrictEqual(h.ranks, { p0: 1, p1: 2, p2: 3 });
    assert.deepStrictEqual(h.payouts, { p0: 210, p1: 90, p2: 0 });
    assert.strictEqual(playRound(game(3), { p0: 0, p1: 2, p2: 2 }, {}).lastSettlement.avg10, 13);
    assert.strictEqual(playRound(game(2), { p0: 2, p1: 5 }, {}).lastSettlement.avg10, 35);
    assert.strictEqual(playRound(game(4), { p0: 0, p1: 5, p2: 10, p3: 10 }, {}).lastSettlement.avg10, 63);
  });

  check("wind holder counts 2 votes; hype and whale stack +1 each", function () {
    var s = exposed(game(3, { wind: true }), { wind: "down" });
    var h = s.current.windHolder;
    var ratings = {}; s.players.forEach(function (p) { ratings[p.id] = p.id === h ? 10 : 0; });
    s = rateAll(s, function (pid) { return ratings[pid]; });
    s = R(s, { type: "mfEndMind" });
    s.current.bettors.forEach(function (pid) { s = R(s, { type: "placeBet", playerId: pid, amount: 100, predict: 50 }); });
    assert.strictEqual(s.lastSettlement.avg10, 50);
    var row = s.lastSettlement.tally.filter(function (r) { return r.playerId === h; })[0];
    assert.strictEqual(row.weight, 2);
  });

  check("hype: blamer +1 vote; whale: top bettor(s) +1", function () {
    var s = playRound(game(3, { swan: true }), R3, {}, { event: "hype" });
    var b = s.lastSettlement.blamerId;
    s.lastSettlement.tally.forEach(function (r) { assert.strictEqual(r.weight, r.playerId === b ? 2 : 1); });
    s = playRound(game(3, { swan: true }), R3, { p0: [100, 0], p1: [100, 0], p2: [300, 0] }, { event: "whale" });
    assert.strictEqual(s.lastSettlement.avg10, 63);
  });

  check("fomo / panic / lull change vote values", function () {
    assert.strictEqual(playRound(game(3, { swan: true }), R3, {}, { event: "fomo" }).lastSettlement.avg10, 67);
    assert.strictEqual(playRound(game(3, { swan: true }), { p0: 2, p1: 2, p2: 5 }, {}, { event: "panic" }).lastSettlement.avg10, 50);
    assert.strictEqual(playRound(game(3, { swan: true }), R3, {}, { event: "lull" }).lastSettlement.avg10, 25);
  });

  check("circuit removes one highest and one lowest (needs >= 3 votes)", function () {
    var s = playRound(game(4, { swan: true }), { p0: 0, p1: 2, p2: 5, p3: 10 }, {}, { event: "circuit" });
    assert.strictEqual(s.lastSettlement.avg10, 35);
    var removed = s.lastSettlement.tally.filter(function (r) { return r.removed; }).map(function (r) { return r.playerId; });
    assert.deepStrictEqual(removed, ["p0", "p3"]);
    var same = playRound(game(3, { swan: true }), { p0: 5, p1: 5, p2: 5 }, {}, { event: "circuit" });
    assert.strictEqual(same.lastSettlement.avg10, 50);
    assert.strictEqual(same.lastSettlement.tally.filter(function (r) { return r.removed; }).length, 2);
    var two = playRound(game(2, { swan: true }), { p0: 0, p1: 10 }, {}, { event: "circuit" });
    assert.strictEqual(two.lastSettlement.avg10, 50);
  });

  check("exhausted uses weighted median", function () {
    assert.strictEqual(playRound(game(3, { swan: true }), { p0: 0, p1: 2, p2: 10 }, {}, { event: "exhausted" }).lastSettlement.avg10, 20);
    var s = playRound(game(4, { swan: true }), { p0: 0, p1: 2, p2: 5, p3: 10 }, {}, { event: "exhausted" });
    assert.strictEqual(s.lastSettlement.avg10, 35);
    assert.strictEqual(s.lastSettlement.median, true);
  });

  check("rumor voids exactly one vote, deterministic for same seed", function () {
    var a = playRound(game(3, { swan: true }), R3, {}, { event: "rumor" });
    var b = playRound(game(3, { swan: true }), R3, {}, { event: "rumor" });
    var va = a.lastSettlement.tally.filter(function (r) { return r.voided; });
    assert.strictEqual(va.length, 1);
    assert.deepStrictEqual(a.lastSettlement, b.lastSettlement);
  });

  check("mindPot joins the pot; chips conserved through settle", function () {
    var s = playRound(game(3), R3, { p0: [100, 50], p1: [100, 40], p2: [100, 90] }, { beforeEnd: function (x) {
      x = R(x, { type: "mfRequest", from: "p2", to: "p0", offer: 60 });
      x = R(x, { type: "mfRespond", playerId: "p0", choice: "refuse" });
      return R(x, { type: "mfDrop", playerId: "p2" });
    } });
    assert.strictEqual(s.lastSettlement.pot, 300 + 120);
    assert.strictEqual(chipSum(s), 3000);
  });

  check("cancel refunds bets and mind payments when avg in 45..55", function () {
    var s = playRound(game(3, { swan: true }), R3, { p0: [100, 0] }, { event: "cancel", beforeEnd: function (x) {
      x = R(x, { type: "mfRequest", from: "p1", to: "p2", offer: 50 });
      return R(x, { type: "mfRespond", playerId: "p2", choice: "reveal" });
    } });
    var h = s.lastSettlement;
    assert.strictEqual(h.cancelled, true);
    assert.deepStrictEqual(h.ranks, {});
    s.players.forEach(function (p) { assert.strictEqual(p.chips, 1000); });
  });

  check("upset pays the worst predictor; bailout adds 50% (incl. mindPot)", function () {
    var u = playRound(game(3, { swan: true }), R3, { p0: [100, 50], p1: [100, 40], p2: [100, 90] }, { event: "upset" });
    assert.strictEqual(u.lastSettlement.ranks.p2, 1);
    assert.strictEqual(chipSum(u), 3000);
    var b = playRound(game(3, { swan: true }), R3, {}, { event: "bailout" });
    assert.strictEqual(b.lastSettlement.bonus, 150);
    assert.strictEqual(b.lastSettlement.pot, 450);
    // 紓困加碼來自銀行，總籌碼會多出 bonus
    assert.strictEqual(chipSum(b), 3000 + 150);
  });

  check("no bettors: mind payments refunded, nobody ranked", function () {
    var s = exposed(game(2));
    s = rateAll(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 50 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "reveal" });
    // p0 已付 50（mindPaid.p0 = 50）；之後全員籌碼歸零 → 沒有人能下注，退款後 p0 回到 50
    s.players.forEach(function (p) { p.chips = 0; });
    s = R(s, { type: "mfEndMind" });
    assert.strictEqual(s.phase, "settle");
    assert.strictEqual(s.lastSettlement.refundMind, true);
    assert.deepStrictEqual(s.lastSettlement.ranks, {});
    assert.strictEqual(s.players[0].chips, 50);
    assert.strictEqual(s.players[1].chips, 0);
  });

  check("chips conserved on every path without bonus", function () {
    ["calm", "hype", "fomo", "lull", "circuit", "exhausted", "rumor", "cancel", "upset", "whale"].forEach(function (ev) {
      var s = playRound(game(3, { swan: true }), R3, { p0: [100, 50], p1: [200, 20], p2: [100, 90] }, { event: ev === "calm" ? undefined : ev });
      assert.strictEqual(chipSum(s), 3000, ev);
    });
  });

  check("full game: 3 players x 3 subjects, rotation, then final; deterministic", function () {
    function run() {
      var s = game(3, { wind: true, swan: true, targets: 3 });
      for (var k = 0; k < 3; k++) {
        assert.strictEqual(s.phase, "reveal_target");
        s = playRound(s, {}, {});
        assert.strictEqual(s.lastSettlement.blamerId, M.blamerFor(s, k));
        s = R(s, { type: "nextTarget" });
      }
      return s;
    }
    var a = run();
    assert.strictEqual(a.phase, "final");
    assert.strictEqual(a.history.length, 3);
    assert.deepStrictEqual(Core.evaluateMissions(a), []);
    assert.strictEqual(Core.finalStandings(a).length, 3);
    assert.deepStrictEqual(run(), a);
  });
}

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
