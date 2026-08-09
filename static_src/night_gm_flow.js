(function () {
  // 自動化GM Phase 2：シナリオ進行フロー（進度版の[進入]/[突破]・GM敘述・獎勵収集ゲート）。
  // auto_gm.js（Phase 1：戦闘中の敵行動ロール）とは別軸の機能で、こちらはUI操作と
  // state書き込みの両方を行う（night_floor_breakthrough.js/night_event_chips.jsと同じ立ち位置の
  // night.js別クロージャモジュール）。window.PriTestNightCore経由でnight.js側のstate/save/rerenderに
  // アクセスする。GMの操作・敘述はすべて既存の鵝黃色進度版（#location-status-overlay）内で完結させ、
  // 公開盤面の地図側には一切ボタンを追加しない。

  // シナリオのbossId（scenarios.js）と、世界観データ（worldview.js）の夜の王ストーリーセクション
  // （night_king_1〜10）との対応表。両者にIDによる直接リンクが無いため、scenarios.jsの
  // name/bossNameとworldview.jsのtitleを突き合わせて確認した（推測ではなく、既存データ同士の
  // 文字列一致による裏取り）：
  //   night_king_1「三つ首の獣」= tricephalos.name（bossId: gladius）
  //   night_king_2「喰らいつく顎」= gaping_jaw.name（bossId: edele）
  //   night_king_3「知性の蟲」= sentient_pest.name（bossId: gnoster）
  //   night_king_4「兆し」= augur.name（bossId: maris）
  //   night_king_5「夜の魔、リスラ」= equilibrious_beast.bossName（bossId: libra）
  //   night_king_6「闇駆ける狩人「夜光の騎士、フルゴール」」= darkdrift_knight.name+bossName（bossId: fulghor）
  //   night_king_7「霧の裂け目 夜の霞、カリゴ」= fissure_in_the_fog.name+bossName（bossId: caligo）
  //   night_king_8「救いの旗手(...ハルモニア)」= balancers.bossName（bossId: harmonia）
  //   night_king_9「反逆のストラゲス(...)」= dreglord.bossName（bossId: stragedes）
  //   night_king_10「夜の輪郭(...ナメレス)」= night_aspect.bossName（bossId: nameless）
  var BOSS_ID_TO_WORLDVIEW_ID = {
    gladius: "night_king_1",
    edele: "night_king_2",
    gnoster: "night_king_3",
    maris: "night_king_4",
    libra: "night_king_5",
    fulghor: "night_king_6",
    caligo: "night_king_7",
    harmonia: "night_king_8",
    stragedes: "night_king_9",
    nameless: "night_king_10",
  };

  // ---- 汎用打字機ヘルパー（第1項） ----
  // 短い間隔でチャンクずつ文字を追加していく、単純な漸進表示。要素ごとに直前のタイマーを
  // 記録しておき、再呼び出し時は前のアニメーションを確実に止めてから始める（同じ要素に対して
  // 二重に動き続けることがないようにする）。
  var activeTimers = new WeakMap();

  function stopTypewriter(el) {
    var timer = activeTimers.get(el);
    if (timer) {
      clearInterval(timer);
      activeTimers.delete(el);
    }
    el.classList.remove("gm-flow-typing");
  }

  function typewriteInto(el, text, opts) {
    opts = opts || {};
    var chunkSize = opts.chunkSize || 2;
    var intervalMs = opts.intervalMs || 28;
    stopTypewriter(el);
    el.textContent = "";
    if (!text) {
      if (opts.onDone) opts.onDone();
      return;
    }
    el.classList.add("gm-flow-typing");
    var i = 0;
    var timer = setInterval(function () {
      i += chunkSize;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        stopTypewriter(el);
        if (opts.onDone) opts.onDone();
      }
    }, intervalMs);
    activeTimers.set(el, timer);
  }

  // ---- 夜の王〔開場〕の取得（第11項） ----
  function extractOpeningText(section) {
    var blocks = section.blocks || [];
    var collecting = false;
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.kind === "label") {
        if (collecting) break; // 次のlabel（通常はエンディング）に到達したら終了
        collecting = true; // 最初のlabelがオープニング/開場ラベル自体
        continue;
      }
      if (collecting && b.kind === "text") {
        parts.push(window.PriTestWorldview.localizedText(b.body));
      }
    }
    return parts.join("\n\n");
  }

  function resolveOpeningNarrationText() {
    var Core = window.PriTestNightCore;
    var Worldview = window.PriTestWorldview;
    if (!Worldview) return null;
    var scenario = Core.getScenario();
    if (!scenario || !scenario.bossId) return null;
    var worldviewId = BOSS_ID_TO_WORLDVIEW_ID[scenario.bossId];
    if (!worldviewId) return null;
    var section = Worldview.list().filter(function (s) {
      return s.id === worldviewId;
    })[0];
    if (!section) return null;
    return extractOpeningText(section);
  }

  // ゲーム読み込み直後に1度だけ呼ばれる（night.js DOMContentLoaded、loadState()直後）。
  // すでに開場済み・機能OFF・敘述表示中のいずれかならなにもしない。
  function maybeShowOpeningNarration() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.gmFlowEnabled || state.gmFlow.openingPlayed || state.gmFlow.awaitingOk) return;
    var text = resolveOpeningNarrationText();
    if (!text) return;
    state.gmFlow.narrationText = text;
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
  }

  // ---- 進度版内の[進入]/[突破]/[OK]表示（第2・4項） ----
  var lastTypedNarration = null;

  function renderNarrationInto(contentEl, text) {
    var p = document.createElement("p");
    p.className = "loc-detail gm-flow-narration";
    contentEl.appendChild(p);
    if (text === lastTypedNarration) {
      p.textContent = text; // 同じ敘述の再描画（他の状態変化での再render）はアニメーションし直さない
      return;
    }
    lastTypedNarration = text;
    typewriteInto(p, text);
  }

  function handleEnterClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var idx = state.focusedIndex;
    var card = typeof idx === "number" ? window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx) : null;
    var name = card ? window.PriTestFields.localizedText(card.name) : "";
    state.gmFlow.narrationText = window.I18N.t("gm_flow_enter_narration", { name: name });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // 第15項：全樓層踏破時、grantCardFullClearRewardIfNeeded（night.js）から呼ばれる。
  // 効果自体はすでに自動付与済み——ここは「何が起きたか」をGM敘述として見せて[OK]待ちにするだけ。
  function showFullClearNarration(cardName, effectText) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.gmFlow.narrationText = window.I18N.t("gm_flow_full_clear_narration", { name: cardName, effect: effectText });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  function handleBreakthroughClick() {
    var idx = window.PriTestNightCore.state.focusedIndex;
    if (typeof idx !== "number") return;
    window.PriTestNightFloorBreakthrough.openBreakthroughModal(idx);
  }

  // 獎勵収集完成ゲート（第5項）：縮小されたまま未クローズの獎勵視窗が残っていれば、
  // [OK]を押しても進めさせず、残数を再度リマインドする。
  function handleGmFlowOk() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var pending = state.gmFlow.pendingRewardWindows.length;
    if (pending > 0) {
      state.gmFlow.narrationText = window.I18N.t("gm_flow_reward_pending_reminder", { count: pending });
      lastTypedNarration = null; // リマインド文言は必ず打字機を再生する
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    if (!state.gmFlow.openingPlayed) state.gmFlow.openingPlayed = true;
    clearGmFlowGate();
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  function clearGmFlowGate() {
    var state = window.PriTestNightCore.state;
    state.gmFlow.awaitingOk = false;
    state.gmFlow.narrationText = null;
    state.gmFlow.actionKind = "ok";
    lastTypedNarration = null;
  }

  // ---- 日夜轉場整體流程（第16項） ----

  // 「黄金樹の帳」全踏破時（night.jsのgrantCardFullClearRewardIfNeededから呼ばれる）。
  // 規則書：夜の強敵撃破後の追加処理——全員の聖杯瓶使用回数／現在HP／現在FP／夜渡りスキル
  // 使用回数を最大値まで回復（レベルアップの実行自体は各キャラクター詳細ドロワー側の既存UIを
  // 使う操作なので、ここでは自動化せずリマインドに留める）。処理後は[進入下一晚]/[稍後]を出す。
  function handleGoldenTreeFullClear(cardName, effectText) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var EventChips = window.PriTestNightEventChips;
    if (EventChips) {
      Core.getRosterCharacters()
        .filter(function (c) {
          return c.entered;
        })
        .forEach(function (c) {
          EventChips.applyEventChipBlessingRest(c);
        });
    }
    state.gmFlow.narrationText = window.I18N.t("gm_flow_golden_tree_clear_narration", { name: cardName, effect: effectText });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "nightAdvance";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // [進入下一晚]：既存の主要ボタン（#btn-primary-action、シナリオ有無で
  // openKeepCardsDrawer/openSelectDrawerのどちらかに繋がる）をそのままクリックする——
  // ロジックを複製せず、既存の正しい分岐に完全に委ねる。
  function handleAdvanceNightClick() {
    clearGmFlowGate();
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderCurrentLocationStatus();
    var btn = document.getElementById("btn-primary-action");
    if (btn && !btn.disabled) btn.click();
  }

  // [稍後]：夜の強敵撃破の敘述だけ閉じる（進次日はまだしない）。
  function handleDismissNarrationClick() {
    clearGmFlowGate();
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderCurrentLocationStatus();
  }

  // 3日目に到達したら（このゲームで初回のみ）、最終「夜の王」戦闘に触れるアナウンスを出す。
  // state.gmFlowEnabledかつdayNumber>=3の間、renderLocationBanner呼び出しのたびにチェックするが、
  // finalDayAnnouncedで一度きりに制限する。
  function maybeAnnounceFinalDay() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.gmFlowEnabled || state.gmFlow.finalDayAnnounced || state.gmFlow.awaitingOk) return;
    if (state.dayNumber < 3) return;
    state.gmFlow.finalDayAnnounced = true;
    var game = Core.getGame();
    var bossName = "";
    if (game && game.night3BossId && window.PriTestBossRulebook) {
      var bossInfo = window.PriTestBossRulebook.get(game.night3BossId);
      if (bossInfo) bossName = window.PriTestFields.localizedText(bossInfo.name);
    }
    if (!bossName) bossName = window.I18N.t("gm_flow_final_day_boss_unknown");
    state.gmFlow.narrationText = window.I18N.t("gm_flow_final_day_narration", { boss: bossName });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "finalDayBattle";
    Core.saveState();
  }

  // [開啟夜王戰鬥]：既存の戦闘ドロワーを開くだけ——エネミー追加自体は既存の検索/追加UIに委ねる
  // （夜の王のHP/レベルは構造化データで既に正しいが、編隊への追加処理自体は複製しない）。
  function handleOpenFinalBattleClick() {
    clearGmFlowGate();
    var Core = window.PriTestNightCore;
    Core.saveState();
    Core.renderCurrentLocationStatus();
    Core.openBattleDrawer();
  }

  // night.js側のrenderCurrentLocationStatus()から、#location-status-contentを組み立てた直後に
  // 呼ばれる。敘述文（あれば）をcontentEl末尾に追記し、#location-status-actionsに
  // [進入]/[突破]、または[OK]/[進入下一晚][稍後]/[開啟夜王戰鬥]のいずれかを描画する。
  // cardはnull（開場敘述中など）でもよい。
  function renderLocationBanner(contentEl, idx, card) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var actionsEl = document.getElementById("location-status-actions");
    if (!actionsEl) return;
    if (!state.gmFlowEnabled) {
      actionsEl.classList.remove("has-actions");
      actionsEl.innerHTML = "";
      lastTypedNarration = null;
      return;
    }
    maybeAnnounceFinalDay(); // stateを直接書き換えるだけ（自身はrenderを呼ばない、再帰防止）
    actionsEl.classList.add("has-actions");
    actionsEl.innerHTML = "";

    if (state.gmFlow.awaitingOk) {
      renderNarrationInto(contentEl, state.gmFlow.narrationText || "");
      if (state.gmFlow.actionKind === "nightAdvance") {
        var advanceBtn = document.createElement("button");
        advanceBtn.type = "button";
        advanceBtn.className = "gm-flow-action-btn";
        advanceBtn.textContent = window.I18N.t("gm_flow_advance_night_button");
        advanceBtn.addEventListener("click", handleAdvanceNightClick);
        actionsEl.appendChild(advanceBtn);

        var laterBtn = document.createElement("button");
        laterBtn.type = "button";
        laterBtn.className = "gm-flow-action-btn";
        laterBtn.textContent = window.I18N.t("gm_flow_dismiss_button");
        laterBtn.addEventListener("click", handleDismissNarrationClick);
        actionsEl.appendChild(laterBtn);
      } else if (state.gmFlow.actionKind === "finalDayBattle") {
        var battleBtn = document.createElement("button");
        battleBtn.type = "button";
        battleBtn.className = "gm-flow-action-btn";
        battleBtn.textContent = window.I18N.t("gm_flow_open_final_battle_button");
        battleBtn.addEventListener("click", handleOpenFinalBattleClick);
        actionsEl.appendChild(battleBtn);
      } else {
        var okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "gm-flow-action-btn";
        okBtn.textContent = window.I18N.t("gm_flow_ok_button");
        okBtn.addEventListener("click", handleGmFlowOk);
        actionsEl.appendChild(okBtn);
      }
      return;
    }

    lastTypedNarration = null;
    if (!card) return; // 樓層にフォーカスしていない間は[進入]/[突破]を出さない

    var enterBtn = document.createElement("button");
    enterBtn.type = "button";
    enterBtn.className = "gm-flow-action-btn";
    enterBtn.textContent = window.I18N.t("gm_flow_enter_button");
    enterBtn.addEventListener("click", handleEnterClick);
    actionsEl.appendChild(enterBtn);

    var breakBtn = document.createElement("button");
    breakBtn.type = "button";
    breakBtn.className = "gm-flow-action-btn";
    breakBtn.textContent = window.I18N.t("gm_flow_breakthrough_button");
    breakBtn.addEventListener("click", handleBreakthroughClick);
    actionsEl.appendChild(breakBtn);
  }

  window.PriTestNightGmFlow = {
    typewriteInto: typewriteInto,
    renderLocationBanner: renderLocationBanner,
    maybeShowOpeningNarration: maybeShowOpeningNarration,
    maybeAnnounceFinalDay: maybeAnnounceFinalDay,
    showFullClearNarration: showFullClearNarration,
    handleGoldenTreeFullClear: handleGoldenTreeFullClear,
  };
})();
