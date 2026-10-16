// 我不會唱歌（utau）規則引擎：純函式，不碰 DOM／localStorage，方便用 node 測試。
//
// 計分規則（使用者指定）：
//   本輪答對人數 k（不含出題者、不含 AI）→ 查計分表 scoreTable[k]
//   ・k > 0：出題者與每位答對者各得 scoreTable[k]
//   ・k = 0（全部答錯）：只有出題者得 scoreTable[0]
//   ・AI 答對：出題者另得 aiBonus
// 抽人規則：每一輪隨機抽一位出題者，抽完一圈之前不重複。
(function () {
  "use strict";

  var Songs = window.PriTestUtauSongs;

  function rand(rng) { return rng ? rng() : Math.random(); }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand(rng) * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // 預設計分表：index = 答對人數（0 = 全部答錯，guessers = 全部答對）
  // 少數人答對 3 分、多數人答對 2 分、全部答對 1 分、全部答錯 0 分
  function defaultScoreTable(playerCount) {
    var guessers = Math.max(1, playerCount - 1);
    var table = [];
    for (var k = 0; k <= guessers; k++) {
      if (k === 0) table.push(0);
      else if (k === guessers) table.push(1);
      else if (k <= Math.ceil(guessers / 2)) table.push(3);
      else table.push(2);
    }
    return table;
  }

  // 進階模式的歌曲池
  function songPool(config) {
    if (!Songs) return [];
    return Songs.songs.filter(function (s) {
      return config.regions.indexOf(s.r) >= 0 && config.decades.indexOf(Songs.decadeOf(s)) >= 0;
    });
  }

  function validateConfig(config) {
    if (!config.players || config.players.length < 2) throw new Error("ut_err_players");
    if (config.scoreTable.length !== config.players.length) throw new Error("ut_err_table");
    if (config.mode === "advanced") {
      if (!config.styles.length) throw new Error("ut_err_styles");
      if (!songPool(config).length) throw new Error("ut_err_pool");
    }
  }

  // 抽下一位出題者：本圈用完就重新洗牌，並避免新的一圈第一位跟上一位相同
  function drawSinger(s, rng) {
    if (!s.queue.length) {
      var ids = s.config.players.map(function (p) { return p.id; });
      var q = shuffle(ids, rng);
      var last = s.current ? s.current.singerId : null;
      if (q.length > 1 && q[0] === last) {
        var tmp = q[0]; q[0] = q[1]; q[1] = tmp;
      }
      s.queue = q;
    }
    return s.queue.shift();
  }

  // 抽歌：用過的歌整池用完前不重複
  function drawSong(s, rng) {
    var pool = songPool(s.config);
    var fresh = pool.filter(function (song) { return s.usedSongs.indexOf(song.id) < 0; });
    if (!fresh.length) {
      var poolIds = pool.map(function (song) { return song.id; });
      s.usedSongs = s.usedSongs.filter(function (id) { return poolIds.indexOf(id) < 0; });
      fresh = pool;
    }
    var song = fresh[Math.floor(rand(rng) * fresh.length)];
    s.usedSongs.push(song.id);
    return song.id;
  }

  function drawStyle(s, rng) {
    var styles = s.config.styles;
    return styles[Math.floor(rand(rng) * styles.length)];
  }

  function startRound(s, rng) {
    var singerId = drawSinger(s, rng);
    s.round += 1;
    s.current = { singerId: singerId, songId: null, style: null };
    if (s.config.mode === "advanced") {
      s.current.songId = drawSong(s, rng);
      s.current.style = drawStyle(s, rng);
    }
  }

  function createGame(config, rng) {
    validateConfig(config);
    var s = {
      version: 1,
      config: clone(config),
      scores: {},
      queue: [],
      usedSongs: [],
      round: 0,
      current: null,
      history: [],
      prev: null,
      finished: false
    };
    config.players.forEach(function (p) { s.scores[p.id] = 0; });
    startRound(s, rng);
    return s;
  }

  // 本輪各人得分（不改 state，結算預覽也用這個）
  function computeDeltas(config, singerId, aiCorrect, correctIds) {
    var deltas = {};
    config.players.forEach(function (p) { deltas[p.id] = 0; });
    var valid = correctIds.filter(function (id) { return id !== singerId && deltas.hasOwnProperty(id); });
    var k = valid.length;
    var pts = Number(config.scoreTable[k]) || 0;
    deltas[singerId] += pts;
    valid.forEach(function (id) { deltas[id] += pts; });
    if (aiCorrect) deltas[singerId] += Number(config.aiBonus) || 0;
    return deltas;
  }

  // 結算本輪並自動開始下一輪
  function settle(state, result, rng) {
    if (state.finished) throw new Error("ut_err_finished");
    var s = clone(state);
    var prevSnapshot = clone(state);
    prevSnapshot.prev = null; // 只保留一層復原
    var cur = s.current;
    var correctIds = (result.correctIds || []).filter(function (id) { return id !== cur.singerId; });
    var deltas = computeDeltas(s.config, cur.singerId, !!result.aiCorrect, correctIds);
    Object.keys(deltas).forEach(function (id) { s.scores[id] += deltas[id]; });
    s.history.push({
      round: s.round,
      singerId: cur.singerId,
      songId: cur.songId,
      style: cur.style,
      aiCorrect: !!result.aiCorrect,
      correctIds: correctIds,
      deltas: deltas
    });
    s.prev = prevSnapshot;
    startRound(s, rng);
    return s;
  }

  // 復原上一次結算
  function undo(state) {
    if (!state.prev) throw new Error("ut_err_no_undo");
    return clone(state.prev);
  }

  // 出題者沒換、只重抽歌（或演唱方式）
  function redrawSong(state, rng) {
    if (state.config.mode !== "advanced") return state;
    var s = clone(state);
    s.current.songId = drawSong(s, rng);
    s.current.style = drawStyle(s, rng);
    return s;
  }

  function finish(state) {
    var s = clone(state);
    s.finished = true;
    return s;
  }

  // 名次（同分同名次）
  function ranking(state) {
    var list = state.config.players.map(function (p) {
      return { id: p.id, name: p.name, score: state.scores[p.id] };
    });
    list.sort(function (a, b) { return b.score - a.score; });
    var rank = 0;
    list.forEach(function (row, i) {
      if (i === 0 || row.score !== list[i - 1].score) rank = i + 1;
      row.rank = rank;
    });
    return list;
  }

  window.PriTestUtauCore = {
    defaultScoreTable: defaultScoreTable,
    songPool: songPool,
    createGame: createGame,
    computeDeltas: computeDeltas,
    settle: settle,
    undo: undo,
    redrawSong: redrawSong,
    finish: finish,
    ranking: ranking
  };
})();
