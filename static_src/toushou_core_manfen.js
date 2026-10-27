// 東正小遊戲（toushou）滿分男模式規則引擎。純邏輯，不碰 DOM。
// toushou_core.js 的 newGame／reduce 在 config.mode === "manfen" 時轉交到這裡；
// apply(s, action) 直接修改已經深複製過的 s，無效 action 時 throw new Error(<i18n key>)。
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var I = Core._internal;
  var clone = I.clone;
  var isInt = I.isInt;
  var rand = I.rand;
  var shuffle = I.shuffle;
  var playerById = I.playerById;
  var drawCard = I.drawCard;

  var RATINGS = [0, 2, 5, 10];
  var WIND_RATINGS = { up: [0, 2], down: [5, 10] }; // 帶風向者只能往指定方向評（spec §3.4）

  // ---------------- 資料查詢 ----------------

  function manfenCategoryById(id) {
    for (var i = 0; i < D.MANFEN_CATEGORIES.length; i++) if (D.MANFEN_CATEGORIES[i].id === id) return D.MANFEN_CATEGORIES[i];
    return null;
  }

  function categoryById(id) { return manfenCategoryById(id) || Core.categoryById(id); }

  // 缺點牌優先；現有類別的利空消息牌也會進牌堆，所以找不到時查 NEWS_CARDS
  function flawCardById(id) {
    for (var i = 0; i < D.FLAW_CARDS.length; i++) if (D.FLAW_CARDS[i].id === id) return D.FLAW_CARDS[i];
    return Core.cardById(id);
  }

  function swanById(id) {
    for (var i = 0; i < D.MANFEN_SWAN_CARDS.length; i++) if (D.MANFEN_SWAN_CARDS[i].id === id) return D.MANFEN_SWAN_CARDS[i];
    return null;
  }

  function pickTargets(mfCats, classicCats, count, seed) {
    var holder = { rng: seed >>> 0 };
    var pool = D.MANFEN_TARGETS.filter(function (t) { return mfCats.indexOf(t.category) >= 0; })
      .concat(D.TARGETS.filter(function (t) { return classicCats.indexOf(t.category) >= 0; }));
    return shuffle(holder, pool).slice(0, count).map(function (t) {
      return {
        category: t.category,
        name: clone(t.name),
        summary: clone(t.summary || null),
        tags: clone(t.tags || []),
        hooks: clone(t.hooks || []),
        custom: false,
        sourceId: t.id
      };
    });
  }

  function buildSwanDeck(holder) {
    var arr = [];
    D.MANFEN_SWAN_CARDS.forEach(function (c) {
      var k = D.MANFEN_SWAN_COMPOSITION[c.id] || 1;
      for (var i = 0; i < k; i++) arr.push(c.id);
    });
    return shuffle(holder, arr);
  }

  // ---------------- 開局 ----------------

  function newGame(config) {
    var s = {
      version: 1,
      phase: "reveal_target",
      config: {
        mode: "manfen",
        // 依賴股價的規則在本模式不生效（spec §2）
        missionsEnabled: false,
        windEnabled: !!config.windEnabled,
        minBet: config.minBet,
        deltaMode: "host",
        voteCap: 100,
        blackSwanEnabled: !!config.blackSwanEnabled,
        sectorLinkEnabled: false
      },
      players: [],
      deck: [],
      discard: [],
      windDeck: [],
      swanDeck: [],
      mfSwanDeck: [],
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
      s.targets.push({ id: "t" + i, category: t.category, name: t.name, summary: t.summary || null,
        tags: t.tags || [], hooks: t.hooks || [], custom: !!t.custom });
    });
    // 牌池＝通用缺點牌＋本局類別的專屬缺點牌＋本局現有類別的利空消息牌（spec §3.3）
    var cats = [];
    s.targets.forEach(function (t) { if (cats.indexOf(t.category) < 0) cats.push(t.category); });
    var pool = D.FLAW_CARDS.filter(function (c) { return c.category === null || cats.indexOf(c.category) >= 0; })
      .map(function (c) { return c.id; })
      .concat(D.NEWS_CARDS.filter(function (c) { return c.tone === "down" && c.category !== null && cats.indexOf(c.category) >= 0; })
        .map(function (c) { return c.id; }));
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
    s.blamerOffset = Math.floor(rand(s) * s.players.length);
    if (s.config.windEnabled) s.windDeck = I.buildWindDeck(s);
    if (s.config.blackSwanEnabled) s.mfSwanDeck = buildSwanDeck(s);
    return s;
  }

  function blamerFor(s, k) {
    return s.players[(k + (s.blamerOffset || 0)) % s.players.length].id;
  }

  // ---------------- 爆料（spec §3.3） ----------------

  function startExpose(s) {
    if (!s.players.some(function (p) { return p.chips > 0; })) {
      s.phase = "final";
      s.current = null;
      return;
    }
    s.current = {
      blamerId: blamerFor(s, s.targetIndex),
      flaw: null,
      event: null,
      windCard: null,
      windHolder: null,
      ratings: {},
      revealed: {},
      requests: [],
      pendingRequest: null,
      mindPaid: {},
      mindPot: 0,
      bettors: [],
      bets: {},
      pot: 0,
      news: []
    };
    s.phase = "mf_expose";
  }

  // 通用缺點牌、同類別的缺點牌、同類別的利空消息牌可直接打出；其他只能改寫
  function flawPlayable(s, cardId) {
    var card = flawCardById(cardId);
    var target = s.targets[s.targetIndex];
    if (!card || !target) return false;
    if (card.tone !== undefined) return card.tone === "down" && card.category === target.category;
    return card.category === null || card.category === target.category;
  }

  function exposeError(s, playerId, cardId, text, edited) {
    if (s.phase !== "mf_expose" || !s.current || s.current.blamerId !== playerId) return "ts_err_not_your_turn";
    if (cardId !== null && cardId !== undefined) {
      var p = playerById(s, playerId);
      if (p.hand.indexOf(cardId) < 0) return "ts_err_card";
      if (!edited && !flawPlayable(s, cardId)) return "ts_err_card_mismatch";
    }
    if (typeof text !== "string" || !text.trim()) return "ts_err_empty_news";
    return null;
  }

  function expose(s, a) {
    var cardId = a.cardId === undefined ? null : a.cardId;
    var err = exposeError(s, a.playerId, cardId, a.text, !!a.edited);
    if (err) throw new Error(err);
    if (cardId !== null) {
      var p = playerById(s, a.playerId);
      p.hand.splice(p.hand.indexOf(cardId), 1);
      s.discard.push(cardId);
      var drawn = drawCard(s);
      if (drawn) p.hand.push(drawn);
    }
    var c = s.current;
    c.flaw = { cardId: cardId, edited: cardId !== null && !!a.edited, text: a.text.trim() };
    if (s.config.blackSwanEnabled) {
      if (!s.mfSwanDeck || !s.mfSwanDeck.length) s.mfSwanDeck = buildSwanDeck(s);
      c.event = s.mfSwanDeck.pop();
    }
    if (s.config.windEnabled) {
      // 帶風向的人（spec §4）：中立＝本題沒有，但畫面一律只說「可能有」
      if (!s.windDeck.length) s.windDeck = I.buildWindDeck(s);
      c.windCard = s.windDeck.pop();
      if (c.windCard !== "neutral") c.windHolder = s.players[Math.floor(rand(s) * s.players.length)].id;
    }
    s.phase = "mf_rate";
  }

  // ---------------- reducer 入口 ----------------

  function need(s, phase) { if (s.phase !== phase) throw new Error("ts_err_phase"); }

  function apply(s, action) {
    switch (action.type) {
      case "startBetting": need(s, "reveal_target"); startExpose(s); break;
      case "mfExpose": need(s, "mf_expose"); expose(s, action); break;
      case "nextTarget": need(s, "settle"); I.nextTarget(s); break;
      default: throw new Error("ts_err_phase");
    }
  }

  window.PriTestToushouManfen = {
    RATINGS: RATINGS,
    newGame: newGame,
    apply: apply,
    pickTargets: pickTargets,
    manfenCategoryById: manfenCategoryById,
    categoryById: categoryById,
    flawCardById: flawCardById,
    swanById: swanById,
    blamerFor: blamerFor,
    flawPlayable: flawPlayable,
    exposeError: exposeError
  };
})();
