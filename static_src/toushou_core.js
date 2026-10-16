// 東正小遊戲（toushou）規則引擎。純邏輯，不碰 DOM。
// 所有狀態變更都經過 reduce(state, action)：先深複製再修改，回傳新 state；無效 action 時
// throw new Error(<i18n key>)。
// 隨機性只來自 state.rng（mulberry32），使同一串 action 在任何裝置上結果一致
// （第 2 階段多裝置同步需要這個特性）。
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
(function () {
  "use strict";

  var D = window.PriTestToushouData;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // mulberry32：推進 holder.rng 並回傳 [0,1) 的數
  function rand(holder) {
    holder.rng = (holder.rng + 0x6D2B79F5) >>> 0;
    var t = holder.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(holder, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand(holder) * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---------------- 資料查詢 ----------------

  function categoryById(id) {
    for (var i = 0; i < D.CATEGORIES.length; i++) if (D.CATEGORIES[i].id === id) return D.CATEGORIES[i];
    return null;
  }

  function cardById(id) {
    for (var i = 0; i < D.NEWS_CARDS.length; i++) if (D.NEWS_CARDS[i].id === id) return D.NEWS_CARDS[i];
    return null;
  }

  function roleFor(category) {
    var c = categoryById(category);
    return c ? c.role : D.CATEGORIES[0].role;
  }

  function pickRandomTargets(categoryIds, count, seed) {
    var holder = { rng: seed >>> 0 };
    var pool = D.TARGETS.filter(function (t) { return categoryIds.indexOf(t.category) >= 0; });
    return shuffle(holder, pool).slice(0, count).map(function (t) {
      return {
        category: t.category,
        name: clone(t.name),
        summary: clone(t.summary),
        tags: clone(t.tags),
        hooks: clone(t.hooks),
        custom: false,
        sourceId: t.id
      };
    });
  }

  function defaultMinBet(chipsMode, chips) {
    if (chipsMode === "same") return Math.max(1, Math.floor(chips / 10));
    return 100;
  }

  // ---------------- 開局 ----------------

  function buildWindDeck(holder) {
    var arr = [];
    Object.keys(D.WIND_COMPOSITION).forEach(function (k) {
      for (var i = 0; i < D.WIND_COMPOSITION[k]; i++) arr.push(k);
    });
    return shuffle(holder, arr);
  }

  // 從牌堆抽 1 張；牌堆空時把棄牌堆洗回；兩者皆空回傳 null
  function drawCard(s) {
    if (!s.deck.length && s.discard.length) {
      s.deck = shuffle(s, s.discard);
      s.discard = [];
    }
    return s.deck.length ? s.deck.pop() : null;
  }

  function playerById(s, id) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === id) return s.players[i];
    return null;
  }

  function newGame(config) {
    var s = {
      version: 1,
      phase: "reveal_target",
      config: {
        missionsEnabled: !!config.missionsEnabled,
        windEnabled: !!config.windEnabled,
        minBet: config.minBet,
        deltaMode: config.deltaMode === "vote" ? "vote" : "host",
        voteCap: isInt(config.voteCap) ? config.voteCap : 100
      },
      players: [],
      deck: [],
      discard: [],
      windDeck: [],
      targets: [],
      targetIndex: 0,
      current: null,
      history: [],
      lastSettlement: null,
      missionsSeen: {},
      rng: config.seed >>> 0
    };
    config.players.forEach(function (p, i) {
      s.players.push({ id: "p" + i, name: p.name, chips: p.chips, hand: [], mission: null });
    });
    config.targets.forEach(function (t, i) {
      s.targets.push({
        id: "t" + i,
        category: t.category,
        name: t.name,
        summary: t.summary || null,
        tags: t.tags || [],
        hooks: t.hooks || [],
        custom: !!t.custom
      });
    });

    // 牌池＝通用牌＋本局出現過的類別的專屬牌；張數不足「人數 × 6」時整副複製 k 份
    var cats = [];
    s.targets.forEach(function (t) { if (cats.indexOf(t.category) < 0) cats.push(t.category); });
    var pool = D.NEWS_CARDS.filter(function (c) { return c.category === null || cats.indexOf(c.category) >= 0; })
      .map(function (c) { return c.id; });
    var k = Math.max(1, Math.ceil(s.players.length * 6 / pool.length));
    var ids = [];
    for (var c = 0; c < k; c++) ids = ids.concat(pool);
    s.deck = shuffle(s, ids);
    for (var r = 0; r < D.HAND_SIZE; r++) {
      s.players.forEach(function (p) {
        var card = drawCard(s);
        if (card) p.hand.push(card);
      });
    }
    s.windDeck = buildWindDeck(s);

    if (s.config.missionsEnabled) {
      var missions = shuffle(s, D.MISSIONS);
      s.players.forEach(function (p, i) {
        var m = missions[i % missions.length];
        var params = clone(m.params);
        if (Object.prototype.hasOwnProperty.call(params, "category") && params.category === null) {
          params.category = cats[Math.floor(rand(s) * cats.length)];
        }
        p.mission = { id: m.id, params: params };
      });
      s.phase = "missions";
    }
    return s;
  }

  // ---------------- 任務確認 ----------------

  function pendingMissionViewers(s) {
    if (s.phase !== "missions") return [];
    var seen = s.missionsSeen || {};
    return s.players.filter(function (p) { return !seen[p.id]; }).map(function (p) { return p.id; });
  }

  function missionSeen(s, a) {
    if (pendingMissionViewers(s).indexOf(a.playerId) < 0) throw new Error("ts_err_not_your_turn");
    if (!s.missionsSeen) s.missionsSeen = {};
    s.missionsSeen[a.playerId] = true;
    if (!pendingMissionViewers(s).length) s.phase = "reveal_target";
  }

  // ---------------- 下注 ----------------

  // 尚未下注的下注者（座位順序）。多裝置時可同時下注，不限順序。
  function pendingBettors(s) {
    if (s.phase !== "bet" || !s.current) return [];
    return s.current.bettors.filter(function (id) { return !s.current.bets[id]; });
  }

  // 單機傳遞模式用：座位順序第一個尚未下注者
  function nextBettor(s) {
    return pendingBettors(s)[0] || null;
  }

  function betError(s, playerId, amount, predict) {
    if (pendingBettors(s).indexOf(playerId) < 0) return "ts_err_not_your_turn";
    var p = playerById(s, playerId);
    if (!isInt(amount)) return "ts_err_int";
    if (amount > p.chips) return "ts_err_bet_max";
    var min = Math.min(s.config.minBet, p.chips); // 籌碼不足最低押注時只能全押
    if (amount < min || amount < 1) return "ts_err_bet_min";
    if (!isInt(predict) || predict < 0) return "ts_err_predict";
    return null;
  }

  function startBetting(s) {
    var bettors = s.players.filter(function (p) { return p.chips > 0; }).map(function (p) { return p.id; });
    if (!bettors.length) {
      s.phase = "final";
      s.current = null;
      return;
    }
    s.current = {
      price: D.START_PRICE,
      bettors: bettors,
      bets: {},
      pot: 0,
      order: [],
      turnIndex: 0,
      wind: null,
      pending: null,
      news: []
    };
    s.phase = "bet";
  }

  function placeBet(s, a) {
    var err = betError(s, a.playerId, a.amount, a.predict);
    if (err) throw new Error(err);
    var p = playerById(s, a.playerId);
    s.current.bets[a.playerId] = { amount: a.amount, predict: a.predict, chipsBefore: p.chips };
    p.chips -= a.amount;
    s.current.pot += a.amount;
    if (nextBettor(s) === null) {
      s.current.order = shuffle(s, s.players.map(function (x) { return x.id; }));
      s.current.turnIndex = 0;
      s.phase = "news";
      enterNewsTurn(s);
    }
  }

  // ---------------- 釋放消息 ----------------

  // 每個股東回合開始時呼叫：啟用風向卡就抽一張
  function enterNewsTurn(s) {
    s.current.pending = null;
    s.current.wind = null;
    if (!s.config.windEnabled) return;
    if (!s.windDeck.length) s.windDeck = buildWindDeck(s);
    s.current.wind = s.windDeck.pop();
  }

  function currentShareholder(s) {
    if ((s.phase !== "news" && s.phase !== "vote") || !s.current) return null;
    return s.current.order[s.current.turnIndex] || null;
  }

  // spec §7.3：通用牌（且未被目前標的類別排除）或同類別專屬牌才可直接打出
  function cardPlayable(s, cardId) {
    var card = cardById(cardId);
    var target = s.targets[s.targetIndex];
    if (!card || !target) return false;
    if (card.category === null) {
      var cat = categoryById(target.category);
      return !(cat && cat.excludeCommonCards.indexOf(cardId) >= 0);
    }
    return card.category === target.category;
  }

  function newsError(s, playerId, cardId, text, edited) {
    if (s.phase !== "news" || currentShareholder(s) !== playerId) return "ts_err_not_your_turn";
    if (cardId !== null && cardId !== undefined) {
      var p = playerById(s, playerId);
      if (p.hand.indexOf(cardId) < 0) return "ts_err_card";
      if (!edited && !cardPlayable(s, cardId)) return "ts_err_card_mismatch";
    }
    if (typeof text !== "string" || !text.trim()) return "ts_err_empty_news";
    return null;
  }

  function deltaError(s, delta) {
    if (!isInt(delta)) return "ts_err_int";
    if (s.current && s.current.wind === "up" && delta < 0) return "ts_err_wind_up";
    if (s.current && s.current.wind === "down" && delta > 0) return "ts_err_wind_down";
    return null;
  }

  function releaseNews(s, a) {
    var cardId = a.cardId === undefined ? null : a.cardId;
    var err = newsError(s, a.playerId, cardId, a.text, !!a.edited);
    if (err) throw new Error(err);
    if (cardId !== null) {
      var p = playerById(s, a.playerId);
      p.hand.splice(p.hand.indexOf(cardId), 1);
      s.discard.push(cardId);
      var drawn = drawCard(s);
      if (drawn) p.hand.push(drawn);
    }
    s.current.pending = { playerId: a.playerId, cardId: cardId, edited: cardId !== null && !!a.edited, text: a.text.trim() };
    s.current.votes = {};
    s.phase = "vote";
  }

  function deltaMode(s) { return s.config.deltaMode === "vote" ? "vote" : "host"; }

  // 寫入消息面、換下一位股東或結算。extra 為投票模式的附加紀錄（votes/avg/windZeroed）
  function commitDelta(s, delta, extra) {
    var c = s.current;
    c.price = Math.max(0, c.price + delta);
    var entry = { playerId: c.pending.playerId, cardId: c.pending.cardId, edited: c.pending.edited,
      text: c.pending.text, wind: c.wind, delta: delta, priceAfter: c.price };
    Object.keys(extra || {}).forEach(function (k) { entry[k] = extra[k]; });
    c.news.push(entry);
    c.votes = {};
    c.turnIndex += 1;
    if (c.turnIndex >= c.order.length) {
      c.pending = null;
      settleCurrent(s);
    } else {
      s.phase = "news";
      enterNewsTurn(s);
    }
  }

  function applyDelta(s, a) {
    if (deltaMode(s) !== "host") throw new Error("ts_err_vote_mode");
    var err = deltaError(s, a.delta);
    if (err) throw new Error(err);
    commitDelta(s, a.delta, null);
  }

  // ---------------- 投票（deltaMode = "vote"） ----------------

  // 全部玩家（含股東）都投票；座位順序
  function pendingVoters(s) {
    if (s.phase !== "vote" || !s.current || deltaMode(s) !== "vote") return [];
    var votes = s.current.votes || {};
    return s.players.filter(function (p) { return !Object.prototype.hasOwnProperty.call(votes, p.id); })
      .map(function (p) { return p.id; });
  }

  function voteError(s, playerId, value) {
    if (deltaMode(s) !== "vote") return "ts_err_vote_mode";
    if (!playerById(s, playerId)) return "ts_err_not_your_turn";
    if (pendingVoters(s).indexOf(playerId) < 0) return "ts_err_already_voted";
    if (!isInt(value)) return "ts_err_int";
    if (Math.abs(value) > s.config.voteCap) return "ts_err_vote_range";
    return null;
  }

  // 平均四捨五入（.5 遠離 0）；以整數運算避免浮點誤差。之後套用風向限制。
  function tallyVotes(votes, wind) {
    var ids = Object.keys(votes);
    var sum = 0;
    ids.forEach(function (id) { sum += votes[id]; });
    var n = ids.length;
    var raw = Math.floor((2 * Math.abs(sum) + n) / (2 * n)) * (sum < 0 ? -1 : 1);
    var zeroed = (wind === "up" && raw < 0) || (wind === "down" && raw > 0);
    return { sum: sum, count: n, avg: sum / n, delta: zeroed ? 0 : raw, windZeroed: zeroed };
  }

  function finishVote(s) {
    var c = s.current;
    var r = tallyVotes(c.votes, c.wind);
    commitDelta(s, r.delta, { votes: clone(c.votes), avg: r.avg, windZeroed: r.windZeroed });
  }

  function castVote(s, a) {
    var err = voteError(s, a.playerId, a.value);
    if (err) throw new Error(err);
    if (!s.current.votes) s.current.votes = {};
    s.current.votes[a.playerId] = a.value;
    if (!pendingVoters(s).length) finishVote(s);
  }

  function skipPendingVoters(s) {
    if (deltaMode(s) !== "vote") throw new Error("ts_err_vote_mode");
    if (!Object.keys(s.current.votes || {}).length) throw new Error("ts_err_no_votes");
    finishVote(s);
  }

  // ---------------- 結算 ----------------

  var SHARES = { 1: [100], 2: [100], 3: [70, 30] };
  var SHARES_DEFAULT = [60, 30, 10];

  function settleTarget(bets, finalPrice, seatOrder) {
    var parts = seatOrder.filter(function (id) { return bets[id] && bets[id].amount > 0; });
    var pot = 0;
    parts.forEach(function (id) { pot += bets[id].amount; });
    var shares = SHARES[parts.length] || SHARES_DEFAULT;
    function err(id) { return Math.abs(bets[id].predict - finalPrice); }
    // 依誤差排序；sort 不保證穩定，所以用座位序當第二鍵
    var sorted = parts.slice().sort(function (a, b) {
      return err(a) - err(b) || seatOrder.indexOf(a) - seatOrder.indexOf(b);
    });
    var ranks = {};
    var payouts = {};
    var pos = 0;
    var paid = 0;
    while (pos < sorted.length) {
      var group = [sorted[pos]];
      while (pos + group.length < sorted.length && err(sorted[pos + group.length]) === err(sorted[pos])) {
        group.push(sorted[pos + group.length]);
      }
      // 並列者合併其名次的比例後平分
      var pct = 0;
      for (var i = pos; i < pos + group.length; i++) pct += shares[i] || 0;
      var each = Math.floor(pot * pct / (100 * group.length));
      group.forEach(function (id) {
        ranks[id] = pos + 1;
        payouts[id] = each;
        paid += each;
      });
      pos += group.length;
    }
    // 捨去的零頭給排序第一位，確保彩池總額守恆
    if (sorted.length) payouts[sorted[0]] += pot - paid;
    return { pot: pot, ranks: ranks, payouts: payouts };
  }

  function settleCurrent(s) {
    var c = s.current;
    var target = s.targets[s.targetIndex];
    var seat = s.players.map(function (p) { return p.id; });
    var r = settleTarget(c.bets, c.price, seat);
    Object.keys(r.payouts).forEach(function (id) { playerById(s, id).chips += r.payouts[id]; });
    var entry = {
      targetId: target.id,
      category: target.category,
      name: target.name,
      tags: target.tags,
      finalPrice: c.price,
      pot: r.pot,
      bets: c.bets,
      ranks: r.ranks,
      payouts: r.payouts,
      news: c.news
    };
    s.history.push(entry);
    s.lastSettlement = clone(entry);
    s.phase = "settle";
  }

  function nextTarget(s) {
    s.current = null;
    s.targetIndex += 1;
    s.phase = s.targetIndex >= s.targets.length ? "final" : "reveal_target";
  }

  // ---------------- 任務與排名 ----------------

  function missionDef(id) {
    for (var i = 0; i < D.MISSIONS.length; i++) if (D.MISSIONS[i].id === id) return D.MISSIONS[i];
    return null;
  }

  function missionText(id) {
    var m = missionDef(id);
    return m ? m.text : { ja: "", zh: "" };
  }

  // 以預測價相對 100 判斷漲跌方向是否猜對；預測 100（持平）只在最終正好 100 時算對
  function guessedDirection(bet, finalPrice) {
    if (finalPrice === 100 || bet.predict === 100) return bet.predict === finalPrice;
    return (bet.predict > 100) === (finalPrice > 100);
  }

  var MISSION_CHECKS = {
    firstPlaceAtLeast: function (s, pid, p) {
      return s.history.filter(function (h) { return h.ranks[pid] === 1; }).length >= p.count;
    },
    exactHit: function (s, pid, p) {
      return s.history.some(function (h) {
        return h.bets[pid] && Math.abs(h.bets[pid].predict - h.finalPrice) <= p.within;
      });
    },
    categoryRiseAtLeast: function (s, pid, p) {
      return s.history.some(function (h) { return h.category === p.category && h.finalPrice >= p.price; });
    },
    anyTargetCrash: function (s, pid, p) {
      return s.history.some(function (h) { return h.finalPrice <= p.price; });
    },
    finalRank: function (s, pid, p) {
      var me = playerById(s, pid).chips;
      var higher = s.players.filter(function (x) { return x.chips > me; }).length;
      return higher + 1 === p.rank;
    },
    allInOnce: function (s, pid, p) {
      return s.history.some(function (h) {
        var b = h.bets[pid];
        return b && b.amount * 100 >= b.chipsBefore * p.pct && (h.payouts[pid] || 0) > b.amount;
      });
    },
    contrarian: function (s, pid) {
      return s.history.some(function (h) {
        if (!h.bets[pid]) return false;
        var ids = Object.keys(h.bets);
        var wrong = ids.filter(function (id) { return !guessedDirection(h.bets[id], h.finalPrice); }).length;
        return wrong * 2 > ids.length && guessedDirection(h.bets[pid], h.finalPrice);
      });
    },
    ownNewsSwing: function (s, pid, p) {
      return s.history.some(function (h) {
        return h.news.some(function (n) { return n.playerId === pid && Math.abs(n.delta) >= p.abs; });
      });
    }
  };

  function evaluateMissions(s) {
    if (!s.config.missionsEnabled) return [];
    return s.players.filter(function (p) { return p.mission; }).map(function (p) {
      var def = missionDef(p.mission.id);
      var ok = !!(def && MISSION_CHECKS[def.check](s, p.id, p.mission.params));
      return { playerId: p.id, missionId: p.mission.id, params: p.mission.params, achieved: ok, reward: ok ? def.reward : 0 };
    });
  }

  function finalStandings(s) {
    var bonus = {};
    evaluateMissions(s).forEach(function (r) { bonus[r.playerId] = r.reward; });
    var rows = s.players.map(function (p, i) {
      var b = bonus[p.id] || 0;
      return { playerId: p.id, name: p.name, chips: p.chips, bonus: b, total: p.chips + b, seat: i };
    });
    rows.sort(function (a, b) { return b.total - a.total || a.seat - b.seat; });
    rows.forEach(function (r) {
      r.rank = rows.filter(function (x) { return x.total > r.total; }).length + 1;
      delete r.seat;
    });
    return rows;
  }

  // ---------------- reducer ----------------

  function reduce(state, action) {
    var s = clone(state);
    switch (action.type) {
      case "missionSeen":
        if (s.phase !== "missions") throw new Error("ts_err_phase");
        missionSeen(s, action);
        break;
      case "startBetting":
        if (s.phase !== "reveal_target") throw new Error("ts_err_phase");
        startBetting(s);
        break;
      case "placeBet":
        if (s.phase !== "bet") throw new Error("ts_err_phase");
        placeBet(s, action);
        break;
      case "releaseNews":
        if (s.phase !== "news") throw new Error("ts_err_phase");
        releaseNews(s, action);
        break;
      case "applyDelta":
        if (s.phase !== "vote") throw new Error("ts_err_phase");
        applyDelta(s, action);
        break;
      case "castVote":
        if (s.phase !== "vote") throw new Error("ts_err_phase");
        castVote(s, action);
        break;
      case "skipPendingVoters":
        if (s.phase !== "vote") throw new Error("ts_err_phase");
        skipPendingVoters(s);
        break;
      case "nextTarget":
        if (s.phase !== "settle") throw new Error("ts_err_phase");
        nextTarget(s);
        break;
      default:
        throw new Error("ts_err_phase");
    }
    return s;
  }

  window.PriTestToushouCore = {
    pickRandomTargets: pickRandomTargets,
    defaultMinBet: defaultMinBet,
    roleFor: roleFor,
    categoryById: categoryById,
    cardById: cardById,
    newGame: newGame,
    reduce: reduce,
    betError: betError,
    voteError: voteError,
    pendingVoters: pendingVoters,
    tallyVotes: tallyVotes,
    nextBettor: nextBettor,
    pendingBettors: pendingBettors,
    pendingMissionViewers: pendingMissionViewers,
    currentShareholder: currentShareholder,
    cardPlayable: cardPlayable,
    newsError: newsError,
    deltaError: deltaError,
    settleTarget: settleTarget,
    evaluateMissions: evaluateMissions,
    finalStandings: finalStandings,
    missionText: missionText
  };
})();
