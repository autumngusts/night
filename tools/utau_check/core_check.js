// ============================================================================
// utau（我不會唱歌）歌單與規則引擎的 Node 單元檢查。
// 執行：node tools/utau_check/core_check.js
// 計分規則（使用者指定）：答對人數 k 查計分表；出題者與每位答對者各得 table[k]，
// 全部答錯只有出題者得 table[0]；AI 答對出題者另得 aiBonus。
// 進階模式（2026-10-18 使用者指定）：沒有出題者、全體一起猜；答對者各得 table[k]，k 以全體玩家計。
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
// 舊門檻 200 首來自「以日本歌為主、大量收錄」的初版方針；2026-10-17 使用者改為精選歌單（拿掉老歌、補足指定歌手），
// 日本歌約 240 首，改為檢查 ≥ 150 首且動漫歌占日本歌至少 35%（使用者指定「動漫歌占比要很大」；
// 35% 是 Claude 訂的下限，不是使用者給的數字。動漫歌只收台灣大眾熟悉的，所以不為了比例硬塞歌）。
assert.ok(countRegion("ja") >= 150, "ja count " + countRegion("ja"));
var jaAnime = Songs.songs.filter(function (s) { return s.r === "ja" && s.c === "anime"; }).length;
assert.ok(jaAnime / countRegion("ja") >= 0.35, "ja anime share " + jaAnime + "/" + countRegion("ja"));
assert.ok(countRegion("en") <= 25 && countRegion("ko") <= 20, "en/ko condensed");
Songs.categories.forEach(function (c) {
  assert.ok(Songs.songs.some(function (s) { return s.r === "ja" && s.c === c.id; }), "ja has category " + c.id);
});
assert.ok(Songs.songs.length >= 250, "song count " + Songs.songs.length);
assert.strictEqual(Songs.decadeOf({ y: 1985 }), 1980);

// ---- 預設計分表 ----
assert.deepStrictEqual(Core.defaultScoreTable(4), [0, 3, 3, 1]);
assert.deepStrictEqual(Core.defaultScoreTable(6), [0, 3, 3, 3, 2, 1]);
assert.deepStrictEqual(Core.defaultScoreTable(2), [0, 1]);
// 進階模式沒有出題者：猜題人數＝全體，計分表多一列
assert.deepStrictEqual(Core.defaultScoreTable(3, "advanced"), [0, 3, 3, 1]);
assert.strictEqual(Core.guesserCount("advanced", 3), 3);
assert.strictEqual(Core.guesserCount("basic", 3), 2);

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
  { id: "ja:C", t: "C", a: "x", y: 2021, r: "ja", c: "anime", variants: ["original", "instrumental", "reverse"] },
  { id: "ko:D", t: "D", a: "x", y: 2020, r: "ko", c: "idol", variants: ["original", "speed"] },
  { id: "ja:E", t: "E", a: "x", y: 1995, r: "ja", c: "anime", variants: ["original", "instrumental"] }
];
// 舊值 [0, 2, 1] 是輪流出題時「猜題 2 人」的表；2026-10-18 改為全體猜題後猜題 3 人，計分表 4 列
var adv = { mode: "advanced", players: players(3), aiBonus: 1, scoreTable: [0, 3, 2, 1], packSongs: packSongs,
  regions: ["ja"], decades: [2010, 2020], categories: ["anime", "pop"], variants: ["instrumental", "rhythm", "reverse"] };
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
  assert.strictEqual(s.current.singerId, null, "advanced mode has no quizmaster");
  assert.strictEqual(s.current.variant, null, "versions are picked by the players, not drawn");
  Core.pickableVariants(s).forEach(function (v) {
    assert.ok(song.variants.indexOf(v) >= 0, "variant exists on the song");
    assert.ok(adv.variants.indexOf(v) >= 0, "variant is selected");
    assert.notStrictEqual(v, "original", "original is answer-only");
  });
}
var last = s.history[s.history.length - 1];
assert.ok(last.song && last.song.t, "history keeps the song title");
var re = Core.redrawSong(s, r);
assert.strictEqual(re.current.singerId, null, "redraw keeps no quizmaster");
assert.throws(function () { Core.createGame(Object.assign({}, adv, { scoreTable: [0, 2, 1] })); }, /ut_err_table/,
  "advanced table needs players + 1 rows");

// ---- 進階模式：挑版本（最多 3 種）、年代／歌手提示、全體計分 ----
var pickCfg = Object.assign({}, adv, { regions: ["ja"], decades: [2010], categories: ["pop"],
  variants: ["instrumental", "vocal", "other", "speed", "rhythm"],
  packSongs: [{ id: "ja:P", t: "P", a: "Artist", y: 2016, r: "ja", c: "pop",
    variants: ["original", "instrumental", "vocal", "other", "speed", "rhythm", "reverse"] }] });
s = Core.createGame(pickCfg, r);
assert.deepStrictEqual(s.current.picked, []);
assert.deepStrictEqual(Core.pickableVariants(s), ["instrumental", "vocal", "other", "speed", "rhythm"],
  "only versions the song has and the setup selected (reverse is not selected)");
assert.strictEqual(Core.MAX_PICKS, 3);
assert.strictEqual(Core.pickVariant(s, "reverse"), s, "unselected version cannot be picked");
assert.strictEqual(Core.pickVariant(s, "original"), s, "original cannot be picked");
s = Core.pickVariant(s, "vocal");
s = Core.pickVariant(s, "speed");
s = Core.pickVariant(s, "vocal");
assert.deepStrictEqual(s.current.picked, ["vocal", "speed"], "re-picking does not use a slot");
assert.strictEqual(s.current.variant, "vocal");
s = Core.pickVariant(s, "rhythm");
assert.strictEqual(Core.picksLeft(s), 0);
assert.strictEqual(Core.pickVariant(s, "other"), s, "no 4th version");
s = Core.pickVariant(s, "speed");
assert.strictEqual(s.current.variant, "speed", "picked versions can still be switched back to");
assert.strictEqual(Core.useInfoHint(s, "lyrics"), s, "unknown hint kind is ignored");
s = Core.useInfoHint(s, "decade");
s = Core.useInfoHint(s, "artist");
assert.deepStrictEqual(s.current.info, { decade: true, artist: true });
var grpBefore = JSON.parse(JSON.stringify(s.scores));
s = Core.settle(s, { aiCorrect: true, correctIds: ["p1", "p3"] }, r);
var grpHist = s.history[s.history.length - 1];
assert.deepStrictEqual(grpHist.picked, ["vocal", "speed", "rhythm"], "history keeps the picked versions");
assert.deepStrictEqual(grpHist.info, { decade: true, artist: true }, "history keeps the hints");
assert.strictEqual(grpHist.aiCorrect, false, "no AI bonus without a quizmaster");
assert.deepStrictEqual(grpHist.deltas, { p1: pickCfg.scoreTable[2], p2: 0, p3: pickCfg.scoreTable[2] },
  "each correct guesser gets table[k]; hints do not change scoring");
assert.strictEqual(s.scores.p1 - grpBefore.p1, 2);
assert.deepStrictEqual(s.current.picked, [], "picks reset every round");
assert.deepStrictEqual(s.current.info, {}, "hints reset every round");
s = Core.settle(s, { aiCorrect: false, correctIds: [] }, r);
assert.deepStrictEqual(s.history[s.history.length - 1].deltas, { p1: 0, p2: 0, p3: 0 }, "all wrong: nobody scores");
s = Core.settle(s, { aiCorrect: false, correctIds: ["p1", "p2", "p3"] }, r);
assert.deepStrictEqual(s.history[s.history.length - 1].deltas, { p1: 1, p2: 1, p3: 1 }, "everyone right: table[3]");
assert.throws(function () { Core.createGame(Object.assign({}, adv, { packSongs: [] })); }, /ut_err_no_pack/);
assert.throws(function () { Core.createGame(Object.assign({}, adv, { variants: [] })); }, /ut_err_variants/);
assert.throws(function () { Core.createGame(Object.assign({}, adv, { decades: [1960] })); }, /ut_err_pool/);
assert.throws(function () { Core.createGame(Object.assign({}, basic, { players: players(1), scoreTable: [0] })); }, /ut_err_players/);

// ---- 提示（使用者指定：中文歌聲播放滿 5 次後可加上伴奏，不影響計分）----
var hintCfg = Object.assign({}, adv, { regions: ["ja"], decades: [2020], categories: ["anime"], variants: ["zh_sing"],
  packSongs: [{ id: "ja:H", t: "H", a: "x", y: 2021, r: "ja", c: "anime", variants: ["original", "zh_sing", "zh_sing_inst"] }] });
s = Core.createGame(hintCfg, r);
assert.deepStrictEqual(Core.pickableVariants(s), ["zh_sing"], "hint clip itself is never pickable");
assert.ok(!Core.hasHint(s), "no hint before a version is picked");
s = Core.pickVariant(s, "zh_sing");
assert.strictEqual(Core.HINT_PLAYS, 5);
assert.ok(Core.hasHint(s), "zh_sing with zh_sing_inst in the pack has a hint");
for (i = 0; i < 4; i++) s = Core.recordPlay(s);
assert.strictEqual(Core.playsUntilHint(s), 1);
assert.strictEqual(Core.useHint(s).current.hint, false, "locked before 5 plays");
s = Core.recordPlay(s);
assert.ok(Core.hintAvailable(s));
s = Core.useHint(s);
assert.strictEqual(s.current.hint, true);
var hintBefore = JSON.parse(JSON.stringify(s.scores));
s = Core.settle(s, { aiCorrect: false, correctIds: ["p2"] }, r);
var hintHist = s.history[s.history.length - 1];
assert.strictEqual(hintHist.hint, true, "history marks the hint");
assert.strictEqual(s.scores.p2 - hintBefore.p2, hintCfg.scoreTable[1], "hint does not change scoring");
assert.strictEqual(s.current.plays, 0, "play count resets every round");
assert.strictEqual(s.current.hint, false);
var noHint = Core.pickVariant(Core.createGame(Object.assign({}, hintCfg, { packSongs: [{ id: "ja:H", t: "H", a: "x", y: 2021, r: "ja", c: "anime",
  variants: ["original", "zh_sing"] }] }), r), "zh_sing");
assert.ok(!Core.hasHint(noHint), "no hint without the hint clip in the pack");
assert.strictEqual(Core.hintClip("ja_sing"), "ja_sing_inst", "Japanese singing has the same hint");
assert.strictEqual(Core.hintClip("instrumental"), null);

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
