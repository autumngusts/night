// 武俠合成（gousei）規則引擎：純函式，不碰 DOM／localStorage，方便用 node 測試。
//
// 規則（使用者指定，詳見 docs/gousei_game_design.md）：
//   ・組合必有結果：配方表沒有的組合 → 依 key 雜湊選一個廢料；任一材料是廢料 → 必為廢料
//   ・每人任務：中階 ×1（階段 3〜4）＋ 高階 ×2（階段 5〜7），全體不重複
//   ・共用池子，每輪每人合成一次；只有在自己回合親手合出自己的任務物才算達成
//   ・最先達成全部任務者立即獲勝；可復原一層
(function () {
  "use strict";

  var MID_TIERS = [3, 4];
  var HIGH_TIERS = [5, 7];
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 8;

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // FNV-1a 32bit
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32：同一個 seed 在每台裝置都得到相同序列（分別裝置模式靠這個算出同樣的任務）
  function makeRng(seed) {
    var a = hashStr(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newSeed(rand) {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    var out = "";
    for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(rand() * chars.length));
    return out;
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function pairKey(a, b) { return a <= b ? a + "|" + b : b + "|" + a; }

  function indexTheme(data) {
    var byId = {};
    var items = data.items.map(function (row) {
      var it = { id: row[0], zh: row[1], ja: row[2], cat: row[3], tier: row[4] };
      byId[it.id] = it;
      return it;
    });
    var junkSet = {};
    data.junk.forEach(function (id) { junkSet[id] = true; });
    var catById = {};
    data.categories.forEach(function (c) { catById[c.id] = c; });
    return { id: data.id, data: data, items: items, byId: byId, basics: data.basics.slice(),
      junk: data.junk.slice(), junkSet: junkSet, recipes: data.recipes, catById: catById };
  }

  function combine(theme, a, b) {
    var key = pairKey(a, b);
    var junkPick = theme.junk[hashStr(key) % theme.junk.length];
    if (theme.junkSet[a] || theme.junkSet[b]) return junkPick;
    return theme.recipes[key] || junkPick;
  }

  function inRange(tier, range) { return tier >= range[0] && tier <= range[1]; }

  function dealTargets(theme, seed, playerCount) {
    var rng = makeRng("targets:" + seed);
    function candidates(range) {
      return theme.items.filter(function (it) {
        return it.cat !== "basic" && !theme.junkSet[it.id] && inRange(it.tier, range);
      }).map(function (it) { return it.id; });
    }
    var mids = shuffle(candidates(MID_TIERS), rng);
    var highs = shuffle(candidates(HIGH_TIERS), rng);
    if (mids.length < playerCount || highs.length < playerCount * 2) throw new Error("not-enough-targets");
    var out = [];
    for (var i = 0; i < playerCount; i++) out.push([mids[i], highs[i * 2], highs[i * 2 + 1]]);
    return out;
  }

  function newGame(theme, opts) {
    var targets = dealTargets(theme, opts.seed, opts.names.length);
    return {
      version: 1,
      themeId: theme.id,
      seed: opts.seed,
      mode: opts.mode,
      players: opts.names.map(function (name, i) {
        return { id: "p" + (i + 1), name: name, targets: targets[i], done: [] };
      }),
      pool: theme.basics.slice(),
      round: 1,
      turn: 0,
      log: [],
      winner: null,
      prev: null
    };
  }

  function currentPlayer(state) { return state.players[state.turn]; }

  function applyCombine(theme, state, a, b) {
    if (state.winner) throw new Error("game-over");
    if (state.pool.indexOf(a) < 0 || state.pool.indexOf(b) < 0) throw new Error("not-in-pool");
    var snap = clone(state);
    snap.prev = null; // 只保留一層復原
    var next = clone(snap);
    next.prev = snap;
    var result = combine(theme, a, b);
    var isNew = next.pool.indexOf(result) < 0;
    if (isNew) next.pool.push(result);
    var p = next.players[next.turn];
    var achieved = p.targets.indexOf(result) >= 0 && p.done.indexOf(result) < 0;
    if (achieved) p.done.push(result);
    var entry = { round: next.round, playerId: p.id, a: a, b: b, result: result, isNew: isNew, achieved: achieved };
    next.log.push(entry);
    if (p.done.length >= p.targets.length) {
      next.winner = p.id;
    } else {
      next.turn += 1;
      if (next.turn >= next.players.length) { next.turn = 0; next.round += 1; }
    }
    return { state: next, entry: entry };
  }

  function undo(state) { return state && state.prev ? state.prev : null; }

  // 分別裝置模式：手機只需要主題、seed、人數、自己的編號，就能算出自己的任務（不同步）
  function joinParam(state, index) {
    return [state.themeId, state.seed, state.players.length, index].join(".");
  }

  function parseJoin(str) {
    var parts = String(str || "").split(".");
    if (parts.length !== 4) return null;
    var count = parseInt(parts[2], 10);
    var index = parseInt(parts[3], 10);
    if (!/^[a-z0-9_]+$/.test(parts[0]) || !/^[0-9a-zA-Z]+$/.test(parts[1])) return null;
    if (!(count >= MIN_PLAYERS && count <= MAX_PLAYERS) || !(index >= 0 && index < count)) return null;
    return { themeId: parts[0], seed: parts[1], count: count, index: index };
  }

  window.PriTestGouseiCore = {
    MID_TIERS: MID_TIERS,
    HIGH_TIERS: HIGH_TIERS,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    hashStr: hashStr,
    makeRng: makeRng,
    newSeed: newSeed,
    pairKey: pairKey,
    indexTheme: indexTheme,
    combine: combine,
    dealTargets: dealTargets,
    newGame: newGame,
    currentPlayer: currentPlayer,
    applyCombine: applyCombine,
    undo: undo,
    joinParam: joinParam,
    parseJoin: parseJoin
  };
})();
