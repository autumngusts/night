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

  check("all players broke at startBetting -> final", function () {
    var s = game(2);
    s.players.forEach(function (p) { p.chips = 0; });
    s = R(s, { type: "startBetting" });
    assert.strictEqual(s.phase, "final");
  });
}

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
