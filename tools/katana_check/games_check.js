// ============================================================================
// katana 工序小遊戲：每一種玩法單獨檢查（2026-10-20）
//   在頁面上直接建出每個遊戲（katana_games.js），用 ktAuto(1)／ktAuto(0.5) 依規則自動遊玩：
//   好好玩分數高、不會冷打、敲打次數夠；亂玩分數明顯較低；兩種模式（表演／較真）都跑。
//   另外檢查每道工序抽小遊戲：同一局固定、連續兩道工序不重複、不同局會抽到不同組合。
// 前置：py -3 generate.py；py -3 -m http.server 8944 --directory dist
// 執行：node tools/katana_check/games_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";

var CASES = [
  { type: "arc", cfg: { strikes: 8, coolMs: 7000 } },
  { type: "music", cfg: { lanes: ["A", "B", "C"], hammer: true, coolMs: 7000 } },
  { type: "music", cfg: { lanes: ["A", "B", "C", "D"], segments: ["x", "y"] } },
  { type: "memory", cfg: { points: "blade", backdrop: "bar", coolMs: 7000 } },
  { type: "shatter", cfg: { pieces: 12 } },
  { type: "mash", cfg: { coolMs: 7000, minStrikes: 8 } },
  { type: "whack", cfg: { strikes: 8, coolMs: 7000 } },
  { type: "arrows", cfg: { strikes: 8, coolMs: 7000, labels: { up: "u", down: "d", left: "l", right: "r" } } },
  { type: "charge", cfg: { strikes: 8, coolMs: 8000 } },
  { type: "cut", cfg: {} }
];
// 第四批（katana_games2.js，2026-10-21）：全部用同一個框架，設定與敲打類工序相同
var EXTRA = ["pendulum", "color", "align", "sustain", "reaction", "lissa", "slide", "beat", "bellows", "balance", "pressure", "steer",
  "count", "pairs", "odd", "spot", "heatpick", "order", "combo", "catch"];
EXTRA.forEach(function (type) {
  CASES.push({ type: type, cfg: { strikes: 8, minStrikes: 8, coolMs: 7000, labels: { up: "u", down: "d", left: "l", right: "r" } } });
});
if (process.env.ONLY) CASES = CASES.filter(function (c) { return process.env.ONLY.split(",").indexOf(c.type) >= 0; });

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  await page.goto(BASE);
  await page.waitForFunction(function () { return window.PriTestKatanaGames && window.PriTestKatana; });

  // 在頁面上建一個遊戲並自動遊玩，回傳成績
  async function play(c, mode, q, n) {
    return page.evaluate(function (a) {
      return new Promise(function (resolve, reject) {
        var G = window.PriTestKatanaGames, K = window.PriTestKatana;
        var host = document.getElementById("gc-host") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "gc-host" }));
        host.innerHTML = "";
        var base = K._mgCtx("gc:" + a.n);
        var ctx = Object.assign({}, base, {
          mode: a.mode, seed: "gc|" + a.n, result: null,
          done: function (res) { base.stop(); resolve(res); }
        });
        var cfg = JSON.parse(JSON.stringify(a.c.cfg));
        cfg.title = a.c.type;
        if (cfg.points === "blade") cfg.points = G.bladePoints();
        var box = G[a.c.type](ctx, cfg);
        host.appendChild(box);
        setTimeout(function () { reject(new Error("timeout " + a.c.type)); }, 60000);
        box.ktAuto(a.q);
      });
    }, { c: c, mode: mode, q: q, n: n });
  }

  var n = 0, table = [];
  for (var i = 0; i < CASES.length; i++) {
    var c = CASES[i];
    for (var mi = 0; mi < 2; mi++) {
      var mode = mi ? "serious" : "show";
      var good = await play(c, mode, 1, n++);
      var bad = await play(c, mode, 0.5, n++);
      table.push(c.type + "/" + mode + " good " + good.acc + " bad " + bad.acc + (good.strikes !== undefined ? " strikes " + good.strikes : ""));
      assert.ok(good.acc >= 0.9, c.type + "/" + mode + " good play scores high: " + JSON.stringify(good));
      assert.ok(bad.acc < good.acc - 0.05, c.type + "/" + mode + " poor play scores lower: " + JSON.stringify(bad) + " vs " + JSON.stringify(good));
      if (c.cfg.coolMs) assert.strictEqual(good.cold || 0, 0, c.type + "/" + mode + " no cold strikes in good play");
      if (c.cfg.minStrikes || c.cfg.strikes) assert.ok(good.strikes >= (c.cfg.minStrikes || c.cfg.strikes), c.type + " enough strikes");
      if (c.type === "music" && c.cfg.hammer) assert.ok(good.strikes >= 8, "hammer music has >= 8 notes");
      if (c.type === "cut") assert.ok(Math.abs(good.ratio - 0.5) < 0.005 && Math.abs(bad.ratio - 0.5) > 0.03, "cut ratio: " + good.ratio + " / " + bad.ratio);
    }
  }
  console.log(table.join("\n"));

  // 每道工序抽小遊戲：同一局固定、連續兩道不重複、不同局抽到的組合不同
  var picks = await page.evaluate(function () {
    var K = window.PriTestKatana, D = window.PriTestKatanaData, Core = window.PriTestKatanaCore;
    var ids = ["shitakitae", "uwakitae", "tsukurikomi", "sunobe", "hizukuri", "togi", "mei"];
    var out = [];
    for (var g = 0; g < 60; g++) {
      var st = Core.newGame({ names: ["a"], seed: "pick" + g, mode: "show" });
      // gameFor 讀的是目前的 state：借 _state 的物件換掉 seed 來算
      out.push(ids.map(function (id) { return K._gameForSeed(st.seed, 0, id); }));
    }
    return { ids: ids, rows: out, again: ids.map(function (id) { return K._gameForSeed("pick0", 0, id); }) };
  });
  assert.deepStrictEqual(picks.again, picks.rows[0], "same seed gives the same games");
  picks.rows.forEach(function (r) { for (var k = 1; k < r.length; k++) assert.notStrictEqual(r[k], r[k - 1], "no repeat in a row: " + r.join(",")); });
  var combos = {};
  picks.rows.forEach(function (r) { combos[r.join(",")] = 1; });
  assert.ok(Object.keys(combos).length >= 50, "different forges get different games: " + Object.keys(combos).length + " / 60");
  var used = {};
  picks.rows.forEach(function (r) { r.forEach(function (x) { used[x] = 1; }); });
  ["arc", "music", "memory", "mash", "whack", "arrows", "charge"].concat(EXTRA).forEach(function (x) { assert.ok(used[x], "type gets picked: " + x); });
  console.log("pick variety:", Object.keys(combos).length, "/ 60 combos");

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("katana games_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
