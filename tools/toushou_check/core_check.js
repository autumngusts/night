// ============================================================================
// toushou（東正小遊戲）資料與規則引擎的 Node 單元檢查。
// 不需要瀏覽器：用 new Function 在假的 window 上載入 static_src 的檔案。
// 刻意不用 vm.createContext：不同 realm 的物件 prototype 不同，assert.deepStrictEqual 會誤判。
// 執行：node tools/toushou_check/core_check.js
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
// 載入順序與頁面相同：共用資料 → 各類別資料 → 引擎
var DATA_FILES = [
  "toushou_data.js",
  "toushou_data_sengoku.js",
  "toushou_data_celebrity.js",
  "toushou_data_company.js",
  "toushou_data_region.js",
  "toushou_data_food.js",
  "toushou_data_anime.js"
];

function load(files) {
  var win = {};
  files.forEach(function (f) {
    new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win);
  });
  return win;
}

var results = { pass: 0, fail: 0 };
function check(name, fn) {
  try {
    fn();
    results.pass++;
    console.log("  ok   " + name);
  } catch (err) {
    results.fail++;
    console.log("  FAIL " + name + "\n       " + (err && err.message));
  }
}

var hasCore = fs.existsSync(path.join(SRC, "toushou_core.js"));
var w = load(hasCore ? DATA_FILES.concat(["toushou_core.js"]) : DATA_FILES);
var D = w.PriTestToushouData;
var Core = w.PriTestToushouCore;

var CATEGORY_IDS = ["sengoku_event", "sengoku_person", "jp_celebrity", "jp_company",
  "hokkaido", "tohoku", "kansai", "washoku", "yoshoku", "taiwan_food", "anime_game"];
var ROLES_ZH = {
  sengoku_event: "說書人", sengoku_person: "說書人", jp_celebrity: "經紀人", jp_company: "股東",
  hokkaido: "地產商", tohoku: "地產商", kansai: "地產商",
  washoku: "美食評論家", yoshoku: "美食評論家", taiwan_food: "美食評論家", anime_game: "黃牛"
};
function bilingual(o, label) { assert.ok(o && o.zh && o.ja, label + " missing zh/ja"); }

console.log("[data]");
check("data module loaded", function () { assert.ok(D, "PriTestToushouData missing"); });
check("11 categories in load order with role names", function () {
  assert.deepStrictEqual(D.CATEGORIES.map(function (c) { return c.id; }), CATEGORY_IDS);
  D.CATEGORIES.forEach(function (c) {
    bilingual(c.name, c.id);
    bilingual(c.role, c.id);
    assert.strictEqual(c.role.zh, ROLES_ZH[c.id], c.id);
  });
});
check("each category: 6 targets with summary, 2-3 tags, 3 hooks; ids unique", function () {
  var ids = {};
  CATEGORY_IDS.forEach(function (cid) {
    var list = D.TARGETS.filter(function (t) { return t.category === cid; });
    assert.strictEqual(list.length, 6, cid + " has " + list.length);
  });
  D.TARGETS.forEach(function (t) {
    assert.ok(!ids[t.id], "dup " + t.id); ids[t.id] = 1;
    bilingual(t.name, t.id);
    bilingual(t.summary, t.id);
    assert.ok(t.tags.length >= 2 && t.tags.length <= 3, t.id + " tags");
    assert.strictEqual(t.hooks.length, 3, t.id + " hooks");
    t.tags.concat(t.hooks).forEach(function (x) { bilingual(x, t.id); });
  });
});
check("12 common cards + 6 per category, valid tone, unique ids", function () {
  var ids = {};
  assert.strictEqual(D.NEWS_CARDS.filter(function (c) { return c.category === null; }).length, 12);
  CATEGORY_IDS.forEach(function (cid) {
    assert.strictEqual(D.NEWS_CARDS.filter(function (c) { return c.category === cid; }).length, 6, cid);
  });
  D.NEWS_CARDS.forEach(function (c) {
    assert.ok(!ids[c.id], "dup " + c.id); ids[c.id] = 1;
    assert.ok(["up", "down", "neutral"].indexOf(c.tone) >= 0, c.id);
    bilingual(c.text, c.id);
  });
});
check("{target} placeholder appears in both languages or neither", function () {
  D.NEWS_CARDS.forEach(function (c) {
    assert.strictEqual(c.text.zh.indexOf("{target}") >= 0, c.text.ja.indexOf("{target}") >= 0, c.id);
  });
});
check("celebrity excludes scandal card g05 only", function () {
  D.CATEGORIES.forEach(function (c) {
    assert.deepStrictEqual(c.excludeCommonCards, c.id === "jp_celebrity" ? ["g05"] : [], c.id);
  });
});
check("8 missions with known checks", function () {
  var known = ["firstPlaceAtLeast", "exactHit", "categoryRiseAtLeast", "anyTargetCrash",
    "finalRank", "allInOnce", "contrarian", "ownNewsSwing"];
  assert.strictEqual(D.MISSIONS.length, 8);
  D.MISSIONS.forEach(function (m) {
    assert.ok(known.indexOf(m.check) >= 0, m.id);
    assert.ok(m.reward > 0, m.id);
    bilingual(m.text, m.id);
  });
});
check("constants", function () {
  assert.strictEqual(D.HAND_SIZE, 5);
  assert.strictEqual(D.START_PRICE, 100);
  assert.deepStrictEqual(D.WIND_COMPOSITION, { up: 2, down: 2, neutral: 1 });
});
check("text() picks zh for zh, ja otherwise", function () {
  var o = { ja: "J", zh: "Z" };
  assert.strictEqual(D.text(o, "zh"), "Z");
  assert.strictEqual(D.text(o, "ja"), "J");
  assert.strictEqual(D.text(o, "en"), "J");
  assert.strictEqual(D.text({ ja: "", zh: "Z" }, "ja"), "Z");
  assert.strictEqual(D.text("plain", "ja"), "plain");
});

if (!Core) {
  check("core loaded", function () { assert.ok(Core, "PriTestToushouCore missing"); });
} else {

console.log("[core: newGame]");
function baseConfig(n, extra) {
  var players = [];
  for (var i = 0; i < n; i++) players.push({ name: "P" + i, chips: 1000 });
  var cfg = {
    players: players,
    targets: Core.pickRandomTargets(["sengoku_event", "jp_company"], 3, 42),
    missionsEnabled: false, windEnabled: false, minBet: 100, seed: 12345
  };
  Object.keys(extra || {}).forEach(function (k) { cfg[k] = extra[k]; });
  return cfg;
}
function player(s, id) { return s.players.filter(function (p) { return p.id === id; })[0]; }

check("pickRandomTargets: unique, from chosen categories, deterministic, keeps summary/hooks", function () {
  var a = Core.pickRandomTargets(["sengoku_event", "anime_game"], 5, 7);
  var b = Core.pickRandomTargets(["sengoku_event", "anime_game"], 5, 7);
  assert.strictEqual(a.length, 5);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(new Set(a.map(function (t) { return t.sourceId; })).size, 5);
  a.forEach(function (t) {
    assert.ok(t.category === "sengoku_event" || t.category === "anime_game");
    assert.ok(t.summary.zh && t.hooks.length === 3);
    assert.strictEqual(t.custom, false);
  });
  assert.strictEqual(Core.pickRandomTargets(["sengoku_event"], 99, 1).length, 6);
});
check("newGame: players, hands of 5, phase reveal_target without missions", function () {
  var s = Core.newGame(baseConfig(3));
  assert.strictEqual(s.version, 1);
  assert.strictEqual(s.phase, "reveal_target");
  assert.strictEqual(s.players.length, 3);
  s.players.forEach(function (p, i) {
    assert.strictEqual(p.id, "p" + i);
    assert.strictEqual(p.chips, 1000);
    assert.strictEqual(p.hand.length, 5);
    assert.strictEqual(p.mission, null);
  });
  assert.strictEqual(s.targets.length, 3);
  assert.strictEqual(s.targets[0].id, "t0");
  assert.ok(s.targets[0].summary);
  assert.strictEqual(s.targetIndex, 0);
  assert.strictEqual(s.current, null);
  assert.deepStrictEqual(s.history, []);
});
check("newGame: deck = common + present categories' cards, copied to cover 10 players", function () {
  var s = Core.newGame(baseConfig(10));
  s.players.forEach(function (p) { assert.strictEqual(p.hand.length, 5); });
  var cats = {};
  s.targets.forEach(function (t) { cats[t.category] = 1; });
  var pool = D.NEWS_CARDS.filter(function (c) { return c.category === null || cats[c.category]; });
  var k = Math.max(1, Math.ceil(60 / pool.length));
  var all = s.deck.concat.apply(s.deck, s.players.map(function (p) { return p.hand; }));
  assert.strictEqual(all.length, pool.length * k);
  all.forEach(function (id) {
    assert.ok(pool.some(function (c) { return c.id === id; }), "unexpected card " + id);
  });
});
check("newGame: missions phase, unique missions, category resolved from targets", function () {
  var s = Core.newGame(baseConfig(4, { missionsEnabled: true }));
  assert.strictEqual(s.phase, "missions");
  assert.strictEqual(new Set(s.players.map(function (p) { return p.mission.id; })).size, 4);
  var cats = s.targets.map(function (t) { return t.category; });
  s.players.forEach(function (p) {
    if (p.mission.id === "m_catrise") assert.ok(cats.indexOf(p.mission.params.category) >= 0);
  });
});
check("newGame: deterministic for same seed", function () {
  assert.deepStrictEqual(Core.newGame(baseConfig(4)), Core.newGame(baseConfig(4)));
});
check("newGame: string names and tags accepted", function () {
  var cfg = baseConfig(2);
  cfg.targets = [{ category: "washoku", name: "我家的味噌湯", tags: ["家常", "暖心"], custom: true }];
  var s = Core.newGame(cfg);
  assert.strictEqual(s.targets[0].name, "我家的味噌湯");
  assert.strictEqual(s.targets[0].custom, true);
});
check("defaultMinBet and roleFor", function () {
  assert.strictEqual(Core.defaultMinBet("same", 1000), 100);
  assert.strictEqual(Core.defaultMinBet("same", 5), 1);
  assert.strictEqual(Core.defaultMinBet("each", 1000), 100);
  assert.strictEqual(Core.roleFor("anime_game").zh, "黃牛");
  assert.strictEqual(Core.roleFor("jp_company").zh, "股東");
});

console.log("[core: bet]");
function started(n, extra) {
  var s = Core.newGame(baseConfig(n, extra));
  if (s.phase === "missions") {
    s.players.forEach(function (p) { s = Core.reduce(s, { type: "missionSeen", playerId: p.id }); });
  }
  return Core.reduce(s, { type: "startBetting" });
}
check("missionSeen per player (any order); all seen -> reveal_target", function () {
  var s = Core.newGame(baseConfig(3, { missionsEnabled: true }));
  assert.deepStrictEqual(Core.pendingMissionViewers(s), ["p0", "p1", "p2"]);
  s = Core.reduce(s, { type: "missionSeen", playerId: "p2" });
  assert.strictEqual(s.phase, "missions");
  assert.deepStrictEqual(Core.pendingMissionViewers(s), ["p0", "p1"]);
  assert.throws(function () { Core.reduce(s, { type: "missionSeen", playerId: "p2" }); }, /ts_err_not_your_turn/);
  s = Core.reduce(s, { type: "missionSeen", playerId: "p0" });
  s = Core.reduce(s, { type: "missionSeen", playerId: "p1" });
  assert.strictEqual(s.phase, "reveal_target");
  assert.deepStrictEqual(Core.pendingMissionViewers(s), []);
  assert.throws(function () { Core.reduce(s, { type: "missionsDone" }); }, /ts_err_phase/);
});
check("reduce does not mutate input; wrong phase throws", function () {
  var s = Core.newGame(baseConfig(2));
  var snap = JSON.stringify(s);
  Core.reduce(s, { type: "startBetting" });
  assert.strictEqual(JSON.stringify(s), snap);
  assert.throws(function () { Core.reduce(s, { type: "applyDelta", delta: 1 }); }, /ts_err_phase/);
});
check("startBetting: price 100, all players bettors, pot 0", function () {
  var s = started(3);
  assert.strictEqual(s.phase, "bet");
  assert.strictEqual(s.current.price, 100);
  assert.deepStrictEqual(s.current.bettors, ["p0", "p1", "p2"]);
  assert.strictEqual(s.current.pot, 0);
  assert.strictEqual(Core.nextBettor(s), "p0");
});
check("betError validations", function () {
  var s = started(2);
  assert.strictEqual(Core.betError(s, "p1", 100, 100), null, "bets are not ordered");
  assert.strictEqual(Core.betError(s, "p9", 100, 100), "ts_err_not_your_turn");
  assert.strictEqual(Core.betError(s, "p0", 50, 100), "ts_err_bet_min");
  assert.strictEqual(Core.betError(s, "p0", 1001, 100), "ts_err_bet_max");
  assert.strictEqual(Core.betError(s, "p0", 100.5, 100), "ts_err_int");
  assert.strictEqual(Core.betError(s, "p0", 100, -1), "ts_err_predict");
  assert.strictEqual(Core.betError(s, "p0", 100, 1.5), "ts_err_predict");
  assert.strictEqual(Core.betError(s, "p0", 100, 0), null);
});
check("placeBet deducts chips, fills pot, advances bettor", function () {
  var s = started(2);
  s = Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 300, predict: 120 });
  assert.strictEqual(s.players[0].chips, 700);
  assert.strictEqual(s.current.pot, 300);
  assert.deepStrictEqual(s.current.bets.p0, { amount: 300, predict: 120, chipsBefore: 1000 });
  assert.strictEqual(Core.nextBettor(s), "p1");
  assert.deepStrictEqual(Core.pendingBettors(s), ["p1"]);
  assert.throws(function () { Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 100, predict: 1 }); }, /ts_err_not_your_turn/);
});
check("bets in any order give the same result as seat order", function () {
  var a = started(3), b = started(3);
  ["p0", "p1", "p2"].forEach(function (id, i) { a = Core.reduce(a, { type: "placeBet", playerId: id, amount: 100 + i, predict: 90 + i }); });
  ["p2", "p0", "p1"].forEach(function (id) {
    var i = Number(id.slice(1));
    b = Core.reduce(b, { type: "placeBet", playerId: id, amount: 100 + i, predict: 90 + i });
  });
  assert.strictEqual(a.phase, "news");
  assert.deepStrictEqual(a.current.bets, b.current.bets);
  assert.deepStrictEqual(a.current.order, b.current.order);
});
check("all bets placed -> news phase", function () {
  var s = started(2);
  s = Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 100, predict: 100 });
  s = Core.reduce(s, { type: "placeBet", playerId: "p1", amount: 100, predict: 100 });
  assert.strictEqual(s.phase, "news");
});
check("poor player may go all-in below minBet; broke player skipped", function () {
  var s = Core.newGame(baseConfig(3));
  s.players[1].chips = 40;
  s.players[2].chips = 0;
  s = Core.reduce(s, { type: "startBetting" });
  assert.deepStrictEqual(s.current.bettors, ["p0", "p1"]);
  assert.strictEqual(Core.betError(s, "p2", 0, 100), "ts_err_not_your_turn");
  s = Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 100, predict: 100 });
  assert.strictEqual(Core.betError(s, "p1", 30, 100), "ts_err_bet_min");
  assert.strictEqual(Core.betError(s, "p1", 40, 100), null);
});
check("everyone broke -> final", function () {
  var s = Core.newGame(baseConfig(2));
  s.players[0].chips = 0; s.players[1].chips = 0;
  s = Core.reduce(s, { type: "startBetting" });
  assert.strictEqual(s.phase, "final");
});

console.log("[core: news]");
function toNews(n, extra) {
  var s = started(n, extra);
  s.players.forEach(function (p) {
    s = Core.reduce(s, { type: "placeBet", playerId: p.id, amount: 100, predict: 100 });
  });
  return s;
}
function release(s, text) {
  return Core.reduce(s, { type: "releaseNews", playerId: Core.currentShareholder(s), cardId: null, edited: false, text: text || "n" });
}
check("each player is shareholder exactly once, order is a permutation", function () {
  var s = toNews(4);
  assert.deepStrictEqual(s.current.order.slice().sort(), ["p0", "p1", "p2", "p3"]);
  assert.strictEqual(Core.currentShareholder(s), s.current.order[0]);
});
check("newsError validations", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  var other = sh === "p0" ? "p1" : "p0";
  assert.strictEqual(Core.newsError(s, other, null, "x", false), "ts_err_not_your_turn");
  assert.strictEqual(Core.newsError(s, sh, null, "   ", false), "ts_err_empty_news");
  assert.strictEqual(Core.newsError(s, sh, "zzz", "x", true), "ts_err_card");
  assert.strictEqual(Core.newsError(s, sh, null, "大消息", false), null);
});
check("cardPlayable: common / same category ok, other category and excluded need edit", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  var cat = s.targets[0].category;
  var other = cat === "jp_company" ? "se_n1" : "jp_n1";
  var same = cat === "jp_company" ? "jp_n1" : "se_n1";
  player(s, sh).hand = ["g01", same, other, "g05", "g02"];
  assert.strictEqual(Core.cardPlayable(s, "g01"), true);
  assert.strictEqual(Core.cardPlayable(s, same), true);
  assert.strictEqual(Core.cardPlayable(s, other), false);
  assert.strictEqual(Core.newsError(s, sh, other, "x", false), "ts_err_card_mismatch");
  assert.strictEqual(Core.newsError(s, sh, other, "改寫成別的", true), null);
  assert.strictEqual(Core.cardPlayable(s, "g05"), true);
  s.targets[0].category = "jp_celebrity";
  assert.strictEqual(Core.cardPlayable(s, "g05"), false);
  assert.strictEqual(Core.newsError(s, sh, "g05", "x", false), "ts_err_card_mismatch");
});
check("playing a card (edited) discards and refills to 5; custom keeps hand", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  var card = player(s, sh).hand[0];
  var deckBefore = s.deck.length;
  s = Core.reduce(s, { type: "releaseNews", playerId: sh, cardId: card, edited: true, text: "改寫後" });
  assert.strictEqual(s.phase, "vote");
  assert.strictEqual(player(s, sh).hand.length, 5);
  assert.strictEqual(s.deck.length, deckBefore - 1);
  assert.ok(s.discard.indexOf(card) >= 0);
  assert.deepStrictEqual(s.current.pending, { playerId: sh, cardId: card, edited: true, text: "改寫後" });
  s = Core.reduce(s, { type: "applyDelta", delta: 15 });
  var sh2 = Core.currentShareholder(s);
  var handBefore = JSON.stringify(player(s, sh2).hand);
  s = release(s, "純自訂");
  assert.strictEqual(JSON.stringify(player(s, sh2).hand), handBefore);
});
check("applyDelta updates price (floor 0) and accumulates target news", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  s = release(s, "A");
  s = Core.reduce(s, { type: "applyDelta", delta: -130 });
  assert.strictEqual(s.current.price, 0);
  assert.strictEqual(s.current.news.length, 1);
  assert.deepStrictEqual(s.current.news[0],
    { playerId: sh, cardId: null, edited: false, text: "A", wind: null, delta: -130, priceAfter: 0 });
  assert.strictEqual(s.phase, "news");
  assert.strictEqual(s.current.turnIndex, 1);
});
check("price can exceed 100", function () {
  var s = toNews(2);
  s = release(s);
  s = Core.reduce(s, { type: "applyDelta", delta: 80 });
  assert.strictEqual(s.current.price, 180);
});
check("after last shareholder -> settle", function () {
  var s = toNews(2);
  for (var i = 0; i < 2; i++) {
    s = release(s);
    s = Core.reduce(s, { type: "applyDelta", delta: 10 });
  }
  assert.strictEqual(s.phase, "settle");
});
check("delta must be integer", function () {
  var s = release(toNews(2));
  assert.strictEqual(Core.deltaError(s, 1.5), "ts_err_int");
  assert.throws(function () { Core.reduce(s, { type: "applyDelta", delta: 1.5 }); }, /ts_err_int/);
});
check("wind cards: drawn per turn, sign enforced, recorded", function () {
  var s = toNews(5, { windEnabled: true });
  var seen = {};
  for (var i = 0; i < 5; i++) {
    var wd = s.current.wind;
    assert.ok(["up", "down", "neutral"].indexOf(wd) >= 0);
    seen[wd] = (seen[wd] || 0) + 1;
    s = release(s);
    if (wd === "up") { assert.strictEqual(Core.deltaError(s, -1), "ts_err_wind_up"); s = Core.reduce(s, { type: "applyDelta", delta: 5 }); }
    else if (wd === "down") { assert.strictEqual(Core.deltaError(s, 1), "ts_err_wind_down"); s = Core.reduce(s, { type: "applyDelta", delta: -5 }); }
    else { assert.strictEqual(Core.deltaError(s, -7), null); s = Core.reduce(s, { type: "applyDelta", delta: 0 }); }
    assert.strictEqual(s.current ? s.current.news[i].wind : s.lastSettlement.news[i].wind, wd);
  }
  // 5 張風向卡剛好用完一副：2/2/1
  assert.deepStrictEqual(seen, { up: 2, down: 2, neutral: 1 });
});

console.log("[core: vote]");
function toVote(n, extra) {
  return release(toNews(n, Object.assign({ deltaMode: "vote" }, extra || {})));
}
check("config: deltaMode/voteCap defaults; old state without deltaMode is host", function () {
  var s = Core.newGame(baseConfig(2));
  assert.strictEqual(s.config.deltaMode, "host");
  assert.strictEqual(s.config.voteCap, 100);
  s = Core.newGame(baseConfig(2, { deltaMode: "vote", voteCap: 30 }));
  assert.strictEqual(s.config.deltaMode, "vote");
  assert.strictEqual(s.config.voteCap, 30);
  var old = release(toNews(2));
  delete old.config.deltaMode;
  old = Core.reduce(old, { type: "applyDelta", delta: 5 });
  assert.strictEqual(old.current.news[0].delta, 5);
});
check("tallyVotes: average rounded half away from zero, wind zeroing", function () {
  function d(list, wind) {
    var v = {};
    list.forEach(function (x, i) { v["p" + i] = x; });
    return Core.tallyVotes(v, wind || null);
  }
  assert.strictEqual(d([2, 3]).delta, 3);
  assert.strictEqual(d([-2, -3]).delta, -3);
  assert.strictEqual(d([10, -5, 0]).delta, 2);
  assert.strictEqual(d([1, 1, 0]).delta, 1);
  assert.strictEqual(d([1, 0, 0]).delta, 0);
  assert.strictEqual(d([2, 3]).avg, 2.5);
  var z = d([-10, -20], "up");
  assert.strictEqual(z.delta, 0);
  assert.strictEqual(z.windZeroed, true);
  assert.strictEqual(d([10, 20], "down").delta, 0);
  assert.strictEqual(d([-10, -20], "down").delta, -15);
  assert.strictEqual(d([-10, -20], "neutral").delta, -15);
  assert.strictEqual(d([5], "up").windZeroed, false);
});
check("castVote: validations and mode guard", function () {
  var s = toVote(3, { voteCap: 50 });
  assert.strictEqual(Core.voteError(s, "p0", 50), null);
  assert.strictEqual(Core.voteError(s, "p0", -50), null);
  assert.strictEqual(Core.voteError(s, "p0", 51), "ts_err_vote_range");
  assert.strictEqual(Core.voteError(s, "p0", 1.5), "ts_err_int");
  assert.strictEqual(Core.voteError(s, "zz", 1), "ts_err_not_your_turn");
  s = Core.reduce(s, { type: "castVote", playerId: "p0", value: 10 });
  assert.strictEqual(Core.voteError(s, "p0", 1), "ts_err_already_voted");
  assert.throws(function () { Core.reduce(s, { type: "castVote", playerId: "p0", value: 1 }); }, /ts_err_already_voted/);
  assert.throws(function () { Core.reduce(s, { type: "applyDelta", delta: 1 }); }, /ts_err_vote_mode/);
  var h = release(toNews(3));
  assert.throws(function () { Core.reduce(h, { type: "castVote", playerId: "p0", value: 1 }); }, /ts_err_vote_mode/);
  assert.throws(function () { Core.reduce(h, { type: "skipPendingVoters" }); }, /ts_err_vote_mode/);
});
check("all votes in (any order, shareholder included) -> applied and recorded", function () {
  var s = toVote(3);
  var sh = Core.currentShareholder(s);
  assert.deepStrictEqual(Core.pendingVoters(s), ["p0", "p1", "p2"]);
  s = Core.reduce(s, { type: "castVote", playerId: "p2", value: 30 });
  s = Core.reduce(s, { type: "castVote", playerId: sh === "p2" ? "p1" : sh, value: -10 });
  assert.strictEqual(s.phase, "vote");
  assert.strictEqual(Core.pendingVoters(s).length, 1);
  s = Core.reduce(s, { type: "castVote", playerId: Core.pendingVoters(s)[0], value: 0 });
  assert.strictEqual(s.phase, "news");
  var n = s.current.news[0];
  assert.strictEqual(n.delta, 7);
  assert.strictEqual(n.priceAfter, 107);
  assert.strictEqual(n.playerId, sh);
  assert.strictEqual(Object.keys(n.votes).length, 3);
  assert.strictEqual(n.windZeroed, false);
  assert.deepStrictEqual(s.current.votes, {});
});
check("skipPendingVoters needs at least one vote; tallies existing votes", function () {
  var s = toVote(3);
  assert.throws(function () { Core.reduce(s, { type: "skipPendingVoters" }); }, /ts_err_no_votes/);
  s = Core.reduce(s, { type: "castVote", playerId: "p1", value: -25 });
  s = Core.reduce(s, { type: "skipPendingVoters" });
  assert.strictEqual(s.current.news[0].delta, -25);
  assert.deepStrictEqual(Object.keys(s.current.news[0].votes), ["p1"]);
});
check("vote mode plays a full target to settle; wind zeroing recorded", function () {
  var s = toNews(2, { deltaMode: "vote", windEnabled: true });
  for (var k = 0; k < 2; k++) {
    s = release(s);
    var wind = s.current.wind;
    var v = wind === "up" ? -40 : 40;
    s = Core.reduce(s, { type: "castVote", playerId: "p0", value: v });
    s = Core.reduce(s, { type: "castVote", playerId: "p1", value: v });
    var n = s.phase === "settle" ? s.history[0].news[k] : s.current.news[k];
    assert.strictEqual(n.windZeroed, wind === "up" || wind === "down" ? (wind === "up") === (v < 0) : false);
  }
  assert.strictEqual(s.phase, "settle");
});

console.log("[core: settle]");
var SEAT = ["p0", "p1", "p2", "p3", "p4"];
function bets(list) {
  var o = {};
  list.forEach(function (b, i) { if (b) o["p" + i] = { amount: b[0], predict: b[1] }; });
  return o;
}
function sumValues(o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); }
check("n=1: own stake back", function () {
  assert.strictEqual(Core.settleTarget(bets([[200, 50]]), 130, SEAT).payouts.p0, 200);
});
check("n=2: winner takes all", function () {
  var r = Core.settleTarget(bets([[100, 120], [300, 90]]), 118, SEAT);
  assert.deepStrictEqual(r.payouts, { p0: 400, p1: 0 });
  assert.deepStrictEqual(r.ranks, { p0: 1, p1: 2 });
});
check("n=3: 70/30", function () {
  var r = Core.settleTarget(bets([[100, 100], [100, 110], [100, 200]]), 112, SEAT);
  assert.deepStrictEqual(r.payouts, { p1: 210, p0: 90, p2: 0 });
});
check("n=4: 60/30/10 with floor remainder to first", function () {
  // pot 401 → 240 / 120 / 40，餘 1 給第 1 名
  var r = Core.settleTarget(bets([[101, 100], [100, 90], [100, 80], [100, 0]]), 100, SEAT);
  assert.deepStrictEqual(r.payouts, { p0: 241, p1: 120, p2: 40, p3: 0 });
  assert.strictEqual(sumValues(r.payouts), r.pot);
});
check("ties merge shares: two tied first split 90%", function () {
  var r = Core.settleTarget(bets([[100, 110], [100, 90], [100, 130], [100, 300]]), 100, SEAT);
  assert.deepStrictEqual(r.payouts, { p0: 180, p1: 180, p2: 40, p3: 0 });
  assert.deepStrictEqual(r.ranks, { p0: 1, p1: 1, p2: 3, p3: 4 });
});
check("tie remainder goes to earliest seat", function () {
  var r = Core.settleTarget(bets([[101, 100], [100, 100], [100, 100]]), 100, SEAT);
  assert.deepStrictEqual(r.payouts, { p0: 101, p1: 100, p2: 100 });
});
check("pot conservation over many cases", function () {
  for (var k = 0; k < 300; k++) {
    var list = [];
    var n = 1 + (k % 5);
    for (var i = 0; i < n; i++) list.push([1 + ((k * 37 + i * 101) % 997), (k * 13 + i * 29) % 250]);
    var r = Core.settleTarget(bets(list), (k * 7) % 220, SEAT);
    assert.strictEqual(sumValues(r.payouts), r.pot, "case " + k);
  }
});

function playTarget(s, plan) {
  s = Core.reduce(s, { type: "startBetting" });
  s.current.bettors.forEach(function (id, i) {
    s = Core.reduce(s, { type: "placeBet", playerId: id, amount: plan.bets[i][0], predict: plan.bets[i][1] });
  });
  plan.deltas.forEach(function (d) {
    s = release(s);
    s = Core.reduce(s, { type: "applyDelta", delta: d });
  });
  return s;
}
check("settle pays chips, writes history, nextTarget advances then final", function () {
  var s = Core.newGame(baseConfig(2));
  s = playTarget(s, { bets: [[100, 120], [100, 80]], deltas: [10, 10] });
  assert.strictEqual(s.phase, "settle");
  assert.strictEqual(s.players[0].chips, 1100);
  assert.strictEqual(s.players[1].chips, 900);
  assert.strictEqual(s.history.length, 1);
  assert.strictEqual(s.history[0].finalPrice, 120);
  assert.strictEqual(s.history[0].news.length, 2);
  assert.strictEqual(s.lastSettlement.targetId, "t0");
  s = Core.reduce(s, { type: "nextTarget" });
  assert.strictEqual(s.phase, "reveal_target");
  assert.strictEqual(s.targetIndex, 1);
  assert.strictEqual(s.current, null);
  s = playTarget(s, { bets: [[100, 100], [100, 100]], deltas: [0, 0] });
  s = Core.reduce(s, { type: "nextTarget" });
  s = playTarget(s, { bets: [[100, 100], [100, 100]], deltas: [0, 0] });
  s = Core.reduce(s, { type: "nextTarget" });
  assert.strictEqual(s.phase, "final");
});

console.log("[core: missions]");
function missionState(missionId, params) {
  var s = Core.newGame(baseConfig(3));
  s.players[0].mission = { id: missionId, params: params };
  return s;
}
function evalP0(s) { return Core.evaluateMissions(s).filter(function (r) { return r.playerId === "p0"; })[0]; }
check("firstPlaceAtLeast / exactHit / allInOnce / contrarian / ownNewsSwing", function () {
  var s = missionState("m_first", { count: 2 });
  s.config.missionsEnabled = true;
  // 標的 1：最終 130。p0 預測 130（誤差 0、方向漲、押 80%）；彩池 1400 × 70% = 980 > 800 → 獲利
  s = playTarget(s, { bets: [[800, 130], [300, 70], [300, 80]], deltas: [10, 10, 10] });
  s = Core.reduce(s, { type: "nextTarget" });
  // 標的 2：最終 100。p0 預測 100 → 第 1 名
  s = playTarget(s, { bets: [[100, 100], [100, 140], [100, 60]], deltas: [0, 0, 0] });
  var r = evalP0(s);
  assert.strictEqual(r.achieved, true);
  assert.strictEqual(r.reward, 300);
  s.players[0].mission = { id: "m_exact", params: { within: 5 } };
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].mission = { id: "m_allin", params: { pct: 80 } };
  assert.strictEqual(evalP0(s).achieved, true);
  // 標的 1：p1/p2 猜跌（70/80），實際漲 → 過半猜錯，p0 猜漲正確
  s.players[0].mission = { id: "m_contra", params: {} };
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].mission = { id: "m_swing", params: { abs: 30 } };
  assert.strictEqual(evalP0(s).achieved, false);
});
check("categoryRiseAtLeast / anyTargetCrash / finalRank", function () {
  var s = missionState("m_catrise", { category: "sengoku_event", price: 150 });
  s.config.missionsEnabled = true;
  s.history = [
    { category: "sengoku_event", finalPrice: 160, bets: {}, ranks: {}, payouts: {}, news: [] },
    { category: "jp_company", finalPrice: 30, bets: {}, ranks: {}, payouts: {}, news: [] }
  ];
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].mission = { id: "m_catrise", params: { category: "jp_company", price: 150 } };
  assert.strictEqual(evalP0(s).achieved, false);
  s.players[0].mission = { id: "m_crash", params: { price: 40 } };
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].chips = 500; s.players[1].chips = 900; s.players[2].chips = 100;
  s.players[0].mission = { id: "m_rank2", params: { rank: 2 } };
  assert.strictEqual(evalP0(s).achieved, true);
});
check("missions ignored when disabled; finalStandings adds bonus and ranks", function () {
  var s = missionState("m_crash", { price: 40 });
  s.history = [{ category: "washoku", finalPrice: 10, bets: {}, ranks: {}, payouts: {}, news: [] }];
  s.players[0].chips = 800; s.players[1].chips = 1000; s.players[2].chips = 1000;
  assert.deepStrictEqual(Core.evaluateMissions(s), []);
  s.config.missionsEnabled = true;
  var st = Core.finalStandings(s);
  st.forEach(function (r) { assert.strictEqual(r.total, 1000); assert.strictEqual(r.rank, 1); });
  // 同分時依座位序排列
  assert.deepStrictEqual(st.map(function (r) { return r.playerId; }), ["p0", "p1", "p2"]);
  assert.strictEqual(st[0].bonus, 200);
  assert.strictEqual(st[0].chips, 800);
  s.players[1].chips = 1001;
  st = Core.finalStandings(s);
  assert.strictEqual(st[0].playerId, "p1");
  assert.strictEqual(st[1].rank, 2);
  assert.strictEqual(st[2].rank, 2);
});

}

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
