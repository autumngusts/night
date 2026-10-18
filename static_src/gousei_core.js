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

  // ---------------- 語音指令（只做字串解析；麥克風／朗讀在 gousei.js） ----------------
  // 辨識結果的漢字／假名不穩定：片假名一律轉平假名、去掉空白與標點後再比對。

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }

  function normSpeech(s) {
    return toHiragana(String(s || "").toLowerCase()).replace(/[\s、。，,.．!！?？「」『』・…~〜"'“”:：;；]/g, "");
  }

  // 喚醒詞「yo, アキ」。「秋」「亜紀」等一般詞彙（物體名稱也有「秋」）必須前面接 yo 才算
  var WAKE_YO = ["yo", "よー", "よう", "よぉ", "よ", "ヨ", "喲", "唷", "呦", "哟"].map(normSpeech);
  var WAKE_AKI = ["aki", "アキ", "阿基", "阿奇", "阿琪", "阿吉", "阿姬", "阿紀", "阿祺", "阿齊", "阿琦", "阿岐"].map(normSpeech);
  var WAKE_AKI_WEAK = ["秋", "亜紀", "亜希", "安芸", "阿木"].map(normSpeech);

  // strict = 朗讀中：喇叭的聲音可能被收音，只接受有 yo 開頭的完整喚醒詞
  function detectWake(text, strict) {
    var n = normSpeech(text);
    var lists = [[WAKE_AKI, false], [WAKE_AKI_WEAK, true]];
    for (var l = 0; l < lists.length; l++) {
      var words = lists[l][0], needYo = lists[l][1] || strict;
      for (var w = 0; w < words.length; w++) {
        var idx = n.indexOf(words[w]);
        while (idx >= 0) {
          var hasYo = false;
          for (var y = 0; y < WAKE_YO.length; y++) {
            if (idx >= WAKE_YO[y].length && n.slice(idx - WAKE_YO[y].length, idx) === WAKE_YO[y]) { hasYo = true; break; }
          }
          if (hasYo || (!needYo && idx === 0)) return { rest: n.slice(idx + words[w].length) };
          idx = n.indexOf(words[w], idx + 1);
        }
      }
    }
    return null;
  }

  function levenshtein(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  var COMBO_SEPS = ["加上", "加", "和", "跟", "與", "与", "配上", "配", "+", "＋", "プラス", "たす", "足す", "と", "plus", "and"].map(normSpeech);
  var COMBO_HEAD = ["我要", "我想", "請", "把"].map(normSpeech);
  var COMBO_TAIL = ["を合成してください", "を合成して", "を合成", "合成してください", "合成して", "してください", "合成", "して",
    "ください", "です", "吧", "で"].map(normSpeech);
  var COMBO_MIN_SCORE = 0.6;

  // 「A 加 B」→ 池子裡最像的兩個物體（廢料不列入候選）。每一段的相似度都要 ≥ 0.6（兩個字錯一個不算），否則回傳 null。
  function parseVoiceCombo(theme, pool, text) {
    var n = normSpeech(text);
    var changed = true;
    while (changed && n) {
      changed = false;
      COMBO_HEAD.forEach(function (h) { if (n.indexOf(h) === 0 && n.length > h.length) { n = n.slice(h.length); changed = true; } });
      COMBO_TAIL.forEach(function (s) {
        if (n.length > s.length && n.slice(-s.length) === s) { n = n.slice(0, -s.length); changed = true; }
      });
    }
    if (!n) return null;
    var cands = [];
    pool.forEach(function (id) {
      if (theme.junkSet[id] || !theme.byId[id]) return;
      var it = theme.byId[id];
      cands.push({ id: id, name: normSpeech(it.zh) });
      if (it.ja !== it.zh) cands.push({ id: id, name: normSpeech(it.ja) });
    });
    var memo = {};
    function bestFor(part) {
      if (memo.hasOwnProperty(part)) return memo[part];
      var best = null;
      for (var i = 0; i < cands.length; i++) {
        var name = cands[i].name;
        var len = Math.max(part.length, name.length);
        if (!name || Math.abs(part.length - name.length) > len / 2) continue;
        var score = part === name ? 1 : 1 - levenshtein(part, name) / len;
        if (!best || score > best.score) best = { id: cands[i].id, score: score };
      }
      memo[part] = best;
      return best;
    }
    var result = null;
    function trySplit(left, right, exactOnly) {
      if (!left || !right) return;
      var a = bestFor(left), b = bestFor(right);
      if (!a || !b) return;
      if (exactOnly && (a.score < 1 || b.score < 1)) return;
      var score = Math.min(a.score, b.score) + (a.score + b.score) / 1000;
      if (Math.min(a.score, b.score) >= COMBO_MIN_SCORE && (!result || score > result.score)) {
        result = { a: a.id, b: b.id, score: score };
      }
    }
    COMBO_SEPS.forEach(function (sep) {
      var idx = n.indexOf(sep, 1);
      while (idx > 0) {
        trySplit(n.slice(0, idx), n.slice(idx + sep.length), false);
        idx = n.indexOf(sep, idx + 1);
      }
    });
    // 沒說「加」：例如「火水」，只接受兩段都完全一致
    for (var i = 1; i < n.length; i++) trySplit(n.slice(0, i), n.slice(i), true);
    return result;
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
    parseJoin: parseJoin,
    normSpeech: normSpeech,
    detectWake: detectWake,
    parseVoiceCombo: parseVoiceCombo
  };
})();
