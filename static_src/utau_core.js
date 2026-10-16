// 我不會唱歌（utau）規則引擎：純函式，不碰 DOM／localStorage，方便用 node 測試。
//
// 計分規則（使用者指定）：
//   本輪答對人數 k（不含出題者、不含 AI）→ 查計分表 scoreTable[k]
//   ・k > 0：出題者與每位答對者各得 scoreTable[k]
//   ・k = 0（全部答錯）：只有出題者得 scoreTable[0]
//   ・AI 答對：出題者另得 aiBonus
// 抽人規則：每一輪隨機抽一位出題者，抽完一圈之前不重複。
// 模式：basic（出題者自己唱）／advanced（播放題庫包音檔）／dream（出題者給 YouTube 連結，播隨機一段）
// 提示（使用者指定，2026-10-17）：有提示音檔的版本（中文歌聲 → 加上伴奏），本輪播放滿 HINT_PLAYS 次後才能使用；
//   使用提示不影響計分，只在紀錄中標示。
(function () {
  "use strict";

  var Songs = window.PriTestUtauSongs;

  var HINT_PLAYS = 5;

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

  function pick(obj, keys) {
    if (!obj) return null;
    var out = {};
    keys.forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

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

  // 進階模式：題庫包裡可播放的版本（original 只在公布答案時用）
  function playableVariants(config, song) {
    return (song.variants || []).filter(function (v) { return v !== "original" && config.variants.indexOf(v) >= 0; });
  }

  // 進階模式的歌曲池：題庫包歌曲 × 地區 × 年代 × 分類 × 至少有一個勾選的版本
  function songPool(config) {
    var decadeOf = Songs ? Songs.decadeOf : function (s) { return Math.floor(s.y / 10) * 10; };
    return (config.packSongs || []).filter(function (s) {
      return config.regions.indexOf(s.r) >= 0 && config.decades.indexOf(decadeOf(s)) >= 0 &&
        config.categories.indexOf(s.c) >= 0 && playableVariants(config, s).length > 0;
    });
  }

  function findPackSong(config, id) {
    var list = config.packSongs || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function validateConfig(config) {
    if (!config.players || config.players.length < 2) throw new Error("ut_err_players");
    if (config.scoreTable.length !== config.players.length) throw new Error("ut_err_table");
    if (config.mode === "advanced") {
      if (!config.packSongs || !config.packSongs.length) throw new Error("ut_err_no_pack");
      if (!config.variants.length) throw new Error("ut_err_variants");
      if (!songPool(config).length) throw new Error("ut_err_pool");
    }
    if (config.mode === "dream") {
      var sec = Number(config.clipSeconds);
      if (!(sec >= 5 && sec <= 60)) throw new Error("ut_err_clip_seconds");
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

  // 抽歌：用過的歌整池用完前不重複；版本從這首歌有的、且有勾選的版本中隨機
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
    var variants = playableVariants(s.config, song);
    s.current.songId = song.id;
    s.current.variant = variants[Math.floor(rand(rng) * variants.length)];
    s.current.plays = 0;
    s.current.hint = false;
  }

  // 夢想模式：每輪的播放速度（開「隨機變速」時 0.75 或 1.25 倍）
  function drawRate(s, rng) {
    if (!s.config.randomSpeed) return 1;
    return rand(rng) < 0.5 ? 0.75 : 1.25;
  }

  function startRound(s, rng) {
    var singerId = drawSinger(s, rng);
    s.round += 1;
    s.current = { singerId: singerId, songId: null, variant: null, dream: null, plays: 0, hint: false };
    if (s.config.mode === "advanced") drawSong(s, rng);
    if (s.config.mode === "dream") s.current.dream = { videoId: null, start: null, rate: drawRate(s, rng), title: "" };
  }

  function createGame(config, rng) {
    validateConfig(config);
    var s = {
      version: 2,
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
      variant: cur.variant,
      song: cur.songId ? pick(findPackSong(s.config, cur.songId), ["t", "a", "y", "r", "c"]) : null,
      dream: cur.dream ? { videoId: cur.dream.videoId, title: cur.dream.title } : null,
      aiCorrect: !!result.aiCorrect,
      correctIds: correctIds,
      deltas: deltas,
      hint: !!cur.hint
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

  // ---- 提示 ----

  // 這個版本的提示音檔名稱（例：zh_sing → zh_sing_inst），沒有提示則為 null
  function hintClip(variantId) {
    var v = Songs && Songs.variant ? Songs.variant(variantId) : null;
    return v && v.hint ? v.hint : null;
  }

  // 本輪有沒有提示可用（不論是否已解鎖）：版本有提示，且這首歌的題庫包裡有提示音檔
  function hasHint(state) {
    var cur = state.current;
    if (!cur || state.config.mode !== "advanced" || !cur.songId) return false;
    var clip = hintClip(cur.variant);
    var song = findPackSong(state.config, cur.songId);
    return !!(clip && song && (song.variants || []).indexOf(clip) >= 0);
  }

  // 還要再播幾次才能用提示（0＝已可使用）
  function playsUntilHint(state) {
    return Math.max(0, HINT_PLAYS - ((state.current && state.current.plays) || 0));
  }

  function hintAvailable(state) {
    return hasHint(state) && playsUntilHint(state) === 0;
  }

  // 按一次「播放」
  function recordPlay(state) {
    var s = clone(state);
    s.current.plays = (s.current.plays || 0) + 1;
    return s;
  }

  // 使用提示（未解鎖時不動作）
  function useHint(state) {
    if (!hintAvailable(state)) return state;
    var s = clone(state);
    s.current.hint = true;
    return s;
  }

  // 出題者沒換、只重抽歌（或演唱方式）
  function redrawSong(state, rng) {
    if (state.config.mode !== "advanced") return state;
    var s = clone(state);
    drawSong(s, rng);
    return s;
  }

  // 夢想模式：更新本輪的 YouTube 題目（videoId／起點／標題）
  function setDream(state, patch) {
    var s = clone(state);
    if (!s.current.dream) return s;
    Object.keys(patch).forEach(function (k) { s.current.dream[k] = patch[k]; });
    return s;
  }

  // 夢想模式：在影片中段隨機挑起點（避開前 15% 與最後 clip 秒＋10%）
  function randomStart(duration, clipSeconds, rng) {
    var lo = duration * 0.15;
    var hi = duration * 0.9 - clipSeconds;
    if (hi <= lo) return Math.max(0, Math.floor((duration - clipSeconds) / 2));
    return Math.floor(lo + rand(rng) * (hi - lo));
  }

  // YouTube 網址 → videoId（watch?v=、youtu.be、shorts、embed、live、music.youtube 都支援）
  function parseYoutubeId(input) {
    var text = String(input || "").trim();
    if (/^[\w-]{11}$/.test(text)) return text;
    var m = text.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
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
    findPackSong: findPackSong,
    setDream: setDream,
    randomStart: randomStart,
    parseYoutubeId: parseYoutubeId,
    createGame: createGame,
    computeDeltas: computeDeltas,
    settle: settle,
    undo: undo,
    redrawSong: redrawSong,
    HINT_PLAYS: HINT_PLAYS,
    hintClip: hintClip,
    hasHint: hasHint,
    playsUntilHint: playsUntilHint,
    hintAvailable: hintAvailable,
    recordPlay: recordPlay,
    useHint: useHint,
    finish: finish,
    ranking: ranking
  };
})();
