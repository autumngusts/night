// 武俠合成（gousei）規則引擎：純函式，不碰 DOM／localStorage，方便用 node 測試。
//
// 規則（使用者指定，詳見 docs/gousei_game_design.md）：
//   ・組合必有結果：配方表沒有的組合 → 依 key 雜湊選一個廢料；任一材料是廢料 → 必為廢料
//   ・每人任務：中階 ×1（階段 3〜4）＋ 高階 ×2（階段 5〜7），全體不重複
//   ・共用池子，每輪每人合成一次；只有在自己回合親手合出自己的任務物才算達成
//   ・最先達成全部任務者立即獲勝；可復原一層
//   ・合作模式 coop（使用者指定 2026-11-03）：全隊共同抽 5 個目標（中階 2＋高階 3），任何人在自己回合
//     合出未達成的目標即全隊達成；合出廢料記 1 次失敗；全部達成（或提前結算）後依回合數與失敗數計算效率得分
(function () {
  "use strict";

  var MID_TIERS = [3, 4];
  var HIGH_TIERS = [5, 7];
  var COOP_MID_COUNT = 2;
  var COOP_HIGH_COUNT = 3;
  var COOP_WINNER = "coop"; // 合作模式結束時的 state.winner（不是玩家 id）
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

  // 3 材料的組合 key（排序後用 "|" 接起來），只用於支援 trio 的主題（見 tripleKey 的呼叫端）。
  function tripleKey(a, b, c) { return [a, b, c].sort().join("|"); }

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
      junk: data.junk.slice(), junkSet: junkSet, recipes: data.recipes, catById: catById,
      trios: data.trios || {}, allowTrio: !!data.allowTrio };
  }

  function combine(theme, a, b) {
    var key = pairKey(a, b);
    var junkPick = theme.junk[hashStr(key) % theme.junk.length];
    if (theme.junkSet[a] || theme.junkSet[b]) return junkPick;
    return theme.recipes[key] || junkPick;
  }

  // 3 材料合成（只有 theme.allowTrio 的主題才會用到）：
  //   有配方 → { options: [主產物, 副產物] }，由呼叫端讓玩家二選一；
  //   任一材料是廢料，或沒有配方 → { options: [廢料] }（和 2 材料一樣，廢料沒有選擇的意義）。
  function combineTrio(theme, a, b, c) {
    var key = tripleKey(a, b, c);
    var junkPick = theme.junk[hashStr(key) % theme.junk.length];
    if (theme.junkSet[a] || theme.junkSet[b] || theme.junkSet[c]) return { options: [junkPick] };
    var trio = theme.trios[key];
    if (trio) return { options: [trio[0], trio[1]] };
    return { options: [junkPick] };
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

  // 合作模式的共同目標：中階 ×2 ＋ 高階 ×3，以 seed 決定（與對戰的 dealTargets 用不同的亂數序列）
  function dealCoopTargets(theme, seed) {
    var rng = makeRng("coop:" + seed);
    function candidates(range) {
      return theme.items.filter(function (it) {
        return it.cat !== "basic" && !theme.junkSet[it.id] && inRange(it.tier, range);
      }).map(function (it) { return it.id; });
    }
    var mids = shuffle(candidates(MID_TIERS), rng);
    var highs = shuffle(candidates(HIGH_TIERS), rng);
    if (mids.length < COOP_MID_COUNT || highs.length < COOP_HIGH_COUNT) throw new Error("not-enough-targets");
    return mids.slice(0, COOP_MID_COUNT).concat(highs.slice(0, COOP_HIGH_COUNT));
  }

  function newGame(theme, opts) {
    if (opts.mode === "coop") {
      var shared = dealCoopTargets(theme, opts.seed);
      var g = newGameBase(theme, opts, function () { return []; });
      g.coop = { targets: shared, done: [], fails: 0, ended: false };
      return g;
    }
    var targets = dealTargets(theme, opts.seed, opts.names.length);
    return newGameBase(theme, opts, function (i) { return targets[i]; });
  }

  // 合作模式：players[].targets 為空，players[].done 記錄該玩家親手合出的共同目標（貢獻）
  function newGameBase(theme, opts, targetsFor) {
    return {
      version: 1,
      themeId: theme.id,
      seed: opts.seed,
      mode: opts.mode,
      players: opts.names.map(function (name, i) {
        return { id: "p" + (i + 1), name: name, targets: targetsFor(i), done: [] };
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
    var entry = { round: next.round, playerId: p.id, a: a, b: b, result: result, isNew: isNew, achieved: false };
    return finishMove(theme, next, entry);
  }

  // 3 材料合成（見 combineTrio）：chosen 必須是 combineTrio 回傳的 options 之一；
  //   有主產物／副產物可選時，entry.otherOption 記下沒選中的那個，供結果畫面提示。
  function applyCombineTrio(theme, state, a, b, c, chosen) {
    if (state.winner) throw new Error("game-over");
    [a, b, c].forEach(function (id) {
      if (state.pool.indexOf(id) < 0) throw new Error("not-in-pool");
    });
    var snap = clone(state);
    snap.prev = null; // 只保留一層復原
    var next = clone(snap);
    next.prev = snap;
    var options = combineTrio(theme, a, b, c).options;
    if (options.indexOf(chosen) < 0) throw new Error("invalid-choice");
    var other = options.length > 1 ? options.filter(function (o) { return o !== chosen; })[0] : null;
    var result = chosen;
    var isNew = next.pool.indexOf(result) < 0;
    if (isNew) next.pool.push(result);
    var p = next.players[next.turn];
    var entry = { round: next.round, playerId: p.id, a: a, b: b, c: c, result: result,
      otherOption: other, isNew: isNew, achieved: false };
    return finishMove(theme, next, entry);
  }

  // 合成後的共同處理：判定達成、記紀錄、判定結束、換下一位。
  //   對戰：只有親手合出自己的任務才算；先全部達成者勝。
  //   合作：合出任一個未達成的共同目標即全隊達成（記在合成者的 done 當作貢獻）；廢料記 1 次失敗；全部達成即結束。
  function finishMove(theme, next, entry) {
    var p = next.players[next.turn];
    var result = entry.result;
    var finished = false;
    if (next.coop) {
      var c = next.coop;
      entry.achieved = c.targets.indexOf(result) >= 0 && c.done.indexOf(result) < 0;
      if (entry.achieved) { c.done.push(result); p.done.push(result); }
      if (theme.junkSet[result]) { c.fails += 1; entry.fail = true; }
      if (c.done.length >= c.targets.length) { next.winner = COOP_WINNER; finished = true; }
    } else {
      entry.achieved = p.targets.indexOf(result) >= 0 && p.done.indexOf(result) < 0;
      if (entry.achieved) p.done.push(result);
      if (p.done.length >= p.targets.length) { next.winner = p.id; finished = true; }
    }
    next.log.push(entry);
    if (!finished) {
      advanceTurn(next);
    }
    return { state: next, entry: entry };
  }

  // 換下一位：跳過已離開的人（2026-11-05 中途離開）；繞回第一位時輪數 +1
  function advanceTurn(next) {
    var n = next.players.length;
    for (var i = 0; i < n; i++) {
      next.turn += 1;
      if (next.turn >= n) { next.turn = 0; next.round += 1; }
      if (!next.players[next.turn].left) return;
    }
  }
  function activeCount(state) { return state.players.filter(function (p) { return !p.left; }).length; }

  // ---------------- 中途加入／離開（2026-11-05 使用者指定） ----------------
  // 座位不刪除（連線手機以座位編號辨識自己），離開＝ players[i].left = true，輪流時跳過；回來＝取消標記。
  // 新玩家排在最後一個座位：對戰模式另外抽 3 個沒人用過的任務（中階 1＋高階 2，亂數序列 "join:<seed>:<座位>"），
  //   合作模式沒有個人任務。上一步的快照也一起改，復原不會把人變回來或趕出去。
  function addPlayer(theme, state, name) {
    if (state.winner) throw new Error("game-over");
    if (state.players.length >= MAX_PLAYERS) throw new Error("gs_join_err_full");
    var next = clone(state), idx = next.players.length;
    var targets = [];
    if (!next.coop) {
      var used = {};
      next.players.forEach(function (p) { p.targets.forEach(function (id) { used[id] = true; }); });
      var rng = makeRng("join:" + next.seed + ":" + idx);
      var pick = function (range, k) {
        return shuffle(theme.items.filter(function (it) {
          return it.cat !== "basic" && !theme.junkSet[it.id] && !used[it.id] && next.pool.indexOf(it.id) < 0 && inRange(it.tier, range);
        }).map(function (it) { return it.id; }), rng).slice(0, k);
      };
      targets = pick(MID_TIERS, 1).concat(pick(HIGH_TIERS, 2));
      if (targets.length < 3) throw new Error("gs_not_enough_targets");
    }
    var p = { id: "p" + (idx + 1), name: String(name || "").slice(0, 20), targets: targets, done: [], joinedRound: next.round };
    next.players.push(p);
    if (next.prev) next.prev.players.push(clone(p));
    if (!next.baseCount) next.baseCount = state.players.length;
    if (next.prev && !next.prev.baseCount) next.prev.baseCount = next.baseCount;
    return { state: next, index: idx };
  }
  function setLeft(state, index, left) {
    if (state.winner) throw new Error("game-over");
    var p = state.players[index];
    if (!p || !!p.left === !!left) throw new Error("gs_join_err_seat");
    if (left && activeCount(state) <= 1) throw new Error("gs_leave_err_last");
    var next = clone(state);
    next.players[index].left = !!left;
    if (next.prev && next.prev.players[index]) next.prev.players[index].left = !!left;
    if (left && next.turn === index) advanceTurn(next);
    return { state: next };
  }
  // 超級控制（密碼由畫面端檢查）：直接指定輪到誰
  function setTurn(state, index) {
    if (state.winner) throw new Error("game-over");
    if (!state.players[index] || state.players[index].left) throw new Error("gs_join_err_seat");
    var next = clone(state);
    next.turn = index;
    return { state: next };
  }

  // 合作模式提前結算：以目前的達成數計分（可復原一層）
  function endCoop(state) {
    if (!state.coop) throw new Error("not-coop");
    if (state.winner) throw new Error("game-over");
    var snap = clone(state);
    snap.prev = null;
    var next = clone(snap);
    next.prev = snap;
    next.coop.ended = true;
    next.winner = COOP_WINNER;
    return { state: next };
  }

  // 合作模式的效率得分：回合數＝目前（或結束時）的輪數，失敗數＝合出廢料的次數。
  //   得分 = round(1000 × 達成數 ÷ (回合數 + 失敗數))；回合越少、失敗越少分數越高，沒有達成任何目標為 0。
  function coopScore(state) {
    var c = state.coop;
    var rounds = state.round;
    var done = c.done.length;
    var score = done ? Math.round(1000 * done / (rounds + c.fails)) : 0;
    return { done: done, total: c.targets.length, rounds: rounds, fails: c.fails, combos: state.log.length,
      score: score, complete: done >= c.targets.length };
  }

  // ---------------- 合作模式的提示（使用者指定 2026-11-04） ----------------
  // 「每合出 10 個廢料，可以有一次提示機會，點目標的物品可以查看配方；配方再點下去還能看到配方的配方」。
  //   提示次數 ＝ floor(失敗數 ÷ 10) − 已用次數；用掉的提示記在 state.coop.hinted（目標 id，全隊共用、會同步）。
  //   解鎖某個目標後，往下展開配方的配方不再扣次數（只是看）。
  var HINT_EVERY_FAILS = 10;

  function coopHints(state) {
    var c = state && state.coop;
    if (!c) return { earned: 0, used: 0, left: 0, toNext: HINT_EVERY_FAILS };
    var earned = Math.floor(c.fails / HINT_EVERY_FAILS);
    var used = (c.hinted || []).length;
    return { earned: earned, used: used, left: Math.max(0, earned - used),
      toNext: HINT_EVERY_FAILS - (c.fails % HINT_EVERY_FAILS) };
  }

  function useCoopHint(state, id) {
    if (!state.coop) throw new Error("not-coop");
    if (state.winner) throw new Error("game-over");
    if (state.coop.targets.indexOf(id) < 0) throw new Error("gs_hint_err_target");
    if ((state.coop.hinted || []).indexOf(id) >= 0) return { state: state };
    if (coopHints(state).left <= 0) throw new Error("gs_hint_err_none");
    var next = clone(state);
    function mark(s) {
      if (!s || !s.coop) return;
      s.coop.hinted = (s.coop.hinted || []).concat([id]);
    }
    mark(next);
    mark(next.prev); // 復原時提示不會被收回（和 clearJunk 一樣同步改上一步的快照）
    return { state: next };
  }

  // 能合出 id 的配方（反查配方表）。回傳 [[a, b], [a, b, c] …]，依「材料都比成品低階」優先、材料階段總和小的優先。
  //   3 材料配方只在 allowTrio 主題才有（成品是主產物或副產物都算）。
  function reverseIndex(theme) {
    if (theme._rev) return theme._rev;
    var rev = {};
    function add(result, ids) { (rev[result] = rev[result] || []).push(ids); }
    Object.keys(theme.recipes).forEach(function (key) { add(theme.recipes[key], key.split("|")); });
    if (theme.allowTrio) {
      Object.keys(theme.trios).forEach(function (key) {
        var r = theme.trios[key];
        add(r[0], key.split("|"));
        if (r[1] && r[1] !== r[0]) add(r[1], key.split("|"));
      });
    }
    theme._rev = rev;
    return rev;
  }

  function recipesFor(theme, id, limit) {
    var it = theme.byId[id];
    if (!it || it.cat === "basic" || theme.junkSet[id]) return [];
    var list = (reverseIndex(theme)[id] || []).slice();
    function tierOf(x) { return theme.byId[x] ? theme.byId[x].tier : 99; }
    function rank(ids) {
      var lower = ids.every(function (x) { return tierOf(x) < it.tier; }) ? 0 : 1000;
      return lower + ids.reduce(function (sum, x) { return sum + tierOf(x); }, 0) + ids.length * 0.1;
    }
    list.sort(function (a, b) { return rank(a) - rank(b) || (a.join("|") < b.join("|") ? -1 : 1); });
    return limit ? list.slice(0, limit) : list;
  }

  function undo(state) { return state && state.prev ? state.prev : null; }

  // 已知會合出廢料的組合：材料本身是廢料，或遊戲紀錄中同一組合（不分順序）合出過廢料。
  // 回傳 { result: 廢料 id 或 null, junkMaterial: 是否因材料是廢料 }；不是已知廢料則回傳 null。
  // 只看紀錄，不偷看配方表，所以不會洩漏「沒試過的組合」是否有配方。
  function knownJunk(theme, state, a, b) {
    if (theme.junkSet[a] || theme.junkSet[b]) return { result: null, junkMaterial: true };
    var key = pairKey(a, b);
    for (var i = state.log.length - 1; i >= 0; i--) {
      var e = state.log[i];
      if (theme.junkSet[e.result] && !e.c && pairKey(e.a, e.b) === key) return { result: e.result, junkMaterial: false };
    }
    return null;
  }

  // 3 材料版的 knownJunk（見上）：只看 state.log 中同樣帶 c 的紀錄，判斷依據同上。
  function knownJunkTrio(theme, state, a, b, c) {
    if (theme.junkSet[a] || theme.junkSet[b] || theme.junkSet[c]) return { result: null, junkMaterial: true };
    var key = tripleKey(a, b, c);
    for (var i = state.log.length - 1; i >= 0; i--) {
      var e = state.log[i];
      if (theme.junkSet[e.result] && e.c && tripleKey(e.a, e.b, e.c) === key) return { result: e.result, junkMaterial: false };
    }
    return null;
  }

  // 合作模式的「這個組合合過了」提示（使用者指定 2026-11-04）：遊戲紀錄中同一組合（不分順序；2／3 材料分開算）
  //   合出過的結果。紀錄是全隊共用的 state.log，所以別台裝置合過的也算。只看紀錄、不偷看配方表。
  //   c 省略＝2 材料。回傳 { results: [合出過的結果], others: [3 材料二選一時沒選、也還不在池子裡的另一個結果] } 或 null。
  function knownCombo(theme, state, a, b, c) {
    var trio = !!c, key = trio ? tripleKey(a, b, c) : pairKey(a, b), results = [], others = [];
    state.log.forEach(function (e) {
      if (!!e.c !== trio || (trio ? tripleKey(e.a, e.b, e.c) : pairKey(e.a, e.b)) !== key) return;
      if (results.indexOf(e.result) < 0) results.push(e.result);
      if (e.otherOption && others.indexOf(e.otherOption) < 0) others.push(e.otherOption);
    });
    if (!results.length) return null;
    others = others.filter(function (id) { return results.indexOf(id) < 0 && state.pool.indexOf(id) < 0; });
    return { results: results, others: others };
  }

  // 合作模式選了材料之後，池子裡「再選它就會湊成合過的組合」的物品（使用者指定 2026-11-04，畫面上調暗提示）：
  //   選了 1 個 → 紀錄中和它一起合過（2 材料）的另一個；選了 2 個（3 材料主題）→ 紀錄中和這兩個一起合過（3 材料）的第 3 個。
  //   只看共用的 state.log（別台裝置合的也算）。回傳 { id: true }。
  function comboPartners(state, picked) {
    var out = {};
    picked = (picked || []).filter(function (id) { return id; });
    if (!picked.length || picked.length > 2) return out;
    state.log.forEach(function (e) {
      var ids = e.c ? [e.a, e.b, e.c] : [e.a, e.b];
      if (ids.length !== picked.length + 1) return;
      var rest = ids.slice();
      for (var i = 0; i < picked.length; i++) {
        var k = rest.indexOf(picked[i]);
        if (k < 0) return;
        rest.splice(k, 1);
      }
      out[rest[0]] = true;
    });
    return out;
  }

  // 把廢料移出池子（不算回合）。上一步的快照也一併清掉，復原時廢料不會跑回來。
  function clearJunk(theme, state) {
    var next = clone(state);
    function strip(s) { s.pool = s.pool.filter(function (id) { return !theme.junkSet[id]; }); }
    strip(next);
    if (next.prev) strip(next.prev);
    return next;
  }

  // 分別裝置模式：手機只需要主題、seed、人數、自己的編號，就能算出自己的任務（不同步）
  // 中途加入的座位（index ≥ 開局人數）一律搭配房間使用，人數寫目前的人數；原本的座位維持開局人數，手機算出的任務不變
  function joinParam(state, index) {
    var base = state.baseCount || state.players.length;
    return [state.themeId, state.seed, index < base ? base : state.players.length, index].join(".");
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
  // 同音字（雷加水 → 累家稅）靠拼音比對：setPinyin() 載入「拼音 → 漢字」表（static_src/gousei_pinyin.js）後，
  //   每個字轉成寬鬆化的無聲調拼音，名稱與辨識結果在「字」與「拼音」兩種層次都比對，取較高者。
  // 正規化後一個字對應一個 token，所以字串位置與 token 位置一致，可以直接用同一個 index 切開。

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }

  function normSpeech(s) {
    return toHiragana(String(s || "").toLowerCase()).replace(/[\s、。，,.．!！?？「」『』・…~〜"'“”:：;；]/g, "");
  }

  var pinyinOf = null; // 字 → 寬鬆拼音；setPinyin() 之後才有

  // 台灣口音常見的混用：zh/ch/sh ≈ z/c/s、ing/eng ≈ in/en、n ≈ l
  function fuzzySyllable(s) {
    return s.replace(/^([zcs])h/, "$1").replace(/([ie])ng$/, "$1n").replace(/^n(?=[aeiouv])/, "l");
  }

  function setPinyin(table) {
    pinyinOf = {};
    Object.keys(table || {}).forEach(function (py) {
      var f = fuzzySyllable(py);
      var chars = table[py];
      for (var i = 0; i < chars.length; i++) pinyinOf[chars.charAt(i)] = f;
    });
  }

  function tokens(n) {
    var out = [];
    for (var i = 0; i < n.length; i++) {
      var c = n.charAt(i);
      out.push(pinyinOf && pinyinOf[c] ? pinyinOf[c] : c);
    }
    return out;
  }

  function levenshtein(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // ---- 音節的「聽起來像不像」 ----
  // 辨識器會把聽不懂的外語音節換成任意同類音（yo アキ → 幼兒體：a→兒、ki→體），
  // 所以喚醒詞以「聲母類別 × 韻母類別」比對，而不是列舉寫法。
  var PY_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
  var INITIAL_CLASS = { j: "jqx", q: "jqx", x: "jqx", z: "zcs", c: "zcs", s: "zcs", d: "dt", t: "dt", g: "gkh", k: "gkh", h: "gkh",
    b: "bp", p: "bp", m: "mnl", n: "mnl", l: "mnl", f: "f", r: "r", y: "zero", w: "zero", "": "zero" };
  var FINAL_CLASS = { i: "i", ei: "i", ie: "i", o: "o", ou: "o", ao: "o", uo: "o", ong: "o", iu: "o", iao: "o",
    a: "a", ai: "a", an: "a", ang: "a", ia: "a", e: "e", er: "e", en: "e", eng: "e", u: "u", ui: "u", un: "u", v: "u", ue: "u" };

  function splitSyllable(s) {
    if (!/^[a-z]+$/.test(s)) return null;
    for (var i = 0; i < PY_INITIALS.length; i++) {
      var ini = PY_INITIALS[i];
      if (s.length > ini.length && s.indexOf(ini) === 0) return [ini, s.slice(ini.length)];
    }
    return ["", s];
  }

  function partCost(a, b, classes) {
    if (a === b) return 0;
    return classes[a] && classes[a] === classes[b] ? 0.5 : 1;
  }

  // 0＝相同、0.5＝聲母或韻母只差同類、1＝不像
  function syllableCost(a, b) {
    if (a === b) return 0;
    var x = splitSyllable(a), y = splitSyllable(b);
    if (!x || !y) return 1;
    return Math.max(partCost(x[0], y[0], INITIAL_CLASS), partCost(x[1], y[1], FINAL_CLASS));
  }

  function levenshteinCost(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + syllableCost(a[i - 1], b[j - 1])));
      prev = cur;
    }
    return prev[b.length];
  }

  function syllableIs(s, initials, finalClasses) {
    var p = splitSyllable(s);
    return !!p && initials.indexOf(p[0]) >= 0 && finalClasses.indexOf(FINAL_CLASS[p[1]]) >= 0;
  }

  // 喚醒詞「yo, アキ」。
  //   字面：「秋」「亜紀」等一般詞彙（物體名稱也有「秋」）必須前面接 yo 才算。
  //   拼音：yo（零聲母／y ＋ o 類韻母：有、要、幼、喲）＋ a（零聲母母音：阿、啊、兒、愛）
  //        ＋ ki（j q x d t g k ＋ i／ei：基、奇、西、體、地、幾）。z c s（子、十）不算，避免「有兒子」「有二十」。
  //   英文：「yo aki」「you a key」。
  //   訓練：玩家自己說過的喚醒詞（templates，見 matchWakeTemplates）。
  var WAKE_YO = ["yo", "よー", "よう", "よぉ", "よ", "ヨ", "夜", "陽", "洋", "喲", "唷", "呦", "哟"].map(normSpeech);
  var WAKE_AKI = ["aki", "アキ", "阿基", "阿奇", "阿琪", "阿吉", "阿姬", "阿紀", "阿祺", "阿齊", "阿琦", "阿岐"].map(normSpeech);
  var WAKE_AKI_WEAK = ["秋", "亜紀", "亜希", "安芸", "阿木", "明", "空き", "飽き"].map(normSpeech);
  var WAKE_KANA = /(よ[うーぉお]?|ゆ[うー]?|お)[ー]?[あわ][ー]?(き|ち|け|ぎ|てぃ)/;
  var WAKE_LATIN = /(yo|you|yoh)(a|ah)?(ki|key|kee|chi|qi)/;
  var WAKE_LATIN_START = /^(aki|akey|akee)/;

  function isWakeYo(s) { return syllableIs(s, ["", "y"], ["o"]); }
  function isWakeA(s) { return syllableIs(s, [""], ["a", "e", "o"]); }
  function isWakeKi(s) { return syllableIs(s, ["j", "q", "x", "d", "t", "g", "k"], ["i"]); }

  // 訓練過的喚醒詞：在辨識結果裡找與任一範本「拼音距離」夠近的片段。
  // 3 音節以下只容許同類音的差異（距離 ≤ 0.5）；4 音節以上容許差一個音節。朗讀中只接受完全一致。
  function matchWakeTemplates(n, templates, strict) {
    if (!templates || !templates.length) return null;
    var t = tokens(n);
    var best = null;
    templates.forEach(function (tp) {
      var tt = tokens(normSpeech(tp));
      var L = tt.length;
      if (!L) return;
      var allowed = strict ? 0 : (L >= 4 ? 1 : (L >= 2 ? 0.5 : 0));
      for (var w = Math.max(1, L - 1); w <= L + 1; w++) {
        for (var i = 0; i + w <= t.length; i++) {
          var d = levenshteinCost(t.slice(i, i + w), tt);
          if (d <= allowed && (!best || d < best.d || (d === best.d && i < best.i))) best = { d: d, i: i, end: i + w };
        }
      }
    });
    return best ? { rest: n.slice(best.end) } : null;
  }

  // strict = 朗讀中：喇叭的聲音可能被收音，只接受有 yo 開頭的完整喚醒詞
  function detectWake(text, strict, templates) {
    var n = normSpeech(text);
    var trained = matchWakeTemplates(n, templates, strict);
    if (trained) return trained;
    // 字面
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
    // 假名（日文辨識）
    var m = WAKE_KANA.exec(n);
    if (m) return { rest: n.slice(m.index + m[0].length) };
    // 拼音
    if (pinyinOf) {
      var t = tokens(n);
      for (var i = 0; i + 2 < t.length; i++) {
        if (isWakeYo(t[i]) && isWakeA(t[i + 1]) && isWakeKi(t[i + 2])) return { rest: n.slice(i + 3) };
      }
      // 「亞基」（yo+a 連在一起）、「阿吉」（沒聽到 yo）：只在開頭、且不是朗讀中才算
      if (!strict && t.length >= 2 && (t[0] === "ya" || isWakeA(t[0])) && isWakeKi(t[1])) return { rest: n.slice(2) };
    }
    // 英文
    m = WAKE_LATIN.exec(n);
    if (m) return { rest: n.slice(m.index + m[0].length) };
    if (!strict) {
      m = WAKE_LATIN_START.exec(n);
      if (m) return { rest: n.slice(m[0].length) };
    }
    return null;
  }

  var COMBO_SEPS = ["加上", "加", "和", "跟", "與", "与", "配上", "配", "+", "＋", "プラス", "たす", "足す", "と", "plus", "and"].map(normSpeech);
  // 同音的分隔詞（家、佳、河、根…）：拼音一致就當作分隔候選，切錯的位置會因為比對分數低而被淘汰
  var COMBO_SEPS_PY = [["jia", "shang"], ["jia"], ["he"], ["gen"], ["yu"]].map(function (s) { return s.map(fuzzySyllable); });
  var COMBO_HEAD = ["我要", "我想", "請", "把"].map(normSpeech);
  var COMBO_TAIL = ["を合成してください", "を合成して", "を合成", "合成してください", "合成して", "してください", "合成", "して",
    "ください", "です", "吧", "で"].map(normSpeech);
  var COMBO_MIN_SCORE = 0.6;
  var PINYIN_PENALTY = 0.05; // 只有讀音一樣時，略低於字面完全一致

  // 池子編號（1 起算，＝池子順序）：「3」「三」「第三個」「7號」「3番」。數字是辨識最穩定的內容。
  var CN_DIGITS = { "零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };

  function parseSpokenNumber(s) {
    s = s.replace(/^(第|だい)/, "").replace(/(號|号|個|个|番目|番|ばんめ|ばん)$/, "");
    if (/^[0-9０-９]+$/.test(s)) {
      return parseInt(s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); }), 10);
    }
    if (!s || !/^[零〇一二兩两三四五六七八九十百]+$/.test(s)) return null;
    var total = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "十") { total += (cur || 1) * 10; cur = 0; }
      else if (c === "百") { total += (cur || 1) * 100; cur = 0; }
      else cur = CN_DIGITS[c];
    }
    return total + cur;
  }

  // 確認提問的回答：true＝對、false＝不對、null＝都不是。否定詞先判斷（「不對」含「對」）
  var ANSWER_NO = ["不", "錯", "错", "取消", "いいえ", "ちがう", "違", "だめ", "やめ", "no"].map(normSpeech);
  var ANSWER_YES = ["對", "对", "是", "好", "確定", "确定", "沒錯", "可以", "嗯", "合成", "はい", "うん", "そう", "ええ", "おっけー",
    "ok", "yes"].map(normSpeech);

  function parseYesNo(text) {
    var n = normSpeech(text);
    if (!n) return null;
    for (var i = 0; i < ANSWER_NO.length; i++) if (n.indexOf(ANSWER_NO[i]) >= 0) return false;
    for (var j = 0; j < ANSWER_YES.length; j++) if (n.indexOf(ANSWER_YES[j]) >= 0) return true;
    return null;
  }

  // 「A 加 B」→ 池子裡最像的兩個物體（廢料不列入候選）。各段也可以是池子編號（「3 加 7」）。
  // 回傳的 exact＝兩段都是字面完全一致或編號；只靠讀音或近似比對時為 false（UI 會先確認再合成）。
  // 每一段的相似度（字面或拼音的 1−編輯距離／長度）都要 ≥ 0.6（兩個字錯一個不算），否則回傳 null。
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
    var nt = tokens(n);
    var cands = [];
    function addCand(id, name) {
      var s = normSpeech(name);
      if (s) cands.push({ id: id, s: s, t: tokens(s) });
    }
    pool.forEach(function (id) {
      if (theme.junkSet[id] || !theme.byId[id]) return;
      var it = theme.byId[id];
      addCand(id, it.zh);
      if (it.ja !== it.zh) addCand(id, it.ja);
    });
    var memo = {};
    function bestFor(from, to) {
      var key = from + ":" + to;
      if (memo.hasOwnProperty(key)) return memo[key];
      var s = n.slice(from, to), t = nt.slice(from, to);
      var best = null;
      var num = parseSpokenNumber(s);
      if (num !== null && num >= 1 && num <= pool.length && !theme.junkSet[pool[num - 1]] && theme.byId[pool[num - 1]]) {
        memo[key] = { id: pool[num - 1], score: 1 };
        return memo[key];
      }
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var len = Math.max(s.length, c.s.length);
        if (Math.abs(s.length - c.s.length) > len / 2) continue;
        var score = s === c.s ? 1 : 1 - levenshtein(s, c.s) / len;
        if (pinyinOf && score < 1) score = Math.max(score, 1 - levenshtein(t, c.t) / len - PINYIN_PENALTY);
        if (!best || score > best.score) best = { id: c.id, score: score };
      }
      memo[key] = best;
      return best;
    }
    var result = null;
    function trySplit(at, sepLen, exactOnly) {
      if (at <= 0 || at + sepLen >= n.length) return;
      var a = bestFor(0, at), b = bestFor(at + sepLen, n.length);
      if (!a || !b) return;
      var min = Math.min(a.score, b.score);
      if (exactOnly && min < 1 - PINYIN_PENALTY) return;
      var score = min + (a.score + b.score) / 1000;
      if (min >= COMBO_MIN_SCORE && (!result || score > result.score)) result = { a: a.id, b: b.id, score: score, exact: min >= 1 };
    }
    COMBO_SEPS.forEach(function (sep) {
      var idx = n.indexOf(sep, 1);
      while (idx > 0) {
        trySplit(idx, sep.length, false);
        idx = n.indexOf(sep, idx + 1);
      }
    });
    if (pinyinOf) {
      COMBO_SEPS_PY.forEach(function (sep) {
        for (var i = 1; i + sep.length < nt.length; i++) {
          var hit = true;
          for (var k = 0; k < sep.length; k++) if (nt[i + k] !== sep[k]) { hit = false; break; }
          if (hit) trySplit(i, sep.length, false);
        }
      });
    }
    // 沒說「加」：例如「火水」，只接受兩段都完全一致（讀音一致也可）
    for (var i = 1; i < n.length; i++) trySplit(i, 0, true);
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
    tripleKey: tripleKey,
    indexTheme: indexTheme,
    combine: combine,
    combineTrio: combineTrio,
    dealTargets: dealTargets,
    dealCoopTargets: dealCoopTargets,
    COOP_WINNER: COOP_WINNER,
    endCoop: endCoop,
    coopScore: coopScore,
    addPlayer: addPlayer,
    setLeft: setLeft,
    setTurn: setTurn,
    activeCount: activeCount,
    HINT_EVERY_FAILS: HINT_EVERY_FAILS,
    coopHints: coopHints,
    useCoopHint: useCoopHint,
    recipesFor: recipesFor,
    newGame: newGame,
    currentPlayer: currentPlayer,
    applyCombine: applyCombine,
    applyCombineTrio: applyCombineTrio,
    undo: undo,
    knownJunk: knownJunk,
    knownJunkTrio: knownJunkTrio,
    knownCombo: knownCombo,
    comboPartners: comboPartners,
    clearJunk: clearJunk,
    joinParam: joinParam,
    parseJoin: parseJoin,
    normSpeech: normSpeech,
    detectWake: detectWake,
    parseVoiceCombo: parseVoiceCombo,
    setPinyin: setPinyin,
    parseSpokenNumber: parseSpokenNumber,
    parseYesNo: parseYesNo
  };
})();
