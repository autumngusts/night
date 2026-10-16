// ============================================================================
// utau（我不會唱歌）歌單與規則引擎的 Node 單元檢查。
// 執行：node tools/utau_check/core_check.js
// 計分規則（使用者指定）：答對人數 k 查計分表；出題者與每位答對者各得 table[k]，
// 全部答錯只有出題者得 table[0]；AI 答對出題者另得 aiBonus。
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var win = {};
["utau_songs.js", "utau_core.js"].forEach(function (f) {
  new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win);
});
var Songs = win.PriTestUtauSongs;
var Core = win.PriTestUtauCore;

// 固定種子的 rng
function rng(seed) {
  var x = seed >>> 0;
  return function () {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// ---- 歌單 ----
var ids = {};
Songs.songs.forEach(function (s) {
  assert.ok(!ids[s.id], "duplicate song id " + s.id);
  ids[s.id] = true;
  assert.ok(s.t && s.a && s.y >= 1950 && s.y <= 2026, "song fields " + s.id);
  assert.ok(Songs.regions.some(function (r) { return r.id === s.r; }), "region " + s.id);
  assert.ok(Songs.category(s.c), "category " + s.id);
});
// 選曲方針：日本為主，歐美／韓國濃縮
function countRegion(r) { return Songs.songs.filter(function (s) { return s.r === r; }).length; }
assert.ok(countRegion("ja") >= 200, "ja count " + countRegion("ja"));
assert.ok(countRegion("en") <= 25 && countRegion("ko") <= 20, "en/ko condensed");
Songs.categories.forEach(function (c) {
  assert.ok(Songs.songs.some(function (s) { return s.r === "ja" && s.c === c.id; }), "ja has category " + c.id);
});
assert.ok(Songs.songs.length >= 200, "song count " + Songs.songs.length);
assert.strictEqual(Songs.decadeOf({ y: 1985 }), 1980);

// ---- 預設計分表 ----
assert.deepStrictEqual(Core.defaultScoreTable(4), [0, 3, 3, 1]);
assert.deepStrictEqual(Core.defaultScoreTable(6), [0, 3, 3, 3, 2, 1]);
assert.deepStrictEqual(Core.defaultScoreTable(2), [0, 1]);

function players(n) {
  var list = [];
  for (var i = 1; i <= n; i++) list.push({ id: "p" + i, name: "P" + i });
  return list;
}

var basic = { mode: "basic", players: players(4), aiBonus: 1, scoreTable: [-1, 3, 2, 1],
  regions: [], decades: [], styles: [] };

// ---- 計分 ----
var d = Core.computeDeltas(basic, "p1", false, ["p2"]);
assert.deepStrictEqual(d, { p1: 3, p2: 3, p3: 0, p4: 0 }, "1 right");
d = Core.computeDeltas(basic, "p1", true, ["p2", "p3"]);
assert.deepStrictEqual(d, { p1: 3, p2: 2, p3: 2, p4: 0 }, "2 right + AI");
d = Core.computeDeltas(basic, "p1", false, ["p2", "p3", "p4"]);
assert.deepStrictEqual(d, { p1: 1, p2: 1, p3: 1, p4: 1 }, "all right");
d = Core.computeDeltas(basic, "p1", true, []);
assert.deepStrictEqual(d, { p1: 0, p2: 0, p3: 0, p4: 0 }, "all wrong (-1) + AI (+1)");
d = Core.computeDeltas(basic, "p1", false, ["p1", "p2"]);
assert.deepStrictEqual(d, { p1: 3, p2: 3, p3: 0, p4: 0 }, "singer cannot count as correct");

// ---- 抽人：一圈內不重複 ----
var r = rng(42);
var s = Core.createGame(basic, r);
var cycle = [s.current.singerId];
for (var i = 0; i < 11; i++) {
  s = Core.settle(s, { aiCorrect: false, correctIds: [] }, r);
  cycle.push(s.current.singerId);
}
for (var c = 0; c < 3; c++) {
  var chunk = cycle.slice(c * 4, c * 4 + 4).sort();
  assert.deepStrictEqual(chunk, ["p1", "p2", "p3", "p4"], "cycle " + c + " covers everyone once");
}
for (i = 1; i < cycle.length; i++) assert.notStrictEqual(cycle[i], cycle[i - 1], "no back-to-back singer");
assert.strictEqual(s.round, 12);
assert.strictEqual(s.history.length, 11);

// ---- 結算／復原 ----
var before = s;
var singer = s.current.singerId;
var other = basic.players.map(function (p) { return p.id; }).filter(function (id) { return id !== singer; })[0];
s = Core.settle(s, { aiCorrect: true, correctIds: [other] }, r);
assert.strictEqual(s.scores[singer] - before.scores[singer], 4);
assert.strictEqual(s.scores[other] - before.scores[other], 3);
var undone = Core.undo(s);
assert.deepStrictEqual(undone.scores, before.scores);
assert.strictEqual(undone.round, before.round);
assert.strictEqual(undone.current.singerId, before.current.singerId);
assert.throws(function () { Core.undo(undone); }, /ut_err_no_undo/, "only one level of undo");

// ---- 名次 ----
var fake = { config: basic, scores: { p1: 5, p2: 7, p3: 5, p4: 1 } };
assert.deepStrictEqual(Core.ranking(fake).map(function (x) { return x.id + ":" + x.rank; }),
  ["p2:1", "p1:2", "p3:2", "p4:4"]);

// ---- 進階模式（題庫包）----
// 假的題庫包：5 首，版本各不相同
var packSongs = [
  { id: "ja:A", t: "A", a: "x", y: 2019, r: "ja", c: "anime", variants: ["original", "instrumental", "vocal"] },
  { id: "ja:B", t: "B", a: "x", y: 2015, r: "ja", c: "pop", variants: ["original", "rhythm"] },
  { id: "ja:C", t: "C", a: "x", y: 2021, r: "ja", c: "anime", variants: ["original", "instrumental", "melody"] },
  { id: "ko:D", t: "D", a: "x", y: 2020, r: "ko", c: "idol", variants: ["original", "speed"] },
  { id: "ja:E", t: "E", a: "x", y: 1995, r: "ja", c: "anime", variants: ["original", "instrumental"] }
];
var adv = { mode: "advanced", players: players(3), aiBonus: 1, scoreTable: [0, 2, 1], packSongs: packSongs,
  regions: ["ja"], decades: [2010, 2020], categories: ["anime", "pop"], variants: ["instrumental", "rhythm", "melody"] };
var pool = Core.songPool(adv).map(function (x) { return x.id; }).sort();
assert.deepStrictEqual(pool, ["ja:A", "ja:B", "ja:C"], "region × decade × category × variant");
assert.deepStrictEqual(Core.songPool(Object.assign({}, adv, { variants: ["speed"] })), [], "no song has the variant");
s = Core.createGame(adv, r);
var seen = [s.current.songId];
for (i = 1; i < pool.length; i++) {
  s = Core.settle(s, { aiCorrect: false, correctIds: [] }, r);
  seen.push(s.current.songId);
}
assert.deepStrictEqual(seen.slice().sort(), pool, "no song repeats until the pool is exhausted");
for (i = 0; i < 20; i++) {
  s = Core.settle(s, { aiCorrect: false, correctIds: [] }, r);
  var song = Core.findPackSong(s.config, s.current.songId);
  assert.ok(song.variants.indexOf(s.current.variant) >= 0, "variant exists on the song");
  assert.ok(adv.variants.indexOf(s.current.variant) >= 0, "variant is selected");
  assert.notStrictEqual(s.current.variant, "original", "original is answer-only");
}
var last = s.history[s.history.length - 1];
assert.ok(last.song && last.song.t, "history keeps the song title");
var re = Core.redrawSong(s, r);
assert.strictEqual(re.current.singerId, s.current.singerId, "redraw keeps singer");
assert.throws(function () { Core.createGame(Object.assign({}, adv, { packSongs: [] })); }, /ut_err_no_pack/);
assert.throws(function () { Core.createGame(Object.assign({}, adv, { variants: [] })); }, /ut_err_variants/);
assert.throws(function () { Core.createGame(Object.assign({}, adv, { decades: [1960] })); }, /ut_err_pool/);
assert.throws(function () { Core.createGame(Object.assign({}, basic, { players: players(1), scoreTable: [0] })); }, /ut_err_players/);

// ---- 夢想模式（YouTube）----
[
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=30", "dQw4w9WgXcQ"],
  ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://example.com/watch?v=dQw4w9WgXcQ", null],
  ["hello", null]
].forEach(function (c) { assert.strictEqual(Core.parseYoutubeId(c[0]), c[1], c[0]); });
for (i = 0; i < 50; i++) {
  var st = Core.randomStart(240, 12, r);
  assert.ok(st >= 36 && st <= 240 * 0.9 - 12, "start in the middle: " + st);
}
assert.strictEqual(Core.randomStart(10, 12, r), 0, "short video");
var dream = { mode: "dream", players: players(3), aiBonus: 1, scoreTable: [0, 2, 1], clipSeconds: 12, randomSpeed: true };
s = Core.createGame(dream, r);
assert.deepStrictEqual(Object.keys(s.current.dream).sort(), ["rate", "start", "title", "videoId"]);
assert.ok([0.75, 1.25].indexOf(s.current.dream.rate) >= 0);
s = Core.setDream(s, { videoId: "dQw4w9WgXcQ", start: 42, title: "T" });
s = Core.settle(s, { aiCorrect: true, correctIds: [] }, r);
assert.deepStrictEqual(s.history[0].dream, { videoId: "dQw4w9WgXcQ", title: "T" });
assert.strictEqual(s.current.dream.videoId, null, "new round needs a new link");
assert.strictEqual(Core.createGame(Object.assign({}, dream, { randomSpeed: false }), r).current.dream.rate, 1);
assert.throws(function () { Core.createGame(Object.assign({}, dream, { clipSeconds: 3 })); }, /ut_err_clip_seconds/);

console.log("utau core_check OK (" + Songs.songs.length + " songs)");
