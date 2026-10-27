// 東正小遊戲（toushou）滿分男模式的畫面。由 toushou.js 的 renderGame／renderFinal 呼叫。
// 共用元件（el、masked、dispatch…）透過工具包 K 傳入；本檔不保存任何狀態。
// 秘密資訊（評分、帶風向者）存在 state 裡，畫面只在遮蔽畫面或結算後才顯示。
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var M = window.PriTestToushouManfen;

  function fmt10(v) { return (v / 10).toFixed(1); }

  // "5.0" → 50；不是小數一位以內的數字時回傳 NaN
  function parse10(str) {
    var n = Number(str);
    if (str === "" || !isFinite(n)) return NaN;
    var v = Math.round(n * 10);
    return Math.abs(n * 10 - v) < 1e-6 ? v : NaN;
  }

  function flawText(K, cardId) {
    var card = M.flawCardById(cardId);
    if (!card) return cardId;
    var tg = K.currentTarget();
    return K.lt(card.text).split("{target}").join(tg ? K.lt(tg.name) : "");
  }

  // 題目句：專用類別用該類別句型，現有標的用共用句型
  function sentence(K, target, flaw) {
    var cat = M.manfenCategoryById(target.category);
    var phrase = K.lt(cat ? cat.phrase : D.MANFEN_CLASSIC_PHRASE);
    return phrase.split("{target}").join(K.lt(target.name)).split("{flaw}").join(flaw);
  }

  function swanBadge(K, id) {
    var card = M.swanById(id);
    if (!card) return null;
    return K.el("p", { id: "ts-swan-badge", class: "ts-swan-badge" }, [
      K.el("strong", { text: K.t("ts_swan_heading") + K.P("：") + K.lt(card.name) }), K.P("　") + K.lt(card.text)]);
  }

  function revealedList(K, info) {
    var s = K.state();
    var ul = K.el("ul", { id: "ts-mf-revealed", class: "ts-mf-revealed" });
    s.players.forEach(function (p) {
      var how = info.revealed[p.id];
      if (!how) return;
      ul.appendChild(K.el("li", { "data-player": p.id, text: K.t("ts_mf_revealed_item", { name: p.name, n: info.ratings[p.id] }) +
        (how === "forced" ? K.t("ts_mf_revealed_forced") : "") }));
    });
    if (!ul.childNodes.length) return K.el("p", { id: "ts-mf-revealed", class: "ts-hooks", text: K.t("ts_mf_none_revealed") });
    return K.el("div", {}, [K.el("h3", { text: K.t("ts_mf_revealed_list") }), ul]);
  }

  // 對象卡：info＝state.current（進行中）或 lastSettlement（結算）或 null（翻出時）
  function subjectCard(K, target, info) {
    var s = K.state();
    var cat = M.categoryById(target.category);
    var tags = K.el("div", { class: "ts-tags" });
    (target.tags || []).forEach(function (tg) { tags.appendChild(K.el("span", { text: K.lt(tg) })); });
    var blamer = info ? info.blamerId : M.blamerFor(s, s.targetIndex);
    var settled = !!(info && info.mode === "manfen");
    return K.el("section", { class: "ts-panel ts-target-card ts-mf-card" }, [
      K.el("p", { text: K.t("ts_mf_subject_heading", { i: s.targetIndex + 1, total: s.targets.length,
        category: cat ? K.lt(cat.name) : "" }) }),
      K.el("h2", { text: K.lt(target.name) }),
      target.summary ? K.el("p", { class: "ts-summary", text: K.lt(target.summary) }) : null,
      tags,
      K.el("p", { id: "ts-mf-blamer", text: K.t("ts_mf_blamer_is", { name: K.playerName(blamer) }) }),
      info && info.flaw ? K.el("p", { id: "ts-mf-sentence", class: "ts-mf-sentence", text: sentence(K, target, info.flaw.text) }) : null,
      info && info.event ? swanBadge(K, info.event) : null,
      s.config.windEnabled && info && info.flaw && !settled
        ? K.el("p", { id: "ts-mf-wind-maybe", class: "ts-mf-wind", text: K.t("ts_mf_wind_maybe") }) : null,
      info && info.flaw && !settled ? revealedList(K, info) : null
    ]);
  }

  // ---------------- 爆料 ----------------

  function composer(K, pid) {
    var ui = K.ui;
    var me = K.playerOf(pid);
    var textArea = K.el("textarea", { id: "ts-news-text", class: "ts-news-text", "aria-label": K.t("ts_mf_flaw_custom") });
    if (ui.editing !== null) textArea.value = ui.editing;
    textArea.addEventListener("input", function () { ui.editing = textArea.value; });
    var hand = K.el("ul", { class: "ts-hand" });
    me.hand.forEach(function (cardId, idx) {
      var playable = M.flawPlayable(K.state(), cardId);
      var cls = ["ts-down", playable ? "" : "ts-unplayable", ui.selectedCard === idx ? "ts-selected" : ""]
        .filter(Boolean).join(" ");
      hand.appendChild(K.el("li", { "data-card": cardId, class: cls }, [
        K.el("p", { text: flawText(K, cardId) }),
        playable ? K.el("button", { class: "ts-btn-play", type: "button", text: K.t("ts_btn_play"),
          onclick: function () {
            K.dispatch({ type: "mfExpose", playerId: pid, cardId: cardId, edited: false, text: flawText(K, cardId) });
          } }) : null,
        K.el("button", { class: "ts-btn-edit", type: "button", text: K.t("ts_btn_edit"),
          onclick: function () {
            ui.selectedCard = idx;
            ui.editing = flawText(K, cardId);
            ui.error = "";
            ui.skipRestore = true;
            K.render();
          } })
      ]));
    });
    return K.el("section", { class: "ts-panel" }, [
      K.el("h3", { text: K.t("ts_mf_flaw_hand") }),
      K.el("p", { class: "ts-hooks", text: K.t("ts_hand_other_hint") }),
      hand,
      K.el("label", {}, [K.t("ts_mf_flaw_custom"), textArea]),
      K.errorLine(),
      K.el("button", { id: "ts-btn-release", type: "button", class: "ts-primary", text: K.t("ts_btn_release"),
        onclick: function () {
          var text = textArea.value;
          var cardId = ui.selectedCard === null ? null : me.hand[ui.selectedCard];
          var edited = cardId !== null;
          var err = M.exposeError(K.state(), pid, cardId, text, edited);
          if (err) { ui.error = K.t(err); ui.editing = text; K.render(); return; }
          K.dispatch({ type: "mfExpose", playerId: pid, cardId: cardId, edited: edited, text: text });
        } })
    ]);
  }

  function renderExpose(K) {
    var pid = K.state().current.blamerId;
    var name = K.playerName(pid);
    var heading = K.el("h2", { text: K.t("ts_mf_expose_heading", { name: name }) });
    if (!K.owns(pid)) return K.el("div", {}, [heading, K.waiting(K.t("ts_wait_mf_expose", { name: name }))]);
    return K.el("div", {}, [heading, K.masked(pid, function () { return composer(K, pid); })]);
  }

  // ---------------- 秘密評分 ----------------

  function renderRate(K) {
    var s = K.state();
    var pending = M.pendingRaters(s);
    var mine = pending.filter(K.owns);
    var total = s.players.length;
    var progress = K.t("ts_wait_mf_rate", { done: total - pending.length, total: total });
    if (!mine.length) return K.waiting(progress);
    var pid = mine[0];
    return K.masked(pid, function () {
      var cur = K.state();
      var c = cur.current;
      var allowed = M.allowedRatings(cur, pid);
      var holder = c.windHolder === pid;
      var windLine = cur.config.windEnabled ? K.el("p", { id: "ts-mf-wind-status",
        class: holder ? "ts-mf-wind ts-mf-wind-holder" : "ts-mf-wind",
        text: K.t(holder ? "ts_mf_wind_you_" + c.windCard : "ts_mf_wind_you_none") }) : null;
      var btns = K.el("div", { class: "ts-mf-rate-buttons" });
      M.RATINGS.forEach(function (v) {
        btns.appendChild(K.el("button", { class: "ts-mf-rate", type: "button", "data-value": String(v),
          disabled: allowed.indexOf(v) < 0, text: K.t("ts_mf_rating_n", { n: v }),
          onclick: function () { K.dispatch({ type: "mfRate", playerId: pid, value: v }); } }));
      });
      return K.el("section", { class: "ts-panel" }, [
        K.el("h2", { text: K.t("ts_mf_rate_heading", { name: K.playerName(pid) }) }),
        windLine,
        K.el("p", { text: K.t("ts_mf_rate_hint") }),
        btns,
        K.errorLine(),
        K.el("p", { class: "ts-hooks", text: progress })
      ]);
    });
  }

  // ---------------- 心理戰 ----------------

  // withIds＝false：整局回顧（多題並列）時不帶 id，避免重複
  function requestLog(K, requests, withIds) {
    if (!requests || !requests.length) return null;
    var ul = K.el("ul", { id: withIds ? "ts-mf-request-log" : null, class: "ts-mf-request-log" });
    requests.forEach(function (r) {
      ul.appendChild(K.el("li", { text: K.t("ts_mf_request_log_" + r.outcome, {
        from: K.playerName(r.from), to: K.playerName(r.to), offers: r.offers.join(" → ") }) }));
    });
    return ul;
  }

  function requestForm(K) {
    var s = K.state();
    var c = s.current;
    var min = M.requestMin(s);
    var used = c.requests.map(function (r) { return r.from; });
    // 要求對象＝尚未亮牌、且不是要求者本人
    function targetsFor(fromId) {
      return s.players.filter(function (p) { return !c.revealed[p.id] && p.id !== fromId; });
    }
    var froms = s.players.filter(function (p) {
      return K.owns(p.id) && used.indexOf(p.id) < 0 && p.chips >= min && targetsFor(p.id).length > 0;
    });
    if (!froms.length) return null;
    // 選擇存在 K.ui（不進 state）：驗證錯誤或遠端更新重繪後保留原本的選擇
    var ui = K.ui;
    var fromSel = K.el("select", { id: "ts-mf-req-from", "aria-label": K.t("ts_mf_request_from") });
    froms.forEach(function (p) { fromSel.appendChild(K.el("option", { value: p.id, text: p.name })); });
    if (froms.some(function (p) { return p.id === ui.mfReqFrom; })) fromSel.value = ui.mfReqFrom;
    var toSel = K.el("select", { id: "ts-mf-req-to", "aria-label": K.t("ts_mf_request_to") });
    function fillTargets() {
      toSel.innerHTML = "";
      var tos = targetsFor(fromSel.value);
      tos.forEach(function (p) { toSel.appendChild(K.el("option", { value: p.id, text: p.name })); });
      if (tos.some(function (p) { return p.id === ui.mfReqTo; })) toSel.value = ui.mfReqTo;
      ui.mfReqTo = toSel.value;
    }
    fillTargets();
    ui.mfReqFrom = fromSel.value;
    fromSel.addEventListener("change", function () { ui.mfReqFrom = fromSel.value; fillTargets(); });
    toSel.addEventListener("change", function () { ui.mfReqTo = toSel.value; });
    var offer = K.el("input", { id: "ts-mf-req-offer", type: "number", min: String(min), value: String(min) });
    return K.el("div", { class: "ts-mf-request" }, [
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_request_from"), fromSel]),
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_request_to"), toSel]),
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_request_offer", { min: min }), offer]),
      K.el("button", { id: "ts-btn-mf-request", type: "button", text: K.t("ts_btn_mf_request"),
        onclick: function () {
          var x = K.intOf(offer.value);
          var err = M.requestError(K.state(), fromSel.value, toSel.value, x);
          if (err) { K.ui.error = K.t(err); K.render(); return; }
          K.dispatch({ type: "mfRequest", from: fromSel.value, to: toSel.value, offer: x });
        } })
    ]);
  }

  function pendingBox(K, r) {
    var x = r.offers[r.offers.length - 1];
    var fromN = K.playerName(r.from);
    var toN = K.playerName(r.to);
    if (!r.awaitingRaise) {
      var line = K.el("p", { id: "ts-mf-pending", class: "ts-mf-pending-line", text: K.t("ts_mf_pending", { from: fromN, to: toN, offer: x }) });
      if (!K.owns(r.to)) return K.el("div", {}, [line, K.el("p", { class: "ts-wait-text", text: K.t("ts_wait_mf_respond", { name: toN }) })]);
      return K.el("div", { class: "ts-mf-pending" }, [line,
        K.el("button", { id: "ts-btn-mf-reveal", type: "button", class: "ts-primary", text: K.t("ts_btn_mf_reveal"),
          onclick: function () { K.dispatch({ type: "mfRespond", playerId: r.to, choice: "reveal" }); } }),
        K.el("button", { id: "ts-btn-mf-refuse", type: "button", disabled: K.playerOf(r.to).chips < x,
          text: K.t("ts_btn_mf_refuse", { offer: x }),
          onclick: function () { K.dispatch({ type: "mfRespond", playerId: r.to, choice: "refuse" }); } })
      ]);
    }
    var ask = K.el("p", { id: "ts-mf-pending", class: "ts-mf-pending-line", text: K.t("ts_mf_refused_raise", { from: fromN, to: toN }) });
    if (!K.owns(r.from)) return K.el("div", {}, [ask, K.el("p", { class: "ts-wait-text", text: K.t("ts_wait_mf_raise", { name: fromN }) })]);
    var raise = K.el("input", { id: "ts-mf-raise-offer", type: "number", min: String(x + 1), value: String(x + 1) });
    return K.el("div", { class: "ts-mf-pending" }, [ask,
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_raise_offer", { min: x }), raise]),
      K.el("button", { id: "ts-btn-mf-raise", type: "button", class: "ts-primary", text: K.t("ts_btn_mf_raise"),
        onclick: function () {
          var v = K.intOf(raise.value);
          var err = M.raiseError(K.state(), r.from, v);
          if (err) { K.ui.error = K.t(err); K.render(); return; }
          K.dispatch({ type: "mfRaise", playerId: r.from, offer: v });
        } }),
      K.el("button", { id: "ts-btn-mf-drop", type: "button", text: K.t("ts_btn_mf_drop"),
        onclick: function () { K.dispatch({ type: "mfDrop", playerId: r.from }); } })
    ]);
  }

  function renderMind(K) {
    var c = K.state().current;
    var r = c.pendingRequest;
    return K.el("section", { class: "ts-panel ts-mf-mind" }, [
      K.el("h2", { text: K.t("ts_mf_mind_heading") }),
      K.el("p", { class: "ts-hooks", text: K.t("ts_mf_mind_hint") }),
      c.event === "gag" ? K.el("p", { id: "ts-mf-gag", class: "ts-error", text: K.t("ts_mf_gag_hint") }) : null,
      K.el("p", { id: "ts-mf-mind-pot", text: K.t("ts_mf_mind_pot", { n: c.mindPot }) }),
      r ? pendingBox(K, r) : requestForm(K),
      requestLog(K, c.requests, true),
      K.errorLine(),
      r ? null : K.hostButton("ts-btn-mf-end-mind", "ts_btn_mf_end_mind", { type: "mfEndMind" })
    ]);
  }

  // ---------------- 下注 ----------------

  function renderBet(K) {
    var s = K.state();
    var pending = Core.pendingBettors(s);
    var mine = pending.filter(K.owns);
    var total = s.current.bettors.length;
    if (!mine.length) return K.waiting(K.t("ts_wait_bets", { done: total - pending.length, total: total }));
    var pid = mine[0];
    var me = K.playerOf(pid);
    return K.masked(pid, function () {
      var min = Math.min(s.config.minBet, me.chips);
      var max = M.predictMax(K.state());
      var amount = K.el("input", { id: "ts-bet-amount", type: "number", min: String(min), max: String(me.chips), value: String(min) });
      var predict = K.el("input", { id: "ts-bet-predict", type: "number", min: "0", max: fmt10(max), step: "0.1", value: "5.0" });
      return K.el("section", { class: "ts-panel" }, [
        K.el("h2", { text: K.t("ts_bet_heading", { name: me.name }) }),
        K.el("p", { text: K.t("ts_bet_chips_left", { n: me.chips, min: min }) }),
        K.el("label", { class: "ts-field" }, [K.t("ts_bet_amount"), amount]),
        K.el("label", { class: "ts-field" }, [K.t("ts_mf_predict", { max: fmt10(max) }), predict]),
        K.errorLine(),
        K.el("button", { id: "ts-btn-confirm-bet", type: "button", class: "ts-primary", text: K.t("ts_btn_confirm_bet"),
          onclick: function () {
            var a = K.intOf(amount.value);
            var p10 = parse10(predict.value);
            var err = M.betError(K.state(), pid, a, p10);
            // 經典模式的 ts_err_predict 寫的是「整數」，本模式是小數一位，改用本模式的訊息
            if (err === "ts_err_predict") err = "ts_err_mf_predict_range";
            if (err) { K.ui.error = K.t(err); K.render(); return; }
            K.dispatch({ type: "placeBet", playerId: pid, amount: a, predict: p10 });
          } })
      ]);
    });
  }

  // ---------------- 結算 ----------------

  function settleTable(K, h) {
    var table = K.el("table", { class: "ts-table" });
    table.appendChild(K.el("tr", {}, ["ts_col_player", "ts_mf_col_rating", "ts_mf_col_weight", "ts_col_bet", "ts_col_predict",
      "ts_col_error", "ts_col_rank", "ts_col_payout", "ts_col_profit"].map(function (k) { return K.el("th", { text: K.t(k) }); })));
    K.state().players.forEach(function (p) {
      var row = h.tally.filter(function (r) { return r.playerId === p.id; })[0];
      var b = h.bets[p.id];
      var pay = h.payouts[p.id] || 0;
      var profit = pay - (b ? b.amount : 0) - (h.mindPaid[p.id] || 0);
      var rating = row ? String(row.rating) + (row.voided ? K.t("ts_mf_voided") : (row.removed ? K.t("ts_mf_removed") : "")) : "—";
      table.appendChild(K.el("tr", { "data-player": p.id }, [p.name, rating, row ? row.weight : "—",
        b ? b.amount : "—", b ? fmt10(b.predict) : "—", b ? fmt10(Math.abs(b.predict - h.avg10)) : "—",
        h.ranks[p.id] === undefined ? "—" : h.ranks[p.id], pay, (profit > 0 ? "+" : "") + profit]
        .map(function (v) { return K.el("td", { text: String(v) }); })));
    });
    return table;
  }

  // 交易取消／無人押注時，lastSettlement.pot 是退款總額而不是彩池
  function isRefund(h) {
    if (h.cancelled) return true;
    return !Object.keys(h.bets || {}).some(function (id) { return h.bets[id].amount > 0; });
  }

  function potText(K, h) {
    if (!isRefund(h)) return K.t("ts_pot", { n: h.pot });
    return h.pot > 0 ? K.t("ts_mf_refunded", { n: h.pot }) : "";
  }

  // withIds＝false：整局回顧用，不帶結算畫面專用的 id（多題並列時會重複）
  function settleBody(K, h, withIds) {
    var s = K.state();
    var pot = potText(K, h);
    var notes = [];
    if (s.config.windEnabled) {
      notes.push(h.windHolder ? K.t("ts_mf_wind_reveal_" + h.windCard, { name: K.playerName(h.windHolder) })
        : K.t("ts_mf_wind_reveal_none"));
    }
    h.tally.forEach(function (r) { if (r.voided) notes.push(K.t("ts_mf_rumor_note", { name: K.playerName(r.playerId) })); });
    if (h.median) notes.push(K.t("ts_mf_median_note"));
    if (h.cancelled) notes.push(K.t("ts_mf_cancel_note"));
    if (h.refundMind) notes.push(K.t("ts_mf_refund_note"));
    if (h.bonus) notes.push(K.t("ts_bailout_note", { n: h.bonus }));
    if (h.event === "upset") notes.push(K.t("ts_upset_note"));
    var ul = K.el("ul", { class: "ts-settle-notes" });
    notes.forEach(function (x) { ul.appendChild(K.el("li", { text: x })); });
    return K.el("div", {}, [
      K.el("p", { id: withIds ? "ts-mf-avg" : null, class: "ts-mf-avg", text: K.t("ts_mf_settle_avg", { avg: fmt10(h.avg10) }) +
        (pot ? K.P("　") + pot : "") }),
      notes.length ? ul : null,
      K.el("div", { id: withIds ? "ts-settle-table" : null, class: "ts-table-wrap" }, [settleTable(K, h)]),
      requestLog(K, h.requests, withIds)
    ]);
  }

  function renderSettle(K) {
    var s = K.state();
    var h = s.lastSettlement;
    var last = s.targetIndex + 1 >= s.targets.length;
    return K.el("section", { class: "ts-panel" }, [
      K.el("h2", { text: K.t("ts_settle_heading", { name: K.lt(h.name) }) }),
      settleBody(K, h, true),
      K.errorLine(),
      K.el("div", { class: "ts-actions" }, [
        K.hostButton("ts-btn-next-target", last ? "ts_btn_to_final" : "ts_btn_next_target", { type: "nextTarget" })
      ])
    ]);
  }

  // 整局結算的回顧（每題一個 <details>）
  function review(K, h) {
    var card = h.event ? M.swanById(h.event) : null;
    return K.el("details", {}, [
      K.el("summary", { text: K.lt(h.name) + K.P("　") + K.t("ts_mf_settle_avg", { avg: fmt10(h.avg10) }) +
        (card && h.event !== "calm" ? K.P("　［") + K.lt(card.name) + K.P("］") : "") }),
      h.flaw ? K.el("p", { class: "ts-mf-sentence", text: sentence(K, { category: h.category, name: h.name }, h.flaw.text) }) : null,
      settleBody(K, h, false)
    ]);
  }

  function render(K) {
    var s = K.state();
    var phase = s.phase;
    var settled = phase === "settle";
    var wrap = K.el("div", {});
    wrap.appendChild(subjectCard(K, K.currentTarget(), settled ? s.lastSettlement : s.current));
    if (phase === "reveal_target") wrap.appendChild(K.hostButton("ts-btn-start-betting", "ts_btn_mf_start", { type: "startBetting" }));
    else if (phase === "mf_expose") wrap.appendChild(renderExpose(K));
    else if (phase === "mf_rate") wrap.appendChild(renderRate(K));
    else if (phase === "mf_mind") wrap.appendChild(renderMind(K));
    else if (phase === "bet") wrap.appendChild(renderBet(K));
    else if (settled) wrap.appendChild(renderSettle(K));
    return wrap;
  }

  window.PriTestToushouManfenUI = { render: render, review: review };
})();
