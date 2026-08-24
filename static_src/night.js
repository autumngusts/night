(function () {
  var SUITS = ["S", "H", "D", "C"];
  var SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  var SUIT_CLASS = { S: "suit-black", H: "suit-red", D: "suit-orange", C: "suit-green" };
  var SUIT_CLASSES = ["suit-black", "suit-red", "suit-orange", "suit-green"];
  var RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var SLOT_COUNT = 9;
  var SLOT_LONG_PRESS_MS = 250;
  var MAX_EQUIPPED_WEAPONS = 2;
  // 固定配置副本（安寧者たち／瓦礫の王）の原書図解ポジション（1-9、上7-8-9／中4-S-5-E-6／下1-2-3）
  // から実際の盤面スロット index（slot-0〜slot-8）への対応表。中央＝ポジション5＝slot-4。
  var FIXED_LAYOUT_POS_TO_SLOT = { 1: 6, 2: 7, 3: 8, 4: 3, 5: 4, 6: 5, 7: 0, 8: 1, 9: 2 };
  var FIXED_LAYOUT_CENTER_SLOT = FIXED_LAYOUT_POS_TO_SLOT[5];
  // 地変（terrain-shift）副本：「場地列5」＝開始山札に隣接するカード列（縦3マス）。
  // scenario.day2 内で terrain:true のカードは常にこの3マスへ強制配置され、
  // プレイヤーの「保持する場地」選択の対象外になる（135頁）。
  var TERRAIN_SWAP_SLOTS = [0, 3, 6];

  function scenarioTerrainRows() {
    if (!scenario || !scenario.day2) return [];
    return scenario.day2.filter(function (row) {
      return row.terrain;
    });
  }
  var NEW_GAME_PASSWORD = "night";
  var RULEBOOK_PASSWORD = "nightnight";
  var RULEBOOK_SESSION_KEY = "pritest-rulebook-session";

  var Games = window.PriTestGames;
  var GameStorage = window.PriTestGameStorage;
  var Scenarios = window.PriTestScenarios;
  var CharacterTypes = window.PriTestCharacterTypes;
  var CharacterDrawer = window.PriTestCharacterDrawer;
  var gameId = Games.getGameIdFromQuery();
  var game = gameId ? Games.get(gameId) : null;
  var scenario = game && game.scenarioId ? Scenarios.get(game.scenarioId) : null;
  var STORAGE_KEY = "pritest-night-state-" + gameId;
  var CHARACTERS_KEY = "pritest-characters-" + gameId;
  var rosterCharacters = [];

  function loadRosterCharacters() {
    var raw = localStorage.getItem(CHARACTERS_KEY);
    if (!raw) return [];
    try {
      var data = JSON.parse(raw);
      var list = Array.isArray(data) ? data : [];
      return list.map(CharacterDrawer.ensureDefaults);
    } catch (e) {
      return [];
    }
  }

  function saveRosterCharacters() {
    localStorage.setItem(CHARACTERS_KEY, JSON.stringify(rosterCharacters));
    if (game) GameStorage.pushCharacters(gameId, game.storageMode, rosterCharacters);
  }

  var rosterDetailCollapsed = {};
  // 各角色の🎲アイコンで直近に実際に振った骰子の数（0も含む）。フェイズ切替でクリアする。
  var rosterDiceRollFeedback = {};

  // 骰子池の重骰待ち状態（キャラクターIDごと）。加護ボタンをONにすると、次にクリックした
  // 骰子1個が加護消費で重骰される（樓層突破判定の重骰UIと同じ操作方式）。
  var dicePoolRerollPending = {};

  // ロスターの骰子池表示。通常時は非活性ボタン（見た目はdice-item表示のみ）、重骰待ち中は
  // クリック可能にして、押した骰子だけを重骰対象にする。
  // 瀕死中は骰子池の代わりに、復歸次數（0回:+20 / 1回:+30 / 2回以上:+40、常に3個固定）の
  // 円形ボタンを表示する。3個すべて押し終えると自動で復歸処理が起動する（ユーザー確認済み）。
  function nearDeathRevivalValue(c) {
    var count = c.revivalCount || 0;
    return count >= 2 ? 40 : count === 1 ? 30 : 20;
  }

  function renderRosterDiceDisplay(c, container) {
    container.innerHTML = "";
    if (c._nearDeath) {
      var value = nearDeathRevivalValue(c);
      var clicked = c._nearDeathRevivalClicked || [false, false, false];
      for (var i = 0; i < 3; i++) {
        (function (idx) {
          var revivalBtn = document.createElement("button");
          revivalBtn.type = "button";
          revivalBtn.className = "near-death-revival-circle";
          if (clicked[idx]) {
            revivalBtn.classList.add("clicked");
            revivalBtn.disabled = true;
          }
          revivalBtn.textContent = "+" + value;
          revivalBtn.addEventListener("click", function () {
            handleNearDeathRevivalClick(c, idx);
          });
          container.appendChild(revivalBtn);
        })(i);
      }
      return;
    }
    var pending = !!dicePoolRerollPending[c.id];
    (c.dicePool || []).forEach(function (v, i) {
      var die = document.createElement("button");
      die.type = "button";
      die.className = "dice-item";
      if (pending) die.classList.add("active");
      die.disabled = !pending;
      die.textContent = v;
      die.addEventListener("click", function () {
        rerollDicePoolDie(c, i);
      });
      container.appendChild(die);
    });
  }

  // HPが0に到達した瞬間に発火する瀕死状態：骰子池・確定行動（点線枠）をその角色分だけ
  // クリアし、共有面板の圖像に閃灰白のアニメーションを表示する。
  function triggerNearDeath(c) {
    if (c._nearDeath) return;
    c._nearDeath = true;
    c._nearDeathRevivalClicked = [false, false, false];
    c.dicePool = [];
    c.pendingActionBoxes = [];
    saveRosterCharacters();
    addLog("log_near_death_trigger", { character: c.name });
  }

  function handleNearDeathRevivalClick(c, idx) {
    if (!c._nearDeath) return;
    if (!c._nearDeathRevivalClicked) c._nearDeathRevivalClicked = [false, false, false];
    if (c._nearDeathRevivalClicked[idx]) return;
    c._nearDeathRevivalClicked[idx] = true;
    var allClicked = c._nearDeathRevivalClicked.every(function (v) {
      return v;
    });
    if (allClicked) {
      completeNearDeathRevival(c);
    } else {
      saveRosterCharacters();
      renderCharacterRoster();
    }
  }

  // 復歸完了：復歸次數+1、瀕死解除、骰子自動2顆、區域移動を後衛へ、HPを最大值の半分
  // （小數點以下切り捨て）まで回復する。
  function completeNearDeathRevival(c) {
    c.revivalCount = (c.revivalCount || 0) + 1;
    c._nearDeath = false;
    c._nearDeathRevivalClicked = null;
    if (!c.dicePool) c.dicePool = [];
    c.dicePool.push(1 + Math.floor(Math.random() * 6));
    c.dicePool.push(1 + Math.floor(Math.random() * 6));
    c.hp.current = Math.floor((c.hp.max || 0) / 2);
    // 附帶効果「復歸時恢復技藝」：自身の技藝（arts）の使用回数を1回分回復する。
    if ((c.learnedAttachedEffects || []).indexOf("arts_revive_regen") !== -1) {
      var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
      var art = type && type.arts && type.arts[0];
      if (art) {
        if (!c.abilityUses) c.abilityUses = {};
        var usesBonusForRevive = CharacterDrawer.getSkillUsesBonus(c);
        var effectiveMaxForRevive = art.uses + usesBonusForRevive;
        var currentRemaining = typeof c.abilityUses[art.id] === "number" ? c.abilityUses[art.id] : effectiveMaxForRevive;
        c.abilityUses[art.id] = Math.min(effectiveMaxForRevive, currentRemaining + 1);
      }
    }
    saveRosterCharacters();
    var names = battlePositionNames();
    var idx = names.indexOf(c.name);
    if (idx !== -1 && idx < BATTLE_SLOT_COUNT) {
      state.battle.front[idx] = false;
      state.battle.back[idx] = true;
      saveState();
      renderBattlePositionAreas();
    }
    addLog("log_near_death_revival", { character: c.name, hp: c.hp.current });
    renderCharacterRoster();
  }

  // HPを減らす全ての経路（角色詳細のHPステッパー、屬性/異常のトリガー等）から呼ぶ共通チェック。
  // 0に到達した瞬間だけ発火し、既に瀕死中なら何もしない。
  function checkNearDeathTrigger(c) {
    if ((c.hp && c.hp.current) <= 0 && !c._nearDeath) {
      triggerNearDeath(c);
      renderCharacterRoster();
    }
  }
  window.PriTestNightNearDeathCheck = checkNearDeathTrigger;

  function toggleDicePoolBlessing(c) {
    if (dicePoolRerollPending[c.id]) {
      dicePoolRerollPending[c.id] = false;
      renderCharacterRoster();
      return;
    }
    if (!(c.dicePool || []).length || !c.blessingSlots || c.blessingSlots.current <= 0) return;
    if (!window.confirm(window.I18N.t("breakthrough_blessing_confirm", { name: c.name }))) return;
    c.blessingSlots.current -= 1;
    dicePoolRerollPending[c.id] = true;
    saveRosterCharacters();
    renderCharacterRoster();
  }

  // 重骰は「骰子1個の出目を変える」操作であり、その結果として前後衛や敵視の自動判定
  // （syncDiceStatusToBattle、骰子池の最大値・6の有無で決まる）が連動して変わってしまう
  // のは意図しない副作用のため、重骰前の前後衛・敵視状態を保存し、再描画後に元へ戻す。
  function rerollDicePoolDie(c, dieIndex) {
    if (!dicePoolRerollPending[c.id]) return;
    var names = battlePositionNames();
    var idx = names.indexOf(c.name);
    var preFront = idx !== -1 ? state.battle.front[idx] : null;
    var preBack = idx !== -1 ? state.battle.back[idx] : null;
    var preAggro = idx !== -1 ? state.battle.aggro[idx] : null;
    var preAggroApplied = c._diceAggroApplied;

    var oldValue = c.dicePool[dieIndex];
    c.dicePool[dieIndex] = 1 + Math.floor(Math.random() * 6);
    dicePoolRerollPending[c.id] = false;
    saveRosterCharacters();
    addLog("log_dice_pool_blessing_reroll", { character: c.name, from: oldValue, to: c.dicePool[dieIndex] });
    renderCharacterRoster();

    if (idx !== -1) {
      state.battle.front[idx] = preFront;
      state.battle.back[idx] = preBack;
      state.battle.aggro[idx] = preAggro;
      c._diceAggroApplied = preAggroApplied;
      saveState();
      renderBattlePositionAreas();
    }
  }

  // 各角色「武器欄」の折りたたみ状態（キャラID→bool）。renderCharacterRosterは頻繁に
  // 全体を再描画するため、この開閉状態だけはstateとは別にセッション内で保持する。
  var rosterWeaponCollapsed = {};

  function renderCharacterRoster() {
    var tbody = document.getElementById("character-roster-tbody");
    var skillsWrap = document.getElementById("character-roster-skills");
    tbody.innerHTML = "";
    skillsWrap.innerHTML = "";

    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });

    if (entered.length === 0) {
      var emptyRow = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 8;
      td.className = "character-roster-empty";
      td.textContent = window.I18N.t("character_roster_empty");
      emptyRow.appendChild(td);
      tbody.appendChild(emptyRow);
      if (typeof renderBattlePositionAreas === "function") renderBattlePositionAreas();
      return;
    }

    entered.forEach(function (c, rosterIdx) {
      var type = c.typeId && CharacterTypes ? CharacterTypes.get(c.typeId) : null;

      var tr = document.createElement("tr");

      var isCollapsed = !!rosterDetailCollapsed[c.id];

      var thumbTd = document.createElement("td");
      var thumbWrap = document.createElement("div");
      thumbWrap.className = "roster-thumb-wrap";
      if (c._nearDeath) {
        thumbWrap.classList.add("near-death");
        thumbWrap.title = window.I18N.t("attribute_status_near_death_clear_hint");
        thumbWrap.addEventListener("click", function () {
          if (!window.confirm(window.I18N.t("attribute_status_near_death_clear_confirm", { name: c.name }))) return;
          c._nearDeath = false;
          c._nearDeathRevivalClicked = null;
          saveRosterCharacters();
          renderCharacterRoster();
        });
      }
      // 升級して遺物効果の習得枠数が増えたのに、まだ習得しきっていない（例：3/4）場合、
      // 共有面板の角色圖像に常時点滅の外枠を付けて気づきやすくする。
      var relicMaxForThumb = type && type.relicEffectGroups ? CharacterDrawer.relicMaxLearnable(c.level) : 0;
      if (relicMaxForThumb > 0 && (c.learnedRelicEffects || []).length < relicMaxForThumb) {
        thumbWrap.classList.add("relic-learn-pending");
        if (!c._nearDeath) {
          thumbWrap.title = window.I18N.t("relic_learn_pending_hint", {
            learned: (c.learnedRelicEffects || []).length,
            max: relicMaxForThumb,
          });
        }
      }
      var thumbSrc = type ? CharacterTypes.imagePath(type) : null;
      if (thumbSrc) {
        var thumb = document.createElement("img");
        thumb.className = "character-thumb";
        thumb.src = thumbSrc;
        thumb.alt = c.name;
        thumb.addEventListener("click", function (e) {
          if (c._nearDeath) return;
          e.stopPropagation();
          CharacterDrawer.openSkills(c.id);
        });
        thumbWrap.appendChild(thumb);
      }
      // 展開/收合ボタンは画像のすぐ下に、矢印記号だけの簡潔な表示にする。
      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "roster-detail-toggle-btn";
      toggleBtn.textContent = isCollapsed ? "▸" : "▾";
      toggleBtn.title = window.I18N.t(isCollapsed ? "roster_detail_expand_button" : "roster_detail_collapse_button");
      toggleBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        rosterDetailCollapsed[c.id] = !rosterDetailCollapsed[c.id];
        renderCharacterRoster();
      });
      thumbWrap.appendChild(toggleBtn);
      thumbTd.appendChild(thumbWrap);
      tr.appendChild(thumbTd);

      var nameTd = document.createElement("td");
      var nameRow = document.createElement("div");
      nameRow.className = "roster-name-row";
      var nameLabel = document.createElement("span");
      nameLabel.className = "character-name-label";
      nameLabel.textContent = c.name;
      nameRow.appendChild(nameLabel);
      nameTd.appendChild(nameRow);

      var nameBtnRow = document.createElement("div");
      nameBtnRow.className = "roster-name-btn-row";
      var detailBtn = document.createElement("button");
      detailBtn.type = "button";
      detailBtn.className = "roster-char-action-btn";
      detailBtn.textContent = window.I18N.t("roster_char_detail_button");
      detailBtn.addEventListener("click", function () {
        CharacterDrawer.open(c.id);
      });
      nameBtnRow.appendChild(detailBtn);

      var abilityBtn = document.createElement("button");
      abilityBtn.type = "button";
      abilityBtn.className = "roster-char-action-btn";
      abilityBtn.textContent = window.I18N.t("roster_char_ability_button");
      abilityBtn.addEventListener("click", function () {
        CharacterDrawer.openSkills(c.id);
      });
      nameBtnRow.appendChild(abilityBtn);
      nameTd.appendChild(nameBtnRow);
      tr.appendChild(nameTd);

      var flaskText = c.flaskBase.current + "/" + c.flaskBase.max + (c.flaskExtra && c.flaskExtra.max > 0 ? "（+" + c.flaskExtra.current + "/" + c.flaskExtra.max + "）" : "");
      var blessingText = c.blessingSlots ? c.blessingSlots.current + "/" + c.blessingSlots.max : "-";
      [
        type ? CharacterTypes.localizedName(type.name) : "-",
        c.level,
        c.hp.current + "/" + c.hp.max,
        c.fp.current + "/" + c.fp.max,
        blessingText,
        flaskText,
      ].forEach(function (val) {
        var cell = document.createElement("td");
        cell.textContent = val;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);

      // 骰子池・武器欄・裝飾品・消耗品は、この角色の情報行のすぐ下（同じ角色欄）に並べて表示する。
      var detailTr = document.createElement("tr");
      detailTr.className = "roster-detail-row";
      detailTr.hidden = isCollapsed;
      var detailTd = document.createElement("td");
      detailTd.colSpan = 8;
      var detailFlex = document.createElement("div");
      detailFlex.className = "roster-detail-flex";

      var diceCol = document.createElement("div");
      diceCol.className = "roster-detail-col";
      var diceTitleRow = document.createElement("div");
      diceTitleRow.className = "roster-dice-title-row";
      var diceTitle = document.createElement("h5");
      diceTitle.textContent = window.I18N.t("character_dice_pool_label");
      diceTitleRow.appendChild(diceTitle);
      // 「一般行動」以外のフェイズでは、各角色が自分の面板から個別に骰子を振れるアイコンを出す。
      if (state.actionPhase !== "normal") {
        var diceRollBtn = document.createElement("button");
        diceRollBtn.type = "button";
        diceRollBtn.className = "dice-add-btn roster-dice-add-btn";
        diceRollBtn.textContent = "\u{1F3B2}";
        diceRollBtn.addEventListener("click", function () {
          rollDiceForCharacterActionPhase(c);
        });
        diceTitleRow.appendChild(diceRollBtn);
        if (rosterDiceRollFeedback[c.id] !== undefined) {
          var diceRollFeedback = document.createElement("span");
          diceRollFeedback.className = "roster-dice-roll-feedback";
          diceRollFeedback.textContent = window.I18N.t("roster_dice_roll_feedback", { count: rosterDiceRollFeedback[c.id] });
          diceTitleRow.appendChild(diceRollFeedback);
        }
      }
      // 靈體（復仇者）・屬性痕（隱者）はキャラ個人の状態のため、管理パネルを開くアイコンは
      // グローバルな骰子池バーではなく、このキャラ個人の骰子アイコンの右側に表示する
      // （該当キャラのみ、🎲振り直しアイコンより後ろに並べる）。
      var hasNecromancyOrSpiritSummon =
        type &&
        ((type.abilities || []).some(function (entry) {
          return entry.id === "necromancy";
        }) ||
          (type.skills || []).some(function (entry) {
            return entry.id === "spirit_summon";
          }));
      if (hasNecromancyOrSpiritSummon) {
        var spiritPanelBtn = document.createElement("button");
        spiritPanelBtn.type = "button";
        spiritPanelBtn.className = "dice-add-btn roster-dice-add-btn";
        spiritPanelBtn.textContent = "\u{1F47B}";
        spiritPanelBtn.title = window.I18N.t("spirit_panel_title");
        spiritPanelBtn.addEventListener("click", function () {
          openSpiritPanel();
        });
        diceTitleRow.appendChild(spiritPanelBtn);
      }
      var hasElementalControl =
        type &&
        (type.abilities || []).some(function (entry) {
          return entry.id === "elemental_control";
        });
      if (hasElementalControl) {
        var elementMarkPanelBtn = document.createElement("button");
        elementMarkPanelBtn.type = "button";
        elementMarkPanelBtn.className = "dice-add-btn roster-dice-add-btn";
        elementMarkPanelBtn.textContent = "\u{1F525}";
        elementMarkPanelBtn.title = window.I18N.t("element_mark_panel_title");
        elementMarkPanelBtn.addEventListener("click", function () {
          openElementMarkPanel();
        });
        diceTitleRow.appendChild(elementMarkPanelBtn);
      }
      var diceWrap = document.createElement("div");
      diceWrap.className = "dice-pool-list";
      renderRosterDiceDisplay(c, diceWrap);
      diceCol.appendChild(diceTitleRow);
      diceCol.appendChild(diceWrap);
      // 骰子池からの予測（旧dice-status-label、computeDiceStatus由来）は骰子が解決/消化
      // されると空になり、その後は実際の隊列・敵視が変わっても何も表示されないままになる
      // うえ、常に最新の実際の戦場状態を示すliveStatusと二重表示になっていたため廃止した。
      // 実際の戦場状態（state.battle側）から常に読み直すliveStatusのみを表示し、
      // 隊列切替／敵視±のたびに再描画する（#4b）。
      var liveStatus = document.createElement("p");
      liveStatus.className = "dice-status-label battle-live-status-label";
      renderLiveBattleStatusLabel(liveStatus, c);
      diceCol.appendChild(liveStatus);
      var blessingToggleBtn = document.createElement("button");
      blessingToggleBtn.type = "button";
      blessingToggleBtn.className = "breakthrough-blessing-btn";
      if (dicePoolRerollPending[c.id]) blessingToggleBtn.classList.add("active");
      blessingToggleBtn.textContent = window.I18N.t("breakthrough_blessing_button", {
        current: c.blessingSlots ? c.blessingSlots.current : 0,
      });
      blessingToggleBtn.disabled =
        !dicePoolRerollPending[c.id] && (!(c.dicePool || []).length || !c.blessingSlots || c.blessingSlots.current <= 0);
      blessingToggleBtn.addEventListener("click", function () {
        toggleDicePoolBlessing(c);
      });
      diceCol.appendChild(blessingToggleBtn);
      if ((c.dicePool || []).length) {
        var diceResetBtn = document.createElement("button");
        diceResetBtn.type = "button";
        diceResetBtn.className = "danger-btn roster-dice-reset-btn";
        diceResetBtn.textContent = window.I18N.t("roster_dice_reset_button");
        diceResetBtn.addEventListener("click", function () {
          var diceValues = c.dicePool.join("、");
          if (!window.confirm(window.I18N.t("roster_dice_reset_confirm", { name: c.name, dice: diceValues }))) return;
          c.dicePool = [];
          // GMが手動で骰子をリセットした場合も、次のロールで前後衛・敵視を改めて確定できるよう
          // 該当スロットのロックを解除する。
          if (rosterIdx < BATTLE_SLOT_COUNT && state.battle.positionLocked) {
            state.battle.positionLocked[rosterIdx] = false;
          }
          saveRosterCharacters();
          saveState();
          addLog("log_dice_pool_reset", { character: c.name, dice: diceValues });
          renderCharacterRoster();
        });
        diceCol.appendChild(diceResetBtn);
      }
      // 「一般行動」フェイズ中は戦闘actionを行わない前提のため、戦闘ボタン自体を出さない。
      if (state.actionPhase !== "normal") {
        var combatBtn = document.createElement("button");
        combatBtn.type = "button";
        combatBtn.className = "primary-btn roster-combat-btn";
        combatBtn.textContent = window.I18N.t("combat_button_label");
        combatBtn.addEventListener("click", function () {
          openCombatModal(c.id);
        });
        diceCol.appendChild(combatBtn);
      }

      var actionCol = document.createElement("div");
      actionCol.className = "roster-detail-col";
      var actionTitle = document.createElement("h5");
      actionTitle.textContent = window.I18N.t("action_log_column_title");
      actionCol.appendChild(actionTitle);
      renderActionBoxes(c, actionCol);

      var weaponCol = document.createElement("div");
      weaponCol.className = "roster-detail-col";
      var weaponHeader = document.createElement("div");
      weaponHeader.className = "roster-weapon-col-header";
      var weaponToggleBtn = document.createElement("button");
      weaponToggleBtn.type = "button";
      weaponToggleBtn.className = "collapse-triangle";
      weaponToggleBtn.setAttribute("aria-label", "toggle weapon list");
      var weaponTitle = document.createElement("h5");
      weaponTitle.textContent = window.I18N.t("character_weapons_label");
      var weaponSummary = document.createElement("span");
      weaponSummary.className = "weapon-equipped-summary";
      weaponSummary.textContent = CharacterDrawer.equippedWeaponSummaryText(c);
      weaponHeader.appendChild(weaponToggleBtn);
      weaponHeader.appendChild(weaponTitle);
      weaponHeader.appendChild(weaponSummary);
      var weaponWrap = document.createElement("div");
      weaponWrap.className = "roster-weapon-list";
      CharacterDrawer.renderRosterWeaponList(c, weaponWrap);
      var weaponCollapsed = !!rosterWeaponCollapsed[c.id];
      weaponWrap.classList.toggle("collapsed", weaponCollapsed);
      weaponToggleBtn.innerHTML = weaponCollapsed ? "&#9656;" : "&#9662;";
      weaponToggleBtn.addEventListener("click", function () {
        var nowCollapsed = weaponWrap.classList.toggle("collapsed");
        rosterWeaponCollapsed[c.id] = nowCollapsed;
        weaponToggleBtn.innerHTML = nowCollapsed ? "&#9656;" : "&#9662;";
      });
      weaponCol.appendChild(weaponHeader);
      weaponCol.appendChild(weaponWrap);

      var talismanCol = document.createElement("div");
      talismanCol.className = "roster-detail-col";
      var talismanTitle = document.createElement("h5");
      talismanTitle.textContent = window.I18N.t("character_talismans_roster_label");
      var talismanWrap = document.createElement("div");
      talismanWrap.className = "roster-weapon-list";
      CharacterDrawer.renderRosterTalismanList(c, talismanWrap);
      talismanCol.appendChild(talismanTitle);
      talismanCol.appendChild(talismanWrap);

      var consumableCol = document.createElement("div");
      consumableCol.className = "roster-detail-col";
      var consumableTitle = document.createElement("h5");
      consumableTitle.textContent = window.I18N.t("character_consumables_roster_label");
      var consumableWrap = document.createElement("div");
      consumableWrap.className = "roster-weapon-list";
      CharacterDrawer.renderRosterConsumableList(c, consumableWrap);
      consumableCol.appendChild(consumableTitle);
      consumableCol.appendChild(consumableWrap);

      detailFlex.appendChild(diceCol);
      detailFlex.appendChild(actionCol);
      detailFlex.appendChild(weaponCol);
      detailFlex.appendChild(talismanCol);
      detailFlex.appendChild(consumableCol);
      detailTd.appendChild(detailFlex);
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);

      var block = document.createElement("div");
      block.className = "roster-character-block";
      var h4 = document.createElement("h4");
      h4.textContent = c.name;
      block.appendChild(h4);

      var activeTitle = document.createElement("h5");
      activeTitle.textContent = window.I18N.t("cv_active_skills_title");
      var activeWrap = document.createElement("div");
      var passiveTitle = document.createElement("h5");
      passiveTitle.textContent = window.I18N.t("cv_passives_title");
      var passiveWrap = document.createElement("div");
      if (type) CharacterDrawer.renderAbilitySections(c, type, activeWrap, passiveWrap);

      block.appendChild(activeTitle);
      block.appendChild(activeWrap);
      block.appendChild(passiveTitle);
      block.appendChild(passiveWrap);
      skillsWrap.appendChild(block);
    });

    if (typeof syncDiceStatusToBattle === "function") syncDiceStatusToBattle();
    if (typeof renderBattlePositionAreas === "function") renderBattlePositionAreas();
  }

  function buildDeck() {
    var deck = [];
    SUITS.forEach(function (suit) {
      RANKS.forEach(function (rank) {
        deck.push({
          code: suit + "-" + rank,
          suit: suit,
          rank: rank,
          label: SUIT_SYMBOL[suit] + rank,
          colorClass: SUIT_CLASS[suit],
        });
      });
    });
    return deck;
  }

  var DECK = buildDeck();
  var CARD_BY_CODE = {};
  DECK.forEach(function (c) {
    CARD_BY_CODE[c.code] = c;
  });

  function defaultChecks() {
    return { one: false, all: false };
  }

  var TIME_LOSS_ROW_DEFS = [
    { kind: "threat", boxes: 2 },
    { kind: "rain", tier: 1, boxes: 2 },
    { kind: "threat", boxes: 2 },
    { kind: "rain", tier: 2, boxes: 2 },
    { kind: "threat", boxes: 2 },
    { kind: "rain", tier: 3, boxes: 2 },
    { kind: "visit", boxes: 1 },
  ];

  function defaultTimeLossDay() {
    return TIME_LOSS_ROW_DEFS.map(function (def) {
      return new Array(def.boxes).fill(false);
    });
  }

  function defaultTimeLoss() {
    return { day1: defaultTimeLossDay(), day2: defaultTimeLossDay() };
  }

  function defaultWanderingBlessing() {
    return { base: [false, false, false], extra: [false, false, false] };
  }

  var ROLL_EFFECTS = [
    { id: "enemy_damage", tiers: 4 },
    { id: "enemy_hp", tiers: 2 },
    { id: "max_blessing", tiers: 2 },
    { id: "attribute_buildup", tiers: 2 },
    { id: "flask_uses", tiers: 2 },
  ];

  function defaultRollEffects() {
    var obj = {};
    ROLL_EFFECTS.forEach(function (e) {
      obj[e.id] = 0;
    });
    return obj;
  }

  var ENEMY_HP_ROWS = 4;
  var ENEMY_HP_COLS = 20;
  var BATTLE_SLOT_COUNT = 4;

  function defaultBattleState() {
    return {
      front: new Array(BATTLE_SLOT_COUNT).fill(false),
      back: new Array(BATTLE_SLOT_COUNT).fill(false),
      // PC1〜4の「敵視」。番号は前衛／後衛どちらのマスにいても同じPCを指すため、両エリアで共有する。
      aggro: new Array(BATTLE_SLOT_COUNT).fill(0),
      // 最初の全骰子ロールで前後衛・敵視を確定させた後、syncDiceStatusToBattleによる
      // 自動再計算を止めるためのロック（PC1〜4スロット単位、front/back/aggro共通）。
      positionLocked: new Array(BATTLE_SLOT_COUNT).fill(false),
      enemyHp: new Array(ENEMY_HP_ROWS * ENEMY_HP_COLS).fill(false),
      // 各段（行）の敵の実際の最大HP（カード記載値）。未設定（敵未追加）はnull＝ENEMY_HP_COLS基準にフォールバック。
      enemyHpMax: new Array(ENEMY_HP_ROWS).fill(null),
      mobHpRows: [],
      selectedEnemyIds: [],
      // 屬性/異常面板のデータ:
      // dealt: 「角色が選択中の敵人へ与えた蓄積」の内訳表示用（攻撃action確定時に自動加算、
      //   キーは"角色id|敵人key|屬性又は異常名" → 累積値。角色ごとの内訳表示にのみ使う）。
      // enemyAccum: 敵人ごとの実際のトリガー判定用蓄積（全角色分を合算、キーは"敵人key|label"）。
      //   屬性は閾値到達後も蓄積を継続保持（同一回合内で複数回發動）、異常は發動時に0へ戻す。
      // enemyTriggerCount: 屬性側の「これまで發動した回数」（floor(蓄積/閾値)）。
      // enemyRoundLocked: 異常側の「今回合すでに發動した」ロック（回合境界でクリアする）。
      // received: 「角色が受けている屬性/異常」の集計値（角色idごとに { label: 現在値 }）。
      // charTriggerCount / charRoundLocked: 角色側の屬性/異常トリガー管理（enemy側と同じ役割）。
      attributeStatus: {
        dealt: {},
        enemyAccum: {},
        enemyTriggerCount: {},
        enemyRoundLocked: {},
        received: {},
        charTriggerCount: {},
        charRoundLocked: {},
      },
      // 睡眠トリガーで敵人へ累加する「亂戰傷害」修正値（負数、キーは敵人key）。
      enemyDmgOverride: {},
      // 遺物効果「致命一擊」：「1回合僅限1名PC使用」のため、誰が使ったかは問わずbattle全体で
      // 1個のロックにする。combatフェイズへの新規突入（＝新しい回合）でリセットする。
      fatalStrikeUsedThisRound: false,
      // 自動化GM: 坩堝の騎士のような「戦闘開始時に雑兵の有無を確認し、以後は戦闘終了まで
      // その判定を使い続ける」特殊能力用のスナップショット（キーはenemyKey）。一度記録したら
      // 途中で雑兵が全滅してmobHpRowsから消えても、この特殊ロール判定には影響させない。
      autoGmMobPresentSnapshot: {},
      // 自動化GM: グラディウスのような多形態の夜の王用、現在の形態（"fused"＝合体形態／
      // "split"＝分裂形態）。戦闘開始時は規則書どおり合体形態が既定。形態変化は「エンドフェイズ
      // 開始時」というタイミング依存のため自動切替はせず、GMが手動でトグルする運用とする。
      bossForm: "fused",
      // 體勢崩潰（体勢崩し）：敵人／夜の王のHP行（state.battle.enemyHp）のいずれか1行でも
      // 「未撃破→ちょうど今回0に到達」した瞬間に一度だけtrueになる、戦闘終了まで持続するフラグ
      // （どの行が最初に0に到達したかは問わない、ユーザー確認済み仕様）。マリスの特殊能力
      // 「行動激化」（體勢崩し発生後は「1D」ではなく「1D＋2」で行動判定）のように、体勢崩し発生後
      // だけ有効になるルールの判定にauto_gm.js側から参照する。
      guardBroken: false,
      // ガード回数（現在値）。キーはenemyKey（"familyId|enemyId|level"または"boss|<id>"）、
      // 値は現在のガード回数。未設定（キーが存在しない）＝そのエネミーのガード回数最大値
      // （family.guardCount／夜の王のguardCount）を意味する（docs/enemy_damage_rules.md
      // 5節）。新しい回合（防禦→戰鬥フェイズ再突入）ごとに全員最大値へ回復するため、
      // setActionPhaseでこのオブジェクト自体を空にする（＝全員フォールバックで最大値扱いに戻す）。
      guardCount: {},
      // グラディウス「分裂形態」移行条件2：分裂形態のいずれかの個体HP行が「現在HP：0以下」に
      // なった瞬間trueになり、防御フェイズ終了時（setActionPhaseがdefenseを抜けるタイミング）
      // に消費されてbossFormを"fused"へ自動で戻す（分裂形態では体勢崩し自体は発生しない、
      // ユーザー確認済み仕様。docs/enemy_damage_rules.md 9節）。
      bossFormTransitionPending: false,
      // 使用者確認：「1段が體勢崩しを起こすのは1回だけ」——自動化GMがautoAdvanceBattlePhaseで
      // 戰鬥→額外を自動判定する際、既にこの配列に含まれる段番号（0-3）は「もう額外階段の
      // トリガーとして使用済み」とみなし、そのHPが0のまま残っていても再度額外階段へは進まない
      // （guardBrokenは戰鬥全體で1回だけの体勢崩し発生フラグのため、これとは別の「段ごと」の
      // 記録が必要）。戰鬥終了（combatEnd）時にクリアする。
      staggerRowsHandled: [],
      // 自動化GM 戰鬥自動化：通常戰鬥／簡易戰鬥判定（docs/combat_flow_rules.md §6）。
      // "normal"｜"simplified"｜null（未判定＝尚未透過resolveAndAddCombatEnemies判定過）。
      // 戰鬥級生命週期，combatEnd（notifyCombatEnded）時與guardCount等一併清除，不隨phase切換重置。
      combatMode: null,
      // ボス戰闘（王戦）は必ず通常戰鬥、ザコ戰鬥のみPC平均Lv比較で判定する（同docs §6）。
      combatIsBoss: false,
      // 簡易戰鬥の「追擊損害」確認バナーが表示中かどうか（GMが[確認]を押すまでtrue）。
      simplifiedCombatEndPending: false,
      // 回合內細粒度階段（"請擲骰！"／"攻擊中！"等GM敘述提示用）。進入combat/extra/defense時初始化。
      roundStage: "awaitingRoll",
      // 本回合已完成動作的角色（key=角色id、value=true）。每次phase切換都清空。
      roundActionsDone: {},
      // 每個角色按下「已完成」時，依「點擊順序」（不是角色欄位順序）追加一筆{charId, lines}，
      // 顯示在進度版敘述中；取消準備時移除該筆（其後的行自然往上遞補），再次按下則排到最後面
      // （使用者確認的行為）。每次phase切換都清空。
      roundActionLog: [],
      // [攻擊]/[防禦]確認後、[結束回合]前顯示在進度版的結算文字（roundStage==="resolving"時使用）。
      roundResultText: null,
      // 防禦階段全員擲骰完成時，autoTriggerDefenseRollが自動擲出的敵方行動結果，用來讓GM之後
      // 打開#enemy-damage-modal時復原相同數值（不重新擲骰）。
      pendingDefenseRoll: null,
      // AutoGM敵方行動結構化資料中的elementAccum/ailmentAccum（固定數值的屬性/狀態異常附加值，
      // 見enemy_auto_gm_data.js／auto_gm.js的structured schema）：key=角色id，value=
      // [{label, amount}]。handleAutoGmRollClick依groupDamage/individualDamage的目標結算後
      // 寫入（每次重新擲骰整個覆寫），handleEnemyDamageConfirmForCharacter於該角色按下［確定］
      // 時實際套用到state.battle.attributeStatus.received並清除該角色的項目（與HP損害同樣延後到
      // 確定時才產生實際效果，數值本身不可由GM於此UI調整）。
      pendingDefenseElementAccum: {},
      // 「次のアクションフェイズ開始時、PC全員が骰目に関わらず後衛へ強制配置される」特殊能力
      // （死儀礼の鳥「飛び退き」等、conditions:["force_back_row_next_phase"]）用の1回限りフラグ。
      // handleAutoGmRollClickが該当行を確定した時にtrueへ、setActionPhase("combat")新規突入時に
      // 消費してfalseへ戻す。
      forceBackRowNextPhase: false,
      // 防禦階段全員擲骰完成時，顯示在進度版的AutoGM擲骰速報文字（亂戰/個別傷害內訳＋各PC預估損害）。
      defenseRollPreviewText: null,
      // #enemy-damage-modal內，已按下［確定］的角色（key=角色id、value=true）。全員確定後才
      // 觸發finishEnemyDamageRound並清空。
      enemyDamageConfirmed: {},
      // 每個角色按下［確定］時計算出的實際HP損害（key=角色id、value=數值），finishEnemyDamageRound
      // 用來組成進度版的結算文字。
      defenseHpLossSummary: {},
      // 進入防禦階段時要處理的效果（時間消耗1、可能連帶觸發的威脅效果／夜雨），顯示在進度版
      // 敘述最前面（打字機說明）。每次phase切換都清空。
      defenseEntryEffectText: null,
    };
  }

  // イベントチット（靈脈・商人・祝福・強敵・ランダム）: 毎晩、9マスにランダム配置され、
  // カードを翻開するまで内容は分からない（自訂・固定副本のどちらでも共通）。
  var EVENT_CHIP_TYPES = [
    { id: "spirit_vein", icon: "spirit-vein.png" },
    { id: "merchant", icon: "merchant.png" },
    { id: "merchant", icon: "merchant.png" },
    { id: "blessing", icon: "blessing.png" },
    { id: "blessing", icon: "blessing.png" },
    { id: "blessing", icon: "blessing.png" },
    { id: "strong_enemy", icon: "strong-enemy.png" },
    { id: "strong_enemy", icon: "strong-enemy.png" },
    { id: "random", icon: "random.png" },
  ];

  // 規則書側は9個の籌碼それぞれに固定番号①〜⑨（EVENT_CHIP_TYPES配列順）を持つ（例：⑦⑧が
  // 強敵、⑧は2日目に「恐るべき強敵」へ変化する特別枠）。従来はidだけshuffleしていたため
  // 洗牌後にこの番号が失われ、⑦/⑧の区別がつかなくなっていた——{id,number}のペアごと
  // shuffleすることで番号を保持する。
  function rollEventChips() {
    var pool = EVENT_CHIP_TYPES.map(function (c, i) {
      return { id: c.id, number: i + 1 };
    });
    var shuffled = shuffle(pool);
    return {
      ids: shuffled.map(function (p) { return p.id; }),
      numbers: shuffled.map(function (p) { return p.number; }),
    };
  }

  // チットの表示ラベル（盤面アイコンのalt/label、籌碼視窗のタイトル、自動化GM敘述で共通利用）。
  // 通常は"event_chip_"+chipIdそのままだが、⑧号の強敵チットだけ規則書の既存文言
  // （event_rulebook.jsに実在："２日目のイベントチット「⑧強敵※」は、「恐るべき強敵」として
  // 扱う"）に沿って、1日目「強敵※」／2日目「恐るべき強敵」に差し替える。
  function eventChipDisplayLabel(idx) {
    var chipId = state.eventChips[idx];
    if (!chipId) return "";
    var isNo8StrongEnemy =
      chipId === "strong_enemy" && state.eventChipNumbers && state.eventChipNumbers[idx] === 8;
    if (isNo8StrongEnemy) {
      return window.I18N.t(state.dayNumber === 2 ? "event_chip_strong_enemy_no8_day2" : "event_chip_strong_enemy_no8_day1");
    }
    return window.I18N.t("event_chip_" + chipId);
  }

  var state = {
    // Firebase同步用のクライアント時刻タイムスタンプ（saveState()で書き込み時に更新、
    // applyLoadedDataで遠端/localStorageから読み込んだ時にも更新）。subscribeNightStateの
    // callbackが「遠端の方が古いデータかどうか」を判定するのに使う（後述）。
    updatedAt: 0,
    slots: new Array(SLOT_COUNT).fill(null), // { code, revealed } | null
    cardLevels: new Array(SLOT_COUNT).fill(null), // null("全") | 0-5
    eventChips: new Array(SLOT_COUNT).fill(null), // 各マスのイベントチット（翻開まで非公開）
    eventChipNumbers: new Array(SLOT_COUNT).fill(null), // 各マスのチット固定番号（1-9、rollEventChipsで洗牌後も保持。⑦⑧強敵の区別に使う）
    eventChipsUsed: new Array(SLOT_COUNT).fill(false), // 「籌碼事件」で何らかの行動を使用済みのマス（取り消し線表示、再発火防止）
    eventChipsData: {}, // key: index -> チットごとの永続データ（例:強敵チットの決定済みエネミー）
    // 「黄金樹の帳」夜の強敵決定表の確定結果（{day1:{roll,ja,zh}, day2:{...}}、いずれも未確定
    // ならkey自体が無い）。チットとは無関係の永続データのため、2日目セットアップの再配置
    // （eventChipsDataがクリアされる箇所）では一緒にクリアしない——新しいゲーム開始時のみ
    // resetStateでクリアする。
    nightBossRoll: {},
    boardStarted: false,
    log: [], // { key, params, time(ms) }
    focusedIndex: null,
    selection: new Set(),
    selectMode: "initial",
    maxSelect: SLOT_COUNT,
    dayNumber: 1,
    startSuit: null,
    endSuit: null,
    startChecks: defaultChecks(),
    endChecks: defaultChecks(),
    startDefeated: false, // 前日の終點が「撃破済み」として起點側に引き継がれた状態か
    startDefeatedDay: null,
    timeLoss: defaultTimeLoss(),
    wanderingBlessing: defaultWanderingBlessing(),
    rollEffects: defaultRollEffects(),
    smithingStone: "",
    smithingStoneCount: 0,
    stoneswordKey: "",
    stoneswordKeyCount: 0,
    grace: "",
    battle: defaultBattleState(),
    dicePool: [],
    actionPhase: "normal", // "normal"|"combat"|"extra"|"defense"
    floorRewardObtained: {}, // key: floorKey+"_"+entryIndex(+"_"+targetCharacterId) -> true
    floorRewardDismissed: {}, // key: floorKey+"_dismiss_"+entryIndex -> true（GMが個別に取消した項目）
    turnHolder: "gm", // "gm"|"gmEnding"|"players"|"playersEnding"（GM/玩家が同時にプレイしなくても各自の番で行動できるようにする受け渡しフラグ。GM限定の操作はstate.turnHolder==="gm"の完全一致でのみ許可し、"gmEnding"/"playersEnding"は中立状態として扱う）
    turnMessages: [], // {text, time, side("gm"|"players")}の配列。自分の番が再び始まる瞬間に自分側の分だけクリアされる
    turnMessageHistory: [], // 上記でクリアされた留言を全て保持する読み取り専用の履歴（最新300件まで）
    turnRewards: [], // {id, text, checked}の配列。地板獎勵とは無関係の獨立勾選清單、手動削除まで保持
    turnBoardEnabled: true, // 主選單から行動留言板機能全体を開閉するフラグ
    logBubbleEnabled: false, // 紀錄ドロワーの懸浮泡泡（公開盤左上に常時表示するショートカット）を出すかどうか
    locationBannerCollapsed: false, // 右上の現在地バナー（#location-status-overlay）を折りたたみ表示にするかどうか
    locationBannerCorner: "right", // #23：折りたたみ時、スワイプでスナップした位置。"right"|"left"
    autoGmEnabled: false, // 自動化GM機能全体のON/OFF。誰でも切替可能（パスワード制限なし、turnHolder制限も無し）
    autoGmLog: [], // 自動化GMの監査ログ（通常のstate.logとは別。誰がいつ何を確認・確定したか、後から検証できるように保持）
    gmFlowEnabled: false, // 自動化GM Phase 2（シナリオ進行フロー：進度版の[進入]/[突破]・敘述・獎勵収集ゲート）のON/OFF。autoGmEnabledとは別軸、こちらも誰でも切替可能
    gmFlow: {
      narrationText: null, // 進度版に現在表示中のGM敘述文（打字機再生中/再生済み）。null=敘述なし（通常の[進入]/[突破]ボタン表示）
      awaitingOk: false, // trueの間は進度版に[OK]だけを表示し、[進入]/[突破]を隠す
      // awaitingOk中に出すボタンの種類："ok"(単一[OK])|"nightAdvance"([進入下一晚]/[稍後])|
      // "finalDayBattle"([開啟夜王戰鬥])|"branchChoice"(分岐選択ボタン群)|"lineChoice"((→X)選択ボタン群)|
      // "combatTrigger"([雜兵戰鬥]/[王戰]、第17・18項)|"battleWait"(戦闘解決待ち、ボタンなし、第17・18項)
      actionKind: "ok",
      pendingRewardWindows: [], // 縮小されたが未領取/未關閉の獎勵視窗id一覧。空でない間は[獲得完]を押しても再度リマインドする
      openingPlayed: false, // 夜の王の〔開場〕をこのゲームで再生済みか（二重再生防止）
      finalDayAnnounced: false, // 3日目到達のアナウンスをこのゲームで再生済みか（二重再生防止）
      // 場地カードの規則書テキスト（branches[].floors[].lines[]）を順番に敘述していく進行状況。
      // null＝敘述walkthrough中ではない。
      walk: null, // { slotIndex, branchIndex(nullなら分岐未選択), floorIndex, lineIndex, branchFloor(第27項：選択済み分岐の深さ、nullなら制限無し), branchFloorArmed(ジャンプ直後の見出し行自身を境界判定から除外するフラグ), pendingPrefixText(ジャンプ先の見出しに辿り着くまでに挟まっていた共通・確定内容、次のadvanceFieldWalkで1回だけ差し込む), pendingOutcomeFilter("成功"/"失敗"/null——協力式・単人指定判定確定直後、一致しない側の結果行を読み飛ばすためのフィルター), pendingConvergeLabel(判定行自身に埋め込まれた「成否に関わらず〜（→X）」マーカーのラベル/null——境界判定でこの行き先だけは「選ばなかった分岐」として誤って読み飛ばさないようにする) }
      pendingChoiceLabels: [], // actionKind==="lineChoice"のときに提示する(→X)ラベルの配列
      combatTriggerLabel: null, // actionKind==="combatTrigger"のときのボタン文言（「雜兵戰鬥」／「王戰」、トリガー行の文言そのもの）
      abilityCheckSpec: null, // actionKind==="abilityCheck"のときの{target,statKey}（PC全員が個別に判定する行為判定の自動擲骰モーダル用）
      cooperativeCheckSpec: null, // actionKind==="cooperativeCheck"のときの{target,perPC,statKey}（協力式・単純な1回勝負の行為判定の自動擲骰モーダル用）
      playerPickCheckSpec: null, // actionKind==="playerPickCheck"のときの{target,statKey,retryOnFail}（特定の1名のPCだけが行う判定用）
      playerPickCheckExcluded: [], // playerPickCheckで既に失敗して除外済みのcharId配列（retryOnFail中のみ意味を持つ）
      // actionKind==="branchPointTally"のときの{target,statKey,repeat,round,points,highLabel,lowLabel,lowThreshold}
      // （坑道「白い結晶」専用：分岐ポイント累積で2枝分岐を自動決定する判定用）
      branchPointTallySpec: null,
      // actionKind==="sequentialPairCheck"のときの{checks:[{target,statKey}, {target,statKey}],stepIndex,
      // totalSuccess,totalAttempts,markerLabel}（坑道「白い結晶」専用：連続2種判定を成功数で3段階へ振り分ける判定用）
      sequentialPairSpec: null,
      // actionKind==="conditionalCooperativeChoice"のときの{options:[{label,target,perPC,statKey}, {label,target,perPC,statKey}]}
      // （湖沼(睡)専用：祭壇に興味があるか先に選ばせてから使う協力式判定を決める）
      conditionalCooperativeChoiceSpec: null,
      // actionKind==="sequentialCooperativeChain"のときの{mode,steps:[{target,statKey}, ...],stepIndex,successCount,awaitingContinue,markerLabel}
      // （東の地下砦「入り組んだ地下の回廊」／水辺の大教会「正面から（梅花）」／発狂地帯「狂い火の塔3」／
      // 襲撃「三つ首の獣」「狼の気配2」専用：協力式判定を順番／連続で連鎖させる）
      sequentialChainSpec: null,
      // actionKind==="openEndedTallyCheck"のときの{target,statKey,successThreshold,failEscalationStep,successCount,failCount,successLineJaLabel}
      // （水辺の大教会「水辺を抜けて横の瓦礫から」専用：任意のPCが目標成功回数に達するまで判定を繰り返す）
      openEndedTallySpec: null,
      // actionKind==="representativePickCheck"のときの{repTarget,repStat,othersTarget,othersStat}
      // （大野営地「火の戦車」専用：代表者1人＋それ以外の入場PC全員でそれぞれ異なる目標値の判定を行う）
      representativePickSpec: null,
      // actionKind==="multiStatIndividualCheck"のときの{checks:[{target,statKey}, ...],stepIndex,results,markerLabel}
      // （砦「壺投げのトロル」専用：PC全員がそれぞれ異なる屬性の判定を複数回行う）
      multiStatCheckSpec: null,
      freeFloorOptions: [], // actionKind==="freeFloorChoice"のときに提示する未踏破position（1始まり）の配列（路線自由カード用）
      // actionKind==="battleWait"の間trueなら、エネミーの全HP行が0になった瞬間
      // （night.jsのsetActionPhase、combatEndオプション経由）に自動で敘述の続きへ進める。
      battleWaitActive: false,
      // 自動化GM 戰鬥自動化：notifyCombatEndedが敵人擊破を検知した瞬間にtrueを立て、この戰鬥に
      // 紐づく樓層獎勵ゲートが実際に閉じ終えた（closeGmFlowGateAndConsumePendingAdvance）時点で
      // 消費し、GMに代わって「重置全骰」相当の処理（戰鬥面板・玩家骰子・執行紀錄の一括クリア）
      // を自動実行するための予約フラグ。
      pendingBattleResetOnGateClose: false,
      // finishFieldWalkが「この＋1でカードの実在する樓層を全踏破した（cardLevels===floorCount）」
      // と検出した対象slotIndex（数値）。この樓層の獎勵ゲートをGMが領取し終える
      // （closeGmFlowGateAndConsumePendingAdvance）まで、続けて「全」へ進めるのを遅延させておく
      // ためのポインタ。null＝該当なし。
      pendingFinalFloorSlot: null,
      // 第19項：actionKind==="chipOffer"の間、確認対象の籌碼があるslotIndexと、解決後に
      // 続ける処理（"startWalk"｜"cardConclusion"）。finishFieldWalkがカードの最後の樓層の
      // 敘述終了時に記録しておいたslotIndex（pendingChipCheckSlot）とpendingMapMoveSlotは、
      // advanceCardConclusionChainが「全踏破処理→籌碼確認→地圖移動」の順で順次消費する。
      chipOfferSlot: null,
      chipOfferContinuation: null,
      pendingChipCheckSlot: null,
      pendingMapMoveSlot: null,
      // 第4項：地圖移動ゲート（actionKind==="mapMove"）を開いた時点のfocusedIndex。
      // [OK]を押した時点でこの値とfocusedIndexが同じなら「まだ移動していない」と判定し、
      // ゲートを閉じずリマインドを繰り返す（handleMapMoveOkClick参照）。
      pendingMapMoveFromIndex: null,
      // actionKind==="floorEnd"のfloorオブジェクト自体（night_gm_flow.jsのpendingFloorEndFloor、
      // モジュール内変数）を再構築するための直列化可能な参照。ページ再読み込み・再接続を挟むと
      // モジュール内変数は失われるため、{slotIndex,branchIndex,floorIndex}だけをstateに残しておき、
      // resolveFieldEntryForSlot経由でfloorオブジェクトを再解決できるようにする。
      pendingFloorEndRef: null,
      // ユーザー指定：actionKind==="floorEnd"の間、[領取獎勵]ボタンを一度押したかどうか。
      // trueの間はrenderLocationBanner側で[領取獎勵]ボタン自体を描画しない（[領取完]のみ残す）。
      floorEndRewardOpened: false,
      // 強敵チット：樓層の敘述（walk）とは独立した「強敵戦闘」に入っている間のslotIndex。
      // null＝強敵戦闘中ではない。night.jsのsetActionPhase（combatEnd）が、樓層敘述由来の
      // notifyCombatEndedと並行してnotifyChipCombatEndedも呼び、この値が数値の間だけ
      // 強敵撃破処理（獎勵付与・チット使用済み化）を行う。
      chipCombatSlot: null,
      // 撃破時の獎勵が「強敵（撃破ルーン8／潜在する力★★）」か「恐るべき強敵（12／★★★）」かの
      // 判定（event_rulebook.js「強敵チット」本文の固定値、2日目の⑧号チットのみtrue）。
      chipCombatIsTerrible: false,
      // 強敵戦闘に入る直前のchipOfferContinuation（"startWalk"｜"cardConclusion"）を、
      // 撃破後（notifyChipCombatEnded→chipCombatResumeContinuation）まで保持しておくための
      // 一時退避先。
      chipCombatContinuation: null,
      // 撃破直後の［OK］（handleChipCombatResolvedOkClick）で再開する継続処理と対象slotIndex。
      chipCombatResumeContinuation: null,
      chipCombatResumeSlot: null,
    },
    // GMが開いて縮小した抽選ウィンドウを全端末で共有するための領域。null=未使用。
    // 中身はcharacter_drawer.jsのweaponRollState/talismanRollState/consumableRollState、
    // またはnight.js内のpotentialPower関連状態と同じ形をした素のJSONオブジェクト。
    activeDraws: { potentialPower: null, weapon: null, talisman: null, consumable: null, turnRewardAutoOpen: null },
    activeThreatEffects: [], // {id, text}の配列。「階段結束為止」等の非純傷害スキル効果をGM/玩家が自由記述で追加・Xで削除する手動リスト
    returnedCardMemory: {}, // key: slot index -> {code, cardLevel}。#19：うっかり「山札に戻す」した直前の内容を記録し、空きマス長押しで復元できるようにする
    cardFloorRewardGranted: {}, // key: slot index -> true。#10：樓層レベルが「全」に達した瞬間の自動盧恩付与・広播が二重発火しないようにするフラグ
    // key: slot index -> boolean[]（branch.floorPreviews.length分、position-1がindex）。
    // 「路線自由」（branch.freeFloorOrder）カード専用——通常のcardLevels連番進行の代わりに
    // 位置ごとのクリア状態を持つ（砦／地下砦カード：フロアを任意の順で選べ、指定数踏破で全踏破）。
    freeFloorCleared: {},
    // key: slot index -> boolean[]（floorCount分）。通常カード専用——cardLevelsは「次に
    // 試すべき樓層」を指すポインタに過ぎず、突破判定で「スキップ」しただけの樓層も
    // ポインタを進めてしまう。このため「実際にその樓層の敘述を最後まで読み終えた（真に
    // 踏破した）」かどうかを別途ここで管理する（docs/scenario_flow_rules.md：突破スキップは
    // フィールド移動まで一時的、真の踏破ではない）。
    floorCleared: {},
  };

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function codesOnBoard() {
    var set = new Set();
    state.slots.forEach(function (s) {
      if (s) set.add(s.code);
    });
    return set;
  }

  function isSwappedDay() {
    return state.dayNumber % 2 === 0;
  }

  function fieldLevelsForDay() {
    return isSwappedDay() ? [5, 4, 3] : [0, 1, 2];
  }

  function buildSaveData() {
    return {
      updatedAt: state.updatedAt,
      slots: state.slots,
      cardLevels: state.cardLevels,
      eventChips: state.eventChips,
      eventChipNumbers: state.eventChipNumbers,
      eventChipsUsed: state.eventChipsUsed,
      eventChipsData: state.eventChipsData,
      nightBossRoll: state.nightBossRoll,
      boardStarted: state.boardStarted,
      log: state.log,
      focusedIndex: state.focusedIndex,
      dayNumber: state.dayNumber,
      startSuit: state.startSuit,
      endSuit: state.endSuit,
      startChecks: state.startChecks,
      endChecks: state.endChecks,
      startDefeated: state.startDefeated,
      startDefeatedDay: state.startDefeatedDay,
      timeLoss: state.timeLoss,
      wanderingBlessing: state.wanderingBlessing,
      rollEffects: state.rollEffects,
      smithingStone: state.smithingStone,
      smithingStoneCount: state.smithingStoneCount,
      stoneswordKey: state.stoneswordKey,
      stoneswordKeyCount: state.stoneswordKeyCount,
      grace: state.grace,
      battle: state.battle,
      dicePool: state.dicePool,
      actionPhase: state.actionPhase,
      floorRewardObtained: state.floorRewardObtained,
      floorRewardDismissed: state.floorRewardDismissed,
      turnHolder: state.turnHolder,
      turnMessages: state.turnMessages,
      turnMessageHistory: state.turnMessageHistory,
      turnRewards: state.turnRewards,
      turnBoardEnabled: state.turnBoardEnabled,
      logBubbleEnabled: state.logBubbleEnabled,
      locationBannerCollapsed: state.locationBannerCollapsed,
      locationBannerCorner: state.locationBannerCorner,
      autoGmEnabled: state.autoGmEnabled,
      autoGmLog: state.autoGmLog,
      gmFlowEnabled: state.gmFlowEnabled,
      gmFlow: state.gmFlow,
      activeDraws: state.activeDraws,
      activeThreatEffects: state.activeThreatEffects,
      returnedCardMemory: state.returnedCardMemory,
      cardFloorRewardGranted: state.cardFloorRewardGranted,
      freeFloorCleared: state.freeFloorCleared,
      floorCleared: state.floorCleared,
    };
  }

  function saveState() {
    // 使用者確認：Firebase同步のrace condition対策（「関掉分頁再打開」/「他裝置連線」で
    // autoGmEnabled/focusedIndexが古いデータに巻き戻る問題）。ローカルで新しく書き込む
    // 直前に必ずタイムスタンプを更新し、subscribeNightState側が「遠端の方が古い」と
    // 判定できるようにする。
    state.updatedAt = Date.now();
    var data = buildSaveData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (game) GameStorage.pushNightState(gameId, game.storageMode, data);
  }

  // --- 「次の夜」への移行を1回分だけ取り消せる（押し間違い対策） ---
  var UNDO_KEY = "pritest-night-undo-" + gameId;
  var MAX_DAY = 3;

  function saveUndoSnapshot() {
    localStorage.setItem(UNDO_KEY, JSON.stringify(buildSaveData()));
  }

  function loadUndoSnapshot() {
    var raw = localStorage.getItem(UNDO_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearUndoSnapshot() {
    localStorage.removeItem(UNDO_KEY);
  }

  function applySnapshot(snap) {
    state.slots = snap.slots;
    state.cardLevels = snap.cardLevels;
    state.eventChips = snap.eventChips;
    state.eventChipNumbers = Array.isArray(snap.eventChipNumbers) ? snap.eventChipNumbers : new Array(SLOT_COUNT).fill(null);
    state.eventChipsUsed = Array.isArray(snap.eventChipsUsed) ? snap.eventChipsUsed : new Array(SLOT_COUNT).fill(false);
    state.eventChipsData = snap.eventChipsData && typeof snap.eventChipsData === "object" ? snap.eventChipsData : {};
    state.nightBossRoll = snap.nightBossRoll && typeof snap.nightBossRoll === "object" ? snap.nightBossRoll : {};
    state.boardStarted = snap.boardStarted;
    state.log = snap.log;
    state.focusedIndex = snap.focusedIndex;
    state.dayNumber = snap.dayNumber;
    state.startSuit = snap.startSuit;
    state.endSuit = snap.endSuit;
    state.startChecks = snap.startChecks;
    state.endChecks = snap.endChecks;
    state.startDefeated = snap.startDefeated;
    state.startDefeatedDay = snap.startDefeatedDay;
    state.timeLoss = snap.timeLoss;
    state.wanderingBlessing = snap.wanderingBlessing;
    state.rollEffects = snap.rollEffects;
    state.smithingStone = snap.smithingStone;
    state.smithingStoneCount = snap.smithingStoneCount || 0;
    state.stoneswordKey = snap.stoneswordKey;
    state.stoneswordKeyCount = snap.stoneswordKeyCount || 0;
    state.grace = snap.grace;
    state.battle = snap.battle;
    state.dicePool = snap.dicePool;
    state.actionPhase = snap.actionPhase || "normal";
    state.autoGmLog = snap.autoGmLog || [];
  }

  function handleUndoNight() {
    var snap = loadUndoSnapshot();
    if (!snap) return;
    if (!window.confirm(window.I18N.t("undo_night_confirm"))) return;
    applySnapshot(snap);
    clearUndoSnapshot();
    renderBoard();
    addLog("log_undo_night");
  }

  function renderUndoButton() {
    var btn = document.getElementById("btn-undo-night");
    if (!btn) return;
    btn.disabled = !loadUndoSnapshot();
  }

  function loadBattleState(raw) {
    var fallback = defaultBattleState();
    if (!raw || typeof raw !== "object") return fallback;
    var front = Array.isArray(raw.front) ? raw.front.slice(0, BATTLE_SLOT_COUNT).map(Boolean) : fallback.front.slice();
    while (front.length < BATTLE_SLOT_COUNT) front.push(false);
    var back = Array.isArray(raw.back) ? raw.back.slice(0, BATTLE_SLOT_COUNT).map(Boolean) : fallback.back.slice();
    while (back.length < BATTLE_SLOT_COUNT) back.push(false);
    var aggro = Array.isArray(raw.aggro)
      ? raw.aggro.slice(0, BATTLE_SLOT_COUNT).map(function (v) {
          return Number(v) || 0;
        })
      : fallback.aggro.slice();
    while (aggro.length < BATTLE_SLOT_COUNT) aggro.push(0);
    var positionLocked = Array.isArray(raw.positionLocked)
      ? raw.positionLocked.slice(0, BATTLE_SLOT_COUNT).map(Boolean)
      : fallback.positionLocked.slice();
    while (positionLocked.length < BATTLE_SLOT_COUNT) positionLocked.push(false);
    var hpTotal = ENEMY_HP_ROWS * ENEMY_HP_COLS;
    var enemyHp = Array.isArray(raw.enemyHp) ? raw.enemyHp.slice(0, hpTotal).map(Boolean) : fallback.enemyHp.slice();
    while (enemyHp.length < hpTotal) enemyHp.push(false);
    var enemyHpMax = Array.isArray(raw.enemyHpMax)
      ? raw.enemyHpMax.slice(0, ENEMY_HP_ROWS).map(function (v) {
          var n = Number(v);
          return n > 0 ? n : null;
        })
      : fallback.enemyHpMax.slice();
    while (enemyHpMax.length < ENEMY_HP_ROWS) enemyHpMax.push(null);
    var mobHpRows = Array.isArray(raw.mobHpRows)
      ? raw.mobHpRows.map(function (row) {
          var r = Array.isArray(row) ? row.slice(0, 10).map(Boolean) : [];
          while (r.length < 10) r.push(false);
          return r;
        })
      : [];
    // 「familyId|enemyId」の合成キー文字列で保持する（Enemies.get(familyId, enemyId)で解決するため）。
    var selectedEnemyIds = Array.isArray(raw.selectedEnemyIds)
      ? raw.selectedEnemyIds.filter(function (v) {
          return typeof v === "string" && v.indexOf("|") !== -1;
        })
      : fallback.selectedEnemyIds.slice();
    var rawAttrStatus = raw.attributeStatus && typeof raw.attributeStatus === "object" ? raw.attributeStatus : {};
    function loadNumberMap(raw) {
      var out = {};
      if (raw && typeof raw === "object") {
        Object.keys(raw).forEach(function (key) {
          var v = Number(raw[key]);
          if (v) out[key] = v;
        });
      }
      return out;
    }
    function loadBoolMap(raw) {
      var out = {};
      if (raw && typeof raw === "object") {
        Object.keys(raw).forEach(function (key) {
          if (raw[key]) out[key] = true;
        });
      }
      return out;
    }
    var dealt = loadNumberMap(rawAttrStatus.dealt);
    var enemyAccum = loadNumberMap(rawAttrStatus.enemyAccum);
    var enemyTriggerCount = loadNumberMap(rawAttrStatus.enemyTriggerCount);
    var enemyRoundLocked = loadBoolMap(rawAttrStatus.enemyRoundLocked);
    var charTriggerCount = loadNumberMap(rawAttrStatus.charTriggerCount);
    var charRoundLocked = loadBoolMap(rawAttrStatus.charRoundLocked);
    var received = {};
    if (rawAttrStatus.received && typeof rawAttrStatus.received === "object") {
      Object.keys(rawAttrStatus.received).forEach(function (charId) {
        var raw2 = rawAttrStatus.received[charId];
        if (Array.isArray(raw2)) {
          // 旧形式（追加ごとに独立したタグの配列）からの移行：同じlabelの値を合算する。
          var migrated = {};
          raw2.forEach(function (entry) {
            if (!entry || typeof entry.label !== "string") return;
            migrated[entry.label] = (migrated[entry.label] || 0) + (Number(entry.value) || 0);
          });
          received[charId] = migrated;
        } else if (raw2 && typeof raw2 === "object") {
          received[charId] = loadNumberMap(raw2);
        }
      });
    }
    var enemyDmgOverride = loadNumberMap(raw.enemyDmgOverride);
    function loadCharAccumMap(rawMap) {
      var out = {};
      if (rawMap && typeof rawMap === "object") {
        Object.keys(rawMap).forEach(function (charId) {
          var arr = rawMap[charId];
          if (!Array.isArray(arr)) return;
          var entries = arr
            .filter(function (e) {
              return e && typeof e.label === "string" && typeof e.amount === "number";
            })
            .map(function (e) {
              return { label: e.label, amount: e.amount };
            });
          if (entries.length) out[charId] = entries;
        });
      }
      return out;
    }
    return {
      front: front,
      back: back,
      aggro: aggro,
      positionLocked: positionLocked,
      enemyHp: enemyHp,
      enemyHpMax: enemyHpMax,
      mobHpRows: mobHpRows,
      selectedEnemyIds: selectedEnemyIds,
      attributeStatus: {
        dealt: dealt,
        enemyAccum: enemyAccum,
        enemyTriggerCount: enemyTriggerCount,
        enemyRoundLocked: enemyRoundLocked,
        received: received,
        charTriggerCount: charTriggerCount,
        charRoundLocked: charRoundLocked,
      },
      enemyDmgOverride: enemyDmgOverride,
      fatalStrikeUsedThisRound: !!raw.fatalStrikeUsedThisRound,
      autoGmMobPresentSnapshot: loadBoolMap(raw.autoGmMobPresentSnapshot),
      bossForm: raw.bossForm === "split" ? "split" : "fused",
      guardBroken: !!raw.guardBroken,
      guardCount: loadNumberMap(raw.guardCount),
      bossFormTransitionPending: !!raw.bossFormTransitionPending,
      staggerRowsHandled: Array.isArray(raw.staggerRowsHandled)
        ? raw.staggerRowsHandled.filter(function (v) {
            return typeof v === "number";
          })
        : [],
      combatMode: raw.combatMode === "normal" || raw.combatMode === "simplified" ? raw.combatMode : null,
      combatIsBoss: !!raw.combatIsBoss,
      simplifiedCombatEndPending: !!raw.simplifiedCombatEndPending,
      roundStage: ["awaitingRoll", "acting", "resolving"].indexOf(raw.roundStage) !== -1 ? raw.roundStage : "awaitingRoll",
      roundActionsDone: loadBoolMap(raw.roundActionsDone),
      roundActionLog: Array.isArray(raw.roundActionLog)
        ? raw.roundActionLog
            .filter(function (entry) {
              return entry && typeof entry.charId === "string" && Array.isArray(entry.lines);
            })
            .map(function (entry) {
              return {
                charId: entry.charId,
                lines: entry.lines.filter(function (l) {
                  return typeof l === "string";
                }),
              };
            })
        : [],
      roundResultText: typeof raw.roundResultText === "string" ? raw.roundResultText : null,
      pendingDefenseRoll:
        raw.pendingDefenseRoll && typeof raw.pendingDefenseRoll === "object"
          ? {
              enemyKey: typeof raw.pendingDefenseRoll.enemyKey === "string" ? raw.pendingDefenseRoll.enemyKey : null,
              group: loadNumberMap(raw.pendingDefenseRoll.group),
              individual: loadNumberMap(raw.pendingDefenseRoll.individual),
            }
          : null,
      defenseRollPreviewText: typeof raw.defenseRollPreviewText === "string" ? raw.defenseRollPreviewText : null,
      pendingDefenseElementAccum: loadCharAccumMap(raw.pendingDefenseElementAccum),
      enemyDamageConfirmed: loadBoolMap(raw.enemyDamageConfirmed),
      defenseHpLossSummary: loadNumberMap(raw.defenseHpLossSummary),
      defenseEntryEffectText: typeof raw.defenseEntryEffectText === "string" ? raw.defenseEntryEffectText : null,
    };
  }

  // 屬性/異常面板の「受け取った」欄で選べる、屬性／異常の名称一覧。武器の共通戦技
  // （COMMON_SKILL_ELEMENT_OPTIONS／COMMON_SKILL_STATUS_OPTIONS）と同じ規則書154-155頁の一覧。
  var ATTRIBUTE_STATUS_ELEMENT_OPTIONS = [
    { ja: "炎", zh: "火" },
    { ja: "雷", zh: "雷" },
    { ja: "聖", zh: "聖" },
    { ja: "魔", zh: "魔" },
  ];
  var ATTRIBUTE_STATUS_AILMENT_OPTIONS = [
    { ja: "猛毒", zh: "猛毒" },
    { ja: "腐敗", zh: "腐敗" },
    { ja: "出血", zh: "出血" },
    { ja: "凍傷", zh: "凍傷" },
    { ja: "発狂", zh: "發狂" },
    { ja: "睡眠", zh: "睡眠" },
    { ja: "呪死", zh: "呪死" },
  ];

  // "boss|<bossId>"キー（night_boss_rulebook.jsのBOSSES[].idと一致）かどうかを判定する。
  // auto_gm.js側のisBossKeyと同じ接頭辞規約。
  function isBossAttackKey(key) {
    return String(key || "").indexOf("boss|") === 0;
  }

  // state.battle.selectedEnemyIds（"familyId|enemyId|level"）を、目標選択UIやパネル表示に使う
  // {key, name}の配列へ解決する。加えて、第三夜以降で夜の王が設定済みなら、常に選択肢の末尾へ
  // 追加する（夜の王は「編隊に追加」フロー＝selectedEnemyIdsを経由しないため、
  // renderAutoGmRollRowと同じ「別枠で常に追加」パターンをここでも踏襲する。ユーザー確認済み：
  // 攻撃対象・耐性判定を夜の王にも効かせる）。
  function resolveSelectedEnemyOptions() {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return [];
    var T = Enemies.localizedText;
    var options = ((state.battle && state.battle.selectedEnemyIds) || [])
      .map(function (key) {
        var parts = key.split("|");
        var info = Enemies.get(parts[0], parts[1]);
        return info ? { key: key, name: T(info.enemy.name) + "（Lv." + parts[2] + "）" } : null;
      })
      .filter(Boolean);
    if (game && game.night3BossId && state.dayNumber >= 3 && window.PriTestBossRulebook) {
      var bossInfo = window.PriTestBossRulebook.get(game.night3BossId);
      if (bossInfo) options.push({ key: "boss|" + game.night3BossId, name: T(bossInfo.name) });
    }
    return options;
  }

  // ============================================================
  // 屬性/異常トリガー機構（規則書:屬性4種[魔/炎/雷/聖]・異常7種[猛毒/腐敗/出血/凍傷/發狂/睡眠/呪死]）
  // 基本閾値8点（敵人が対応する弱點を持つ場合は6点）に蓄積が達すると自動發動する。
  // 屬性：發動しても蓄積は0に戻らず持ち越し、同一回合内で複数回發動しうる。
  // 異常：發動すると超過分を含め蓄積を0に戻し、回合につき1回のみ發動する。
  // 「回合」はこのアプリでは戰鬥→額外→防禦の1サイクル＝combatフェイズへ入るたびに新しい回合が
  // 始まるものとして扱い、異常側のロック（今回合すでに發動したか）はそのタイミングで一括解除する。
  // ============================================================
  var ATTRIBUTE_STATUS_BASE_THRESHOLD = 8;
  var ATTRIBUTE_STATUS_WEAKNESS_THRESHOLD = 6;
  var ATTRIBUTE_STATUS_SLEEP_LABEL = "睡眠";
  var ATTRIBUTE_STATUS_DEATH_CURSE_LABEL = "呪死";

  function isAttributeStatusElementLabel(label) {
    return ATTRIBUTE_STATUS_ELEMENT_OPTIONS.some(function (opt) {
      return opt.ja === label || opt.zh === label;
    });
  }
  function isAttributeStatusAilmentLabel(label) {
    return ATTRIBUTE_STATUS_AILMENT_OPTIONS.some(function (opt) {
      return opt.ja === label || opt.zh === label;
    });
  }

  // 敵人の「special」欄からextractWeaknessで取り出した弱點文字列（例:"炎＆猛毒"）を
  // 屬性/異常名の配列へ分割する。夜の王（"boss|"キー）は弱點が独立フィールド（例:"聖"、
  // "竜※④、猛毒"）のためextractWeaknessを介さず直接読む。
  function enemyWeaknessLabels(enemyKey) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies || !enemyKey) return [];
    var weakness;
    if (isBossAttackKey(enemyKey)) {
      var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
      if (!bossInfo) return [];
      weakness = Enemies.localizedText(bossInfo.weakness);
    } else {
      var parts = enemyKey.split("|");
      var info = Enemies.get(parts[0], parts[1]);
      if (!info) return [];
      weakness = extractWeakness(info.enemy.special, Enemies.localizedText);
    }
    if (!weakness) return [];
    return weakness.split(/[＆、,]/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
  }

  // 敵人カード本体の「resistance」欄（例:"猛毒・腐敗・出血・凍傷・発狂"）を屬性/異常名の配列へ
  // 分割する。弱點欄（special内の埋め込みテキスト）とは別の独立フィールドで、区切り文字も
  // 「・」中心（弱點側は「＆」中心）のため別関数にする。夜の王（"boss|"キー）はresistanceが
  // トップレベルの独立フィールド（区切りは「、」）のため同様に対応する。
  function enemyResistanceLabels(enemyKey) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies || !enemyKey) return [];
    var text;
    if (isBossAttackKey(enemyKey)) {
      var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
      if (!bossInfo || !bossInfo.resistance) return [];
      text = Enemies.localizedText(bossInfo.resistance);
    } else {
      var parts = enemyKey.split("|");
      var info = Enemies.get(parts[0], parts[1]);
      if (!info || !info.enemy.resistance) return [];
      text = Enemies.localizedText(info.enemy.resistance);
    }
    return text.split(/[・＆、,]/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
  }

  function attributeStatusThresholdForEnemy(enemyKey, label) {
    var weaknesses = enemyWeaknessLabels(enemyKey);
    var isWeak = weaknesses.indexOf(label) !== -1;
    return isWeak ? ATTRIBUTE_STATUS_WEAKNESS_THRESHOLD : ATTRIBUTE_STATUS_BASE_THRESHOLD;
  }

  // ============================================================
  // ガード回数／ガード削り損害／HP価値（docs/enemy_damage_rules.md 5節）
  // 通常エネミー：family.guardCount（最大値）／family.guardValueTable（既存データ、
  //   従来はnight_rulebook.jsの表示専用だったものをここでも計算に使う）。
  // 夜の王：night_boss_rulebook.jsの該当ボスへ追加したguardCount/guardValueTable
  //   （現時点ではgladius/marisのみ、他のボスは自由文字列のguard欄のまま未対応）。
  // ============================================================

  // PC人數補正（battle_pc_count_4）：PC4人・かつ第2天／第3天の場合、敵人の防禦次數（最大値）
  // 「+1」。既存の参考文をここで実装する。
  function pcCountGuardBonus() {
    return enteredPcCount() === 4 && (state.dayNumber === 2 || state.dayNumber === 3) ? 1 : 0;
  }

  function enemyGuardMaxCount(enemyKey) {
    var base;
    if (isBossAttackKey(enemyKey)) {
      var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
      base = bossInfo && typeof bossInfo.guardCount === "number" ? bossInfo.guardCount : null;
    } else {
      var parts = enemyKey.split("|");
      var fam = window.PriTestEnemies && window.PriTestEnemies.getFamily ? window.PriTestEnemies.getFamily(parts[0]) : null;
      base = fam && typeof fam.guardCount === "number" ? fam.guardCount : null;
    }
    return typeof base === "number" ? base + pcCountGuardBonus() : base;
  }

  // guardValueTableの1行が持つcount欄は、夜の王（night_boss_rulebook.js）は素の数値
  // （例：{count:2,...}）だが、通常エネミー（enemies_data_*.js）はC(ja,zh)の多言語文字列
  // オブジェクト（例：{count:C("2","2"),...}、理論値行は"4以上"・體勢崩し行は"0／體勢崩潰"）
  // で書かれている。後者を素の数値と直接===比較すると常に不一致になるバグがあったため
  // （2026-08-10 自動化GM戰鬥自動化で発見・修正——通常エネミーのGuard削り値計算機能は
  // これまで一度も正しく動いていなかった）、両方の形をここで数値へ正規化してから比較する。
  function parseGuardCountValue(count) {
    if (typeof count === "number") return count;
    var text = (count && (count.zh || count.ja)) || "";
    var m = /^(\d+)/.exec(text);
    return m ? parseInt(m[1], 10) : null;
  }

  // guardCountValueに対応する「HP価値」を引く。通常エネミーはguardValueTableの行が
  // レベル別15要素配列を持つ場合があるため、enemyKeyのlevelでも解決する
  // （night_rulebook.jsのbuildEnemyGuardValueTableと同じ判定）。
  function enemyGuardValueForCount(enemyKey, guardCountValue) {
    var table, level;
    if (isBossAttackKey(enemyKey)) {
      var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
      table = bossInfo && bossInfo.guardValueTable;
      level = null;
    } else {
      var parts = enemyKey.split("|");
      var fam = window.PriTestEnemies && window.PriTestEnemies.getFamily ? window.PriTestEnemies.getFamily(parts[0]) : null;
      table = fam && fam.guardValueTable;
      level = parseInt(parts[2], 10) || 1;
    }
    if (!table) return null;
    var row = table.filter(function (r) {
      return parseGuardCountValue(r.count) === guardCountValue;
    })[0];
    if (!row) return null;
    if (Array.isArray(row.value)) return row.value[Math.max(0, Math.min(row.value.length - 1, level - 1))];
    return row.value;
  }

  // 現在のガード回数。state.battle.guardCountに未記録（＝新しい回合が始まって以降まだ
  // ガード削り損害を受けていない）の場合は最大値にフォールバックする。
  function enemyCurrentGuardCount(enemyKey) {
    var stored = state.battle.guardCount && state.battle.guardCount[enemyKey];
    if (typeof stored === "number") return stored;
    var max = enemyGuardMaxCount(enemyKey);
    return typeof max === "number" ? max : null;
  }

  // 優先度4（ガード削り損害の適用）→優先度5（総合ダメージの適用）を1回でまとめて行う。
  // guardReductionPoints：◆=1点/▲=0.5点で事前に合計した値（呼び出し側のUIでGMが入力）。
  // 整数部分だけをガード回数の減少に使う（端数は切り捨て、docs 5.2節）。
  // ガード回数のデータが無いエネミー（未対応の夜の王等）はnullを返し、呼び出し側は
  // 従来通りGM手動でのHP調整を促す。
  function applyGuardedDamageToEnemy(enemyKey, totalDamage, guardReductionPoints) {
    var maxGuard = enemyGuardMaxCount(enemyKey);
    if (typeof maxGuard !== "number") return null;
    var currentGuard = enemyCurrentGuardCount(enemyKey);
    var reduceBy = Math.max(0, Math.floor(guardReductionPoints || 0));
    var newGuard = Math.max(0, currentGuard - reduceBy);
    if (!state.battle.guardCount) state.battle.guardCount = {};
    state.battle.guardCount[enemyKey] = newGuard;
    var hpValue = enemyGuardValueForCount(enemyKey, newGuard);
    if (!hpValue) return null;

    // グラディウス「分裂形態」移行条件2：PC側の総合ダメージは3分の1（端数切り捨て）にした
    // 「X」点単位で扱い、Xをガード削り後のHP価値でさらに割った値を、オーバーフローさせず
    // 3つの個体HP行それぞれへ**同時に**適用する（docs/enemy_damage_rules.md 9節）。
    var bossInfo = isBossAttackKey(enemyKey) ? (window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null) : null;
    var splitActive =
      !!bossInfo && bossInfo.noStaggerInSplitForm && typeof bossInfo.hpRowCount === "number" && state.battle.bossForm === "split";

    var hpBoxes, rowIdx;
    if (splitActive) {
      var splitDamage = Math.floor((totalDamage || 0) / 3);
      hpBoxes = Math.floor(splitDamage / hpValue);
      rowIdx = enemyHpRowIndexForKey(enemyKey);
      if (rowIdx !== -1 && hpBoxes > 0) {
        for (var i = 0; i < bossInfo.hpRowCount && rowIdx + i < ENEMY_HP_ROWS; i++) {
          adjustEnemyHpRow(rowIdx + i, -hpBoxes);
        }
      }
    } else {
      hpBoxes = Math.floor((totalDamage || 0) / hpValue);
      rowIdx = enemyHpRowIndexForKey(enemyKey);
      if (rowIdx !== -1 && hpBoxes > 0) applyOverflowingEnemyDamage(rowIdx, hpBoxes);
    }

    addLogAndAutoGmLog("log_guarded_damage_applied", {
      enemy: enemyDisplayNameForKey(enemyKey),
      damage: totalDamage || 0,
      guardBefore: currentGuard,
      guardAfter: newGuard,
      hpValue: hpValue,
      boxes: hpBoxes,
    });
    saveState();
    return { currentGuard: currentGuard, newGuard: newGuard, hpValue: hpValue, hpBoxes: hpBoxes, rowIdx: rowIdx, split: splitActive };
  }

  // 優先度1「上のHP行から、余剰は次のHP行へ」を実装する。adjustEnemyHpRowは1行のみを
  // 扱うため、boxesが対象行の残りHPを超える分を、次のHP行へ繰り越しながら順に適用する。
  function applyOverflowingEnemyDamage(rowIdx, boxes) {
    var remaining = boxes;
    var idx = rowIdx;
    while (remaining > 0 && idx < ENEMY_HP_ROWS) {
      var current = countRowChecked(state.battle.enemyHp, idx * ENEMY_HP_COLS, ENEMY_HP_COLS);
      var applied = Math.min(remaining, current);
      if (applied > 0) adjustEnemyHpRow(idx, -applied);
      remaining -= applied;
      idx++;
    }
  }

  // enemyKeyに紐付くHP行番号を返す（選択順=行、ENEMY_HP_ROWS段を超える分は紐付け不可）。
  // 夜の王（"boss|"キー）は選択順の概念（selectedEnemyIds）を経由しないため、
  // ENEMY_HP_ROWSの末尾からそのボスのhpRowCount行分を占有する「後ろ詰め」規約で割り当てる
  // （通常エネミー1体（最大2行）と同時に選択されても衝突しない）。hpRowCount未定義（＝まだ
  // 構造化していない夜の王）は-1を返し、従来通りno-opにフォールバックする。
  function enemyHpRowIndexForKey(enemyKey) {
    if (isBossAttackKey(enemyKey)) {
      var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
      var rowCount = bossInfo && typeof bossInfo.hpRowCount === "number" ? bossInfo.hpRowCount : 0;
      if (rowCount <= 0) return -1;
      return Math.max(0, ENEMY_HP_ROWS - rowCount);
    }
    var ids = (state.battle && state.battle.selectedEnemyIds) || [];
    var idx = ids.indexOf(enemyKey);
    if (idx === -1 || idx >= ENEMY_HP_ROWS) return -1;
    return idx;
  }

  // 夜の王のHP行（enemyHpRowIndexForKeyが割り当てた開始行から、hpRowCount行分）が
  // まだ初期化されていなければ（enemyHpMaxが未設定）、hpBoxes（□×N欄を手入力で数値化した
  // もの）から最大値を設定し、満タン初期化する。既に一度でも初期化済み（enemyHpMaxが
  // 設定済み）の場合は何もしない（GMが調整済みのHPを壊さないため、通常エネミー追加時の
  // 「isFreshEncounterの最初の1体のみ」パターンと同じ考え方）。
  function ensureBossHpRowsInitialized(enemyKey) {
    if (!isBossAttackKey(enemyKey)) return;
    var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
    var rowCount = bossInfo && typeof bossInfo.hpRowCount === "number" ? bossInfo.hpRowCount : 0;
    var hpBoxes = bossInfo && bossInfo.hpBoxes;
    if (rowCount <= 0 || !Array.isArray(hpBoxes)) return;
    var startRow = Math.max(0, ENEMY_HP_ROWS - rowCount);
    if (state.battle.enemyHpMax[startRow] != null) return;
    for (var i = 0; i < rowCount && startRow + i < ENEMY_HP_ROWS; i++) {
      state.battle.enemyHpMax[startRow + i] = hpBoxes[i] || null;
      setEnemyHpRowCount(startRow + i, hpBoxes[i] || 0);
    }
    saveState();
    renderEnemyHpGrid();
    handleEnemyHpChanged();
  }

  // 第三天：夜の王を実際に「戦場（state.battle.selectedEnemyIds）」へ編入する。従来は
  // [開啟夜王戰鬥]が既存のエネミー検索/追加UIへ委ねていたが、夜の王はEnemies.search()の
  // 対象（enemies_data_*.js）ではなくnight_boss_rulebook.js側のBOSSESにしか存在しないため、
  // 検索しても見つからず戦場面板へ追加できなかった（ユーザー報告：「戰鬥面板也無法新增他」）。
  // resolveSelectedEnemyOptionsが対象選択欄で常に末尾へ追加する扱いと同じ理由で、ここでも
  // 「戦場に実在するものとして」selectedEnemyIdsへ直接編入する（冪等——既に編入済みなら
  // 何もしない）。第三天到達時（renderNight3BossImageの毎描画）に呼ぶことで、GMが
  // 何も操作しなくても戦場面板・HP行・戰鬥機制（アクション/防禦フェイズの自動進行）の
  // 対象に含まれるようにする。
  function ensureNight3BossInBattle() {
    if (!game || !game.night3BossId || state.dayNumber < 3) return;
    var key = "boss|" + game.night3BossId;
    if (state.battle.selectedEnemyIds.indexOf(key) === -1) {
      state.battle.selectedEnemyIds.push(key);
      saveState();
    }
    ensureBossHpRowsInitialized(key);
  }

  function enemyDisplayNameForKey(enemyKey) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return enemyKey;
    if (isBossAttackKey(enemyKey)) {
      var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(enemyKey.slice(5)) : null;
      return bossInfo ? Enemies.localizedText(bossInfo.name) : enemyKey;
    }
    var parts = enemyKey.split("|");
    var info = Enemies.get(parts[0], parts[1]);
    return info ? Enemies.localizedText(info.enemy.name) + "（Lv." + parts[2] + "）" : enemyKey;
  }

  function enemyIsAttackerFamily(enemyKey) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies || !enemyKey) return false;
    var parts = enemyKey.split("|");
    var info = Enemies.get(parts[0], parts[1]);
    if (!info || !info.familyName) return false;
    var ja = info.familyName.ja || "";
    var zh = info.familyName.zh || "";
    return ja.indexOf("襲撃者") !== -1 || zh.indexOf("襲擊者") !== -1;
  }

  // 敵人のHP行の残りHPをcount個減らす。紐付け行が無ければ何もしない（GMへログのみ残る）。
  // チェック数＝残りHPのため、ダメージはマイナス方向（adjustEnemyHpRowへは負のdeltaで渡す）。
  function damageEnemyHpForKey(enemyKey, count) {
    var rowIdx = enemyHpRowIndexForKey(enemyKey);
    if (rowIdx === -1) return false;
    adjustEnemyHpRow(rowIdx, -count);
    return true;
  }

  // 敵人のHP行を丸ごと扣光する（體崩／擊破で使う）。
  function depleteEnemyHpRowForKey(enemyKey) {
    return damageEnemyHpForKey(enemyKey, ENEMY_HP_COLS);
  }

  // 遺物効果「屬性達成的歡喜」「異常狀態達成的歡喜」：習得時に選んだ屬性/異常（choiceField）が
  // 今回のトリガーlabelと一致する入場中キャラ全員に、その遺物効果本文の□個数分HP/FP回復を適用する
  // （「不論由哪位PC累積」＝誰が蓄積したトリガーでも、選んだ本人全員に発揮）。
  function applyRelicJoyHealForLabel(label, choiceField, relicNames) {
    rosterCharacters.forEach(function (c) {
      if (!c.entered) return;
      var choice = c[choiceField];
      if (!choice || !(choice.zh === label || choice.ja === label)) return;
      var effect = CharacterDrawer.findLearnedRelicEffectByName(c, relicNames);
      if (!effect) return;
      var text = (effect.body && effect.body.ja) || (effect.body && effect.body.zh);
      var hpAmount = CharacterDrawer.countHealSquares(text, "HP");
      var fpAmount = CharacterDrawer.countHealSquares(text, "FP");
      if (hpAmount) c.hp.current = Math.min(c.hp.max, c.hp.current + hpAmount);
      if (fpAmount) c.fp.current = Math.min(c.fp.max, c.fp.current + fpAmount);
      if (hpAmount || fpAmount) {
        addLog("log_relic_joy_heal", { character: c.name, label: label, hp: hpAmount, fp: fpAmount });
      }
    });
    saveRosterCharacters();
    renderCharacterRoster();
  }

  function applyAttributeStatusElementTriggerOnEnemy(enemyKey, label) {
    damageEnemyHpForKey(enemyKey, 1);
    addLogAndAutoGmLog("log_attribute_status_element_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey), label: label });
    applyRelicJoyHealForLabel(label, "relicJoyElementChoice", ["屬性達成的歡喜", "属性達成の歓喜"]);
    renderEnemyHpGrid();
  }

  function applyAttributeStatusAilmentTriggerOnEnemy(enemyKey, label) {
    if (label === ATTRIBUTE_STATUS_SLEEP_LABEL) {
      depleteEnemyHpRowForKey(enemyKey);
      if (!state.battle.enemyDmgOverride) state.battle.enemyDmgOverride = {};
      state.battle.enemyDmgOverride[enemyKey] = (state.battle.enemyDmgOverride[enemyKey] || 0) - 300;
      addLogAndAutoGmLog("log_attribute_status_sleep_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey) });
    } else if (label === ATTRIBUTE_STATUS_DEATH_CURSE_LABEL) {
      if (enemyIsAttackerFamily(enemyKey)) {
        depleteEnemyHpRowForKey(enemyKey);
        addLogAndAutoGmLog("log_attribute_status_death_curse_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey) });
      }
      // 「襲擊者」以外の敵人は無效果（何もしない）。
    } else {
      damageEnemyHpForKey(enemyKey, 2);
      addLogAndAutoGmLog("log_attribute_status_ailment_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey), label: label });
    }
    applyRelicJoyHealForLabel(label, "relicJoyAilmentChoice", ["異常狀態達成的歡喜", "状態異常達成の歓喜"]);
    renderEnemyHpGrid();
    renderSelectedEnemies();
  }

  // dealt(記録用の内訳)とは別に、敵人ごとの実蓄積(enemyAccum)を更新し、閾値到達を判定する。
  function processAttributeStatusEnemyTrigger(enemyKey, label) {
    var as = state.battle.attributeStatus;
    var accumKey = enemyKey + "|" + label;
    var threshold = attributeStatusThresholdForEnemy(enemyKey, label);
    if (isAttributeStatusElementLabel(label)) {
      var value = as.enemyAccum[accumKey] || 0;
      var prevCount = as.enemyTriggerCount[accumKey] || 0;
      var newCount = Math.floor(value / threshold);
      if (newCount > prevCount) {
        for (var i = prevCount; i < newCount; i++) {
          applyAttributeStatusElementTriggerOnEnemy(enemyKey, label);
        }
        as.enemyTriggerCount[accumKey] = newCount;
      }
    } else if (isAttributeStatusAilmentLabel(label)) {
      var value2 = as.enemyAccum[accumKey] || 0;
      if (value2 >= threshold && !as.enemyRoundLocked[accumKey]) {
        as.enemyRoundLocked[accumKey] = true;
        as.enemyAccum[accumKey] = 0;
        applyAttributeStatusAilmentTriggerOnEnemy(enemyKey, label);
      }
    }
  }

  // 執行者「不撓」：自身が屬性/異常のどちらのトリガーを受けても（蓄積値が閾値に達し歸零する
  // たびに）戦闘終了まで持続するスタックを+1する。トリガーの実処理関数（下記2つ）の冒頭で
  // 呼ぶことで、新規の検知ロジックを追加せずに済む。
  function applyUnyieldingStack(c) {
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var hasAbility =
      type &&
      (type.abilities || []).some(function (entry) {
        return entry.id === "unyielding";
      });
    if (!hasAbility) return;
    c._unyieldingStacks = (c._unyieldingStacks || 0) + 1;
  }

  // 葬儀屋「力量感應」：他PCが[Action]で技藝（type.artsに含まれるentry）を使用するたびに発火し、
  // power_resonance能力を持つ他の入場済みキャラへ「不祥一擊」の無消耗使用権を1つ積む。
  // 力量感應由来の無消耗「不祥一擊」自体はこの連鎖対象外（呼び出し元でスキップする）。
  function triggerPowerResonance(actingCharacter, usedEntry) {
    var actingType = actingCharacter.typeId ? CharacterTypes.get(actingCharacter.typeId) : null;
    var isArt =
      actingType &&
      (actingType.arts || []).some(function (a) {
        return a.id === usedEntry.id;
      });
    if (!isArt) return;
    rosterCharacters.forEach(function (rc) {
      if (!rc.entered || rc.id === actingCharacter.id) return;
      var rcType = rc.typeId ? CharacterTypes.get(rc.typeId) : null;
      var hasAbility =
        rcType &&
        (rcType.abilities || []).some(function (entry) {
          return entry.id === "power_resonance";
        });
      if (!hasAbility) return;
      rc._powerResonanceCredits = (rc._powerResonanceCredits || 0) + 1;
    });
  }

  // 葬儀屋「不祥一擊」：對象への總合ダメージ算出後、自身を前衛へ無条件で移動する
  // （追跡者「爪擊」と同じsetTimeout遅延パターン、反転ではなく固定でfront=trueにする点が異なる）。
  function moveOminousStrikeToFront(c) {
    setTimeout(function () {
      var idx = battlePositionNames().indexOf(c.name);
      if (idx !== -1 && idx < BATTLE_SLOT_COUNT) {
        state.battle.front[idx] = true;
        state.battle.back[idx] = false;
        saveState();
        renderBattlePositionAreas();
        renderCombatModal();
      }
    }, 0);
  }

  function applyAttributeStatusElementTriggerOnChar(characterId, label) {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (!c) return;
    applyUnyieldingStack(c);
    c.hp.current = Math.max(0, (c.hp.current || 0) - 1);
    saveRosterCharacters();
    renderCharacterRoster();
    addLogAndAutoGmLog("log_attribute_status_element_trigger_char", { name: c.name, label: label });
    checkNearDeathTrigger(c);
  }

  function applyAttributeStatusAilmentTriggerOnChar(characterId, label) {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (!c) return;
    applyUnyieldingStack(c);
    if (label === ATTRIBUTE_STATUS_SLEEP_LABEL) {
      c._nextActionDicePenalty = (c._nextActionDicePenalty || 0) + 3;
      addLogAndAutoGmLog("log_attribute_status_sleep_trigger_char", { name: c.name });
    } else if (label === ATTRIBUTE_STATUS_DEATH_CURSE_LABEL) {
      c.hp.current = 0;
      addLogAndAutoGmLog("log_attribute_status_death_curse_trigger_char", { name: c.name });
    } else {
      c.hp.current = Math.max(0, (c.hp.current || 0) - 2);
      addLogAndAutoGmLog("log_attribute_status_ailment_trigger_char", { name: c.name, label: label });
    }
    saveRosterCharacters();
    renderCharacterRoster();
    checkNearDeathTrigger(c);
  }

  function processAttributeStatusCharTrigger(characterId, label) {
    var as = state.battle.attributeStatus;
    var key = characterId + "|" + label;
    var threshold = ATTRIBUTE_STATUS_BASE_THRESHOLD;
    if (isAttributeStatusElementLabel(label)) {
      var value = (as.received[characterId] && as.received[characterId][label]) || 0;
      var prevCount = as.charTriggerCount[key] || 0;
      var newCount = Math.floor(value / threshold);
      if (newCount > prevCount) {
        for (var i = prevCount; i < newCount; i++) {
          applyAttributeStatusElementTriggerOnChar(characterId, label);
        }
        as.charTriggerCount[key] = newCount;
      }
    } else if (isAttributeStatusAilmentLabel(label)) {
      var value2 = (as.received[characterId] && as.received[characterId][label]) || 0;
      if (value2 >= threshold && !as.charRoundLocked[key]) {
        as.charRoundLocked[key] = true;
        as.received[characterId][label] = 0;
        applyAttributeStatusAilmentTriggerOnChar(characterId, label);
      }
    }
  }

  // 回合境界（combatフェイズへ新規突入するたび）で、異常側の「今回合すでに發動した」ロックを
  // 一括解除する（屬性側の蓄積・發動回数は回合をまたいで持ち越すため、ここでは触らない）。
  function resetAttributeStatusRoundLocks() {
    if (!state.battle.attributeStatus) return;
    state.battle.attributeStatus.enemyRoundLocked = {};
    state.battle.attributeStatus.charRoundLocked = {};
  }

  // 攻撃actionの確定時、選択中の敵人1体へその角色が与えた屬性/異常の蓄積を積み上げ、
  // 敵人側の実蓄積(enemyAccum)を更新した上で閾値トリガーを判定する。
  function recordAttributeStatusDealt(characterId, enemyKey, label, value) {
    if (!enemyKey || !value) return;
    // 耐性判定：敵人のresistance欄に一致する屬性/異常は、蓄積値をそもそも加算しない
    // （ユーザー確認済み：「自動跳出此為耐性並不結算其累積值」）。既存のdealt内訳表示にも
    // 残らないよう、accumulateより前で早期returnする。
    if (enemyResistanceLabels(enemyKey).indexOf(label) !== -1) {
      addLog("log_attribute_status_resistance_blocked", { enemy: enemyDisplayNameForKey(enemyKey), label: label, value: value });
      return;
    }
    if (!state.battle.attributeStatus) state.battle.attributeStatus = defaultBattleState().attributeStatus;
    // 遺物効果「屬性蓄積值＋1」：習得時に選んだ属性（c.relicAccumElementChoice）と一致する場合のみ、
    // このキャラクターが与えた蓄積値へ+1する（異常側は対象外、isAttributeStatusElementLabelで判定）。
    if (isAttributeStatusElementLabel(label)) {
      var c = rosterCharacters.filter(function (rc) {
        return rc.id === characterId;
      })[0];
      var choice = c && c.relicAccumElementChoice;
      if (
        choice &&
        (choice.zh === label || choice.ja === label) &&
        CharacterDrawer.findLearnedRelicEffectByName(c, ["屬性蓄積值＋1", "属性蓄積値＋1"])
      ) {
        value += 1;
      }
    }
    var key = characterId + "|" + enemyKey + "|" + label;
    var as = state.battle.attributeStatus;
    as.dealt[key] = (as.dealt[key] || 0) + value;
    var accumKey = enemyKey + "|" + label;
    as.enemyAccum[accumKey] = (as.enemyAccum[accumKey] || 0) + value;
    // 自動化GM 戰鬥自動化：進度版に出す「本回合行動說明」用に、フェイズ単位で増えた屬性/異常
    // 蓄積値も別途追跡する（c._phaseAttributeGains、phase reset時にクリア。relic補正込みの
    // 実際の増分valueを使う）。
    var actor = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (actor) {
      if (!actor._phaseAttributeGains) actor._phaseAttributeGains = {};
      actor._phaseAttributeGains[label] = (actor._phaseAttributeGains[label] || 0) + value;
      addAutoGmLog(
        window.I18N.t("auto_gm_log_attribute_dealt", {
          name: actor.name,
          enemy: enemyDisplayNameForKey(enemyKey),
          label: label,
          value: value,
          total: as.enemyAccum[accumKey],
        })
      );
    }
    processAttributeStatusEnemyTrigger(enemyKey, label);
  }

  // 隱者「元素操控」：対象の敵人が屬性傷害（火/雷/聖/魔のいずれか）を受けているかどうかを、
  // 実際に蓄積されているenemyAccumから判定する（範囲が不明で手動確認に頼るしかない他の
  // ゲート付き技能とは異なり、ここは既存データで正確に判定できる）。
  function enemyHasElementDamage(enemyKey) {
    if (!enemyKey || !state.battle.attributeStatus) return false;
    var accum = state.battle.attributeStatus.enemyAccum || {};
    return ATTRIBUTE_STATUS_ELEMENT_OPTIONS.some(function (opt) {
      return (accum[enemyKey + "|" + opt.zh] || 0) > 0 || (accum[enemyKey + "|" + opt.ja] || 0) > 0;
    });
  }

  function addReceivedAttributeStatus(characterId, label, value) {
    if (!value) return;
    if (!state.battle.attributeStatus) state.battle.attributeStatus = defaultBattleState().attributeStatus;
    var received = state.battle.attributeStatus.received;
    if (!received[characterId]) received[characterId] = {};
    received[characterId][label] = (received[characterId][label] || 0) + value;
    var receivedChar = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (receivedChar) {
      addAutoGmLog(
        window.I18N.t("auto_gm_log_attribute_received", {
          name: receivedChar.name,
          label: label,
          value: value,
          total: received[characterId][label],
        })
      );
    }
    processAttributeStatusCharTrigger(characterId, label);
    saveState();
    saveRosterCharacters();
    renderAttributeStatusList();
  }

  function removeReceivedAttributeStatus(characterId, label) {
    if (!state.battle.attributeStatus || !state.battle.attributeStatus.received[characterId]) return;
    delete state.battle.attributeStatus.received[characterId][label];
    saveState();
    renderAttributeStatusList();
  }

  function loadTimeLossDay(raw) {
    var fallback = defaultTimeLossDay();
    if (!Array.isArray(raw)) return fallback;
    return TIME_LOSS_ROW_DEFS.map(function (def, i) {
      var row = raw[i];
      if (!Array.isArray(row)) return fallback[i];
      var out = [];
      for (var b = 0; b < def.boxes; b++) out.push(!!row[b]);
      return out;
    });
  }

  function loadWanderingBlessing(raw) {
    var fallback = defaultWanderingBlessing();
    if (!raw || typeof raw !== "object") return fallback;
    return {
      base: Array.isArray(raw.base) ? [!!raw.base[0], !!raw.base[1], !!raw.base[2]] : fallback.base,
      extra: Array.isArray(raw.extra) ? [!!raw.extra[0], !!raw.extra[1], !!raw.extra[2]] : fallback.extra,
    };
  }

  function loadRollEffects(raw) {
    var fallback = defaultRollEffects();
    if (!raw || typeof raw !== "object") return fallback;
    var out = {};
    ROLL_EFFECTS.forEach(function (e) {
      var v = raw[e.id];
      out[e.id] = typeof v === "number" ? Math.max(0, Math.min(e.tiers, v)) : 0;
    });
    return out;
  }

  function loadChecks(raw) {
    if (!raw || typeof raw !== "object") return defaultChecks();
    return { one: !!raw.one, all: !!raw.all };
  }

  // gmFlowのpendingFinalFloorSlot／pendingMapMoveSlot用：数値板塊indexか"start"/"end"
  // （起點/終點）のいずれかのみ許可し、それ以外はnullへフォールバックする。
  function loadSlotOrPileIndex(v) {
    return typeof v === "number" || v === "start" || v === "end" ? v : null;
  }

  function loadDicePool(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(function (v) {
        return typeof v === "number" && v >= 1 && v <= 6;
      })
      .slice(0, CharacterDrawer.MAX_DICE_POOL);
  }

  // dataは既にパース済みのオブジェクト（クラウド購読からの再入も想定）を受け取る。
  function applyLoadedData(data) {
    try {
      // state.updatedAtは「今stateが表している内容の時刻」を常に指すよう、ローカル/遠端どちらの
      // データを適用した場合でも更新する（saveState側の更新と対になる）。
      state.updatedAt = typeof data.updatedAt === "number" ? data.updatedAt : 0;
      if (Array.isArray(data.slots) && data.slots.length === SLOT_COUNT) {
        state.slots = data.slots;
      }
      if (Array.isArray(data.cardLevels) && data.cardLevels.length === SLOT_COUNT) {
        state.cardLevels = data.cardLevels;
      }
      if (Array.isArray(data.eventChips) && data.eventChips.length === SLOT_COUNT) {
        state.eventChips = data.eventChips;
      }
      state.eventChipNumbers =
        Array.isArray(data.eventChipNumbers) && data.eventChipNumbers.length === SLOT_COUNT
          ? data.eventChipNumbers
          : new Array(SLOT_COUNT).fill(null);
      state.eventChipsUsed =
        Array.isArray(data.eventChipsUsed) && data.eventChipsUsed.length === SLOT_COUNT
          ? data.eventChipsUsed
          : new Array(SLOT_COUNT).fill(false);
      state.eventChipsData = data.eventChipsData && typeof data.eventChipsData === "object" ? data.eventChipsData : {};
      state.nightBossRoll = data.nightBossRoll && typeof data.nightBossRoll === "object" ? data.nightBossRoll : {};
      state.boardStarted = !!data.boardStarted;
      state.log = Array.isArray(data.log) ? data.log : [];
      state.focusedIndex =
        typeof data.focusedIndex === "number" || data.focusedIndex === "start" || data.focusedIndex === "end"
          ? data.focusedIndex
          : null;
      state.dayNumber = typeof data.dayNumber === "number" ? data.dayNumber : 1;
      state.startSuit = SUITS.indexOf(data.startSuit) !== -1 ? data.startSuit : null;
      state.endSuit = SUITS.indexOf(data.endSuit) !== -1 ? data.endSuit : null;
      state.startChecks = loadChecks(data.startChecks);
      state.endChecks = loadChecks(data.endChecks);
      state.startDefeated = !!data.startDefeated;
      state.startDefeatedDay = typeof data.startDefeatedDay === "number" ? data.startDefeatedDay : null;
      state.timeLoss = {
        day1: loadTimeLossDay(data.timeLoss && data.timeLoss.day1),
        day2: loadTimeLossDay(data.timeLoss && data.timeLoss.day2),
      };
      state.wanderingBlessing = loadWanderingBlessing(data.wanderingBlessing);
      state.rollEffects = loadRollEffects(data.rollEffects);
      state.smithingStone = typeof data.smithingStone === "string" ? data.smithingStone : "";
      state.smithingStoneCount = Number(data.smithingStoneCount) || 0;
      state.stoneswordKey = typeof data.stoneswordKey === "string" ? data.stoneswordKey : "";
      state.stoneswordKeyCount = Number(data.stoneswordKeyCount) || 0;
      state.grace = typeof data.grace === "string" ? data.grace : "";
      state.battle = loadBattleState(data.battle);
      state.dicePool = loadDicePool(data.dicePool);
      state.actionPhase = ["normal", "combat", "extra", "defense"].indexOf(data.actionPhase) !== -1 ? data.actionPhase : "normal";
      state.floorRewardObtained =
        data.floorRewardObtained && typeof data.floorRewardObtained === "object" ? data.floorRewardObtained : {};
      state.floorRewardDismissed =
        data.floorRewardDismissed && typeof data.floorRewardDismissed === "object" ? data.floorRewardDismissed : {};
      state.turnHolder = ["gm", "gmEnding", "players", "playersEnding"].indexOf(data.turnHolder) !== -1 ? data.turnHolder : "gm";
      state.turnMessages = Array.isArray(data.turnMessages) ? data.turnMessages : [];
      state.turnMessageHistory = Array.isArray(data.turnMessageHistory) ? data.turnMessageHistory : [];
      state.turnRewards = Array.isArray(data.turnRewards) ? data.turnRewards : [];
      state.turnBoardEnabled = typeof data.turnBoardEnabled === "boolean" ? data.turnBoardEnabled : true;
      state.logBubbleEnabled = typeof data.logBubbleEnabled === "boolean" ? data.logBubbleEnabled : false;
      state.locationBannerCollapsed = typeof data.locationBannerCollapsed === "boolean" ? data.locationBannerCollapsed : false;
      state.locationBannerCorner = data.locationBannerCorner === "left" ? "left" : "right";
      state.autoGmEnabled = typeof data.autoGmEnabled === "boolean" ? data.autoGmEnabled : false;
      state.autoGmLog = Array.isArray(data.autoGmLog) ? data.autoGmLog : [];
      state.gmFlowEnabled = typeof data.gmFlowEnabled === "boolean" ? data.gmFlowEnabled : false;
      var loadedGmFlow = data.gmFlow && typeof data.gmFlow === "object" ? data.gmFlow : {};
      var loadedWalk =
        loadedGmFlow.walk && typeof loadedGmFlow.walk === "object"
          ? {
              slotIndex:
                typeof loadedGmFlow.walk.slotIndex === "number" ||
                loadedGmFlow.walk.slotIndex === "start" ||
                loadedGmFlow.walk.slotIndex === "end"
                  ? loadedGmFlow.walk.slotIndex
                  : null,
              branchIndex: typeof loadedGmFlow.walk.branchIndex === "number" ? loadedGmFlow.walk.branchIndex : null,
              floorIndex: typeof loadedGmFlow.walk.floorIndex === "number" ? loadedGmFlow.walk.floorIndex : 0,
              lineIndex: typeof loadedGmFlow.walk.lineIndex === "number" ? loadedGmFlow.walk.lineIndex : 0,
              branchFloor: typeof loadedGmFlow.walk.branchFloor === "number" ? loadedGmFlow.walk.branchFloor : null,
              branchFloorArmed: !!loadedGmFlow.walk.branchFloorArmed,
              pendingPrefixText: typeof loadedGmFlow.walk.pendingPrefixText === "string" ? loadedGmFlow.walk.pendingPrefixText : null,
              // pendingConvergeLabel同様、line.label.ja/zhとの単純な文字列比較にしか使わないため、
              // 固定候補の列挙ではなく型チェックのみで十分（新しい判定パターンを追加するたびに
              // ここへ値を追加する必要をなくす）。
              pendingOutcomeFilter: typeof loadedGmFlow.walk.pendingOutcomeFilter === "string" ? loadedGmFlow.walk.pendingOutcomeFilter : null,
              pendingConvergeLabel: typeof loadedGmFlow.walk.pendingConvergeLabel === "string" ? loadedGmFlow.walk.pendingConvergeLabel : null,
            }
          : null;
      state.gmFlow = {
        narrationText: typeof loadedGmFlow.narrationText === "string" ? loadedGmFlow.narrationText : null,
        awaitingOk: !!loadedGmFlow.awaitingOk,
        actionKind:
          [
            "ok",
            "nightAdvance",
            "finalDayBattle",
            "branchChoice",
            "lineChoice",
            "combatTrigger",
            "abilityCheck",
            "cooperativeCheck",
            "playerPickCheck",
            "branchPointTally",
            "sequentialPairCheck",
            "conditionalCooperativeChoice",
            "sequentialCooperativeChain",
            "openEndedTallyCheck",
            "representativePickCheck",
            "multiStatIndividualCheck",
            "freeFloorChoice",
            "battleWait",
            "chipOffer",
            "floorEnd",
            "mapMove",
            "chipStrongEnemyOffer",
            "chipCombatWait",
            "chipCombatResolved",
          ].indexOf(loadedGmFlow.actionKind) !== -1
            ? loadedGmFlow.actionKind
            : "ok",
        pendingRewardWindows: Array.isArray(loadedGmFlow.pendingRewardWindows) ? loadedGmFlow.pendingRewardWindows : [],
        openingPlayed: !!loadedGmFlow.openingPlayed,
        finalDayAnnounced: !!loadedGmFlow.finalDayAnnounced,
        walk: loadedWalk,
        pendingChoiceLabels: Array.isArray(loadedGmFlow.pendingChoiceLabels) ? loadedGmFlow.pendingChoiceLabels : [],
        combatTriggerLabel: typeof loadedGmFlow.combatTriggerLabel === "string" ? loadedGmFlow.combatTriggerLabel : null,
        abilityCheckSpec:
          loadedGmFlow.abilityCheckSpec && typeof loadedGmFlow.abilityCheckSpec.target === "number" && typeof loadedGmFlow.abilityCheckSpec.statKey === "string"
            ? {
                target: loadedGmFlow.abilityCheckSpec.target,
                statKey: loadedGmFlow.abilityCheckSpec.statKey,
                markerLabel: typeof loadedGmFlow.abilityCheckSpec.markerLabel === "string" ? loadedGmFlow.abilityCheckSpec.markerLabel : null,
              }
            : null,
        cooperativeCheckSpec:
          loadedGmFlow.cooperativeCheckSpec &&
          typeof loadedGmFlow.cooperativeCheckSpec.target === "number" &&
          typeof loadedGmFlow.cooperativeCheckSpec.statKey === "string"
            ? {
                target: loadedGmFlow.cooperativeCheckSpec.target,
                perPC: !!loadedGmFlow.cooperativeCheckSpec.perPC,
                statKey: loadedGmFlow.cooperativeCheckSpec.statKey,
                markerLabel: typeof loadedGmFlow.cooperativeCheckSpec.markerLabel === "string" ? loadedGmFlow.cooperativeCheckSpec.markerLabel : null,
              }
            : null,
        playerPickCheckSpec:
          loadedGmFlow.playerPickCheckSpec &&
          typeof loadedGmFlow.playerPickCheckSpec.target === "number" &&
          typeof loadedGmFlow.playerPickCheckSpec.statKey === "string"
            ? {
                target: loadedGmFlow.playerPickCheckSpec.target,
                statKey: loadedGmFlow.playerPickCheckSpec.statKey,
                retryOnFail: !!loadedGmFlow.playerPickCheckSpec.retryOnFail,
                markerLabel: typeof loadedGmFlow.playerPickCheckSpec.markerLabel === "string" ? loadedGmFlow.playerPickCheckSpec.markerLabel : null,
              }
            : null,
        playerPickCheckExcluded: Array.isArray(loadedGmFlow.playerPickCheckExcluded) ? loadedGmFlow.playerPickCheckExcluded : [],
        branchPointTallySpec:
          loadedGmFlow.branchPointTallySpec &&
          typeof loadedGmFlow.branchPointTallySpec.target === "number" &&
          typeof loadedGmFlow.branchPointTallySpec.statKey === "string" &&
          typeof loadedGmFlow.branchPointTallySpec.highLabel === "string" &&
          typeof loadedGmFlow.branchPointTallySpec.lowLabel === "string"
            ? {
                target: loadedGmFlow.branchPointTallySpec.target,
                statKey: loadedGmFlow.branchPointTallySpec.statKey,
                repeat: typeof loadedGmFlow.branchPointTallySpec.repeat === "number" ? loadedGmFlow.branchPointTallySpec.repeat : 1,
                round: typeof loadedGmFlow.branchPointTallySpec.round === "number" ? loadedGmFlow.branchPointTallySpec.round : 1,
                points: typeof loadedGmFlow.branchPointTallySpec.points === "number" ? loadedGmFlow.branchPointTallySpec.points : 0,
                highLabel: loadedGmFlow.branchPointTallySpec.highLabel,
                lowLabel: loadedGmFlow.branchPointTallySpec.lowLabel,
                lowThreshold: typeof loadedGmFlow.branchPointTallySpec.lowThreshold === "number" ? loadedGmFlow.branchPointTallySpec.lowThreshold : 0,
              }
            : null,
        sequentialPairSpec:
          loadedGmFlow.sequentialPairSpec && Array.isArray(loadedGmFlow.sequentialPairSpec.checks) && loadedGmFlow.sequentialPairSpec.checks.length === 2
            ? {
                checks: loadedGmFlow.sequentialPairSpec.checks.map(function (chk) {
                  return { target: typeof chk.target === "number" ? chk.target : 0, statKey: typeof chk.statKey === "string" ? chk.statKey : "luck" };
                }),
                stepIndex: typeof loadedGmFlow.sequentialPairSpec.stepIndex === "number" ? loadedGmFlow.sequentialPairSpec.stepIndex : 0,
                totalSuccess: typeof loadedGmFlow.sequentialPairSpec.totalSuccess === "number" ? loadedGmFlow.sequentialPairSpec.totalSuccess : 0,
                totalAttempts: typeof loadedGmFlow.sequentialPairSpec.totalAttempts === "number" ? loadedGmFlow.sequentialPairSpec.totalAttempts : 0,
                markerLabel: typeof loadedGmFlow.sequentialPairSpec.markerLabel === "string" ? loadedGmFlow.sequentialPairSpec.markerLabel : null,
              }
            : null,
        conditionalCooperativeChoiceSpec:
          loadedGmFlow.conditionalCooperativeChoiceSpec && Array.isArray(loadedGmFlow.conditionalCooperativeChoiceSpec.options)
            ? {
                options: loadedGmFlow.conditionalCooperativeChoiceSpec.options
                  .filter(function (opt) {
                    return opt && typeof opt.label === "string" && typeof opt.target === "number" && typeof opt.statKey === "string";
                  })
                  .map(function (opt) {
                    return { label: opt.label, target: opt.target, perPC: !!opt.perPC, statKey: opt.statKey };
                  }),
              }
            : null,
        sequentialChainSpec:
          loadedGmFlow.sequentialChainSpec && Array.isArray(loadedGmFlow.sequentialChainSpec.steps) && loadedGmFlow.sequentialChainSpec.steps.length >= 2
            ? {
                mode: loadedGmFlow.sequentialChainSpec.mode === "tallyAll" ? "tallyAll" : "earlyExitChain",
                steps: loadedGmFlow.sequentialChainSpec.steps.map(function (stp) {
                  return { target: typeof stp.target === "number" ? stp.target : 0, statKey: typeof stp.statKey === "string" ? stp.statKey : "luck" };
                }),
                stepIndex: typeof loadedGmFlow.sequentialChainSpec.stepIndex === "number" ? loadedGmFlow.sequentialChainSpec.stepIndex : 0,
                successCount: typeof loadedGmFlow.sequentialChainSpec.successCount === "number" ? loadedGmFlow.sequentialChainSpec.successCount : 0,
                awaitingContinue: !!loadedGmFlow.sequentialChainSpec.awaitingContinue,
                markerLabel: typeof loadedGmFlow.sequentialChainSpec.markerLabel === "string" ? loadedGmFlow.sequentialChainSpec.markerLabel : null,
              }
            : null,
        openEndedTallySpec:
          loadedGmFlow.openEndedTallySpec &&
          typeof loadedGmFlow.openEndedTallySpec.target === "number" &&
          typeof loadedGmFlow.openEndedTallySpec.statKey === "string" &&
          typeof loadedGmFlow.openEndedTallySpec.successLineJaLabel === "string"
            ? {
                target: loadedGmFlow.openEndedTallySpec.target,
                statKey: loadedGmFlow.openEndedTallySpec.statKey,
                successThreshold:
                  typeof loadedGmFlow.openEndedTallySpec.successThreshold === "number" ? loadedGmFlow.openEndedTallySpec.successThreshold : 1,
                failEscalationStep:
                  typeof loadedGmFlow.openEndedTallySpec.failEscalationStep === "number" ? loadedGmFlow.openEndedTallySpec.failEscalationStep : null,
                successCount: typeof loadedGmFlow.openEndedTallySpec.successCount === "number" ? loadedGmFlow.openEndedTallySpec.successCount : 0,
                failCount: typeof loadedGmFlow.openEndedTallySpec.failCount === "number" ? loadedGmFlow.openEndedTallySpec.failCount : 0,
                successLineJaLabel: loadedGmFlow.openEndedTallySpec.successLineJaLabel,
              }
            : null,
        representativePickSpec:
          loadedGmFlow.representativePickSpec &&
          typeof loadedGmFlow.representativePickSpec.repTarget === "number" &&
          typeof loadedGmFlow.representativePickSpec.repStat === "string" &&
          typeof loadedGmFlow.representativePickSpec.othersTarget === "number" &&
          typeof loadedGmFlow.representativePickSpec.othersStat === "string"
            ? {
                repTarget: loadedGmFlow.representativePickSpec.repTarget,
                repStat: loadedGmFlow.representativePickSpec.repStat,
                othersTarget: loadedGmFlow.representativePickSpec.othersTarget,
                othersStat: loadedGmFlow.representativePickSpec.othersStat,
              }
            : null,
        // ラウンド途中の擲骰履歴（results）はモーダルの一時state（abilityCheckRolls）と同様
        // リロードで復元しない——checks／markerLabelだけ復元し、最初のラウンドからやり直す。
        multiStatCheckSpec:
          loadedGmFlow.multiStatCheckSpec && Array.isArray(loadedGmFlow.multiStatCheckSpec.checks) && loadedGmFlow.multiStatCheckSpec.checks.length >= 2
            ? {
                checks: loadedGmFlow.multiStatCheckSpec.checks.map(function (chk) {
                  return { target: typeof chk.target === "number" ? chk.target : 0, statKey: typeof chk.statKey === "string" ? chk.statKey : "luck" };
                }),
                stepIndex: 0,
                results: {},
                markerLabel: typeof loadedGmFlow.multiStatCheckSpec.markerLabel === "string" ? loadedGmFlow.multiStatCheckSpec.markerLabel : null,
              }
            : null,
        freeFloorOptions: Array.isArray(loadedGmFlow.freeFloorOptions) ? loadedGmFlow.freeFloorOptions : [],
        battleWaitActive: !!loadedGmFlow.battleWaitActive,
        pendingBattleResetOnGateClose: !!loadedGmFlow.pendingBattleResetOnGateClose,
        pendingFinalFloorSlot: loadSlotOrPileIndex(loadedGmFlow.pendingFinalFloorSlot),
        chipOfferSlot: typeof loadedGmFlow.chipOfferSlot === "number" ? loadedGmFlow.chipOfferSlot : null,
        chipOfferContinuation: typeof loadedGmFlow.chipOfferContinuation === "string" ? loadedGmFlow.chipOfferContinuation : null,
        pendingChipCheckSlot: typeof loadedGmFlow.pendingChipCheckSlot === "number" ? loadedGmFlow.pendingChipCheckSlot : null,
        pendingMapMoveSlot: loadSlotOrPileIndex(loadedGmFlow.pendingMapMoveSlot),
        pendingMapMoveFromIndex: loadSlotOrPileIndex(loadedGmFlow.pendingMapMoveFromIndex),
        pendingFloorEndRef:
          loadedGmFlow.pendingFloorEndRef &&
          typeof loadedGmFlow.pendingFloorEndRef.branchIndex === "number" &&
          typeof loadedGmFlow.pendingFloorEndRef.floorIndex === "number"
            ? {
                slotIndex: loadSlotOrPileIndex(loadedGmFlow.pendingFloorEndRef.slotIndex),
                branchIndex: loadedGmFlow.pendingFloorEndRef.branchIndex,
                floorIndex: loadedGmFlow.pendingFloorEndRef.floorIndex,
              }
            : null,
        floorEndRewardOpened: !!loadedGmFlow.floorEndRewardOpened,
        chipCombatSlot: typeof loadedGmFlow.chipCombatSlot === "number" ? loadedGmFlow.chipCombatSlot : null,
        chipCombatIsTerrible: !!loadedGmFlow.chipCombatIsTerrible,
        chipCombatContinuation: typeof loadedGmFlow.chipCombatContinuation === "string" ? loadedGmFlow.chipCombatContinuation : null,
        chipCombatResumeContinuation:
          typeof loadedGmFlow.chipCombatResumeContinuation === "string" ? loadedGmFlow.chipCombatResumeContinuation : null,
        chipCombatResumeSlot: typeof loadedGmFlow.chipCombatResumeSlot === "number" ? loadedGmFlow.chipCombatResumeSlot : null,
      };
      var loadedDraws = data.activeDraws && typeof data.activeDraws === "object" ? data.activeDraws : {};
      state.activeDraws = {
        potentialPower: loadedDraws.potentialPower || null,
        weapon: loadedDraws.weapon || null,
        talisman: loadedDraws.talisman || null,
        consumable: loadedDraws.consumable || null,
        turnRewardAutoOpen: !!loadedDraws.turnRewardAutoOpen,
      };
      state.activeThreatEffects = Array.isArray(data.activeThreatEffects) ? data.activeThreatEffects : [];
      state.returnedCardMemory =
        data.returnedCardMemory && typeof data.returnedCardMemory === "object" ? data.returnedCardMemory : {};
      state.cardFloorRewardGranted =
        data.cardFloorRewardGranted && typeof data.cardFloorRewardGranted === "object" ? data.cardFloorRewardGranted : {};
      state.freeFloorCleared = data.freeFloorCleared && typeof data.freeFloorCleared === "object" ? data.freeFloorCleared : {};
      state.floorCleared = data.floorCleared && typeof data.floorCleared === "object" ? data.floorCleared : {};
    } catch (e) {
      // 壊れた状態は無視して初期状態のまま続行する
    }
  }

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      applyLoadedData(JSON.parse(raw));
    } catch (e) {
      // 壊れた状態は無視して初期状態のまま続行する
    }
  }

  function resetState() {
    state.slots = new Array(SLOT_COUNT).fill(null);
    state.cardLevels = new Array(SLOT_COUNT).fill(null);
    state.eventChips = new Array(SLOT_COUNT).fill(null);
    state.eventChipNumbers = new Array(SLOT_COUNT).fill(null);
    state.eventChipsUsed = new Array(SLOT_COUNT).fill(false);
    state.eventChipsData = {};
    state.nightBossRoll = {};
    state.boardStarted = false;
    state.log = [];
    state.focusedIndex = null;
    state.dayNumber = 1;
    state.startSuit = null;
    state.endSuit = null;
    state.startChecks = defaultChecks();
    state.endChecks = defaultChecks();
    state.startDefeated = false;
    state.startDefeatedDay = null;
    state.timeLoss = defaultTimeLoss();
    state.wanderingBlessing = defaultWanderingBlessing();
    state.rollEffects = defaultRollEffects();
    state.smithingStone = "";
    state.smithingStoneCount = 0;
    state.stoneswordKey = "";
    state.stoneswordKeyCount = 0;
    state.grace = "";
    state.battle = defaultBattleState();
    state.dicePool = [];
    state.actionPhase = "normal";
    state.floorRewardObtained = {};
    state.floorRewardDismissed = {};
    state.turnHolder = "gm";
    state.turnMessages = [];
    state.turnMessageHistory = [];
    state.turnRewards = [];
    state.turnBoardEnabled = true;
    state.logBubbleEnabled = false;
    state.locationBannerCollapsed = false;
    state.locationBannerCorner = "right";
    // ユーザー指定：新遊戲を押しても自動化GM機能のON/OFF設定（autoGmEnabled/gmFlowEnabled）は
    // 変更しない——プレイヤーが設定した状態をそのまま維持する。autoGmLogだけは新しい遊戲の
    // 監査ログとしてクリアする。
    state.autoGmLog = [];
    state.gmFlow = {
      narrationText: null,
      awaitingOk: false,
      actionKind: "ok",
      pendingRewardWindows: [],
      openingPlayed: false,
      finalDayAnnounced: false,
      walk: null,
      pendingChoiceLabels: [],
      combatTriggerLabel: null,
      abilityCheckSpec: null,
      cooperativeCheckSpec: null,
      playerPickCheckSpec: null,
      playerPickCheckExcluded: [],
      branchPointTallySpec: null,
      sequentialPairSpec: null,
      conditionalCooperativeChoiceSpec: null,
      sequentialChainSpec: null,
      openEndedTallySpec: null,
      representativePickSpec: null,
      multiStatCheckSpec: null,
      freeFloorOptions: [],
      battleWaitActive: false,
      pendingBattleResetOnGateClose: false,
      pendingFinalFloorSlot: null,
      chipOfferSlot: null,
      chipOfferContinuation: null,
      pendingChipCheckSlot: null,
      pendingMapMoveSlot: null,
      pendingMapMoveFromIndex: null,
      pendingFloorEndRef: null,
      floorEndRewardOpened: false,
      chipCombatSlot: null,
      chipCombatIsTerrible: false,
      chipCombatContinuation: null,
      chipCombatResumeContinuation: null,
      chipCombatResumeSlot: null,
    };
    state.activeDraws = { potentialPower: null, weapon: null, talisman: null, consumable: null, turnRewardAutoOpen: null };
    state.activeThreatEffects = [];
    state.returnedCardMemory = {};
    state.cardFloorRewardGranted = {};
    state.freeFloorCleared = {};
    state.floorCleared = {};
    localStorage.removeItem(STORAGE_KEY);
    clearUndoSnapshot();
  }

  // ============================================================
  // ログ読み上げ（TTS、Web Speech API）：新しいログが追加されるたびに、その場で自動読み上げる。
  // ブラウザ内蔵の音声合成のみを使う（外部サービス無し）。既定はON、デバイス単位で
  // localStorageに保存（言語設定pritest-langと同じ永続化パターン）。読み上げは常に最新の
  // 発話で前の発話を中断する（連続ログでの遅延蓄積を避けるため）。
  // ============================================================
  var TTS_STORAGE_KEY = "pritest-tts-enabled";
  var ttsEnabled = localStorage.getItem(TTS_STORAGE_KEY) !== "0";
  var TTS_LANG_MAP = { zh: "zh-TW", ja: "ja-JP", en: "en-US" };

  function pickTtsVoice() {
    if (!window.speechSynthesis) return null;
    var voices = speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    var targetLang = TTS_LANG_MAP[window.I18N.getLang()] || TTS_LANG_MAP.zh;
    var exact = voices.filter(function (v) {
      return v.lang === targetLang;
    })[0];
    if (exact) return exact;
    var prefix = targetLang.slice(0, 2);
    var partial = voices.filter(function (v) {
      return v.lang && v.lang.slice(0, 2) === prefix;
    })[0];
    return partial || null;
  }

  function speakText(text) {
    if (!ttsEnabled || !window.speechSynthesis || !text) return;
    speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    var voice = pickTtsVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = TTS_LANG_MAP[window.I18N.getLang()] || TTS_LANG_MAP.zh;
    }
    speechSynthesis.speak(utterance);
  }

  function speakLog(key, params) {
    speakText(window.I18N.t(key, params));
  }

  function setTtsEnabled(enabled) {
    ttsEnabled = enabled;
    localStorage.setItem(TTS_STORAGE_KEY, enabled ? "1" : "0");
    renderTtsToggleButton();
    if (enabled) speakText(window.I18N.t("tts_enabled_announcement"));
    else if (window.speechSynthesis) speechSynthesis.cancel();
  }

  function renderTtsToggleButton() {
    var btn = document.getElementById("btn-tts-toggle");
    if (!btn) return;
    btn.textContent = window.I18N.t(ttsEnabled ? "tts_toggle_on_label" : "tts_toggle_off_label");
  }

  // 音声リストは非同期に読み込まれるブラウザがあるため、読み込み完了時に備えておく
  // （pickTtsVoiceは呼ばれるたびに再取得するので、ここでは特別な処理は不要だが、
  // Chromium系はイベント無しでは空配列のままになることがあるため念のため触れておく）。
  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = function () {};
  }

  // ============================================================
  // 骰子擲骰の全畫面演出：🎲アイコンで実際に振った出目（既に確定済みの値）を、
  // 全畫面のオーバーレイでランダムに面を切り替えながら見せ、最後に本当の出目へ着地させる
  // （演出はあくまで確定済みの結果を派手に見せるだけで、出目そのものを別途決め直すことはない）。
  // TTSと同じくデバイス単位のON/OFF（既定はON）で、設定から切り替えられる。
  // ============================================================
  var DICE_ANIMATION_STORAGE_KEY = "pritest-dice-animation-enabled";
  var diceAnimationEnabled = localStorage.getItem(DICE_ANIMATION_STORAGE_KEY) !== "0";
  var DICE_FACE_CHARS = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  var diceAnimationTimer = null;

  function setDiceAnimationEnabled(enabled) {
    diceAnimationEnabled = enabled;
    localStorage.setItem(DICE_ANIMATION_STORAGE_KEY, enabled ? "1" : "0");
    renderDiceAnimationToggleButton();
  }

  function renderDiceAnimationToggleButton() {
    var btn = document.getElementById("btn-dice-animation-toggle");
    if (!btn) return;
    btn.textContent = window.I18N.t(diceAnimationEnabled ? "dice_animation_toggle_on_label" : "dice_animation_toggle_off_label");
  }

  function playDiceRollAnimation(values) {
    var overlay = document.getElementById("dice-roll-overlay");
    if (!diceAnimationEnabled || !overlay || !values || !values.length) return;
    var stage = document.getElementById("dice-roll-overlay-stage");
    if (!stage) return;
    if (diceAnimationTimer) {
      clearInterval(diceAnimationTimer.interval);
      clearTimeout(diceAnimationTimer.tumbleStartTimeout);
      clearTimeout(diceAnimationTimer.settleTimeout);
      clearTimeout(diceAnimationTimer.hideTimeout);
    }
    stage.innerHTML = "";
    // 骰子ごとに投げ入れの開始を少しずつずらし、一斉に同じ動きをする不自然さを避ける。
    var dieEls = values.map(function (v, i) {
      var el = document.createElement("div");
      el.className = "dice-roll-overlay-die thrown-in";
      el.style.animationDelay = i * 0.05 + "s";
      el.textContent = DICE_FACE_CHARS[Math.floor(Math.random() * 6)];
      stage.appendChild(el);
      return el;
    });
    overlay.hidden = false;
    // 投げ入れアニメーションが終わる頃に、回転しながら出目を切り替える「転がる」フェイズへ移行する。
    var tumbleStartTimeout = setTimeout(function () {
      dieEls.forEach(function (el) {
        el.classList.remove("thrown-in");
        el.classList.add("tumbling");
      });
    }, 350);
    var spinInterval = setInterval(function () {
      dieEls.forEach(function (el) {
        el.textContent = DICE_FACE_CHARS[Math.floor(Math.random() * 6)];
      });
    }, 90);
    var settleTimeout = setTimeout(function () {
      clearInterval(spinInterval);
      dieEls.forEach(function (el, i) {
        el.classList.remove("tumbling");
        el.textContent = DICE_FACE_CHARS[Math.max(0, Math.min(5, values[i] - 1))];
        el.classList.add("settled");
      });
    }, 1300);
    var hideTimeout = setTimeout(function () {
      overlay.hidden = true;
    }, 1900);
    diceAnimationTimer = { interval: spinInterval, tumbleStartTimeout: tumbleStartTimeout, settleTimeout: settleTimeout, hideTimeout: hideTimeout };
  }

  function addLog(key, params) {
    state.log.push({ key: key, params: params || {}, time: Date.now() });
    renderLog();
    saveState();
    speakLog(key, params);
  }

  // character_drawer.js（night.jsとは別クロージャ、night以外のページでも単独利用される）から
  // 任意でログへ記録できるようにするフック。存在確認つきで呼ばれるため、他ページでは無害。
  window.PriTestNightLog = addLog;

  // 自動化GMの監査ログ。通常のstate.log（TTS読み上げ対象・確定行動記録）とは別の独立した記録で、
  // 誰がいつ何を確認・確定したか後から検証できるようにする（Phase 0時点では機能ON/OFFの記録のみ、
  // Phase 1以降で実際のロール結果・算出値・対象PCなどを記録する用途に使う）。
  function addAutoGmLog(text) {
    state.autoGmLog.push({ time: Date.now(), text: text });
    renderAutoGmLog();
    saveState();
  }

  // 通常のaddLog（TTS対象・state.log）と全く同じi18nキー・paramsで、自動化GM紀錄
  // （state.autoGmLog）へも並行して記録するためのヘルパー。文言のズレを防ぐため、
  // 呼び出し側は1回だけキー・paramsを書けばよい。
  function addLogAndAutoGmLog(key, params) {
    addLog(key, params);
    addAutoGmLog(window.I18N.t(key, params));
  }

  // auto_gm.js（今後追加予定、night.jsとは別クロージャ）から呼べるようにする、他の
  // window.PriTestNight*フックと同じ「存在確認つきグローバルフック」方式。
  window.PriTestNightAddAutoGmLog = addAutoGmLog;

  function renderAutoGmLog() {
    var list = document.getElementById("auto-gm-log-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.autoGmLog.length) {
      var empty = document.createElement("li");
      empty.textContent = window.I18N.t("auto_gm_log_empty");
      list.appendChild(empty);
      return;
    }
    state.autoGmLog.forEach(function (entry) {
      var li = document.createElement("li");
      var time = new Date(entry.time).toLocaleTimeString();
      li.textContent = "[" + time + "] " + entry.text;
      list.appendChild(li);
    });
  }

  // 獲得ボタンを押した瞬間に、画面上部へ短時間だけ「何を獲得したか」を表示する小さな通知。
  // 3秒後に自動で消える。DOM要素は初回呼び出し時に遅延生成する（HTMLテンプレート側の変更不要）。
  var rewardToastHideTimer = null;
  function showRewardToast(text) {
    var toast = document.getElementById("reward-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "reward-toast";
      toast.className = "reward-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    // reflowを挟んでからvisibleを付与し、連続発火時も毎回フェードインし直す
    toast.classList.remove("visible");
    void toast.offsetWidth;
    toast.classList.add("visible");
    if (rewardToastHideTimer) clearTimeout(rewardToastHideTimer);
    rewardToastHideTimer = setTimeout(function () {
      toast.classList.remove("visible");
    }, 3000);
  }

  // 樓層獲得ボタンを1回押した後は再度押せないようにし、見た目もはっきり「獲得済み」と
  // わかるようにする（従来は一部の種別のみdisabledにしていたが、全種別で統一する）。
  function markFloorRewardObtained(el, toastText, stateKey) {
    el.disabled = true;
    el.classList.add("field-reward-obtained");
    if (toastText) showRewardToast(toastText);
    if (stateKey) {
      if (!state.floorRewardObtained) state.floorRewardObtained = {};
      state.floorRewardObtained[stateKey] = true;
      saveState();
    }
  }

  // --- board ---
  function renderBoard() {
    // ユーザー指定：3日目（最終夜）は地図カード（#board-grid＝9マス＋起點/終點の山札）だけを
    // 非表示にする。#board-area自体を隠すと、同じ要素内にネストされている夜の王画像
    // （.night3-boss-wrap）や戦闘中の敵陣容パネル（.board-side-wrap、夜の王戦闘でも
    // 引き続き使う）まで巻き添えで隠れてしまうため、#board-gridだけを対象にする。
    var boardGrid = document.getElementById("board-grid");
    if (boardGrid) boardGrid.hidden = state.dayNumber >= MAX_DAY;
    for (var i = 0; i < SLOT_COUNT; i++) {
      var el = document.getElementById("slot-" + i);
      var slot = state.slots[i];
      el.classList.remove("empty", "face-down", "face-up", "latest");
      SUIT_CLASSES.forEach(function (cls) {
        el.classList.remove(cls);
      });
      if (!slot) {
        el.textContent = "";
        el.classList.add("empty");
      } else if (!slot.revealed) {
        el.textContent = "F";
        el.classList.add("face-down");
      } else {
        var card = CARD_BY_CODE[slot.code];
        el.textContent = card.label;
        el.classList.add("face-up", card.colorClass);
      }
      if (slot && state.focusedIndex === i) el.classList.add("latest");

      var levelControl = document.getElementById("level-control-" + i);
      levelControl.style.display = slot ? "flex" : "none";
      renderCardLevel(i);
      renderSlotEffect(i);
    }
    renderPiles();
    renderFieldLevels();
    renderDayStatus();
    renderPrimaryButton();
    renderThreatSheet();
    renderCharacterRoster();
    renderNight3BossImage();
    renderUndoButton();
    renderRainIcons();
  }

  // 第三天（最終夜）到達時のみ、管理員が設定した夜の王画像を盤面右側に表示する。
  // 画像の下には、他のエネミーHPグリッドと同じstate.battle.enemyHpを参照する
  // 簡易グリッドも合わせて表示し、夜の王のHPもその場でチェックできるようにする。
  function renderNight3BossImage() {
    var img = document.getElementById("night3-boss-image");
    var hpBlock = document.getElementById("night3-boss-hp");
    if (!img) return;
    var boss = game && game.night3BossId ? window.PriTestNightBosses.get(game.night3BossId) : null;
    var visible = !!boss && state.dayNumber >= 3;
    if (!visible) {
      img.hidden = true;
      img.removeAttribute("src");
      if (hpBlock) hpBlock.hidden = true;
      if (typeof renderBattlePositionAreas === "function") renderBattlePositionAreas();
      return;
    }
    img.src = window.PriTestNightBosses.imagePath(boss);
    img.alt = boss.title + " - " + boss.subtitle;
    img.hidden = false;
    img.style.cursor = "pointer";
    img.onclick = function () {
      openRulebookToEntry("nightking", "boss-entry-" + boss.id);
    };
    if (hpBlock) hpBlock.hidden = false;
    ensureNight3BossInBattle();
    if (typeof renderBattlePositionAreas === "function") renderBattlePositionAreas();
  }

  // --- 夜の王 規則書（管理員閲覧用の参考資料。紀錄の下に常時表示） ---
  function buildBossTable(columns, rows, T) {
    var table = document.createElement("table");
    table.className = "boss-action-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    columns.forEach(function (col) {
      var th = document.createElement("th");
      th.textContent = T(col);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      row.forEach(function (cell) {
        var td = document.createElement("td");
        td.textContent = T(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var wrap = document.createElement("div");
    wrap.className = "boss-table-scroll";
    wrap.appendChild(table);
    return wrap;
  }



  // 規則書モーダル: 管理員パスワード（"nightnight"、通常のadmin認証とは別）＋タブ切替
  function isRulebookAuthenticated() {
    return sessionStorage.getItem(RULEBOOK_SESSION_KEY) === "1";
  }

  function checkRulebookPassword() {
    if (isRulebookAuthenticated()) return true;
    var input = window.prompt(window.I18N.t("rulebook_password_prompt"));
    var ok = input === RULEBOOK_PASSWORD;
    if (ok) sessionStorage.setItem(RULEBOOK_SESSION_KEY, "1");
    return ok;
  }

  function handleOpenRulebook() {
    if (!checkRulebookPassword()) {
      alert(window.I18N.t("rulebook_password_wrong"));
      return;
    }
    document.getElementById("rulebook-modal").hidden = false;
  }

  function closeRulebookModal() {
    document.getElementById("rulebook-modal").hidden = true;
  }

  function switchRulebookTab(tabId) {
    document.querySelectorAll(".rulebook-tab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });
    document.querySelectorAll(".rulebook-tab-panel").forEach(function (panel) {
      panel.hidden = panel.id !== "rulebook-panel-" + tabId;
    });
  }

  // 紀錄ドロワー内の「紀錄」／「自動化GM記錄」タブ切替。規則書モーダルの.rulebook-tab-*と
  // 見た目は共通CSSを流用するが、クラス名は別にして意図せず互いのタブ切替に巻き込まれないようにする。
  function switchLogDrawerTab(tabId) {
    document.querySelectorAll(".log-drawer-tab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-log-tab") === tabId);
    });
    document.querySelectorAll(".log-drawer-tab-panel").forEach(function (panel) {
      panel.hidden = panel.id !== "log-drawer-panel-" + tabId;
    });
  }

  // 認証済みの場合のみ、規則書モーダルを開いて指定タブへ切り替え、該当項目まで展開＋スクロール
  // する（盤面の敵人チップ・夜の王画像・トランプ札から共通で使う）。
  function openRulebookToEntry(tabId, entryId) {
    if (!isRulebookAuthenticated()) return;
    document.getElementById("rulebook-modal").hidden = false;
    switchRulebookTab(tabId);
    setTimeout(function () {
      var target = document.getElementById(entryId);
      if (!target) return;
      if (target.tagName === "DETAILS") target.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // --- 夜の脅威シート（タイムロス／さまよう祝福／参考情報） ---
  function buildTimeLossRows(dayKey) {
    var container = document.getElementById("tl-" + dayKey + "-list");
    TIME_LOSS_ROW_DEFS.forEach(function (def, rowIndex) {
      var row = document.createElement("div");
      row.className = "tl-row";

      var boxesWrap = document.createElement("div");
      boxesWrap.className = "tl-boxes";
      for (var b = 0; b < def.boxes; b++) {
        (function (boxIndex) {
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.id = "tl-" + dayKey + "-" + rowIndex + "-" + boxIndex;
          cb.addEventListener("change", function () {
            var rowWasFull = state.timeLoss[dayKey][rowIndex].every(Boolean);
            state.timeLoss[dayKey][rowIndex][boxIndex] = cb.checked;
            renderTimeLossSummary();
            // 使用者確認（項目8）：夜雨の段のチェック状態が変わるたびに、盤面の下雨アイコンも
            // 追随して更新する。
            renderRainIcons();
            saveState();
            // GMが手動でチェックした場合も、addTimeLossの自動付与と同じく「威脅効果追加」段が
            // 新たに埋まった瞬間に1D6を振る（ユーザー確認済みの①〜⑥出目対応表）。
            if (!rowWasFull && state.timeLoss[dayKey][rowIndex].every(Boolean) && TIME_LOSS_ROW_DEFS[rowIndex].kind === "threat") {
              rollAndTriggerThreatEffect();
            }
          });
          boxesWrap.appendChild(cb);
        })(b);
      }
      row.appendChild(boxesWrap);

      var text = document.createElement("div");
      text.className = "tl-row-text";
      var strong = document.createElement("strong");
      strong.id = "tl-" + dayKey + "-" + rowIndex + "-label";
      var span = document.createElement("span");
      span.id = "tl-" + dayKey + "-" + rowIndex + "-detail";
      text.appendChild(strong);
      text.appendChild(span);
      row.appendChild(text);

      container.appendChild(row);
    });
  }

  function timeLossRowLabelDetail(dayKey, def) {
    if (def.kind === "threat") {
      return [window.I18N.t("threat_effect_add_label"), window.I18N.t("threat_effect_add_detail")];
    }
    if (def.kind === "rain") {
      return [window.I18N.t("night_rain_label"), window.I18N.t("night_rain_detail_" + dayKey + "_" + def.tier)];
    }
    return [window.I18N.t("night_visit_label"), window.I18N.t("night_visit_detail")];
  }

  function renderTimeLossText(dayKey) {
    document.getElementById("tl-" + dayKey + "-title").textContent = window.I18N.t("time_loss_day_title", {
      day: dayKey === "day1" ? 1 : 2,
    });
    TIME_LOSS_ROW_DEFS.forEach(function (def, rowIndex) {
      var parts = timeLossRowLabelDetail(dayKey, def);
      document.getElementById("tl-" + dayKey + "-" + rowIndex + "-label").textContent = parts[0];
      document.getElementById("tl-" + dayKey + "-" + rowIndex + "-detail").textContent = parts[1];
    });
  }

  function renderTimeLossChecks(dayKey) {
    TIME_LOSS_ROW_DEFS.forEach(function (def, rowIndex) {
      for (var b = 0; b < def.boxes; b++) {
        document.getElementById("tl-" + dayKey + "-" + rowIndex + "-" + b).checked = !!(
          state.timeLoss[dayKey][rowIndex] && state.timeLoss[dayKey][rowIndex][b]
        );
      }
    });
  }

  // 公開盤の常時表示バーは、威脅効果追加やロール効果まで並べると長くなりすぎるため、
  // 「夜雨」の到達済み最大段階のみを表示する（低い段階は高い段階の文言に包含されるため、
  // 最大値だけ見せれば十分）。個別の「威脅効果追加」詳細は btn-time-loss-broadcast の
  // 一時公告（triggerThreatBroadcast）で必要な時にだけ表示する。
  // 使用者確認（項目8）：現在有効な夜雨の最大階段（0＝夜雨無し）。renderTimeLossSummary内の
  // 既存ロジックを再利用可能な関数として抽出（盤面の下雨アイコン更新からも参照するため）。
  function currentActiveRainTier() {
    var dayKey = isSwappedDay() ? "day2" : "day1";
    var rows = state.timeLoss[dayKey];
    var maxRainTier = 0;
    TIME_LOSS_ROW_DEFS.forEach(function (def, i) {
      if (def.kind === "rain" && rows[i].every(Boolean) && def.tier > maxRainTier) maxRainTier = def.tier;
    });
    return maxRainTier;
  }

  // 夜雨の階段は「場地線：±0～+N」のようにL補の値そのもので範囲が決まる（列の左右位置とは
  // 無関係——2日目はL補が[5,4,3]と1日目の逆順になるため、単純に「左からN列」ではない）。
  // fieldLevelsForDay()の値が小さい列から順にN列（N＝現在の夜雨階段）を、影響を受ける列
  // index（0-2）の集合として返す。夜雨が発生していなければ空配列。
  function rainAffectedColumns() {
    var tier = currentActiveRainTier();
    if (!tier) return [];
    var levels = fieldLevelsForDay();
    var cols = [0, 1, 2].sort(function (a, b) {
      return levels[a] - levels[b];
    });
    return cols.slice(0, tier);
  }

  // 盤面最上段（slot-wrap-0/1/2、各列の一番上のカード格）に、現在夜雨の影響を受けている列
  // だけ下雨アイコンを表示する（項目8）。buildBoardSlotsが仕込んだ.slot-rain-icon要素の
  // 表示/非表示を切り替えるだけで、DOM自体は作り直さない。
  function renderRainIcons() {
    var affected = rainAffectedColumns();
    for (var col = 0; col < 3; col++) {
      var icon = document.getElementById("slot-rain-icon-" + col);
      if (icon) icon.hidden = affected.indexOf(col) === -1;
    }
  }

  function renderTimeLossSummary() {
    var dayKey = isSwappedDay() ? "day2" : "day1";
    var maxRainTier = currentActiveRainTier();
    var summaryEl = document.getElementById("time-loss-summary");
    // #15：従来は夜雨の最大段階しか見ておらず、「威脅効果追加」（activeThreatEffects）が
    // 何個現在有効かは常時バーのどこにも出ていなかった（"尚未觸發"のまま）。件数を先頭に足す。
    // GM報告：骰效果（出目／發揮檢定の累積値、ROLL_EFFECTS）が實際に發動していても
    // activeThreatEffectsだけを見ていたため「尚未觸發」のままだった。發動中の骰效果の
    // 種類数も合わせて数える。
    var activeRollEffectCount = ROLL_EFFECTS.filter(function (effect) {
      return (state.rollEffects[effect.id] || 0) > 0;
    }).length;
    var activeCount = (state.activeThreatEffects || []).length + activeRollEffectCount;
    var parts = [];
    if (activeCount > 0) {
      parts.push(window.I18N.t("time_loss_active_effect_count", { count: activeCount }));
    }
    if (maxRainTier > 0) {
      parts.push(
        window.I18N.t("night_rain_label") + window.I18N.t("colon_separator") + window.I18N.t("night_rain_detail_" + dayKey + "_" + maxRainTier)
      );
    }
    summaryEl.textContent = parts.length ? parts.join(" • ") : window.I18N.t("time_loss_none");
  }

  // --- 威脅効果追加の一時公告（廣播） ---
  // 公開盤の常時バーからは「威脅効果追加」を外したため、GMが必要なタイミングで手動公告
  // できるよう、i情報ボタンの横に廣播ボタンを追加する。現在の日の「威脅効果追加」段が
  // 発生済みの数だけ、分段（1件ずつ別行）で一時的に表示し、5秒後またはXで閉じる。
  var threatBroadcastInterval = null;

  function clearThreatBroadcastInterval() {
    if (threatBroadcastInterval) {
      clearInterval(threatBroadcastInterval);
      threatBroadcastInterval = null;
    }
  }

  function closeThreatBroadcast() {
    var overlay = document.getElementById("threat-broadcast-overlay");
    if (overlay) overlay.hidden = true;
    clearThreatBroadcastInterval();
  }

  function showThreatBroadcast(segments) {
    var overlay = document.getElementById("threat-broadcast-overlay");
    var content = document.getElementById("threat-broadcast-content");
    if (!overlay || !content) return;
    content.innerHTML = "";
    segments.forEach(function (text) {
      var line = document.createElement("div");
      line.className = "threat-broadcast-line";
      line.textContent = text;
      content.appendChild(line);
    });
    overlay.hidden = false;
    clearThreatBroadcastInterval();
    var remaining = 5;
    var countdownEl = document.getElementById("threat-broadcast-countdown");
    if (countdownEl) countdownEl.textContent = remaining;
    threatBroadcastInterval = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        closeThreatBroadcast();
        return;
      }
      if (countdownEl) countdownEl.textContent = remaining;
    }, 1000);
  }

  function triggerThreatBroadcast() {
    var segments = [];
    // GM報告：TIME_LOSS_ROW_DEFSの「threat」欄（day1/day2シート上のチェック欄）は
    // 具体的な内容を持たない汎用プレースホルダー文言（「威脅効果追加：追加 1 個效果」）
    // だったため、公告に出しても何も伝わらなかった。実際に何が起きたかは
    // activeThreatEffects（自由記述）とactiveRollEffectBroadcastLines（骰效果の実数値）
    // だけで十分伝わるため、汎用文言はここでは公告しない。
    // #15：手動で改めて公告する際は、現在有効な威脅効果追加（activeThreatEffects）の
    // テキストも合わせて再掲する（何が起きているか一目で分かるようにする）。
    (state.activeThreatEffects || []).forEach(function (entry) {
      segments.push(window.I18N.t("threat_effect_add_label") + window.I18N.t("colon_separator") + entry.text);
    });
    // 現在發動中の骰效果（敵方傷害增加／敵方HP數值增加／PC最大加護減少／
    // 屬性異常蓄積值降低／聖杯瓶使用次數）も同じ公告にまとめて載せる。
    segments = segments.concat(activeRollEffectBroadcastLines());
    if (segments.length === 0) segments.push(window.I18N.t("time_loss_none"));
    showThreatBroadcast(segments);
  }

  // --- 敵人體崩／擊破の長時間公告 ---
  // threat-broadcast-overlayと違い、5秒で自動的には閉じない。GMが実際に行動階段を切り替える
  // （額外階段へ進む、または戦闘終了で一般階段へ戻る）までは公開盤に残り続ける（setActionPhase参照）。
  function closeEnemyRowStatusBanner() {
    var overlay = document.getElementById("enemy-row-status-overlay");
    if (overlay) overlay.hidden = true;
  }

  function showEnemyRowStatusBanner(kind, text) {
    var overlay = document.getElementById("enemy-row-status-overlay");
    var content = document.getElementById("enemy-row-status-content");
    if (!overlay || !content) return;
    content.textContent = text;
    overlay.classList.toggle("status-defeated", kind === "defeated");
    overlay.hidden = false;
  }

  // --- 自動化GM 戰鬥自動化：簡易戰鬥終了時「追擊損害」の確認バナー ---
  // enemy-row-status-overlayと同様、GMが[確認]を押すまで公開盤に残り続ける
  // （threat-broadcast-overlayと違い自動では閉じない）。
  function closeSimplifiedCombatEndPrompt() {
    var overlay = document.getElementById("simplified-combat-end-overlay");
    if (overlay) overlay.hidden = true;
  }

  function renderSimplifiedCombatEndPrompt() {
    var overlay = document.getElementById("simplified-combat-end-overlay");
    var content = document.getElementById("simplified-combat-end-content");
    if (!overlay || !content) return;
    var value = computePursuitDamage();
    content.textContent =
      value > 0
        ? window.I18N.t("simplified_combat_pursuit_damage_prompt", { value: value })
        : window.I18N.t("simplified_combat_pursuit_damage_none_prompt");
    overlay.hidden = false;
  }

  // GMが[確認]を押した時点で、敵人剩餘HPと同じ量のHP損害を在場全員PCに与えてから
  // （docs/combat_flow_rules.md §6、使用者裁定＝battle_simple_combat_bodyの既存規則書
  // 参照文と一致）、既存の戦闘終了処理（combatEnd）を呼ぶ。
  function handleSimplifiedCombatEndConfirm() {
    var value = computePursuitDamage();
    if (value > 0) {
      rosterCharacters.forEach(function (c) {
        if (!c.entered) return;
        c.hp.current = Math.max(0, c.hp.current - value);
        checkNearDeathTrigger(c);
      });
      saveRosterCharacters();
      addLog("log_simplified_combat_pursuit_damage", { value: value });
    }
    state.battle.simplifiedCombatEndPending = false;
    closeSimplifiedCombatEndPrompt();
    renderCharacterRoster();
    setActionPhase("normal", { combatEnd: true, fromSimplifiedCombat: true });
  }

  function buildWanderingBlessingChecks() {
    ["base", "extra"].forEach(function (which) {
      var container = document.getElementById("wb-" + which);
      for (var i = 0; i < 3; i++) {
        (function (idx) {
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.id = "wb-" + which + "-" + idx;
          cb.addEventListener("change", function () {
            state.wanderingBlessing[which][idx] = cb.checked;
            saveState();
          });
          container.appendChild(cb);
        })(i);
      }
    });
  }

  function renderWanderingBlessing() {
    ["base", "extra"].forEach(function (which) {
      for (var i = 0; i < 3; i++) {
        document.getElementById("wb-" + which + "-" + i).checked = !!state.wanderingBlessing[which][i];
      }
    });
  }

  function renderThreatTextFields() {
    document.getElementById("input-grace").value = state.grace || "";
    renderStoneswordKeyCount();
    renderSmithingStoneCount();
  }

  // 鍛石／石劍鑰匙は自由記述の入力欄を廃止し、＋－ボタンのみでカウントを直接編集する
  // （0未満にはならない）。
  function adjustStoneswordKeyCount(delta) {
    state.stoneswordKeyCount = Math.max(0, (state.stoneswordKeyCount || 0) + delta);
    saveState();
    renderStoneswordKeyCount();
  }

  function adjustSmithingStoneCount(delta) {
    state.smithingStoneCount = Math.max(0, (state.smithingStoneCount || 0) + delta);
    saveState();
    renderSmithingStoneCount();
  }

  function renderStoneswordKeyCount() {
    var el = document.getElementById("stonesword-key-count-label");
    if (!el) return;
    el.textContent = String(state.stoneswordKeyCount || 0);
  }

  function renderSmithingStoneCount() {
    var el = document.getElementById("smithing-stone-count-label");
    if (!el) return;
    el.textContent = String(state.smithingStoneCount || 0);
  }

  function renderThreatRefTexts() {
    document.getElementById("time-loss-accum-timing-body").textContent = window.I18N.t("time_loss_accum_timing_body");
    document.getElementById("night-rain-timing-body").textContent = window.I18N.t("night_rain_timing_body");
  }

  // 「⑥PC「聖杯瓶使用次數」減少」は、以前はチェック欄が記録として存在するだけで実際のゲーム
  // 効果を持たなかった（GMが手動でキャラクター詳細の聖杯瓶上限を調整する必要があった）。
  // ここで段階（tier）の変化分だけ、入場中の全PCの聖杯瓶「基本欄」の上限を実際に増減させる。
  // 現在値が新しい上限を超える場合はクランプする（上限が減っても、既に使用済みの分が
  // 復活するわけではない）。
  function applyFlaskUsesRollEffect(tierDelta) {
    if (!tierDelta) return;
    var maxDelta = -tierDelta;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c) {
      if (!c.flaskBase) c.flaskBase = { current: 3, max: 3 };
      c.flaskBase.max = Math.max(0, (c.flaskBase.max || 0) + maxDelta);
      c.flaskBase.current = Math.min(c.flaskBase.current || 0, c.flaskBase.max);
    });
    saveRosterCharacters();
    renderCharacterRoster();
  }

  // 現在發動中（count>0）の骰效果を「①②敵方傷害增加：亂戰60／個別20」のような條列式の
  // 行に変換する。夜雨と違い骰效果はstate.rollEffectsが日をまたいでも1つのままなので、
  // 第二天になっても素直に全件を数え続ける（day1/day2で分けない）。
  function activeRollEffectBroadcastLines() {
    var lines = [];
    ROLL_EFFECTS.forEach(function (effect) {
      var count = state.rollEffects[effect.id] || 0;
      if (count <= 0) return;
      var label = window.I18N.t("roll_effect_" + effect.id + "_label");
      var detail = window.I18N.t("roll_effect_" + effect.id + "_tier" + count);
      lines.push(label + window.I18N.t("colon_separator") + detail);
    });
    return lines;
  }

  function broadcastActiveRollEffects() {
    var lines = activeRollEffectBroadcastLines();
    if (!lines.length) return;
    showThreatBroadcast(lines);
    postSystemTurnMessage(lines.join(" / "));
  }

  function renderRollEffects() {
    var container = document.getElementById("roll-effects-list");
    container.innerHTML = "";
    ROLL_EFFECTS.forEach(function (effect) {
      var count = state.rollEffects[effect.id] || 0;

      var row = document.createElement("div");
      row.className = "tl-row";

      var text = document.createElement("div");
      text.className = "tl-row-text";
      var strong = document.createElement("strong");
      strong.textContent = window.I18N.t("roll_effect_" + effect.id + "_label");
      var span = document.createElement("span");
      span.textContent = count === 0 ? window.I18N.t("time_loss_none") : window.I18N.t("roll_effect_" + effect.id + "_tier" + count);
      text.appendChild(strong);
      text.appendChild(span);
      row.appendChild(text);

      var stepper = document.createElement("div");
      stepper.className = "level-control";
      var minus = document.createElement("button");
      minus.type = "button";
      minus.className = "level-btn";
      minus.textContent = "-";
      var value = document.createElement("span");
      value.className = "level-value";
      value.textContent = count + "/" + effect.tiers;
      var plus = document.createElement("button");
      plus.type = "button";
      plus.className = "level-btn";
      plus.textContent = "+";
      minus.addEventListener("click", function () {
        var newCount = Math.max(0, count - 1);
        state.rollEffects[effect.id] = newCount;
        if (effect.id === "flask_uses") applyFlaskUsesRollEffect(newCount - count);
        saveState();
        renderRollEffects();
        renderTimeLossSummary();
      });
      plus.addEventListener("click", function () {
        var newCount = Math.min(effect.tiers, count + 1);
        state.rollEffects[effect.id] = newCount;
        if (effect.id === "flask_uses") applyFlaskUsesRollEffect(newCount - count);
        saveState();
        renderRollEffects();
        renderTimeLossSummary();
        // 骰效果が新たに發動した際は、以前は汎用の「威脅効果追加」としか公告されず何が
        // 起きたか分からなかった。実際にどの効果がどの数値で發動したか、現在有効な分を
        // 條列式でそのまま公告する。
        broadcastActiveRollEffects();
      });
      stepper.appendChild(minus);
      stepper.appendChild(value);
      stepper.appendChild(plus);
      row.appendChild(stepper);

      container.appendChild(row);
    });
  }

  function renderThreatSheet() {
    document.getElementById("btn-time-loss-info").title = window.I18N.t("time_loss_info_button");
    renderTimeLossText("day1");
    renderTimeLossText("day2");
    renderTimeLossChecks("day1");
    renderTimeLossChecks("day2");
    renderTimeLossSummary();
    renderWanderingBlessing();
    renderThreatTextFields();
    renderThreatRefTexts();
    renderRollEffects();
    renderActiveThreatEffects();
  }

  // 「階段結束為止，將敵人設為『HP價值：－10』」等、純粋なダメージ以外のスキル効果をGM/玩家が
  // 自由記述で追加し、有効な間は一覧表示、無効化されたら各自Xで削除する手動リスト。
  // 実際にどのスキル効果が現在有効かはGM/玩家が判断してテキストを入力する運用（自動検出はしない）。
  function renderActiveThreatEffects() {
    var container = document.getElementById("active-threat-effects-list");
    if (!container) return;
    container.innerHTML = "";
    (state.activeThreatEffects || []).forEach(function (entry) {
      var box = document.createElement("div");
      box.className = "action-log-box";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "action-log-close";
      closeBtn.textContent = "×";
      closeBtn.title = window.I18N.t("action_log_clear_button");
      closeBtn.addEventListener("click", function () {
        removeActiveThreatEffect(entry.id);
      });
      box.appendChild(closeBtn);
      var textEl = document.createElement("p");
      textEl.className = "action-log-title";
      textEl.textContent = entry.text;
      box.appendChild(textEl);
      container.appendChild(box);
    });
  }

  function handleActiveThreatEffectAdd() {
    var input = document.getElementById("active-threat-effect-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    if (!state.activeThreatEffects) state.activeThreatEffects = [];
    state.activeThreatEffects.push({ id: "ate" + Date.now() + Math.floor(Math.random() * 1000), text: text });
    input.value = "";
    saveState();
    renderActiveThreatEffects();
    renderTimeLossSummary();
    // #15：「威脅効果追加：追加 1 個效果」という汎用文言だけでは何が起きたか分からず、
    // また今まで公告自体が出ていなかった。実際に追加した効果のテキストを公告する。
    var addedMsg = window.I18N.t("threat_effect_add_label") + window.I18N.t("colon_separator") + text;
    showThreatBroadcast([addedMsg]);
    postSystemTurnMessage(addedMsg);
  }

  function removeActiveThreatEffect(id) {
    state.activeThreatEffects = (state.activeThreatEffects || []).filter(function (entry) {
      return entry.id !== id;
    });
    saveState();
    renderActiveThreatEffects();
    renderTimeLossSummary();
  }

  function openThreatDrawer() {
    document.getElementById("threat-drawer").classList.add("open");
  }

  function closeThreatDrawer() {
    document.getElementById("threat-drawer").classList.remove("open");
  }

  // --- 戦場シート ---
  // PC番号（1〜6）は前衛／後衛どちらのマスにいても同じPCを指すため、敵視の値は両エリアで共有する。
  // 戦場面板（battle-drawer）と盤面共用パネル（board-side-position）の両方に同じ内容を描画し、
  // どちらを操作しても即座に両方へ反映される（毎回フルリビルドする単純な方式）。
  // 番号ラベルは、現在入場しているPCの名前（順番どおり最大6人）に置き換える。
  var BATTLE_POSITION_TARGETS = [
    { front: "battle-front-grid", back: "battle-back-grid" },
    { front: "board-side-position-front", back: "board-side-position-back" },
  ];

  function battlePositionNames() {
    return rosterCharacters
      .filter(function (c) {
        return c.entered;
      })
      .map(function (c) {
        return c.name;
      });
  }

  // キャラクターが現在、前衛／後衛どちらのマスにいるかを返す（"front"/"back"）。
  // 戦場に入っていない（BATTLE_SLOT_COUNTを超える、または未エントリー）場合はnull。
  function getCharacterBattlePosition(c) {
    var names = battlePositionNames();
    var idx = names.indexOf(c.name);
    if (idx === -1 || idx >= BATTLE_SLOT_COUNT) return null;
    return state.battle.front[idx] ? "front" : "back";
  }

  // character_drawer.js（別クロージャ、night以外のページでも単独利用される）から、条件付き
  // 遺物効果（「後衛時のみ」「敵視：1以上のとき」等）の判定に必要な戦場情報を参照するためのフック。
  // 存在確認つきで呼ばれるため、night.js以外のページでは無害（未定義のまま＝条件不成立扱い）。
  window.PriTestNightBattleContext = function (c) {
    var names = battlePositionNames();
    var idx = names.indexOf(c.name);
    if (idx === -1 || idx >= BATTLE_SLOT_COUNT) return null;
    return { position: state.battle.front[idx] ? "front" : "back", aggro: state.battle.aggro[idx] || 0 };
  };

  // 玩家資訊（角色欄）の「目前○○區域＆敵視為N」表示：骰子池の予測(computeDiceStatus)とは
  // 別に、state.battleの実際の値を毎回読み直す（#4b）。戦場に入っていない/未エントリーの
  // 場合は何も表示しない。
  function renderLiveBattleStatusLabel(el, c) {
    if (!el) return;
    var ctx = window.PriTestNightBattleContext(c);
    if (!ctx) {
      el.textContent = "";
      return;
    }
    var positionText = window.I18N.t(ctx.position === "front" ? "dice_status_front" : "dice_status_back");
    el.textContent = window.I18N.t("dice_status_live_label", { position: positionText, aggro: ctx.aggro });
  }

  function buildBattlePositionGrid(containerId, valuesArray, names) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    for (var i = 0; i < BATTLE_SLOT_COUNT; i++) {
      (function (idx) {
        var cell = document.createElement("div");
        cell.className = "battle-toggle-cell";

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "battle-toggle-square";
        var label = names[idx] || String(idx + 1);
        btn.textContent = label;
        btn.title = label;
        if (valuesArray[idx]) btn.classList.add("active");
        btn.addEventListener("click", function () {
          valuesArray[idx] = !valuesArray[idx];
          saveState();
          renderBattlePositionAreas();
          renderCharacterRoster(); // #4b: 玩家資訊欄の「目前○○區域＆敵視為N」を隊列変更に追随させる
        });
        cell.appendChild(btn);

        var stepper = document.createElement("div");
        stepper.className = "battle-aggro-stepper";
        var aggroTitle = window.I18N.t("battle_aggro_label") + " (" + label + ")";
        var minus = document.createElement("button");
        minus.type = "button";
        minus.className = "level-btn";
        minus.title = aggroTitle;
        minus.textContent = "−";
        minus.addEventListener("click", function () {
          state.battle.aggro[idx] = Math.max(0, (state.battle.aggro[idx] || 0) - 1);
          saveState();
          renderBattlePositionAreas();
          renderCharacterRoster(); // #4b
        });
        var value = document.createElement("span");
        value.className = "level-value battle-aggro-value";
        value.textContent = state.battle.aggro[idx] || 0;
        var plus = document.createElement("button");
        plus.type = "button";
        plus.className = "level-btn";
        plus.title = aggroTitle;
        plus.textContent = "＋";
        plus.addEventListener("click", function () {
          state.battle.aggro[idx] = (state.battle.aggro[idx] || 0) + 1;
          saveState();
          renderBattlePositionAreas();
          renderCharacterRoster(); // #4b
        });
        stepper.appendChild(minus);
        stepper.appendChild(value);
        stepper.appendChild(plus);
        cell.appendChild(stepper);

        container.appendChild(cell);
      })(i);
    }
  }

  // 地図面板上に敵人・夜の王のいずれかがいる場合のみ、共用パネル側の前衛／後衛表を表示する。
  function hasActiveBattleContext() {
    var hasEnemies = !!(state.battle && state.battle.selectedEnemyIds && state.battle.selectedEnemyIds.length);
    var bossImg = document.getElementById("night3-boss-image");
    var hasBoss = !!(bossImg && !bossImg.hidden);
    return hasEnemies || hasBoss;
  }

  function renderBattlePositionAreas() {
    var names = battlePositionNames();
    BATTLE_POSITION_TARGETS.forEach(function (t) {
      buildBattlePositionGrid(t.front, state.battle.front, names);
      buildBattlePositionGrid(t.back, state.battle.back, names);
    });
    renderBoardSidePositionCompact();
    var boardSidePosition = document.getElementById("board-side-position");
    if (boardSidePosition) boardSidePosition.hidden = !hasActiveBattleContext();
  }

  // 公開盤の前衛／後衛表は、既定で「名前(敵視)」を並べた1行の精簡表示にする。
  // 長すぎてボックスに収まらない場合のみ、setMarqueeTextが往復スクロールを有効にする。
  function renderBoardSidePositionCompact() {
    var names = battlePositionNames();
    var frontParts = [];
    var backParts = [];
    for (var i = 0; i < BATTLE_SLOT_COUNT; i++) {
      if (i >= names.length) continue;
      var tag = names[i] + "(" + (state.battle.aggro[i] || 0) + ")";
      (state.battle.front[i] ? frontParts : backParts).push(tag);
    }
    var sep = window.I18N.t("colon_separator");
    setMarqueeText(
      "board-side-position-front-compact",
      window.I18N.t("battle_front_area_label") + sep + (frontParts.join(" ") || "-")
    );
    setMarqueeText(
      "board-side-position-back-compact",
      window.I18N.t("battle_back_area_label") + sep + (backParts.join(" ") || "-")
    );
  }

  // テキストが表示枠より長いときだけ、CSS変数--marquee-distanceを使った往復スクロール
  // （.marquee-active）を有効にする汎用ヘルパー。公開盤の前衛/後衛表・威脅公告などで共用する。
  function setMarqueeText(elId, text) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("marquee-active");
    el.style.removeProperty("--marquee-distance");
    var wrap = el.parentElement;
    if (!wrap) return;
    requestAnimationFrame(function () {
      var overflow = el.scrollWidth - wrap.clientWidth;
      if (overflow > 2) {
        el.style.setProperty("--marquee-distance", -(overflow + 6) + "px");
        el.classList.add("marquee-active");
      }
    });
  }

  function setBoardPositionExpanded(expanded) {
    document.getElementById("board-side-position-compact").hidden = expanded;
    document.getElementById("board-side-position-full").hidden = !expanded;
    var btn = document.getElementById("btn-board-position-toggle");
    if (btn) btn.innerHTML = expanded ? "&#9662;" : "&#9656;";
  }

  // 骰子池の判定結果（前衛/後衛、6の目による敵視+1）を、戦場シートの対応するPCスロットへ
  // 自動反映する。ただし各スロットにつき「最初の全骰子ロール」で1度だけ計算・確定させ
  // （state.battle.positionLocked）、以後は額外/防禦フェイズでの骰子追加や加護重骰があっても
  // 自動上書きしない（前後衛・敵視の移動は、戦闘中の移動処理や特定スキルの効果、または
  // 戦場面板からの手動調整でのみ行われる）。ロックは新しい回合の開始、またはGMによる
  // 骰子リセットで解除される。
  function syncDiceStatusToBattle() {
    // 「一般行動」フェイズ中は、骰子池がどんな内容であっても前後衛・敵視の自動判定を行わない
    // （一般行動の骰子は戦闘外の用途であり、勝手に戦場の陣形を変えてしまわないようにするため）。
    if (state.actionPhase === "normal") return;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    var stateChanged = false;
    var flagsChanged = false;
    if (!state.battle.positionLocked) state.battle.positionLocked = new Array(BATTLE_SLOT_COUNT).fill(false);
    entered.forEach(function (c, idx) {
      if (idx >= BATTLE_SLOT_COUNT) return;
      var pool = c.dicePool || [];
      if (!pool.length) {
        if (c._diceAggroApplied) {
          c._diceAggroApplied = false;
          flagsChanged = true;
        }
        return;
      }
      if (state.battle.positionLocked[idx]) return; // 既に最初のロールで確定済み：自動同期しない
      var status = CharacterDrawer.computeDiceStatus(pool);
      if (status) {
        var wantFront = status.position === "front";
        if (!!state.battle.front[idx] !== wantFront) {
          state.battle.front[idx] = wantFront;
          stateChanged = true;
        }
        if (!!state.battle.back[idx] !== !wantFront) {
          state.battle.back[idx] = !wantFront;
          stateChanged = true;
        }
        if (status.aggroIncrease && !c._diceAggroApplied) {
          state.battle.aggro[idx] = (state.battle.aggro[idx] || 0) + 1;
          c._diceAggroApplied = true;
          flagsChanged = true;
        }
        state.battle.positionLocked[idx] = true;
        stateChanged = true;
      }
    });
    if (stateChanged) saveState();
    if (flagsChanged) saveRosterCharacters();
  }

  // 敵人を除去、または戦闘終了したときに残ってしまう「その敵人への屬性/異常蓄積」データを
  // 消去する（enemyAccum/enemyTriggerCount/enemyRoundLockedは"敵人key|label"、dealtは
  // "角色id|敵人key|label"がキー）。残したままだと再利用されたスロットに前の敵人の蓄積が
  // 引き継がれてしまうバグの原因になる。
  function purgeAttributeStatusForEnemyKey(enemyKey) {
    var as = state.battle.attributeStatus;
    if (!as) return;
    ["enemyAccum", "enemyTriggerCount", "enemyRoundLocked"].forEach(function (bucket) {
      Object.keys(as[bucket] || {}).forEach(function (k) {
        if (k.indexOf(enemyKey + "|") === 0) delete as[bucket][k];
      });
    });
    Object.keys(as.dealt || {}).forEach(function (k) {
      if (k.split("|")[1] === enemyKey) delete as.dealt[k];
    });
    if (state.battle.enemyDmgOverride) delete state.battle.enemyDmgOverride[enemyKey];
  }

  // 敵人を除去した、または戦場を初期化したときは、前衛/後衛の点灯と敵視を全て解除する。
  function resetBattlePositionsAndAggro() {
    for (var i = 0; i < BATTLE_SLOT_COUNT; i++) {
      state.battle.front[i] = false;
      state.battle.back[i] = false;
      state.battle.aggro[i] = 0;
      state.battle.positionLocked[i] = false;
    }
    saveState();
    renderBattlePositionAreas();
  }

  // 敵が0体の状態から新たに敵を加える＝新しい戦闘の開始とみなし、入場中PCの習得済み遺物効果に
  // 「敵視」を常時加減する受動効果があれば、その分を初期敵視として自動反映する。
  function applyInitialPassiveAggro() {
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c, idx) {
      if (idx >= BATTLE_SLOT_COUNT) return;
      state.battle.aggro[idx] = CharacterDrawer.getPassiveAggroBonus ? CharacterDrawer.getPassiveAggroBonus(c) : 0;
    });
    // 淑女「致命一擊獲得盧恩」：新しい戦闘（敵が0体から追加）の開始ごとに「1次戰鬥中僅發揮1次」の
    // ロックを解除する。
    state.battle._fatalStrikeRuneGranted = false;
    saveState();
    renderBattlePositionAreas();
  }

  // --- 実行アクションログ（点線枠のボックス）：戦闘の6行動いずれかで骰子決済が完了するたびに、
  // 盤面ロスターの各角色エリアへ実行結果を記録する。右上のXでいつでも消去できる。
  function addActionBox(c, title, total, lines) {
    if (!c.pendingActionBoxes) c.pendingActionBoxes = [];
    c.pendingActionBoxes.push({
      id: "ab" + Date.now() + Math.floor(Math.random() * 1000),
      title: title,
      total: total,
      lines: lines || [],
    });
    saveRosterCharacters();
  }

  function removeActionBox(c, boxId) {
    c.pendingActionBoxes = (c.pendingActionBoxes || []).filter(function (b) {
      return b.id !== boxId;
    });
    saveRosterCharacters();
    renderCharacterRoster();
  }

  // 額外／防禦行動フェイズへ入るたび、各角色の確定行動（点線枠）を一括で消去する。
  // 消去前の内容は記録として全体ログへ残す。「敵人傷害」ボックス（kind:"enemyDamage"）は
  // 専用のライフサイクル（clearEnemyDamageActionBoxes、防禦フェイズ開始時／戦闘終了時のみ
  // 自動で消える）を持つため、この一括消去の対象からは除外する。
  function clearAllPendingActionBoxes() {
    rosterCharacters.forEach(function (c) {
      if (!c.pendingActionBoxes || !c.pendingActionBoxes.length) return;
      var cleared = c.pendingActionBoxes.filter(function (b) {
        return b.kind !== "enemyDamage";
      });
      if (!cleared.length) return;
      var summary = cleared
        .map(function (b) {
          return b.total ? b.title + "(" + b.total + ")" : b.title;
        })
        .join("、");
      c.pendingActionBoxes = c.pendingActionBoxes.filter(function (b) {
        return b.kind === "enemyDamage";
      });
      addLog("log_action_box_clear", { character: c.name, actions: summary });
    });
  }

  // 使用者確認：「敵人傷害」ボックスは各角色につき常に最大1件のみ表示する。防禦フェイズへ
  // 新しく入るたびの一番最初（addEnemyDamageBoxで今回合の分を追加する前）と、戦闘終了時に
  // 呼び出し、古い記録を消してから始める。
  function clearEnemyDamageActionBoxes() {
    rosterCharacters.forEach(function (c) {
      if (!c.pendingActionBoxes || !c.pendingActionBoxes.length) return;
      c.pendingActionBoxes = c.pendingActionBoxes.filter(function (b) {
        return b.kind !== "enemyDamage";
      });
    });
  }

  // 「敵人傷害」ボックスは、既存の実行ログと違いGMが長押し確認でのみ消せる置頂記録のため、
  // 通常のaddActionBoxとは別枠でunshift（先頭固定）し、専用の見た目・削除UIを付ける。
  function addEnemyDamageBox(c, line) {
    if (!c.pendingActionBoxes) c.pendingActionBoxes = [];
    c.pendingActionBoxes.unshift({
      id: "ed" + Date.now() + Math.floor(Math.random() * 1000),
      kind: "enemyDamage",
      title: line,
      total: null,
      lines: [],
    });
  }

  function renderActionBoxes(c, container) {
    (c.pendingActionBoxes || []).forEach(function (box) {
      var el = document.createElement("div");
      var isEnemyDamage = box.kind === "enemyDamage";
      el.className = isEnemyDamage ? "action-log-box action-log-box-enemy-damage" : "action-log-box";
      if (isEnemyDamage) {
        attachClickToRevealClose(el, function () {
          removeActionBox(c, box.id);
        });
      } else {
        var closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "action-log-close";
        closeBtn.textContent = "×";
        closeBtn.title = window.I18N.t("action_log_clear_button");
        closeBtn.addEventListener("click", function () {
          removeActionBox(c, box.id);
        });
        el.appendChild(closeBtn);
      }
      if (box.total) {
        var totalEl = document.createElement("p");
        totalEl.className = "action-log-total";
        totalEl.textContent = box.total;
        el.appendChild(totalEl);
      }
      var titleEl = document.createElement("p");
      titleEl.className = "action-log-title";
      titleEl.textContent = box.title;
      el.appendChild(titleEl);
      (box.lines || []).forEach(function (line) {
        var lineEl = document.createElement("p");
        lineEl.className = "action-log-line";
        lineEl.textContent = line;
        el.appendChild(lineEl);
      });
      container.appendChild(el);
    });
  }

  // 板塊起點/終點の長押し判定（SLOT_LONG_PRESS_MS）と同型の汎用ヘルパー。短押しでは何もしない
  // （旧仕様：「敵人傷害」ボックスは長押し確認でのみ削除できた。現在はattachClickToRevealCloseに
  // 置き換え済みだが、他箇所からの再利用に備えて関数自体は残す）。
  function attachLongPressRemove(el, onLongPress) {
    var pressTimer = null;
    el.addEventListener("pointerdown", function () {
      pressTimer = setTimeout(onLongPress, SLOT_LONG_PRESS_MS);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (evt) {
      el.addEventListener(evt, function () {
        clearTimeout(pressTimer);
      });
    });
  }

  // 「敵人傷害」ボックスの削除UI：1回クリックすると右上に×ボタンが3秒間だけ現れ、その間に
  // ×を押せば削除、押さなければ自動的に隠れる（長押し＋確認ダイアログの旧仕様から変更）。
  var ENEMY_DAMAGE_CLOSE_REVEAL_MS = 3000;
  function attachClickToRevealClose(el, onRemove) {
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "action-log-close action-log-close-enemy-damage";
    closeBtn.textContent = "×";
    closeBtn.hidden = true;
    var hideTimer = null;
    el.addEventListener("click", function (e) {
      if (e.target === closeBtn) return;
      closeBtn.hidden = false;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        closeBtn.hidden = true;
      }, ENEMY_DAMAGE_CLOSE_REVEAL_MS);
    });
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (hideTimer) clearTimeout(hideTimer);
      onRemove();
    });
    el.appendChild(closeBtn);
  }

  // --- 戦闘モーダル：骰子池の隣の「戦闘」ボタンから開く、6つの行動（攻撃／技能／聖杯瓶使用／
  // 消耗品使用／移動区域／装備変更）を選ぶウィンドウ。骰子決済を伴う行動は、確定時にaddActionBoxで
  // 盤面ロスターへ実行ログを記録する。
  var combatModalCharacterId = null;
  var combatModalAction = null;
  var combatDiceSelection = [];

  function combatCharacter() {
    return rosterCharacters.filter(function (c) {
      return c.id === combatModalCharacterId;
    })[0] || null;
  }

  function openCombatModal(characterId) {
    combatModalCharacterId = characterId;
    combatModalAction = null;
    combatDiceSelection = [];
    var modal = document.getElementById("combat-modal");
    modal.hidden = false;
    // 開くたびに毎回フル表示から始める（縮小状態は一時的なUI設定のため保存しない）。
    modal.classList.remove("minimized");
    renderCombatModalMinimizeButton();
    renderCombatModal();
  }

  // 戦闘弾窗を隅の小さいウィンドウへ縮小/復元する。縮小中は背景が透過・クリック透過になり、
  // 後ろの戦場面板（キャラロースター等）を他の人が見たり操作したりできる。
  function renderCombatModalMinimizeButton() {
    var modal = document.getElementById("combat-modal");
    var btn = document.getElementById("btn-combat-modal-minimize");
    if (!modal || !btn) return;
    var isMinimized = modal.classList.contains("minimized");
    btn.textContent = isMinimized ? "\u{1F5D6}" : "\u{1F5D5}";
    btn.title = window.I18N.t(isMinimized ? "combat_modal_restore_button" : "combat_modal_minimize_button");
  }

  function handleCombatModalMinimizeToggle() {
    var modal = document.getElementById("combat-modal");
    if (!modal) return;
    modal.classList.toggle("minimized");
    renderCombatModalMinimizeButton();
  }

  function closeCombatModal() {
    document.getElementById("combat-modal").hidden = true;
    combatModalCharacterId = null;
    combatModalAction = null;
    combatDiceSelection = [];
    combatSpecialAttackState = null;
  }

  function showCombatError(key, params) {
    var errEl = document.getElementById("combat-modal-error");
    errEl.textContent = window.I18N.t(key, params);
    errEl.hidden = false;
  }

  // 攻撃action中「どの武器のどちらのHitを実行しようとしているか」の一時状態。
  // アクションを閉じる／別のアクションに切り替えるたびにnullへ戻す。
  var combatAttackState = null; // { weaponId, hitType: "hit1"|"hit2" } | null
  // R2 遺物効果「2Hit攻擊的達人（武器種類）」：通常の2Hitコストの代わりにこの遺物効果の
  // 固定コストを使うかどうかのトグル。武器／Hit種別を切り替えるたびfalseへ戻す。
  var twoHitMasteryToggle = false;
  // 攻撃actionで属性/異常蓄積の記録先とする、選択中の敵人のキー。選択肢が変わるたびに
  // 有効な値へ補正する（既定は先頭の敵人）。
  var combatAttackTargetEnemyKey = null;
  // 復仇者「靈體傷害」：總合傷害（敵人）／復歸傷害（PC）のどちらを選ぼうとしているかの中間状態
  // （執行者「咆哮」と同じ二択パターン）。骰子を消費しない専用行動のため、攻擊清單の武器欄と
  // 同じ場所に追加し、行動階段が切り替わるたびに1回だけ使用可能にする。
  var spiritDamageChoice = null; // "enemy" | "pc" | null

  // R3：遺物効果「跳躍攻擊／衝刺攻擊／蓄力攻擊」を選択中の一時状態（{kind, weaponId} | null）。
  // 通常のcombatAttackStateとは別枠にする（同時に両方選択された状態にはならない前提で
  // 切り替え時に互いをnullへ戻す）。
  var combatSpecialAttackState = null;

  // 靈體資料（character_types.jsの召喚靈體スキル本文記載値、ユーザー確認済み）:
  // 海倫：發生傷害 15+（PC等級×5）／弗雷德里克：5+▲+（PC等級×5）／賽巴斯汀：10+（PC等級×5）。
  function computeSpiritSummonDamage(c) {
    if (!c.spiritSummon) return null;
    var level = c.level || 1;
    var result;
    if (c.spiritSummon === "helen") result = { value: 15 + level * 5, symbol: null };
    else if (c.spiritSummon === "frederick") result = { value: 5 + level * 5, symbol: "▲" };
    else if (c.spiritSummon === "sebastian") result = { value: 10 + level * 5, symbol: null };
    else return null;
    // 遺物効果「家族強化」：自身召喚の「靈體」產生的傷害+10。
    if (CharacterDrawer.findLearnedRelicEffectByName(c, ["家族強化", "ファミリー強化"])) {
      result.value += 10;
    }
    return result;
  }

  function renderCombatAttackAction(c, content) {
    // 執行者「坩堝諸相・獸」：發動中は武器・盾・杖・聖印が使用不可になり、固定の襲擊／咆哮
    // アクション（renderCombatSkillActionのentriesに合成entryとして注入）に置き換わる。
    if (c._crucibleBeastActive) {
      var beastNote = document.createElement("p");
      beastNote.className = "threat-ref-body";
      beastNote.textContent = window.I18N.t("crucible_beast_no_weapon_note");
      content.appendChild(beastNote);
      return;
    }
    var Weapons = window.PriTestWeapons;
    var equippedIds = (c.equippedWeaponIds || []).filter(function (id) {
      // 盾は元々除外していたが、杖・聖印（1Hit/2Hitの概念を持たない武器種）はcomputeWeaponDamage
      // がnullを返すことを判定基準にして同様に除外する（通常攻撃を行えない武器種のため）。
      return CharacterDrawer.computeWeaponDamage(c, id) !== null;
    });
    if (!equippedIds.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("combat_no_weapons_note");
      content.appendChild(empty);
    }

    equippedIds.forEach(function (weaponId) {
      var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
      var weapon = Weapons.get(baseId);
      var category = Weapons.getCategory(weapon.category);
      var damage = CharacterDrawer.computeWeaponDamage(c, weaponId);
      var attackCost = CharacterDrawer.parseAttackCost(Weapons.localizedText(category.basicStats.attackCost));
      // 通常攻撃（1Hit/2Hit）の隊列制限は、個別技能のようなテキスト記述を持たないため、
      // 武器カテゴリの近距離／遠距離区分から判定する。遠距離武器（弓・大弓・クロスボウ・
      // バリスタ、category.isRanged）は前衛・後衛どちらでも使用可能、それ以外の近距離武器は
      // 前衛でのみ使用可能（ユーザー確認済みのルール）。
      var posRestriction = category.isRanged ? null : "front";
      var charPos = getCharacterBattlePosition(c);
      var posOk = !posRestriction || posRestriction === charPos;

      var row = document.createElement("div");
      row.className = "combat-attack-weapon-row";
      var nameEl = document.createElement("button");
      nameEl.type = "button";
      nameEl.className = "combat-attack-weapon-name roster-weapon-name-btn";
      nameEl.textContent = Weapons.localizedText(weapon.name);
      nameEl.addEventListener("click", function () {
        CharacterDrawer.openWeaponDetailDrawer(c.id, weaponId);
      });
      row.appendChild(nameEl);
      if (damage) {
        var dmgTag = document.createElement("span");
        dmgTag.className = "weapon-damage-tag";
        // 角色詳細の武器欄と同じく、武器が持つ屬性/狀態異常蓄積スキルも黃字タグに併記する
        // （戦闘中の攻撃選択プレビューにだけ表示が抜けていたのを、既存の武器欄と揃える）。
        dmgTag.textContent = " " + CharacterDrawer.weaponDamageTagText(damage, CharacterDrawer.weaponAccumulationEffects(c, weaponId));
        row.appendChild(dmgTag);
      }
      if (posRestriction) {
        var posEl = document.createElement("span");
        posEl.className = "ability-uses-label";
        posEl.textContent = window.I18N.t("combat_skill_position_label", {
          position: window.I18N.t(posRestriction === "front" ? "dice_status_front" : "dice_status_back"),
        });
        row.appendChild(posEl);
      }

      // クロスボウ／バリスタ等、2Hitの概念を持たない武器種はdamage.hit2Damageがnullになる
      // （CharacterDrawer.computeWeaponDamage参照）ため、2Hitボタン自体を出さない。
      var hitTypes = damage && damage.hit2Damage === null ? ["hit1"] : ["hit1", "hit2"];
      hitTypes.forEach(function (hitType) {
        var hitBtn = document.createElement("button");
        hitBtn.type = "button";
        hitBtn.className = "combat-attack-hit-btn";
        hitBtn.textContent = window.I18N.t(hitType === "hit1" ? "combat_attack_hit1_button" : "combat_attack_hit2_button");
        var isActive = combatAttackState && combatAttackState.weaponId === weaponId && combatAttackState.hitType === hitType;
        if (isActive) hitBtn.classList.add("active");
        if (!posOk) hitBtn.disabled = true;
        hitBtn.addEventListener("click", function () {
          combatAttackState = isActive ? null : { weaponId: weaponId, hitType: hitType };
          combatSpecialAttackState = null;
          combatDiceSelection = [];
          twoHitMasteryToggle = false;
          renderCombatModal();
        });
        row.appendChild(hitBtn);
      });
      content.appendChild(row);

      if (combatAttackState && combatAttackState.weaponId === weaponId) {
        var hitType = combatAttackState.hitType;
        var cost = attackCost ? attackCost[hitType] : null;
        // R2 遺物効果「2Hit攻擊的達人（武器種類）」：カテゴリ名が一致し、本フェイズまだ発揮
        // していなければ、GMの選択で通常コストの代わりにこの固定コストを使える。
        var masteryOverride = hitType === "hit2" ? CharacterDrawer.findTwoHitMasteryOverride(c, category) : null;
        var masteryAvailable = masteryOverride && !c._twoHitMasteryUsedThisPhase;
        if (masteryAvailable) {
          var masteryRow = document.createElement("div");
          masteryRow.className = "wb-row";
          var masteryBtn = document.createElement("button");
          masteryBtn.type = "button";
          masteryBtn.textContent = window.I18N.t("combat_two_hit_mastery_toggle_label", { value: masteryOverride.value });
          if (twoHitMasteryToggle) masteryBtn.classList.add("active");
          masteryBtn.addEventListener("click", function () {
            twoHitMasteryToggle = !twoHitMasteryToggle;
            renderCombatModal();
          });
          masteryRow.appendChild(masteryBtn);
          content.appendChild(masteryRow);
        } else {
          twoHitMasteryToggle = false;
        }
        var useMastery = masteryAvailable && twoHitMasteryToggle;
        if (useMastery) {
          cost = { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: masteryOverride.value, fpCost: 0, hpCost: 0 };
        }
        // 属性/異常蓄積を「選択中のどの敵人へ」記録するか。複数選択されている場合のみ選ばせる
        // （1体だけならそれへ、0体なら記録しようがないのでUIごと出さない）。
        var enemyOptions = resolveSelectedEnemyOptions();
        if (enemyOptions.length) {
          if (!enemyOptions.some(function (opt) { return opt.key === combatAttackTargetEnemyKey; })) {
            combatAttackTargetEnemyKey = enemyOptions[0].key;
          }
          if (enemyOptions.length > 1) {
            var targetRow = document.createElement("div");
            targetRow.className = "combat-attack-target-row";
            var targetLabel = document.createElement("label");
            targetLabel.textContent = window.I18N.t("combat_attack_target_enemy_label");
            var targetSelect = document.createElement("select");
            enemyOptions.forEach(function (opt) {
              var o = document.createElement("option");
              o.value = opt.key;
              o.textContent = opt.name;
              if (opt.key === combatAttackTargetEnemyKey) o.selected = true;
              targetSelect.appendChild(o);
            });
            targetSelect.addEventListener("change", function () {
              combatAttackTargetEnemyKey = targetSelect.value;
            });
            targetLabel.appendChild(targetSelect);
            targetRow.appendChild(targetLabel);
            content.appendChild(targetRow);
          }
        }
        renderDiceCostAction(c, content, cost, function (dice, costLines) {
          // R1続き：連續攻擊系の遺物効果（体力骰消費数を条件にするもの）は、ダメージ計算前に
          // 先に消費数を積み上げてから判定する（この攻擊自体が閾値に新規到達した場合、その分の
          // ボーナスもこの攻擊のdmgValueへ載せるため）。
          recordAttackDiceConsumed(c, dice.length);
          maybeApplyFpRecoveryOnAttack(c);
          maybeApplyHpRecoveryOnAttack(c);
          maybeOfferStaminaRecoveryOnAttack(c);
          var songHitBonus = songOfBloodSpiritHitBonus();
          var unyieldingBonus = unyieldingHitBonus(c);
          var finaleHitBonus = finaleAttackBuffBonus(c);
          var ominousHitBonus = ominousStrikeHitBonus(c);
          var heroMeatBonus = heroMeatHitBonus(c);
          var masteryBonus = hitAttackMasteryBonus(c, hitType, weapon, category);
          var consecutiveBonus = consecutiveAttackDamageBonus(c);
          var dmgValue =
            (hitType === "hit1" ? damage.hit1Damage : damage.hit2Damage) +
            (hitType === "hit1" ? songHitBonus.hit1 : songHitBonus.hit2) +
            (hitType === "hit1" ? unyieldingBonus.hit1 : unyieldingBonus.hit2) +
            (hitType === "hit1" ? finaleHitBonus.hit1 : finaleHitBonus.hit2) +
            (hitType === "hit1" ? ominousHitBonus.hit1 : ominousHitBonus.hit2) +
            (hitType === "hit1" ? heroMeatBonus.hit1 : heroMeatBonus.hit2) +
            masteryBonus +
            consecutiveBonus;
          var dmgSymbol = hitType === "hit1" ? damage.hit1Symbol : damage.hit2Symbol;
          recordPhaseDamageDealt(c, dmgValue, dmgSymbol);
          var lines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
          // 淑女「短劍重演」：短劍で1つのフェイズ中に2Hitアタックを2回行った瞬間（■は数値未確定の
          // ためGM手動反映、注記のみ残す）。
          // 復仇者／復仇者（暗影）「2Hit攻擊的達人（復仇者的咒爪）」：使用武器「復仇者的咒爪」
          // （fist_vengeful）的2Hit攻擊時，2Hit特典中額外獲得「復歸傷害：+10」。復歸傷害本身在本
          // App一律由GM手動反映（無單一目標PC追蹤機制），因此僅在此處補上提醒注記。
          if (hitType === "hit2" && weapon.id === "fist_vengeful") {
            var vengefulClawMastery = CharacterDrawer.findLearnedRelicEffectByName(c, [
              "2Hit攻擊的達人（復仇者的咒爪）",
              "2Hitアタックの達人（復讐者の呪爪）",
            ]);
            if (vengefulClawMastery) lines.push(window.I18N.t("vengeful_claw_two_hit_revival_bonus_note"));
          }
          if (hitType === "hit2" && category.id === "dagger") {
            c._daggerTwoHitCountThisPhase = (c._daggerTwoHitCountThisPhase || 0) + 1;
            if (c._daggerTwoHitCountThisPhase === 2) {
              var shortswordRestage = CharacterDrawer.findLearnedRelicEffectByName(c, ["短劍重演", "短剣リステージ"]);
              if (shortswordRestage) {
                lines.push(CharacterTypes.localizedText(shortswordRestage.body));
              }
            }
          }
          if (useMastery) {
            c._twoHitMasteryUsedThisPhase = true;
            lines.push(window.I18N.t("action_log_two_hit_mastery_used", { value: masteryOverride.value }));
          }
          twoHitMasteryToggle = false;
          // 一部の武器カテゴリ（槍・刺剣＝1、大槍・重刺剣＝2、斧槍＝3）は、2Hitアタック後に
          // 固定点数のダイスをスタミナダイス（骰子池）へ追加する特典を持つ。
          if (hitType === "hit2") {
            var diceBonus = CharacterDrawer.categoryTwoHitDiceBonus(category);
            if (diceBonus > 0) {
              if (!c.dicePool) c.dicePool = [];
              c.dicePool.push(diceBonus);
              lines.push(window.I18N.t("action_log_dice_granted", { value: diceBonus }));
            }
          }
          // 武器が持つ属性／状態異常スキルによる蓄積値（1Hit：+1／2Hit：+2、毒蠍系タリスマンで
          // さらに+1）を実行ログに明記し、選択中の敵人1体へ屬性/異常面板の「与えた」欄として
          // 積み上げる（敵人が選択されていない場合は記録しようがないのでログのみ）。
          var accumEffects = CharacterDrawer.weaponAccumulationEffects(c, weaponId);
          var baseAccum = hitType === "hit1" ? 1 : 2;
          accumEffects.forEach(function (eff) {
            var value = baseAccum + eff.scorpionBonus;
            lines.push(
              window.I18N.t(eff.isElement ? "action_log_element_accum" : "action_log_status_accum", {
                label: eff.label,
                value: value,
              })
            );
            recordAttributeStatusDealt(c.id, combatAttackTargetEnemyKey, eff.label, value);
          });
          // 特効（kind:"special"）は対象エネミーの種別に依存するため自動加算はせず、
          // 参考情報として本文を注記するのみに留める（過大なダメージ捏造を避けるため）。
          CharacterDrawer.weaponSpecialEffectNotes(weaponId).forEach(function (note) {
            lines.push(window.I18N.t("action_log_special_note", { note: note }));
            // 自動化GM 戰鬥自動化：進度版に出す「本回合行動說明」の效果欄用に、フェイズ単位で
            // 別途保持する（phase reset時にクリア）。
            if (!c._phaseSpecialNotes) c._phaseSpecialNotes = [];
            c._phaseSpecialNotes.push(note);
          });
          addActionBox(
            c,
            Weapons.localizedText(weapon.name) + "（" + window.I18N.t(hitType === "hit1" ? "combat_attack_hit1_button" : "combat_attack_hit2_button") + "）",
            window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(dmgValue, dmgSymbol) }),
            lines
          );
          addLog("log_combat_attack", {
            character: c.name,
            weapon: Weapons.localizedText(weapon.name),
            hit: window.I18N.t(hitType === "hit1" ? "combat_attack_hit1_button" : "combat_attack_hit2_button"),
            damage: CharacterDrawer.formatValueWithSymbol(dmgValue, dmgSymbol),
            dice: dice.join("、"),
          });
          renderAttributeStatusList();
          combatAttackState = null;
        });
      }
    });

    renderCombatSpecialAttackActions(c, content, equippedIds);

    // 復仇者「召喚靈體」：靈體傷害は規則書上、行動階段・特殊階段ごとに自動で1回発生するもの
    // なので、骰子を消費しない専用行動として攻擊清單に追加する（ユーザー確認済み）。
    var spiritDamage = computeSpiritSummonDamage(c);
    if (spiritDamage) {
      var spiritRow = document.createElement("div");
      spiritRow.className = "combat-attack-weapon-row";
      var spiritNameEl = document.createElement("span");
      spiritNameEl.className = "combat-attack-weapon-name";
      spiritNameEl.textContent = window.I18N.t("spirit_summon_choice_" + c.spiritSummon + "_label");
      spiritRow.appendChild(spiritNameEl);
      var spiritDmgTag = document.createElement("span");
      spiritDmgTag.className = "weapon-damage-tag";
      spiritDmgTag.textContent = " " + CharacterDrawer.formatValueWithSymbol(spiritDamage.value, spiritDamage.symbol);
      spiritRow.appendChild(spiritDmgTag);
      content.appendChild(spiritRow);

      if (c._spiritDamageUsedThisPhase) {
        var spiritUsedNote = document.createElement("p");
        spiritUsedNote.className = "threat-ref-body";
        spiritUsedNote.textContent = window.I18N.t("spirit_damage_used_this_phase_note");
        content.appendChild(spiritUsedNote);
      } else {
        var spiritChoiceRow = document.createElement("div");
        spiritChoiceRow.className = "wb-row";
        [
          { key: "enemy", label: window.I18N.t("spirit_damage_choice_enemy_label") },
          { key: "pc", label: window.I18N.t("spirit_damage_choice_pc_label") },
        ].forEach(function (opt) {
          var spiritChoiceBtn = document.createElement("button");
          spiritChoiceBtn.type = "button";
          spiritChoiceBtn.textContent = opt.label;
          if (spiritDamageChoice === opt.key) spiritChoiceBtn.classList.add("active");
          spiritChoiceBtn.addEventListener("click", function () {
            spiritDamageChoice = spiritDamageChoice === opt.key ? null : opt.key;
            renderCombatModal();
          });
          spiritChoiceRow.appendChild(spiritChoiceBtn);
        });
        content.appendChild(spiritChoiceRow);

        var spiritTargetSelect = null;
        if (spiritDamageChoice === "pc") {
          var enteredForSpirit = rosterCharacters.filter(function (rc) {
            return rc.entered;
          });
          spiritTargetSelect = document.createElement("select");
          enteredForSpirit.forEach(function (rc) {
            var o = document.createElement("option");
            o.value = rc.id;
            o.textContent = rc.name;
            spiritTargetSelect.appendChild(o);
          });
          content.appendChild(spiritTargetSelect);
        }

        if (spiritDamageChoice) {
          var spiritConfirmBtn = document.createElement("button");
          spiritConfirmBtn.type = "button";
          spiritConfirmBtn.className = "primary-btn";
          spiritConfirmBtn.textContent = window.I18N.t("combat_confirm_button");
          spiritConfirmBtn.addEventListener("click", function () {
            var spiritName = window.I18N.t("spirit_summon_choice_" + c.spiritSummon + "_label");
            var valueText = CharacterDrawer.formatValueWithSymbol(spiritDamage.value, spiritDamage.symbol);
            var targetChar =
              spiritDamageChoice === "pc" && spiritTargetSelect
                ? rosterCharacters.filter(function (rc) {
                    return rc.id === spiritTargetSelect.value;
                  })[0]
                : null;
            c._spiritDamageUsedThisPhase = true;
            if (spiritDamageChoice === "enemy") recordPhaseDamageDealt(c, spiritDamage.value, spiritDamage.symbol);
            saveRosterCharacters();
            addActionBox(
              c,
              window.I18N.t("spirit_damage_action_title", { name: spiritName }),
              spiritDamageChoice === "pc"
                ? window.I18N.t("spirit_damage_pc_target_total", { value: valueText, target: targetChar ? targetChar.name : "" })
                : window.I18N.t("action_log_damage_total", { value: valueText }),
              []
            );
            addLog("log_spirit_damage_use", {
              character: c.name,
              spirit: spiritName,
              choice: window.I18N.t(spiritDamageChoice === "pc" ? "spirit_damage_choice_pc_label" : "spirit_damage_choice_enemy_label"),
              target: targetChar ? "（" + targetChar.name + "）" : "",
            });
            spiritDamageChoice = null;
            renderCharacterRoster();
            renderCombatModal();
          });
          content.appendChild(spiritConfirmBtn);
        }
      }
    }
  }

  // moveOminousStrikeToFrontと同型の汎用版：どの遺物効果／スキルからでも「自身を前衛へ
  // 移動する」処理を呼べるようにする（setTimeout(0)で戦闘modalの再描画競合を避ける）。
  function moveCharacterToFrontArea(c) {
    // 附帶効果「疾跑時發生火焰」：後衛→前衛の移動action発動時、對敵人「火+1」（行動階段中1回のみ）。
    if (!c._sprintFireUsedThisPhase && (c.learnedAttachedEffects || []).indexOf("sprint_fire") !== -1) {
      c._sprintFireUsedThisPhase = true;
      addLog("log_sprint_fire_trigger", { character: c.name });
    }
    setTimeout(function () {
      var idx = battlePositionNames().indexOf(c.name);
      if (idx !== -1 && idx < BATTLE_SLOT_COUNT) {
        state.battle.front[idx] = true;
        state.battle.back[idx] = false;
        saveState();
        renderBattlePositionAreas();
        renderCombatModal();
      }
    }, 0);
  }

  // R3：遺物効果「跳躍攻擊／衝刺攻擊／蓄力攻擊／致命一擊」。いずれも近接武器を使う攻擊の
  // 変則版で、CharacterDrawer.findLearnedActionRelicByNameで習得済みかどうかを判定し、習得
  // している場合だけ攻擊清單に追加する（未習得の一般キャラには表示しない）。
  function renderCombatSpecialAttackActions(c, content, equippedIds) {
    var Weapons = window.PriTestWeapons;
    var meleeWeaponIds = equippedIds.filter(function (weaponId) {
      var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
      var weapon = Weapons.get(baseId);
      var category = weapon ? Weapons.getCategory(weapon.category) : null;
      return category && !category.isRanged;
    });
    var charPos = getCharacterBattlePosition(c);

    var jumpEffect = CharacterDrawer.findLearnedActionRelicByName(c, ["跳躍攻擊", "ジャンプ攻撃"]);
    if (jumpEffect && charPos === "front") {
      // 附帶効果「跳躍攻擊強化」：+10（固定・条件記載無し）。
      var jumpAtkUpBonus = (c.learnedAttachedEffects || []).indexOf("jump_atk_up") !== -1 ? 10 : 0;
      meleeWeaponIds.forEach(function (weaponId) {
        renderSpecialAttackWeaponRow(c, content, weaponId, "jump", jumpEffect, function (damage) {
          return { value: damage.hit1Damage + damage.artPower + jumpAtkUpBonus, symbol: damage.hit1Symbol };
        });
      });
    }

    var dashEffect = CharacterDrawer.findLearnedActionRelicByName(c, ["衝刺攻擊", "ダッシュ攻撃"]);
    if (dashEffect && charPos === "back") {
      // 附帶効果「衝刺攻擊強化」：+10（固定・条件記載無し）。
      var dashAtkUpBonus = (c.learnedAttachedEffects || []).indexOf("dash_atk_up") !== -1 ? 10 : 0;
      // 送葬人（黎明）獨有「＞習得此技能2個以上時・造成的傷害「+15」」（base undertakerには無い
      // 追加條款）。countLearnedActionRelicsByNameで実際の習得数を数える。
      var dashMultiBonus = CharacterDrawer.countLearnedActionRelicsByName(c, ["衝刺攻擊", "ダッシュ攻撃"]) >= 2 ? 15 : 0;
      meleeWeaponIds.forEach(function (weaponId) {
        renderSpecialAttackWeaponRow(
          c,
          content,
          weaponId,
          "dash",
          dashEffect,
          function (damage, weapon, category) {
            var isGreatSpear = category && category.id === "great_spear";
            return { value: damage.hit1Damage + (isGreatSpear ? damage.artPower : 0) + dashAtkUpBonus + dashMultiBonus, symbol: damage.hit1Symbol };
          },
          function () {
            moveCharacterToFrontArea(c);
          }
        );
      });
    }

    var chargeEffect = CharacterDrawer.findLearnedActionRelicByName(c, ["蓄力攻擊", "タメ攻撃"]);
    if (chargeEffect && charPos === "front") {
      // 「＞習得此技能2個以上時・造成的傷害「+10」」：countLearnedActionRelicsByNameで実際に
      // 習得している「蓄力攻擊」の個数（同名のAction効果を複数選択できるrelicEffectGroups）を数え、
      // 2個以上なら追加+10（基本+10と合わせて計+20）する。
      var chargeMultiBonus = CharacterDrawer.countLearnedActionRelicsByName(c, ["蓄力攻擊", "タメ攻撃"]) >= 2 ? 10 : 0;
      meleeWeaponIds.forEach(function (weaponId) {
        renderSpecialAttackWeaponRow(
          c,
          content,
          weaponId,
          "charge",
          chargeEffect,
          function (damage) {
            return { value: damage.hit1Damage + 10 + chargeMultiBonus, symbol: damage.hit1Symbol };
          },
          null,
          function (category) {
            var attackCost = CharacterDrawer.parseAttackCost(Weapons.localizedText(category.basicStats.attackCost));
            var hit1Cost = attackCost ? attackCost.hit1 : null;
            if (hit1Cost && hit1Cost.diceKind === "sum") {
              return { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: hit1Cost.sumTotal + 1, fpCost: 0, hpCost: 0 };
            }
            return hit1Cost || { diceKind: null, diceCountMin: 0, diceCountMax: null, sumTotal: null, fpCost: 0, hpCost: 0 };
          }
        );
      });
    }

    var fatalEffect = CharacterDrawer.findLearnedActionRelicByName(c, ["致命一擊", "致命の一撃"]);
    if (fatalEffect && charPos === "front" && meleeWeaponIds.length) {
      renderFatalStrikeAction(c, content, fatalEffect);
    }
  }

  // 跳躍攻擊／衝刺攻擊／蓄力攻擊：武器1つにつき1行（名前・想定ダメージ・ボタン）を描画し、
  // ボタンを押すと通常攻擊のhit1/hit2ボタンと同じ骰子選択→確定UI（renderDiceCostAction）を
  // 展開する。computeCostがnullなら遺物効果本文（①①など）をそのままparseActionCostする。
  function renderSpecialAttackWeaponRow(c, content, weaponId, kind, effect, computeDamage, onConfirmExtra, computeCost) {
    var Weapons = window.PriTestWeapons;
    var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
    var weapon = Weapons.get(baseId);
    var category = Weapons.getCategory(weapon.category);
    var damage = CharacterDrawer.computeWeaponDamage(c, weaponId);
    if (!damage) return;
    var result = computeDamage(damage, weapon, category);
    var labelKey = "combat_special_attack_" + kind + "_label";

    var row = document.createElement("div");
    row.className = "combat-attack-weapon-row";
    var nameEl = document.createElement("span");
    nameEl.className = "combat-attack-weapon-name";
    nameEl.textContent = Weapons.localizedText(weapon.name);
    row.appendChild(nameEl);
    var dmgTag = document.createElement("span");
    dmgTag.className = "weapon-damage-tag";
    dmgTag.textContent = " " + CharacterDrawer.formatValueWithSymbol(result.value, result.symbol);
    row.appendChild(dmgTag);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "combat-attack-hit-btn";
    btn.textContent = window.I18N.t(labelKey);
    var isActive =
      combatSpecialAttackState && combatSpecialAttackState.kind === kind && combatSpecialAttackState.weaponId === weaponId;
    if (isActive) btn.classList.add("active");
    btn.addEventListener("click", function () {
      combatSpecialAttackState = isActive ? null : { kind: kind, weaponId: weaponId };
      combatAttackState = null;
      combatDiceSelection = [];
      renderCombatModal();
    });
    row.appendChild(btn);
    content.appendChild(row);

    if (isActive) {
      var cost = computeCost ? computeCost(category) : CharacterDrawer.parseActionCost(effect.body && effect.body.zh);
      renderDiceCostAction(c, content, cost, function (dice, costLines) {
        var lines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
        if (onConfirmExtra) {
          onConfirmExtra();
          lines.push(window.I18N.t("combat_special_attack_move_to_front_note"));
        }
        var valueText = CharacterDrawer.formatValueWithSymbol(result.value, result.symbol);
        recordPhaseDamageDealt(c, result.value, result.symbol);
        addActionBox(c, Weapons.localizedText(weapon.name) + "（" + window.I18N.t(labelKey) + "）", window.I18N.t("action_log_damage_total", { value: valueText }), lines);
        addLog("log_combat_special_attack", {
          character: c.name,
          weapon: Weapons.localizedText(weapon.name),
          action: window.I18N.t(labelKey),
          damage: valueText,
          dice: dice.join("、"),
        });
        combatSpecialAttackState = null;
      });
    }
  }

  // 致命一擊：武器を問わず単一の行動（近戰武器を1つでも装備していれば使用可）。
  // コストは「豹子（3個）」だが額外階段中だけ「消耗：3」に変わる特殊仕様のため、
  // effect本文をそのまま解析せず、フェイズに応じてここで直接組み立てる。
  function renderFatalStrikeAction(c, content, effect) {
    var fixed = CharacterDrawer.fixedSkillPowerValue(effect.body && effect.body.zh);
    if (!fixed) return;
    // 附帶効果「致命一擊強化」：上限値+10（本アプリでは致命一擊の値は常に固定120のため、
    // 実質的にそのまま+10として加算する）。
    if ((c.learnedAttachedEffects || []).indexOf("crit_up") !== -1) {
      fixed = { value: fixed.value + 10, symbol: fixed.symbol };
    }
    // 淑女／淑女（黎明）「＞習得此技能2個時・造成的傷害「+20」」：致命一擊は同名のAction効果を
    // 2つまで習得できるため、countLearnedActionRelicsByNameで実際の習得数を数える。
    var fatalStrikeLearnedTwice = CharacterDrawer.countLearnedActionRelicsByName(c, ["致命一擊", "致命の一撃"]) >= 2;
    if (fatalStrikeLearnedTwice) {
      fixed = { value: fixed.value + 20, symbol: fixed.symbol };
    }
    var row = document.createElement("div");
    row.className = "combat-attack-weapon-row";
    var nameEl = document.createElement("span");
    nameEl.className = "combat-attack-weapon-name";
    nameEl.textContent = window.I18N.t("combat_special_attack_fatal_label");
    row.appendChild(nameEl);
    var dmgTag = document.createElement("span");
    dmgTag.className = "weapon-damage-tag";
    dmgTag.textContent = " " + CharacterDrawer.formatValueWithSymbol(fixed.value, fixed.symbol);
    row.appendChild(dmgTag);

    if (state.battle.fatalStrikeUsedThisRound) {
      var usedNote = document.createElement("span");
      usedNote.className = "ability-uses-label";
      usedNote.textContent = window.I18N.t("combat_fatal_strike_used_note");
      row.appendChild(usedNote);
      content.appendChild(row);
      return;
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "combat-attack-hit-btn";
    btn.textContent = window.I18N.t("combat_special_attack_fatal_label");
    var isActive = combatSpecialAttackState && combatSpecialAttackState.kind === "fatal";
    if (isActive) btn.classList.add("active");
    btn.addEventListener("click", function () {
      combatSpecialAttackState = isActive ? null : { kind: "fatal", weaponId: null };
      combatAttackState = null;
      combatDiceSelection = [];
      renderCombatModal();
    });
    row.appendChild(btn);
    content.appendChild(row);

    if (isActive) {
      var cost =
        state.actionPhase === "extra"
          ? { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: 3, fpCost: 0, hpCost: 0 }
          : CharacterDrawer.parseActionCost(effect.body && effect.body.zh);
      renderDiceCostAction(c, content, cost, function (dice, costLines) {
        var lines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
        var valueText = CharacterDrawer.formatValueWithSymbol(fixed.value, fixed.symbol);
        addActionBox(c, window.I18N.t("combat_special_attack_fatal_label"), window.I18N.t("action_log_damage_total", { value: valueText }), lines);
        addLog("log_combat_fatal_strike", { character: c.name, damage: valueText, dice: dice.join("、") });
        recordPhaseDamageDealt(c, fixed.value, fixed.symbol);
        // 「＞習得此技能2個時」の後半：此行動後，對自身施加「HP回復：□」與「FP回復：□」（各+1）。
        if (fatalStrikeLearnedTwice) {
          c.hp.current = Math.min(c.hp.max, c.hp.current + 1);
          if (c.fp) c.fp.current = Math.min(c.fp.max, c.fp.current + 1);
          lines.push(window.I18N.t("action_log_heal_total", { value: 1 }));
        }
        // 淑女「致命一擊獲得盧恩」：發動遺物効果「致命一擊」時、1次戰鬥中僅發揮1次、全體PC獲得盧恩1。
        if (!state.battle._fatalStrikeRuneGranted && CharacterDrawer.findLearnedRelicEffectByName(c, ["致命一擊獲得盧恩", "致命の一撃でルーン獲得"])) {
          state.battle._fatalStrikeRuneGranted = true;
          addLog("log_fatal_strike_rune_granted", { character: c.name });
        }
        state.battle.fatalStrikeUsedThisRound = true;
        saveState();
        combatSpecialAttackState = null;
      });
    }
  }

  // 技能action中「どの技能を使おうとしているか」の一時状態（entry.idまたは配列index）。
  var combatSkillState = null;

  // 技能entryの計算済み傷害を求める。装備武器の戦技（entry.weaponIdあり）はcomputeArtPower＋
  // artSkillPowerValue／spellSkillPowerValue（杖・聖印カテゴリのみ）で、タイプレベルの技能・
  // 遺物効果はfixedSkillPowerValue（本文に固定数値の総合ダメージが書かれている場合のみ）で
  // 求める。武器依存の記述など計算不能な場合はnullを返す（数値を捏造しない）。
  // 隱者「血魂之歌」：發動したフェイズの間だけ有効な全体バフ（1Hit:+5/2Hit:+10、戦技等+10）。
  // state.battle側のフラグのためcharacter_drawer.js側では判定できず、night.js内で武器アタック・
  // 技能ダメージそれぞれの算出直後に加算する（talismanFlatHitBonus等と同じ「HP/フラグ条件付き
  // 固定加算」の考え方だが、参照する状態がbattle側にあるため注入点をnight.js側に置く）。
  function songOfBloodSpiritHitBonus() {
    if (!state.battle._songOfBloodSpiritActive) return { hit1: 0, hit2: 0 };
    return { hit1: 5, hit2: 10 };
  }
  function songOfBloodSpiritSkillBonus() {
    return state.battle._songOfBloodSpiritActive ? 10 : 0;
  }

  // 執行者「不撓」：c._unyieldingStacks（自身が屬性/異常トリガーを受けるたびに戦闘終了まで
  // 積み上がる）に応じた実ダメージ加算。血魂之歌と同じ注入点にスタック数×固定値で加算する。
  function unyieldingHitBonus(c) {
    var stacks = c._unyieldingStacks || 0;
    return { hit1: stacks * 5, hit2: stacks * 10 };
  }
  function unyieldingSkillBonus(c) {
    return (c._unyieldingStacks || 0) * 10;
  }

  // 消耗品「勇者的肉塊」／「調香瓶｜高揚之香」：直到結束階段為止的攻擊/戰技傷害buff
  // （数値・ライフサイクルが同一のため共通化する）。c._heroMeatBuffLevelは1（等級1效果のみ）
  // または2（博聞強識等により等級2效果も発揮＝数値2倍）。
  function heroMeatHitBonus(c) {
    var level = c._heroMeatBuffLevel || 0;
    if (!level) return { hit1: 0, hit2: 0 };
    return level >= 2 ? { hit1: 10, hit2: 20 } : { hit1: 5, hit2: 10 };
  }
  function heroMeatSkillBonus(c) {
    var level = c._heroMeatBuffLevel || 0;
    if (!level) return 0;
    return level >= 2 ? 10 : 5;
  }

  // R1 遺物効果「技藝強化（攻擊力提升）」：淑女「終曲」使用時に発動する自身限定バフ
  // （血魂之歌と同じ数値・同じ「直到結束階段為止」ライフサイクルだが、battle全体ではなく
  // 発動した本人だけのフラグなのでcharacter側に持たせる）。
  function finaleAttackBuffBonus(c) {
    return c._finaleAttackBuffActive ? { hit1: 5, hit2: 10 } : { hit1: 0, hit2: 0 };
  }
  function finaleSkillBuffBonus(c) {
    return c._finaleAttackBuffActive ? 10 : 0;
  }

  // R1 遺物効果「技藝強化（攻擊力強化）」：送葬人「不祥一擊」使用時に発動する自身限定バフ
  // （finaleAttackBuffBonusと全く同じ数値・ライフサイクル）。
  function ominousStrikeHitBonus(c) {
    return c._ominousStrikeBuffActive ? { hit1: 5, hit2: 10 } : { hit1: 0, hit2: 0 };
  }
  function ominousStrikeSkillBonus(c) {
    return c._ominousStrikeBuffActive ? 10 : 0;
  }

  // R1 遺物効果「能力強化（魔術之地）」：隱者「元素操控」で屬性痕へ✓が入った直後から
  // 「直到階段結束為止」自身の魔術ダメージ+5（重複しない＝フラグはbooleanのみ）。
  function elementalControlMagicBonus(c, skillDamageKind) {
    return skillDamageKind === "sorcery" && c._elementalControlMagicBonusActive ? 5 : 0;
  }

  // 遺物効果「1Hit攻擊強化」「2Hit攻擊強化」：習得していれば毎回のHit種別に応じて固定加算する。
  // 1Hitは装備武器の威力補正が「力量」のときさらに+5（合計+10）。
  function hitAttackMasteryBonus(c, hitType, weapon, category) {
    if (hitType === "hit1") {
      if (!CharacterDrawer.findLearnedRelicEffectByName(c, ["1Hit攻擊強化", "1Hitアタック強化"])) return 0;
      var bonus = 5;
      var powerModText = weapon.powerModOverride
        ? window.PriTestWeapons.localizedText(weapon.powerModOverride)
        : window.PriTestWeapons.localizedText(category.basicStats.powerMod);
      if (CharacterDrawer.resolvePowerModStatKey(powerModText) === "strength") bonus += 5;
      return bonus;
    }
    if (hitType === "hit2") {
      return CharacterDrawer.findLearnedRelicEffectByName(c, ["2Hit攻擊強化", "2Hitアタック強化"]) ? 5 : 0;
    }
    return 0;
  }

  // 遺物効果「連續攻擊時體力回復」「連續攻擊時FP回復」「連續攻擊時，產生總合傷害」は、いずれも
  // 「1次行動階段中に因攻擊而消耗した體力骰の合計数」が条件になる。合計数のカウント自体は
  // ここで共通化し（攻擊action確定のたびrecordAttackDiceConsumedを呼ぶ）、各遺物効果の判定・
  // 適用はこのすぐ下の3関数で行う。フェイズ切替の都度リセットされる（setActionPhase参照）。
  function recordAttackDiceConsumed(c, count) {
    c._attackDiceConsumedThisPhase = (c._attackDiceConsumedThisPhase || 0) + count;
  }

  // 遺物効果「130傷害回復HP」「130傷害回復FP」：1つのフェイズ中に自身が単独で与えた總合傷害の
  // 累計が判定対象（他PCの分は含めない）。攻擊・特殊攻擊・技能などダメージが確定するたびに
  // ここで積み上げ、フェイズ終了時（setActionPhase）にまとめて判定する。
  // 自動化GM 戰鬥自動化：symbolは主傷害欄に含まれていた▲/◆（"▲"|"◆"|null|undefined）。
  // 使用者裁定（Guard削り値の自動計算）に基づき、主傷害欄の▲=0.5点／◆=1点をこの1回の
  // 攻撃行動が生んだGuard削り値として、既存のc._phaseDamageDealtと同じ「フェイズ単位で
  // 蓄積し、phase reset loopで0に戻す」ライフサイクルでc._phaseGuardReductionPointsへ加算する。
  function recordPhaseDamageDealt(c, value, symbol) {
    if (value) c._phaseDamageDealt = (c._phaseDamageDealt || 0) + value;
    if (symbol === "▲" || symbol === "◆") {
      c._phaseGuardReductionPoints = (c._phaseGuardReductionPoints || 0) + (symbol === "▲" ? 0.5 : 1);
      // 自動化GM 戰鬥自動化：進度版に出す「本回合行動說明」で▲/◆をそのまま表示するための
      // 記号の並び（例：▲▲◆）。数値の_phaseGuardReductionPointsとは別に、表示用に保持する。
      if (!c._phaseGuardSymbols) c._phaseGuardSymbols = [];
      c._phaseGuardSymbols.push(symbol);
    }
  }

  // 送葬人「連續攻擊時，產生總合傷害」：4/5/6/7個消費でそれぞれ+10/+20/+30/+40（段階的、
  // 加算し直しではなく到達した最高段階の値を使う）。新たに到達した段階の差分だけをその場の
  // 攻擊のダメージへ加算する。
  var CONSECUTIVE_ATTACK_DAMAGE_TIERS = [
    { count: 4, bonus: 10 },
    { count: 5, bonus: 20 },
    { count: 6, bonus: 30 },
    { count: 7, bonus: 40 },
  ];
  function consecutiveAttackDamageBonus(c) {
    if (!CharacterDrawer.findLearnedRelicEffectByName(c, ["連續攻擊時，產生總合傷害", "攻撃連続時、総合ダメージ発生"])) return 0;
    var count = c._attackDiceConsumedThisPhase || 0;
    var applicable = 0;
    CONSECUTIVE_ATTACK_DAMAGE_TIERS.forEach(function (t) {
      if (count >= t.count) applicable = t.bonus;
    });
    var delta = applicable - (c._consecutiveDamageBonusGranted || 0);
    if (delta > 0) c._consecutiveDamageBonusGranted = applicable;
    return delta > 0 ? delta : 0;
  }

  // 鐵眼／送葬人「連續攻擊時體力回復」：合計5個消費に達した瞬間（1フェイズ1回）、習得者に
  // 加護1個を支払うか確認し、支払えば體力骰+1（規則書の「加護消耗：■」はこのアプリの他の
  // 重骰コストと同じ「加護1個」に統一する）。
  function maybeOfferStaminaRecoveryOnAttack(c) {
    if ((c._attackDiceConsumedThisPhase || 0) < 5 || c._staminaRecoveryOfferedThisPhase) return;
    c._staminaRecoveryOfferedThisPhase = true;
    if (!CharacterDrawer.findLearnedRelicEffectByName(c, ["連續攻擊時體力回復", "攻撃連続時、スタミナ回復"])) return;
    if (!c.blessingSlots || c.blessingSlots.current <= 0) return;
    if (!window.confirm(window.I18N.t("consecutive_attack_stamina_confirm", { name: c.name }))) return;
    c.blessingSlots.current -= 1;
    if (!c.dicePool) c.dicePool = [];
    c.dicePool.push(1 + Math.floor(Math.random() * 6));
    addLog("log_consecutive_attack_stamina_recovery", { character: c.name });
  }

  // 淑女「連續攻擊時FP回復」：合計4個消費に達した瞬間（1フェイズ1回）、自動でFP回復+1。
  function maybeApplyFpRecoveryOnAttack(c) {
    if ((c._attackDiceConsumedThisPhase || 0) < 4 || c._fpRecoveryAppliedThisPhase) return;
    if (!CharacterDrawer.findLearnedRelicEffectByName(c, ["連續攻擊時FP回復", "攻撃連続時、FP回復"])) return;
    c._fpRecoveryAppliedThisPhase = true;
    c.fp.current = Math.min(c.fp.max, c.fp.current + 1);
    addLog("log_consecutive_attack_fp_recovery", { character: c.name });
  }

  // 淑女（黎明）「攻擊連續時，HP回復」：上のFP版と全く同じ発動条件（1次行動階段中に攻擊で
  // 4個體力骰を消費）を持つHP版。トリガー閾値・フェイズ単位のリセット（_hpRecoveryAppliedThisPhase）
  // ともFP版と同じ設計。
  function maybeApplyHpRecoveryOnAttack(c) {
    if ((c._attackDiceConsumedThisPhase || 0) < 4 || c._hpRecoveryAppliedThisPhase) return;
    if (!CharacterDrawer.findLearnedRelicEffectByName(c, ["攻擊連續時，HP回復", "攻撃連続時、HP回復"])) return;
    c._hpRecoveryAppliedThisPhase = true;
    c.hp.current = Math.min(c.hp.max, c.hp.current + 1);
    addLog("log_consecutive_attack_hp_recovery", { character: c.name });
  }

  function computeSkillDamage(c, entry, body) {
    var dmg;
    if (!entry.weaponId) {
      dmg = CharacterDrawer.fixedSkillPowerValue(body);
    } else {
      var Weapons = window.PriTestWeapons;
      var baseId = entry.weaponId.indexOf("::") !== -1 ? entry.weaponId.slice(0, entry.weaponId.indexOf("::")) : entry.weaponId;
      var weapon = Weapons.get(baseId);
      if (!weapon) return null;
      var category = Weapons.getCategory(weapon.category);
      var artInfo = CharacterDrawer.computeArtPower(c, entry.weaponId);
      if (!artInfo) return null;
      var skillDamageKind = category.id === "staff" ? "sorcery" : category.id === "sacred_seal" ? "incant" : "art";
      var isSpellCategory = skillDamageKind !== "art";
      dmg = isSpellCategory
        ? CharacterDrawer.spellSkillPowerValue(body, artInfo.artPower)
        : CharacterDrawer.artSkillPowerValue(body, artInfo.artPower);
    }
    // 使用者確認：踢擊／拒絕／貴種的腹藝／盾擊等、「威力：」「總合傷害：N」のような数値表記を
    // 持たず「▲」／「◆」という記号だけで効果が完結する技能への最終フォールバック（上のいずれの
    // 数値パーサーもnullを返した場合のみ、CharacterDrawer.bareGuardSymbolSkillValue参照）。
    if (!dmg) dmg = CharacterDrawer.bareGuardSymbolSkillValue(body);
    if (!dmg) return null;
    // 執行者「襲擊之楔」（assault_wedge）：本文「【總合傷害：100＋▲】與「▲」」は▲が2箇所
    // 独立して存在する（1つ目は上のfixedSkillPowerValueが総合ダメージの数値と一緒に捕捉済み、
    // 2つ目は正規表現の性質上1回のマッチでは拾えないため取りこぼされていた）。ここでのみ
    // 明示的に2つ目の▲を追加のGuard削り値として持たせる（他の技能で同様の複数記号が今後
    // 確認された場合も、汎用の「全部数える」処理は作らずここに個別追加する方針——1件しか
    // 確認されていない特殊記述を汎用ロジック化すると誤検出のリスクが上がるため）。
    var extraGuardSymbol = entry.id === "assault_wedge" && !entry.quickVariant && dmg.symbol === "▲" ? "▲" : null;
    // 基礎威力が実際に計算できた場合のみ、タリスマン起因の固定加算（戦技・魔術・祈祷向け）と
    // 無賴漢「鬥爭心」（現在HPが最大HPと異なる場合＋20）、附帶効果「戰技/魔術/祈禱傷害+5」を
    // 上乗せする（計算不能な場合にまで数値を捏造しないため）。
    var talismanBonus = CharacterDrawer.talismanFlatSkillBonus(c);
    var fightingSpiritBonus = CharacterDrawer.fightingSpiritFlatBonus(c);
    var songBonus = songOfBloodSpiritSkillBonus();
    var unyieldingBonus = unyieldingSkillBonus(c);
    var finaleBonus = finaleSkillBuffBonus(c);
    var ominousBonus = ominousStrikeSkillBonus(c);
    var heroMeatSkillBonusValue = heroMeatSkillBonus(c);
    var elementalControlBonus = elementalControlMagicBonus(c, skillDamageKind);
    var attachedSkillBonus = skillDamageKind ? CharacterDrawer.attachedSkillDamageBonus(c, skillDamageKind) : 0;
    // 執行者「妖刀（妖刀解放・攻）」：この遺物効果を2つ以上習得している場合、Action使用時の
    // ダメージに固定+25。
    var yotoReleaseBonus =
      entry.id === "yoto_release_action" && CharacterDrawer.countLearnedRelicEffectsByName(c, ["妖刀解放・攻"]) >= 2 ? 25 : 0;
    // 執行者（暗影）「妖刀（妖刀解放・癒）」：この遺物効果を2つ以上習得している場合、Action使用時の
    // ダメージに固定+50。
    var yotoReleaseHealBonus =
      entry.id === "yoto_release_heal_action" && CharacterDrawer.countLearnedRelicEffectsByName(c, ["妖刀解放・癒"]) >= 2 ? 50 : 0;
    // R1「技藝強化（燃燒）」：追蹤者「襲擊之楔」の対エネミーダメージに固定+50（「火：3D」は
    // 数値未確定のためログ注記のみ、呼び出し元でaddActionBoxのlinesに追加する）。
    var assaultWedgeBonus =
      entry.id === "assault_wedge" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（燃燒）", "アーツ強化（炎上）"]) ? 50 : 0;
    // R1「技藝強化（持續傷害）」：學者「共感術」が実際にエネミーへダメージを与える場合のみ+60
    // （この時点でdmgが存在する＝エネミーへの効果が計算できている、を「與敵人造成傷害」とみなす）。
    var empathyBonus =
      entry.id === "empathy" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（持續傷害）", "アーツ強化（継続ダメージ）"]) ? 60 : 0;
    // 鐵之眼「後衛戰術」：「當自身位於後衛時」，武器の戰技・魔術（skillDamageKindが"art"／
    // "sorcery"のときのみ＝武器戰技系entryに限る。祈禱は本文に含まれないため対象外）の傷害＋5。
    // 武器の1Hit/2Hit部分は既存relicEffectAppliesTo（character_drawer.js）で別途処理済み。
    var rearTacticsBonus =
      (skillDamageKind === "art" || skillDamageKind === "sorcery") &&
      getCharacterBattlePosition(c) === "back" &&
      CharacterDrawer.findLearnedRelicEffectByName(c, ["後衛戰術", "後衛戦術"])
        ? 5
        : 0;
    // 復仇者「家族共鬥」：「當自身召喚的『靈體』存在時」，戰技・魔術・祈禱（skillDamageKindが
    // "art"／"sorcery"／"incant"のいずれか＝武器戰技系entry）的傷害+10。武器の1Hit/2Hit部分は
    // relicEffectAppliesTo（character_drawer.js）で既に処理済み。
    var familyCoopBonus =
      !!skillDamageKind &&
      !!(c.spiritSummon && c.spiritSummonHp && c.spiritSummonHp[c.spiritSummon] && c.spiritSummonHp[c.spiritSummon].current > 0) &&
      CharacterDrawer.findLearnedRelicEffectByName(c, ["家族共鬥", "ファミリー共闘"])
        ? 10
        : 0;
    // 送葬人（黎明）「祈禱輔助強化火力提升」：「火力提升」狀態中（c._prayerFirepowerActive），
    // 戰技・魔術・祈禱（skillDamageKindが"art"／"sorcery"／"incant"のいずれか）的傷害+10。
    // 武器の1Hit/2Hit部分はrelicEffectAppliesTo（character_drawer.js）で処理済み。
    var prayerFirepowerBonus =
      !!skillDamageKind && c._prayerFirepowerActive && CharacterDrawer.findLearnedRelicEffectByName(c, ["祈禱輔助強化火力提升", "祈祷補助強化火力アップ"])
        ? 10
        : 0;
    var flatBonus =
      talismanBonus +
      fightingSpiritBonus +
      songBonus +
      unyieldingBonus +
      finaleBonus +
      ominousBonus +
      heroMeatSkillBonusValue +
      elementalControlBonus +
      attachedSkillBonus +
      yotoReleaseBonus +
      yotoReleaseHealBonus +
      assaultWedgeBonus +
      empathyBonus +
      rearTacticsBonus +
      familyCoopBonus +
      prayerFirepowerBonus;
    var result = flatBonus ? { value: dmg.value + flatBonus, symbol: dmg.symbol } : dmg;
    if (extraGuardSymbol) result.extraGuardSymbol = extraGuardSymbol;
    return result;
  }

  function renderCombatSkillAction(c, content) {
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var entries = (type ? CharacterDrawer.getCombatSkillEntries(c, type) : []).concat(CharacterDrawer.getEquippedWeaponSkillEntries(c));
    // 淑女「重演」：kind:"Passive"のため通常はgetCombatSkillEntriesのPassive除外に引っかかるが、
    // 実際は行動階段／特殊階段終了時に任意発動できる夜渡技能のため、IDで直接拾って戦闘スキル
    // 一覧に加える（鑑定眼と同じくskillタブは戦闘・額外どちらのフェイズでも共通表示のため、
    // 両フェイズで使用可能という要件をそのまま満たす）。
    var restageEntry = type
      ? (type.skills || []).filter(function (entry) {
          return entry.id === "restage";
        })[0]
      : null;
    if (restageEntry) entries = entries.concat([restageEntry]);
    // 執行者「坩堝諸相・獸」發動中は、武器攻撃の代わりに固定の襲擊／咆哮アクションが使える。
    if (c._crucibleBeastActive) entries = entries.concat(CRUCIBLE_BEAST_ACTIONS);
    // 隱者「混成魔法」の遺物効果（漩渦烈焰／聖幕／冷氣風暴／聖光燈火）：習得済みのものだけ、
    // 元の混成魔法とは別の選択肢として一覧に追加する（各々「屬性痕」消費なしの代替効果）。
    var baseTypeId = type ? type.id.replace(/_dark$|_dawn$/, "") : null;
    // 追跡者「技藝強化（速擊）」：習得していれば「襲擊之楔」を「速擊」でも使用できるようになる。
    if (baseTypeId === "tracker" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（速擊）", "アーツ強化（速撃）"])) {
      entries = entries.concat([TRACKER_ASSAULT_WEDGE_QUICK_ENTRY]);
    }
    if (baseTypeId === "hermit") {
      HERMIT_HYBRID_MAGIC_ACTION_VARIANTS.forEach(function (v) {
        if (CharacterDrawer.findLearnedRelicEffectByName(c, v.relicNames)) entries = entries.concat([v.entry]);
      });
      // 隱者（黎明）専用の混成魔法変化（橫掃雷擊／雷炎戰車／重力爆發）。relicNamesがhermit_dawn
      // 専用のため、base hermitでは常にfindLearnedRelicEffectByNameがnullを返し混在しない。
      HERMIT_DAWN_HYBRID_MAGIC_ACTION_VARIANTS.forEach(function (v) {
        if (CharacterDrawer.findLearnedRelicEffectByName(c, v.relicNames)) entries = entries.concat([v.entry]);
      });
    }
    // 執行者「妖刀解放・攻」：習得していれば「妖刀」をActionとしても使用できるようになる
    // （妖刀蓄積を1個消費、對敵人造成【總合傷害：50+▲】）。
    if (baseTypeId === "executor" && CharacterDrawer.findLearnedRelicEffectByName(c, ["妖刀解放・攻"])) {
      entries = entries.concat([EXECUTOR_YOTO_RELEASE_ACTION_ENTRY]);
    }
    // 執行者（暗影）「妖刀解放・癒」：習得していれば「妖刀」を別効果のActionとしても使用できる
    // ようになる（妖刀蓄積を2個消費、對敵人造成【總合傷害：100+◆】＋自身HP回復+5）。
    if (baseTypeId === "executor" && CharacterDrawer.findLearnedRelicEffectByName(c, ["妖刀解放・癒"])) {
      entries = entries.concat([EXECUTOR_YOTO_RELEASE_HEAL_ACTION_ENTRY]);
    }
    if (!entries.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("combat_no_skills_note");
      content.appendChild(empty);
      return;
    }

    var usesBonus = CharacterDrawer.getSkillUsesBonus(c);

    entries.forEach(function (entry, idx) {
      var key = entry.id || "entry" + idx;
      var name = CharacterTypes.localizedText(entry.name);
      var body = CharacterTypes.localizedText(entry.body);

      var row = document.createElement("div");
      row.className = "combat-skill-row";
      var nameDetails = document.createElement("details");
      nameDetails.className = "combat-skill-name-details";
      var nameSummary = document.createElement("summary");
      nameSummary.className = "combat-skill-name";
      nameSummary.textContent = name + "［" + entry.kind + "］" + (entry.weaponName ? "（" + entry.weaponName + "）" : "");
      nameDetails.appendChild(nameSummary);
      var bodyEl = document.createElement("p");
      bodyEl.className = "threat-ref-body";
      bodyEl.textContent = body;
      nameDetails.appendChild(bodyEl);
      row.appendChild(nameDetails);

      // 技能發動後は虛線框に紅字で最終傷害が記録されるが、選擇前のこの一覧にも同じ黃字タグで
      // 事前に威力を示す（武器の1Hit/2Hitと同じ視覚言語に揃える。計算不能な技能はタグ無し）。
      var skillDamagePreview = computeSkillDamage(c, entry, body);
      if (skillDamagePreview) {
        var skillDmgTag = document.createElement("span");
        skillDmgTag.className = "weapon-damage-tag";
        skillDmgTag.textContent = " " + CharacterDrawer.formatValueWithSymbol(skillDamagePreview.value, skillDamagePreview.symbol);
        row.appendChild(skillDmgTag);
      }

      var effectiveMax = entry.uses ? entry.uses + usesBonus : null;
      var remaining = effectiveMax !== null ? (typeof (c.abilityUses && c.abilityUses[entry.id]) === "number" ? c.abilityUses[entry.id] : effectiveMax) : null;
      if (effectiveMax !== null) {
        var usesEl = document.createElement("span");
        usesEl.className = "ability-uses-label";
        usesEl.textContent = window.I18N.t("action_log_uses_remaining", { current: remaining, max: effectiveMax });
        row.appendChild(usesEl);
      }

      // 「此技能於1回合內每名PC限用1次」系統の本文（踢擊・拒絕・黃金之怒・貴種的腹藝・盾擊等）：
      // 従来entry.usesが無いため無制限に使えてしまっていた（#6）。本文から自動検出し、
      // c._entryUsedThisTurnで1回合（新しい回合が始まるまで）ブロックする汎用機構。
      var isOncePerTurn = entry.id && CharacterDrawer.parseOncePerTurnRestriction(body);
      var onceUsedThisTurn = isOncePerTurn && !!(c._entryUsedThisTurn && c._entryUsedThisTurn[entry.id]);
      if (isOncePerTurn) {
        var onceEl = document.createElement("span");
        onceEl.className = "ability-uses-label";
        onceEl.textContent = window.I18N.t(onceUsedThisTurn ? "combat_skill_once_per_turn_used_label" : "combat_skill_once_per_turn_label");
        row.appendChild(onceEl);
      }

      var posRestriction = CharacterDrawer.parsePositionRestriction(body);
      var charPos = getCharacterBattlePosition(c);
      var posOk = !posRestriction || posRestriction === charPos;
      if (posRestriction) {
        var posEl = document.createElement("span");
        posEl.className = "ability-uses-label";
        posEl.textContent = window.I18N.t("combat_skill_position_label", {
          position: window.I18N.t(posRestriction === "front" ? "dice_status_front" : "dice_status_back"),
        });
        row.appendChild(posEl);
      }

      var useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "combat-attack-hit-btn";
      useBtn.textContent = window.I18N.t("combat_skill_use_button");
      // 守護者「旋風」は、使用回数（1日単位）とは別に「本フェイズにつき1回まで」の制限がある。
      // 執行者「妖刀（妖刀解放・攻）」のActionは、妖刀蓄積（c._yotoMarks）を1個消費するため、
      // 蓄積が無ければ使用不可。
      if (
        (effectiveMax !== null && remaining <= 0) ||
        !posOk ||
        onceUsedThisTurn ||
        (entry.id === "whirlwind" && c._whirlwindUsedThisPhase) ||
        (entry.id === "yoto_release_action" && (c._yotoMarks || 0) <= 0) ||
        (entry.id === "yoto_release_heal_action" && (c._yotoMarks || 0) < 2)
      )
        useBtn.disabled = true;
      var isActive = combatSkillState === key;
      if (isActive) useBtn.classList.add("active");
      useBtn.addEventListener("click", function () {
        combatSkillState = isActive ? null : key;
        combatDiceSelection = [];
        resetClawShotState();
        eyeForValueResult = null;
        restageConfirmedThisUse = null;
        spiritSummonChoice = null;
        hybridMagicElementChoice = null;
        elementalControlTargetKey = null;
        crucibleRoarChoice = null;
        inquiryChoice = null;
        renderCombatModal();
      });
      row.appendChild(useBtn);
      // 葬儀屋「力量感應」：他PCの技藝使用で貯まった無消耗使用権がある間、「不祥一擊」の行に
      // 専用ボタンを追加表示する。骰子コスト・使用回数どちらも消費しない即時確定（力量感應由来
      // の使用はtriggerPowerResonanceを呼ばない＝連鎖しない）。
      if (entry.id === "ominous_strike" && (c._powerResonanceCredits || 0) > 0) {
        var freeUseBtn = document.createElement("button");
        freeUseBtn.type = "button";
        freeUseBtn.className = "combat-attack-hit-btn";
        freeUseBtn.textContent = window.I18N.t("power_resonance_free_use_button", { credits: c._powerResonanceCredits });
        freeUseBtn.addEventListener("click", function () {
          c._powerResonanceCredits = Math.max(0, (c._powerResonanceCredits || 0) - 1);
          var dmg = computeSkillDamage(c, entry, body);
          if (dmg) recordPhaseDamageDealt(c, dmg.value, dmg.symbol);
          var total = dmg ? window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(dmg.value, dmg.symbol) }) : null;
          moveOminousStrikeToFront(c);
          addActionBox(c, name, total, [window.I18N.t("log_ominous_strike_move_note")]);
          addLog("log_ominous_strike_free_use", { character: c.name });
          combatSkillState = null;
          renderCombatModal();
        });
        row.appendChild(freeUseBtn);
      }
      content.appendChild(row);

      if (isActive && entry.id === "claw_shot") {
        renderClawShotAction(c, content, entry, name, body, function () {
          if (entry.uses && entry.id) {
            if (!c.abilityUses) c.abilityUses = {};
            c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
          }
        });
      } else if (isActive && entry.id === "eye_for_value") {
        // 鐵眼「鑑定眼」：対象の敵人を選び、確定時にその系統のガード回数／HP価値の参考表を
        // 展開表示する（GM専用情報をPC全員に公開する効果の再現）。renderDiceCostActionの
        // 確定ハンドラは処理後に必ずrenderCombatModal()で全体を再描画するため、確定結果
        // （どの敵人の表を開いたか）をモジュール変数に保持し、再描画後も表示を維持する。
        if (eyeForValueResult) {
          var resolvedFamily = eyeForValueResult.family;
          if (resolvedFamily && resolvedFamily.guardValueTable) {
            content.appendChild(window.PriTestNightRulebook.buildEnemyGuardValueTable(resolvedFamily));
          }
        } else {
          var enemyOptions = resolveSelectedEnemyOptions();
          if (!enemyOptions.length) {
            var noEnemyNote = document.createElement("p");
            noEnemyNote.className = "threat-ref-body";
            noEnemyNote.textContent = window.I18N.t("eye_for_value_no_enemy_note");
            content.appendChild(noEnemyNote);
          } else {
            var enemySelect = document.createElement("select");
            enemyOptions.forEach(function (opt) {
              var o = document.createElement("option");
              o.value = opt.key;
              o.textContent = opt.name;
              enemySelect.appendChild(o);
            });
            content.appendChild(enemySelect);
            var eyeCost = CharacterDrawer.parseActionCost(body);
            renderDiceCostAction(c, content, eyeCost, function (dice, costLines) {
              if (entry.uses && entry.id) {
                if (!c.abilityUses) c.abilityUses = {};
                c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
              }
              var familyId = enemySelect.value.split("|")[0];
              var Enemies = window.PriTestEnemies;
              var family = Enemies.listFamilies().filter(function (f) {
                return f.id === familyId;
              })[0];
              eyeForValueResult = { family: family };
              addActionBox(c, name, window.I18N.t("eye_for_value_revealed_note"), [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
              addLog("log_combat_skill_use", { character: c.name, skill: name, dice: dice.join("、") });
              renderCombatModal();
            });
          }
        }
      } else if (isActive && entry.id === "restage") {
        // 淑女「重演」：GMが最終的にHP損害量を算出するため、本アプリでは実際のダメージ量を
        // 追跡していない。代わりに「本階段で総合ダメージによりHP損害：■■■以上を与えたか」を
        // Yes/Noで確認するゲートを先に挟み、Yesの場合のみ通常の確定（使用回数のみ消費・
        // 骰子コストなし）へ進める。
        if (restageConfirmedThisUse === null) {
          var restageConfirmNote = document.createElement("p");
          restageConfirmNote.className = "threat-ref-body";
          restageConfirmNote.textContent = window.I18N.t("restage_confirm_question");
          content.appendChild(restageConfirmNote);
          var restageConfirmRow = document.createElement("div");
          restageConfirmRow.className = "wb-row";
          [
            { key: true, label: window.I18N.t("restage_confirm_yes_button") },
            { key: false, label: window.I18N.t("restage_confirm_no_button") },
          ].forEach(function (opt) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = opt.label;
            btn.addEventListener("click", function () {
              restageConfirmedThisUse = opt.key;
              renderCombatModal();
            });
            restageConfirmRow.appendChild(btn);
          });
          content.appendChild(restageConfirmRow);
        } else if (restageConfirmedThisUse === false) {
          var restageNoNote = document.createElement("p");
          restageNoNote.className = "threat-ref-body";
          restageNoNote.textContent = window.I18N.t("restage_confirm_no_note");
          content.appendChild(restageNoNote);
        } else {
          var restageCost = CharacterDrawer.parseActionCost(body);
          renderDiceCostAction(c, content, restageCost, function (dice, costLines) {
            if (entry.uses && entry.id) {
              if (!c.abilityUses) c.abilityUses = {};
              c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
            }
            var restageLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
            var restageDamageBoost = CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（損害增加）", "スキル強化（損害増加）"]);
            if (restageDamageBoost) restageLines = restageLines.concat([CharacterTypes.localizedText(restageDamageBoost.body)]);
            addActionBox(c, name, window.I18N.t("restage_applied_note"), restageLines);
            addLog("log_restage_use", { character: c.name, dice: dice.join("、") });
            combatSkillState = null;
            restageConfirmedThisUse = null;
          });
        }
      } else if (isActive && entry.id === "totem_stella") {
        // 無賴漢「圖騰・史黛拉」：ダメージが「前衛にいるPCの数×35」という動的な値のため、
        // fixedSkillPowerValueの固定値パターンにはマッチしない。既存のgetCharacterBattlePosition
        // （淑女「終曲」等でも使う battle.front/back 判定）で前衛人数を数えて算出する。
        var frontCount = rosterCharacters.filter(function (rc) {
          return getCharacterBattlePosition(rc) === "front";
        }).length;
        var totemValue = frontCount * 35;
        var totemCost = CharacterDrawer.parseActionCost(body);
        renderDiceCostAction(c, content, totemCost, function (dice, costLines) {
          if (entry.uses && entry.id) {
            if (!c.abilityUses) c.abilityUses = {};
            c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
          }
          // 淑女「終曲」と同じく、次の防禦フェイズを跨いで持続するbattle全体のフラグを立てる
          // （防禦フェイズを抜けたタイミングでリセットされる。setActionPhase参照）。
          state.battle._totemStellaActive = true;
          saveState();
          var total = window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(totemValue, "▲") });
          var totemLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
          // R1「技藝強化（HP回復）」：発動後、全體PCへ「HP回復：□×5」（+5）を適用する。
          if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（HP回復）", "アーツ強化（HP回復）"])) {
            rosterCharacters.forEach(function (rc) {
              if (rc.entered) rc.hp.current = Math.min(rc.hp.max, rc.hp.current + 5);
            });
            totemLines = totemLines.concat([window.I18N.t("totem_stella_heal_applied_note")]);
          }
          // 無賴漢「技藝強化（堅陣）」：使用技藝「圖騰・史黛拉」時，直到結束階段為止，對全體PC
          // 施加「HP價值：+20」（不超過100）。沿用_guardValueBonusUntilEndPhase機制，上限100
          // 由既有消耗處（HP價值計算時Math.min(...,100)）自然滿足，不需在此另行限制。
          if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（堅陣）", "アーツ強化（堅陣）"])) {
            rosterCharacters.forEach(function (rc) {
              if (!rc.entered) return;
              rc._guardValueBonusUntilEndPhase = 20;
              rc._guardValueBonusConsumed = false;
            });
            totemLines = totemLines.concat([window.I18N.t("totem_stella_fortify_applied_note")]);
          }
          addActionBox(c, name, total, totemLines);
          addLog("log_combat_skill_use", { character: c.name, skill: name, dice: dice.join("、") });
          combatSkillState = null;
          renderCharacterRoster();
        });
      } else if (isActive && entry.id === "spirit_summon") {
        // 復仇者「召喚靈體」：海倫／弗雷德里克／賽巴斯汀の3択→骰子3個で確定。同時に1体のみ
        // 保持でき、種類ごとのHPはc.spiritSummonHpに保存され、再召喚時も維持される
        // （「先前召喚的靈體會消失並從戰鬥中移除，目前HP維持不變」を反映）。
        var spiritChoiceRow = document.createElement("div");
        spiritChoiceRow.className = "wb-row";
        ["helen", "frederick", "sebastian"].forEach(function (kind) {
          var choiceBtn = document.createElement("button");
          choiceBtn.type = "button";
          choiceBtn.textContent = window.I18N.t("spirit_summon_choice_" + kind + "_label");
          if (spiritSummonChoice === kind) choiceBtn.classList.add("active");
          choiceBtn.addEventListener("click", function () {
            spiritSummonChoice = spiritSummonChoice === kind ? null : kind;
            renderCombatModal();
          });
          spiritChoiceRow.appendChild(choiceBtn);
        });
        content.appendChild(spiritChoiceRow);
        if (spiritSummonChoice) {
          var spiritCost = CharacterDrawer.parseActionCost(body);
          renderDiceCostAction(c, content, spiritCost, function (dice, costLines) {
            var kind = spiritSummonChoice;
            c.spiritSummon = kind;
            if (!c.spiritSummonHp) c.spiritSummonHp = {};
            if (!c.spiritSummonHp[kind]) {
              var maxHp = SPIRIT_SUMMON_KINDS[kind].hpMax;
              c.spiritSummonHp[kind] = { current: maxHp, max: maxHp };
            }
            var kindLabel = window.I18N.t("spirit_summon_choice_" + kind + "_label");
            addActionBox(c, name, window.I18N.t("spirit_summon_note", { spirit: kindLabel }), [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
            addLog("log_spirit_summon_use", { character: c.name, spirit: kindLabel, dice: dice.join("、") });
            combatSkillState = null;
            spiritSummonChoice = null;
          });
        }
      } else if (isActive && entry.id === "elemental_control") {
        // 隱者「元素操控」：対象の敵人を選び、その敵人が実際に屬性傷害を受けているか
        // （enemyAccum）を自動判定する。範囲不明のため手動確認に頼る他の技能とは異なり、
        // ここは既存の屬性蓄積データで正確に判定できる。
        var elementalEnemyOptions = resolveSelectedEnemyOptions();
        var elementalMarks = c.elementalMarks || 0;
        if (!elementalEnemyOptions.length) {
          var elementalNoEnemyNote = document.createElement("p");
          elementalNoEnemyNote.className = "threat-ref-body";
          elementalNoEnemyNote.textContent = window.I18N.t("eye_for_value_no_enemy_note");
          content.appendChild(elementalNoEnemyNote);
        } else if (elementalMarks >= 3) {
          var elementalMaxNote = document.createElement("p");
          elementalMaxNote.className = "threat-ref-body";
          elementalMaxNote.textContent = window.I18N.t("elemental_control_max_note");
          content.appendChild(elementalMaxNote);
        } else {
          if (!elementalControlTargetKey || !elementalEnemyOptions.some(function (opt) { return opt.key === elementalControlTargetKey; })) {
            elementalControlTargetKey = elementalEnemyOptions[0].key;
          }
          var elementalEnemySelect = document.createElement("select");
          elementalEnemyOptions.forEach(function (opt) {
            var o = document.createElement("option");
            o.value = opt.key;
            o.textContent = opt.name;
            if (opt.key === elementalControlTargetKey) o.selected = true;
            elementalEnemySelect.appendChild(o);
          });
          elementalEnemySelect.addEventListener("change", function () {
            elementalControlTargetKey = elementalEnemySelect.value;
            renderCombatModal();
          });
          content.appendChild(elementalEnemySelect);
          if (!enemyHasElementDamage(elementalControlTargetKey)) {
            var elementalNoDamageNote = document.createElement("p");
            elementalNoDamageNote.className = "threat-ref-body";
            elementalNoDamageNote.textContent = window.I18N.t("elemental_control_no_element_note");
            content.appendChild(elementalNoDamageNote);
          } else {
            var elementalCost = CharacterDrawer.parseActionCost(body);
            renderDiceCostAction(c, content, elementalCost, function (dice, costLines) {
              c.elementalMarks = Math.min(3, (c.elementalMarks || 0) + 1);
              // R1「能力強化（魔術之地）」：屬性痕へ✓が入った直後から直到階段結束為止、自身の
              // 魔術ダメージ+5（重複しないのでbooleanのまま立てるだけでよい）。
              if (CharacterDrawer.findLearnedRelicEffectByName(c, ["能力強化（魔術之地）", "アビリティ強化（魔術の地）"])) {
                c._elementalControlMagicBonusActive = true;
              }
              addActionBox(c, name, window.I18N.t("elemental_control_note", { marks: c.elementalMarks }), [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
              addLog("log_elemental_control_use", { character: c.name, dice: dice.join("、") });
              combatSkillState = null;
            });
          }
        }
      } else if (isActive && entry.id === "hybrid_magic") {
        // 隱者「混成魔法」：屬性痕を3個消費し、火/雷/聖/魔から1種を選んで発動する。
        var hybridMarks = c.elementalMarks || 0;
        if (hybridMarks < 3) {
          var hybridInsufficientNote = document.createElement("p");
          hybridInsufficientNote.className = "threat-ref-body";
          hybridInsufficientNote.textContent = window.I18N.t("hybrid_magic_insufficient_marks_note", { marks: hybridMarks });
          content.appendChild(hybridInsufficientNote);
        } else {
          var hybridChoiceRow = document.createElement("div");
          hybridChoiceRow.className = "wb-row";
          ["fire", "lightning", "holy", "arcane"].forEach(function (kind) {
            var hybridBtn = document.createElement("button");
            hybridBtn.type = "button";
            hybridBtn.textContent = window.I18N.t("hybrid_magic_choice_" + kind + "_label");
            if (hybridMagicElementChoice === kind) hybridBtn.classList.add("active");
            hybridBtn.addEventListener("click", function () {
              hybridMagicElementChoice = hybridMagicElementChoice === kind ? null : kind;
              renderCombatModal();
            });
            hybridChoiceRow.appendChild(hybridBtn);
          });
          content.appendChild(hybridChoiceRow);
          var hybridEnemyOptions = resolveSelectedEnemyOptions();
          var hybridEnemySelect = null;
          if (hybridMagicElementChoice && hybridEnemyOptions.length) {
            hybridEnemySelect = document.createElement("select");
            hybridEnemyOptions.forEach(function (opt) {
              var o = document.createElement("option");
              o.value = opt.key;
              o.textContent = opt.name;
              hybridEnemySelect.appendChild(o);
            });
            content.appendChild(hybridEnemySelect);
          }
          if (hybridMagicElementChoice) {
            var hybridCost = CharacterDrawer.parseActionCost(body);
            renderDiceCostAction(c, content, hybridCost, function (dice, costLines) {
              c.elementalMarks = Math.max(0, (c.elementalMarks || 0) - 3);
              var elementLabel = window.I18N.t("hybrid_magic_choice_" + hybridMagicElementChoice + "_label");
              if (hybridEnemySelect) {
                var enemyLabels = HYBRID_MAGIC_ELEMENT_LABELS[hybridMagicElementChoice];
                recordAttributeStatusDealt(c.id, hybridEnemySelect.value, enemyLabels.zh, 2);
              }
              var dmg = computeSkillDamage(c, entry, body);
              if (dmg) recordPhaseDamageDealt(c, dmg.value, dmg.symbol);
              var total = dmg ? window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(dmg.value, dmg.symbol) }) : null;
              var hybridNote = [total, window.I18N.t("hybrid_magic_note", { element: elementLabel })].filter(Boolean).join(" / ");
              addActionBox(c, name, hybridNote, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
              addLog("log_hybrid_magic_use", { character: c.name, element: elementLabel });
              combatSkillState = null;
              hybridMagicElementChoice = null;
            });
          }
        }
      } else if (isActive && entry.id === "inquiry") {
        // 學者「探求」：後衛時は骰子消耗を3に変更（parseActionCostの結果を上書き）。
        // 效果1（體力骰+1）／效果2（敵人ダメージ減少、回合跨ぎ持続）の二択。
        var inquiryChoiceRow = document.createElement("div");
        inquiryChoiceRow.className = "wb-row";
        [
          { key: "bonus_dice", label: window.I18N.t("inquiry_choice_bonus_dice_label") },
          { key: "damage_reduction", label: window.I18N.t("inquiry_choice_damage_reduction_label") },
        ].forEach(function (opt) {
          var inquiryBtn = document.createElement("button");
          inquiryBtn.type = "button";
          inquiryBtn.textContent = opt.label;
          if (inquiryChoice === opt.key) inquiryBtn.classList.add("active");
          inquiryBtn.addEventListener("click", function () {
            inquiryChoice = inquiryChoice === opt.key ? null : opt.key;
            renderCombatModal();
          });
          inquiryChoiceRow.appendChild(inquiryBtn);
        });
        content.appendChild(inquiryChoiceRow);
        // R1「技能強化（夥伴支援）」：效果1（體力骰+1）を選んでいるときだけ、対象を任意のPC
        // （既定は自分）に変更できる。骰子自体は学者が振り、対象のdicePoolへ追加する。
        var inquiryBuddyEffect = CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（夥伴支援）", "スキル強化（仲間支援）"]);
        var inquiryTargetSelect = null;
        if (inquiryChoice === "bonus_dice" && inquiryBuddyEffect) {
          var inquiryEnteredChars = rosterCharacters.filter(function (rc) {
            return rc.entered;
          });
          inquiryTargetSelect = document.createElement("select");
          inquiryEnteredChars.forEach(function (rc) {
            var o = document.createElement("option");
            o.value = rc.id;
            o.textContent = rc.name;
            if (rc.id === c.id) o.selected = true;
            inquiryTargetSelect.appendChild(o);
          });
          content.appendChild(inquiryTargetSelect);
        }
        if (inquiryChoice) {
          var inquiryCost = CharacterDrawer.parseActionCost(body);
          if (getCharacterBattlePosition(c) === "back") {
            // 本文「必須將骰子消耗變更為『3』」＝出目合計3（個数ではない）。
            inquiryCost = { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: 3, fpCost: inquiryCost.fpCost, hpCost: inquiryCost.hpCost };
          }
          renderDiceCostAction(c, content, inquiryCost, function (dice, costLines) {
            if (entry.uses && entry.id) {
              if (!c.abilityUses) c.abilityUses = {};
              c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
            }
            var inquiryNote;
            if (inquiryChoice === "bonus_dice") {
              var inquiryDiceTarget = c;
              if (inquiryTargetSelect) {
                inquiryDiceTarget =
                  rosterCharacters.filter(function (rc) {
                    return rc.id === inquiryTargetSelect.value;
                  })[0] || c;
              }
              if (!inquiryDiceTarget.dicePool) inquiryDiceTarget.dicePool = [];
              inquiryDiceTarget.dicePool.push(1 + Math.floor(Math.random() * 6));
              inquiryNote =
                inquiryDiceTarget.id === c.id
                  ? window.I18N.t("inquiry_bonus_dice_note")
                  : window.I18N.t("inquiry_bonus_dice_target_note", { name: inquiryDiceTarget.name });
            } else {
              rosterCharacters.forEach(function (rc) {
                rc._inquiryDamageReductionActive = true;
              });
              inquiryNote = window.I18N.t("inquiry_damage_reduction_defense_note");
            }
            addActionBox(c, name, inquiryNote, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
            addLog("log_inquiry_use", { character: c.name, choice: window.I18N.t(inquiryChoice === "bonus_dice" ? "inquiry_choice_bonus_dice_label" : "inquiry_choice_damage_reduction_label") });
            combatSkillState = null;
            inquiryChoice = null;
          });
        }
      } else if (isActive && entry.id === "crucible_roar") {
        // 執行者「咆哮」：對敵人傷害／對PC復歸傷害の二択（襲擊と異なりこちらは「或」＝排他）。
        var roarChoiceRow = document.createElement("div");
        roarChoiceRow.className = "wb-row";
        [
          { key: "damage", label: window.I18N.t("crucible_roar_choice_damage_label") },
          { key: "revival", label: window.I18N.t("crucible_roar_choice_revival_label") },
        ].forEach(function (opt) {
          var roarBtn = document.createElement("button");
          roarBtn.type = "button";
          roarBtn.textContent = opt.label;
          if (crucibleRoarChoice === opt.key) roarBtn.classList.add("active");
          roarBtn.addEventListener("click", function () {
            crucibleRoarChoice = crucibleRoarChoice === opt.key ? null : opt.key;
            renderCombatModal();
          });
          roarChoiceRow.appendChild(roarBtn);
        });
        content.appendChild(roarChoiceRow);
        var roarTargetSelect = null;
        if (crucibleRoarChoice === "revival") {
          var enteredChars = rosterCharacters.filter(function (rc) {
            return rc.entered;
          });
          roarTargetSelect = document.createElement("select");
          enteredChars.forEach(function (rc) {
            var o = document.createElement("option");
            o.value = rc.id;
            o.textContent = rc.name;
            roarTargetSelect.appendChild(o);
          });
          content.appendChild(roarTargetSelect);
        }
        // R1「技藝強化（治癒咆哮）」：どちらの選択でも被動強制発動し、任意1名PCへ「HP回復：□□」
        // （+2）を追加する。既に revival 選択でPC選択欄がある場合はそれを流用する。
        var roarHealEffect = CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（治癒咆哮）", "アーツ強化（癒しの咆哮）"]);
        var roarHealSelect = roarTargetSelect;
        if (roarHealEffect && crucibleRoarChoice === "damage") {
          var roarHealEntered = rosterCharacters.filter(function (rc) {
            return rc.entered;
          });
          roarHealSelect = document.createElement("select");
          roarHealEntered.forEach(function (rc) {
            var o = document.createElement("option");
            o.value = rc.id;
            o.textContent = rc.name;
            roarHealSelect.appendChild(o);
          });
          var roarHealNote = document.createElement("p");
          roarHealNote.className = "weapon-damage-tag";
          roarHealNote.textContent = window.I18N.t("crucible_roar_heal_enhancement_note");
          content.appendChild(roarHealNote);
          content.appendChild(roarHealSelect);
        }
        if (crucibleRoarChoice) {
          var roarCost = CharacterDrawer.parseActionCost(body);
          renderDiceCostAction(c, content, roarCost, function (dice, costLines) {
            var roarTotal;
            if (crucibleRoarChoice === "damage") {
              roarTotal = window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(30, null) });
            } else {
              var targetChar = roarTargetSelect
                ? rosterCharacters.filter(function (rc) {
                    return rc.id === roarTargetSelect.value;
                  })[0]
                : null;
              roarTotal = window.I18N.t("crucible_roar_target_label", { target: targetChar ? targetChar.name : "" });
            }
            var extraLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
            if (roarHealEffect && roarHealSelect) {
              var healTarget = rosterCharacters.filter(function (rc) {
                return rc.id === roarHealSelect.value;
              })[0];
              if (healTarget) {
                healTarget.hp.current = Math.min(healTarget.hp.max, healTarget.hp.current + 2);
                extraLines.push(window.I18N.t("crucible_roar_heal_applied_note", { name: healTarget.name }));
              }
            }
            addActionBox(c, name, roarTotal, extraLines);
            addLog("log_crucible_roar_use", {
              character: c.name,
              choice: window.I18N.t(crucibleRoarChoice === "damage" ? "crucible_roar_choice_damage_label" : "crucible_roar_choice_revival_label"),
            });
            combatSkillState = null;
            crucibleRoarChoice = null;
            renderCharacterRoster();
          });
        }
      } else if (isActive) {
        var cost = CharacterDrawer.parseActionCost(body);
        // 隱者「聖幕」（混成魔法の遺物効果）：發動中は自身が武器の戰技・魔術・祈禱（＝weaponId
        // を持つentry）を使用する際の「FP消耗」を0にする。
        if (c._sacredCurtainActive && entry.weaponId) cost.fpCost = 0;
        // 送葬人（黎明）「技藝強化（HP回復）」：使用技藝「不祥一擊」時，對自身以外任意1名PC施加
        // 「HP回復：□□」（+2）。crucible_roarの治癒選択と同じ「選択肢を先に見せる」パターンだが、
        // 主効果（傷害）を止めない副次ボーナスのため未選択でもコスト表示自体は続行し、選択肢が
        // 無い場合は先頭の他PCへ既定適用する（roarHealSelectと同じベストエフォート方式）。
        var ominousHealSelect = null;
        if (entry.id === "ominous_strike" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（HP回復）", "アーツ強化（HP回復）"])) {
          var ominousHealCandidates = rosterCharacters.filter(function (rc) {
            return rc.entered && rc.id !== c.id;
          });
          if (ominousHealCandidates.length) {
            ominousHealSelect = document.createElement("select");
            ominousHealCandidates.forEach(function (rc) {
              var o = document.createElement("option");
              o.value = rc.id;
              o.textContent = rc.name;
              ominousHealSelect.appendChild(o);
            });
            content.appendChild(ominousHealSelect);
          }
        }
        renderDiceCostAction(c, content, cost, function (dice, costLines) {
          if (entry.uses && entry.id) {
            if (!c.abilityUses) c.abilityUses = {};
            c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
          }
          if (isOncePerTurn) {
            if (!c._entryUsedThisTurn) c._entryUsedThisTurn = {};
            c._entryUsedThisTurn[entry.id] = true;
          }
          // 隱者「混成魔法」の遺物効果：聖幕はフェイズ終了までのFP消耗無効バフを発動し、
          // 聖光燈火は自身のHPを固定+3回復する（他PC1人への+3はGM手動反映）。
          if (entry.id === "hybrid_magic_sacred_curtain") c._sacredCurtainActive = true;
          if (entry.id === "hybrid_magic_holy_light") c.hp.current = Math.min(c.hp.max, c.hp.current + 3);
          // 執行者「妖刀（妖刀解放・攻）」のAction使用：妖刀蓄積を1個消費する。
          if (entry.id === "yoto_release_action") c._yotoMarks = Math.max(0, (c._yotoMarks || 0) - 1);
          // 執行者（暗影）「妖刀（妖刀解放・癒）」のAction使用：妖刀蓄積を2個消費し、自身に
          // 「HP回復：□×5」（+5）を適用する。
          if (entry.id === "yoto_release_heal_action") {
            c._yotoMarks = Math.max(0, (c._yotoMarks || 0) - 2);
            c.hp.current = Math.min(c.hp.max, c.hp.current + 5);
          }
          // 無賴漢（暗影）「技能強化（敵人弱化）」：以［Action］使用夜渡技能「逆襲」時，下個防禦
          // 階段中敵人產生的亂戰傷害（分割前）「－120」。與既存「圖騰・史黛拉」的－300同一設計
          // （state.battle旗標＋防禦分頁提醒橫幅，數值本身由GM於AutoGM/手動結算時自行減去，
          // 而不是寫入state.battle.enemyDmgOverride——沿用totem_stella既有的「提醒優先」處理方式）。
          if (entry.id === "counterattack" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（敵人弱化）", "スキル強化（エネミー弱体）"])) {
            state.battle._ruffianDarkCounterDebuffActive = true;
            saveState();
          }
          // 葬儀屋「力量感應」：この汎用パスを通るあらゆる技藝の使用（他キャラのarts含む）が
          // 発火対象になりうる。判定自体はtriggerPowerResonance内でisArtをチェックする。
          triggerPowerResonance(c, entry);
          if (entry.id === "whirlwind") {
            c._whirlwindUsedThisPhase = true;
            // 守護者（黎明）「技能強化（防禦支援）」：夜渡技能「旋風」發揮效果時，直到結束階段為止，
            // 將全體（已入場）PC「HP價值：+10」（沿用消耗品「盾塗脂」的_guardValueBonusUntilEndPhase
            // 機制，設為固定值而非累加，天然滿足「此效果不重複」）。
            if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（防禦支援）", "スキル強化（防御支援）"])) {
              rosterCharacters.forEach(function (rc) {
                if (!rc.entered) return;
                rc._guardValueBonusUntilEndPhase = 10;
                rc._guardValueBonusConsumed = false;
              });
            }
          }
          // 葬儀屋「恍惚」をActionとして使用した場合：即時に體力骰+1（妖刀と異なり次フェイズ
          // 待ちではない）。
          if (entry.id === "trance") {
            if (!c.dicePool) c.dicePool = [];
            c.dicePool.push(1 + Math.floor(Math.random() * 6));
          }
          // 葬儀屋「不祥一擊」：ダメージ計算は下の汎用ロジックにそのまま乗るため、ここでは
          // 前衛への無条件移動のみ追加する（通常の骰子消費・使用回数消費を伴う使用のみ、
          // 力量感應の無消耗使用は専用ボタンの別ハンドラで同じ関数を呼ぶ）。
          if (entry.id === "ominous_strike") {
            moveOminousStrikeToFront(c);
            // R1「技藝強化（攻擊力強化）」：發動時、直到階段結束為止，自身の攻擊/戰技・魔術・
            // 祈禱ダメージを強化する（finale/song_of_blood_spiritと同じ考え方）。
            if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（攻擊力強化）", "アーツ強化（攻撃力強化）"])) {
              c._ominousStrikeBuffActive = true;
            }
            // 送葬人（黎明）「技藝強化（HP回復）」：對自身以外任意1名PC施加「HP回復：□□」（+2）。
            if (ominousHealSelect) {
              var ominousHealTarget = rosterCharacters.filter(function (rc) {
                return rc.id === ominousHealSelect.value;
              })[0];
              if (ominousHealTarget) {
                ominousHealTarget.hp.current = Math.min(ominousHealTarget.hp.max, ominousHealTarget.hp.current + 2);
              }
            }
          }
          // 送葬人（黎明）「祈禱輔助強化火力提升」：自身使用「祈禱」（skillDamageKindが"incant"
          // ＝聖印カテゴリの武器戰技entry）施加「直到階段結束為止／直到結束階段為止」持續的效果時，
          // 進入「火力提升」狀態（c._prayerFirepowerActive、持續至戰鬥結束為止、不累積——combatEnd
          // 時reset，見setActionPhase）。
          if (
            entry.weaponId &&
            (body.indexOf("直到階段結束為止") !== -1 || body.indexOf("直到結束階段為止") !== -1) &&
            CharacterDrawer.findLearnedRelicEffectByName(c, ["祈禱輔助強化火力提升", "祈祷補助強化火力アップ"])
          ) {
            var prayerBaseId = entry.weaponId.indexOf("::") !== -1 ? entry.weaponId.slice(0, entry.weaponId.indexOf("::")) : entry.weaponId;
            var prayerWeapon = window.PriTestWeapons.get(prayerBaseId);
            var prayerCategory = prayerWeapon ? window.PriTestWeapons.getCategory(prayerWeapon.category) : null;
            if (prayerCategory && prayerCategory.id === "sacred_seal") {
              c._prayerFirepowerActive = true;
            }
          }
          // 守護者「救世之翼」：戦闘フェイズでの発動後、額外・防禦フェイズを跨いで持続する
          // 全体バフ（HP損害無効化）。次に戦闘フェイズへ新規突入した時にのみクリアされる
          // （setActionPhaseの「新しい回合開始」判定箇所を参照）。
          if (entry.id === "wings_of_salvation") {
            rosterCharacters.forEach(function (rc) {
              rc._wingsOfSalvationActive = true;
            });
            // R1「技藝強化（HP回復）」：guardian版は発動後、全體PCのHPを最大値まで回復するが、
            // guardian_dawn版は同名・別本文（「HP回復：□×5」＝+5、全快ではない）のため、
            // c.typeIdで区別する（baseTypeIdはどちらも"guardian"に正規化されてしまい使えない）。
            if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（HP回復）", "アーツ強化（HP回復）"])) {
              var wingsHealFull = c.typeId === "guardian";
              rosterCharacters.forEach(function (rc) {
                if (!rc.entered) return;
                rc.hp.current = wingsHealFull ? rc.hp.max : Math.min(rc.hp.max, rc.hp.current + 5);
              });
            }
          }
          // 復仇者「不死行軍」：救世之翼と全く同じライフサイクル（戦闘→額外→防禦の1回合を
          // 跨いで持続し、次に戦闘フェイズへ新規突入した時にのみクリア）の全体バフ。
          // 「復歸傷害：120」自体はGM手動反映（■/▲と同様の未確定数値は捏造しない方針）。
          if (entry.id === "march_of_the_undying") {
            rosterCharacters.forEach(function (rc) {
              rc._marchOfTheUndyingActive = true;
            });
            // R1「技藝強化（靈炎爆發）」：自身が召喚中の靈體へ「HP回復：□×6」（+6）を適用する
            // （對敵人「火+2」は対象敵人選択UIが無いためGM手動反映＝下のnoteで注記のみ）。
            var marchEnhancement = CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（靈炎爆發）", "アーツ強化（霊炎爆発）"]);
            if (marchEnhancement) {
              if (c.spiritSummon && c.spiritSummonHp && c.spiritSummonHp[c.spiritSummon]) {
                var spiritHp = c.spiritSummonHp[c.spiritSummon];
                spiritHp.current = Math.min(spiritHp.max, spiritHp.current + 6);
              }
              addLog("log_march_of_the_undying_enhancement_note", { character: c.name });
            }
          }
          // 隱者「血魂之歌」：他キャラの回合跨ぎバフと異なり「階段結束まで」＝発動したフェイズ
          // 限定のため、battle全体のフラグとしてフェイズ切替の都度リセットする
          // （setActionPhaseの通常のフェイズ切替リセットループを参照）。
          if (entry.id === "song_of_blood_spirit") {
            state.battle._songOfBloodSpiritActive = true;
            saveState();
          }
          // 淑女「終曲」：次の防禦フェイズの間、敵人は行動しない（GM手動反映）。battle全体に
          // 紐付くフラグとして持たせ、防禦フェイズを抜けたタイミングでリセットする
          // （setActionPhase参照。救世之翼と異なり「次の防禦フェイズ1回限り」の効果のため）。
          if (entry.id === "finale") {
            state.battle._finaleActive = true;
            saveState();
            // R1「技藝強化（攻擊力提升）」：発動した本人限定で、直到結束階段為止、自身の
            // 攻擊/戰技・魔術・祈禱ダメージを強化する（finaleAttackBuffBonus／finaleSkillBuffBonus参照）。
            if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（攻擊力提升）", "アーツ強化（攻撃力上昇）"])) {
              c._finaleAttackBuffActive = true;
            }
          }
          // 執行者「坩堝諸相・獸」：自身をHP全回復し、「階段結束まで」＝発動したフェイズ限定で
          // 坩堝之獸狀態にする（武器攻撃不可＋襲擊／咆哮アクション追加、renderCombatAttackAction
          // とentries注入箇所を参照）。フェイズ切替の都度リセットする他のフラグと同じ箇所で
          // c._crucibleBeastActive = false; を行う（setActionPhase参照）。
          if (entry.id === "crucible_aspect_beast") {
            c.hp.current = c.hp.max;
            c._crucibleBeastActive = true;
          }
          // 學者「共感術」：救世之翼と全く同じ回合跨ぎの持続バフ（直到結束階段為止）。
          // 「HP回復が他PCにも適用される」効果はrenderCombatDefenseActionのバナーで
          // リマインドするのみ（GM手動反映）。
          if (entry.id === "empathy") {
            rosterCharacters.forEach(function (rc) {
              rc._empathyActive = true;
            });
          }
          // 鐵眼「標記」をActionとして戦闘フェイズで使用した場合：自身の前衛/後衛を強制的に
          // 反転する。骰子池の内容から前後衛を自動判定する既存の同期処理と直後に競合するため、
          // 追跡者「爪擊」の移動処理と同じくsetTimeoutで1ティック遅らせて最終結果として適用する。
          if (entry.id === "marking") {
            setTimeout(function () {
              var idx = battlePositionNames().indexOf(c.name);
              if (idx !== -1 && idx < BATTLE_SLOT_COUNT) {
                state.battle.front[idx] = !state.battle.front[idx];
                state.battle.back[idx] = !state.battle.front[idx];
                saveState();
                renderBattlePositionAreas();
                renderCombatModal();
              }
            }, 0);
          }
          var dmg = computeSkillDamage(c, entry, body);
          if (dmg) {
            recordPhaseDamageDealt(c, dmg.value, dmg.symbol);
            // 執行者「襲擊之楔」：本文に独立して存在する2つ目の▲（computeSkillDamageのコメント
            // 参照）を、表示用のdmg.value/symbolとは別枠で追加記録する（0.5点を追加加算するだけ、
            // 傷害数値の表示は変えない）。
            if (dmg.extraGuardSymbol) recordPhaseDamageDealt(c, 0, dmg.extraGuardSymbol);
          }
          // 隱者「冷氣風暴」（hybrid_magic_frost_storm）與隱者（黎明）「雷炎戰車」
          // （hybrid_magic_lightning_chariot）、以及「夜之彗星（不可視）」（spell_night_comet，
          // 喪失之杖）：本文中的屬性附加值是固定數字（非骰子），
          // 與combatAttackTargetEnemyKey（現在選択中の敵人、跨UI共有）搭配即可自動蓄積；
          // 未選擇對象時暫不處理（body已在UI中完整顯示，GM可自行讀取）。
          var hybridVariantElementAccum =
            entry.id === "hybrid_magic_frost_storm"
              ? [{ label: "凍傷", amount: 2 }]
              : entry.id === "hybrid_magic_lightning_chariot"
              ? [
                  { label: "火", amount: 3 },
                  { label: "雷", amount: 3 },
                ]
              : entry.id === "spell_night_comet"
              ? [{ label: "魔", amount: 4 }]
              : null;
          if (hybridVariantElementAccum && combatAttackTargetEnemyKey) {
            hybridVariantElementAccum.forEach(function (a) {
              recordAttributeStatusDealt(c.id, combatAttackTargetEnemyKey, a.label, a.amount);
            });
          }
          // 鐵之眼（暗影）「技藝強化（毒箭）」：技藝「一擊必殺」（one_shot）の對敵人傷害に
          // 固定「猛毒：8」を追加する。既存の武器攻擊タブで選択済みの對象敵人
          // （combatAttackTargetEnemyKey、複数UIで共有する現在選択中の敵人）があればそのまま
          // 蓄積し、未選択（まだ攻擊タブを開いていない等）ならGM向け注記のみ後でextraLinesへ残す
          // （下のassault_wedge注記ブロックの近くでまとめて処理）。
          var oneShotPoisonBonus =
            entry.id === "one_shot" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（毒箭）", "アーツ強化（毒矢）"]);
          if (oneShotPoisonBonus && combatAttackTargetEnemyKey) {
            recordAttributeStatusDealt(c.id, combatAttackTargetEnemyKey, "猛毒", 8);
          }
          var total =
            entry.id === "marking"
              ? window.I18N.t("marking_action_note")
              : entry.id === "song_of_blood_spirit"
              ? window.I18N.t("song_of_blood_spirit_note")
              : entry.id === "crucible_aspect_beast"
              ? window.I18N.t("crucible_beast_active_note")
              : dmg
              ? window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(dmg.value, dmg.symbol) })
              : null;
          var extraLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
          if (entry.id === "ominous_strike") extraLines = extraLines.concat([window.I18N.t("log_ominous_strike_move_note")]);
          // R1：数値化できる部分は上のcomputeSkillDamage／専用フラグで実際に加算済み。ここでは
          // 「火：3D」のような出目未確定の副次効果だけ、遺物効果の本文をそのまま黃字注記として残す
          // （GMが実際にダイスを振って適用する）。
          if (entry.id === "assault_wedge") {
            var assaultWedgeNote = CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（燃燒）", "アーツ強化（炎上）"]);
            if (assaultWedgeNote) extraLines = extraLines.concat([CharacterTypes.localizedText(assaultWedgeNote.body)]);
            // 追跡者「技藝強化（速擊）」：以「速擊」使用時，使用次數在戰鬥結束時（而非當日結束時）
            // 額外回復一次——這個特殊回復時機沒有對應的自動化機制，僅記錄提醒文字讓GM於戰鬥結束時
            // 手動為此PC補回1次「襲擊之楔」使用次數。
            if (entry.quickVariant) extraLines = extraLines.concat([window.I18N.t("assault_wedge_quick_recharge_note")]);
          }
          // 鐵之眼（暗影）「技藝強化（毒箭）」：對象敵人未選擇（尚未開啟過武器攻擊分頁）時，
          // 無法自動判斷猛毒:8該蓄積到哪個敵人，改為留下原文注記由GM手動處理。
          if (oneShotPoisonBonus && !combatAttackTargetEnemyKey) {
            extraLines = extraLines.concat([CharacterTypes.localizedText(oneShotPoisonBonus.body)]);
          }
          if (entry.id === "whirlwind") {
            var whirlwindNote = CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（延長時間）", "スキル強化（時間延長）"]);
            if (whirlwindNote) extraLines = extraLines.concat([CharacterTypes.localizedText(whirlwindNote.body)]);
          }
          if (entry.id === "marking") {
            var markingDurationNote = CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（延長時間）", "スキル強化（時間延長）"]);
            if (markingDurationNote) extraLines = extraLines.concat([CharacterTypes.localizedText(markingDurationNote.body)]);
            var markingPoisonNote = CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（毒刃）", "スキル強化（毒刃）"]);
            if (markingPoisonNote) extraLines = extraLines.concat([CharacterTypes.localizedText(markingPoisonNote.body)]);
          }
          if (entry.id === "song_of_blood_spirit") {
            var bloodSpiritNote = CharacterDrawer.findLearnedRelicEffectByName(c, ["技藝強化（出血攻擊力強化）", "アーツ強化（出血攻撃力強化）"]);
            if (bloodSpiritNote) extraLines = extraLines.concat([CharacterTypes.localizedText(bloodSpiritNote.body)]);
          }
          addActionBox(c, name, total, extraLines);
          addLog("log_combat_skill_use", { character: c.name, skill: name, dice: dice.join("、") });
          combatSkillState = null;
        });
      }
    });
  }

  // ============================================================
  // 追跡者「爪擊」専用UI：①主効果の二択（＋▲總傷害／復歸傷害:40＋対象） →
  // ②任意で後衛から前衛へ移動 → ③確定（骰子コスト無し、使用回数のみ消費） →
  // ④任意の追撃（近接武器1つ選択＋骰子3消費＋同じ二択、總傷害選択時は選んだ武器の
  // 戦技威力で実際にダメージを計算する）。本文がテキストの自由記述であり、既存の
  // 汎用renderDiceCostAction一発確定パスでは二択・移動・追撃の追加ステップを表現
  // できないため、この技能専用に分岐する。
  // ============================================================
  var clawShotState = null;
  // 鐵眼「鑑定眼」の確定結果（開示した敵人の系統データ）。renderDiceCostAction確定後の
  // 全体再描画をまたいで表示を維持するために使う。
  var eyeForValueResult = null;

  // 淑女「重演」：「本階段で総合ダメージによりHP損害：■■■以上を与えたか」のYes/No確認結果。
  // renderDiceCostAction確定前の中間状態のため、再描画をまたいで保持する必要がある。
  var restageConfirmedThisUse = null; // true | false | null（null=未確認）

  // 復仇者「召喚靈體」：海倫／弗雷德里克／賽巴斯汀のどれを召喚しようとしているかの中間状態。
  var spiritSummonChoice = null; // "helen" | "frederick" | "sebastian" | null

  // 隱者「元素操控」：対象に選んでいる敵人キーの中間状態（選択が変わるたびenemyHasElementDamage
  // の判定結果を再描画に反映させる必要があるため、鑑定眼等と違いchangeイベントで再描画する）。
  var elementalControlTargetKey = null;

  // 隱者「混成魔法」：付帯する屬性（火/雷/聖/魔）のどれを選ぼうとしているかの中間状態。
  var hybridMagicElementChoice = null; // "fire" | "lightning" | "holy" | "arcane" | null

  // 執行者「坩堝諸相・獸」發動中に追加される2つの固定アクション。character_types.jsのentryと
  // 同じ形（{id, kind, name:{zh,ja,en}, body:{zh,ja,en}}）で合成し、renderCombatSkillActionの
  // entries配列へ注入する。襲擊は固定値のみのため汎用パスでそのまま動く（コード変更不要）。
  var CRUCIBLE_BEAST_ACTIONS = [
    {
      id: "crucible_assault",
      kind: "Action",
      name: { zh: "襲擊", ja: "襲撃", en: "Assault" },
      body: {
        zh: "消耗：3\n對象：敵人、1名PC\n編隊：前衛時可使用\n\n效果\n・以巨爪攻擊。對敵人造成【總合傷害：60】，對任意1名PC施加「復歸傷害：60」。",
        ja: "コスト：3\n対象：エネミー、PC1人\n隊列：前衛のとき使用可能\n\n効果\n・大きな爪で攻撃。エネミーに【総合ダメージ：60】、任意のPC1人に「復帰ダメージ：60」を与える。",
        en: "Cost: 3\nTarget: Enemy, 1 PC\nFormation: Usable in front row\n\nEffect: Attacks with massive claws. Deals [Total Damage: 60] to the enemy and [Return Damage: 60] to any 1 PC.",
      },
    },
    {
      id: "crucible_roar",
      kind: "Action",
      name: { zh: "咆哮", ja: "咆哮", en: "Roar" },
      body: {
        zh: "消耗：1\n對象：敵人或1名PC\n編隊：前衛・後衛皆可使用\n\n效果\n・發出震耳咆哮。對敵人造成【總合傷害：30】，或對任意1名PC施加「復歸傷害：30」。",
        ja: "コスト：1\n対象：エネミーまたはPC1人\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・つんざく咆哮をあげる。エネミーに【総合ダメージ：30】を与える、または任意のPC1人に「復帰ダメージ：30」を与える。",
        en: "Cost: 1\nTarget: Enemy or 1 PC\nFormation: Usable in front or back row\n\nEffect: Lets out a piercing roar. Deals [Total Damage: 30] to the enemy, or [Return Damage: 30] to any 1 PC.",
      },
    },
  ];
  // 追跡者「技藝強化（速擊）」：習得していれば「襲擊之楔」（assault_wedge）を通常版に加えて
  // 「速擊」でも使用できるようになる。同じ技藝の別の使い方（本文「可任選...任選作為『速擊』使用」）
  // のため、entry.idはあえて実entry（type.arts内のassault_wedge）と同じ"assault_wedge"を使い、
  // 使用回数（c.abilityUses.assault_wedge）・「技藝強化（燃燒）」の追加ボーナスを両方の使い方で
  // 共有する（uses:1も実entryと同じ値を明記し、effectiveMax/remainingの算出を独立させない）。
  // quickVariant:trueで、computeSkillDamageの「▲が本文に2箇所出現する」特殊処理（実entry専用、
  // 本バリアントの本文には該当箇所が無い）から除外する。使用回数が戦闘終了時に回復する特典
  // （実entりの「當日結束時回復」とは異なるタイミング）は、既存のuses管理に新しい生命週期を
  // 割り込ませる汎用機構が無いため自動化せず、本文とアクション記録の注記でGMに委ねる。
  var TRACKER_ASSAULT_WEDGE_QUICK_ENTRY = {
    id: "assault_wedge",
    quickVariant: true,
    uses: 1,
    kind: "Action",
    name: { zh: "襲擊之楔（速擊）", ja: "襲撃の楔（速撃）", en: "Assault Wedge (Quick Strike)" },
    body: {
      zh: "使用次數：○（於當日結束時回復）\n消耗：使用次數●\n對象：敵人＋雜兵＋1名PC\n編隊：前衛時可使用\n\n效果（作為「速擊」使用）\n・對雜兵造成「HP損害：■」，對敵人造成【總合傷害：60+▲】，對1名PC施加【復歸傷害：60】。此行動後，於戰鬥結束時，回復此技藝的使用次數。",
      ja: "使用回数：○（1日の終了時に回復）\nコスト：使用回数●\n対象：エネミー＋モブ＋PC1人\n隊列：前衛のとき使用可能\n\n効果（「速撃」として使用）\n・モブに「HP損害：■」、エネミーに【総合ダメージ：60＋▲】、PC1人に【復帰ダメージ：60】を与える。このアクション後、戦闘終了時に、このアーツの使用回数を回復する。",
      en: "Uses: ○ (recovers at day's end)\nCost: Use ●\nTarget: Enemy + Mob + 1 PC\nFormation: Usable in front row\n\nEffect (used as \"Quick Strike\")\nDeals [HP Damage: 1] to a mob, [Total Damage: 60+▲] to the enemy, and [Return Damage: 60] to 1 PC. After this action, this art's use count also recovers at the end of the battle.",
    },
  };

  // 執行者「咆哮」：對敵人傷害／對PC復歸傷害のどちらを選ぼうとしているかの中間状態。
  var crucibleRoarChoice = null; // "damage" | "revival" | null

  // 學者「探求」：效果1（體力骰+1）／效果2（敵人ダメージ減少）のどちらを選ぼうとしているかの
  // 中間状態。
  var inquiryChoice = null; // "bonus_dice" | "damage_reduction" | null
  var HYBRID_MAGIC_ELEMENT_LABELS = {
    fire: { zh: "火", ja: "炎" },
    lightning: { zh: "雷", ja: "雷" },
    holy: { zh: "聖", ja: "聖" },
    arcane: { zh: "魔", ja: "魔" },
  };

  // 隱者「混成魔法」の遺物効果による変更後の効果（漩渦烈焰／聖幕／冷氣風暴／聖光燈火）。
  // いずれも「屬性痕」消費なしの代替効果のため、汎用のisActiveフォールバック（computeSkillDamage
  // による固定値解析）にそのまま乗る合成entryとして注入する（CRUCIBLE_BEAST_ACTIONSと同じ手法）。
  var HERMIT_HYBRID_MAGIC_ACTION_VARIANTS = [
    {
      relicNames: ["漩渦烈焰", "渦巻く炎"],
      entry: {
        id: "hybrid_magic_vortex_flame",
        kind: "Action",
        name: { zh: "漩渦烈焰", ja: "渦巻く炎", en: "Vortex Flame" },
        body: {
          zh: "消耗：1\n對象：敵人\n編隊：前衛・後衛皆可使用\n\n效果\n・對雜兵造成「HP損害：■」，對敵人造成【總合傷害：30】與「火：1D」。",
          ja: "コスト：1\n対象：エネミー\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・モブに「HP損害：■」、エネミーに【総合ダメージ：30】と「炎：1D」を与える。",
          en: "Cost: 1\nTarget: Enemy\nFormation: Usable in front or back row\n\nEffect: Deals [HP Damage: 1] to a mob, and [Total Damage: 30] plus [Fire: 1D] to the enemy.",
        },
      },
    },
    {
      relicNames: ["聖幕", "聖なる帳"],
      entry: {
        id: "hybrid_magic_sacred_curtain",
        kind: "Action",
        name: { zh: "聖幕", ja: "聖なる帳", en: "Sacred Curtain" },
        body: {
          zh: "消耗：1\n對象：自身\n編隊：前衛・後衛皆可使用\n\n效果\n・直到階段結束為止，自身使用戰技・魔術・祈禱時不需要「FP消耗」。",
          ja: "コスト：1\n対象：自身\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・フェイズ終了まで、自身が戦技・魔術・祈祷を使用するとき、「FPコスト」が不要になる。",
          en: "Cost: 1\nTarget: Self\nFormation: Usable in front or back row\n\nEffect: Until the end of the phase, self no longer needs to pay FP cost when using arts, sorceries, or incantations.",
        },
      },
    },
    {
      relicNames: ["冷氣風暴", "冷気の嵐"],
      entry: {
        id: "hybrid_magic_frost_storm",
        kind: "Action",
        name: { zh: "冷氣風暴", ja: "冷気の嵐", en: "Frost Storm" },
        body: {
          zh: "消耗：1\n對象：敵人\n編隊：前衛時可使用\n\n效果\n・對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：25】與「凍傷：2」。",
          ja: "コスト：1\n対象：エネミー\n隊列：前衛のとき使用可能\n\n効果\n・モブに「HP損害：■■」、エネミーに【総合ダメージ：25】と「凍傷：2」を与える。",
          en: "Cost: 1\nTarget: Enemy\nFormation: Usable in front row\n\nEffect: Deals [HP Damage: 2] to a mob, and [Total Damage: 25] plus [Frostbite: 2] to the enemy.",
        },
      },
    },
    {
      relicNames: ["聖光燈火", "聖なる灯火"],
      entry: {
        id: "hybrid_magic_holy_light",
        kind: "Action",
        name: { zh: "聖光燈火", ja: "聖なる灯火", en: "Holy Light" },
        body: {
          zh: "消耗：1\n對象：自身、1名PC\n編隊：前衛・後衛皆可使用\n\n效果\n・對自身與其他任意1名PC施加「HP回復：3」。",
          ja: "コスト：1\n対象：自身、PC1人\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・自身と他の任意のPC1人に「HP回復：3」を適用する。",
          en: "Cost: 1\nTarget: Self, 1 PC\nFormation: Usable in front or back row\n\nEffect: Applies [HP Recovery: 3] to self and to any other 1 PC.",
        },
      },
    },
  ];

  // 隱者（黎明）「混成魔法」の遺物効果による変更後の効果（橫掃雷擊／雷炎戰車／重力爆發）。
  // hermit_dawn専用のrelic名（base hermitとは別の名前）のため、別配列として管理する。
  // 「雷炎戰車」のみ属性値が骰子ではなく固定値（火:3＋雷:3）のため、entry.idで判別して
  // computeSkillDamage確定時にrecordAttributeStatusDealtを呼ぶ（下のisActive汎用分岐参照）。
  var HERMIT_DAWN_HYBRID_MAGIC_ACTION_VARIANTS = [
    {
      relicNames: ["橫掃雷擊", "薙ぎ払う稲妻"],
      entry: {
        id: "hybrid_magic_lightning_sweep",
        kind: "Action",
        name: { zh: "橫掃雷擊", ja: "薙ぎ払う稲妻", en: "Lightning Sweep" },
        body: {
          zh: "消耗：1\n對象：敵人\n編隊：前衛・後衛皆可使用\n\n效果\n・對雜兵造成「HP損害：■」，對敵人造成【總合傷害：30】與「雷：1D」。",
          ja: "コスト：1\n対象：エネミー\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・モブに「HP損害：■」、エネミーに【総合ダメージ：30】と「雷：1D」を与える。",
          en: "Cost: 1\nTarget: Enemy\nFormation: Usable in front or back row\n\nEffect: Deals [HP Damage: 1] to a mob, and [Total Damage: 30] plus [Lightning: 1D] to the enemy.",
        },
      },
    },
    {
      relicNames: ["雷炎戰車", "雷炎の戦車"],
      entry: {
        id: "hybrid_magic_lightning_chariot",
        kind: "Action",
        name: { zh: "雷炎戰車", ja: "雷炎の戦車", en: "Thunderfire Chariot" },
        body: {
          zh: "消耗：1\n對象：敵人\n編隊：前衛・後衛皆可使用\n\n效果\n・將自身移動至前衛區域，對敵人造成【總合傷害：30】與「火：3」與「雷：3」。",
          ja: "コスト：1\n対象：エネミー\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・自身を前衛エリアに移動し、エネミーに【総合ダメージ：30】と「火：3」と「雷：3」を与える。",
          en: "Cost: 1\nTarget: Enemy\nFormation: Usable in front or back row\n\nEffect: Moves self to the front row, and deals [Total Damage: 30] plus [Fire: 3] plus [Lightning: 3] to the enemy.",
        },
      },
    },
    {
      relicNames: ["重力爆發", "重力爆発"],
      entry: {
        id: "hybrid_magic_gravity_burst",
        kind: "Action",
        name: { zh: "重力爆發", ja: "重力爆発", en: "Gravity Burst" },
        body: {
          zh: "消耗：1\n對象：敵人\n編隊：後衛時可使用\n\n效果\n・對雜兵造成「HP損害：■■」，對敵人造成【總合傷害：25】與「魔：1D」。",
          ja: "コスト：1\n対象：エネミー\n隊列：後衛のとき使用可能\n\n効果\n・モブに「HP損害：■■」、エネミーに【総合ダメージ：25】と「魔：1D」を与える。",
          en: "Cost: 1\nTarget: Enemy\nFormation: Usable in back row\n\nEffect: Deals [HP Damage: 2] to a mob, and [Total Damage: 25] plus [Arcane: 1D] to the enemy.",
        },
      },
    },
  ];
  // 學者（暗影）「技能強化（衝擊波的緩和）」：夜渡技能「探求」を［Defense］で「迴避」の代わりに
  // 実行できるようにする遺物効果。固定でHP價值：100の迴避扱い（鐵眼「標記」と全く同じ数値・
  // 意味のため、defenseNote／logはmarking_defense_note等の既存i18nキーをそのまま再利用する）。
  var SCHOLAR_DARK_INQUIRY_SHOCKWAVE_DEFENSE_ENTRY = {
    id: "inquiry_shockwave_defense",
    kind: "Defense",
    name: { zh: "探求（衝擊波的緩和）", ja: "探求（衝撃波による緩和）", en: "Inquiry (Shockwave Mitigation)" },
    body: {
      zh: "對象：自身\n編隊：前衛・後衛皆可使用\n\n效果\n・視為自身進行了「HP價值：100」的「迴避」。",
      ja: "対象：自身\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・自身は「HP価値：100」の「回避」を行ったとして扱う。",
      en: "Target: Self\nFormation: Usable in front or back row\n\nEffect: Self is treated as having performed a dodge with HP value: 100.",
    },
  };
  var HERMIT_ICE_COFFIN_DEFENSE_ENTRY = {
    id: "ice_coffin",
    kind: "Defense",
    name: { zh: "冰塊之棺", ja: "氷塊の棺", en: "Ice Coffin" },
    body: {
      zh: "消耗：1\n對象：自身\n編隊：前衛・後衛皆可使用\n\n效果\n・視為自身進行了「HP價值：100」的「防禦」。",
      ja: "コスト：1\n対象：自身\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・自身は「HP価値：100」の「ガード」を行ったとして扱う。",
      en: "Cost: 1\nTarget: Self\nFormation: Usable in front or back row\n\nEffect: Self is treated as having performed a guard with HP value: 100.",
    },
  };

  // 執行者「妖刀解放・攻」：夜渡技能「妖刀」の代替Defense（消耗：2／HP價值：60）と、
  // 新規Action（妖刀蓄積を1個消費、總合傷害：50+▲）を追加する遺物効果。
  var EXECUTOR_YOTO_RELEASE_DEFENSE_ENTRY = {
    id: "yoto_release_defense",
    kind: "Defense",
    name: { zh: "妖刀（妖刀解放・攻）", ja: "妖刀（妖刀解放・攻）", en: "Yoto (Yoto Release: Attack)" },
    body: {
      zh: "消耗：2\n對象：自身\n編隊：前衛・後衛皆可使用\n\n效果\n・視為自身進行了「HP價值：60」的「防禦」。",
      ja: "コスト：2\n対象：自身\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・自身は「HP価値：60」の「ガード」を行ったとして扱う。",
      en: "Cost: 2\nTarget: Self\nFormation: Usable in front or back row\n\nEffect: Self is treated as having performed a guard with HP value: 60.",
    },
  };
  var EXECUTOR_YOTO_RELEASE_ACTION_ENTRY = {
    id: "yoto_release_action",
    kind: "Action",
    name: { zh: "妖刀（妖刀解放・攻）", ja: "妖刀（妖刀解放・攻）", en: "Yoto (Yoto Release: Attack)" },
    body: {
      zh: "消耗：1／消去「妖刀蓄積」的「1個」\n對象：敵人\n編隊：前衛・後衛皆可使用\n\n效果\n・對敵人造成【總合傷害：50+▲】。",
      ja: "コスト：1／「妖刀蓄積」の「1つ」を消す\n対象：エネミー\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・エネミーに【総合ダメージ：50＋▲】を与える。",
      en: "Cost: 1 / Removes 1 Yoto Mark\nTarget: Enemy\nFormation: Usable in front or back row\n\nEffect: Deals [Total Damage: 50+▲] to the enemy.",
    },
  };

  // 執行者（暗影）「妖刀解放・癒」：夜渡技能「妖刀」の代替Defense（攻版と同一の消耗2／
  // HP價值60）と、新規Action（妖刀蓄積を2個消費、總合傷害：100+◆、かつ自身HP回復+5）を
  // 追加する遺物効果（攻版とは消費量・数値とも異なる別entry）。
  var EXECUTOR_YOTO_RELEASE_HEAL_DEFENSE_ENTRY = {
    id: "yoto_release_heal_defense",
    kind: "Defense",
    name: { zh: "妖刀（妖刀解放・癒）", ja: "妖刀（妖刀解放・癒）", en: "Yoto (Yoto Release: Heal)" },
    body: {
      zh: "消耗：2\n對象：自身\n編隊：前衛・後衛皆可使用\n\n效果\n・視為自身進行了「HP價值：60」的「防禦」。",
      ja: "コスト：2\n対象：自身\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・自身は「HP価値：60」の「ガード」を行ったとして扱う。",
      en: "Cost: 2\nTarget: Self\nFormation: Usable in front or back row\n\nEffect: Self is treated as having performed a guard with HP value: 60.",
    },
  };
  var EXECUTOR_YOTO_RELEASE_HEAL_ACTION_ENTRY = {
    id: "yoto_release_heal_action",
    kind: "Action",
    name: { zh: "妖刀（妖刀解放・癒）", ja: "妖刀（妖刀解放・癒）", en: "Yoto (Yoto Release: Heal)" },
    body: {
      zh: "消耗：1／消去「妖刀蓄積」的「2個」\n對象：敵人、自身\n編隊：前衛・後衛皆可使用\n\n效果\n・對敵人造成【總合傷害：100+◆】，並對自身施加「HP回復：□×5」。",
      ja: "コスト：1／「妖刀蓄積」の「2つ」を消す\n対象：エネミー、自身\n隊列：前衛・後衛どちらでも使用可能\n\n効果\n・エネミーに【総合ダメージ：100＋◆】を与え、自身に「HP回復：□×5」を適用する。",
      en: "Cost: 1 / Removes 2 Yoto Marks\nTarget: Enemy, Self\nFormation: Usable in front or back row\n\nEffect: Deals [Total Damage: 100+◆] to the enemy, and applies [HP Recovery: 5] to self.",
    },
  };

  // 靈體の種類ごとの最大HP・傷害計算式・HP價值（character_types.jsの本文記載値、ユーザー確認済み）。
  var SPIRIT_SUMMON_KINDS = {
    helen: { hpMax: 2 },
    frederick: { hpMax: 5 },
    sebastian: { hpMax: 6 },
  };

  function resetClawShotState() {
    clawShotState = {
      primaryChoice: null, // "damage" | "revival" | null
      revivalTargetId: null,
      moveToFront: false,
      confirmed: false,
      pursueChoice: null, // "yes" | "no" | null（確定後にのみ意味を持つ）
      pursueEffectChoice: null, // "damage" | "revival" | null
      pursueWeaponId: null,
    };
  }

  function renderClawShotAction(c, content, entry, name, body, onConfirmUse) {
    if (!clawShotState) resetClawShotState();
    var st = clawShotState;
    var entered = rosterCharacters.filter(function (rc) {
      return rc.entered;
    });

    if (!st.confirmed) {
      var choiceRow = document.createElement("div");
      choiceRow.className = "wb-row";
      [
        { key: "damage", label: window.I18N.t("claw_shot_choice_damage_label") },
        { key: "revival", label: window.I18N.t("claw_shot_choice_revival_label") },
      ].forEach(function (opt) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = opt.label;
        if (st.primaryChoice === opt.key) btn.classList.add("active");
        btn.addEventListener("click", function () {
          st.primaryChoice = opt.key;
          renderCombatModal();
        });
        choiceRow.appendChild(btn);
      });
      content.appendChild(choiceRow);

      if (st.primaryChoice === "revival") {
        var targetSelect = document.createElement("select");
        entered.forEach(function (rc) {
          var opt = document.createElement("option");
          opt.value = rc.id;
          opt.textContent = rc.name;
          targetSelect.appendChild(opt);
        });
        targetSelect.value = st.revivalTargetId || (entered[0] && entered[0].id) || "";
        targetSelect.addEventListener("change", function () {
          st.revivalTargetId = targetSelect.value;
        });
        st.revivalTargetId = targetSelect.value;
        content.appendChild(targetSelect);
      }

      var idx = battlePositionNames().indexOf(c.name);
      var isBack = idx !== -1 && idx < BATTLE_SLOT_COUNT && !state.battle.front[idx];
      if (isBack) {
        var moveLabel = document.createElement("label");
        moveLabel.className = "field-row";
        var moveCheckbox = document.createElement("input");
        moveCheckbox.type = "checkbox";
        moveCheckbox.checked = st.moveToFront;
        moveCheckbox.addEventListener("change", function () {
          st.moveToFront = moveCheckbox.checked;
        });
        moveLabel.appendChild(moveCheckbox);
        moveLabel.appendChild(document.createTextNode(window.I18N.t("claw_shot_move_to_front_label")));
        content.appendChild(moveLabel);
      }

      if (st.primaryChoice) {
        var cost = CharacterDrawer.parseActionCost(body);
        renderDiceCostAction(c, content, cost, function (dice, costLines) {
          onConfirmUse();
          // renderDiceCostAction確定時の共通処理は、このコールバックの直後にrenderCharacterRoster()
          // （＝syncDiceStatusToBattle()で骰子池の内容から前後衛を再判定）を呼ぶため、ここで直接
          // state.battle.frontを書き換えても即座に上書きされてしまう（renderCombatMoveActionの
          // 既存コメントで説明されている競合と同じ）。1ティック遅らせて、その自動同期の後に
          // 手動の移動を最終結果として適用する。
          if (st.moveToFront) {
            setTimeout(function () {
              var idx2 = battlePositionNames().indexOf(c.name);
              if (idx2 !== -1 && idx2 < BATTLE_SLOT_COUNT) {
                state.battle.front[idx2] = true;
                state.battle.back[idx2] = false;
                saveState();
                renderBattlePositionAreas();
                renderCombatModal();
              }
            }, 0);
          }
          var targetChar = st.revivalTargetId ? entered.filter(function (rc) { return rc.id === st.revivalTargetId; })[0] : null;
          var effectNote =
            st.primaryChoice === "damage"
              ? window.I18N.t("claw_shot_choice_damage_label")
              : window.I18N.t("claw_shot_choice_revival_applied_note", { name: targetChar ? targetChar.name : "" });
          addActionBox(c, name, effectNote, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
          addLog("log_claw_shot_use", { character: c.name, effect: effectNote });
          st.confirmed = true;
          renderCombatModal();
        });
      }
      return;
    }

    // --- 確定後：追撃を行うかどうかの任意サブアクション ---
    if (st.pursueChoice === null) {
      var pursuePromptRow = document.createElement("div");
      pursuePromptRow.className = "wb-row";
      var pursueYesBtn = document.createElement("button");
      pursueYesBtn.type = "button";
      pursueYesBtn.textContent = window.I18N.t("claw_shot_pursue_yes_button");
      pursueYesBtn.addEventListener("click", function () {
        st.pursueChoice = "yes";
        renderCombatModal();
      });
      var pursueNoBtn = document.createElement("button");
      pursueNoBtn.type = "button";
      pursueNoBtn.textContent = window.I18N.t("claw_shot_pursue_no_button");
      pursueNoBtn.addEventListener("click", function () {
        st.pursueChoice = "no";
        combatSkillState = null;
        resetClawShotState();
        renderCombatModal();
      });
      pursuePromptRow.appendChild(pursueYesBtn);
      pursuePromptRow.appendChild(pursueNoBtn);
      content.appendChild(pursuePromptRow);
      return;
    }

    if (st.pursueChoice === "no") return;

    // --- 追撃：近接武器選択＋二択＋骰子3消費 ---
    var Weapons2 = window.PriTestWeapons;
    var meleeWeaponIds = (c.equippedWeaponIds || []).filter(function (weaponId) {
      var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
      var weapon = Weapons2.get(baseId);
      if (!weapon) return false;
      var category = Weapons2.getCategory(weapon.category);
      return category && !category.isShield && category.id !== "staff" && category.id !== "sacred_seal";
    });
    if (!meleeWeaponIds.length) {
      var noWeaponNote = document.createElement("p");
      noWeaponNote.className = "threat-ref-body";
      noWeaponNote.textContent = window.I18N.t("claw_shot_pursue_no_weapon_note");
      content.appendChild(noWeaponNote);
      return;
    }

    var weaponSelect = document.createElement("select");
    meleeWeaponIds.forEach(function (weaponId) {
      var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
      var weapon = Weapons2.get(baseId);
      var opt = document.createElement("option");
      opt.value = weaponId;
      opt.textContent = Weapons2.localizedText(weapon.name);
      weaponSelect.appendChild(opt);
    });
    weaponSelect.value = st.pursueWeaponId || meleeWeaponIds[0];
    weaponSelect.addEventListener("change", function () {
      st.pursueWeaponId = weaponSelect.value;
    });
    st.pursueWeaponId = weaponSelect.value;
    content.appendChild(weaponSelect);

    var pursueChoiceRow = document.createElement("div");
    pursueChoiceRow.className = "wb-row";
    [
      { key: "damage", label: window.I18N.t("claw_shot_choice_damage_label") },
      { key: "revival", label: window.I18N.t("claw_shot_choice_revival_label") },
    ].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      if (st.pursueEffectChoice === opt.key) btn.classList.add("active");
      btn.addEventListener("click", function () {
        st.pursueEffectChoice = opt.key;
        renderCombatModal();
      });
      pursueChoiceRow.appendChild(btn);
    });
    content.appendChild(pursueChoiceRow);

    if (st.pursueEffectChoice) {
      // 本文「額外支付『骰子消耗：3』」＝出目合計3（個数ではない、ユーザー確認済み）。
      var pursueCost = { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: 3, fpCost: 0, hpCost: 0 };
      renderDiceCostAction(c, content, pursueCost, function (dice, costLines) {
        var pursueNote;
        if (st.pursueEffectChoice === "damage") {
          // 本文「【總合傷害：相當於1Hit+▲】」は「威力：」節を持たないためartSkillPowerValueでは
          // 解決できない（常にnullを返し、ダメージ非表示のまま無言でフォールバックしていた）。
          // 実際には選んだ武器の1Hitダメージそのものなので、computeWeaponDamageから直接引く。
          var pursueDamage = CharacterDrawer.computeWeaponDamage(c, st.pursueWeaponId);
          pursueNote = pursueDamage
            ? window.I18N.t("action_log_damage_total", {
                value: CharacterDrawer.formatValueWithSymbol(pursueDamage.hit1Damage, pursueDamage.hit1Symbol),
              })
            : window.I18N.t("claw_shot_choice_damage_label");
        } else {
          pursueNote = window.I18N.t("claw_shot_choice_revival_label");
        }
        var pursueLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
        // R1「技能強化（纏火）」：追撃で選んだ武器が「大劍」の場合のみ、本文をそのまま
        // 黃字注記として残す（火：1D自体は出目未確定のためGM/玩家がその場で振る）。
        var pursueBaseId = st.pursueWeaponId.indexOf("::") !== -1 ? st.pursueWeaponId.slice(0, st.pursueWeaponId.indexOf("::")) : st.pursueWeaponId;
        var pursueWeapon = Weapons2.get(pursueBaseId);
        var pursueCategory = pursueWeapon ? Weapons2.getCategory(pursueWeapon.category) : null;
        if (pursueCategory && pursueCategory.id === "greatsword") {
          var clawShotFireEffect = CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（纏火）", "スキル強化（炎の纏い）"]);
          if (clawShotFireEffect) {
            pursueLines = pursueLines.concat([CharacterTypes.localizedText(clawShotFireEffect.body)]);
            if (!c.weaponAttributeTags) c.weaponAttributeTags = {};
            c.weaponAttributeTags[st.pursueWeaponId] = Weapons2.localizedText({ zh: "火", ja: "炎" });
            c._clawShotFireTagWeaponId = st.pursueWeaponId;
          }
        }
        addActionBox(c, window.I18N.t("claw_shot_pursue_label"), pursueNote, pursueLines);
        addLog("log_claw_shot_pursue", { character: c.name, effect: pursueNote });
        combatSkillState = null;
        resetClawShotState();
        renderCombatModal();
      });
    }
  }

  // 骰子消費を伴う4アクション（聖杯瓶使用／消耗品使用／移動区域／装備変更）共通の骰子選択UI。
  function renderCombatDicePicker(c, content) {
    var poolWrap = document.createElement("div");
    poolWrap.className = "combat-dice-picker";
    (c.dicePool || []).forEach(function (value, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dice-item combat-dice-pick-btn";
      btn.textContent = value;
      if (combatDiceSelection.indexOf(idx) !== -1) btn.classList.add("active");
      btn.addEventListener("click", function () {
        var i = combatDiceSelection.indexOf(idx);
        if (i === -1) combatDiceSelection.push(idx);
        else combatDiceSelection.splice(i, 1);
        renderCombatModal();
      });
      poolWrap.appendChild(btn);
    });
    content.appendChild(poolWrap);
    if (!(c.dicePool || []).length) {
      var note = document.createElement("p");
      note.className = "threat-ref-body";
      note.textContent = window.I18N.t("combat_no_dice_note");
      content.appendChild(note);
    }
  }

  // 骰子決済（＋あればFP消費）を伴う汎用アクションUI。costの条件（コスト無しならとにかく
  // 1個以上選べば良い）を満たし、FPが足りていれば確定ボタンが有効になる。確定時にonConfirm(dice)
  // を呼んでから骰子/FPを消費・保存・再描画する。
  function renderDiceCostAction(c, content, cost, onConfirm) {
    if (cost && cost.diceKind) {
      var desc = CharacterDrawer.describeDiceCost(cost);
      if (desc) {
        var descEl = document.createElement("p");
        descEl.className = "threat-ref-body";
        descEl.textContent = desc;
        content.appendChild(descEl);
      }
    }
    if (cost && cost.fpCost) {
      var fpEl = document.createElement("p");
      fpEl.className = "threat-ref-body";
      fpEl.textContent = window.I18N.t("dice_cost_fp_label", { fp: cost.fpCost });
      content.appendChild(fpEl);
    }
    if (cost && cost.hpCost) {
      var hpEl = document.createElement("p");
      hpEl.className = "threat-ref-body";
      hpEl.textContent = window.I18N.t("dice_cost_hp_label", { hp: cost.hpCost });
      content.appendChild(hpEl);
    }

    renderCombatDicePicker(c, content);

    var selectedValues = combatDiceSelection.map(function (idx) {
      return c.dicePool[idx];
    });
    // validateDiceSelectionは骰子コストが無い（diceKindがnull、例：「コスト：使用回数●」の
    // ように使用回数だけを消費する技能）場合、骰子0個の選択を正当とみなす（骰子を1個も
    // 選ばなくても確定できる）。攻撃action等、常に骰子コストを持つ呼び出し元には影響しない。
    var diceValid = CharacterDrawer.validateDiceSelection(cost, selectedValues);
    var fpOk = !cost || !cost.fpCost || (c.fp && c.fp.current >= cost.fpCost);
    var hpOk = !cost || !cost.hpCost || (c.hp && c.hp.current >= cost.hpCost);
    if (cost && cost.fpCost && !fpOk) showCombatError("combat_error_insufficient_fp");
    else if (cost && cost.hpCost && !hpOk) showCombatError("combat_error_insufficient_hp");

    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("combat_confirm_button");
    confirmBtn.disabled = !diceValid || !fpOk || !hpOk;
    confirmBtn.addEventListener("click", function () {
      var dice = consumeCombatDice(c);
      var costLines = [];
      if (cost && cost.fpCost) {
        c.fp.current = Math.max(0, c.fp.current - cost.fpCost);
        costLines.push(window.I18N.t("action_log_fp_used", { fp: cost.fpCost }));
      }
      if (cost && cost.hpCost) {
        c.hp.current = Math.max(0, c.hp.current - cost.hpCost);
        costLines.push(window.I18N.t("action_log_hp_used", { hp: cost.hpCost }));
      }
      combatDiceSelection = [];
      saveRosterCharacters();
      onConfirm(dice, costLines);
      renderCharacterRoster();
      renderCombatModal();
      if (cost && cost.hpCost) checkNearDeathTrigger(c);
    });
    content.appendChild(confirmBtn);
  }

  function consumeCombatDice(c) {
    var indices = combatDiceSelection.slice().sort(function (a, b) {
      return b - a;
    });
    var consumed = indices.map(function (idx) {
      return c.dicePool[idx];
    });
    indices.forEach(function (idx) {
      c.dicePool.splice(idx, 1);
    });
    return consumed.reverse();
  }

  // R5 遺物効果「聖杯瓶可回復FP」：使用選択中の一時状態（true=FPへ切替 / false・null=通常のHP回復）。
  // 額外階段限定（ユーザー確認済みの仕様）で、習得済みキャラのみ切替の問いかけを出す。
  var flaskFpChoice = null;
  var flaskExpandPcId = null;

  function renderCombatFlaskAction(c, content) {
    var available = c.flaskBase.current > 0 || (c.flaskExtra && c.flaskExtra.current > 0);
    if (!available) {
      showCombatError("combat_error_no_flask");
      return;
    }
    var healAmount = (c.flaskHealAmount || 0) + (CharacterDrawer.getFlaskHealBonus ? CharacterDrawer.getFlaskHealBonus(c) : 0);
    var healLabel = document.createElement("p");
    healLabel.className = "threat-ref-body";
    healLabel.textContent = window.I18N.t("combat_flask_heal_label", {
      squares: healAmount > 0 ? "□".repeat(Math.min(healAmount, 20)) : "□□□",
      amount: healAmount,
    });
    content.appendChild(healLabel);

    var canChooseFp = state.actionPhase === "extra" && !!CharacterDrawer.findLearnedRelicEffectByName(c, ["聖杯瓶可回復FP", "聖杯瓶でFP回復可能"]);
    if (canChooseFp) {
      var fpChoiceRow = document.createElement("div");
      fpChoiceRow.className = "wb-row";
      var fpChoiceLabel = document.createElement("span");
      fpChoiceLabel.className = "weapon-damage-tag";
      fpChoiceLabel.textContent = window.I18N.t("combat_flask_fp_choice_question");
      fpChoiceRow.appendChild(fpChoiceLabel);
      var fpChoiceBtn = document.createElement("button");
      fpChoiceBtn.type = "button";
      fpChoiceBtn.textContent = window.I18N.t(flaskFpChoice ? "combat_flask_fp_choice_on_label" : "combat_flask_fp_choice_off_label");
      if (flaskFpChoice) fpChoiceBtn.classList.add("active");
      fpChoiceBtn.addEventListener("click", function () {
        flaskFpChoice = !flaskFpChoice;
        renderCombatModal();
      });
      fpChoiceRow.appendChild(fpChoiceBtn);
      content.appendChild(fpChoiceRow);
    } else {
      flaskFpChoice = null;
    }
    var useFp = canChooseFp && flaskFpChoice;

    // 遺物効果「道具效果擴大」：自身使用聖杯瓶時，可對自身以外的任意1名PC也發揮相同效果（任選）。
    var canExpandFlaskEffect = !!CharacterDrawer.findLearnedRelicEffectByName(c, ["道具效果擴大", "アイテム効果拡大"]);
    var flaskExpandOptions = canExpandFlaskEffect
      ? rosterCharacters.filter(function (rc) {
          return rc.entered && rc.id !== c.id;
        })
      : [];
    if (flaskExpandOptions.length) {
      var flaskExpandRow = document.createElement("div");
      flaskExpandRow.className = "wb-row";
      var flaskExpandToggleBtn = document.createElement("button");
      flaskExpandToggleBtn.type = "button";
      flaskExpandToggleBtn.textContent = window.I18N.t("consumable_expand_toggle_label");
      if (flaskExpandPcId) flaskExpandToggleBtn.classList.add("active");
      flaskExpandToggleBtn.addEventListener("click", function () {
        flaskExpandPcId = flaskExpandPcId ? null : flaskExpandOptions[0].id;
        renderCombatModal();
      });
      flaskExpandRow.appendChild(flaskExpandToggleBtn);
      content.appendChild(flaskExpandRow);

      if (flaskExpandPcId) {
        if (!flaskExpandOptions.some(function (rc) { return rc.id === flaskExpandPcId; })) {
          flaskExpandPcId = flaskExpandOptions[0].id;
        }
        var flaskExpandSelectRow = document.createElement("label");
        flaskExpandSelectRow.className = "field-row-block";
        flaskExpandSelectRow.textContent = window.I18N.t("consumable_other_pc_target_label");
        var flaskExpandSelect = document.createElement("select");
        flaskExpandOptions.forEach(function (rc) {
          var o = document.createElement("option");
          o.value = rc.id;
          o.textContent = rc.name;
          if (rc.id === flaskExpandPcId) o.selected = true;
          flaskExpandSelect.appendChild(o);
        });
        flaskExpandSelect.addEventListener("change", function () {
          flaskExpandPcId = flaskExpandSelect.value;
        });
        flaskExpandSelectRow.appendChild(flaskExpandSelect);
        content.appendChild(flaskExpandSelectRow);
      }
    } else {
      flaskExpandPcId = null;
    }

    renderCombatDicePicker(c, content);
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("combat_confirm_button");
    confirmBtn.disabled = !combatDiceSelection.length;
    confirmBtn.addEventListener("click", function () {
      var target = useFp ? c.fp : c.hp;
      if (target.current + healAmount > target.max) {
        if (
          !window.confirm(
            window.I18N.t("combat_flask_overflow_confirm", { current: target.current, max: target.max, amount: healAmount })
          )
        ) {
          return;
        }
      }
      var dice = consumeCombatDice(c);
      if (c.flaskBase.current > 0) c.flaskBase.current -= 1;
      else c.flaskExtra.current -= 1;
      target.current = Math.min(target.max, target.current + healAmount);
      var flaskLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })];
      // 遺物効果「道具效果擴大」：自身以外任意1名PCにも同様の効果を発揮する（選んだ場合のみ）。
      if (flaskExpandPcId) {
        var flaskOtherPc = rosterCharacters.filter(function (rc) {
          return rc.id === flaskExpandPcId;
        })[0];
        if (flaskOtherPc) {
          var otherTarget = useFp ? flaskOtherPc.fp : flaskOtherPc.hp;
          otherTarget.current = Math.min(otherTarget.max, otherTarget.current + healAmount);
          flaskLines = flaskLines.concat([window.I18N.t("consumable_effect_expand_applied", { name: flaskOtherPc.name })]);
        }
      }
      combatDiceSelection = [];
      flaskFpChoice = null;
      flaskExpandPcId = null;
      saveRosterCharacters();
      addLog(useFp ? "log_combat_flask_use_fp" : "log_combat_flask_use", { character: c.name, dice: dice.join("、"), amount: healAmount });
      addActionBox(
        c,
        window.I18N.t("combat_action_flask"),
        window.I18N.t(useFp ? "action_log_fp_heal_total" : "action_log_heal_total", { value: healAmount }),
        flaskLines
      );
      renderCharacterRoster();
      renderCombatModal();
    });
    content.appendChild(confirmBtn);

    // 遺物効果「一口氣飲盡」：聖杯瓶「使用次數：2」を消費すれば、骰子を使わず目前HPを最大値まで
    // 全回復できる（守護者専用、通常のHP回復量ボタンとは別枠の選択肢として並べる）。
    var totalFlaskUses = (c.flaskBase ? c.flaskBase.current : 0) + (c.flaskExtra ? c.flaskExtra.current : 0);
    if (totalFlaskUses >= 2 && CharacterDrawer.findLearnedRelicEffectByName(c, ["一口氣飲盡", "一気飲み"])) {
      var chugBtn = document.createElement("button");
      chugBtn.type = "button";
      chugBtn.className = "combat-attack-hit-btn";
      chugBtn.textContent = window.I18N.t("combat_flask_chug_button");
      chugBtn.addEventListener("click", function () {
        var remaining = 2;
        if (c.flaskBase.current > 0) {
          var fromBase = Math.min(c.flaskBase.current, remaining);
          c.flaskBase.current -= fromBase;
          remaining -= fromBase;
        }
        if (remaining > 0 && c.flaskExtra) c.flaskExtra.current = Math.max(0, c.flaskExtra.current - remaining);
        c.hp.current = c.hp.max;
        combatDiceSelection = [];
        flaskFpChoice = null;
        saveRosterCharacters();
        addLog("log_combat_flask_chug", { character: c.name });
        addActionBox(c, window.I18N.t("combat_flask_chug_button"), window.I18N.t("action_log_heal_full_note"), []);
        renderCharacterRoster();
        renderCombatModal();
      });
      content.appendChild(chugBtn);
    }
  }


  // 消耗品ごとの対象種別：selfは自身のみ（対象選択UI不要）、enemyは選択中の敵人から1体選ぶ、
  // otherPcは自身以外のPCから1人選ぶ（溫石）、ailmentは自身が蓄積中の異常状態から1つ選ぶ
  // （苔藥）、greaseは武器または盾を選ぶ（塗脂）、allPcは入場中の全PCが対象（高揚之香）。
  var CONSUMABLE_TARGET_KIND = {
    item_hero_meat_chunk: "self",
    item_turtle_neck_pickle: "self",
    item_shard_of_starlight: "self",
    item_bitter_medicine: "ailment",
    item_grease: "grease",
    item_warming_stone: "otherPc",
    item_throwing_dagger: "enemy",
    item_azure_throwing_knife: "enemy",
    item_bone_poison_dart: "enemy",
    item_folding_shuriken: "enemy",
    item_throwing_pot: "enemy",
    item_perfume_acid_spray: "enemy",
    item_perfume_iron_pot_spray: "self",
    item_perfume_spark_aroma: "enemy",
    item_perfume_uplifting_aroma: "allPc",
    item_perfume_poison_spray: "enemy",
  };

  // 遺物効果「道具效果擴大」：習得済みの角色がこの一覧のいずれかの消耗品を使う場合、自身以外
  // 任意1名PCへも同様の効果を発揮できる（聖杯瓶はrenderCombatFlaskAction側で別途処理する）。
  var ITEM_EFFECT_EXPAND_IDS = ["item_hero_meat_chunk", "item_turtle_neck_pickle", "item_shard_of_starlight", "item_bitter_medicine"];

  var combatConsumableOtherPcId = null;
  var combatConsumableAilmentLabel = null;
  var combatConsumableGreaseKind = null; // "weapon" | "shield" | null
  var combatConsumableGreaseWeaponId = null;
  var combatConsumableGreaseElementIdx = 0;

  function resetCombatConsumableSubChoices() {
    combatConsumableOtherPcId = null;
    combatConsumableAilmentLabel = null;
    combatConsumableGreaseKind = null;
    combatConsumableGreaseWeaponId = null;
    combatConsumableGreaseElementIdx = 0;
  }

  function renderCombatConsumableAction(c, content) {
    var Consumables = window.PriTestConsumables;
    var byItemId = {};
    (c.consumables || []).forEach(function (inst) {
      if (!byItemId[inst.itemId]) byItemId[inst.itemId] = [];
      byItemId[inst.itemId].push(inst);
    });
    var ownedIds = Object.keys(byItemId);
    if (!ownedIds.length) {
      showCombatError("combat_error_no_consumable");
      return;
    }
    var selLabel = document.createElement("label");
    selLabel.className = "field-row-block";
    selLabel.textContent = window.I18N.t("combat_select_consumable_label");
    var sel = document.createElement("select");
    ownedIds.forEach(function (id) {
      var item = Consumables.get(id);
      if (!item) return;
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = Consumables.localizedText(item.name) + "（" + byItemId[id].length + "）";
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      resetCombatConsumableSubChoices();
      renderCombatModal();
    });
    selLabel.appendChild(sel);
    content.appendChild(selLabel);

    var selectedId = sel.value;
    var targetKind = CONSUMABLE_TARGET_KIND[selectedId] || "self";

    // 學者「博聞強識」：自身が使う消耗品は常に等級2效果が發揮され、支払った骰子の中に出目
    // 「5」または「6」が1つでもあれば、その使用は使用回数を消費しない（#7：従来は範囲が
    // 曖昧なままGMへのYes/No手動確認にしていたが、実際の規則は出目5・6のどちらでも良い）。
    // これは実際に支払われた骰子（consumeCombatDice後のdice配列）から自動判定するため、
    // ここでは案内文のみ表示する（判定本体は確定ボタンのハンドラ側）。
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var hasCarriedKnowledge =
      type &&
      (type.abilities || []).some(function (entry) {
        return entry.id === "carried_knowledge";
      });
    if (hasCarriedKnowledge) {
      var level2Note = document.createElement("p");
      level2Note.className = "threat-ref-body";
      level2Note.textContent = window.I18N.t("carried_knowledge_level2_note");
      content.appendChild(level2Note);
      var ckHint = document.createElement("p");
      ckHint.className = "threat-ref-body";
      ckHint.textContent = window.I18N.t("carried_knowledge_no_consume_hint");
      content.appendChild(ckHint);
    }
    // 遺物効果「節約術」：出目「6」を骰子消耗に含めて支払うと、その消耗品の使用次數を
    // 1回復する（上限あり）。学習済みの場合のみ、確定前にその旨を案内する。
    if (CharacterDrawer.findLearnedRelicEffectByName(c, ["節約術", "節約術"])) {
      var frugalHint = document.createElement("p");
      frugalHint.className = "threat-ref-body";
      frugalHint.textContent = window.I18N.t("frugal_technique_hint");
      content.appendChild(frugalHint);
    }

    // 對象選択UI（種別ごと）。
    var enemyOptions = targetKind === "enemy" ? resolveSelectedEnemyOptions() : [];
    if (targetKind === "enemy" && enemyOptions.length > 1) {
      if (!enemyOptions.some(function (opt) { return opt.key === combatAttackTargetEnemyKey; })) {
        combatAttackTargetEnemyKey = enemyOptions[0].key;
      }
      var enemyTargetRow = document.createElement("div");
      enemyTargetRow.className = "combat-attack-target-row";
      var enemyTargetLabel = document.createElement("label");
      enemyTargetLabel.textContent = window.I18N.t("combat_attack_target_enemy_label");
      var enemyTargetSelect = document.createElement("select");
      enemyOptions.forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt.key;
        o.textContent = opt.name;
        if (opt.key === combatAttackTargetEnemyKey) o.selected = true;
        enemyTargetSelect.appendChild(o);
      });
      enemyTargetSelect.addEventListener("change", function () {
        combatAttackTargetEnemyKey = enemyTargetSelect.value;
      });
      enemyTargetLabel.appendChild(enemyTargetSelect);
      enemyTargetRow.appendChild(enemyTargetLabel);
      content.appendChild(enemyTargetRow);
    } else if (targetKind === "enemy" && enemyOptions.length === 1) {
      combatAttackTargetEnemyKey = enemyOptions[0].key;
    }

    var otherPcOptions = [];
    if (targetKind === "otherPc") {
      otherPcOptions = rosterCharacters.filter(function (rc) {
        return rc.entered && rc.id !== c.id;
      });
      if (otherPcOptions.length) {
        if (!otherPcOptions.some(function (rc) { return rc.id === combatConsumableOtherPcId; })) {
          combatConsumableOtherPcId = otherPcOptions[0].id;
        }
        var otherPcRow = document.createElement("label");
        otherPcRow.className = "field-row-block";
        otherPcRow.textContent = window.I18N.t("consumable_other_pc_target_label");
        var otherPcSelect = document.createElement("select");
        otherPcOptions.forEach(function (rc) {
          var o = document.createElement("option");
          o.value = rc.id;
          o.textContent = rc.name;
          if (rc.id === combatConsumableOtherPcId) o.selected = true;
          otherPcSelect.appendChild(o);
        });
        otherPcSelect.addEventListener("change", function () {
          combatConsumableOtherPcId = otherPcSelect.value;
        });
        otherPcRow.appendChild(otherPcSelect);
        content.appendChild(otherPcRow);
      }
    }

    var ailmentOptions = [];
    if (targetKind === "ailment") {
      var received = (state.battle.attributeStatus && state.battle.attributeStatus.received[c.id]) || {};
      ailmentOptions = ATTRIBUTE_STATUS_AILMENT_OPTIONS.filter(function (opt) {
        return (received[opt.zh] || received[opt.ja] || 0) > 0;
      });
      if (ailmentOptions.length) {
        if (!combatConsumableAilmentLabel || !ailmentOptions.some(function (o) { return o.zh === combatConsumableAilmentLabel; })) {
          combatConsumableAilmentLabel = ailmentOptions[0].zh;
        }
        var ailmentRow = document.createElement("label");
        ailmentRow.className = "field-row-block";
        ailmentRow.textContent = window.I18N.t("consumable_ailment_target_label");
        var ailmentSelect = document.createElement("select");
        ailmentOptions.forEach(function (opt) {
          var o = document.createElement("option");
          o.value = opt.zh;
          o.textContent = CharacterTypes.localizedText(opt);
          if (opt.zh === combatConsumableAilmentLabel) o.selected = true;
          ailmentSelect.appendChild(o);
        });
        ailmentSelect.addEventListener("change", function () {
          combatConsumableAilmentLabel = ailmentSelect.value;
        });
        ailmentRow.appendChild(ailmentSelect);
        content.appendChild(ailmentRow);
      } else {
        var noAilmentNote = document.createElement("p");
        noAilmentNote.className = "threat-ref-body";
        noAilmentNote.textContent = window.I18N.t("consumable_no_ailment_note");
        content.appendChild(noAilmentNote);
      }
    }

    // 遺物効果「道具效果擴大」：自身使用消耗品「聖杯瓶／勇者的肉塊／龜首漬／星光碎片／苔玉」時，
    // 可對自身以外的任意1名PC也發揮相同效果（任選，預設不擴大）。
    var canExpandItemEffect =
      ITEM_EFFECT_EXPAND_IDS.indexOf(selectedId) !== -1 &&
      !!CharacterDrawer.findLearnedRelicEffectByName(c, ["道具效果擴大", "アイテム効果拡大"]);
    var expandPcOptions = [];
    if (canExpandItemEffect) {
      expandPcOptions = rosterCharacters.filter(function (rc) {
        return rc.entered && rc.id !== c.id;
      });
      if (expandPcOptions.length) {
        var expandRow = document.createElement("div");
        expandRow.className = "wb-row";
        var expandToggleBtn = document.createElement("button");
        expandToggleBtn.type = "button";
        expandToggleBtn.textContent = window.I18N.t("consumable_expand_toggle_label");
        if (combatConsumableOtherPcId) expandToggleBtn.classList.add("active");
        expandToggleBtn.addEventListener("click", function () {
          combatConsumableOtherPcId = combatConsumableOtherPcId ? null : expandPcOptions[0].id;
          renderCombatModal();
        });
        expandRow.appendChild(expandToggleBtn);
        content.appendChild(expandRow);

        if (combatConsumableOtherPcId) {
          if (!expandPcOptions.some(function (rc) { return rc.id === combatConsumableOtherPcId; })) {
            combatConsumableOtherPcId = expandPcOptions[0].id;
          }
          var expandSelectRow = document.createElement("label");
          expandSelectRow.className = "field-row-block";
          expandSelectRow.textContent = window.I18N.t("consumable_other_pc_target_label");
          var expandSelect = document.createElement("select");
          expandPcOptions.forEach(function (rc) {
            var o = document.createElement("option");
            o.value = rc.id;
            o.textContent = rc.name;
            if (rc.id === combatConsumableOtherPcId) o.selected = true;
            expandSelect.appendChild(o);
          });
          expandSelect.addEventListener("change", function () {
            combatConsumableOtherPcId = expandSelect.value;
          });
          expandSelectRow.appendChild(expandSelect);
          content.appendChild(expandSelectRow);
        }
      }
    }

    var greaseWeaponOptions = [];
    if (targetKind === "grease") {
      var Weapons = window.PriTestWeapons;
      greaseWeaponOptions = (c.equippedWeaponIds || [])
        .map(function (weaponId) {
          var weapon = Weapons.get(weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId);
          if (!weapon) return null;
          var category = Weapons.getCategory(weapon.category);
          return { weaponId: weaponId, name: Weapons.localizedText(weapon.name), isShield: !!(category && category.isShield) };
        })
        .filter(Boolean);
      if (greaseWeaponOptions.length) {
        if (!combatConsumableGreaseKind) combatConsumableGreaseKind = "weapon";
        var greaseKindRow = document.createElement("div");
        greaseKindRow.className = "wb-row";
        [
          { key: "weapon", label: window.I18N.t("consumable_grease_kind_weapon_label") },
          { key: "shield", label: window.I18N.t("consumable_grease_kind_shield_label") },
        ].forEach(function (opt) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = opt.label;
          if (combatConsumableGreaseKind === opt.key) btn.classList.add("active");
          btn.addEventListener("click", function () {
            combatConsumableGreaseKind = opt.key;
            combatConsumableGreaseWeaponId = null;
            renderCombatModal();
          });
          greaseKindRow.appendChild(btn);
        });
        content.appendChild(greaseKindRow);

        var filteredGreaseOptions = greaseWeaponOptions.filter(function (o) {
          return combatConsumableGreaseKind === "shield" ? o.isShield : !o.isShield;
        });
        if (filteredGreaseOptions.length) {
          if (!filteredGreaseOptions.some(function (o) { return o.weaponId === combatConsumableGreaseWeaponId; })) {
            combatConsumableGreaseWeaponId = filteredGreaseOptions[0].weaponId;
          }
          var greaseWeaponRow = document.createElement("label");
          greaseWeaponRow.className = "field-row-block";
          greaseWeaponRow.textContent = window.I18N.t("consumable_grease_target_label");
          var greaseWeaponSelect = document.createElement("select");
          filteredGreaseOptions.forEach(function (o) {
            var opt = document.createElement("option");
            opt.value = o.weaponId;
            opt.textContent = o.name;
            if (o.weaponId === combatConsumableGreaseWeaponId) opt.selected = true;
            greaseWeaponSelect.appendChild(opt);
          });
          greaseWeaponSelect.addEventListener("change", function () {
            combatConsumableGreaseWeaponId = greaseWeaponSelect.value;
          });
          greaseWeaponRow.appendChild(greaseWeaponSelect);
          content.appendChild(greaseWeaponRow);
        } else {
          combatConsumableGreaseWeaponId = null;
        }

        if (combatConsumableGreaseKind === "weapon") {
          var greaseElementRow = document.createElement("label");
          greaseElementRow.className = "field-row-block";
          greaseElementRow.textContent = window.I18N.t("consumable_grease_element_label");
          var greaseElementSelect = document.createElement("select");
          ATTRIBUTE_STATUS_ELEMENT_OPTIONS.forEach(function (opt, idx) {
            var o = document.createElement("option");
            o.value = String(idx);
            o.textContent = CharacterTypes.localizedText(opt);
            if (idx === combatConsumableGreaseElementIdx) o.selected = true;
            greaseElementSelect.appendChild(o);
          });
          greaseElementSelect.addEventListener("change", function () {
            combatConsumableGreaseElementIdx = Number(greaseElementSelect.value);
          });
          greaseElementRow.appendChild(greaseElementSelect);
          content.appendChild(greaseElementRow);
        }
      } else {
        var noWeaponNote = document.createElement("p");
        noWeaponNote.className = "threat-ref-body";
        noWeaponNote.textContent = window.I18N.t("consumable_no_weapon_note");
        content.appendChild(noWeaponNote);
      }
    }

    renderCombatDicePicker(c, content);
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("combat_confirm_button");
    confirmBtn.disabled = !combatDiceSelection.length;
    confirmBtn.addEventListener("click", function () {
      var id = sel.value;
      var item = Consumables.get(id);
      var dice = consumeCombatDice(c);
      // 同じ種類の中で、既に使いかけ（残り回数が最も少ない）のインスタンスから優先的に消費する。
      var instances = (c.consumables || []).filter(function (inst) {
        return inst.itemId === id;
      });
      instances.sort(function (a, b) {
        return a.usesRemaining - b.usesRemaining;
      });
      var target = instances[0];
      var removedInstanceId = null;
      // 學者「博聞強識」：支払った骰子（dice）に出目5または6が1つでもあれば、この使用は
      // 使用回数を消費しない（#7、節約術の「出目6のみ」判定とは対象の出目が異なる点に注意）。
      var carriedKnowledgeNoConsume = hasCarriedKnowledge && (dice.indexOf(5) !== -1 || dice.indexOf(6) !== -1);
      if (target && !carriedKnowledgeNoConsume) {
        target.usesRemaining -= 1;
        if (target.usesRemaining <= 0) {
          var idx = c.consumables.indexOf(target);
          if (idx !== -1) {
            removedInstanceId = target.id;
            c.consumables.splice(idx, 1);
          }
        }
      }
      // 遺物効果「節約術」：使用消耗品時，若以指定出目「6」支付骰子消耗（此消耗品原本的
      // 「消耗：①」＝支付1個出目為1的骰子），則將該消耗品的使用次數回復「○1個」
      // （即：這次使用不會實際減少使用次數）。
      var frugalTriggered = false;
      if (dice.indexOf(6) !== -1 && CharacterDrawer.findLearnedRelicEffectByName(c, ["節約術", "節約術"])) {
        frugalTriggered = true;
        if (removedInstanceId) {
          if (!c.consumables) c.consumables = [];
          c.consumables.push({ id: removedInstanceId, itemId: id, usesRemaining: 1 });
        } else if (target) {
          var maxUses = item && item.uses ? item.uses : target.usesRemaining + 1;
          target.usesRemaining = Math.min(maxUses, target.usesRemaining + 1);
        }
      }
      var applyLevel2 = !!hasCarriedKnowledge;
      var effectResult = applyConsumableEffect(c, id, applyLevel2, {
        enemyKey: combatAttackTargetEnemyKey,
        otherPcId: combatConsumableOtherPcId,
        ailmentLabel: combatConsumableAilmentLabel,
        greaseKind: combatConsumableGreaseKind,
        greaseWeaponId: combatConsumableGreaseWeaponId,
        greaseElement: ATTRIBUTE_STATUS_ELEMENT_OPTIONS[combatConsumableGreaseElementIdx],
      });
      combatDiceSelection = [];
      resetCombatConsumableSubChoices();
      saveRosterCharacters();
      saveState();
      addLog("log_combat_consumable_use", {
        character: c.name,
        item: item ? Consumables.localizedText(item.name) : id,
        dice: dice.join("、"),
      });
      var lines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(effectResult.lines || []);
      if (frugalTriggered) lines = lines.concat([window.I18N.t("consumable_effect_frugal_applied")]);
      addActionBox(c, item ? Consumables.localizedText(item.name) : id, effectResult.total || null, lines);
      renderAttributeStatusList();
      renderCharacterRoster();
      renderCombatModal();
    });
    content.appendChild(confirmBtn);
  }

  // 消耗品の実際の効果適用。applyLevel2はhasCarriedKnowledge（學者「博聞強識」）の時のみtrue
  // （それ以外は等級2效果の発揮条件が個別に不明瞭なため、reminder注記のみに留める）。
  // targetは対象選択UIで決まった値（enemyKey／otherPcId／ailmentLabel／grease*）。
  // 戻り値：{ total: 実行ログの見出し用文字列|null, lines: 実行ログ本文の配列 }
  function applyConsumableEffect(c, itemId, applyLevel2, target) {
    var lines = [];
    var total = null;

    // 學者（暗影）「使用通用消耗品時HP回復」：為5個通用消耗品（勇者的肉塊／龜首漬／星光的碎片／
    // 苔藥＝relic本文寫作「苔玉」，本App唯一含「苔」的消耗品／溫石＝relic本文寫作「溫暖石」）
    // 的效果追加「對目標施加『HP回復：□』」（+1，對每個實際受到該消耗品效果的目標都適用，
    // 含「道具效果擴大」延伸的另一目標）。
    var GENERIC_HEAL_BONUS_ITEM_IDS = [
      "item_hero_meat_chunk",
      "item_turtle_neck_pickle",
      "item_shard_of_starlight",
      "item_bitter_medicine",
      "item_warming_stone",
    ];
    var genericConsumableHealBonus =
      GENERIC_HEAL_BONUS_ITEM_IDS.indexOf(itemId) !== -1 &&
      CharacterDrawer.findLearnedRelicEffectByName(c, ["使用通用消耗品時HP回復", "汎用消耗品使用でHP回復"])
        ? 1
        : 0;

    function healSelf(hpAmount, fpAmount) {
      if (hpAmount) c.hp.current = Math.min(c.hp.max, c.hp.current + hpAmount);
      if (fpAmount) c.fp.current = Math.min(c.fp.max, c.fp.current + fpAmount);
    }

    // 遺物効果「道具效果擴大」：勇者的肉塊／龜首漬／星光碎片／苔藥に限り、選んだ対象PCの
    // rosterCharacters上のオブジェクトを返す（未選択ならnull）。
    function expandTargetPc() {
      if (!target.otherPcId) return null;
      return (
        rosterCharacters.filter(function (rc) {
          return rc.id === target.otherPcId;
        })[0] || null
      );
    }
    function pushExpandNote(otherPc) {
      if (otherPc) lines.push(window.I18N.t("consumable_effect_expand_applied", { name: otherPc.name }));
    }

    if (itemId === "item_hero_meat_chunk") {
      c._heroMeatBuffLevel = applyLevel2 ? 2 : 1;
      lines.push(window.I18N.t("consumable_effect_hero_meat_applied"));
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      if (genericConsumableHealBonus) {
        healSelf(genericConsumableHealBonus, 0);
        lines.push(window.I18N.t("action_log_heal_total", { value: genericConsumableHealBonus }));
      }
      var heroMeatOther = expandTargetPc();
      if (heroMeatOther) {
        heroMeatOther._heroMeatBuffLevel = applyLevel2 ? 2 : 1;
        if (genericConsumableHealBonus) heroMeatOther.hp.current = Math.min(heroMeatOther.hp.max, heroMeatOther.hp.current + genericConsumableHealBonus);
        pushExpandNote(heroMeatOther);
      }
    } else if (itemId === "item_turtle_neck_pickle") {
      if (!c.dicePool) c.dicePool = [];
      c.dicePool.push(1);
      lines.push(window.I18N.t("consumable_effect_turtle_neck_applied"));
      var turtleHeal = (applyLevel2 ? 2 : 0) + genericConsumableHealBonus;
      if (turtleHeal) {
        healSelf(turtleHeal, 0);
        lines.push(window.I18N.t("action_log_heal_total", { value: turtleHeal }));
      }
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      var turtleOther = expandTargetPc();
      if (turtleOther) {
        if (!turtleOther.dicePool) turtleOther.dicePool = [];
        turtleOther.dicePool.push(1);
        if (turtleHeal) turtleOther.hp.current = Math.min(turtleOther.hp.max, turtleOther.hp.current + turtleHeal);
        pushExpandNote(turtleOther);
      }
    } else if (itemId === "item_shard_of_starlight") {
      var fpAmount = applyLevel2 ? 6 : 3;
      healSelf(genericConsumableHealBonus, fpAmount);
      lines.push(window.I18N.t("action_log_fp_heal_total", { value: fpAmount }));
      if (genericConsumableHealBonus) lines.push(window.I18N.t("action_log_heal_total", { value: genericConsumableHealBonus }));
      var starlightOther = expandTargetPc();
      if (starlightOther) {
        starlightOther.fp.current = Math.min(starlightOther.fp.max, starlightOther.fp.current + fpAmount);
        if (genericConsumableHealBonus) starlightOther.hp.current = Math.min(starlightOther.hp.max, starlightOther.hp.current + genericConsumableHealBonus);
        pushExpandNote(starlightOther);
      }
    } else if (itemId === "item_bitter_medicine") {
      if (target.ailmentLabel) {
        removeReceivedAttributeStatus(c.id, target.ailmentLabel);
        lines.push(window.I18N.t("consumable_effect_bitter_medicine_applied", { label: target.ailmentLabel }));
      } else {
        lines.push(window.I18N.t("consumable_no_ailment_note"));
      }
      var bitterHeal = (applyLevel2 ? 2 : 0) + genericConsumableHealBonus;
      if (bitterHeal) {
        healSelf(bitterHeal, 0);
        lines.push(window.I18N.t("action_log_heal_total", { value: bitterHeal }));
      }
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      var bitterOther = expandTargetPc();
      if (bitterOther) {
        if (target.ailmentLabel) removeReceivedAttributeStatus(bitterOther.id, target.ailmentLabel);
        if (bitterHeal) bitterOther.hp.current = Math.min(bitterOther.hp.max, bitterOther.hp.current + bitterHeal);
        pushExpandNote(bitterOther);
      }
    } else if (itemId === "item_grease") {
      if (target.greaseKind === "shield" && target.greaseWeaponId) {
        c._greaseShieldId = target.greaseWeaponId;
        c._guardValueBonusUntilEndPhase = 10;
        c._guardValueBonusConsumed = false;
        lines.push(window.I18N.t("consumable_effect_grease_shield_applied"));
      } else if (target.greaseWeaponId && target.greaseElement) {
        c._greaseWeaponId = target.greaseWeaponId;
        c._greaseElementRef = target.greaseElement;
        lines.push(
          window.I18N.t("consumable_effect_grease_weapon_applied", { element: CharacterTypes.localizedText(target.greaseElement) })
        );
      } else {
        lines.push(window.I18N.t("consumable_no_weapon_note"));
      }
    } else if (itemId === "item_warming_stone") {
      var hpAmount = (applyLevel2 ? 4 : 2) + genericConsumableHealBonus;
      healSelf(hpAmount, 0);
      lines.push(window.I18N.t("action_log_heal_total", { value: hpAmount }));
      var otherPc = target.otherPcId
        ? rosterCharacters.filter(function (rc) {
            return rc.id === target.otherPcId;
          })[0]
        : null;
      if (otherPc) {
        otherPc.hp.current = Math.min(otherPc.hp.max, otherPc.hp.current + hpAmount);
        lines.push(window.I18N.t("consumable_effect_warming_stone_other", { name: otherPc.name, value: hpAmount }));
      }
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
    } else if (itemId === "item_throwing_dagger") {
      lines.push(window.I18N.t("consumable_effect_triangle_note"));
      if (applyLevel2) {
        total = window.I18N.t("action_log_damage_total", { value: 15 });
      } else {
        lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      }
    } else if (itemId === "item_azure_throwing_knife") {
      total = window.I18N.t("action_log_damage_total", { value: 2 });
    } else if (itemId === "item_bone_poison_dart") {
      var poisonRoll = 1 + Math.floor(Math.random() * 6);
      if (target.enemyKey) recordAttributeStatusDealt(c.id, target.enemyKey, "猛毒", poisonRoll);
      lines.push(window.I18N.t("action_log_status_accum", { label: CharacterTypes.localizedText({ zh: "猛毒", ja: "猛毒" }), value: poisonRoll }));
      if (applyLevel2) {
        total = window.I18N.t("action_log_damage_total", { value: 15 });
      } else {
        lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      }
    } else if (itemId === "item_folding_shuriken") {
      var shurikenRoll = 1 + Math.floor(Math.random() * 6);
      var shurikenDmg = shurikenRoll * 10 + (applyLevel2 ? 15 : 0);
      total = window.I18N.t("action_log_damage_total", { value: shurikenDmg });
      lines.push(window.I18N.t("consumable_effect_dice_rolled_note", { dice: shurikenRoll }));
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
    } else if (itemId === "item_throwing_pot") {
      lines.push(window.I18N.t("consumable_effect_throwing_pot_note"));
      if (applyLevel2) {
        total = window.I18N.t("action_log_damage_total", { value: 15 });
      } else {
        lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      }
    } else if (itemId === "item_perfume_acid_spray") {
      // #8：「敵人傷害-120・不重複」はGM手動反映のままだが、うっかり見落とされないよう
      // 「目前生效中的效果」（威脅一覧）にも同じ内容を残す（アクションログの一回性リマインドとは別）。
      if (!state.activeThreatEffects) state.activeThreatEffects = [];
      state.activeThreatEffects.push({
        id: "ate" + Date.now() + Math.floor(Math.random() * 1000),
        text: window.I18N.t("consumable_effect_acid_spray_note"),
      });
      saveState();
      renderActiveThreatEffects();
      lines.push(window.I18N.t("consumable_effect_acid_spray_note"));
      if (applyLevel2) {
        c._guardValueBonusUntilEndPhase = 10;
        c._guardValueBonusConsumed = false;
        lines.push(window.I18N.t("consumable_effect_guard_value_bonus_applied"));
      } else {
        lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      }
    } else if (itemId === "item_perfume_iron_pot_spray") {
      lines.push(window.I18N.t("consumable_effect_iron_pot_note"));
      if (applyLevel2) {
        lines.push(window.I18N.t("consumable_effect_iron_pot_level2_note"));
      } else {
        // #8：「下個行動階段開始時獲得的體力骰減少1個」は具体的な数値が確定しているため、
        // ■/1Dのような未確定値と違い自動反映できる（既存の「回合結束時，體力骰帶入1個」等と
        // 同じ_nextActionDicePenaltyの仕組みを再利用する）。
        c._nextActionDicePenalty = (c._nextActionDicePenalty || 0) + 1;
        lines.push(window.I18N.t("consumable_effect_level2_reminder"));
      }
    } else if (itemId === "item_perfume_spark_aroma") {
      // #8：等級1＝雜兵一格／敵人炎1、等級2＝追加雜兵一格／敵人炎+2（累計炎3）。
      // 以前は炎の値を1Dで振っていたが、GM確認により固定値だったため修正する。
      var sparkValue = 1 + (applyLevel2 ? 2 : 0);
      if (target.enemyKey) recordAttributeStatusDealt(c.id, target.enemyKey, "炎", sparkValue);
      lines.push(window.I18N.t("action_log_element_accum", { label: CharacterTypes.localizedText({ zh: "火", ja: "炎" }), value: sparkValue }));
      lines.push(window.I18N.t("consumable_effect_mob_damage_note"));
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
    } else if (itemId === "item_perfume_uplifting_aroma") {
      var upliftLevel = applyLevel2 ? 2 : 1;
      rosterCharacters.forEach(function (rc) {
        if (!rc.entered) return;
        rc._heroMeatBuffLevel = upliftLevel;
        rc._guardValueBonusUntilEndPhase = upliftLevel >= 2 ? 20 : 10;
        rc._guardValueBonusConsumed = false;
      });
      lines.push(window.I18N.t("consumable_effect_uplifting_aroma_applied"));
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
    } else if (itemId === "item_perfume_poison_spray") {
      // #8：等級1＝對雜兵HP損害1／敵人猛毒1、等級2＝累計對雜兵HP損害2／敵人猛毒3（固定値）。
      var toxinValue = 1 + (applyLevel2 ? 2 : 0);
      if (target.enemyKey) recordAttributeStatusDealt(c.id, target.enemyKey, "猛毒", toxinValue);
      lines.push(window.I18N.t("action_log_status_accum", { label: CharacterTypes.localizedText({ zh: "猛毒", ja: "猛毒" }), value: toxinValue }));
      lines.push(window.I18N.t("consumable_effect_mob_damage_note"));
      if (!applyLevel2) lines.push(window.I18N.t("consumable_effect_level2_reminder"));
    }

    return { total: total, lines: lines };
  }

  function renderCombatMoveAction(c, content) {
    var names = battlePositionNames();
    var idx = names.indexOf(c.name);
    if (idx === -1 || idx >= BATTLE_SLOT_COUNT) {
      var note = document.createElement("p");
      note.className = "threat-ref-body";
      note.textContent = window.I18N.t("combat_no_battle_slot_note");
      content.appendChild(note);
      return;
    }
    var currentLabel = document.createElement("p");
    currentLabel.className = "threat-ref-body";
    currentLabel.textContent = window.I18N.t("combat_move_current_area", {
      area: window.I18N.t(state.battle.front[idx] ? "dice_status_front" : "dice_status_back"),
    });
    content.appendChild(currentLabel);

    renderCombatDicePicker(c, content);
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("combat_confirm_button");
    confirmBtn.disabled = !combatDiceSelection.length;
    confirmBtn.addEventListener("click", function () {
      var dice = consumeCombatDice(c);
      combatDiceSelection = [];
      saveRosterCharacters();
      // renderCharacterRoster()はsyncDiceStatusToBattle()を内部で呼び、残った骰子池の内容から
      // 前衛/後衛を自動で決め直してしまう。これが「移動區域」の手動切り替えを直後に上書きして
      // しまい、盤面が変わらないように見えるバグの原因だったため、自動同期を先に済ませてから
      // 手動の入れ替えを最後に適用する（手動操作を常に最終結果として優先させる）。
      renderCharacterRoster();
      state.battle.front[idx] = !state.battle.front[idx];
      state.battle.back[idx] = !state.battle.front[idx];
      saveState();
      addLog("log_combat_move", {
        character: c.name,
        area: window.I18N.t(state.battle.front[idx] ? "dice_status_front" : "dice_status_back"),
        dice: dice.join("、"),
      });
      addActionBox(c, window.I18N.t("combat_action_move"), null, [
        window.I18N.t("combat_move_current_area", { area: window.I18N.t(state.battle.front[idx] ? "dice_status_front" : "dice_status_back") }),
        window.I18N.t("action_log_dice_used", { dice: dice.join("、") }),
      ]);
      // addActionBox()はこの直前の renderCharacterRoster() より後に呼んでいるため、新しい
      // アクションボックスをロスタに反映するにはもう一度描画し直す必要がある。
      renderCharacterRoster();
      renderBattlePositionAreas();
      renderCombatModal();
    });
    content.appendChild(confirmBtn);
  }

  function renderCombatEquipAction(c, content) {
    var Weapons = window.PriTestWeapons;
    if (!c.equippedWeaponIds) c.equippedWeaponIds = [];
    // 裝備變更は「持っている武器のうちどれを装備するか」を自由に選び直せる行動であり、
    // 既に全て装備済みで交換先が無い場合でも卸下（未装備へ戻す）は常に行えるべきなので、
    // 「交換可能な武器が無い」ことを理由にUI自体を表示しないのは誤りだった（以前は
    // ここでエラー表示して終了しており、唯一の武器を外すことすらできなかった）。
    if (!(c.weaponIds || []).length) {
      showCombatError("combat_error_no_equip_swap");
      return;
    }
    var listWrap = document.createElement("div");
    listWrap.className = "combat-equip-list";
    (c.weaponIds || []).forEach(function (weaponId) {
      var weapon = Weapons.get(weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId);
      if (!weapon) return;
      var row = document.createElement("label");
      row.className = "field-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = c.equippedWeaponIds.indexOf(weaponId) !== -1;
      cb.addEventListener("change", function () {
        var idx = c.equippedWeaponIds.indexOf(weaponId);
        if (cb.checked && idx === -1) {
          if (c.equippedWeaponIds.length >= MAX_EQUIPPED_WEAPONS) {
            cb.checked = false;
            showCombatError("weapon_equip_max_note", { max: MAX_EQUIPPED_WEAPONS });
            return;
          }
          c.equippedWeaponIds.push(weaponId);
        }
        if (!cb.checked && idx !== -1) c.equippedWeaponIds.splice(idx, 1);
      });
      row.appendChild(cb);
      var span = document.createElement("span");
      span.textContent = Weapons.localizedText(weapon.name);
      row.appendChild(span);
      listWrap.appendChild(row);
    });
    content.appendChild(listWrap);

    // R10 遺物効果「回合中限1次裝備變更免費」：本回合まだ使っていなければ、骰子を1つも
    // 選ばずに無償で確定できる（通常はrenderCombatDicePickerのバリデーションで骰子必須）。
    var hasFreeEquipChange =
      !c._freeEquipChangeUsedThisRound &&
      !!CharacterDrawer.findLearnedRelicEffectByName(c, ["回合中限1次裝備變更免費", "回合中僅限1次裝備變更免費", "ターン中1回だけ装備変更無償"]);
    if (hasFreeEquipChange) {
      var freeNote = document.createElement("p");
      freeNote.className = "weapon-damage-tag";
      freeNote.textContent = window.I18N.t("combat_equip_free_change_note");
      content.appendChild(freeNote);
    }

    renderCombatDicePicker(c, content);
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("combat_confirm_button");
    confirmBtn.disabled = !hasFreeEquipChange && !combatDiceSelection.length;
    confirmBtn.addEventListener("click", function () {
      var useFree = hasFreeEquipChange && !combatDiceSelection.length;
      var dice = useFree ? [] : consumeCombatDice(c);
      combatDiceSelection = [];
      if (useFree) c._freeEquipChangeUsedThisRound = true;
      saveRosterCharacters();
      addLog(useFree ? "log_combat_equip_change_free" : "log_combat_equip_change", { character: c.name, dice: dice.join("、") });
      addActionBox(
        c,
        window.I18N.t("combat_action_equip"),
        null,
        useFree ? [window.I18N.t("combat_equip_free_change_note")] : [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })]
      );
      renderCharacterRoster();
      renderCombatModal();
    });
    content.appendChild(confirmBtn);
  }

  // 防禦action中「迴避／格擋のどちらを選ぼうとしているか」の一時状態。
  var combatDefenseState = null; // "dodge" | "block" | null

  // 淑女「華麗身法」：迴避選択中のみ表示するトグル。ONの間は骰子8個消費で1回分のダメージ・
  // 追加効果を完全に無効化する（通常の迴避コスト・数値計算とは別ルートに切り替える）。
  var elegantFootworkActive = false;

  // 迴避は骰子を1個だけ選び、その出目×10＋30をHP価値とする。
  var DODGE_COST = { diceKind: "count", diceCountMin: 1, diceCountMax: 1, sumTotal: null, fpCost: 0, hpCost: 0 };

  // 淑女「華麗身法」：迴避のコストを「骰子消耗：8」（出目合計8）に変更する代わりに、
  // ダメージ・追加効果を完全無効化する（個数ではなく合計、ユーザー確認済み）。
  var ELEGANT_FOOTWORK_COST = { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: 8, fpCost: 0, hpCost: 0 };

  var SOLO_WEAPON_GUARD_RELIC_NAMES = ["雙手持握的達人", "両手持ちの達人"];

  // 装備中武器の中から盾（isShieldカテゴリ）を1つ探す。無ければnull。
  function getEquippedShield(c) {
    var Weapons = window.PriTestWeapons;
    var ids = c.equippedWeaponIds || [];
    for (var i = 0; i < ids.length; i++) {
      var baseId = ids[i].indexOf("::") !== -1 ? ids[i].slice(0, ids[i].indexOf("::")) : ids[i];
      var weapon = Weapons.get(baseId);
      if (!weapon) continue;
      var category = Weapons.getCategory(weapon.category);
      if (category && category.isShield) return { weaponId: ids[i], weapon: weapon, category: category };
    }
    return null;
  }

  // 単騎武器（盾なし）での格擋は「雙手持握的達人」を習得している場合のみ可能。
  function getSoloWeaponGuardRelic(c) {
    return CharacterDrawer.findLearnedRelicEffectByName(c, SOLO_WEAPON_GUARD_RELIC_NAMES);
  }

  // R9 遺物効果「防禦反擊」：判定に使う「装備中の近接武器」を1つ探す（盾／杖・聖印など
  // 1Hit/2Hitの概念を持たない武器種は除外、computeWeaponDamageがnullを返すことで判定）。
  function getEquippedMeleeWeapon(c) {
    var Weapons = window.PriTestWeapons;
    var ids = c.equippedWeaponIds || [];
    for (var i = 0; i < ids.length; i++) {
      var baseId = ids[i].indexOf("::") !== -1 ? ids[i].slice(0, ids[i].indexOf("::")) : ids[i];
      var weapon = Weapons.get(baseId);
      if (!weapon) continue;
      var category = Weapons.getCategory(weapon.category);
      if (!category || category.isShield) continue;
      var damage = CharacterDrawer.computeWeaponDamage(c, ids[i]);
      if (damage) return { weaponId: ids[i], weapon: weapon, category: category, damage: damage };
    }
    return null;
  }

  // 遺物効果の本文中「骰子消耗：N」「HP價值：M」（ja:「ダイスコスト：N」「HP価値：M」）から
  // 数値を取り出す。角色タイプごとに本文の数値が異なりうるため、固定値にせず都度パースする。
  function parseGuardTextValues(text) {
    var diceMatch = /(?:骰子消耗|ダイスコスト)[：:]\s*(\d+)/.exec(text || "");
    var hpMatch = /HP(?:價值|価値)[：:]\s*(\d+)/.exec(text || "");
    return {
      diceCost: diceMatch ? parseInt(diceMatch[1], 10) : null,
      hpValue: hpMatch ? parseInt(hpMatch[1], 10) : null,
    };
  }

  // 格擋は、盾を装備しているか、あるいは単騎武器（二刀流ではない）＋「雙手持握的達人」習得時に発動可能。
  function canBlockGuard(c) {
    var ids = c.equippedWeaponIds || [];
    if (!ids.length) return false;
    var shieldInfo = getEquippedShield(c);
    if (ids.length === 1) return !!shieldInfo || !!getSoloWeaponGuardRelic(c);
    return !!shieldInfo;
  }

  // 隱性連續防禦規則：同じ防禦行動フェイズ内で格擋を使うたび、次回のHP価値に+10（この関数呼び出し
  // 時点で既に使った回数×10）を上乗せする（盾牌／単騎武器どちらの格擋でも共通）。ただし1回分の
  // HP価値は必ず100が上限。フェイズ切替のたびc._consecutiveGuardCountはリセットされる。
  function applyConsecutiveGuardBonus(c, baseValue) {
    var bonus = (c._consecutiveGuardCount || 0) * 10;
    return Math.min(baseValue + bonus, 100);
  }

  function registerGuardUsed(c) {
    c._consecutiveGuardCount = (c._consecutiveGuardCount || 0) + 1;
  }

  function renderCombatDefenseAction(c, content) {
    var Weapons = window.PriTestWeapons;
    var shieldInfo = getEquippedShield(c);
    var soloGuardRelic = shieldInfo ? null : getSoloWeaponGuardRelic(c);
    var blockAvailable = canBlockGuard(c);
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    // 淑女「華麗身法」：kind:"Passive"のため通常の防禦選択肢一覧には乗らず、高防禦と同じく
    // IDで直接検索する（迴避が選択されているときのみ子要素として出す）。
    var elegantFootworkAbility = type
      ? (type.abilities || []).filter(function (entry) {
          return entry.id === "elegant_footwork";
        })[0]
      : null;
    var defenseSkillEntries = type ? CharacterDrawer.getCombatDefenseSkillEntries(c, type) : [];
    // 隱者「冰塊之棺」（混成魔法の遺物効果）／執行者「妖刀解放・攻」（妖刀の代替Defense）：
    // 習得済みなら、通常の防禦選択肢に並ぶ追加のDefenseエントリとして注入する。
    var defenseBaseTypeId = type ? type.id.replace(/_dark$|_dawn$/, "") : null;
    if (defenseBaseTypeId === "hermit" && CharacterDrawer.findLearnedRelicEffectByName(c, ["冰塊之棺", "氷塊の棺"])) {
      defenseSkillEntries = defenseSkillEntries.concat([HERMIT_ICE_COFFIN_DEFENSE_ENTRY]);
    }
    if (defenseBaseTypeId === "executor" && CharacterDrawer.findLearnedRelicEffectByName(c, ["妖刀解放・攻"])) {
      defenseSkillEntries = defenseSkillEntries.concat([EXECUTOR_YOTO_RELEASE_DEFENSE_ENTRY]);
    }
    if (defenseBaseTypeId === "executor" && CharacterDrawer.findLearnedRelicEffectByName(c, ["妖刀解放・癒"])) {
      defenseSkillEntries = defenseSkillEntries.concat([EXECUTOR_YOTO_RELEASE_HEAL_DEFENSE_ENTRY]);
    }
    if (defenseBaseTypeId === "scholar" && CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（衝擊波的緩和）", "スキル強化（衝撃波による緩和）"])) {
      defenseSkillEntries = defenseSkillEntries.concat([SCHOLAR_DARK_INQUIRY_SHOCKWAVE_DEFENSE_ENTRY]);
    }
    var usesBonus = CharacterDrawer.getSkillUsesBonus(c);

    // 守護者「高防禦」：kind:"Passive"だが、防禦フェイズの体力骰を得たタイミングで骰子1個を
    // 支払って任意発動できる（発動後は本フェイズが終わるまで持続＝フェイズ切替の都度リセット
    // される_highGuardActiveフラグで管理）。データ上はPassiveのままなので
    // getCombatDefenseSkillEntries（Defense種別専用）には乗らず、IDで直接判定する。
    var highGuardAbility = type
      ? (type.abilities || []).filter(function (entry) {
          return entry.id === "high_guard";
        })[0]
      : null;
    if (highGuardAbility) {
      var highGuardName = CharacterTypes.localizedText(highGuardAbility.name);
      if (c._highGuardActive) {
        var activeNote = document.createElement("p");
        activeNote.className = "threat-ref-body";
        activeNote.textContent = window.I18N.t("high_guard_active_note", { name: highGuardName });
        content.appendChild(activeNote);
      } else {
        var highGuardBtn = document.createElement("button");
        highGuardBtn.type = "button";
        highGuardBtn.className = "combat-attack-hit-btn";
        highGuardBtn.textContent = window.I18N.t("high_guard_activate_button", { name: highGuardName });
        if (combatDefenseState === "high_guard") highGuardBtn.classList.add("active");
        highGuardBtn.addEventListener("click", function () {
          combatDefenseState = combatDefenseState === "high_guard" ? null : "high_guard";
          combatDiceSelection = [];
          renderCombatModal();
        });
        content.appendChild(highGuardBtn);
        if (combatDefenseState === "high_guard") {
          // 本文「支付『骰子消耗：1』」＝出目合計1（個数ではない、ユーザー確認済みのsumルールと統一）。
          var highGuardCost = { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: 1, fpCost: 0, hpCost: 0 };
          renderDiceCostAction(c, content, highGuardCost, function (dice, costLines) {
            c._highGuardActive = true;
            addActionBox(c, highGuardName, window.I18N.t("high_guard_active_note", { name: highGuardName }), [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
            addLog("log_high_guard_activate", { character: c.name });
            combatDefenseState = null;
          });
        }
      }
    }

    // R9 遺物効果「防禦反擊」：盾＋近接武器を装備し、瀕死状態でなければ発動できる独立行動。
    // 「習得2個時+15」は countLearnedRelicEffectsByName（同名の複数エントリを個数として数える
    // 既存規則）で判定し、「防禦反擊強化（斧槍）」はカテゴリが斧槍のときだけ追加+15する。
    var guardCounterEffect = CharacterDrawer.findLearnedRelicEffectByName(c, ["防禦反擊", "ガードカウンター"]);
    var guardCounterMeleeWeapon = getEquippedMeleeWeapon(c);
    if (guardCounterEffect && shieldInfo && guardCounterMeleeWeapon && !c._nearDeath) {
      var gcCost = CharacterDrawer.parseActionCost(guardCounterEffect.body && guardCounterEffect.body.zh);
      var gcCount2Bonus = CharacterDrawer.countLearnedRelicEffectsByName(c, ["防禦反擊", "ガードカウンター"]) >= 2 ? 15 : 0;
      var gcHalberdBonus = CharacterDrawer.findLearnedRelicEffectByName(c, ["防禦反擊強化（斧槍）", "ガードカウンター強化（斧槍）"])
        && guardCounterMeleeWeapon.category.id === "halberd"
        ? 15
        : 0;
      var gcAttachedBonus = (c.learnedAttachedEffects || []).indexOf("guard_counter_up") !== -1 ? 15 : 0;
      var gcDamageValue = guardCounterMeleeWeapon.damage.hit1Damage + gcCount2Bonus + gcHalberdBonus + gcAttachedBonus;
      var gcDamageSymbol = guardCounterMeleeWeapon.damage.hit1Symbol;
      var gcRow = document.createElement("div");
      gcRow.className = "combat-attack-weapon-row";
      var gcNameEl = document.createElement("span");
      gcNameEl.className = "combat-attack-weapon-name";
      gcNameEl.textContent = window.I18N.t("combat_guard_counter_label");
      gcRow.appendChild(gcNameEl);
      var gcDmgTag = document.createElement("span");
      gcDmgTag.className = "weapon-damage-tag";
      gcDmgTag.textContent = " " + CharacterDrawer.formatValueWithSymbol(gcDamageValue, gcDamageSymbol);
      gcRow.appendChild(gcDmgTag);
      var gcBtn = document.createElement("button");
      gcBtn.type = "button";
      gcBtn.className = "combat-attack-hit-btn";
      gcBtn.textContent = window.I18N.t("combat_guard_counter_label");
      if (combatDefenseState === "guard_counter") gcBtn.classList.add("active");
      gcBtn.addEventListener("click", function () {
        combatDefenseState = combatDefenseState === "guard_counter" ? null : "guard_counter";
        combatDiceSelection = [];
        renderCombatModal();
      });
      gcRow.appendChild(gcBtn);
      content.appendChild(gcRow);
      if (combatDefenseState === "guard_counter") {
        renderDiceCostAction(c, content, gcCost, function (dice, costLines) {
          var lines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
          var valueText = CharacterDrawer.formatValueWithSymbol(gcDamageValue, gcDamageSymbol);
          addActionBox(c, window.I18N.t("combat_guard_counter_label"), window.I18N.t("action_log_damage_total", { value: valueText }), lines);
          addLog("log_combat_guard_counter", { character: c.name, damage: valueText, dice: dice.join("、") });
          combatDefenseState = null;
        });
      }
    }

    // 守護者「救世之翼」：戦闘フェイズで発動していれば、防禦フェイズでも効果が持続している
    // ことを常時リマインドする（実際のHP損害無効化はGMが手動で反映する前提）。
    if (c._wingsOfSalvationActive) {
      var wingsNote = document.createElement("p");
      wingsNote.className = "threat-ref-body";
      wingsNote.textContent = window.I18N.t("wings_of_salvation_active_note");
      content.appendChild(wingsNote);
    }

    // 復仇者「不死行軍」：救世之翼と同じく発動者本人に限らず全員に持続するリマインドバナー
    // （「復歸傷害：120」＋「目前HP：□は瀕死状態にならず保持され続ける」効果、GM手動反映）。
    if (c._marchOfTheUndyingActive) {
      var marchNote = document.createElement("p");
      marchNote.className = "threat-ref-body";
      marchNote.textContent = window.I18N.t("march_of_the_undying_defense_note");
      content.appendChild(marchNote);
    }

    // 學者「探求」效果2／「共感術」：どちらも救世之翼と同じ回合跨ぎの持続バナー。
    if (c._inquiryDamageReductionActive) {
      var inquiryNote = document.createElement("p");
      inquiryNote.className = "threat-ref-body";
      inquiryNote.textContent = window.I18N.t("inquiry_damage_reduction_defense_note");
      content.appendChild(inquiryNote);
    }
    if (c._empathyActive) {
      var empathyNote = document.createElement("p");
      empathyNote.className = "threat-ref-body";
      empathyNote.textContent = window.I18N.t("empathy_defense_note");
      content.appendChild(empathyNote);
    }

    // 淑女「終曲」：battle全体に紐付くフラグのため、発動した本人に限らず全員の防禦タブに
    // リマインドバナーを表示する（次の防禦フェイズを抜けるタイミングでフラグはリセットされる）。
    if (state.battle._finaleActive) {
      var finaleNote = document.createElement("p");
      finaleNote.className = "threat-ref-body";
      finaleNote.textContent = window.I18N.t("finale_defense_note");
      content.appendChild(finaleNote);
    }

    // 無賴漢「圖騰・史黛拉」：終曲と同じくbattle全体のフラグで、次の防禦フェイズ1回だけ
    // リマインドバナーを表示する。
    if (state.battle._totemStellaActive) {
      var totemStellaNote = document.createElement("p");
      totemStellaNote.className = "threat-ref-body";
      totemStellaNote.textContent = window.I18N.t("totem_stella_defense_note");
      content.appendChild(totemStellaNote);
    }

    // 無賴漢（暗影）「技能強化（敵人弱化）」：圖騰・史黛拉と同じくbattle全体のフラグで、
    // 次の防禦フェイズ1回だけリマインドバナーを表示する。
    if (state.battle._ruffianDarkCounterDebuffActive) {
      var counterDebuffNote = document.createElement("p");
      counterDebuffNote.className = "threat-ref-body";
      counterDebuffNote.textContent = window.I18N.t("counterattack_debuff_defense_note");
      content.appendChild(counterDebuffNote);
    }

    var choiceRow = document.createElement("div");
    choiceRow.className = "combat-defense-choice-row";
    [
      { key: "dodge", label: window.I18N.t("combat_defense_dodge_button") },
      { key: "block", label: window.I18N.t("combat_defense_block_button") },
    ].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "combat-attack-hit-btn";
      btn.textContent = opt.label;
      if (combatDefenseState === opt.key) btn.classList.add("active");
      // 無賴漢「逆襲」をDefenseとして使用した場合、その後は他の格擋を使用できなくなる。
      if (opt.key === "block" && (!blockAvailable || c._counterattackDefenseUsed)) btn.disabled = true;
      // 迴避は防禦フェイズにつき1回のみ使用可能（格擋は複数回使用可能なまま）。
      if (opt.key === "dodge" && c._dodgeActionUsed) btn.disabled = true;
      btn.addEventListener("click", function () {
        combatDefenseState = combatDefenseState === opt.key ? null : opt.key;
        combatDiceSelection = [];
        renderCombatModal();
      });
      choiceRow.appendChild(btn);
    });
    // kind:"Defense"の角色能力（例：追跡者の「第六感」）も、迴避／格擋と並ぶ第三の選択肢として
    // ここに表示する（getCombatSkillEntriesはAction系のみを返すため、こちらはgetCombatDefenseSkillEntries
    // を使う）。
    defenseSkillEntries.forEach(function (entry) {
      var entryName = CharacterTypes.localizedText(entry.name);
      var entryBody = CharacterTypes.localizedText(entry.body);
      var effectiveMax = entry.uses ? entry.uses + usesBonus : null;
      var remaining =
        effectiveMax !== null ? (typeof (c.abilityUses && c.abilityUses[entry.id]) === "number" ? c.abilityUses[entry.id] : effectiveMax) : null;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "combat-attack-hit-btn";
      btn.textContent = entryName + (effectiveMax !== null ? window.I18N.t("action_log_uses_remaining", { current: remaining, max: effectiveMax }) : "");
      if (combatDefenseState === entry.id) btn.classList.add("active");
      if (effectiveMax !== null && remaining <= 0) btn.disabled = true;
      btn.addEventListener("click", function () {
        combatDefenseState = combatDefenseState === entry.id ? null : entry.id;
        combatDiceSelection = [];
        renderCombatModal();
      });
      choiceRow.appendChild(btn);
    });
    content.appendChild(choiceRow);

    var activeDefenseSkill = defenseSkillEntries.filter(function (entry) {
      return entry.id === combatDefenseState;
    })[0];
    if (activeDefenseSkill) {
      var skillBody = CharacterTypes.localizedText(activeDefenseSkill.body);
      var skillName = CharacterTypes.localizedText(activeDefenseSkill.name);
      var skillCost = CharacterDrawer.parseActionCost(skillBody);
      renderDiceCostAction(c, content, skillCost, function (dice, costLines) {
        var effectiveMax = activeDefenseSkill.uses ? activeDefenseSkill.uses + usesBonus : null;
        if (effectiveMax !== null) {
          if (!c.abilityUses) c.abilityUses = {};
          var remaining = typeof c.abilityUses[activeDefenseSkill.id] === "number" ? c.abilityUses[activeDefenseSkill.id] : effectiveMax;
          c.abilityUses[activeDefenseSkill.id] = Math.max(0, remaining - 1);
        }
        // 鐵眼「標記」をDefenseとして使用した場合は「迴避」の代わりに使用でき、固定で
        // HP價值:100の迴避を行ったものとして扱う（第六感のような完全無効化とは異なる）。
        // 無賴漢「逆襲」をDefenseとして使用した場合は「格擋」の代わりに使用でき、固定で
        // HP價值:80のガードを行ったものとして扱う（以後このフェイズ中は他の格擋を使用不可、
        // かつこのディフェンス後に現在HP：0になるはずの損害を受けた場合は現在HP：1になる）。
        var defenseNote =
          activeDefenseSkill.id === "marking" || activeDefenseSkill.id === "inquiry_shockwave_defense"
            ? window.I18N.t("marking_defense_note")
            : activeDefenseSkill.id === "counterattack"
            ? window.I18N.t("counterattack_defense_note")
            : activeDefenseSkill.id === "trance" || activeDefenseSkill.id === "ice_coffin"
            ? window.I18N.t("trance_defense_note")
            : activeDefenseSkill.id === "yoto_release_defense" || activeDefenseSkill.id === "yoto_release_heal_defense"
            ? window.I18N.t("yoto_release_defense_note")
            : window.I18N.t("combat_defense_skill_negate_note");
        if (activeDefenseSkill.id === "counterattack") {
          c._counterattackDefenseUsed = true;
          // R1「技能強化（迎擊）」：被動強制發動——防禦階段用「逆襲」後，下個戰鬥階段開始時
          // 自動發動「以Action使用時」的效果（對敵人造成【總合傷害：30+◆】、對象未確定なので
          // GM/玩家がその場で敵人を選んで◆を適用する前提のリマインドとしてログへ残す）。
          if (CharacterDrawer.findLearnedRelicEffectByName(c, ["技能強化（迎擊）", "スキル強化（迎撃）"])) {
            c._counterattackAutoTriggerPending = true;
          }
        }
        // 執行者「妖刀」／「妖刀（妖刀解放・攻）」：完全無效化ノート自体は汎用
        // （combat_defense_skill_negate_note）のまま。このディフェンス後、妖刀蓄積に✓1個
        // （上限2、既に2でも使用自体は妨げない）を記入し、次の戦闘フェイズ開始時に體力骰+1を
        // 予約する（setActionPhaseの「新しい回合開始」判定箇所で消化する）。遺物効果由来の
        // 代替Defense（消耗：2／HP價值：60）も同じ「此防禦後」の効果を受ける（本文どおり）。
        if (
          activeDefenseSkill.id === "yoto" ||
          activeDefenseSkill.id === "yoto_release_defense" ||
          activeDefenseSkill.id === "yoto_release_heal_defense"
        ) {
          c._yotoMarks = Math.min(2, (c._yotoMarks || 0) + 1);
          c._yotoPendingBonusDice = true;
        }
        addActionBox(c, skillName, defenseNote, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
        addLog(
          activeDefenseSkill.id === "counterattack"
            ? "log_counterattack_defense_use"
            : activeDefenseSkill.id === "yoto" ||
              activeDefenseSkill.id === "yoto_release_defense" ||
              activeDefenseSkill.id === "yoto_release_heal_defense"
            ? "log_yoto_defense_use"
            : activeDefenseSkill.id === "trance" || activeDefenseSkill.id === "ice_coffin"
            ? "log_trance_defense_use"
            : "log_combat_defense_skill_use",
          {
            character: c.name,
            skill: skillName,
            dice: dice.join("、"),
          }
        );
        combatDefenseState = null;
      });
    }

    if (!blockAvailable) {
      var ids = c.equippedWeaponIds || [];
      var noteKey =
        ids.length === 1 && !shieldInfo ? "combat_defense_block_unavailable_no_relic_note" : "combat_defense_block_unavailable_note";
      var note = document.createElement("p");
      note.className = "threat-ref-body";
      note.textContent = window.I18N.t(noteKey);
      content.appendChild(note);
    }

    if (combatDefenseState === "dodge") {
      if (elegantFootworkAbility) {
        var elegantFootworkName = CharacterTypes.localizedText(elegantFootworkAbility.name);
        var efToggleBtn = document.createElement("button");
        efToggleBtn.type = "button";
        efToggleBtn.className = "combat-attack-hit-btn";
        efToggleBtn.textContent = window.I18N.t("elegant_footwork_toggle_button", { name: elegantFootworkName });
        if (elegantFootworkActive) efToggleBtn.classList.add("active");
        efToggleBtn.addEventListener("click", function () {
          elegantFootworkActive = !elegantFootworkActive;
          combatDiceSelection = [];
          renderCombatModal();
        });
        content.appendChild(efToggleBtn);
      }
      if (elegantFootworkAbility && elegantFootworkActive) {
        renderDiceCostAction(c, content, ELEGANT_FOOTWORK_COST, function (dice) {
          addActionBox(
            c,
            elegantFootworkName,
            window.I18N.t("elegant_footwork_negate_note"),
            [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })]
          );
          addLog("log_elegant_footwork_use", { character: c.name, dice: dice.join("、") });
          c._dodgeActionUsed = true;
          // 使用者確認：防禦階段の行動（迴避／格擋／本技能のような特殊迴避）も進度版の
          // 「本回合行動說明」に反映されるよう、_phaseSpecialNotesへ記録する（既存の
          // buildCharacterActionLogLinesがこの欄位を読む。phase reset時に既存のリセット
          // ループで自動的にクリアされる）。
          if (!c._phaseSpecialNotes) c._phaseSpecialNotes = [];
          c._phaseSpecialNotes.push(elegantFootworkName + "（" + window.I18N.t("elegant_footwork_negate_note") + "）");
          combatDefenseState = null;
          elegantFootworkActive = false;
        });
      } else {
        renderDiceCostAction(c, content, DODGE_COST, function (dice) {
          var value = dice[0] * 10 + 30;
          var dodgeLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })];
          // 遺物効果「轉身之步」：迴避で「骰子消耗：6」（出目6の骰子）を支払った場合、傷害處理後
          // 所受的HP損害減輕■（■は数値未確定のためGM手動反映、注記のみ残す）。
          if (dice[0] === 6) {
            var stepEffect = CharacterDrawer.findLearnedRelicEffectByName(c, ["轉身之步", "転身のステップ"]);
            if (stepEffect) dodgeLines = dodgeLines.concat([CharacterTypes.localizedText(stepEffect.body)]);
          }
          addActionBox(c, window.I18N.t("combat_defense_dodge_button"), window.I18N.t("action_log_defense_value_total", { value: value }), dodgeLines);
          addLog("log_combat_defense_dodge", { character: c.name, value: value, dice: dice.join("、") });
          c._dodgeActionUsed = true;
          // 自動化GM 戰鬥自動化：#enemy-damage-modalのHP價值欄に、実際にこの防禦階段で執行した
          // HP價值を自動預填するための記録（c.hpValueの固定値／30の仮値ではなく、今回本人が
          // 迴避で実際に出した値をそのまま使う）。フェイズ切替のたびにsetActionPhase側でリセットする。
          c._defenseHpValueThisTurn = value;
          // 使用者確認：迴避も進度版「本回合行動說明」に反映されるよう記録する（項目15対応）。
          if (!c._phaseSpecialNotes) c._phaseSpecialNotes = [];
          c._phaseSpecialNotes.push(window.I18N.t("combat_defense_dodge_button") + "（" + window.I18N.t("action_log_defense_value_total", { value: value }) + "）");
          combatDefenseState = null;
        });
      }
    } else if (combatDefenseState === "block" && blockAvailable) {
      var cost, baseValue;
      if (shieldInfo) {
        cost = CharacterDrawer.parseGuardCost(Weapons.localizedText(shieldInfo.category.basicStats.guardCost));
        baseValue =
          shieldInfo.weapon.rarity === "R" || shieldInfo.weapon.rarity === "L"
            ? shieldInfo.category.basicStats.guardHpRL
            : shieldInfo.category.basicStats.guardHpCU;
      } else {
        var parsed = parseGuardTextValues((soloGuardRelic.body && soloGuardRelic.body.zh) || "");
        cost = { diceKind: "count", diceCountMin: parsed.diceCost || 1, diceCountMax: null, sumTotal: null, fpCost: 0, hpCost: 0 };
        baseValue = parsed.hpValue || 0;
      }
      // 消耗品「塗脂（盾）」／「調香瓶｜高揚之香」／「調香瓶｜酸之噴霧」等級2：直到結束階段為止、
      // 「複数回ガードする場合は初回のみ」のHP價值加算（+10、上限100）。表示時点で消費フラグを
      // 立てず、実際に確定した時だけ消費する（プレビューと確定を分ける）。
      var pendingGuardBonus = !c._guardValueBonusConsumed ? c._guardValueBonusUntilEndPhase || 0 : 0;
      var value = Math.min(applyConsecutiveGuardBonus(c, baseValue) + pendingGuardBonus, 100);
      renderDiceCostAction(c, content, cost, function (dice) {
        var blockLines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })];
        // 附帶効果「防禦成功時HP回復」：HP損害を処理する前に自身へ「HP回復□」＝+1を適用する。
        if ((c.learnedAttachedEffects || []).indexOf("guard_hp_regen") !== -1) {
          c.hp.current = Math.min(c.hp.max, c.hp.current + 1);
          blockLines = blockLines.concat([window.I18N.t("guard_hp_regen_applied_note")]);
        }
        if (pendingGuardBonus) c._guardValueBonusConsumed = true;
        addActionBox(c, window.I18N.t("combat_defense_block_button"), window.I18N.t("action_log_defense_value_total", { value: value }), blockLines);
        addLog("log_combat_defense_block", { character: c.name, value: value, dice: dice.join("、") });
        registerGuardUsed(c);
        // 自動化GM 戰鬥自動化：迴避と同様、#enemy-damage-modalのHP價值欄への自動預填用に
        // 今回格擋で実際に確定したHP價值（連續防禦補正・消耗品加算を反映済みの最終値）を記録する。
        c._defenseHpValueThisTurn = value;
        // 使用者確認：格擋も進度版「本回合行動說明」に反映されるよう記録する（項目15対応）。
        if (!c._phaseSpecialNotes) c._phaseSpecialNotes = [];
        c._phaseSpecialNotes.push(window.I18N.t("combat_defense_block_button") + "（" + window.I18N.t("action_log_defense_value_total", { value: value }) + "）");
        combatDefenseState = null;
      });
    }
  }

  function renderCombatModal() {
    var c = combatCharacter();
    var errEl = document.getElementById("combat-modal-error");
    errEl.hidden = true;
    errEl.textContent = "";
    document.getElementById("combat-modal-title").textContent = c ? c.name : "";
    var isDefensePhase = state.actionPhase === "defense";
    document.querySelectorAll(".combat-action-normal-btn").forEach(function (btn) {
      btn.hidden = isDefensePhase;
    });
    document.querySelectorAll(".combat-action-defense-btn").forEach(function (btn) {
      btn.hidden = !isDefensePhase;
    });
    document.querySelectorAll(".combat-action-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.action === combatModalAction);
    });
    var content = document.getElementById("combat-modal-content");
    content.innerHTML = "";
    if (!c || !combatModalAction) return;
    if (combatModalAction === "attack") renderCombatAttackAction(c, content);
    else if (combatModalAction === "skill") renderCombatSkillAction(c, content);
    else if (combatModalAction === "flask") renderCombatFlaskAction(c, content);
    else if (combatModalAction === "consumable") renderCombatConsumableAction(c, content);
    else if (combatModalAction === "move") renderCombatMoveAction(c, content);
    else if (combatModalAction === "equip") renderCombatEquipAction(c, content);
    else if (combatModalAction === "defense") renderCombatDefenseAction(c, content);
  }

  // エネミーHPチェックグリッドは、戦場面板（battle-drawer）内のフル表示、
  // 盤面左側の共用パネル（board-side-enemies直下）の簡易表示、そして第三夜の
  // 夜の王画像の下（night3-boss-hp-grid）の3箇所に同じstate.battle.enemyHpを
  // 描画する。いずれかのチェックボックスを操作しても全箇所に即時反映される。
  // 使用者確認（項目7）：公開盤／共用面板（board-side-enemy-hp-grid、night3-boss-hp-grid、
  // 皆為玩家可見的公開盤一部分）不應顯示+/-鈕，只有戰場面板（battle-enemy-hp-grid、GM專用）
  // 可以手動調整。readOnly的段落只畫數值，不畫±按鈕。
  var ENEMY_HP_GRID_TARGETS = [
    { containerId: "battle-enemy-hp-grid", idPrefix: "battle-enemy-hp-" },
    { containerId: "board-side-enemy-hp-grid", idPrefix: "board-enemy-hp-", readOnly: true },
    { containerId: "night3-boss-hp-grid", idPrefix: "night3-boss-hp-", readOnly: true },
  ];

  // チェックボックスを1つずつ押す方式は箱数が多い（4段×20＝80）と操作が煩雑なため、
  // 段ごとに現在の被弾数（＝チェック済みの数）を+/-ボタンで増減する方式にする。
  // 内部データは引き続き真偽値の平坦配列のまま（左詰めで埋める・右から空ける）なので、
  // 既存の保存データともそのまま互換する。
  function countRowChecked(arr, start, len) {
    var n = 0;
    for (var i = 0; i < len; i++) if (arr[start + i]) n++;
    return n;
  }

  // 指定段の実際の最大HP（カード記載値）。未設定（enemyHpMax無し）の場合はENEMY_HP_COLS
  // （盤面上のマス数の上限）にフォールバックする。
  function enemyHpRowMax(rowIdx) {
    var max = state.battle.enemyHpMax && state.battle.enemyHpMax[rowIdx];
    return typeof max === "number" && max > 0 ? Math.min(max, ENEMY_HP_COLS) : ENEMY_HP_COLS;
  }

  // その段に実際に敵が割り当てられている（enemyHpMaxが設定済み）かどうか。
  // 敵が割り当てられていない段は、チェック数が0のままでも「撃破」とはみなさない
  // （「原本就0/20則不計」）。
  function enemyHasRow(rowIdx) {
    var max = state.battle.enemyHpMax && state.battle.enemyHpMax[rowIdx];
    return typeof max === "number" && max > 0;
  }

  // グラディウス「分裂形態」等、boss.noStaggerInSplitForm===trueな夜の王がstate.battle.
  // bossForm==="split"の間、そのボスに割り当てられたHP行（enemyHpRowIndexForKeyと同じ
  // 「後ろ詰め」規約）を体勢崩し／額外行動フェイズ解禁／撃破判定から除外する
  // （ユーザー確認済み仕様「分裂形態では体勢崩しは発生しない」）。
  function isSplitFormExemptRow(rowIdx) {
    if (!game || !game.night3BossId || state.battle.bossForm !== "split") return false;
    var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(game.night3BossId) : null;
    if (!bossInfo || !bossInfo.noStaggerInSplitForm || typeof bossInfo.hpRowCount !== "number") return false;
    var start = Math.max(0, ENEMY_HP_ROWS - bossInfo.hpRowCount);
    return rowIdx >= start && rowIdx < start + bossInfo.hpRowCount;
  }

  // 段のチェック数（＝残りHP）は敵追加時に実際の最大値で満タン初期化され、GMが「－」を
  // 押して減らしていく。敵が割り当て済みの段でチェック数が0になった時点で「撃破」とみなす。
  function isEnemyHpRowDepleted(rowIdx) {
    if (isSplitFormExemptRow(rowIdx)) return false;
    return enemyHasRow(rowIdx) && countRowChecked(state.battle.enemyHp, rowIdx * ENEMY_HP_COLS, ENEMY_HP_COLS) === 0;
  }

  // 額外行動フェイズは、敵が割り当て済みの段のうちいずれか1段でも撃破済みになって初めて選択可能になる。
  function anyEnemyHpRowDepleted() {
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (isEnemyHpRowDepleted(i)) return true;
    }
    return false;
  }

  // 使用者確認：「1段が體勢崩しを起こすのは1回だけ」。既にstaggerRowsHandledへ記録済みの段は
  // （HPが0のまま残っていても）自動化GMの額外階段トリガー判定からは除外する。自動化GM以外の
  // 既存機能（額外行動ボタンの有効化、guardBroken等）には影響しない——この関数はautoAdvance
  // BattlePhase専用。
  function anyUnhandledStaggeredRow() {
    var handled = state.battle.staggerRowsHandled || [];
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (isEnemyHpRowDepleted(i) && handled.indexOf(i) === -1) return true;
    }
    return false;
  }

  // 自動化GMが實際に額外階段へ進むと決めた瞬間に呼ぶ。現在0になっている段を全て
  // 「使用済み」として記録し、以後その段だけでは再度額外階段を発生させない。
  function markStaggeredRowsHandled() {
    if (!state.battle.staggerRowsHandled) state.battle.staggerRowsHandled = [];
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (isEnemyHpRowDepleted(i) && state.battle.staggerRowsHandled.indexOf(i) === -1) {
        state.battle.staggerRowsHandled.push(i);
      }
    }
  }

  // 敵が割り当て済みの段が1つ以上あり、そのすべてが撃破済み＝戦闘終了（一般行動へ自動的に戻す）。
  // 使用者確認（項目1）：主要エネミーの段だけでなく、雜兵（+モブ/+雜兵、state.battle.mobHpRows）
  // が存在する場合はそちらも全滅していなければ「戦闘終了」とみなさない（mobHpRowsは
  // checked=damage-taken規約——adjustMobHpRow参照——のため、全マスcheckedで撃破済み）。
  function allEnemyHpRowsDepleted() {
    var any = false;
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (!enemyHasRow(i)) continue;
      any = true;
      if (!isEnemyHpRowDepleted(i)) return false;
    }
    var mobRows = state.battle.mobHpRows || [];
    for (var m = 0; m < mobRows.length; m++) {
      var row = mobRows[m];
      if (!row || !row.length) continue;
      any = true;
      if (countRowChecked(row, 0, row.length) !== row.length) return false;
    }
    return any;
  }

  // 自動化GM 戰鬥自動化：進度版で戰鬥開始時に公開する「遭遇した敵人」情報（名稱／等級／種族／
  // 尺寸／HP、雜兵の有無とそのHP）のテキストを組み立てる（docs/combat_flow_rules.md §4
  // 「公開情報」に対応）。night_gm_flow.jsのhandleCombatTriggerClickからwindow.PriTestNightCore
  // 経由で呼ばれる。
  function buildEncounterSummaryText() {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return "";
    var T = Enemies.localizedText;
    var ids = (state.battle && state.battle.selectedEnemyIds) || [];
    var lines = [];
    ids.forEach(function (key) {
      var parts = key.split("|");
      var info = Enemies.get(parts[0], parts[1]);
      if (!info) return;
      var level = Math.max(1, Number(parts[2]) || 1);
      var lvRow = (info.familyBase || []).filter(function (lv) {
        return lv.level === level;
      })[0];
      var lineParts = [
        T(info.enemy.name),
        window.I18N.t("enemy_level_label") + window.I18N.t("colon_separator") + level,
        T(info.familyName),
        info.enemy.size || "-",
      ];
      if (lvRow && lvRow.hp) {
        lineParts.push(window.I18N.t("enemy_hp_label") + window.I18N.t("colon_separator") + lvRow.hp);
      }
      lines.push(lineParts.join("　"));
    });
    if (state.battle.mobHpRows && state.battle.mobHpRows.length) {
      var mobTotal = 0;
      var mobChecked = 0;
      state.battle.mobHpRows.forEach(function (row) {
        mobTotal += row.length;
        mobChecked += row.filter(Boolean).length;
      });
      lines.push(window.I18N.t("gm_flow_encounter_mob_line", { current: mobChecked, max: mobTotal }));
    }
    return lines.join("\n");
  }

  // 自動化GM 戰鬥自動化：簡易戰鬥（docs/combat_flow_rules.md §6）の第1回合が終わった時点で
  // 「追擊損害」として全體玩家へ与えるダメージ量（使用者裁定：敵人剩餘HPと同じ値、GM畫面に
  // 表示されている「現在HP」＝各HP行のチェック済み方格数の合計と同じ読み取り方）。
  function computePursuitDamage() {
    var total = 0;
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (!enemyHasRow(i)) continue;
      total += countRowChecked(state.battle.enemyHp, i * ENEMY_HP_COLS, ENEMY_HP_COLS);
    }
    return total;
  }

  // --- 自動化GM 戰鬥自動化：PC人數補正（battle_pc_count_1〜4、既存の規則書参考文を実装） ---
  // 「PC人數」は瀕死状態も含めた「entered」全員の人数（パーティ編成そのものの人数であり、
  // 瀕死で一時的に行動不能でも人數補正の対象からは外れない——瀕死の除外はenteredCharacters
  // ForBattle側の「本回合行動できるか」判定にのみ適用する既存仕様と役割が異なる）。
  function enteredPcCount() {
    return rosterCharacters.filter(function (c) {
      return c.entered;
    }).length;
  }

  // PC 1人：PC總合傷害「×4」。PC 2人：「×2」。PC 3人：無修正。PC 4人：無修正（4人時は
  // 体力骰と敵人防禦次數の補正が別途ある、下記参照）。
  function pcCountDamageMultiplier() {
    var n = enteredPcCount();
    if (n === 1) return 4;
    if (n === 2) return 2;
    return 1;
  }

  // 敵人亂戰傷害與個別傷害「÷4」（PC1人）／「÷2」（PC2人）。倍率の分母は上のdamageMultiplier
  // と同じ表（4/2/1）を共用する。
  function pcCountEnemyDamageDivisor() {
    return pcCountDamageMultiplier();
  }

  // --- 自動化GM 戰鬥自動化：回合內細粒度階段（roundStage）・回合傷害彙總 ---

  // 現在のphase（combat/extra/defense）で、entered中の全員（瀕死状態を除く）が本フェイズの
  // スタミナダイスを振り終えたかどうか。
  function allEnteredCharactersRolledForPhase() {
    var flagKey =
      state.actionPhase === "extra" ? "_extraActionUsed" : state.actionPhase === "defense" ? "_defenseActionUsed" : "_combatDiceRolled";
    var entered = enteredCharactersForBattle();
    if (!entered.length) return false;
    return entered.every(function (c) {
      return !!c[flagKey];
    });
  }

  // 使用者確認：瀕死状態（c._nearDeath、救い出されるまで持続）のPCは、體力骰を振る要求や
  // 「已完成」按鈕列の対象から除外する（行動できないため）。戰鬥回合の自動化（擲骰完了判定・
  // 已完成按鈕・傷害/破防合計）は全てこの関数を経由するため、ここ1箇所で除外すれば十分。
  function enteredCharactersForBattle() {
    return rosterCharacters.filter(function (c) {
      return c.entered && !c._nearDeath;
    });
  }

  // 本回合、entered中の全員が「已完成」ボタンを押したかどうか。
  function allEnteredCharactersActionsDone() {
    var entered = enteredCharactersForBattle();
    if (!entered.length) return false;
    return entered.every(function (c) {
      return !!state.battle.roundActionsDone[c.id];
    });
  }

  // c._phaseDamageDealt（既存、每次攻撃で自動累積・phase reset時に0へ戻る）を全員分合算し、
  // PC人數補正（battle_pc_count_1/2）を「合計」にのみ適用する（各角色の個別の攻擊行動値・
  // 進度版の個人行動說明は素の値のまま、規則書の「PC總合傷害」という文言どおり合計だけを
  // 倍率対象にする）。
  function computeRoundDamageTotal() {
    var sum = enteredCharactersForBattle().reduce(function (total, c) {
      return total + (c._phaseDamageDealt || 0);
    }, 0);
    return sum * pcCountDamageMultiplier();
  }

  // c._phaseGuardReductionPoints（recordPhaseDamageDealtが▲=0.5/◆=1で自動累積）を全員分合算する。
  function computeRoundGuardReductionTotal() {
    return enteredCharactersForBattle().reduce(function (sum, c) {
      return sum + (c._phaseGuardReductionPoints || 0);
    }, 0);
  }

  // c._phaseAttributeGains（buildCharacterActionLogLinesと同じ既存欄位、labelは既に
  // 本地化済みの屬性/異常名）を全員分labelごとに合算し、「本回合統計」行に出す用の1行文字列に
  // まとめる。初出順（最初に登場したlabelの順）で「label+合計」を「、」でjoinする。使用者確認：
  // 本回合まったく蓄積が無ければ「-」を返す。
  function computeRoundAttributeGainsSummary() {
    var totals = {};
    var order = [];
    enteredCharactersForBattle().forEach(function (c) {
      var gains = c._phaseAttributeGains || {};
      Object.keys(gains).forEach(function (label) {
        if (!(label in totals)) order.push(label);
        totals[label] = (totals[label] || 0) + gains[label];
      });
    });
    if (!order.length) return "-";
    return order
      .map(function (label) {
        return label + "+" + totals[label];
      })
      .join("、");
  }

  // 自動化GM 戰鬥自動化：GM敘述と玩家操作按鈕は、既存の「進度版」（#location-status-overlay、
  // night_gm_flow.jsのrenderLocationBanner／actionKind==="battleWait"分支）内で完結させる
  // （使用者確認：戰鬥もgmFlow既存の敘述システムの管轄。地図側やbattle-drawerに別のバナー/
  // 按鈕列を新設しない）。この2つの関数はwindow.PriTestNightCore経由でnight_gm_flow.jsから
  // 呼ばれる（getRoundStageNarrationTextは文字列を返すだけ、renderBattleRoundActionButtonsは
  // 渡されたactionsEl＝#location-status-actionsへ直接描画する）。

  // 使用者確認：進度版に出す「本回合行動說明」は、個別の攻擊/技能ログを全部貼るのではなく、
  // この角色が本フェイズに与えた合計（傷害＋Guard削り値記号／屬性蓄積合計／特效）を1行に
  // まとめる。既存の累積欄（_phaseDamageDealt/_phaseGuardSymbols/_phaseAttributeGains/
  // _phaseSpecialNotes、いずれもrecordPhaseDamageDealt/recordAttributeStatusDealt/攻擊確定時に
  // 既に集計済み）を読むだけで、新しい計算はしない。
  function buildCharacterActionLogLines(c) {
    var damage = c._phaseDamageDealt || 0;
    var symbols = (c._phaseGuardSymbols || []).join("");
    var gains = c._phaseAttributeGains || {};
    var attrParts = Object.keys(gains).map(function (label) {
      return label + "+" + gains[label];
    });
    var effectParts = c._phaseSpecialNotes || [];
    if (!damage && !attrParts.length && !effectParts.length) {
      return [window.I18N.t("gm_flow_battle_action_none", { character: c.name })];
    }
    var damageText = damage + (symbols ? "＋" + symbols : "");
    return [
      window.I18N.t("gm_flow_battle_action_line", {
        character: c.name,
        damage: damageText,
        attribute: attrParts.length ? attrParts.join("、") : "-",
        effect: effectParts.length ? effectParts.join("、") : "-",
      }),
    ];
  }

  // 進度版に出す敘述文字（「請擲骰！」「攻擊中！」等＋各角色の行動說明＋回合結算）。
  // combat/extra/defense以外はnullを返し、呼び出し側は既存の静的敘述
  // （state.gmFlow.narrationText）にフォールバックする。
  function getRoundStageNarrationText() {
    // 簡易戰鬥の追擊損害確認待ち（simplifiedCombatEndPending）の間は、setActionPhaseが
    // "defense"への遷移を差し替えてstate.actionPhase自体は更新しない（＝phase/roundStageが
    // 直前のextra/awaitingRoll等のまま残る）ため、ここで敘述をnullにして抑制する。追擊損害の
    // 公告自体は#simplified-combat-end-overlay（renderSimplifiedCombatEndPrompt）が別途表示する。
    if (state.battle.simplifiedCombatEndPending) return null;
    var phase = state.actionPhase;
    if (phase !== "combat" && phase !== "extra" && phase !== "defense") return null;
    var stage = state.battle.roundStage || "awaitingRoll";
    var parts = [];
    if (stage === "resolving" && state.battle.roundResultText) {
      parts.push(state.battle.roundResultText);
    } else {
      var stageKey = stage === "awaitingRoll" ? "awaiting_roll" : stage;
      parts.push(window.I18N.t("round_stage_banner_" + phase + "_" + stageKey));
    }
    // 使用者確認：防禦階段に入った瞬間の処理（時間消耗1、連帶発生する威脅効果／夜雨）は、
    // 請擲骰！の段階から常に表示し続ける（awaitingRoll/acting問わず）。
    if (phase === "defense" && state.battle.defenseEntryEffectText) {
      parts.push(state.battle.defenseEntryEffectText);
    }
    if (stage === "acting") {
      // 防禦フェイズは、全員擲骰完了時にautoTriggerDefenseRollが自動的に敵方行動をロールし、
      // その速報（亂戰/個別傷害の内訳＋各PCの推定損害）をここに出す。
      if (phase === "defense" && state.battle.defenseRollPreviewText) {
        parts.push(state.battle.defenseRollPreviewText);
      }
      // 使用者確認：各角色の行は「按下已完成した順序」で1行ずつ並べる（roster順ではない）。
      // 取消して再度押すと、その行は末尾へ再追加される（state.battle.roundActionLogは
      // {charId, lines}の配列、push/spliceで管理——renderBattleRoundActionButtons参照）。
      var logLines = [];
      (state.battle.roundActionLog || []).forEach(function (entry) {
        logLines = logLines.concat(entry.lines || []);
      });
      if (logLines.length) parts.push(logLines.join("\n"));
      if (allEnteredCharactersActionsDone() && phase !== "defense") {
        parts.push(
          window.I18N.t("gm_flow_battle_round_damage_summary", {
            damage: computeRoundDamageTotal(),
            guard: computeRoundGuardReductionTotal(),
            attribute: computeRoundAttributeGainsSummary(),
          })
        );
      }
    }
    return parts.join("\n\n");
  }

  // 進度版の按鈕欄へ、本回合の玩家「已完成」按鈕列（未完了時）または[攻擊/防禦][返回]
  // （全員完了後）または[結束回合]（roundStage==="resolving"時）を描画する。
  // roundStage==="awaitingRoll"の間はまだ誰も骰子を振り終えていないため何も描画しない
  // （既存のbattleWait＝「按鈕なしで待つ」挙動のまま）。戻り値は「何か描画したか」の真偽値
  // （呼び出し側が既存のcombatTrigger等の按鈕と混同しないための判定に使う）。
  function renderBattleRoundActionButtons(actionsEl) {
    if (!actionsEl) return false;
    var phase = state.actionPhase;
    if (phase !== "combat" && phase !== "extra" && phase !== "defense") return false;
    var stage = state.battle.roundStage || "awaitingRoll";
    if (stage === "awaitingRoll") return false;
    if (stage === "resolving") {
      // 結果文字は敘述側（getRoundStageNarrationText）に出す。ここは[結束回合]のみ
      // （角色按鈕・[攻擊/防禦][返回]は一時的に隱藏する）。
      var endBtnKey =
        phase === "extra"
          ? "battle_turn_end_extra_phase_button"
          : phase === "defense"
          ? "battle_turn_end_defense_phase_button"
          : "battle_turn_end_combat_phase_button";
      var endBtn = document.createElement("button");
      endBtn.type = "button";
      endBtn.className = "gm-flow-action-btn";
      endBtn.textContent = window.I18N.t(endBtnKey);
      endBtn.addEventListener("click", handleBattleTurnEndRoundClick);
      actionsEl.appendChild(endBtn);
      return true;
    }
    var allDone = allEnteredCharactersActionsDone();
    if (!allDone) {
      enteredCharactersForBattle().forEach(function (c) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gm-flow-action-btn";
        // 「已完成」状態は、既存の「建議」ハイライトclass（gm-flow-suggested、通常は突破判定の
        // 建議選択肢に使う）を流用して表現する（新規CSSを増やさない）。
        if (state.battle.roundActionsDone[c.id]) btn.classList.add("gm-flow-suggested");
        btn.textContent = c.name;
        btn.addEventListener("click", function () {
          var nowDone = !state.battle.roundActionsDone[c.id];
          state.battle.roundActionsDone[c.id] = nowDone;
          if (!state.battle.roundActionLog) state.battle.roundActionLog = [];
          // 使用者確認：取消準備時はこの角色のぶんだけ配列から取り除く（後続の行は自然に
          // 繰り上がる）。再度準備した場合は配列の末尾へ追加する（元の位置には戻さない）。
          state.battle.roundActionLog = state.battle.roundActionLog.filter(function (entry) {
            return entry.charId !== c.id;
          });
          if (nowDone) {
            state.battle.roundActionLog.push({ charId: c.id, lines: buildCharacterActionLogLines(c) });
          }
          saveState();
          renderCurrentLocationStatus();
        });
        actionsEl.appendChild(btn);
      });
    } else {
      // 使用者確認：全員「已完成」を押した後は角色按鈕を一時的に隱藏し、[攻擊/防禦][返回]だけを出す。
      var returnBtn = document.createElement("button");
      returnBtn.type = "button";
      returnBtn.className = "gm-flow-action-btn";
      returnBtn.textContent = window.I18N.t("battle_turn_return_button");
      returnBtn.addEventListener("click", handleBattleTurnReturnClick);
      actionsEl.appendChild(returnBtn);

      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "gm-flow-action-btn";
      confirmBtn.textContent = window.I18N.t(
        phase === "defense" ? "battle_turn_defense_confirm_button" : "battle_turn_attack_confirm_button"
      );
      confirmBtn.addEventListener("click", handleBattleTurnConfirmClick);
      actionsEl.appendChild(confirmBtn);
    }
    return true;
  }

  function handleBattleTurnReturnClick() {
    state.battle.roundActionsDone = {};
    state.battle.roundActionLog = [];
    saveState();
    renderCurrentLocationStatus();
  }

  // 自動化GM 戰鬥自動化：使用者確認、行動階段の切替はGMが「行動階段」ボタンを手動で押す
  // 必要はなく、[結束回合]確認のたびに自動化GMが次のフェイズを決めて自動的に切り替える
  // （戰鬥→（體勢崩し時のみ）額外→防禦→戰鬥…の順、docs/combat_flow_rules.md §3）。
  // 敵人全滅で既にcombatEnd（一般行動）へ自動的に戻っている場合は何もしない
  // （handleEnemyHpChanged経由、applyGuardedDamageToEnemyの呼び出し内で既に起きている）。
  // 既存の「行動階段」手動ボタンはそのまま残し、GMが自動判定を上書きしたい場合の脱出口とする。
  // 防禦階段開始時の時間消耗+1（setActionPhase内、"defense"への遷移時に自動処理）は、この
  // 自動経路だけでなく手動の「行動階段」ボタンから直接defenseへ切り替えた場合にも等しく発火する。
  function autoAdvanceBattlePhase() {
    if (state.actionPhase === "combat") {
      // 使用者確認：「1段が體勢崩しを起こすのは1回だけ」——既に額外階段のトリガーとして
      // 使用済みの段（staggerRowsHandled）はHPが0のままでも再度額外階段を発生させない。
      if (anyUnhandledStaggeredRow()) {
        markStaggeredRowsHandled();
        setActionPhase("extra");
      } else {
        setActionPhase("defense");
      }
    } else if (state.actionPhase === "extra") {
      setActionPhase("defense");
    } else if (state.actionPhase === "defense") {
      setActionPhase("combat");
    } else {
      // "normal"（combatEnd等で既に切り替わり済み）を含め、ここでは追加のphase遷移は行わず、
      // 進度版の表示だけ最新化する。
      renderCurrentLocationStatus();
    }
  }

  // [攻擊]／[防禦]確認。combat/extraフェイズでは、既存の「防禦次數／HP價值計算機」
  // （battle-guard-calc-block、battle-drawer内のGM専用ツール）の入力欄へ本回合の彙總値を
  // 自動預填してから、既存のhandleBattleGuardCalcApply()をそのまま呼ぶ（applyGuardedDamageToEnemy
  // を直接叩く専用経路は新設しない、既存Guard計算機と同じ挙動を保つ）。結果文字だけ進度版へ
  // 表示し、実際のフェイズ遷移は[結束回合]（handleBattleTurnEndRoundClick）まで待つ。
  // 防禦フェイズは既存の#enemy-damage-modalを開くだけ（結果文字とフェイズ自動遷移の準備は
  // GMがモーダル内で確認した瞬間＝handleEnemyDamageConfirmの末尾で行う）。
  function handleBattleTurnConfirmClick() {
    if (state.actionPhase === "defense") {
      openEnemyDamageModal();
      return;
    }
    var damageInput = document.getElementById("battle-guard-calc-damage-input");
    var reductionInput = document.getElementById("battle-guard-calc-reduction-input");
    var resultText = "";
    if (damageInput && reductionInput) {
      damageInput.value = String(computeRoundDamageTotal());
      reductionInput.value = String(computeRoundGuardReductionTotal());
      var applyResult = handleBattleGuardCalcApply();
      // 使用者確認：進度版に出す結算文字はHP價値／防禦次數を出さず、敵人名・總合傷害・
      // 扣除したHP損害の格数、体勢崩し発生の有無だけに絞る（battle-guard-calc-result側の
      // 詳細版はbattle-drawer内のGM専用ツール表示のまま変更しない）。
      if (applyResult && applyResult.result) {
        var enemyName = enemyDisplayNameForKey(applyResult.key);
        var textKey = applyResult.result.split ? "gm_flow_battle_attack_result_split" : "gm_flow_battle_attack_result";
        resultText = window.I18N.t(textKey, {
          enemy: enemyName,
          damage: applyResult.totalDamage,
          boxes: applyResult.result.hpBoxes,
        });
        if (anyEnemyHpRowDepleted()) {
          resultText += window.I18N.t("gm_flow_battle_stagger_note");
        }
      }
    }
    if (state.actionPhase === "normal") {
      // 敵人がこの攻擊で全滅し、既にcombatEndで一般行動へ自動的に戻っている
      // （handleEnemyHpChanged経由）。[結束回合]は不要、進度版の表示だけ最新化する。
      renderCurrentLocationStatus();
      return;
    }
    state.battle.roundResultText = resultText;
    state.battle.roundStage = "resolving";
    saveState();
    renderCurrentLocationStatus();
  }

  // [結束回合]：使用者が結果文字を確認した後にクリックし、ここで初めて自動化GMが
  // 次のフェイズへ実際に切り替える（autoAdvanceBattlePhase、docs/combat_flow_rules.md §3）。
  function handleBattleTurnEndRoundClick() {
    state.battle.roundResultText = null;
    saveState();
    autoAdvanceBattlePhase();
  }

  // エネミーHPが変化するたびに呼び、額外行動ボタンの活性状態を更新しつつ、
  // 4段全滅であれば自動的に一般行動へ切り替えて戦闘終了を記録する。
  function handleEnemyHpChanged() {
    renderActionPhaseGrid();
    var depleted = allEnemyHpRowsDepleted();
    if (state.actionPhase !== "normal" && depleted) {
      setActionPhase("normal", { combatEnd: true }); // 内部でnotifyCombatEndedも呼ばれる
      return;
    }
    // 自動化GM Phase 2［戰鬥機制］：GMが行動階段を一度も「戰鬥」へ切り替えず（state.actionPhase
    // が最初から"normal"のまま）に敵のHPだけ0まで減らした場合、上のif（actionPhase切替に
    // 付随するcombatEnd）が発火しないため、雜兵戰鬥／王戰ボタン由来の戦闘待ちがいつまでも
    // 解除されない不具合があった（ユーザー報告：出發地點で君主軍を撃破してもGMが検知しない）。
    // ここで独立してもう一度チェックし、battleWaitActive中であれば直接解除する。
    if (depleted && window.PriTestNightGmFlow && window.PriTestNightGmFlow.notifyCombatEnded) {
      window.PriTestNightGmFlow.notifyCombatEnded();
    }
  }

  // エネミーのHP枠表記（例："×7/×7"）から、第1段・第2段それぞれの個数を取り出す。
  // 解析できない場合はnullを返す。
  function parseEnemyHpNotation(text) {
    var m = /[×xX]\s*(\d+)\s*\/\s*[×xX]\s*(\d+)/.exec(String(text || ""));
    if (!m) return null;
    return { row1: parseInt(m[1], 10), row2: parseInt(m[2], 10) };
  }

  // 段のチェック数を、増減ではなく指定した個数ちょうどに設定する（左詰め）。
  // エネミー追加時、残りHPを実際の最大値で満タン初期化するために使う。
  function setEnemyHpRowCount(rowIdx, count) {
    var start = rowIdx * ENEMY_HP_COLS;
    var clamped = Math.max(0, Math.min(ENEMY_HP_COLS, count));
    for (var i = 0; i < ENEMY_HP_COLS; i++) {
      state.battle.enemyHp[start + i] = i < clamped;
    }
  }

  function adjustEnemyHpRow(rowIdx, delta) {
    var start = rowIdx * ENEMY_HP_COLS;
    var current = countRowChecked(state.battle.enemyHp, start, ENEMY_HP_COLS);
    // 「＋」（回復）は敵の実際の最大値までしか回復できない（固定20マスまでではない）。
    var target = Math.max(0, Math.min(enemyHpRowMax(rowIdx), current + delta));
    if (target === current) return;
    if (target > current) {
      var need = target - current;
      for (var i = 0; i < ENEMY_HP_COLS && need > 0; i++) {
        if (!state.battle.enemyHp[start + i]) {
          state.battle.enemyHp[start + i] = true;
          need--;
        }
      }
    } else {
      var remove = current - target;
      for (var j = ENEMY_HP_COLS - 1; j >= 0 && remove > 0; j--) {
        if (state.battle.enemyHp[start + j]) {
          state.battle.enemyHp[start + j] = false;
          remove--;
        }
      }
    }
    // 復仇者「死靈術」：雑兵の段と同様、非雑兵エネミー側の段も「未撃破→ちょうど今回0に到達」
    // した瞬間だけ発火させる（既に0の段をさらに操作しても再発火しない）。
    if (current !== 0 && target === 0 && isSplitFormExemptRow(rowIdx)) {
      // グラディウス「分裂形態」移行条件2：分裂形態では体勢崩し自体が発生しない
      // （ユーザー確認済み仕様）ため、guardBroken／體崩バナーは一切発火させず、代わりに
      // 「防御フェイズ終了時に合体形態へ戻す」予約フラグだけを立てる。
      state.battle.bossFormTransitionPending = true;
    } else if (current !== 0 && target === 0) {
      // 體勢崩潰：エネミー／夜の王のHP行のいずれか1行が最初に0へ到達した瞬間だけ一度発火する
      // （ユーザー確認済み：どの行が最初かは問わない、以後の行の0到達では再発火しない）。
      if (!state.battle.guardBroken) {
        state.battle.guardBroken = true;
        addLog("log_guard_break_triggered");
      }
      handleMobRowDepleted();
      if (enemyHasRow(rowIdx)) {
        // 夜の王はHP行を末尾から割り当てる後ろ詰め規約（enemyHpRowIndexForKey）のため、
        // selectedEnemyIds内の並び順（先頭から詰める通常エネミー用）とは対応しない。
        // 第三天で夜の王のHP行なら先にそちらを優先して解決する。
        var night3BossKey = game && game.night3BossId && state.dayNumber >= 3 ? "boss|" + game.night3BossId : null;
        var depletedEnemyKey =
          night3BossKey && enemyHpRowIndexForKey(night3BossKey) !== -1 && rowIdx >= enemyHpRowIndexForKey(night3BossKey)
            ? night3BossKey
            : (state.battle.selectedEnemyIds || [])[rowIdx];
        var depletedEnemyName = depletedEnemyKey
          ? enemyDisplayNameForKey(depletedEnemyKey)
          : window.I18N.t("battle_hp_row_label", { row: rowIdx + 1 });
        if (allEnemyHpRowsDepleted()) {
          showEnemyRowStatusBanner("defeated", window.I18N.t("enemy_row_status_defeated_banner", { enemy: depletedEnemyName }));
        } else {
          showEnemyRowStatusBanner("staggered", window.I18N.t("enemy_row_status_staggered_banner", { enemy: depletedEnemyName }));
        }
      }
    }
    renderEnemyHpGrid();
    renderSelectedEnemies();
    saveState();
    handleEnemyHpChanged();
  }

  function renderEnemyHpGrid() {
    ENEMY_HP_GRID_TARGETS.forEach(function (target) {
      var container = document.getElementById(target.containerId);
      if (!container) return;
      container.innerHTML = "";
      for (var row = 0; row < ENEMY_HP_ROWS; row++) {
        (function (rowIdx) {
          var count = countRowChecked(state.battle.enemyHp, rowIdx * ENEMY_HP_COLS, ENEMY_HP_COLS);
          // 第3/4段（夜の王等の多段エネミー専用）は、実際に割り当て（enemyHpMax設定）または
          // 既にHPが入っている場合のみ表示する。通常の2段エネミーでは空の段を表示しない。
          if (rowIdx >= 2 && !enemyHasRow(rowIdx) && count === 0) return;
          var rowDiv = document.createElement("div");
          rowDiv.className = "battle-hp-stepper-row";

          var label = document.createElement("span");
          label.className = "battle-hp-stepper-label";
          label.textContent = window.I18N.t("battle_hp_row_label", { row: rowIdx + 1 });
          rowDiv.appendChild(label);

          if (!target.readOnly) {
            var minus = document.createElement("button");
            minus.type = "button";
            minus.className = "level-btn";
            minus.textContent = "−";
            minus.addEventListener("click", function () {
              adjustEnemyHpRow(rowIdx, -1);
            });
            rowDiv.appendChild(minus);
          }

          var value = document.createElement("span");
          value.className = "level-value battle-hp-stepper-value";
          // 分母は敵ごとの実際の最大値ではなく、常に固定20マスで統一表示する
          // （撃破判定など内部ロジックでは実際の最大値enemyHpRowMaxを使う）。
          value.textContent = count + "/" + ENEMY_HP_COLS;
          rowDiv.appendChild(value);

          if (!target.readOnly) {
            var plus = document.createElement("button");
            plus.type = "button";
            plus.className = "level-btn";
            plus.textContent = "＋";
            plus.addEventListener("click", function () {
              adjustEnemyHpRow(rowIdx, 1);
            });
            rowDiv.appendChild(plus);
          }

          if (isEnemyHpRowDepleted(rowIdx)) {
            var defeated = allEnemyHpRowsDepleted();
            var statusBadge = document.createElement("span");
            statusBadge.className = "battle-hp-row-status " + (defeated ? "status-defeated" : "status-staggered");
            statusBadge.textContent = window.I18N.t(defeated ? "enemy_row_status_defeated_badge" : "enemy_row_status_staggered_badge");
            rowDiv.appendChild(statusBadge);
          }

          container.appendChild(rowDiv);
        })(row);
      }
    });
  }

  // 「防禦次數／HP價值 計算機」（battle-drawer）：GMがPCの總合ダメージ＋ガード削り値
  // （◆/▲を事前に合算した数値、GMが規則書コラムに沿って手入力）を入力すると、
  // applyGuardedDamageToEnemyがガード回数の減少とHP損害への換算を一括で行う。
  // 対象はresolveSelectedEnemyOptions（通常エネミー＋設定済みの夜の王）と同じ一覧。
  function renderBattleGuardCalc() {
    var select = document.getElementById("battle-guard-calc-target-select");
    var statusEl = document.getElementById("battle-guard-calc-status");
    var applyBtn = document.getElementById("btn-battle-guard-calc-apply");
    if (!select) return;
    var options = resolveSelectedEnemyOptions();
    var prevValue = select.value;
    select.innerHTML = "";
    options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt.key;
      o.textContent = opt.name;
      select.appendChild(o);
    });
    if (options.some(function (o) { return o.key === prevValue; })) select.value = prevValue;
    var key = select.value;
    var hasData = !!key && typeof enemyGuardMaxCount(key) === "number";
    if (hasData) ensureBossHpRowsInitialized(key);
    if (applyBtn) applyBtn.disabled = !options.length || !hasData;
    if (!statusEl) return;
    if (!options.length) {
      statusEl.textContent = window.I18N.t("battle_guard_calc_no_target");
    } else if (!hasData) {
      statusEl.textContent = window.I18N.t("battle_guard_calc_no_guard_data", { enemy: enemyDisplayNameForKey(key) });
    } else {
      statusEl.textContent = window.I18N.t("battle_guard_calc_current_status", {
        enemy: enemyDisplayNameForKey(key),
        current: enemyCurrentGuardCount(key),
        max: enemyGuardMaxCount(key),
        hpValue: enemyGuardValueForCount(key, enemyCurrentGuardCount(key)),
      });
    }
  }

  function handleBattleGuardCalcApply() {
    var select = document.getElementById("battle-guard-calc-target-select");
    var damageInput = document.getElementById("battle-guard-calc-damage-input");
    var reductionInput = document.getElementById("battle-guard-calc-reduction-input");
    var resultEl = document.getElementById("battle-guard-calc-result");
    var key = select && select.value;
    if (!key) return;
    var totalDamage = Math.max(0, Number(damageInput.value) || 0);
    var reduction = Math.max(0, Number(reductionInput.value) || 0);
    var result = applyGuardedDamageToEnemy(key, totalDamage, reduction);
    if (!result) return;
    if (resultEl) {
      resultEl.hidden = false;
      var text = window.I18N.t("battle_guard_calc_result_text", {
        enemy: enemyDisplayNameForKey(key),
        damage: totalDamage,
        guardBefore: result.currentGuard,
        guardAfter: result.newGuard,
        hpValue: result.hpValue,
        boxes: result.hpBoxes,
      });
      if (result.split) text += " " + window.I18N.t("battle_guard_calc_split_note", { boxes: result.hpBoxes });
      resultEl.textContent = text;
    }
    damageInput.value = "0";
    reductionInput.value = "0";
    renderBattleGuardCalc();
    // 自動化GM 戰鬥自動化：進度版側（handleBattleTurnConfirmClick）が既存のbattle-guard-calc
    // ブロックとは別の簡潔な結算文字を組み立てられるよう、対象key／総合傷害／apply結果を返す。
    return { key: key, totalDamage: totalDamage, result: result };
  }

  // 雑魚HPリストも、エネミーHPグリッドと同様に戦場面板内のフル表示（削除ボタン付き）と、
  // 盤面左側の共用パネル（board-side-mob-hp-list、削除ボタンなしの簡易表示）の2箇所に
  // 同じstate.battle.mobHpRowsを描画する。どちらのチェックボックスを操作しても両方に
  // 即時反映される。共用パネル側は雑魚が1行も無いときは非表示にする。
  // 使用者確認（項目7）：board-side-mob-hp-list（公開盤共用面板）不應顯示+/-鈕。
  var MOB_HP_LIST_TARGETS = [
    { containerId: "battle-mob-hp-list", withRemove: true },
    { containerId: "board-side-mob-hp-list", withRemove: false, readOnly: true },
  ];

  var MOB_HP_COLS = 10;

  function adjustMobHpRow(rowIndex, delta) {
    var row = state.battle.mobHpRows[rowIndex];
    if (!row) return;
    // 各列の上限＝そのrow配列自身の長さ（自動化GMが計算値でaddAutoMobHpRowした場合は
    // 可変長。GM手動［+］のhandleAddMobRowは従来通りMOB_HP_COLS(10)固定で作る）。
    var max = row.length;
    var current = countRowChecked(row, 0, max);
    var target = Math.max(0, Math.min(max, current + delta));
    if (target === current) return;
    if (target > current) {
      var need = target - current;
      for (var i = 0; i < max && need > 0; i++) {
        if (!row[i]) {
          row[i] = true;
          need--;
        }
      }
    } else {
      var remove = current - target;
      for (var j = max - 1; j >= 0 && remove > 0; j--) {
        if (row[j]) {
          row[j] = false;
          remove--;
        }
      }
    }
    // 復仇者「死靈術」：雑兵の段が「未到達→ちょうど今回HP0に到達」した瞬間だけ発火させる
    // （既にHP0の段をさらに操作しても再発火しない）。非雑兵エネミー側のhandleEnemyHpChangedに
    // 相当する検知が雑兵側には無かったため、ここに追加する。
    if (current !== max && target === max) {
      handleMobRowDepleted();
    }
    renderMobHpList();
    saveState();
    // 使用者確認（項目1）：雜兵側のHP変化でも、非雜兵エネミー側のadjustEnemyHpRowと同様に
    // 戦闘終了判定（allEnemyHpRowsDepleted経由）を起動する——以前は雜兵の段だけを扣光しても
    // combatEndが一切検知されず、樓層が推進しないバグがあった。
    handleEnemyHpChanged();
  }

  // 死靈術（necromancy）能力を持つ入場済みキャラ全員に「擲骰待ち」を1件積む。
  // 実際の擲骰・成否判定はSpirit Panel側（renderSpiritPanel）で行う。
  // 雑兵の段（adjustMobHpRow）・非雑兵エネミーの段（adjustEnemyHpRow）どちらの撃破からも呼ばれる。
  function handleMobRowDepleted() {
    rosterCharacters.forEach(function (c) {
      if (!c.entered) return;
      var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
      var hasNecromancy =
        type &&
        (type.abilities || []).some(function (entry) {
          return entry.id === "necromancy";
        });
      if (!hasNecromancy) return;
      c._necromancyPendingCount = (c._necromancyPendingCount || 0) + 1;
    });
    saveRosterCharacters();
    renderCharacterRoster();
  }

  // 死靈術の擲骰待ちが1件以上あるキャラのみ、擲骰UI（またはロール後のYes/No確認）を描画する。
  // 出目が「指定範囲內」かどうかの実際の判定基準は本文に数値が無いため、淑女「重演」の3格確認
  // ゲートと同型でGM/プレイヤーの手動判定に委ねる（本アプリ全体の「■/▲等の数値未確定値は
  // 捏造しない」方針を踏襲）。
  var necromancyRollState = null; // { characterId, rollValue } | null

  function renderNecromancyPendingSection(c, container) {
    if (!(c._necromancyPendingCount > 0)) return;
    var note = document.createElement("p");
    note.className = "threat-ref-body";
    note.textContent = window.I18N.t("necromancy_pending_note", { count: c._necromancyPendingCount });
    container.appendChild(note);

    if (necromancyRollState && necromancyRollState.characterId === c.id) {
      var resultNote = document.createElement("p");
      resultNote.className = "threat-ref-body";
      resultNote.textContent = window.I18N.t("necromancy_roll_result_note", { value: necromancyRollState.rollValue });
      container.appendChild(resultNote);
      var confirmRow = document.createElement("div");
      confirmRow.className = "wb-row";
      [
        { key: true, label: window.I18N.t("necromancy_confirm_yes_button") },
        { key: false, label: window.I18N.t("necromancy_confirm_no_button") },
      ].forEach(function (opt) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = opt.label;
        btn.addEventListener("click", function () {
          c._necromancyPendingCount = Math.max(0, (c._necromancyPendingCount || 0) - 1);
          if (opt.key) {
            if (!c.deathSpirits) c.deathSpirits = [];
            c.deathSpirits.push({ id: "ds" + Date.now() + Math.floor(Math.random() * 1000), hpCurrent: 3, hpMax: 3 });
            addLog("log_necromancy_summon", { character: c.name });
          } else {
            addLog("log_necromancy_fail", { character: c.name });
          }
          necromancyRollState = null;
          saveRosterCharacters();
          renderSpiritPanel();
        });
        confirmRow.appendChild(btn);
      });
      container.appendChild(confirmRow);
    } else {
      var rollBtn = document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "combat-attack-hit-btn";
      rollBtn.textContent = window.I18N.t("necromancy_roll_button");
      rollBtn.addEventListener("click", function () {
        necromancyRollState = { characterId: c.id, rollValue: 1 + Math.floor(Math.random() * 6) };
        renderSpiritPanel();
      });
      container.appendChild(rollBtn);
    }
  }

  function renderMobHpList() {
    MOB_HP_LIST_TARGETS.forEach(function (target) {
      var container = document.getElementById(target.containerId);
      if (!container) return;
      container.innerHTML = "";
      state.battle.mobHpRows.forEach(function (row, rowIndex) {
        var rowWrap = document.createElement("div");
        rowWrap.className = "battle-hp-row-wrap";
        var rowDiv = document.createElement("div");
        rowDiv.className = "battle-hp-stepper-row";

        var count = countRowChecked(row, 0, row.length);

        if (!target.readOnly) {
          var minus = document.createElement("button");
          minus.type = "button";
          minus.className = "level-btn";
          minus.textContent = "−";
          minus.addEventListener("click", function () {
            adjustMobHpRow(rowIndex, -1);
          });
          rowDiv.appendChild(minus);
        }

        var value = document.createElement("span");
        value.className = "level-value battle-hp-stepper-value";
        value.textContent = count + "/" + row.length;
        rowDiv.appendChild(value);

        if (!target.readOnly) {
          var plus = document.createElement("button");
          plus.type = "button";
          plus.className = "level-btn";
          plus.textContent = "＋";
          plus.addEventListener("click", function () {
            adjustMobHpRow(rowIndex, 1);
          });
          rowDiv.appendChild(plus);
        }

        rowWrap.appendChild(rowDiv);
        if (target.withRemove) {
          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "tag-remove battle-row-remove";
          removeBtn.textContent = "×";
          removeBtn.title = window.I18N.t("battle_remove_row_button");
          removeBtn.addEventListener("click", function () {
            state.battle.mobHpRows.splice(rowIndex, 1);
            renderMobHpList();
            saveState();
          });
          rowWrap.appendChild(removeBtn);
        }
        container.appendChild(rowWrap);
      });
    });

    var boardSideMobHp = document.getElementById("board-side-mob-hp");
    if (boardSideMobHp) boardSideMobHp.hidden = state.battle.mobHpRows.length === 0;
  }

  function handleAddMobRow() {
    state.battle.mobHpRows.push(new Array(MOB_HP_COLS).fill(false));
    saveState();
    renderMobHpList();
  }

  // 自動化GM専用：算出済みの雜兵最大HPで新しい列を追加する（GM手動のhandleAddMobRowと違い、
  // 上限が固定10ではなく計算値そのもの——night_gm_flow.jsのresolveAndAddCombatEnemies経由で呼ばれる）。
  function addAutoMobHpRow(maxHp) {
    var n = Math.max(1, Math.round(maxHp) || 1);
    state.battle.mobHpRows.push(new Array(n).fill(false));
    saveState();
    renderMobHpList();
    return n;
  }

  function renderBattleRefTexts() {
    document.getElementById("battle-pc-damage-body").textContent = window.I18N.t("battle_pc_damage_body");
    document.getElementById("battle-enemy-damage-body").textContent = window.I18N.t("battle_enemy_damage_body");
    document.getElementById("battle-position-body").textContent = window.I18N.t("battle_position_body");
    document.getElementById("battle-simple-combat-body").textContent = window.I18N.t("battle_simple_combat_body");
    document.getElementById("battle-pc-count-body").textContent = [
      window.I18N.t("battle_pc_count_1"),
      window.I18N.t("battle_pc_count_2"),
      window.I18N.t("battle_pc_count_3"),
      window.I18N.t("battle_pc_count_4"),
    ].join("\n");
  }

  function handleBattleClear() {
    if (!window.confirm(window.I18N.t("battle_clear_confirm"))) return;
    state.battle = defaultBattleState();
    saveState();
    addLog("log_battle_clear");
    renderBattlePositionAreas();
    renderEnemyHpGrid();
    renderMobHpList();
    renderSelectedEnemies();
    renderActionPhaseGrid();
  }

  // 設定の「重置全骰」：共用骰子池・各角色個別の骰子・各角色の執行紀錄（點線枠のアクション
  // ボックス）に加えて、戦場面板（前後衛・敵視・敵HP・選択中の敵人）も丸ごと初期化し、
  // 敵人を面板から取り除く（GM報告：以前は骰子だけ消してもsyncDiceStatusToBattleが空の
  // 骰子池から前後衛/敵視の「表示」を再計算するだけで、敵人自体は面板に残ったままだった）。
  // handleBattleClear単体の「清除並初始化戰鬥板」ボタンは、骰子は残したまま戦場だけ
  // 初期化したい場合のために引き続き残す。clearAllPendingActionBoxes自体が消去内容の
  // 要約をログへ残すため、ここでは二重にログしない。
  // 実際のクリア処理本体（confirmダイアログを含まない）。手動の「重置全骰」ボタン
  // （handleResetAllDice、window.confirmを経由）と、敵人擊破後の自動化GM經路
  // （night_gm_flow.jsのresetAllDiceSilently呼び出し、GMの明示的な領取完了操作の延長として
  // confirmを挟まない）の両方から共用する。
  function performResetAllDice() {
    state.dicePool = [];
    rosterCharacters.forEach(function (c) {
      c.dicePool = [];
    });
    clearAllPendingActionBoxes();
    state.battle = defaultBattleState();
    saveState();
    saveRosterCharacters();
    addLog("log_reset_all_dice");
    renderDicePool();
    renderCharacterRoster();
    renderBattlePositionAreas();
    renderEnemyHpGrid();
    renderMobHpList();
    renderSelectedEnemies();
    renderActionPhaseGrid();
  }

  function handleResetAllDice() {
    if (!window.confirm(window.I18N.t("reset_all_dice_confirm"))) return;
    performResetAllDice();
  }

  function renderDicePool() {
    var listEl = document.getElementById("dice-pool-list");
    CharacterDrawer.renderDicePool(
      listEl,
      state.dicePool,
      function (index) {
        state.dicePool.splice(index, 1);
        saveState();
        renderDicePool();
      },
      document.getElementById("btn-dice-pool-add")
    );
  }

  // 共用骰子池は行動階段に関わらず常に同じ動作（1回押すごとに1個ずつ、複選可）。
  function handleAddDice() {
    if (state.dicePool.length >= CharacterDrawer.MAX_DICE_POOL) return;
    state.dicePool.push(CharacterDrawer.rollD6());
    saveState();
    renderDicePool();
  }

  // 戦闘／額外／防禦行動フェイズ中、各角色の面板にある🎲アイコンから、その角色1人分だけ骰子を振る。
  // 戦闘は骰子池が空の時だけ（体力骰actionの数だけ）。額外・防禦は前フェイズの骰子を保持したまま
  // 追加で振れるが、いずれも1回限り（フェイズを切り替えるたびに使用済みフラグがリセットされる）。
  // 一般行動では何もしない。
  function rollDiceForCharacterActionPhase(c) {
    if (state.actionPhase === "normal") return;
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    if (!type) return;
    if (!c.dicePool) c.dicePool = [];
    var rolled = 0;
    if (state.actionPhase === "extra") {
      if (!c._extraActionUsed) {
        rolled = 2;
        for (var i = 0; i < rolled; i++) c.dicePool.push(CharacterDrawer.rollD6());
        c._extraActionUsed = true;
      }
    } else if (state.actionPhase === "combat") {
      // R4遺物効果「回合結束時，體力骰帶入1個」で骰子が1個持ち越されている場合でも、
      // 戰鬥階段の獲得骰子数（staminaDice.action）はその影響を受けず、常に全量振れる
      // （c.dicePool.length===0だけを判定基準にすると持ち越し骰があるせいで振れなくなるため、
      // フェイズ切替の都度リセットする専用フラグで判定する）。
      if (!c._combatDiceRolled) {
        // 睡眠トリガーで課された「次回合のスタミナ骰-3」を、この回合の擲骰時に1回だけ消費する。
        // PC人數補正（battle_pc_count_4）：PC4人の場合、行動階段（戰鬥階段）で獲得する
        // 體力骰が全員「－1」個になる（既存の参考文をここで実装）。
        var pcCountDicePenalty = enteredPcCount() === 4 ? 1 : 0;
        rolled = Math.max(0, type.staminaDice.action - (c._nextActionDicePenalty || 0) - pcCountDicePenalty);
        c._nextActionDicePenalty = 0;
        for (var j = 0; j < rolled; j++) c.dicePool.push(CharacterDrawer.rollD6());
        c._combatDiceRolled = true;
      }
    } else if (state.actionPhase === "defense") {
      if (!c._defenseActionUsed) {
        // R4 遺物効果「防禦階段開始時體力骰回復」：防禦フェイズの獲得骰子数に+1する
        // （本文が「+1」のような具体数値を持たない代わりに、既存のカウント系ヘルパーで
        // 名前一致1件ごとに固定+1として扱う既存規則に従う）。
        var defenseDiceBonus = CharacterDrawer.countLearnedRelicEffectsByName(c, [
          "防禦階段開始時體力骰回復",
          "ディフェンス開始時スタミナダイス回復",
        ]);
        rolled = type.staminaDice.defense + defenseDiceBonus;
        for (var k = 0; k < rolled; k++) c.dicePool.push(CharacterDrawer.rollD6());
        c._defenseActionUsed = true;
      }
    } else {
      return;
    }
    // 防禦骰が0個のキャラクターなど、「押したのに何も起きない」ように見えるケースがあるため、
    // 実際に振った数（0も含む）をアイコン脇に表示して知らせる。
    rosterDiceRollFeedback[c.id] = rolled;
    saveRosterCharacters();
    renderCharacterRoster();
    if (rolled > 0) {
      playDiceRollAnimation(c.dicePool.slice(c.dicePool.length - rolled));
    }
    // 自動化GM 戰鬥自動化：全員が本フェイズのスタミナダイスを振り終えたら"awaitingRoll"から
    // "acting"へ進める。defenseフェイズも対象——全員の防禦體力骰が揃って初めて、AutoGM擲骰
    // （既存のrenderAutoGmRollRow/handleAutoGmRollClick、Stage 6で別途ゲート）へ進める。
    if (
      (state.actionPhase === "combat" || state.actionPhase === "extra" || state.actionPhase === "defense") &&
      state.battle.roundStage === "awaitingRoll" &&
      allEnteredCharactersRolledForPhase()
    ) {
      state.battle.roundStage = "acting";
      // 自動化GM 戰鬥自動化：防禦フェイズは、全員の防禦體力骰が揃った瞬間にAutoGMの
      // 敵方行動ロールを自動実行し、結果（亂戰傷害／個別傷害の内訳と各PCの推定損害）を
      // 進度版へ表示する（GMが後で[防禦]を押した時に開くモーダルは、ここで確定した
      // 同じ数値を復元するだけで再擲骰はしない）。
      // 使用者確認（雲端同步ゲームで再現・修正）：ここで先にsaveState()してから直後に
      // autoTriggerDefenseRoll()内でも再度saveState()すると、「roundStage:acting／
      // pendingDefenseRoll:null」という一瞬だけの中間状態が別端末のsubscribeNightState
      // 購読へ配信されてしまい、タイミング次第でその中間状態がそのまま最終表示として
      // 残ってしまう（＝GM側の進度版に敵人の行動・傷害が一切表示されないバグの原因）。
      // roundStage=actingとpendingDefenseRollの確定を必ず1回のsaveState()にまとめるため、
      // autoTriggerDefenseRollが実際に処理した（＝自身でsaveState()した）場合はここで
      // 重複保存しない。何もしなかった場合（autoGM無効／構造化データ無し等）のみ、
      // 従来通りここでroundStage=actingの変更を保存する。
      var autoRollHandled = state.actionPhase === "defense" && autoTriggerDefenseRoll();
      if (!autoRollHandled) saveState();
    }
    renderCurrentLocationStatus();
  }

  function renderActionPhaseButton() {
    var btn = document.getElementById("btn-action-phase");
    if (!btn) return;
    btn.textContent = window.I18N.t("action_phase_" + state.actionPhase);
    // 階段ごとの配色（style.css .action-phase-btn[data-phase="..."]）を切り替えるための目印。
    btn.dataset.phase = state.actionPhase;
    // 自動化GM 戰鬥自動化：使用者確認、戰鬥が自動化GM（進度版のbattleWait）に委ねられている間は
    // 手動の「行動階段」切替ボタンを表示しない（管理員は進度版の敘述だけで現在階段を把握できる。
    // 前端のこのボタン自体は削除せず、非戰鬥時や手動編成した戰鬥では引き続き使える）。
    btn.hidden = !!(state.gmFlow && state.gmFlow.battleWaitActive);
    document.querySelectorAll(".action-phase-grid button[data-phase]").forEach(function (phaseBtn) {
      phaseBtn.classList.toggle("active", phaseBtn.dataset.phase === state.actionPhase);
    });
    renderEnemyDamageButtonVisibility();
  }

  // 「敵人傷害」判定ボタン（判定發生／籌碼事件と同じ判定メニュー行）は防禦フェイズ限定。
  function renderEnemyDamageButtonVisibility() {
    var btn = document.getElementById("btn-enemy-damage-open");
    if (btn) btn.hidden = state.actionPhase !== "defense";
  }

  function openEnemyDamageModal() {
    renderEnemyDamageModal();
    document.getElementById("enemy-damage-modal").hidden = false;
  }

  function closeEnemyDamageModal() {
    document.getElementById("enemy-damage-modal").hidden = true;
  }

  // 自動化GM Phase 1: 敵人傷害モーダルを開くたび、state.autoGmEnabled かつ turnHolder==="gm"
  // かつ構造化済みの敵人が選択中の場合のみ、ロール用のセレクト＋ボタンを表示する。それ以外は
  // 完全に非表示＝既存の手動フローと見た目・挙動ともに変わらない。
  function renderAutoGmRollRow() {
    var row = document.getElementById("auto-gm-roll-row");
    var formRow = document.getElementById("auto-gm-boss-form-row");
    var resultEl = document.getElementById("auto-gm-roll-result");
    if (!row) return;
    resultEl.hidden = true;
    resultEl.textContent = "";
    // 使用者確認：防禦フェイズは全員擲骰完了時にautoTriggerDefenseRollが既に1回だけ擲骰し、
    // 結果を進度版で公開済み（state.battle.pendingDefenseRoll）。規則書上の再擲骰権限が無い限り、
    // このモーダル内から重複して擲骰できないよう行自体を隠す（数値の食い違いを防ぐ）。
    if (state.battle.pendingDefenseRoll) {
      row.hidden = true;
      if (formRow) formRow.hidden = true;
      return;
    }
    var AutoGm = window.PriTestAutoGm;
    if (!state.autoGmEnabled || state.turnHolder !== "gm" || !AutoGm) {
      row.hidden = true;
      if (formRow) formRow.hidden = true;
      return;
    }
    var structuredIds = ((state.battle && state.battle.selectedEnemyIds) || []).filter(function (key) {
      return AutoGm.isStructured(key);
    });
    // 夜の王（試作）：state.battle.selectedEnemyIdsとは別枠で、このゲームに設定された
    // night3BossId（管理員が選んだ夜の王）を、構造化済みであれば常に選択肢へ追加する
    // （夜の王は通常エネミーの「編隊に追加」フローを経由しないため）。
    // 夜の王は現在ensureNight3BossInBattle経由でselectedEnemyIdsへも実在するが、
    // 念のため二重追加を防ぐ（indexOf済みならconcatしない）。
    // 使用者確認：夜の王は第3天専用——第1/2天は夜の強敵（別データ、AutoGM構造化対象外）と
    // 戦っているため、dayNumber<3の間はnight3BossIdを混ぜてはいけない
    // （ensureNight3BossInBattleと同じ判定条件）。
    if (
      game &&
      game.night3BossId &&
      state.dayNumber >= 3 &&
      AutoGm.isStructured("boss|" + game.night3BossId) &&
      structuredIds.indexOf("boss|" + game.night3BossId) === -1
    ) {
      structuredIds = structuredIds.concat(["boss|" + game.night3BossId]);
    }
    if (!structuredIds.length) {
      row.hidden = true;
      if (formRow) formRow.hidden = true;
      return;
    }
    row.hidden = false;
    var select = document.getElementById("auto-gm-enemy-select");
    select.innerHTML = "";
    structuredIds.forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      if (key.indexOf("boss|") === 0) {
        var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(key.slice(5)) : null;
        opt.textContent = bossInfo ? window.PriTestEnemies.localizedText(bossInfo.name) : key;
      } else {
        var parts = key.split("|");
        var info = window.PriTestEnemies.get(parts[0], parts[1]);
        opt.textContent = info ? window.PriTestEnemies.localizedText(info.enemy.name) : key;
      }
      select.appendChild(opt);
    });
    // selectはinnerHTMLごと毎回作り直すが要素自体は使い回すため、onchange代入（addEventListener
    // ではなく）で毎回上書きし、多重登録を防ぐ。
    select.onchange = renderAutoGmBossFormToggle;
    renderAutoGmBossFormToggle();
  }

  // グラディウス等、多形態（AutoGm.isFormAware）の夜の王を選択中のみ「合体形態／分裂形態」
  // 手動切替ボタンを表示する。形態移行は本文上「エンドフェイズ開始時」という非同期タイミングの
  // ため自動シミュレートせず、GMがこのボタンで手動反映する運用（state.battle.bossForm）。
  function renderAutoGmBossFormToggle() {
    var formRow = document.getElementById("auto-gm-boss-form-row");
    var btn = document.getElementById("btn-auto-gm-boss-form-toggle");
    if (!formRow || !btn) return;
    var AutoGm = window.PriTestAutoGm;
    var select = document.getElementById("auto-gm-enemy-select");
    var key = select && select.value;
    if (!AutoGm || !key || !AutoGm.isFormAware(key)) {
      formRow.hidden = true;
      return;
    }
    formRow.hidden = false;
    var form = (state.battle && state.battle.bossForm) || "fused";
    btn.textContent = window.I18N.t(form === "split" ? "auto_gm_boss_form_split_label" : "auto_gm_boss_form_fused_label");
  }

  function handleAutoGmBossFormToggleClick() {
    state.battle.bossForm = state.battle.bossForm === "split" ? "fused" : "split";
    saveState();
    renderAutoGmBossFormToggle();
  }

  // ロール結果を表示し、算出できた分だけ該当PCの入力欄へ事前入力する（未算出の項目は0のまま
  // ＝従来通り手動入力が必要）。GMは確定前にいつでも数値を手修正できる。
  function handleAutoGmRollClick() {
    var AutoGm = window.PriTestAutoGm;
    var select = document.getElementById("auto-gm-enemy-select");
    var enemyKey = select && select.value;
    if (!AutoGm || !enemyKey) return;
    var result = AutoGm.rollEnemyAction(enemyKey, state.battle);
    if (!result) return;
    // 坩堝の騎士「坩堝の双璧」：戦闘開始時の雑兵有無判定は初回のみ確定・永続化し、以後の
    // ロールは同じ判定を使い続ける（auto_gm.js側は読み取り専用のため、このstate書き込みは
    // night.js側で行う）。
    if (result.mobPresentSnapshot !== null && !(enemyKey in state.battle.autoGmMobPresentSnapshot)) {
      state.battle.autoGmMobPresentSnapshot[enemyKey] = result.mobPresentSnapshot;
      saveState();
    }
    var noteText = result.originalRow ? window.PriTestEnemies.localizedText(result.originalRow.note) : "";
    var actionName = result.originalRow ? window.PriTestEnemies.localizedText(result.originalRow.name) : "";

    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    // 「亂戰傷害」の最終値＝規則書のレベル別基準値＋この行動固有の修正値＋Time Loss側の骰效果
    // （state.rollEffects.enemy_damage）＋state.battle.enemyDmgOverride（PC技能による減少・
    // 敵人特殊行動による増加、睡眠トリガー等で既に累積されている値）。個別ダメージも
    // Time Loss側の骰效果を同様に加算する（enemyDmgOverrideは「亂戰傷害」専用のため対象外）。
    var enemyOverride = (state.battle.enemyDmgOverride && state.battle.enemyDmgOverride[enemyKey]) || 0;
    var groupResult = AutoGm.computeGroupDamage(result, state.rollEffects, enemyOverride);
    // 「次のアクションフェイズ開始時、PC全員が骰目に関わらず後衛へ強制配置される」特殊能力
    // （死儀礼の鳥「飛び退き」、王族的幽鬼「転移」、古龍「滞空」等）：本文を確認したところ
    // 対象は常に「PC全員」（乱戦ダメージの対象者に限らない）のため、行内容に依らず戦闘全体の
    // 1回限りフラグとして立てるだけでよい。
    if (result.structuredRow.conditions && result.structuredRow.conditions.indexOf("force_back_row_next_phase") !== -1) {
      state.battle.forceBackRowNextPhase = true;
    }
    var breakdownParts = [];
    // structured.groupDamage/individualDamageのelementAccum/ailmentAccum（固定数値の屬性/状態異常
    // 附加值、docs/enemy_damage_rules.md §1「x:y」表記のうち骰子ではなく確定値のもの）を、対象PCの
    // pendingDefenseElementAccumへ集約する。実際にstate.battle.attributeStatus.receivedへ反映するのは
    // GMがこのPCの［確定］を押した時点（handleEnemyDamageConfirmForCharacter）。
    var pendingAccum = {};
    function queueAttributeAccum(idx, accumList) {
      if (!accumList || !accumList.length) return;
      var charId = entered[idx].id;
      if (!pendingAccum[charId]) pendingAccum[charId] = [];
      accumList.forEach(function (a) {
        if (!a || typeof a.label !== "string" || !a.amount) return;
        pendingAccum[charId].push({ label: a.label, amount: a.amount });
        breakdownParts.push(
          window.I18N.t("auto_gm_attribute_accum_breakdown", { name: entered[idx].name, label: a.label, amount: a.amount })
        );
      });
    }
    if (groupResult) {
      var groupBreakdown = window.I18N.t("auto_gm_group_breakdown", {
        total: groupResult.total,
        base: groupResult.base,
        modifier: groupResult.modifier,
        timeLoss: groupResult.timeLoss,
        override: groupResult.override,
      });
      if (groupResult.repeat > 1) {
        groupBreakdown += window.I18N.t("auto_gm_repeat_suffix", { perHit: groupResult.perHit, repeat: groupResult.repeat });
      }
      breakdownParts.push(groupBreakdown);
      if (result.structuredRow.groupDamage.sequence) {
        // 「乱戦ダメージがN回発生し、それぞれ異なる対象を持つ」パターン（gnoster「合体突進」：
        // 1回目は前衛全員、2回目は後衛全員、3回目は敵視1以上全員）。既存のgroupDamage.repeat
        // （同一対象へのN回）とは異なり対象が回ごとに変わるため、専用ロジックで処理する。
        // 各回は「その回の対象で1回分(perHit)を均等割り」、同一PCが複数回対象になれば合算する。
        var seqTotals = {};
        result.structuredRow.groupDamage.sequence.forEach(function (seq) {
          var seqTargets = AutoGm.resolveTargets(seq.targetRule, state.battle, entered.length);
          var seqShares = AutoGm.splitGroupShares(groupResult.perHit, seqTargets.length);
          seqTargets.forEach(function (idx, shareIdx) {
            seqTotals[idx] = (seqTotals[idx] || 0) + seqShares[shareIdx];
          });
        });
        Object.keys(seqTotals).forEach(function (idxKey) {
          var idx = parseInt(idxKey, 10);
          var input = document.getElementById("enemy-damage-group-" + entered[idx].id);
          if (input) input.value = String(Math.round(seqTotals[idx]));
          queueAttributeAccum(idx, result.structuredRow.groupDamage.elementAccum);
          queueAttributeAccum(idx, result.structuredRow.groupDamage.ailmentAccum);
        });
      } else if (result.structuredRow.targetRule) {
        var groupTargets = AutoGm.resolveTargets(result.structuredRow.targetRule, state.battle, entered.length);
        var shares;
        if (result.structuredRow.targetRule.weightRule) {
          // 「乱戦ダメージはPC全員対象、◯◯条件のPCはn人分の加重」パターン（edele「突進」等）。
          var weighted = AutoGm.resolveWeightedTargets(result.structuredRow.targetRule, state.battle, entered.length);
          shares = AutoGm.splitGroupSharesWeighted(groupResult.total, weighted);
        } else {
          // 「N人份」の加重配分（対象全員が同一重みのため均等割りと数学的に同値、
          // auto_gm.jsのsplitGroupShares参照）：対象が複数いる場合は傷害池を人数で分ける。
          shares = AutoGm.splitGroupShares(groupResult.total, groupTargets.length);
        }
        groupTargets.forEach(function (idx, shareIdx) {
          var input = document.getElementById("enemy-damage-group-" + entered[idx].id);
          if (input) input.value = String(Math.round(shares[shareIdx]));
          queueAttributeAccum(idx, result.structuredRow.groupDamage.elementAccum);
          queueAttributeAccum(idx, result.structuredRow.groupDamage.ailmentAccum);
        });
        if (groupTargets.length > 1) {
          breakdownParts.push(window.I18N.t("auto_gm_split_note", { count: groupTargets.length, each: Math.round(shares[0]) }));
        }
      }
    }
    (result.structuredRow.individualDamage || []).forEach(function (entry) {
      if (entry.distribution === "rotate") {
        // ユーザー確認済みルール：対象PCが「1体（不特定）」でN回実行の場合、条件を満たす対象の
        // 中で輪流受傷し、最初の対象はランダム（同一対象が固定でrepeat回受けるのではない）。
        var perHitResult = AutoGm.computeIndividualDamage({ amount: entry.amount }, state.rollEffects);
        var rotated = AutoGm.resolveRotatedHits(entry.targetRule, state.battle, entered.length, entry.repeat || 1);
        var rotateNames = rotated.map(function (r) {
          var total = perHitResult.perHit * r.hits;
          var input = document.getElementById("enemy-damage-individual-" + entered[r.index].id);
          if (input) input.value = String(total);
          return entered[r.index].name + window.I18N.t("colon_separator") + total;
        });
        breakdownParts.push(
          window.I18N.t("auto_gm_rotate_breakdown", { perHit: perHitResult.perHit, list: rotateNames.join("、") })
        );
        return;
      }
      var indivResult = AutoGm.computeIndividualDamage(entry, state.rollEffects);
      var indivBreakdown = window.I18N.t("auto_gm_individual_breakdown", {
        total: indivResult.total,
        base: indivResult.base,
        timeLoss: indivResult.timeLoss,
      });
      if (indivResult.repeat > 1) {
        indivBreakdown += window.I18N.t("auto_gm_repeat_suffix", { perHit: indivResult.perHit, repeat: indivResult.repeat });
      }
      breakdownParts.push(indivBreakdown);
      var indivTargets = AutoGm.resolveTargets(entry.targetRule, state.battle, entered.length);
      indivTargets.forEach(function (idx) {
        var input = document.getElementById("enemy-damage-individual-" + entered[idx].id);
        if (input) input.value = String(indivResult.total);
        queueAttributeAccum(idx, entry.elementAccum);
        queueAttributeAccum(idx, entry.ailmentAccum);
      });
    });
    if (result.structuredRow.savingThrow) {
      // 「アローレイン」等：規則書の運試し／フィジカル／メンタル判定をシステムが直接振り、
      // 加護による重骰は行わず（ユーザー確認済み）、出目を公開して順に効果を適用する。
      var st = result.structuredRow.savingThrow;
      var throwResults = AutoGm.resolveSavingThrow(st, entered, state.battle, window.PriTestCharacterTypes, CharacterDrawer);
      var failLines = [];
      throwResults.forEach(function (r) {
        var statLabel = window.I18N.t("check_stat_" + st.stat);
        failLines.push(
          window.I18N.t("auto_gm_saving_throw_line", {
            name: r.name,
            dice: r.dice.join("、"),
            sum: r.sum,
            target: r.target,
            stat: statLabel,
            result: window.I18N.t(r.passed ? "auto_gm_saving_throw_pass" : "auto_gm_saving_throw_fail"),
          })
        );
        if (!r.passed) {
          var failResult = AutoGm.computeIndividualDamage(st.onFail, state.rollEffects);
          var input = document.getElementById("enemy-damage-individual-" + entered[r.index].id);
          if (input) input.value = String(failResult.total);
          queueAttributeAccum(r.index, st.onFail.elementAccum);
          queueAttributeAccum(r.index, st.onFail.ailmentAccum);
        }
      });
      breakdownParts.push(failLines.join("　"));
    }
    state.battle.pendingDefenseElementAccum = pendingAccum;

    var resultEl = document.getElementById("auto-gm-roll-result");
    resultEl.hidden = false;
    resultEl.textContent = window.I18N.t("auto_gm_roll_result", {
      enemy: result.enemyName,
      roll: result.rollValue,
      action: actionName,
      note: noteText,
    });
    if (breakdownParts.length) {
      var breakdownEl = document.createElement("p");
      breakdownEl.textContent = breakdownParts.join("　");
      resultEl.appendChild(breakdownEl);
    }

    // PC人數補正（battle_pc_count_1/2）：敵人亂戰傷害與個別傷害「÷4」（PC1人）／「÷2」
    // （PC2人）。既に上の各処理でentered各人の亂戰/個別傷害入力欄へ書き込み済みの値を、
    // ここで一括して除算し直す（内部の複数の書き込み経路——均等割り／rotate／通常個別——を
    // 個別に触らず、最後に1箇所でまとめて調整することで漏れを防ぐ）。
    var pcDivisor = pcCountEnemyDamageDivisor();
    if (pcDivisor > 1) {
      entered.forEach(function (c) {
        var groupInputEl = document.getElementById("enemy-damage-group-" + c.id);
        var individualInputEl = document.getElementById("enemy-damage-individual-" + c.id);
        if (groupInputEl) groupInputEl.value = String(Math.floor((parseInt(groupInputEl.value, 10) || 0) / pcDivisor));
        if (individualInputEl) {
          individualInputEl.value = String(Math.floor((parseInt(individualInputEl.value, 10) || 0) / pcDivisor));
        }
      });
    }

    addAutoGmLog(
      window.I18N.t("log_auto_gm_roll", { enemy: result.enemyName, roll: result.rollValue, action: actionName }) +
        (breakdownParts.length ? "　" + breakdownParts.join("　") : "")
    );
  }

  // 使用者確認：この結算視窗はAutoGM擲骰専用ではない（防禦フェイズは既にautoTriggerDefenseRoll
  // が擲骰済みで進度版へ結果を出しているため、モーダルはその数値を確認・微調整する場だけに
  // 使う）。各PC行に既存の亂戰/個別傷害欄に加え、新規のHP價值欄（c.hpValueを初期値、GM調整可）
  // とその場で計算されるHP損害＝floor((亂戰+個別)/HP價值)を表示し、[確定]は行ごとに押す
  // （全員分を1つのボタンでまとめて確定しない）。
  function renderEnemyDamageModal() {
    document.getElementById("enemy-damage-group-tag").placeholder = window.I18N.t("enemy_damage_group_tag_placeholder");
    renderAutoGmRollRow();
    var list = document.getElementById("enemy-damage-pc-list");
    list.innerHTML = "";
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    // 自動化GM 戰鬥自動化：全員擲骰完了時にautoTriggerDefenseRollが既に自動擲骰済みなら、
    // その結果（state.battle.pendingDefenseRoll）を初期値として復元する（再擲骰しない）。
    var pending = state.battle.pendingDefenseRoll;
    if (!state.battle.enemyDamageConfirmed) state.battle.enemyDamageConfirmed = {};
    entered.forEach(function (c) {
      var confirmedAlready = !!state.battle.enemyDamageConfirmed[c.id];
      var row = document.createElement("div");
      row.className = "wb-row enemy-damage-pc-row" + (confirmedAlready ? " confirmed" : "");
      var label = document.createElement("label");
      label.textContent = c.name;
      row.appendChild(label);

      var groupInput = document.createElement("input");
      groupInput.type = "number";
      groupInput.className = "stat-input";
      groupInput.min = "0";
      groupInput.value = pending && pending.group && typeof pending.group[c.id] === "number" ? String(pending.group[c.id]) : "0";
      groupInput.id = "enemy-damage-group-" + c.id;
      groupInput.disabled = confirmedAlready;
      row.appendChild(groupInput);

      var individualInput = document.createElement("input");
      individualInput.type = "number";
      individualInput.className = "stat-input";
      individualInput.min = "0";
      individualInput.value =
        pending && pending.individual && typeof pending.individual[c.id] === "number" ? String(pending.individual[c.id]) : "0";
      individualInput.id = "enemy-damage-individual-" + c.id;
      individualInput.disabled = confirmedAlready;
      row.appendChild(individualInput);

      var hpValueInput = document.createElement("input");
      hpValueInput.type = "number";
      hpValueInput.className = "stat-input";
      hpValueInput.min = "1";
      // 使用者確認：初期値は「今回の防禦階段で実際に迴避／格擋を確定した値」（c._defenseHpValueThisTurn）
      // を優先する。まだ防禦を確定していない（迴避／格擋未実行）場合のみ、従来通り角色詳細の
      // 固定HP價值（c.hpValue）／既定値30へフォールバックする。GMは確定前にいつでも手修正できる。
      hpValueInput.value = String(typeof c._defenseHpValueThisTurn === "number" ? c._defenseHpValueThisTurn : c.hpValue || 30);
      hpValueInput.id = "enemy-damage-hpvalue-" + c.id;
      hpValueInput.disabled = confirmedAlready;
      row.appendChild(hpValueInput);

      var hpLossSpan = document.createElement("span");
      hpLossSpan.className = "enemy-damage-hp-loss-value";
      hpLossSpan.id = "enemy-damage-hploss-" + c.id;
      row.appendChild(hpLossSpan);

      function recomputeHpLoss() {
        var g = parseInt(groupInput.value, 10) || 0;
        var iv = parseInt(individualInput.value, 10) || 0;
        var hv = Math.max(1, parseInt(hpValueInput.value, 10) || 1);
        hpLossSpan.textContent = String(Math.floor((g + iv) / hv));
      }
      groupInput.addEventListener("input", recomputeHpLoss);
      individualInput.addEventListener("input", recomputeHpLoss);
      hpValueInput.addEventListener("input", recomputeHpLoss);
      recomputeHpLoss();

      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "primary-btn enemy-damage-confirm-btn";
      confirmBtn.textContent = window.I18N.t("enemy_damage_confirm_button");
      confirmBtn.disabled = confirmedAlready;
      confirmBtn.addEventListener("click", function () {
        handleEnemyDamageConfirmForCharacter(c.id);
      });
      row.appendChild(confirmBtn);

      list.appendChild(row);
    });
  }

  // 自動化GM 戰鬥自動化：全員が防禦體力骰を振り終えた瞬間に1回だけ呼ばれる。既存の
  // AutoGM敵方行動ロール鏈（rollEnemyAction→computeGroupDamage/computeIndividualDamage、
  // handleAutoGmRollClickが内部で行う）をモーダルを開かずに裏側で実行し、結果を
  // state.battle.pendingDefenseRoll（モーダルを開いた時に復元する数値）と
  // state.battle.defenseRollPreviewText（進度版に出す速報文字）へ保存する。
  // state.autoGmEnabledがfalse、または構造化済みの敵人が無い場合は何もしない
  // （従来通りGMがモーダル内で手動入力／手動でAutoGM擲騎を押す運用にフォールバックする）。
  // 戻り値：末尾のsaveState()まで到達した（＝実際に処理してstateを保存した）場合はtrue、
  // 何もせず早期returnした場合はfalse/undefined。呼び出し元（rollDiceForCharacterActionPhase）
  // が、この関数がstateを保存したかどうかで自身のsaveState()呼び出しを重複させないための契約。
  function autoTriggerDefenseRoll() {
    var AutoGm = window.PriTestAutoGm;
    if (!state.autoGmEnabled || !AutoGm) return false;
    var structuredIds = ((state.battle && state.battle.selectedEnemyIds) || []).filter(function (key) {
      return AutoGm.isStructured(key);
    });
    // 夜の王は現在ensureNight3BossInBattle経由でselectedEnemyIdsへも実在するが、
    // 念のため二重追加を防ぐ（indexOf済みならconcatしない）。使用者確認：夜の王は
    // 第3天専用（ensureNight3BossInBattleと同じdayNumber>=3判定）。
    if (
      game &&
      game.night3BossId &&
      state.dayNumber >= 3 &&
      AutoGm.isStructured("boss|" + game.night3BossId) &&
      structuredIds.indexOf("boss|" + game.night3BossId) === -1
    ) {
      structuredIds = structuredIds.concat(["boss|" + game.night3BossId]);
    }
    if (!structuredIds.length) return false;
    renderEnemyDamageModal();
    var select = document.getElementById("auto-gm-enemy-select");
    if (select && structuredIds.indexOf(select.value) === -1) select.value = structuredIds[0];
    handleAutoGmRollClick();
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    var group = {};
    var individual = {};
    var previewParts = [];
    entered.forEach(function (c) {
      var groupInputEl = document.getElementById("enemy-damage-group-" + c.id);
      var individualInputEl = document.getElementById("enemy-damage-individual-" + c.id);
      var gv = groupInputEl ? parseInt(groupInputEl.value, 10) || 0 : 0;
      var iv = individualInputEl ? parseInt(individualInputEl.value, 10) || 0 : 0;
      group[c.id] = gv;
      individual[c.id] = iv;
      previewParts.push(
        c.name +
          window.I18N.t("colon_separator") +
          window.I18N.t("enemy_damage_group_short_label") +
          gv +
          "／" +
          window.I18N.t("enemy_damage_individual_short_label") +
          iv
      );
    });
    var resultEl = document.getElementById("auto-gm-roll-result");
    var breakdownText = resultEl ? resultEl.textContent : "";
    state.battle.pendingDefenseRoll = { enemyKey: select ? select.value : null, group: group, individual: individual };
    state.battle.defenseRollPreviewText = [breakdownText, previewParts.join("\n")].filter(Boolean).join("\n");
    saveState();
    return true;
  }

  // 使用者確認：[確定]は角色ごとに個別で押す（玩家数の回数）。押した瞬間そのPCのHP損害
  // （floor((亂戰+個別)/HP價值)）を確定してc.hp.currentへ反映し、行を無効化する。
  // entered全員が確定し終えたら、進度版へ結算結果を表示してresolving（[結束回合]待ち）へ進む。
  function handleEnemyDamageConfirmForCharacter(charId) {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === charId;
    })[0];
    if (!c || (state.battle.enemyDamageConfirmed && state.battle.enemyDamageConfirmed[charId])) return;
    var groupTag = document.getElementById("enemy-damage-group-tag").value.trim();
    var groupInputEl = document.getElementById("enemy-damage-group-" + charId);
    var individualInputEl = document.getElementById("enemy-damage-individual-" + charId);
    var hpValueInputEl = document.getElementById("enemy-damage-hpvalue-" + charId);
    var groupValue = groupInputEl ? parseInt(groupInputEl.value, 10) || 0 : 0;
    var individual = individualInputEl ? parseInt(individualInputEl.value, 10) || 0 : 0;
    var hpValue = hpValueInputEl ? Math.max(1, parseInt(hpValueInputEl.value, 10) || 1) : Math.max(1, c.hpValue || 30);
    var hpLoss = Math.floor((groupValue + individual) / hpValue);

    var line =
      window.I18N.t("enemy_damage_log_prefix") +
      window.I18N.t("colon_separator") +
      groupValue +
      (groupTag ? " | " + groupTag : "") +
      ", " +
      window.I18N.t("enemy_damage_individual_label") +
      window.I18N.t("colon_separator") +
      individual +
      "｜" +
      window.I18N.t("enemy_damage_col_hp_loss") +
      window.I18N.t("colon_separator") +
      hpLoss;
    addEnemyDamageBox(c, line);
    c.hp.current = Math.max(0, c.hp.current - hpLoss);
    checkNearDeathTrigger(c);
    saveRosterCharacters();

    // AutoGM敵方行動の固定屬性/狀態異常附加值（elementAccum/ailmentAccum、handleAutoGmRollClickが
    // 事前算出）を、このPCの［確定］操作と同時に實際套用する（HP損害と同様、擲骰時ではなく
    // 確定時に效果が発生する設計）。
    var pendingAccumForChar = (state.battle.pendingDefenseElementAccum && state.battle.pendingDefenseElementAccum[charId]) || [];
    pendingAccumForChar.forEach(function (a) {
      addReceivedAttributeStatus(charId, a.label, a.amount);
    });
    if (state.battle.pendingDefenseElementAccum) delete state.battle.pendingDefenseElementAccum[charId];

    if (!state.battle.enemyDamageConfirmed) state.battle.enemyDamageConfirmed = {};
    state.battle.enemyDamageConfirmed[charId] = true;
    if (!state.battle.defenseHpLossSummary) state.battle.defenseHpLossSummary = {};
    state.battle.defenseHpLossSummary[charId] = hpLoss;
    saveState();

    renderEnemyDamageModal();
    renderCharacterRoster();

    var entered = rosterCharacters.filter(function (rc) {
      return rc.entered;
    });
    var allConfirmed = entered.length > 0 && entered.every(function (rc) {
      return !!state.battle.enemyDamageConfirmed[rc.id];
    });
    if (allConfirmed) finishEnemyDamageRound(entered);
  }

  // entered全員のHP損害確定が完了した時点で、進度版へ「各玩家本回合受到的傷害」を表示し、
  // combat/extraフェイズのhandleBattleTurnConfirmClickと同じように[結束回合]待ち
  // （roundStage="resolving"）へ進める。
  function finishEnemyDamageRound(entered) {
    var parts = entered.map(function (c) {
      return c.name + window.I18N.t("colon_separator") + (state.battle.defenseHpLossSummary[c.id] || 0);
    });
    var summaryText = window.I18N.t("gm_flow_battle_defense_result_header") + "\n" + parts.join("\n");
    addAutoGmLog(summaryText);
    postSystemTurnMessage(window.I18N.t("gm_flow_battle_defense_result_header") + "　" + parts.join("、"));
    showThreatBroadcast([window.I18N.t("gm_flow_battle_defense_result_header"), parts.join("、")]);
    closeEnemyDamageModal();
    if (state.actionPhase === "defense") {
      state.battle.roundResultText = summaryText;
      state.battle.roundStage = "resolving";
      state.battle.enemyDamageConfirmed = {};
      state.battle.defenseHpLossSummary = {};
      saveState();
      renderCurrentLocationStatus();
    }
  }

  // GM／玩家が同時にプレイしなくてもよいよう、「今は誰の番か」を示すバー。権限分離は行わず
  // （ユーザー方針：全員同じ権限）、あくまで受け渡しの目印として使う。
  // 主選單から行動留言板機能全体（受け渡しバー・獎勵勾選清單）を開閉するトグル。
  // TTSトグル（ttsEnabled、localStorage直書き）と異なり、複数人で同じゲームを見る前提のため
  // state（クラウド同期対象）に持たせる。
  function renderTurnBoardToggleButton() {
    var btn = document.getElementById("btn-turn-board-toggle");
    if (!btn) return;
    btn.textContent = window.I18N.t(state.turnBoardEnabled ? "turn_board_toggle_on_label" : "turn_board_toggle_off_label");
  }

  function setTurnBoardEnabled(enabled) {
    state.turnBoardEnabled = enabled;
    saveState();
    renderTurnBoardToggleButton();
    renderTurnHolderBar();
  }

  // 自動化GM機能全体のON/OFF。以前は規則書パスワード認証済みの人のみ切り替え可能だったが、
  // ユーザー指定によりこの制限を撤廃——誰でも自由に切り替えられる（turnHolderによる制限も
  // 元々無い、設定トグルという位置づけのため）。
  // ユーザー指定（2026-08-12）：名前は違っても本質的には1つの「自動化GM」という大系統
  // なので、進行フロー（gmFlowEnabled：進度版の敘述・回合banner）と敵行動擲骰
  // （autoGmEnabled：戦闘中の敵人行動決定）を別々のボタンで個別にON/OFFさせず、常に
  // 連動する単一のトグルへ統合する（第三天の夜の王戦闘で「進度版は動くのに敵の行動だけ
  // 出ない」という混乱の直接原因だった）。内部のstateフィールド自体は既存の多数の参照箇所
  // を壊さないよう分けたまま残し、このトグル関数側で両方を同時に更新する。
  function renderAutoGmToggleButton() {
    var btn = document.getElementById("btn-auto-gm-toggle");
    if (!btn) return;
    btn.textContent = window.I18N.t(state.autoGmEnabled ? "auto_gm_toggle_on_label" : "auto_gm_toggle_off_label");
  }

  function setAutoGmEnabled(enabled) {
    state.autoGmEnabled = enabled;
    state.gmFlowEnabled = enabled;
    if (!enabled) {
      state.gmFlow.narrationText = null;
      state.gmFlow.awaitingOk = false;
    }
    saveState();
    renderAutoGmToggleButton();
    renderCurrentLocationStatus();
    addAutoGmLog(window.I18N.t(enabled ? "log_auto_gm_enabled" : "log_auto_gm_disabled"));
  }

  function handleAutoGmToggleClick() {
    setAutoGmEnabled(!state.autoGmEnabled);
  }

  // 縮小されたまま放置されている獎勵視窗を追跡する（第5項：獎勵収集完成ゲート）。
  // idは種類ごとに1つだけ存在するモーダルを指す固定文字列（"turnReward"|"floorReward"）。
  // 縮小した瞬間に追加し、モーダルを完全に閉じた瞬間に削除する（復元しただけでは消さない）。
  function addPendingRewardWindow(id) {
    if (state.gmFlow.pendingRewardWindows.indexOf(id) === -1) {
      state.gmFlow.pendingRewardWindows.push(id);
      saveState();
      renderCurrentLocationStatus();
    }
  }

  function removePendingRewardWindow(id) {
    var idx = state.gmFlow.pendingRewardWindows.indexOf(id);
    if (idx !== -1) {
      state.gmFlow.pendingRewardWindows.splice(idx, 1);
      saveState();
      renderCurrentLocationStatus();
    }
  }

  // character_drawer.js（別クロージャ）が抽選の進行中状態をstate.activeDrawsへ書き戻すための
  // ブリッジ。window.PriTestNightLogと同じ「存在確認つきグローバルフック」方式。
  window.PriTestDrawStateSync = {
    get: function (kind) {
      return state.activeDraws[kind] || null;
    },
    set: function (kind, obj) {
      state.activeDraws[kind] = obj || null;
      saveState();
    },
  };

  window.PriTestTurnHolder = function () {
    return state.turnHolder;
  };

  // 「PC「聖杯瓶使用次數」減少」の現在の段階（0=無し、1=-1、2=-2）。キャラクター詳細ドロワー側
  // (character_drawer.js、別クロージャ)が聖杯瓶欄の近くに現在の減少幅を表示するために参照する。
  window.PriTestFlaskUsesPenalty = function () {
    return (state.rollEffects && state.rollEffects.flask_uses) || 0;
  };

  // 4状態を順送りに循環させる（Gm回合→Gm結束→玩家回合→玩家結束→Gm回合…）。
  // 「結束」状態は中立（GM限定操作は誰も調整できない）で、対応するステータス/ボタン文言を
  // 個別に持つ。GM限定のゲート判定は全てstate.turnHolder==="gm"の完全一致で行う
  // （"gmEnding"は既にGM権限を失った中立状態として扱う）。
  var TURN_HOLDER_CYCLE = ["gm", "gmEnding", "players", "playersEnding"];
  var TURN_HOLDER_STATUS_KEYS = {
    gm: "turn_holder_gm_status",
    gmEnding: "turn_holder_gm_ending_status",
    players: "turn_holder_players_status",
    playersEnding: "turn_holder_players_ending_status",
  };
  var TURN_HOLDER_BUTTON_KEYS = {
    gm: "turn_holder_end_gm_button",
    gmEnding: "turn_holder_start_players_button",
    players: "turn_holder_end_players_button",
    playersEnding: "turn_holder_start_gm_button",
  };

  function nextTurnHolder(current) {
    var idx = TURN_HOLDER_CYCLE.indexOf(current);
    return TURN_HOLDER_CYCLE[(idx === -1 ? 0 : idx + 1) % TURN_HOLDER_CYCLE.length];
  }

  // "gm"/"gmEnding"はGM側、"players"/"playersEnding"は玩家側として1つのチームに正規化する。
  // 留言のside記録・クリア判定を「厳密にどの4状態で書いたか」ではなく「どちら側の留言か」で
  // 揃えるために使う（例："Gm結束"中に書いた留言も、次にGm回合が始まれば消えるべきGM側の留言）。
  function turnHolderTeam(value) {
    return value === "players" || value === "playersEnding" ? "players" : "gm";
  }

  // 獎勵勾選清單／潛在之力／抽選武器・消耗品・飾品の「新規に開く」メインメニュー項目は
  // state.turnHolder==="gm"の間だけ表示する。既に開いて縮小済みのウィンドウ自体は
  // state.activeDrawsの非null判定で別途表示されるため、ここで隠れるのはあくまで
  // 「新規オープン」の入口ボタンのみ。
  function renderTurnGatedMenuItems() {
    var isGmTurn = state.turnHolder === "gm";
    [
      "btn-turn-reward-open",
      "btn-potential-power-info",
      "btn-main-menu-draw-weapon",
      "btn-main-menu-draw-talisman",
      "btn-main-menu-draw-consumable",
      "btn-event-chip-trigger",
    ].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.hidden = !isGmTurn;
    });
  }

  // GM／玩家が同時にプレイしなくてもよいよう、「今は誰の番か」を示すバー。権限分離は行わず
  // （ユーザー方針：全員同じ権限）、あくまで受け渡しの目印・卓上進行に沿った複数行メッセージ板
  // として使う。主選單の「turnBoardEnabled」トグルで機能全体を非表示にできる。
  function renderTurnHolderBar() {
    renderTurnGatedMenuItems();
    var bar = document.getElementById("turn-holder-bar");
    if (!bar) return;
    if (!state.turnBoardEnabled) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    var statusEl = document.getElementById("turn-holder-status");
    var toggleBtn = document.getElementById("btn-turn-holder-toggle");
    var messageInput = document.getElementById("turn-message-input");
    var messageList = document.getElementById("turn-message-list");
    if (!statusEl || !toggleBtn) return;
    statusEl.textContent = window.I18N.t(TURN_HOLDER_STATUS_KEYS[state.turnHolder] || TURN_HOLDER_STATUS_KEYS.gm);
    toggleBtn.textContent = window.I18N.t(TURN_HOLDER_BUTTON_KEYS[state.turnHolder] || TURN_HOLDER_BUTTON_KEYS.gm);
    if (messageInput) messageInput.placeholder = window.I18N.t("turn_message_placeholder");
    if (messageList) {
      messageList.innerHTML = "";
      state.turnMessages.forEach(function (msg) {
        messageList.appendChild(renderTurnMessageLine(msg));
      });
    }
  }

  // state.turnMessagesから指定side分をクリアする際、消さずにstate.turnMessageHistoryへ
  // 移して残す（「歷史」ボタンから後で見返せるようにするため）。直近300件までに切り詰める。
  function archiveTurnMessages(sideToClear) {
    var kept = [];
    state.turnMessages.forEach(function (m) {
      if (m.side === sideToClear) {
        state.turnMessageHistory.push(m);
      } else {
        kept.push(m);
      }
    });
    state.turnMessages = kept;
    if (state.turnMessageHistory.length > 300) {
      state.turnMessageHistory = state.turnMessageHistory.slice(state.turnMessageHistory.length - 300);
    }
  }

  // 4状態を1段ずつ進める。押すと確認ダイアログが出て、確定した場合のみ進める。
  // 留言のクリアは「能動的な番（gm/players）が実際に始まる」遷移でのみ、その側自身の
  // 留言だけを消す（「結束」という中立状態への遷移では留言はそのまま残す）。
  function handleTurnHolderToggle() {
    if (!window.confirm(window.I18N.t("turn_board_end_turn_confirm"))) return;
    var newTurnHolder = nextTurnHolder(state.turnHolder);
    state.turnHolder = newTurnHolder;
    if (newTurnHolder === "gm" || newTurnHolder === "players") {
      archiveTurnMessages(newTurnHolder);
    }
    saveState();
    addLog("log_turn_holder_handoff", { to: window.I18N.t(TURN_HOLDER_STATUS_KEYS[newTurnHolder]) });
    renderTurnHolderBar();
    renderSelectedEnemies();
    if (!document.getElementById("potential-power-modal").hidden) window.PriTestNightPotentialPower.renderPotentialPowerModal();
    if (!document.getElementById("item-draw-modal").hidden) CharacterDrawer.refreshActiveRollField();
    if (!document.getElementById("turn-reward-modal").hidden) renderTurnRewardModal();
    if (!document.getElementById("breakthrough-modal").hidden) window.PriTestNightFloorBreakthrough.renderBreakthroughCharacters();
    if (!document.getElementById("floor-reward-modal").hidden && window.PriTestNightFloorBreakthrough.getFloorRewardModalFloor()) {
      window.PriTestNightFloorBreakthrough.renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), window.PriTestNightFloorBreakthrough.getFloorRewardModalFloor());
    }
  }

  function renderTurnMessageLine(msg) {
    var line = document.createElement("p");
    line.className = "threat-ref-body";
    if (msg.side === "gm") line.classList.add("turn-message-gm");
    var time = new Date(msg.time).toLocaleTimeString();
    var prefix = msg.side === "gm" ? "GM: " : "";
    line.textContent = "[" + time + "] " + prefix + msg.text;
    return line;
  }

  function renderTurnMessageHistoryModal() {
    var list = document.getElementById("turn-message-history-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.turnMessageHistory.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("turn_message_history_empty");
      list.appendChild(empty);
      return;
    }
    state.turnMessageHistory.forEach(function (msg) {
      list.appendChild(renderTurnMessageLine(msg));
    });
  }

  function openTurnMessageHistoryModal() {
    renderTurnMessageHistoryModal();
    document.getElementById("turn-message-history-modal").hidden = false;
  }

  function closeTurnMessageHistoryModal() {
    document.getElementById("turn-message-history-modal").hidden = true;
  }

  // 送出ボタン：入力中のメッセージを現在のメッセージ板（state.turnMessages）へ1行追加する。
  // ログへの二重記録はしない（メッセージ板自体が記録の場のため）。
  function handleTurnMessageSend() {
    var input = document.getElementById("turn-message-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    // #11：留言板に「/」で始まる文字列を送ると、通常の留言としては投稿せず快速指令として処理する。
    if (text.charAt(0) === "/") {
      input.value = "";
      handleChatCommand(text);
      return;
    }
    state.turnMessages.push({ text: text, time: Date.now(), side: turnHolderTeam(state.turnHolder) });
    input.value = "";
    saveState();
    renderTurnHolderBar();
  }

  // 留言板の快速指令（#11）。一覧は規則書タブ「指令」（window.PriTestNightRulebook.renderCommandsRulebook）にも掲載する。
  function handleChatCommand(text) {
    var parts = text.trim().split(/\s+/);
    var cmd = parts[0].toLowerCase();
    if (cmd === "/cleardice") {
      handleResetAllDice();
      return;
    }
    if (cmd === "/rune") {
      var value = parseInt(parts[1], 10);
      if (!value || value <= 0) {
        postSystemTurnMessage(window.I18N.t("chat_command_invalid_rune"));
        return;
      }
      var count = window.PriTestNightFloorBreakthrough.grantRuneToAllEntered(value);
      postSystemTurnMessage(window.I18N.t("chat_command_rune_granted", { value: value, count: count }));
      return;
    }
    if (cmd === "/clearenemy") {
      (state.battle.selectedEnemyIds || []).slice().forEach(function (key) {
        purgeAttributeStatusForEnemyKey(key);
      });
      state.battle.selectedEnemyIds = [];
      state.battle.autoGmMobPresentSnapshot = {};
      state.battle.guardBroken = false;
      state.battle.guardCount = {};
      resetBattlePositionsAndAggro();
      renderSelectedEnemies();
      addLog("log_chat_command_clear_enemy");
      return;
    }
    // 使用者指定：Firebase同步のrace condition等で場上が「目前所在位置」（黃框、
    // state.focusedIndex）を見失って卡住した場合に、GMが手動で復帰先のカード番号を
    // 指定して直接そこへ移動させる緊急コマンド。通常の移動（finalizeSlotMove/
    // attemptMoveToPosition）と違い、隣接判定や隣接板塊の自動オープンは行わない
    // （あくまで「位置を復元するだけ」の状態修正であり、正規の移動アクションではないため）。
    if (cmd === "/movetocard") {
      var cardNumber = parseInt(parts[1], 10);
      if (!cardNumber || cardNumber < 1 || cardNumber > SLOT_COUNT) {
        postSystemTurnMessage(window.I18N.t("chat_command_invalid_movetocard", { max: SLOT_COUNT }));
        return;
      }
      state.focusedIndex = cardNumber - 1;
      renderBoard();
      renderCurrentLocationStatus();
      addLog("log_chat_command_move_to_card", { slot: cardNumber });
      postSystemTurnMessage(window.I18N.t("chat_command_move_to_card_done", { slot: cardNumber }));
      return;
    }
    postSystemTurnMessage(window.I18N.t("chat_command_unknown", { command: parts[0] }));
  }

  // 獨立獎勵勾選清單：地板獎勵システムとは無関係に、GMが「種類・對象角色・數量」を指定して
  // 項目を追加できる一覧（state.turnRewards、各項目は{id,kind,targetCharacterId,value,claimed}）。
  // ターン交代では消えず、GMが手動で削除するまで保持される。樓層獲得と同じ「モーダルを隠す＋
  // 別のスタッキング型固定ボタンを表示」パターンで縮小/復元できる。各項目は実際に地板獎勵と
  // 同じ抽選/加算処理を起動できる「獲得」ボタンを持ち、獲得済みかどうか(claimed)を保持する。
  var TURN_REWARD_KINDS = ["weapon", "consumable", "talisman", "potentialPower", "weaponSkillReroll", "stoneswordKey", "smithingStone", "chaliceBonus", "rune", "buriedTreasure"];
  // stoneswordKey/smithingStoneは純粋な共有カウンター（角色の概念自体が無い）なので對象selectを
  // 常時非表示にする。chaliceBonus/runeは「全體」（従来通り全員へ一律付与）と「任意」（領取時に
  // 1名選ぶ）を選べるようにしたため、ここには含めない（對象selectを表示する側）。
  var TURN_REWARD_SHARED_KINDS = ["stoneswordKey", "smithingStone"];
  // 「全體」（一律全員へ付与）の選択肢を出す種類。角色ごとの領取という概念に馴染む
  // weapon/consumable/talisman/potentialPowerには出さない。
  var TURN_REWARD_ALL_TARGET_KINDS = ["chaliceBonus", "rune"];
  var TURN_REWARD_ANY_TARGET_VALUE = "__any__"; // 領取時に1名選ぶ
  var TURN_REWARD_SHARED_TARGET_VALUE = "__shared__"; // 全員へ一律付与

  function isTurnRewardSharedKind(kind) {
    return TURN_REWARD_SHARED_KINDS.indexOf(kind) !== -1;
  }

  function openTurnRewardModal() {
    var modal = document.getElementById("turn-reward-modal");
    if (!modal) return;
    modal.hidden = false;
    document.getElementById("btn-turn-reward-restore").hidden = true;
    renderTurnRewardModal();
  }

  // 未獲得（claimed=false）の項目が残っている場合は、閉じると残りの機会を完全に放棄する旨を
  // 確認してから、未獲得項目だけを削除して閉じる（獲得済みの項目は記録として残す）。
  function closeTurnRewardModal() {
    var modal = document.getElementById("turn-reward-modal");
    if (!modal) return;
    var hasUnclaimed = state.turnRewards.some(function (r) {
      return !r.claimed;
    });
    if (hasUnclaimed) {
      if (!window.confirm(window.I18N.t("turn_reward_close_confirm"))) return;
      // フロアの戦利品から自動pushされた項目（sourceFloorRewardKey付き）は、push済みフラグ
      // （state.floorRewardObtained）を立てて二重pushを防いでいるため、放棄でそのまま消すと
      // 二度と積み直せない＝GMの手入力以外に復旧手段が無くなる。放棄時はフラグも一緒に消し、
      // 同じフロアの獲得口をもう一度開けば再pushできる状態へ戻す。
      // ただし1つのpush済みフラグが複数項目（例：潛在之力＝入場PC人数分）に対応する場合、
      // 一部だけ獲得済みの状態でフラグを消すと、再pushで獲得済みの分まで復活してしまう。
      // 獲得済み項目が1つでも残っているキーはそのままにする。
      var claimedKeys = {};
      state.turnRewards.forEach(function (r) {
        if (r.claimed && r.sourceFloorRewardKey) claimedKeys[r.sourceFloorRewardKey] = true;
      });
      state.turnRewards.forEach(function (r) {
        if (r.claimed || !r.sourceFloorRewardKey || claimedKeys[r.sourceFloorRewardKey]) return;
        if (state.floorRewardObtained) delete state.floorRewardObtained[r.sourceFloorRewardKey];
      });
      state.turnRewards = state.turnRewards.filter(function (r) {
        return r.claimed;
      });
      saveState();
    }
    modal.hidden = true;
    document.getElementById("btn-turn-reward-restore").hidden = true;
    // 跨端末自動ポップアップ（Task 8）の予約フラグも、実際に閉じられた時点でクリアする
    // （removePendingRewardWindowが内部でsaveState()する——別途saveState呼び出しは不要）。
    state.activeDraws.turnRewardAutoOpen = null;
    removePendingRewardWindow("turnReward");
  }

  // 縮小/復元は樓層獲得と同じ「モーダルを隠す＋別のスタッキング型固定ボタンを表示」方式。
  function minimizeTurnRewardModal() {
    document.getElementById("turn-reward-modal").hidden = true;
    document.getElementById("btn-turn-reward-restore").hidden = false;
    addPendingRewardWindow("turnReward");
  }

  function restoreTurnRewardModal() {
    document.getElementById("btn-turn-reward-restore").hidden = true;
    document.getElementById("turn-reward-modal").hidden = false;
    renderTurnRewardModal();
  }

  // 潛在之力／抽選武器消耗品飾品の子モーダルを閉じた際、獎勵清單がそれを開くために
  // 縮小されたままだと「押した瞬間に消えた」ように感じられるため、閉じた時点で
  // 縮小中なら自動的に元へ戻す。
  function restoreTurnRewardModalIfMinimized() {
    var restoreBtn = document.getElementById("btn-turn-reward-restore");
    if (restoreBtn && !restoreBtn.hidden) restoreTurnRewardModal();
  }

  // 種類selectは初回のみ構築する（選んだ種類が再描画のたびにリセットされないようにするため）。
  // 對象角色selectはロースター変更に追随できるよう、描画のたびに作り直す。
  function renderTurnRewardAddForm() {
    var kindSelect = document.getElementById("turn-reward-kind-select");
    var targetSelect = document.getElementById("turn-reward-target-select");
    if (!kindSelect || !targetSelect) return;
    if (!kindSelect.dataset.built) {
      TURN_REWARD_KINDS.forEach(function (kind) {
        var opt = document.createElement("option");
        opt.value = kind;
        opt.textContent = window.I18N.t("turn_reward_kind_" + kind);
        kindSelect.appendChild(opt);
      });
      kindSelect.dataset.built = "1";
      kindSelect.addEventListener("change", function () {
        renderTurnRewardAddForm();
      });
    }
    targetSelect.hidden = isTurnRewardSharedKind(kindSelect.value) || kindSelect.value === "buriedTreasure";
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    var prevTarget = targetSelect.value;
    targetSelect.innerHTML = "";
    entered.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      targetSelect.appendChild(opt);
    });
    var anyOpt = document.createElement("option");
    anyOpt.value = TURN_REWARD_ANY_TARGET_VALUE;
    anyOpt.textContent = window.I18N.t("turn_reward_target_any_label");
    targetSelect.appendChild(anyOpt);
    if (TURN_REWARD_ALL_TARGET_KINDS.indexOf(kindSelect.value) !== -1) {
      var allOpt = document.createElement("option");
      allOpt.value = TURN_REWARD_SHARED_TARGET_VALUE;
      allOpt.textContent = window.I18N.t("turn_reward_target_all_label");
      targetSelect.appendChild(allOpt);
    }
    if (
      prevTarget &&
      entered.some(function (c) {
        return c.id === prevTarget;
      })
    ) {
      targetSelect.value = prevTarget;
    }
    // 新增（種類/對象/數量/追加ボタン）はGM回合中のみ操作可能。既存項目の獲得/削除は対象外。
    // ユーザー指定：獎勵清單への手動「新增」は、GM回合中であることに加えて規則書パスワード
    // 認証済み（isRulebookAuthenticated）のユーザーのみ操作可能にする。既存項目の獲得／削除
    // ボタンはこの制限の対象外（renderTurnRewardModal側、誰でも操作可のまま）。
    var canManageTurnRewards = state.turnHolder === "gm" && isRulebookAuthenticated();
    var valueInput = document.getElementById("turn-reward-value-input");
    var addBtn = document.getElementById("btn-turn-reward-add");
    kindSelect.disabled = !canManageTurnRewards;
    targetSelect.disabled = !canManageTurnRewards;
    if (valueInput) {
      valueInput.hidden = kindSelect.value === "buriedTreasure";
      valueInput.disabled = !canManageTurnRewards;
    }
    if (addBtn) {
      addBtn.textContent = window.I18N.t(kindSelect.value === "buriedTreasure" ? "turn_reward_roll_buried_treasure_button" : "turn_reward_add_button");
      addBtn.disabled = !canManageTurnRewards;
    }
  }

  // 武器のcategoryIdから、獎勵清單に出す短い分類名を解決する（規則書が武器種を明記している
  // 場合、「抽選：武器」ではなく「抽選：射擊武器」のように具体的な種類を表示するため）。
  // 個別カテゴリ（聖印等）はWeapons.getCategory()の名称をそのまま使い、射撃武器/盾の
  // グループショートカット定数のみ専用ラベルを使う。解決できない場合はnull（呼び出し側で
  // 汎用の「武器」ラベルへフォールバックする）。
  function weaponCategoryShortLabel(categoryId) {
    if (!categoryId) return null;
    if (categoryId === CharacterDrawer.RANGED_GROUP_CATEGORY) return window.I18N.t("weapon_category_group_ranged_short");
    if (categoryId === CharacterDrawer.SHIELD_GROUP_CATEGORY) return window.I18N.t("weapon_category_group_shield_short");
    var cat = window.PriTestWeapons.getCategory(categoryId);
    return cat ? window.PriTestWeapons.localizedText(cat.name) : null;
  }

  // 獎勵1件分の「種類」表示ラベルを解決する。武器はcategoryIdが分かれば具体的な武器種名を、
  // 消耗品はitemIdが分かれば（規則書が特定のアイテム名を指名している場合）その品名＋
  // 屬性タグをそのまま表示する（抽選ではなく直接指定のため「抽選：」接頭辞は付けない）。
  // どちらも該当しない場合は従来通りturn_reward_kind_<kind>の汎用ラベルにフォールバックする。
  function turnRewardKindLabel(reward) {
    if (reward.kind === "weapon") {
      var categoryLabel = weaponCategoryShortLabel(reward.categoryId);
      if (categoryLabel) return window.I18N.t("turn_reward_kind_weapon_category", { category: categoryLabel });
    }
    if (reward.kind === "consumable" && reward.itemId) {
      var item = window.PriTestConsumables.get(reward.itemId);
      if (item) {
        var itemName = window.PriTestConsumables.localizedText(item.name);
        var tag = reward.attributeTag ? window.PriTestFields.localizedText(reward.attributeTag) : null;
        return tag ? itemName + "（" + tag + "）" : itemName;
      }
    }
    return window.I18N.t("turn_reward_kind_" + reward.kind);
  }

  function turnRewardLabel(reward) {
    var kindLabel = turnRewardKindLabel(reward);
    if (isTurnRewardSharedKind(reward.kind) || reward.targetCharacterId === TURN_REWARD_SHARED_TARGET_VALUE) {
      return window.I18N.t("turn_reward_item_shared_label", { kind: kindLabel, value: reward.value });
    }
    if (reward.targetCharacterId === TURN_REWARD_ANY_TARGET_VALUE) {
      return window.I18N.t("turn_reward_item_any_label", { kind: kindLabel, value: reward.value });
    }
    var target = rosterCharacters.filter(function (c) {
      return c.id === reward.targetCharacterId;
    })[0];
    return window.I18N.t("turn_reward_item_specific_label", { kind: kindLabel, value: reward.value, target: target ? target.name : "?" });
  }

  // 項目の「獲得」ボタン：種類ごとに地板獎勵システムと同じ抽選/加算処理を起動する。
  // 消耗品/護符/潛在之力は別モーダルを開くため、獎勵勾選清單自体は縮小して道を譲り、
  // 獲得完了時に復元する。武器・共有種類はモーダルを介さず即時処理される。
  function claimTurnReward(reward) {
    // 既に処理中／完了済みの項目に対する再入（連続クリックや、Promise.all的に近接した
    // 複数クリックが競合した場合など）を防ぐ。これが無いと、片方が「進行中…」のまま
    // claimedへ辿り着かず固まってしまうことがあった。
    if (reward.claiming || reward.claimed) return;
    // クリックした瞬間に即座にロックし、清單を閉じて開き直しても同じ項目を二重に
    // クリックできないようにする（claimedは実際の獲得完了まで立たないため、それだけでは
    // 進行中に再度クリックできてしまう）。
    reward.claiming = true;
    saveState();
    // 「進行中…」を即座に描画へ反映する。次のクリックが同じ項目のボタンへ当たっても
    // （上のガードにより）何もしないが、そもそも描画上もボタンが消えるため誤クリックしにくくなる。
    renderTurnRewardModal();
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    function finish(logKey, logParams) {
      reward.claimed = true;
      saveState();
      addLog(logKey, logParams);
      document.getElementById("btn-turn-reward-restore").hidden = true;
      document.getElementById("turn-reward-modal").hidden = false;
      renderTurnRewardModal();
    }
    function minimizeSelf() {
      document.getElementById("turn-reward-modal").hidden = true;
      document.getElementById("btn-turn-reward-restore").hidden = false;
    }
    if (reward.kind === "stoneswordKey") {
      state.stoneswordKeyCount = (state.stoneswordKeyCount || 0) + reward.value;
      renderStoneswordKeyCount();
      finish("log_turn_reward_claim_shared", { kind: window.I18N.t("turn_reward_kind_stoneswordKey"), value: reward.value });
      return;
    }
    if (reward.kind === "smithingStone") {
      state.smithingStoneCount = (state.smithingStoneCount || 0) + reward.value;
      renderSmithingStoneCount();
      finish("log_turn_reward_claim_shared", { kind: window.I18N.t("turn_reward_kind_smithingStone"), value: reward.value });
      return;
    }
    // chaliceBonus/runeは「全體」（従来通り全員へ一律付与）と「任意」（獲得時に選んだ1名のみへ
    // 付与、renderTurnRewardModal側でボタン押下前にtargetCharacterIdへ実体化済み）の両方に対応する。
    var applyToOne =
      reward.targetCharacterId &&
      reward.targetCharacterId !== TURN_REWARD_SHARED_TARGET_VALUE &&
      reward.targetCharacterId !== TURN_REWARD_ANY_TARGET_VALUE
        ? rosterCharacters.filter(function (c) {
            return c.id === reward.targetCharacterId;
          })[0]
        : null;
    if (reward.kind === "chaliceBonus") {
      (applyToOne ? [applyToOne] : entered).forEach(function (c) {
        if (!c.flaskExtra) c.flaskExtra = { current: 0, max: 0 };
        c.flaskExtra.max = (c.flaskExtra.max || 0) + reward.value;
        c.flaskExtra.current = (c.flaskExtra.current || 0) + reward.value;
      });
      saveRosterCharacters();
      renderCharacterRoster();
      if (applyToOne) {
        finish("log_turn_reward_claim_shared_one", { character: applyToOne.name, kind: window.I18N.t("turn_reward_kind_chaliceBonus"), value: reward.value });
      } else {
        finish("log_turn_reward_claim_shared", { kind: window.I18N.t("turn_reward_kind_chaliceBonus"), value: reward.value });
      }
      return;
    }
    if (reward.kind === "rune") {
      (applyToOne ? [applyToOne] : entered).forEach(function (c) {
        c.runes = (c.runes || 0) + reward.value;
      });
      saveRosterCharacters();
      renderCharacterRoster();
      if (applyToOne) {
        finish("log_turn_reward_claim_shared_one", { character: applyToOne.name, kind: window.I18N.t("turn_reward_kind_rune"), value: reward.value });
      } else {
        finish("log_turn_reward_claim_shared", { kind: window.I18N.t("turn_reward_kind_rune"), value: reward.value });
      }
      return;
    }
    var target = rosterCharacters.filter(function (c) {
      return c.id === reward.targetCharacterId;
    })[0];
    if (!target) {
      window.alert(window.I18N.t("turn_reward_target_missing_note"));
      return;
    }
    if (reward.kind === "weapon") {
      minimizeSelf();
      openItemDrawModal("weapon", target.id, {
        starCount: reward.value,
        categoryId: reward.categoryId || null,
        attributeTag: reward.attributeTag ? window.PriTestFields.localizedText(reward.attributeTag) : null,
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_weapon"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "consumable" && reward.itemId) {
      // 規則書が具体的な品名を指名している獎勵（例：「投擲壺(雷)」）は抽選を行わず、
      // その場でtarget所持品へ直接付与する（第1項：獎勵清單の表記どおり「任意」で
      // 對象だけ選べば即座に確定する）。
      var namedItem = window.PriTestConsumables.get(reward.itemId);
      if (!namedItem) {
        window.alert(window.I18N.t("turn_reward_target_missing_note"));
        return;
      }
      minimizeSelf();
      if (!target.consumables) target.consumables = [];
      var namedItemInstanceId = CharacterDrawer.makeConsumableInstanceId(reward.itemId, target);
      target.consumables.push({
        id: namedItemInstanceId,
        itemId: reward.itemId,
        usesRemaining: namedItem.uses || 1,
      });
      // 武器のweaponAttributeTagsと同じ規約：規則書が指定した屬性（例：投擲壺の「雷」）を
      // 所持品側にも自動記録し、後で使用する際に手動で覚えておく必要をなくす。
      if (reward.attributeTag) {
        if (!target.consumableAttributeTags) target.consumableAttributeTags = {};
        target.consumableAttributeTags[namedItemInstanceId] = window.PriTestFields.localizedText(reward.attributeTag);
      }
      saveRosterCharacters();
      renderCharacterRoster();
      CharacterDrawer.resolveInventoryOverflow(target, "consumable", function () {
        renderCharacterRoster();
        finish("log_turn_reward_claim_generic", { kind: turnRewardKindLabel(reward), character: target.name });
      });
      return;
    }
    if (reward.kind === "consumable") {
      minimizeSelf();
      openItemDrawModal("consumable", target.id, {
        grantCount: reward.value,
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_consumable"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "talisman") {
      minimizeSelf();
      openItemDrawModal("talisman", target.id, {
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_talisman"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "potentialPower") {
      minimizeSelf();
      var ppAttributeTag = reward.attributeTag ? window.PriTestFields.localizedText(reward.attributeTag) : null;
      window.PriTestNightPotentialPower.openPotentialPowerModal(target.id, reward.value, ppAttributeTag, function () {
        finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_potentialPower"), character: target.name });
      });
      return;
    }
    if (reward.kind === "weaponSkillReroll") {
      minimizeSelf();
      window.PriTestNightCore.openWeaponSkillRerollModal(target.id, function () {
        finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_weaponSkillReroll"), character: target.name });
      });
      return;
    }
  }

  function renderTurnRewardModal() {
    renderTurnRewardAddForm();
    var list = document.getElementById("turn-reward-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.turnRewards.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("turn_reward_empty_note");
      list.appendChild(empty);
      return;
    }
    state.turnRewards.forEach(function (reward) {
      var row = document.createElement("div");
      row.className = "wb-row";
      var text = document.createElement("span");
      text.textContent = turnRewardLabel(reward);
      if (reward.claimed) text.style.textDecoration = "line-through";
      row.appendChild(text);
      if (!reward.claimed && !reward.claiming) {
        // 「任意」は追加時点では對象未確定のため、獲得ボタンを押す直前にここで1名選ばせ、
        // 選んだ角色IDをtargetCharacterIdへ実体化してからclaimTurnRewardへ渡す（以降の処理は
        // 固定角色指定の場合と完全に同じ経路を通る）。
        var anyPickerSelect = null;
        if (reward.targetCharacterId === TURN_REWARD_ANY_TARGET_VALUE) {
          var enteredForPicker = rosterCharacters.filter(function (c) {
            return c.entered;
          });
          anyPickerSelect = document.createElement("select");
          enteredForPicker.forEach(function (c) {
            var o = document.createElement("option");
            o.value = c.id;
            o.textContent = c.name;
            anyPickerSelect.appendChild(o);
          });
          row.appendChild(anyPickerSelect);
        }
        var claimBtn = document.createElement("button");
        claimBtn.type = "button";
        claimBtn.className = "primary-btn";
        claimBtn.textContent = window.I18N.t("turn_reward_claim_button");
        if (anyPickerSelect && !anyPickerSelect.options.length) claimBtn.disabled = true;
        claimBtn.addEventListener("click", function () {
          if (anyPickerSelect) reward.targetCharacterId = anyPickerSelect.value;
          claimTurnReward(reward);
        });
        row.appendChild(claimBtn);
      } else if (reward.claiming) {
        var claimingNote = document.createElement("span");
        claimingNote.className = "threat-ref-body";
        claimingNote.textContent = window.I18N.t("turn_reward_claiming_note");
        row.appendChild(claimingNote);
      }
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "tag-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", function () {
        var idx = state.turnRewards.indexOf(reward);
        if (idx !== -1) state.turnRewards.splice(idx, 1);
        saveState();
        renderTurnRewardModal();
      });
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  // ランダムイベント「埋もれ宝」の「チェスト内容決定表」（1D）。
  // 1｜鍛石　2｜石剣の鍵　3｜消耗品：★　4-5｜武器：★★　6｜武器：★★★
  function buriedTreasureRollToReward(roll) {
    if (roll === 1) return { kind: "smithingStone", value: 1, needsTarget: false };
    if (roll === 2) return { kind: "stoneswordKey", value: 1, needsTarget: false };
    if (roll === 3) return { kind: "consumable", value: 1, needsTarget: true };
    if (roll === 4 || roll === 5) return { kind: "weapon", value: 2, needsTarget: true };
    return { kind: "weapon", value: 3, needsTarget: true };
  }

  // ランダムイベント「埋もれ宝」：1Dを3回振り、「チェスト内容決定表」に沿ったアイテムを
  // それぞれ獎勵清單へ積む（消耗品/武器は「任意」＝獲得時にGMが對象角色を選ぶ）。
  function handleBuriedTreasureAdd() {
    for (var i = 0; i < 3; i++) {
      var roll = 1 + Math.floor(Math.random() * 6);
      var resolved = buriedTreasureRollToReward(roll);
      state.turnRewards.push({
        id: "tr" + Date.now() + Math.floor(Math.random() * 1000) + "_bt" + i,
        kind: resolved.kind,
        targetCharacterId: resolved.needsTarget ? TURN_REWARD_ANY_TARGET_VALUE : null,
        value: resolved.value,
        claimed: false,
      });
      addLog("log_buried_treasure_roll", { roll: roll, kind: window.I18N.t("turn_reward_kind_" + resolved.kind), value: resolved.value });
    }
    saveState();
    renderTurnRewardModal();
  }

  function handleTurnRewardAdd() {
    var kindSelect = document.getElementById("turn-reward-kind-select");
    var targetSelect = document.getElementById("turn-reward-target-select");
    var valueInput = document.getElementById("turn-reward-value-input");
    if (!kindSelect || !targetSelect || !valueInput) return;
    var kind = kindSelect.value;
    // 「埋もれ宝」は對象/數量の入力欄自体を持たず、押した瞬間に1Dを3回振って結果をまとめて
    // 積む専用の挙動のため、他の種類と分岐させる。
    if (kind === "buriedTreasure") {
      handleBuriedTreasureAdd();
      return;
    }
    var shared = isTurnRewardSharedKind(kind);
    var targetCharacterId = shared ? null : targetSelect.value || null;
    if (!shared && !targetCharacterId) return;
    var value = Math.max(1, parseInt(valueInput.value, 10) || 1);
    // 消耗品・護符は「value個」を1回の抽選でまとめて同じ結果を複数個付与する仕様だと、
    // 本来別々に抽選されるべきアイテムが全て同一のものになってしまう。そのため個数分を
    // それぞれ独立した項目（value:1）へ分割し、1件ずつ個別に抽選できるようにする（第2項）。
    if ((kind === "consumable" || kind === "talisman") && value > 1) {
      for (var i = 0; i < value; i++) {
        state.turnRewards.push({
          id: "tr" + Date.now() + Math.floor(Math.random() * 1000) + "_" + i,
          kind: kind,
          targetCharacterId: targetCharacterId,
          value: 1,
          claimed: false,
        });
      }
    } else {
      state.turnRewards.push({
        id: "tr" + Date.now() + Math.floor(Math.random() * 1000),
        kind: kind,
        targetCharacterId: targetCharacterId,
        value: value,
        claimed: false,
      });
    }
    saveState();
    renderTurnRewardModal();
  }

  // 他モジュール（night_floor_breakthrough.js等）が組み立てた獎勵清單アイテムを一括pushする。
  // 個々の項目の形は既存のGM手動追加（handleTurnRewardAdd）と同一（{id,kind,targetCharacterId,value,claimed,...}）。
  function pushTurnRewards(rewardObjs) {
    if (!rewardObjs || !rewardObjs.length) return;
    rewardObjs.forEach(function (r) {
      state.turnRewards.push(r);
    });
    saveState();
    var modal = document.getElementById("turn-reward-modal");
    if (modal && !modal.hidden) renderTurnRewardModal();
  }

  // 額外行動は、非雑兵エネミーの4段のうちいずれか1段でもHP0にならない限り選択できない。
  function renderActionPhaseGrid() {
    document.querySelectorAll(".action-phase-grid button[data-phase]").forEach(function (btn) {
      if (btn.dataset.phase === "extra") {
        btn.disabled = !anyEnemyHpRowDepleted();
      }
    });
  }

  function openActionPhaseModal() {
    document.getElementById("action-phase-modal").hidden = false;
  }

  function closeActionPhaseModal() {
    document.getElementById("action-phase-modal").hidden = true;
  }

  function openSpiritPanel() {
    renderSpiritPanel();
    document.getElementById("spirit-panel-modal").hidden = false;
  }

  function closeSpiritPanel() {
    document.getElementById("spirit-panel-modal").hidden = true;
  }

  // 死靈/靈體を持つ復仇者（typeにnecromancy能力またはspirit_summon技能を持つ角色）ごとに、
  // 死靈術の擲骰待ち・死靈リスト・召喚中の靈體を管理表示する。サイコロアイコン横のボタンから
  // 開く、キャラ非依存のグローバルなパネル（state.dicePoolと同じくゲーム全体で1つ）。
  function renderSpiritPanel() {
    var content = document.getElementById("spirit-panel-content");
    if (!content) return;
    content.innerHTML = "";

    var avengers = rosterCharacters.filter(function (c) {
      if (!c.entered) return false;
      var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
      if (!type) return false;
      var hasNecromancy = (type.abilities || []).some(function (entry) {
        return entry.id === "necromancy";
      });
      var hasSpiritSummon = (type.skills || []).some(function (entry) {
        return entry.id === "spirit_summon";
      });
      return hasNecromancy || hasSpiritSummon;
    });

    if (!avengers.length) {
      var emptyNote = document.createElement("p");
      emptyNote.className = "threat-ref-body";
      emptyNote.textContent = window.I18N.t("spirit_panel_no_spirit_note");
      content.appendChild(emptyNote);
      return;
    }

    // 復仇者（暗影）「靈體消滅時HP回復」「靈體消滅時FP回復」：自身召喚的「靈體」（含「死靈術」
    // 召喚的靈體）HP歸零而消滅的瞬間，對自身各施加「HP回復：□□」「FP回復：□□」（各+2）。
    // 兩個relic各自獨立判定是否已習得。
    function maybeApplySpiritVanishRecovery(c, wasAboveZero, nowZero, label) {
      if (!wasAboveZero || !nowZero) return;
      var healed = false;
      if (CharacterDrawer.findLearnedRelicEffectByName(c, ["靈體消滅時HP回復", "霊体消滅時HP回復"])) {
        c.hp.current = Math.min(c.hp.max, c.hp.current + 2);
        healed = true;
      }
      if (CharacterDrawer.findLearnedRelicEffectByName(c, ["靈體消滅時FP回復", "霊体消滅時FP回復"])) {
        c.fp.current = Math.min(c.fp.max, c.fp.current + 2);
        healed = true;
      }
      if (healed) addLog("log_spirit_vanish_recovery", { character: c.name, label: label });
    }

    avengers.forEach(function (c) {
      var type = CharacterTypes.get(c.typeId);
      var section = document.createElement("div");
      section.className = "combat-skill-row";
      var heading = document.createElement("p");
      heading.className = "combat-skill-name";
      heading.textContent = c.name;
      section.appendChild(heading);

      renderNecromancyPendingSection(c, section);

      // 死靈リスト（無制限・戦闘終了時に全消去。HPステッパーはadjustMobHpRowと同じ+/-方式）。
      (c.deathSpirits || []).forEach(function (spirit, idx) {
        var row = document.createElement("div");
        row.className = "battle-hp-stepper-row";
        var label = document.createElement("span");
        label.className = "level-value";
        label.textContent = window.I18N.t("death_spirit_label", { index: idx + 1 });
        row.appendChild(label);
        var minus = document.createElement("button");
        minus.type = "button";
        minus.className = "level-btn";
        minus.textContent = "−";
        minus.addEventListener("click", function () {
          var wasAboveZero = spirit.hpCurrent > 0;
          spirit.hpCurrent = Math.max(0, spirit.hpCurrent - 1);
          maybeApplySpiritVanishRecovery(c, wasAboveZero, spirit.hpCurrent === 0, window.I18N.t("death_spirit_label", { index: idx + 1 }));
          saveRosterCharacters();
          addLog("log_spirit_hp_change", { character: c.name, label: window.I18N.t("death_spirit_label", { index: idx + 1 }), current: spirit.hpCurrent, max: spirit.hpMax });
          renderSpiritPanel();
        });
        row.appendChild(minus);
        var value = document.createElement("span");
        value.className = "level-value battle-hp-stepper-value";
        value.textContent = spirit.hpCurrent + "/" + spirit.hpMax;
        row.appendChild(value);
        var plus = document.createElement("button");
        plus.type = "button";
        plus.className = "level-btn";
        plus.textContent = "＋";
        plus.addEventListener("click", function () {
          spirit.hpCurrent = Math.min(spirit.hpMax, spirit.hpCurrent + 1);
          saveRosterCharacters();
          addLog("log_spirit_hp_change", { character: c.name, label: window.I18N.t("death_spirit_label", { index: idx + 1 }), current: spirit.hpCurrent, max: spirit.hpMax });
          renderSpiritPanel();
        });
        row.appendChild(plus);
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "tag-remove battle-row-remove";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", function () {
          c.deathSpirits.splice(idx, 1);
          saveRosterCharacters();
          renderSpiritPanel();
        });
        row.appendChild(removeBtn);
        section.appendChild(row);
      });

      // 召喚靈體（level 2で解放）。同時に1体のみ、種類ごとのHPはspiritSummonHpに保存。
      var spiritSummonSkill = (type.skills || []).filter(function (entry) {
        return entry.id === "spirit_summon";
      })[0];
      if (spiritSummonSkill && spiritSummonSkill.level && c.level < spiritSummonSkill.level) {
        var lockedNote = document.createElement("p");
        lockedNote.className = "threat-ref-body";
        lockedNote.textContent = window.I18N.t("spirit_panel_level_locked_note", { level: spiritSummonSkill.level });
        section.appendChild(lockedNote);
      } else if (c.spiritSummon && c.spiritSummonHp && c.spiritSummonHp[c.spiritSummon]) {
        var kind = c.spiritSummon;
        var hp = c.spiritSummonHp[kind];
        var spiritRow = document.createElement("div");
        spiritRow.className = "battle-hp-stepper-row";
        var spiritLabel = document.createElement("span");
        spiritLabel.className = "level-value";
        spiritLabel.textContent = window.I18N.t("spirit_summon_choice_" + kind + "_label");
        spiritRow.appendChild(spiritLabel);
        var spiritMinus = document.createElement("button");
        spiritMinus.type = "button";
        spiritMinus.className = "level-btn";
        spiritMinus.textContent = "−";
        spiritMinus.addEventListener("click", function () {
          var summonWasAboveZero = hp.current > 0;
          hp.current = Math.max(0, hp.current - 1);
          maybeApplySpiritVanishRecovery(c, summonWasAboveZero, hp.current === 0, window.I18N.t("spirit_summon_choice_" + kind + "_label"));
          saveRosterCharacters();
          addLog("log_spirit_hp_change", { character: c.name, label: window.I18N.t("spirit_summon_choice_" + kind + "_label"), current: hp.current, max: hp.max });
          renderSpiritPanel();
        });
        spiritRow.appendChild(spiritMinus);
        var spiritValue = document.createElement("span");
        spiritValue.className = "level-value battle-hp-stepper-value";
        spiritValue.textContent = hp.current + "/" + hp.max;
        spiritRow.appendChild(spiritValue);
        var spiritPlus = document.createElement("button");
        spiritPlus.type = "button";
        spiritPlus.className = "level-btn";
        spiritPlus.textContent = "＋";
        spiritPlus.addEventListener("click", function () {
          hp.current = Math.min(hp.max, hp.current + 1);
          saveRosterCharacters();
          addLog("log_spirit_hp_change", { character: c.name, label: window.I18N.t("spirit_summon_choice_" + kind + "_label"), current: hp.current, max: hp.max });
          renderSpiritPanel();
        });
        spiritRow.appendChild(spiritPlus);
        section.appendChild(spiritRow);
        var dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "combat-attack-hit-btn";
        dismissBtn.textContent = window.I18N.t("spirit_summon_dismiss_button");
        dismissBtn.addEventListener("click", function () {
          c.spiritSummon = null;
          saveRosterCharacters();
          renderSpiritPanel();
        });
        section.appendChild(dismissBtn);
      } else {
        var noSpiritNote = document.createElement("p");
        noSpiritNote.className = "threat-ref-body";
        noSpiritNote.textContent = window.I18N.t("spirit_panel_no_spirit_note");
        section.appendChild(noSpiritNote);
      }

      content.appendChild(section);
    });
  }

  function openElementMarkPanel() {
    renderElementMarkPanel();
    document.getElementById("element-mark-panel-modal").hidden = false;
  }

  function closeElementMarkPanel() {
    document.getElementById("element-mark-panel-modal").hidden = true;
  }

  // 隱者「元素操控」の屬性痕（0〜3、祝福休息でもリセットされない）を管理表示する専用パネル。
  // 復仇者の死靈パネルとは別立て（ユーザー選択済み）。骰子アイコン横のボタンから開く、
  // キャラ非依存のグローバルなパネル。
  function renderElementMarkPanel() {
    var content = document.getElementById("element-mark-panel-content");
    if (!content) return;
    content.innerHTML = "";

    var hermits = rosterCharacters.filter(function (c) {
      if (!c.entered) return false;
      var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
      if (!type) return false;
      return (type.abilities || []).some(function (entry) {
        return entry.id === "elemental_control";
      });
    });

    if (!hermits.length) {
      var emptyNote = document.createElement("p");
      emptyNote.className = "threat-ref-body";
      emptyNote.textContent = window.I18N.t("spirit_panel_no_spirit_note");
      content.appendChild(emptyNote);
      return;
    }

    hermits.forEach(function (c) {
      var section = document.createElement("div");
      section.className = "combat-skill-row";
      var heading = document.createElement("p");
      heading.className = "combat-skill-name";
      heading.textContent = c.name;
      section.appendChild(heading);

      var row = document.createElement("div");
      row.className = "battle-hp-stepper-row";
      var label = document.createElement("span");
      label.className = "level-value";
      label.textContent = window.I18N.t("element_mark_label");
      row.appendChild(label);
      var minus = document.createElement("button");
      minus.type = "button";
      minus.className = "level-btn";
      minus.textContent = "−";
      minus.addEventListener("click", function () {
        c.elementalMarks = Math.max(0, (c.elementalMarks || 0) - 1);
        saveRosterCharacters();
        renderElementMarkPanel();
      });
      row.appendChild(minus);
      var value = document.createElement("span");
      value.className = "level-value battle-hp-stepper-value";
      value.textContent = (c.elementalMarks || 0) + "/3";
      row.appendChild(value);
      var plus = document.createElement("button");
      plus.type = "button";
      plus.className = "level-btn";
      plus.textContent = "＋";
      plus.addEventListener("click", function () {
        c.elementalMarks = Math.min(3, (c.elementalMarks || 0) + 1);
        saveRosterCharacters();
        renderElementMarkPanel();
      });
      row.appendChild(plus);
      section.appendChild(row);

      content.appendChild(section);
    });
  }

  function setActionPhase(phase, opts) {
    opts = opts || {};
    if (state.actionPhase === phase) {
      closeActionPhaseModal();
      return;
    }
    // 額外行動は、非雑兵エネミーのいずれかの段がHP0になっていない限り選択不可
    // （UI側でもボタンを無効化しているが、念のためここでも防御する）。
    if (phase === "extra" && !anyEnemyHpRowDepleted()) {
      closeActionPhaseModal();
      return;
    }
    // 自動化GM 戰鬥自動化：簡易戰鬥（docs/combat_flow_rules.md §6）はディフェンスフェイズを
    // 発生させず、第1回合の戰鬥/額外階段が終わった時点で追擊損害へ差し替えて戦闘を終える
    // （battle_simple_combat_body記載の既存規則書参照文と同じ内容、opts.forceDefenseで
    // GMが手動で通常通り防禦フェイズへ進みたい場合の脱出口を残す）。
    if (phase === "defense" && state.battle.combatMode === "simplified" && !opts.forceDefense) {
      closeActionPhaseModal();
      state.battle.simplifiedCombatEndPending = true;
      state.battle.roundActionsDone = {};
      state.battle.roundActionLog = [];
      state.battle.roundResultText = null;
      state.battle.pendingDefenseRoll = null;
      state.battle.defenseRollPreviewText = null;
      state.battle.enemyDamageConfirmed = {};
      state.battle.defenseHpLossSummary = {};
      state.battle.defenseEntryEffectText = null;
      state.battle.roundStage = "awaitingRoll";
      saveState();
      renderSimplifiedCombatEndPrompt();
      renderCurrentLocationStatus();
      return;
    }
    // 「戰鬥→額外→防禦」が1回合。combatフェイズへ新規突入するたびに新しい回合が始まったとみなし、
    // 異常側の「今回合すでに發動した」ロックを解除する（屬性側は回合をまたいで蓄積を持ち越す）。
    if (phase === "combat" && state.actionPhase !== "combat") {
      resetAttributeStatusRoundLocks();
      // ガード回数はアクションフェイズ開始時に最大値まで回復する（docs/enemy_damage_rules.md
      // 5.5節）。stateには「現在値」だけを保持し、未設定＝最大値扱いにフォールバックする
      // 設計（enemyCurrentGuardCount）なので、新しい回合の開始時はここを空にするだけでよい。
      state.battle.guardCount = {};
      // 守護者「救世之翼」の全体バフ（戦闘→額外→防禦の1回合を跨いで持続）も、新しい回合が
      // 始まったタイミングでのみクリアする（フェイズ切替の都度リセットする他のフラグとは
      // ライフサイクルが異なる）。
      // 骰子池クリアは「防禦フェイズから戰鬥フェイズへ戻る＝次の回合へ進む」場合のみ発火させる。
      // 「一般行動」から初めて戰鬥フェイズへ入る（戦闘開始）は「次の回合」ではないため対象外
      // （このifブロック自体はresetAttributeStatusRoundLocks等のため combat以外全般で発火する）。
      var isNewRoundFromDefense = state.actionPhase === "defense";
      // 新しい回合に入るときは、前回合の最初の全骰子ロールで確定した前後衛・敵視の
      // 自動計算ロックも解除し、次の回合の最初のロールで改めて確定できるようにする。
      if (isNewRoundFromDefense) {
        state.battle.positionLocked = new Array(BATTLE_SLOT_COUNT).fill(false);
        // 新しい回合の開始（防禦→戰鬥）でも、額外／防禦フェイズ突入時と同様に前回合の
        // 確定行動（点線枠）を一括で消去する（ユーザー確認済みの行動階段フロー仕様）。
        clearAllPendingActionBoxes();
        // 特殊能力「飛び退き／転移／滞空」等（conditions:["force_back_row_next_phase"]）：
        // 前回合のディフェンスフェイズでこの効果が発動していれば、entered全員をこの新しい
        // 戰鬥フェイズの開始時点で強制的に後衛へ固定する（positionLockedをtrueにして、
        // これから振る骰子による自動前後衛判定=syncDiceStatusToBattleで上書きされないように
        // する——本文の「骰目に関わらず後衛配置」を反映）。
        if (state.battle.forceBackRowNextPhase) {
          // state.battle.front/back/positionLockedはrosterCharacters全体ではなく、entered
          // でフィルタした後の連番インデックス（0〜BATTLE_SLOT_COUNT-1）を使う配列のため
          // （syncDiceStatusToBattleと同じパターン）、rosterCharacters.forEachのidxを直接
          // 使ってはならない。
          var forceBackRowEntered = rosterCharacters.filter(function (c) {
            return c.entered;
          });
          forceBackRowEntered.forEach(function (c, idx) {
            if (idx >= BATTLE_SLOT_COUNT) return;
            state.battle.front[idx] = false;
            state.battle.back[idx] = true;
            state.battle.positionLocked[idx] = true;
          });
          state.battle.forceBackRowNextPhase = false;
          addLog("log_force_back_row_next_phase");
        }
      }
      rosterCharacters.forEach(function (c) {
        // R1「技能強化（迎擊）」：前回合の防禦フェイズで「逆襲」を使っていれば、新しい戰鬥
        // フェイズの開始時に「以Action使用時」の効果（對敵人造成【總合傷害：30+◆】）を
        // 被動強制發動する。對象敵人の選択はGM/玩家に委ねるため、確定数値30とともにログへ残す。
        if (isNewRoundFromDefense && c._counterattackAutoTriggerPending) {
          addLog("log_counterattack_auto_trigger", { character: c.name });
          c._counterattackAutoTriggerPending = false;
        }
        // 新しい回合（防禦フェイズから戰鬥フェイズへ再突入）に入るとき、原則として全員の
        // 個人骰子池を空にする（技能・遺物効果で次回合へ持ち越せる場合は、そのキャラだけ
        // ここをスキップする条件を将来追加できる）。消えた骰子はログに記録する。
        if (isNewRoundFromDefense && (c.dicePool || []).length) {
          // R4 遺物効果「回合結束時，體力骰帶入1個」：防禦フェイズ終了時（＝新しい回合へ進む今）
          // 残っている骰子の中で最も大きい出目1個だけを、これからクリアする骰子池から
          // 除外して持ち越す（「任選1個」の「最大」実装：常に最良の1個を残す）。
          var carryOverBonus = CharacterDrawer.countLearnedRelicEffectsByName(c, [
            "回合結束時，體力骰帶入1個",
            "ターン終了時、スタミナダイス1個持ち越し",
          ]);
          var carriedDice = [];
          if (carryOverBonus > 0) {
            var maxValue = Math.max.apply(null, c.dicePool);
            var maxIdx = c.dicePool.indexOf(maxValue);
            carriedDice = c.dicePool.splice(maxIdx, 1);
          }
          var clearedDice = c.dicePool.join("、");
          c.dicePool = carriedDice;
          if (clearedDice) addLog("log_dice_pool_cleared_new_round", { character: c.name, dice: clearedDice });
          if (carriedDice.length) addLog("log_dice_pool_carried_new_round", { character: c.name, dice: carriedDice.join("、") });
        }
        c._wingsOfSalvationActive = false;
        c._marchOfTheUndyingActive = false;
        c._inquiryDamageReductionActive = false;
        c._empathyActive = false;
        // R10 遺物効果「回合中限1次裝備變更免費」：新しい回合（戰鬥フェイズへの再突入）ごとに解禁する。
        c._freeEquipChangeUsedThisRound = false;
        // 「1回合內每名PC限用1次」系統の技能（踢擊・拒絕・黃金之怒・貴種的腹藝・盾擊等、#6）：
        // 戰鬥→額外→防禦が1回合のため、フェイズ切替の都度ではなく新しい回合ごとにのみ解除する。
        c._entryUsedThisTurn = {};
        // 執行者「妖刀」：防禦フェイズで使用した際に予約された「次の行動階段開始時に體力骰+1」を
        // ここで消化する（新しい回合＝combatフェイズへの新規突入のタイミング）。
        if (c._yotoPendingBonusDice) {
          if (!c.dicePool) c.dicePool = [];
          c.dicePool.push(1 + Math.floor(Math.random() * 6));
          c._yotoPendingBonusDice = false;
        }
      });
    }
    // 淑女「終曲」：「次の防禦フェイズ」1回限りの効果のため、防禦フェイズを抜けるタイミング
    // （＝その1回の防禦フェイズが終わった時点）でリセットする。救世之翼のような回合単位の
    // 持続バフとはライフサイクルが異なる。
    if (state.actionPhase === "defense" && phase !== "defense") {
      state.battle._finaleActive = false;
      state.battle._totemStellaActive = false;
      state.battle._ruffianDarkCounterDebuffActive = false;
      // 附帶効果「HP持續回復」「FP持續回復」：防禦階段結束時（戰鬥結束・次回合いずれも含む）、
      // 自身に「HP回復□」「FP回復□」＝+1として適用する。
      rosterCharacters.forEach(function (c) {
        if (!c.entered) return;
        var attached = c.learnedAttachedEffects || [];
        if (attached.indexOf("hp_regen") !== -1) c.hp.current = Math.min(c.hp.max, c.hp.current + 1);
        if (attached.indexOf("fp_regen") !== -1) c.fp.current = Math.min(c.fp.max, c.fp.current + 1);
      });
      // グラディウス「分裂形態」移行条件2：分裂形態のいずれかの個体HPが0以下になっていた
      // 場合、防御フェイズ終了時に合体形態へ自動で戻す（GM手動トグルの出番はここでは無い）。
      if (state.battle.bossFormTransitionPending) {
        state.battle.bossFormTransitionPending = false;
        state.battle.bossForm = "fused";
        addLog("log_boss_form_auto_transition");
      }
    }
    // 隱者「血魂之歌」：「階段結束まで」＝発動したフェイズ限定のバフのため、フェイズが
    // 変わるたびに必ずクリアする（回合単位で持続する救世之翼／終曲等とはライフサイクルが
    // 異なる。battle全体のフラグのため、下のrosterCharacters.forEachとは別に1回だけ行う）。
    state.battle._songOfBloodSpiritActive = false;
    // 附帶効果「步行時發生落雷」「一定時間後產生輝石」：戰鬥階段→額外階段への遷移時のみ
    // （最初の骰子ロールで前衛/敵視が決まる場面は対象外、ユーザー確認済み）、それぞれ
    // 「前衛にいる」「敵視:1以上」を満たせば對敵人1D分の屬性を與える（行動階段ごとに1回）。
    if (phase === "extra") {
      rosterCharacters.forEach(function (c) {
        if (!c.entered) return;
        var attached = c.learnedAttachedEffects || [];
        if (attached.indexOf("walk_lightning") !== -1 && getCharacterBattlePosition(c) === "front") {
          addLog("log_walk_lightning_trigger", { character: c.name });
        }
        var idxForAggro = battlePositionNames().indexOf(c.name);
        var aggroValue = idxForAggro !== -1 && idxForAggro < BATTLE_SLOT_COUNT ? state.battle.aggro[idxForAggro] || 0 : 0;
        if (attached.indexOf("time_gem") !== -1 && aggroValue >= 1) {
          addLog("log_time_gem_trigger", { character: c.name });
        }
      });
    }
    // 遺物効果「130傷害回復HP」「130傷害回復FP」：フェイズが切り替わる（＝そのフェイズが結束）
    // 直前に、これまで積み上げたc._phaseDamageDealtが130以上かどうかを判定する。判定後、
    // 下のリセットループでc._phaseDamageDealtを0に戻す（次のフェイズへ持ち越さない）。
    rosterCharacters.forEach(function (c) {
      if (!c.entered || (c._phaseDamageDealt || 0) < 130) return;
      if (CharacterDrawer.findLearnedRelicEffectByName(c, ["130傷害回復HP", "130ダメージでHP回復"])) {
        c.hp.current = Math.min(c.hp.max, c.hp.current + 1);
        addLog("log_130_damage_heal_hp", { character: c.name });
      }
      if (CharacterDrawer.findLearnedRelicEffectByName(c, ["130傷害回復FP", "130ダメージでFP回復"])) {
        c.fp.current = Math.min(c.fp.max, c.fp.current + 1);
        addLog("log_130_damage_heal_fp", { character: c.name });
      }
    });
    state.actionPhase = phase;
    // 自動化GM 戰鬥自動化：本回合の「已完成」ボタン状態と細粒度階段（GM敘述提示用）は、
    // フェイズが切り替わるたびにクリアする（combat/extra/defenseへ入るたびに"awaitingRoll"
    // から始める。normalへ戻る場合はbanner非表示になるため値を問わない）。
    state.battle.roundActionsDone = {};
    state.battle.roundActionLog = [];
    state.battle.roundResultText = null;
    state.battle.pendingDefenseRoll = null;
    state.battle.defenseRollPreviewText = null;
    state.battle.enemyDamageConfirmed = {};
    state.battle.defenseHpLossSummary = {};
    state.battle.defenseEntryEffectText = null;
    state.battle.roundStage = "awaitingRoll";
    // 使用者確認：防禦階段に入るたびに時間損耗+1（規則書「防禦階段開始時、時間消耗1」）。
    // 自動化GMの自動遷移（autoAdvanceBattlePhase）だけでなく、GMが「行動階段」ボタンから手動で
    // defenseへ切り替えた場合にも等しく発火させるため、ここ（setActionPhase自身）で処理する。
    // 直前のリセット（defenseEntryEffectText=null）より後で書き込むことで、消されずに残す。
    // 威脅効果／夜雨が新たに到達した場合は、addTimeLossが返す文字も合わせて進度版へ表示する。
    if (phase === "defense") {
      // 使用者確認：「敵人傷害」執行紀錄（紅框）は各角色につき常に最大1件——次の防禦階段へ
      // 入る一番最初に、前回合分の古い記録を先に消してから今回合の処理を始める。
      clearEnemyDamageActionBoxes();
      var defenseEntryMessages = addTimeLoss(1) || [];
      var defenseEntryLines = [window.I18N.t("gm_flow_battle_defense_entry_time_loss")].concat(defenseEntryMessages);
      state.battle.defenseEntryEffectText = defenseEntryLines.join("\n");
    }
    // GM／玩家が同時にプレイしなくてもよいよう、行動階段が切り替わるたびに「今の番」を
    // 必ずGM側へ戻す（GMが状況を確認・反応してから、改めて玩家へ番を渡す運用を想定）。
    // handleTurnHolderToggleと同じく、GM側の留言はここでも「次のGm回合開始」に該当するため
    // クリアする（このショートカット経由の遷移だけクリアが漏れるバグを防ぐ）。
    state.turnHolder = "gm";
    archiveTurnMessages("gm");
    // フェイズを切り替えるたびに「額外／防禦行動を使用済み」フラグをリセットする（次にまた
    // 同じフェイズへ入ったとき、全員が改めて1回分振れるようにするため）。
    rosterCharacters.forEach(function (c) {
      c._extraActionUsed = false;
      c._defenseActionUsed = false;
      c._combatDiceRolled = false;
      c._consecutiveGuardCount = 0;
      c._dodgeActionUsed = false;
      // 自動化GM 戰鬥自動化：#enemy-damage-modalへの自動預填用に記録した「今回の防禦階段で
      // 実際に確定したHP價值」は、フェイズが切り替わるたびに次のフェイズへ持ち越さずクリアする
      // （c._dodgeActionUsedと同じライフサイクル）。
      c._defenseHpValueThisTurn = null;
      // R2 遺物効果「2Hit攻擊的達人（武器種類）」：「戰鬥階段／額外階段」ごとに1回まで。
      c._twoHitMasteryUsedThisPhase = false;
      // R1「技藝強化（攻擊力提升）」「能力強化（魔術之地）」：どちらも「直到階段結束為止」の
      // 自身限定バフのため、フェイズ切替の都度リセットする。
      c._finaleAttackBuffActive = false;
      c._elementalControlMagicBonusActive = false;
      // 附帶効果「疾跑時發生火焰」：行動階段（本アプリではフェイズ全般）ごとに1回のみ。
      c._sprintFireUsedThisPhase = false;
      // R1「技能強化（纏火）」：「行動後直到結束階段為止」の一時的な武器屬性タグなので、
      // フェイズ切替の都度、付与した本人の分だけ剥がす（他の恒常的なweaponAttributeTagsは
      // 別経路で管理されるため影響しない）。
      if (c._clawShotFireTagWeaponId && c.weaponAttributeTags) {
        delete c.weaponAttributeTags[c._clawShotFireTagWeaponId];
        c._clawShotFireTagWeaponId = null;
      }
      // 復仇者「靈體傷害」：行動階段・特殊階段ごとに1回だけ（規則書の「各自動發生1次」に対応）。
      c._spiritDamageUsedThisPhase = false;
      // 守護者「高防禦」（本フェイズが終わるまで持続）と「旋風」（本フェイズにつき1回まで）は
      // どちらもフェイズ切替の都度リセットする。無賴漢「逆襲」をDefenseとして使用した後の
      // 「他の格擋を使用できない」ロックも同様に、フェイズ切替の都度リセットする。
      c._highGuardActive = false;
      c._whirlwindUsedThisPhase = false;
      c._counterattackDefenseUsed = false;
      // 執行者「坩堝諸相・獸」：「階段結束まで」＝発動したフェイズ限定のため、フェイズ切替の
      // 都度リセットする（血魂之歌のbattle全体フラグとは異なりキャラごとのフラグ）。
      c._crucibleBeastActive = false;
      // 隱者「聖幕」（混成魔法の遺物効果）：「フェイズ終了まで」限定のFP消耗無効バフ。
      c._sacredCurtainActive = false;
      // R1続き：「連續攻擊時□□」系（體力回復／FP回復／總合傷害）と「130傷害回復」系は、いずれも
      // 「1次行動階段中」限定の集計のため、フェイズ切替の都度リセットする。送葬人「技藝強化
      // （攻擊力強化）」の自身限定バフも「階段結束まで」限定で同様にリセットする。
      c._attackDiceConsumedThisPhase = 0;
      c._consecutiveDamageBonusGranted = 0;
      c._staminaRecoveryOfferedThisPhase = false;
      c._fpRecoveryAppliedThisPhase = false;
      c._hpRecoveryAppliedThisPhase = false;
      c._daggerTwoHitCountThisPhase = 0;
      c._phaseDamageDealt = 0;
      c._phaseGuardReductionPoints = 0;
      c._phaseGuardSymbols = [];
      c._phaseAttributeGains = {};
      c._phaseSpecialNotes = [];
      c._ominousStrikeBuffActive = false;
      // 消耗品「勇者的肉塊」／「調香瓶｜高揚之香」（直到結束階段為止的攻擊/戰技傷害buff）と
      // 「塗脂」（直到結束階段為止的武器屬性／盾防禦強化）は、いずれもフェイズ切替の都度リセット。
      c._heroMeatBuffLevel = 0;
      c._greaseWeaponId = null;
      c._greaseElementRef = null;
      c._greaseShieldId = null;
      c._guardValueBonusUntilEndPhase = 0;
      c._guardValueBonusConsumed = false;
      delete rosterDiceRollFeedback[c.id];
    });
    // 額外・防禦行動へ入るときは、各角色の確定行動（点線枠）を一旦全てクリアする。
    if (phase === "extra" || phase === "defense") {
      clearAllPendingActionBoxes();
    }
    // 附帶効果「物理減傷+」：防禦フェイズ開始時、自動的に執行紀錄の先頭（他のPC操作より上位）
    // へ本文をリマインドとして常駐させる（数値計算はGM/玩家が把握済みの前提で反映）。
    if (phase === "defense") {
      rosterCharacters.forEach(function (c) {
        if (!c.entered || (c.learnedAttachedEffects || []).indexOf("phys_cut") === -1) return;
        var physCutEffect = CharacterDrawer.attachedEffectById ? CharacterDrawer.attachedEffectById("phys_cut") : null;
        if (!c.pendingActionBoxes) c.pendingActionBoxes = [];
        c.pendingActionBoxes.unshift({
          id: "pc" + Date.now() + Math.floor(Math.random() * 1000),
          title: window.I18N.t("attached_effect_label_phys_cut"),
          total: null,
          lines: physCutEffect ? [CharacterTypes.localizedText(physCutEffect.body)] : [],
        });
      });
    }
    saveRosterCharacters();
    saveState();
    closeActionPhaseModal();
    // 敵人體崩／擊破の長時間公告は、GMが実際に行動階段を切り替えた時点で役目を終える
    // （額外階段へ進む、あるいは戦闘終了で一般階段へ戻る、いずれも「切替」なのでここで閉じる）。
    closeEnemyRowStatusBanner();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderCharacterRoster();
    renderCurrentLocationStatus();
    if (opts.combatEnd) {
      // 復仇者「死靈術」で召喚した死靈は、靈體と異なりHPを維持せず戦闘終了時に全て消滅する
      // （「戰鬥結束時自動從劇本中移除」）。靈體（c.spiritSummon／spiritSummonHp）はここでは
      // クリアしない（目前HP維持のまま自動的に姿を消すのみで、再召喚時にHPを引き継ぐため）。
      rosterCharacters.forEach(function (c) {
        c.deathSpirits = [];
        // 執行者「不撓」：戦闘終了までの持続スタックのため、戦闘終了のタイミングでクリアする。
        c._unyieldingStacks = 0;
        // 送葬人（黎明）「祈禱輔助強化火力提升」：「火力提升」狀態も持續至戰鬥結束為止のため、
        // 同じタイミングでクリアする。
        c._prayerFirepowerActive = false;
      });
      // 使用者確認：「敵人傷害」執行紀錄（紅框）は戦闘が完全に終了した時点でも必ず消す
      // （通常戦闘・簡易戰鬥のどちらも setActionPhase("normal", { combatEnd: true }) を通る）。
      clearEnemyDamageActionBoxes();
      // 戦闘終了時、敵人への屬性/異常蓄積・亂戰傷害修正値も残留させず全消去する
      // （次の戦闘で選ばれる敵人と無関係の古いデータが残り続けるのを防ぐ）。
      state.battle.attributeStatus = defaultBattleState().attributeStatus;
      state.battle.enemyDmgOverride = {};
      // 自動化GM 戰鬥自動化：通常/簡易戰鬥判定は戰鬥級の生命週期（回合をまたいで持続）のため、
      // phase reset loopではなくこの戰鬥終了処理でのみクリアする。
      state.battle.combatMode = null;
      state.battle.combatIsBoss = false;
      // 使用者確認：「1段1回だけ體勢崩し」の記録は戰鬥単位の生命週期のため、ここで一緒に
      // クリアする（次の戦闘で改めて0から数える）。
      state.battle.staggerRowsHandled = [];
      addLog("log_battle_combat_end");
      // 自動化GM Phase 2［戰鬥機制］：樓層敘述中の「雜兵戰鬥／王戰」ボタンから開始した戦闘が
      // ここで終結を検出された場合（state.gmFlow.battleWaitActive）、GMの手動操作なしで
      // ［戰鬥結束］＝規則書敘述の続きへ自動的に進める。無関係の戦闘（樓層敘述と無関係にGMが
      // 手動編成した戦闘等）ならnotifyCombatEnded側で無視される。
      if (window.PriTestNightGmFlow && window.PriTestNightGmFlow.notifyCombatEnded) {
        window.PriTestNightGmFlow.notifyCombatEnded();
      }
      // 強敵チット専用の戦闘（chipCombatSlot、樓層敘述のbattleWaitActiveとは独立系統）が
      // 進行中ならこちらも並行して検出する——notifyCombatEnded同様、無関係なら内部で無視される。
      if (window.PriTestNightGmFlow && window.PriTestNightGmFlow.notifyChipCombatEnded) {
        window.PriTestNightGmFlow.notifyChipCombatEnded();
      }
    } else {
      addLog("log_action_phase_change", { phase: window.I18N.t("action_phase_" + phase) });
    }
  }

  function openBattleDrawer() {
    document.getElementById("battle-drawer").classList.add("open");
  }

  function closeBattleDrawer() {
    document.getElementById("battle-drawer").classList.remove("open");
  }

  // 流浪祝福・鍛造石・石劍鑰匙・恩寵を、時間消耗表（#threat-drawer）から切り離した専用ドロワー。
  // 中身のrender関数（renderWanderingBlessing等）はidベースでDOMのどこにあっても動くため変更不要。
  function openBagDrawer() {
    document.getElementById("bag-drawer").classList.add("open");
  }

  function closeBagDrawer() {
    document.getElementById("bag-drawer").classList.remove("open");
  }

  // ============================================================
  // 商人イベントチット：ルーン1消費で「装備品の購入（武器：★、全カテゴリ完全ランダム）」
  // または「消耗品の購入（下記5種から任意で1個）」のいずれかを行える。
  // ============================================================
  var MERCHANT_CONSUMABLE_IDS = [
    "item_warming_stone",
    "item_turtle_neck_pickle",
    "item_throwing_pot",
    "item_shard_of_starlight",
    "item_throwing_dagger",
  ];
  var merchantSelectedCharacterId = null;
  var merchantLastWeaponResult = null; // { categoryId, rarity, item, weaponId } | null

  function openMerchantModal() {
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;
    if (
      !entered.some(function (c) {
        return c.id === merchantSelectedCharacterId;
      })
    ) {
      merchantSelectedCharacterId = entered[0].id;
    }
    merchantLastWeaponResult = null;
    document.getElementById("merchant-modal").hidden = false;
    renderMerchantModal();
  }

  function closeMerchantModal() {
    document.getElementById("merchant-modal").hidden = true;
  }

  function renderMerchantModal() {
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    var select = document.getElementById("merchant-character-select");
    select.innerHTML = "";
    entered.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === merchantSelectedCharacterId) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function () {
      merchantSelectedCharacterId = select.value;
      merchantLastWeaponResult = null;
      renderMerchantModal();
    };

    var c = entered.filter(function (rc) {
      return rc.id === merchantSelectedCharacterId;
    })[0];
    var runeLabel = document.getElementById("merchant-rune-label");
    var content = document.getElementById("merchant-modal-content");
    content.innerHTML = "";
    if (!c) {
      runeLabel.textContent = "";
      return;
    }
    runeLabel.textContent = window.I18N.t("merchant_rune_label", { value: c.runes || 0 });
    var canAfford = (c.runes || 0) >= 1;

    var weaponTitle = document.createElement("h5");
    weaponTitle.textContent = window.I18N.t("merchant_weapon_purchase_title");
    content.appendChild(weaponTitle);
    var weaponNote = document.createElement("p");
    weaponNote.className = "threat-ref-body";
    weaponNote.textContent = window.I18N.t("merchant_weapon_purchase_note");
    content.appendChild(weaponNote);
    var weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "primary-btn";
    weaponBtn.textContent = window.I18N.t("merchant_weapon_purchase_button");
    weaponBtn.disabled = !canAfford;
    weaponBtn.addEventListener("click", function () {
      if ((c.runes || 0) < 1) return;
      var result = CharacterDrawer.merchantDrawWeapon(c);
      if (!result) {
        window.alert(window.I18N.t("merchant_weapon_draw_failed"));
        return;
      }
      c.runes -= 1;
      saveRosterCharacters();
      renderCharacterRoster();
      var Weapons = window.PriTestWeapons;
      addLog("log_merchant_weapon_purchase", {
        character: c.name,
        weapon: Weapons.localizedText(result.item.name),
      });
      merchantLastWeaponResult = result;
      renderMerchantModal();
      CharacterDrawer.resolveInventoryOverflow(c, "weapon", function () {
        renderCharacterRoster();
        renderMerchantModal();
      });
    });
    content.appendChild(weaponBtn);
    if (merchantLastWeaponResult) {
      var Weapons2 = window.PriTestWeapons;
      var resultP = document.createElement("p");
      resultP.className = "threat-ref-body weapon-roll-result";
      resultP.textContent = window.I18N.t("merchant_weapon_result", {
        weapon: Weapons2.localizedText(merchantLastWeaponResult.item.name),
        rarity: merchantLastWeaponResult.rarity,
      });
      content.appendChild(resultP);
    }

    var consumableTitle = document.createElement("h5");
    consumableTitle.textContent = window.I18N.t("merchant_consumable_purchase_title");
    content.appendChild(consumableTitle);
    var Consumables = window.PriTestConsumables;
    var consumableRow = document.createElement("div");
    consumableRow.className = "wb-row";
    MERCHANT_CONSUMABLE_IDS.forEach(function (id) {
      var item = Consumables.get(id);
      if (!item) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = Consumables.localizedText ? Consumables.localizedText(item.name) : item.name.zh;
      btn.disabled = !canAfford;
      btn.addEventListener("click", function () {
        if ((c.runes || 0) < 1) return;
        c.runes -= 1;
        if (!c.consumables) c.consumables = [];
        var newInstanceId = window.PriTestCharacterDrawer.makeConsumableInstanceId(id, c);
        c.consumables.push({
          id: newInstanceId,
          itemId: id,
          usesRemaining: item.uses || 1,
        });
        saveRosterCharacters();
        renderCharacterRoster();
        addLog("log_merchant_consumable_purchase", {
          character: c.name,
          item: Consumables.localizedText ? Consumables.localizedText(item.name) : item.name.zh,
        });
        window.PriTestCharacterDrawer.resolveInventoryOverflow(c, "consumable", function () {
          renderCharacterRoster();
          renderMerchantModal();
        });
      });
      consumableRow.appendChild(btn);
    });
    content.appendChild(consumableRow);
  }


  // ============================================================
  // 主選單からの擲骰入手（武器／護符／消耗品）：キャラクター詳細を開かなくても、主選單から
  // 直接「どのキャラクターが受け取るか」を選び、そのキャラクターの擲骰入手UIをこのモーダル内に
  // 直接展開できるようにする。所持上限（武器6／護符2／消耗品4、CharacterDrawer.INVENTORY_MAX）に
  // 達しているキャラクターでも選択自体は可能（取得はできる）。上限を超えた場合は、擲骰確定後に
  // resolveInventoryOverflowが転交／丟棄の選択を求める。
  // ============================================================
  var mainMenuDrawKind = null; // "weapon" | "talisman" | "consumable" | null

  function mainMenuDrawCount(c, kind) {
    return CharacterDrawer.inventoryCount(c, kind);
  }

  function renderMainMenuDrawCharList() {
    var container = document.getElementById("main-menu-draw-char-list");
    container.innerHTML = "";
    var kind = mainMenuDrawKind;
    var max = CharacterDrawer.INVENTORY_MAX[kind];
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    if (!entered.length) {
      var emptyP = document.createElement("p");
      emptyP.className = "threat-ref-body";
      emptyP.textContent = window.I18N.t("main_menu_draw_empty_note");
      container.appendChild(emptyP);
      return;
    }
    entered.forEach(function (c) {
      var count = mainMenuDrawCount(c, kind);
      var full = count >= max;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "roster-char-action-btn main-menu-draw-char-btn";
      btn.textContent = window.I18N.t(full ? "main_menu_draw_full_label" : "main_menu_draw_count_label", {
        name: c.name,
        count: count,
        max: max,
      });
      btn.addEventListener("click", function () {
        closeMainMenuDrawModal();
        openItemDrawModal(kind, c.id);
      });
      container.appendChild(btn);
    });
  }

  function openMainMenuDrawModal(kind) {
    mainMenuDrawKind = kind;
    document.getElementById("main-menu-draw-modal-title").textContent = window.I18N.t("main_menu_draw_title_" + kind);
    renderMainMenuDrawCharList();
    document.getElementById("main-menu-draw-modal").hidden = false;
  }

  function closeMainMenuDrawModal() {
    document.getElementById("main-menu-draw-modal").hidden = true;
  }

  // ============================================================
  // 抽選専用モーダル（武器／護符／消耗品共通）：主選單からの抽選、および場地報酬の
  // 武器ウィザード／消耗品／護符ボタンから共通で使う。潛在之力（window.PriTestNightPotentialPower.openPotentialPowerModal）と
  // 同じ規約：確定後もこのモーダル自体は自動で閉じない（GMが手動で閉じる）。呼び出し元が
  // 場地報酬モーダルの場合は先にminimizeFloorRewardModal()され、GMはこのモーダルを閉じた後、
  // 場地報酬側の「復元」ボタンで手動で戻る。確定後はCharacterDrawer側のresolvedフラグにより
  // 抽選UIが静的な結果表示に固定されるため、このモーダルを再度開いても重複取得はできない。
  // ============================================================
  function openItemDrawModal(kind, characterId, options) {
    var c = rosterCharacters.filter(function (rc) { return rc.id === characterId; })[0];
    var titleKey = kind === "weapon" ? "item_draw_modal_title_weapon" : kind === "talisman" ? "item_draw_modal_title_talisman" : "item_draw_modal_title_consumable";
    document.getElementById("item-draw-modal-title").textContent = window.I18N.t(titleKey, { name: c ? c.name : "" });
    var field = document.getElementById("item-draw-modal-content");
    field.innerHTML = "";
    var opts = options || {};
    var onGranted = opts.onGranted || null;
    if (kind === "weapon") {
      // 場地報酬の武器ウィザード（★数／カテゴリ指定あり）はプリセット付きで起動、
      // 主選單からの武器抽選（指定なし）は「潛在之力か否か」からGMに選ばせる通常の
      // ウィザードとして起動する。
      if (opts.starCount || opts.categoryId || opts.attributeTag) {
        CharacterDrawer.presetWeaponRollForReward(characterId, opts.starCount || 1, opts.categoryId || null, opts.attributeTag || null, field, onGranted);
      } else {
        CharacterDrawer.openWeaponRollInline(field, characterId, onGranted);
      }
    } else if (kind === "talisman") {
      CharacterDrawer.openTalismanRollInline(field, characterId, onGranted);
    } else if (kind === "consumable") {
      CharacterDrawer.openConsumableRollInline(field, characterId, opts.grantCount || 1, onGranted);
    }
    document.getElementById("item-draw-modal").hidden = false;
    document.getElementById("btn-item-draw-modal-restore").hidden = true;
  }

  function closeItemDrawModal() {
    // 確定せずに閉じた場合でもstate.activeDraws側に古い情報が残らないよう、明示的にクリアする
    // （通常は確定時点で自動クリアされるが、GMが確定前にキャンセルするケースの保険）。
    var kind = CharacterDrawer.getLastOpenedRollKind && CharacterDrawer.getLastOpenedRollKind();
    if (kind && window.PriTestDrawStateSync) window.PriTestDrawStateSync.set(kind, null);
    document.getElementById("item-draw-modal").hidden = true;
    document.getElementById("btn-item-draw-modal-restore").hidden = true;
    restoreTurnRewardModalIfMinimized();
  }

  // 縮小/復元は樓層獲得と同じ「モーダルを隠す＋別のスタッキング型固定ボタンを表示」方式。
  function minimizeItemDrawModal() {
    document.getElementById("item-draw-modal").hidden = true;
    document.getElementById("btn-item-draw-modal-restore").hidden = false;
  }

  function restoreItemDrawModal() {
    document.getElementById("btn-item-draw-modal-restore").hidden = true;
    document.getElementById("item-draw-modal").hidden = false;
    CharacterDrawer.refreshActiveRollField();
  }

  // ============================================================
  // 鍛冶村「戦技の鍛冶台」：所持武器1つのランダム戦技1つを選んで再抽選し、新しい戦技を
  // 使うか元の戦技のままにするかを選ぶ。潛在之力と同じ規約でfloor-reward-modalが
  // minimizeされている間に開く。
  // ============================================================
  var weaponSkillRerollCharacterId = null;
  var weaponSkillRerollOnResolvedFn = null;

  function openWeaponSkillRerollModal(characterId, onResolved) {
    weaponSkillRerollCharacterId = characterId;
    weaponSkillRerollOnResolvedFn = onResolved || null;
    renderWeaponSkillRerollModal();
    document.getElementById("weapon-skill-reroll-modal").hidden = false;
  }

  function closeWeaponSkillRerollModal() {
    document.getElementById("weapon-skill-reroll-modal").hidden = true;
    weaponSkillRerollCharacterId = null;
  }

  function weaponSkillSlotLabel(slot) {
    if (slot === "attached") return window.I18N.t("weapon_skill_reroll_slot_attached");
    if (slot === "reverse") return window.I18N.t("weapon_skill_reroll_slot_reverse");
    return "";
  }

  function renderWeaponSkillRerollModal() {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === weaponSkillRerollCharacterId;
    })[0];
    document.getElementById("weapon-skill-reroll-modal-title").textContent = window.I18N.t("weapon_skill_reroll_modal_title", {
      name: c ? c.name : "",
    });
    var content = document.getElementById("weapon-skill-reroll-modal-content");
    content.innerHTML = "";
    if (!c) return;

    var slots = CharacterDrawer.listRerollableWeaponSkillSlots(c);
    if (!slots.length) {
      var emptyP = document.createElement("p");
      emptyP.className = "threat-ref-body";
      emptyP.textContent = window.I18N.t("weapon_skill_reroll_empty_note");
      content.appendChild(emptyP);
      return;
    }

    var select = document.createElement("select");
    slots.forEach(function (s, idx) {
      var currentDisplay = CharacterDrawer.resolveRandomSkillDisplay(s.currentSkillId);
      var opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent =
        s.weaponName +
        (s.slot ? "（" + weaponSkillSlotLabel(s.slot) + "）" : "") +
        window.I18N.t("colon_separator") +
        (currentDisplay ? currentDisplay.name : window.I18N.t("weapon_skill_reroll_unset_note"));
      select.appendChild(opt);
    });
    content.appendChild(select);

    var rerollBtn = document.createElement("button");
    rerollBtn.type = "button";
    rerollBtn.className = "primary-btn";
    rerollBtn.textContent = window.I18N.t("weapon_skill_reroll_button");
    content.appendChild(rerollBtn);

    var resultArea = document.createElement("div");
    content.appendChild(resultArea);

    rerollBtn.addEventListener("click", function () {
      var s = slots[parseInt(select.value, 10)];
      var result = CharacterDrawer.rerollWeaponSkill(c, s.weaponId, s.slot);
      if (!result) return;
      var oldDisplay = CharacterDrawer.resolveRandomSkillDisplay(result.oldSkillId);
      var newDisplay = CharacterDrawer.resolveRandomSkillDisplay(result.newSkillId);
      var oldName = oldDisplay ? oldDisplay.name : window.I18N.t("weapon_skill_reroll_unset_note");
      var newName = newDisplay ? newDisplay.name : window.I18N.t("weapon_skill_reroll_unset_note");

      resultArea.innerHTML = "";
      var resultP = document.createElement("p");
      resultP.className = "threat-ref-body weapon-roll-result";
      resultP.textContent = window.I18N.t("weapon_skill_reroll_result", { old: oldName, new: newName });
      resultArea.appendChild(resultP);

      // 玩家決定前に新舊戰技の詳細敘述を並べて展開比較できるようにする（第5項）。
      function appendSkillDetail(labelKey, display, name) {
        var details = document.createElement("details");
        details.className = "ability-entry";
        details.open = true;
        var summary = document.createElement("summary");
        summary.textContent = window.I18N.t(labelKey) + window.I18N.t("colon_separator") + name + (display && display.kind ? "［" + display.kind + "］" : "");
        details.appendChild(summary);
        if (display && display.body) {
          var bodyP = document.createElement("p");
          bodyP.className = "threat-ref-body";
          bodyP.textContent = display.body;
          details.appendChild(bodyP);
        }
        resultArea.appendChild(details);
      }
      appendSkillDetail("weapon_skill_reroll_old_detail_label", oldDisplay, oldName);
      appendSkillDetail("weapon_skill_reroll_new_detail_label", newDisplay, newName);

      var confirmNewBtn = document.createElement("button");
      confirmNewBtn.type = "button";
      confirmNewBtn.className = "primary-btn";
      confirmNewBtn.textContent = window.I18N.t("weapon_skill_reroll_confirm_new_button");
      confirmNewBtn.addEventListener("click", function () {
        CharacterDrawer.commitWeaponSkillReroll(c, s.weaponId, s.slot, result.newSkillId);
        saveRosterCharacters();
        renderCharacterRoster();
        addLog("log_weapon_skill_reroll", { character: c.name, weapon: s.weaponName, old: oldName, new: newName });
        if (typeof weaponSkillRerollOnResolvedFn === "function") weaponSkillRerollOnResolvedFn();
        closeWeaponSkillRerollModal();
      });
      resultArea.appendChild(confirmNewBtn);

      var keepOldBtn = document.createElement("button");
      keepOldBtn.type = "button";
      keepOldBtn.textContent = window.I18N.t("weapon_skill_reroll_keep_old_button");
      keepOldBtn.addEventListener("click", function () {
        if (typeof weaponSkillRerollOnResolvedFn === "function") weaponSkillRerollOnResolvedFn();
        closeWeaponSkillRerollModal();
      });
      resultArea.appendChild(keepOldBtn);

      rerollBtn.disabled = true;
      select.disabled = true;
    });
  }


  function openAttributeStatusDrawer() {
    document.getElementById("attribute-status-drawer").classList.add("open");
    renderAttributeStatusList();
  }

  function closeAttributeStatusDrawer() {
    document.getElementById("attribute-status-drawer").classList.remove("open");
  }

  // 屬性/異常面板：入場中の各角色ごとに、「受け取った」（手動タグ管理）と「与えた」
  // （攻撃action確定時にrecordAttributeStatusDealtで自動集計、敵人ごとに読み取り専用表示）を描画する。
  function renderAttributeStatusList() {
    var container = document.getElementById("attribute-status-list");
    if (!container) return;
    container.innerHTML = "";
    var Enemies = window.PriTestEnemies;
    var Weapons = window.PriTestWeapons;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    if (!entered.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("attribute_status_no_characters_note");
      container.appendChild(empty);
      return;
    }
    if (!state.battle.attributeStatus) state.battle.attributeStatus = defaultBattleState().attributeStatus;
    var dealt = state.battle.attributeStatus.dealt || {};
    var received = state.battle.attributeStatus.received || {};
    var enemyAccum = state.battle.attributeStatus.enemyAccum || {};

    // --- 選択中の敵人ごとの現在蓄積（全角色合算・閾値到達で自動發動）を先頭に一覧表示する ---
    var summaryTitle = document.createElement("h4");
    summaryTitle.textContent = window.I18N.t("attribute_status_enemy_summary_title");
    container.appendChild(summaryTitle);
    var enemyOptions = resolveSelectedEnemyOptions();
    if (!enemyOptions.length) {
      var noEnemy = document.createElement("p");
      noEnemy.className = "threat-ref-body";
      noEnemy.textContent = window.I18N.t("attribute_status_enemy_summary_empty_note");
      container.appendChild(noEnemy);
    } else {
      enemyOptions.forEach(function (opt) {
        var parts = Object.keys(enemyAccum)
          .filter(function (key) {
            return key.indexOf(opt.key + "|") === 0;
          })
          .map(function (key) {
            var label = key.slice(opt.key.length + 1);
            var threshold = attributeStatusThresholdForEnemy(opt.key, label);
            return label + "：" + enemyAccum[key] + "／" + threshold;
          });
        var p = document.createElement("p");
        p.className = "threat-ref-body";
        p.textContent = opt.name + "　" + (parts.length ? parts.join("、") : window.I18N.t("attribute_status_dealt_empty_note"));
        container.appendChild(p);
      });
    }

    entered.forEach(function (c) {
      var block = document.createElement("div");
      block.className = "roster-character-block attribute-status-char-block";
      var h4 = document.createElement("h4");
      h4.textContent = c.name;
      block.appendChild(h4);

      // --- 受け取った屬性/異常（GMが手動管理。自動計算する元データが無いため） ---
      var receivedTitle = document.createElement("h5");
      receivedTitle.textContent = window.I18N.t("attribute_status_received_title");
      block.appendChild(receivedTitle);
      var receivedList = document.createElement("div");
      receivedList.className = "tag-list";
      var receivedMap = received[c.id] || {};
      Object.keys(receivedMap).forEach(function (label) {
        var value = receivedMap[label];
        if (!value) return;
        var threshold = ATTRIBUTE_STATUS_BASE_THRESHOLD;
        var chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = label + "（" + value + "／" + threshold + "）";
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "tag-remove";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", function () {
          removeReceivedAttributeStatus(c.id, label);
        });
        chip.appendChild(removeBtn);
        receivedList.appendChild(chip);
      });
      block.appendChild(receivedList);

      var addRow = document.createElement("div");
      addRow.className = "wb-row";
      var typeSelect = document.createElement("select");
      ATTRIBUTE_STATUS_ELEMENT_OPTIONS.concat(ATTRIBUTE_STATUS_AILMENT_OPTIONS).forEach(function (opt) {
        var o = document.createElement("option");
        o.value = Weapons ? Weapons.localizedText(opt) : opt.zh;
        o.textContent = o.value;
        typeSelect.appendChild(o);
      });
      addRow.appendChild(typeSelect);
      var valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.className = "stat-input";
      valueInput.placeholder = window.I18N.t("attribute_status_value_placeholder");
      addRow.appendChild(valueInput);
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = window.I18N.t("attribute_status_add_button");
      addBtn.addEventListener("click", function () {
        var value = Number(valueInput.value) || 0;
        addReceivedAttributeStatus(c.id, typeSelect.value, value);
      });
      addRow.appendChild(addBtn);
      block.appendChild(addRow);

      // --- 与えた屬性/異常（攻撃action確定時に自動集計、敵人ごとの読み取り専用） ---
      var dealtTitle = document.createElement("h5");
      dealtTitle.textContent = window.I18N.t("attribute_status_dealt_title");
      block.appendChild(dealtTitle);
      var byEnemy = {};
      Object.keys(dealt).forEach(function (key) {
        var parts = key.split("|");
        if (parts[0] !== c.id) return;
        var label = parts[parts.length - 1];
        var enemyKey = parts.slice(1, parts.length - 1).join("|");
        if (!byEnemy[enemyKey]) byEnemy[enemyKey] = {};
        byEnemy[enemyKey][label] = dealt[key];
      });
      var enemyKeys = Object.keys(byEnemy);
      if (!enemyKeys.length) {
        var noDealt = document.createElement("p");
        noDealt.className = "threat-ref-body";
        noDealt.textContent = window.I18N.t("attribute_status_dealt_empty_note");
        block.appendChild(noDealt);
      } else {
        enemyKeys.forEach(function (enemyKey) {
          var parts = enemyKey.split("|");
          var info = Enemies ? Enemies.get(parts[0], parts[1]) : null;
          var enemyName = info ? Enemies.localizedText(info.enemy.name) + "（Lv." + parts[2] + "）" : enemyKey;
          var totalsText = Object.keys(byEnemy[enemyKey])
            .map(function (label) {
              return label + "：" + byEnemy[enemyKey][label];
            })
            .join("、");
          var enemyP = document.createElement("p");
          enemyP.className = "threat-ref-body";
          enemyP.textContent = enemyName + "　" + totalsText;
          block.appendChild(enemyP);
        });
      }

      container.appendChild(block);
    });
  }

  // 戦闘盤の簡易エネミー検索。規則書タブと異なり、等級・HP量・系別のみを表示する（耐性・アクション・特殊能力は非表示）。
  function renderBattleEnemySearchResults() {
    var input = document.getElementById("battle-enemy-search-input");
    var results = document.getElementById("battle-enemy-search-results");
    var Enemies = window.PriTestEnemies;
    if (!input || !results || !Enemies) return;
    var q = input.value.trim();
    results.innerHTML = "";
    if (!q) {
      results.hidden = true;
      return;
    }
    var matches = Enemies.search(q);
    if (!matches.length) {
      results.hidden = true;
      return;
    }
    matches.slice(0, 20).forEach(function (row) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "weapon-search-item";
      btn.textContent = Enemies.localizedText(row.enemy.name) + "（" + Enemies.localizedText(row.familyName) + "）";
      btn.addEventListener("click", function () {
        input.value = "";
        results.hidden = true;
        renderBattleEnemyLookupResult(row);
      });
      results.appendChild(btn);
    });
    results.hidden = false;
  }

  function renderBattleEnemyLookupResult(row) {
    var container = document.getElementById("battle-enemy-lookup-result");
    var Enemies = window.PriTestEnemies;
    if (!container || !Enemies) return;
    container.innerHTML = "";
    var T = Enemies.localizedText;

    var title = document.createElement("p");
    title.className = "boss-subheading";
    title.textContent = T(row.enemy.name);
    container.appendChild(title);

    var familyLine = document.createElement("p");
    familyLine.className = "threat-ref-body";
    familyLine.textContent = window.I18N.t("enemy_family_label") + window.I18N.t("colon_separator") + T(row.familyName);
    container.appendChild(familyLine);

    var weakness = extractWeakness(row.enemy.special, T);
    if (weakness) {
      var weaknessLine = document.createElement("p");
      weaknessLine.className = "threat-ref-body";
      weaknessLine.textContent = window.I18N.t("enemy_weakness_label") + window.I18N.t("colon_separator") + weakness;
      container.appendChild(weaknessLine);
    }

    container.appendChild(window.PriTestNightRulebook.buildEnemyLevelTable(row.familyBase));

    var addRow = document.createElement("div");
    addRow.className = "wb-row";
    var levelLabel = document.createElement("label");
    levelLabel.textContent = window.I18N.t("enemy_level_label");
    var maxLevel = (row.familyBase || []).length || 15;
    var levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.className = "stat-input";
    levelInput.min = "1";
    levelInput.max = String(maxLevel);
    levelInput.value = "1";
    levelLabel.appendChild(levelInput);
    addRow.appendChild(levelLabel);

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary-btn";
    addBtn.textContent = window.I18N.t("battle_enemy_add_button");
    addBtn.addEventListener("click", function () {
      var level = Math.max(1, Math.min(maxLevel, Number(levelInput.value) || 1));
      addEnemyToBattle(row, level);
    });
    addRow.appendChild(addBtn);
    container.appendChild(addRow);
  }

  // 戦場（state.battle.selectedEnemyIds）へエネミーを1体追加する共通処理。
  // row: Enemies.get/search が返す{familyId, familyName, familyBase, enemy}の形。
  // 手動の[追加]ボタン（renderBattleEnemyLookupResult）と、自動化GM Phase 2の
  // 「雜兵戰鬥」ボタン（night_gm_flow.js、window.PriTestNightCore経由）の両方から呼ばれる。
  // 戻り値: {key, added}（addedは既に同じキーが選択済みでスキップした場合false）。
  function addEnemyToBattle(row, level) {
    var maxLevel = (row.familyBase || []).length || 15;
    level = Math.max(1, Math.min(maxLevel, Number(level) || 1));
    var key = row.familyId + "|" + row.enemy.id + "|" + level;
    if (state.battle.selectedEnemyIds.indexOf(key) !== -1) return { key: key, added: false };
    var isFreshEncounter = state.battle.selectedEnemyIds.length === 0;
    state.battle.selectedEnemyIds.push(key);
    if (isFreshEncounter) {
      applyInitialPassiveAggro();
      // 新規遭遇の最初の1体に限り、そのレベルのHP枠表記（例："×7/×7"）から
      // 第1段・第2段の実際の最大HPを記録し、残りHP（チェック数）を満タン初期化する
      // （既存の戦闘中に追加する2体目以降は、既に設定済みの最大値／チェック数を
      // 壊さないよう対象にしない）。
      var lvRow = (row.familyBase || []).filter(function (lv) {
        return lv.level === level;
      })[0];
      var hpNotation = lvRow && lvRow.hp ? parseEnemyHpNotation(lvRow.hp) : null;
      if (hpNotation) {
        state.battle.enemyHpMax[0] = hpNotation.row1;
        state.battle.enemyHpMax[1] = hpNotation.row2;
        setEnemyHpRowCount(0, hpNotation.row1);
        setEnemyHpRowCount(1, hpNotation.row2);
        renderEnemyHpGrid();
        handleEnemyHpChanged();
      }
    }
    renderSelectedEnemies();
    addLog("log_battle_enemy_add", { enemy: window.PriTestEnemies.localizedText(row.enemy.name), level: level });
    return { key: key, added: true };
  }

  // 戦場で選択中のエネミー（複数選択可）。合成キー「familyId|enemyId|level」をEnemies.getで解決し、
  // 専用イラスト（未整備の場合は汎用アイコンstrong-enemy.pngで代替）+ 名前 +
  // 等級・血量・種族・体型を公開情報として、戦場面板（スライドインするbattle-drawer）の中と、
  // 盤面（board-grid）の左側の共通地図の空きスペースの2箇所に同じ内容を描画する。
  // 特殊能力欄の「〔弱点:XXX〕公開情報」のような記述から、弱点だけを取り出す（公開情報として戦場に表示するため）。
  function extractWeakness(specialField, T) {
    if (!specialField) return null;
    var text = T(specialField);
    var m = text.match(/〔弱[点點][:：]([^〕]+)〕/);
    return m ? m[1] : null;
  }

  // enemy.specialテキスト中、直後に「公開情報／公開資訊」という語を伴う〔◯◯〕見出しを
  // すべて抽出する（例："〔亡者特効〕公開情報。..."）。docs/combat_flow_rules.md §4の
  // 「追加ルールはあらかじめプレイヤーへ公開しておく」に対応——弱点と同様、公開盤の
  // エネミーchipに常時表示することで、GMが公開情報の提示漏れを防ぐ。
  function extractPublicSpecialNames(specialField, T) {
    if (!specialField) return [];
    var text = T(specialField);
    var names = [];
    var re = /〔([^〕]+)〕([^〔]*)/g;
    var m;
    while ((m = re.exec(text))) {
      if (m[2].indexOf("公開情報") !== -1 || m[2].indexOf("公開資訊") !== -1) {
        names.push(m[1]);
      }
    }
    return names;
  }

  // enemyKeyに割り当てられた行（複数の可能性）がすべて撃破済みかどうかを返す。通常エネミーは
  // 「選択順＝開始行」（enemyHpRowIndexForKey）だが、HP枠表記が2段（例："×5/×4"）の場合は
  // その1体だけで開始行の次の行も占有する——applyOverflowingEnemyDamageのダメージ波及方向
  // （開始行→後続の連続する割当済み行）と同じ規約で、後続行も併せて確認する。開始行だけを
  // 見て「撃破」表示すると、2段目以降がまだ残っているのに戦場面板が誤って撃破（打X）表示に
  // なってしまう（ユーザー報告：全HPを0にしたのに自動化GMが戦闘終了を検知しない、の原因）。
  function isEnemyFullyDepletedAtRow(startRowIdx) {
    if (startRowIdx === -1) return false;
    var any = false;
    for (var r = startRowIdx; r < ENEMY_HP_ROWS; r++) {
      if (!enemyHasRow(r)) break;
      any = true;
      if (!isEnemyHpRowDepleted(r)) return false;
    }
    return any;
  }

  function renderSelectedEnemies() {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return;
    var T = Enemies.localizedText;
    var ids = (state.battle && state.battle.selectedEnemyIds) || [];
    var resolved = ids
      .map(function (key) {
        // 夜の王（"boss|<id>"）は通常エネミーとは別データ源（night_boss_rulebook.js）の
        // ため、Enemies.get()では解決できない——ここで解決できないとfilter(Boolean)で
        // 黙って消え、戦場面板から夜の王が丸ごと欠落する（ユーザー報告の原因）。
        if (isBossAttackKey(key)) {
          var bossInfo = window.PriTestBossRulebook ? window.PriTestBossRulebook.get(key.slice(5)) : null;
          return bossInfo ? { key: key, boss: bossInfo } : null;
        }
        var parts = key.split("|");
        var info = Enemies.get(parts[0], parts[1]);
        var level = Math.max(1, Number(parts[2]) || 1);
        return info ? { key: key, info: info, level: level } : null;
      })
      .filter(Boolean);

    var boardSideHp = document.getElementById("board-side-enemy-hp");
    if (boardSideHp) boardSideHp.hidden = resolved.length === 0;
    if (typeof renderBattlePositionAreas === "function") renderBattlePositionAreas();
    renderBattleGuardCalc();

    [
      { containerId: "battle-selected-enemies", withRemove: true },
      { containerId: "board-side-enemies", withRemove: false },
    ].forEach(function (target) {
      var container = document.getElementById(target.containerId);
      if (!container) return;
      container.innerHTML = "";
      container.hidden = resolved.length === 0;
      resolved.forEach(function (item) {
        var chip = document.createElement("div");
        var itemRowIdx = enemyHpRowIndexForKey(item.key);
        chip.className = "selected-enemy-chip" + (isEnemyFullyDepletedAtRow(itemRowIdx) ? " enemy-row-depleted" : "");
        chip.style.cursor = "pointer";
        // 夜の王：戦場面板には自動編入されるが（ensureNight3BossInBattle）、通常エネミーと
        // 違いGMが手動で外せる存在ではないため、専用の簡略表示のみ行い×ボタンは出さない。
        if (item.boss) {
          chip.addEventListener("click", function () {
            openRulebookToEntry("nightking", "boss-entry-" + item.boss.id);
          });
          var bossIcon = document.createElement("img");
          bossIcon.className = "selected-enemy-icon";
          var bossImg = window.PriTestNightBosses ? window.PriTestNightBosses.get(item.boss.id) : null;
          bossIcon.src = (bossImg && window.PriTestNightBosses.imagePath(bossImg)) || "../static/images/icons/strong-enemy.png";
          bossIcon.alt = "";
          chip.appendChild(bossIcon);
          var bossInfoEl = document.createElement("div");
          bossInfoEl.className = "selected-enemy-info";
          var bossName = document.createElement("span");
          bossName.className = "selected-enemy-name";
          bossName.textContent = window.PriTestFields.localizedText(item.boss.name);
          bossInfoEl.appendChild(bossName);
          var bossStatLine = document.createElement("span");
          bossStatLine.className = "selected-enemy-stats";
          bossStatLine.textContent = [
            window.I18N.t("enemy_level_label") + window.I18N.t("colon_separator") + item.boss.level,
            window.PriTestFields.localizedText(item.boss.size),
          ].join("　");
          bossInfoEl.appendChild(bossStatLine);
          chip.appendChild(bossInfoEl);
          container.appendChild(chip);
          return;
        }
        chip.addEventListener("click", function () {
          var parts = item.key.split("|");
          openRulebookToEntry("enemy", "enemy-entry-" + parts[0] + "-" + parts[1]);
        });
        var icon = document.createElement("img");
        icon.className = "selected-enemy-icon";
        icon.src = Enemies.imagePath(item.info.enemy) || "../static/images/icons/strong-enemy.png";
        icon.alt = "";
        chip.appendChild(icon);
        var info = document.createElement("div");
        info.className = "selected-enemy-info";
        var name = document.createElement("span");
        name.className = "selected-enemy-name";
        name.textContent = T(item.info.enemy.name);
        info.appendChild(name);
        var statLine = document.createElement("span");
        statLine.className = "selected-enemy-stats";
        var lvRow = (item.info.familyBase || []).filter(function (lv) {
          return lv.level === item.level;
        })[0];
        var statParts = [
          window.I18N.t("enemy_level_label") + window.I18N.t("colon_separator") + item.level,
          T(item.info.familyName),
          item.info.enemy.size || "-",
        ];
        if (lvRow && lvRow.hp) {
          statParts.push(window.I18N.t("enemy_hp_label") + window.I18N.t("colon_separator") + lvRow.hp);
        }
        if (target.withRemove && lvRow && lvRow.dmg != null && state.turnHolder === "gm") {
          var dmgOverride = (state.battle.enemyDmgOverride && state.battle.enemyDmgOverride[item.key]) || 0;
          var dmgText = dmgOverride
            ? window.I18N.t("attribute_status_dmg_override_note", { value: lvRow.dmg + dmgOverride, base: lvRow.dmg, delta: dmgOverride })
            : String(lvRow.dmg);
          statParts.push(window.I18N.t("enemy_melee_damage_label") + window.I18N.t("colon_separator") + dmgText);
        }
        var weakness = extractWeakness(item.info.enemy.special, T);
        if (weakness) {
          statParts.push(window.I18N.t("enemy_weakness_label") + window.I18N.t("colon_separator") + weakness);
        }
        var publicSpecials = extractPublicSpecialNames(item.info.enemy.special, T);
        if (publicSpecials.length) {
          statParts.push(window.I18N.t("enemy_public_special_label") + window.I18N.t("colon_separator") + publicSpecials.join("、"));
        }
        statLine.textContent = statParts.join("　");
        info.appendChild(statLine);
        chip.appendChild(info);
        if (target.withRemove) {
          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "tag-remove";
          removeBtn.textContent = "×";
          removeBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            var idx = state.battle.selectedEnemyIds.indexOf(item.key);
            if (idx !== -1) {
              state.battle.selectedEnemyIds.splice(idx, 1);
              purgeAttributeStatusForEnemyKey(item.key);
              if (state.battle.autoGmMobPresentSnapshot) delete state.battle.autoGmMobPresentSnapshot[item.key];
              if (state.battle.guardCount) delete state.battle.guardCount[item.key];
              resetBattlePositionsAndAggro();
              renderSelectedEnemies();
              addLog("log_battle_enemy_remove", { enemy: T(item.info.enemy.name), level: item.level });
            }
          });
          chip.appendChild(removeBtn);
        }
        container.appendChild(chip);
      });
    });
  }

  function renderFieldLevels() {
    var levels = fieldLevelsForDay();
    levels.forEach(function (n, i) {
      var el = document.getElementById("field-level-" + i);
      var value = "±" + n;
      el.innerHTML = "";
      var main = document.createElement("span");
      main.className = "field-level-main";
      main.textContent = value;
      var sub = document.createElement("span");
      sub.className = "field-level-sub";
      sub.textContent = window.I18N.t("field_level_note", { value: value });
      el.appendChild(main);
      el.appendChild(sub);
    });
  }

  // #20：目前所在位置（focusedIndex）とその樓層情報を、日常のヘッダー小文字ではなく、
  // 画面右上に常に貼り付く専用バナーで表示する（鵝黃色、閉じるボタンは持たない——GMの
  // 現在地表示は戦闘のstagger通知等と違い、常に存在し続けるべき情報のため）。折りたたみ時は
  // 樓層名だけの小さなブロックに、展開時は樓層數・全效果に加えて将来の自動GM文字/選択肢を
  // 置ける余白を持つ。折りたたみ状態はstate.locationBannerCollapsedで永続化する。
  var locationBannerToggleLongPressFired = false; // 長押しでコーナー切替した直後、続く合成clickで折りたたみが誤って切り替わらないようにする

  function handleLocationBannerToggleClick() {
    if (locationBannerToggleLongPressFired) {
      locationBannerToggleLongPressFired = false;
      return;
    }
    state.locationBannerCollapsed = !state.locationBannerCollapsed;
    saveState();
    renderCurrentLocationStatus();
  }

  function setLocationBannerCorner(corner) {
    if (state.locationBannerCorner === corner) return;
    state.locationBannerCorner = corner;
    saveState();
    renderCurrentLocationStatus();
  }

  // #25：専用の◀／▶ボタン（第24項）は他ウィンドウの×ボタン等を隠してしまうとの指摘で撤回。
  // 代わりに既存の▼／▲トグルボタンを流用し、折りたたみ時のみ長押し（SLOT_LONG_PRESS_MS、
  // 板塊の長押し判定と同じ作法）で左右のコーナーを切り替える——短押しは従来通り折りたたみ／
  // 展開の切替のまま。展開中は長押ししても何も起きない（対象外、との指定）。
  function attachLocationBannerToggleLongPress(btn) {
    var pressTimer = null;
    btn.addEventListener("pointerdown", function () {
      if (!state.locationBannerCollapsed) return;
      locationBannerToggleLongPressFired = false;
      pressTimer = setTimeout(function () {
        locationBannerToggleLongPressFired = true;
        setLocationBannerCorner(state.locationBannerCorner === "left" ? "right" : "left");
      }, SLOT_LONG_PRESS_MS);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (evt) {
      btn.addEventListener(evt, function () {
        clearTimeout(pressTimer);
      });
    });
  }

  // 板塊の場地カードの「真正該劇本の名稱」を解決する。scenario.day1/day2に記録されている
  // 実際の表示名（例：「大野營地（1）」——同じrankでもスート違いで内容が変わるため、
  // fields.jsの汎用参考データの名前より優先する）。renderSlotEffect()と同じ
  // dayKey/otherDayKeyフォールバックパターンを踏襲する。scenarioが無い、または該当が
  // 見つからない場合（起點／終點の板塊など、day1/day2に登録が無い位置を含む）はnullを返し、
  // 呼び出し側でfields.jsの汎用名にフォールバックする。
  function resolveScenarioTrueNameEffect(idx) {
    if (!scenario || typeof idx !== "number") return null;
    var slot = state.slots[idx];
    if (!slot) return null;
    var slotCard = CARD_BY_CODE[slot.code];
    if (!slotCard) return null;
    var dayKey = isSwappedDay() ? "day2" : "day1";
    var otherDayKey = dayKey === "day2" ? "day1" : "day2";
    return (
      Scenarios.findCardEffect(game.scenarioId, dayKey, slotCard.suit, slotCard.rank) ||
      Scenarios.findCardEffect(game.scenarioId, otherDayKey, slotCard.suit, slotCard.rank)
    );
  }

  function resolveScenarioTrueName(idx) {
    var effect = resolveScenarioTrueNameEffect(idx);
    return effect ? Scenarios.localizedName(effect.name) : null;
  }

  // resolveScenarioTrueNameの言語非依存版：現在の表示言語に関わらず判定用の日本語原文で
  // 照合したい呼び出し元（night_gm_flow.jsのresolveDiceTableHeadingIfAny、フロア内ダイス表
  // 見出しの「劇本固定分岐の自動一致」用）向けに、{ja,zh}の生のnameオブジェクトを返す。
  function resolveScenarioTrueNameRaw(idx) {
    var effect = resolveScenarioTrueNameEffect(idx);
    return effect ? effect.name : null;
  }

  function renderCurrentLocationStatus() {
    var overlay = document.getElementById("location-status-overlay");
    var content = document.getElementById("location-status-content");
    var toggleBtn = document.getElementById("btn-location-status-toggle");
    if (!overlay || !content) return;
    var idx = state.focusedIndex;
    // resolveFieldEntryForSlotはidxが数値の板塊に加え、"start"/"end"（出發地點／終點の板塊）も
    // 解決できる——出發地點にも樓層描写・突破判定があるため、進度版にも表示・操作対象にする。
    var card = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx);
    // 自動化GM Phase 2：ゲーム開始直後の〔開場〕敘述は、まだどの樓層にもフォーカスしていない
    // （card===null）段階で表示する必要があるため、awaitingOk中はcardが無くてもバナーを出す。
    // 開場敘述だけはgmFlowEnabledに関わらず表示する（night_gm_flow.jsのrenderLocationBanner
    // 側の同名バイパスと対になる）。
    var showingUnplayedOpening = state.gmFlow.awaitingOk && !state.gmFlow.openingPlayed;
    var showForGmFlow = (state.gmFlowEnabled && state.gmFlow.awaitingOk) || showingUnplayedOpening;
    // ユーザー報告：3日目（最終夜）に到達すると、focusedIndexが直前の終點（"end"＝黄金樹の帳）を
    // 指したまま残るため、[開啟夜王戰鬥]を押してゲートを閉じた後（＝showForGmFlowが再びfalseに
    // 戻った後）に、cardは相変わらず「黄金樹の帳」を指したままのため進度版が復活し、しかも
    // advanceToNextNightがendChecksをリセットしているせいで「未踏破」に見えて再入場
    // （→樓層1の分岐選択）できてしまっていた。3日目にはフィールド探索という概念自体が無いため、
    // 最終夜の案内を表示し終えた後（state.gmFlow.finalDayAnnounced、night_gm_flow.jsの
    // maybeAnnounceFinalDayが一度きり立てるフラグ）は、以後cardを常に無しとして扱い進度版
    // オーバーレイごと隠す。ただしfinalDayAnnounced自体がまだfalseな最初の描画（advance
    // ToFinalNightDirect直後、案内がまだ一度も出ていない段階）まで塞いでしまうと、
    // maybeAnnounceFinalDay自体（renderLocationBanner経由でこの後呼ばれる）が呼ばれず
    // 案内が永久に出せなくなるため、finalDayAnnouncedがtrueになった後だけに限定する。
    if (state.dayNumber >= MAX_DAY && state.gmFlow.finalDayAnnounced && !showForGmFlow) {
      card = null;
    }
    if (!card && !showForGmFlow) {
      overlay.hidden = true;
      return;
    }
    overlay.classList.toggle("collapsed", !!state.locationBannerCollapsed);
    overlay.classList.toggle("corner-left", state.locationBannerCorner === "left");
    if (toggleBtn) {
      toggleBtn.innerHTML = state.locationBannerCollapsed ? "&#9660;" : "&#9650;";
      toggleBtn.title = window.I18N.t(state.locationBannerCollapsed ? "location_banner_expand_label" : "location_banner_collapse_label");
    }
    content.innerHTML = "";
    if (card) {
      var trueName = resolveScenarioTrueName(idx);
      var displayName = trueName || window.PriTestFields.localizedText(card.name);
      var nameSpan = document.createElement("span");
      nameSpan.className = "loc-name";
      // 目前所在樓層改由GM敘述（floorLeadingDescriptionText）直接告知，卡牌名稱後面
      // 不再附加裸數字的樓層編號徽記（避免重複資訊）。
      nameSpan.textContent = displayName;
      content.appendChild(nameSpan);
      if (card.floorCount != null || card.allFloorEffect) {
        var detailParts = [];
        if (card.floorCount != null) {
          detailParts.push(window.I18N.t("field_floor_count_label") + window.I18N.t("colon_separator") + card.floorCount);
        }
        if (card.allFloorEffect) {
          // 進度版は表示幅が狭いため、night_rulebook.js側の規則書パネルで使う正式ラベル
          // （field_all_floor_effect_label＝「全樓層踏破效果」）とは別に、精簡ラベル
          // （field_all_floor_effect_label_compact＝「全踏破」）と数値のみの表記を使う。
          var compactEffectText = compactAllFloorEffectText(window.PriTestFields.localizedText(card.allFloorEffect));
          detailParts.push(window.I18N.t("field_all_floor_effect_label_compact") + window.I18N.t("colon_separator") + compactEffectText);
        }
        var detailSpan = document.createElement("span");
        detailSpan.className = "loc-detail";
        detailSpan.textContent = "（" + detailParts.join("　") + "）";
        content.appendChild(detailSpan);
      }
    }
    if (window.PriTestNightGmFlow) {
      window.PriTestNightGmFlow.renderLocationBanner(idx, card);
    }
    overlay.hidden = false;
  }

  function renderDayStatus() {
    var dayText = window.I18N.t("day_status", { n: state.dayNumber });
    var text = game.name + " " + dayText;
    if (scenario) {
      text += " ・ " + Scenarios.localizedName(scenario.name);
    }
    var el = document.getElementById("day-status");
    el.innerHTML = "";
    el.appendChild(document.createTextNode(text));
    renderCurrentLocationStatus();
    renderSetupInfo();
  }

  function renderSetupInfo() {
    document.getElementById("btn-setup-info").title = window.I18N.t("setup_info_button");
    document.getElementById("setup-info-title").textContent = window.I18N.t("setup_info_button");
    var body = document.getElementById("setup-info-body");
    body.innerHTML = "";
    ["day1", "day2"].forEach(function (dayKey) {
      var h = document.createElement("h4");
      h.textContent = window.I18N.t("setup_info_title_" + dayKey);
      body.appendChild(h);
      window.I18N.t("setup_info_body_" + dayKey)
        .split("\n")
        .forEach(function (line) {
          var p = document.createElement("p");
          p.textContent = line;
          body.appendChild(p);
        });
    });
  }

  function toggleSetupInfo() {
    document.getElementById("setup-info-bubble").hidden = !document.getElementById("setup-info-bubble").hidden;
  }

  function closeSetupInfo() {
    document.getElementById("setup-info-bubble").hidden = true;
  }

  function renderPiles() {
    document.getElementById("board-grid").classList.toggle("swapped", isSwappedDay());
    renderStartPile();
    renderPileButton("pile-end", "end_point_label", state.endSuit);
    document.getElementById("pile-end").classList.toggle("latest", state.focusedIndex === "end");
    renderPileChecks("end", state.endChecks, false);
  }

  function renderPileButton(id, labelKey, suit) {
    var el = document.getElementById(id);
    SUIT_CLASSES.forEach(function (cls) {
      el.classList.remove(cls);
    });
    var label = window.I18N.t(labelKey);
    el.textContent = suit ? label + " " + SUIT_SYMBOL[suit] : label;
    if (suit) el.classList.add(SUIT_CLASS[suit]);
    el.classList.toggle("active", state.boardStarted);
  }

  function renderStartPile() {
    var el = document.getElementById("pile-start");
    SUIT_CLASSES.forEach(function (cls) {
      el.classList.remove(cls);
    });
    el.classList.remove("defeated");
    if (state.startDefeated) {
      var goalLabel = window.I18N.t("end_point_label");
      var note = window.I18N.t("pile_defeated_note", { day: state.startDefeatedDay });
      el.textContent = (state.startSuit ? goalLabel + " " + SUIT_SYMBOL[state.startSuit] : goalLabel) + " " + note;
      if (state.startSuit) el.classList.add(SUIT_CLASS[state.startSuit]);
      el.classList.add("defeated", "active");
      el.disabled = true;
    } else {
      var label = window.I18N.t("start_point_label");
      el.textContent = state.startSuit ? label + " " + SUIT_SYMBOL[state.startSuit] : label;
      if (state.startSuit) el.classList.add(SUIT_CLASS[state.startSuit]);
      el.classList.toggle("active", state.boardStarted);
      el.disabled = false;
    }
    el.classList.toggle("latest", state.focusedIndex === "start");
    renderPileChecks("start", state.startChecks, state.startDefeated);
  }

  function renderPileChecks(which, checks, locked) {
    ["one", "all"].forEach(function (field) {
      var el = document.getElementById("pile-check-" + which + "-" + field);
      el.checked = locked ? true : !!checks[field];
      el.disabled = locked;
    });
  }

  function renderCardLevel(index) {
    var el = document.getElementById("level-value-" + index);
    var v = state.cardLevels[index];
    el.textContent = v === null || v === undefined ? window.I18N.t("level_all") : String(v);
  }

  function renderSlotEffect(index) {
    var el = document.getElementById("slot-effect-" + index);
    var slot = state.slots[index];
    if (!el) return;
    el.innerHTML = "";
    if (!slot || !slot.revealed) return;

    if (scenario) {
      var card = CARD_BY_CODE[slot.code];
      var dayKey = isSwappedDay() ? "day2" : "day1";
      // #18：留下的卡牌（submitKeepCards保留至下一天）はstate.dayNumberだけが進み、盤面上の
      // カード自体（suit/rank）はそのまま据え置かれる。そのため「現在の日」のテーブルにしか
      // 無い前提で引くと、前日にだけ登録されていたカードの表示が消えてしまう。現在日で
      // 見つからなければ、もう一方の日のテーブルも試す。
      var otherDayKey = dayKey === "day2" ? "day1" : "day2";
      var effect =
        Scenarios.findCardEffect(game.scenarioId, dayKey, card.suit, card.rank) ||
        Scenarios.findCardEffect(game.scenarioId, otherDayKey, card.suit, card.rank);
      if (effect) {
        var effectLine = document.createElement("div");
        effectLine.textContent = Scenarios.localizedName(effect.name);
        el.appendChild(effectLine);
      }
    }

    var chipId = state.eventChips[index];
    var chipDef = chipId
      ? EVENT_CHIP_TYPES.filter(function (c) {
          return c.id === chipId;
        })[0]
      : null;
    if (chipDef) {
      var chipRow = document.createElement("div");
      chipRow.className = "slot-chip-row";
      if (state.eventChipsUsed[index]) chipRow.classList.add("used");
      var img = document.createElement("img");
      img.className = "slot-chip-icon";
      img.src = "../static/images/icons/" + chipDef.icon;
      img.alt = eventChipDisplayLabel(index);
      var label = document.createElement("span");
      label.textContent = eventChipDisplayLabel(index);
      chipRow.appendChild(img);
      chipRow.appendChild(label);
      if (chipId === "merchant") {
        chipRow.style.cursor = "pointer";
        chipRow.addEventListener("click", openMerchantModal);
      } else if (chipId === "strong_enemy") {
        // ユーザー指定：公開盤上の強敵籌碼は、點擊すると小さな氣泡で既に決定済みの強敵名を
        // 表示する（既存setup-info-bubbleと同じ「クリックで表示・外側クリックで閉じる」
        // 仕組みを、盤面9マス分すべてに使い回せるよう1つの共用bubble要素を動的に位置合わせ
        // して再利用する）。撃破済み（state.eventChipsUsed[index]）は上のchipRow.classList
        // .add("used")で暗転＋取り消し線が自動適用される（.slot-chip-row.used、style.css）。
        chipRow.style.cursor = "pointer";
        chipRow.addEventListener("click", function (e) {
          e.stopPropagation();
          showStrongEnemyInfoBubble(index, chipRow);
        });
      }
      el.appendChild(chipRow);
    }
  }

  // 強敵チットの公開盤氣泡：state.eventChipsData[index].enemyNameがまだ無ければ
  // （＝オファー時の自動擲骰がまだ発生していない、通常は起こらないが念のため）簡易メッセージに
  // フォールバックする。既に開いている状態でもう一度押すと閉じる（トグル）。
  function showStrongEnemyInfoBubble(index, anchorEl) {
    var bubble = document.getElementById("strong-enemy-info-bubble");
    if (!bubble) return;
    if (!bubble.hidden && bubble.dataset.slotIndex === String(index)) {
      bubble.hidden = true;
      return;
    }
    var data = state.eventChipsData[index];
    var body = document.getElementById("strong-enemy-info-bubble-body");
    body.textContent = data && data.enemyName ? data.enemyName : window.I18N.t("event_chip_strong_enemy_not_decided_note");
    bubble.dataset.slotIndex = String(index);
    // position:fixed（style.css）のため、getBoundingClientRectのビューポート座標をそのまま使う
    // （offsetParentの入れ子構造に依存しない、盤面9マスどこでも同じロジックで位置合わせできる）。
    var rect = anchorEl.getBoundingClientRect();
    bubble.style.top = rect.bottom + 4 + "px";
    bubble.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 240)) + "px";
    bubble.hidden = false;
  }

  // #10：樓層カウンターのボタンをそのカード自身の樓層数（floorCount）に合わせる
  // （例：floorCount:2のカードなら 0,1,2,全 のみ。従来は固定で0〜5,全だった）。
  function levelStepsForSlot(index) {
    var entry = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(index);
    var floorCount = entry && typeof entry.floorCount === "number" ? entry.floorCount : 5;
    var steps = [];
    for (var i = 0; i <= floorCount; i++) steps.push(i);
    steps.push(null); // "全"
    return steps;
  }

  function stepCardLevel(index, dir) {
    if (!state.slots[index]) return;
    // 使用者確認（項目1.1）：已經是「全」（全踏破，steps陣列最後一格＝null）時，若再往前
    // （dir>0）推進一次（例如自動化GM流程已推進到「全」後，盤面［＋］又被多按一次），舊邏輯
    // 會用%折返回steps[0]，等於把「全」重設回第一個樓層，導致王戰被重新敘述、無限觸發。
    // 「全」是終端狀態，dir>0時直接維持不變；dir<0（倒退）仍允許從「全」退回最後一個實際樓層。
    if (state.cardLevels[index] === null && dir > 0) return;
    var steps = levelStepsForSlot(index);
    var curIdx = steps.indexOf(state.cardLevels[index]);
    if (curIdx === -1) curIdx = 0;
    var nextIdx = (curIdx + dir + steps.length) % steps.length;
    var nextValue = steps[nextIdx];
    state.cardLevels[index] = nextValue;
    renderCardLevel(index);
    if (state.focusedIndex === index) renderDayStatus();
    saveState();
    if (nextValue === null) {
      // ユーザー報告：盤面の[+]で手動で「全」まで進めた場合、自動化GMの敘述経由
      // （night_gm_flow.jsのfinishFieldWalk）を通らないため、以前はgrantCardFullClearReward
      // IfNeededでルーン/タイムロス付与とGM敘述までは出るものの、続く「籌碼確認→地圖移動」への
      // 自動連鎖（advanceCardConclusionChain、pendingChipCheckSlot/pendingMapMoveSlot依存）が
      // 一切発火せず、そこで詰まってしまうbugがあった（自動戰鬥経由で全樓層踏破した場合は
      // finishFieldWalkが両フラグを設定するため問題なかった）。手動操作でも同じ連鎖に乗せる
      // よう、ここでも同じフラグを予約しておく（gmFlowEnabledでない場合は誰も読まないため
      // 無害だが、grantCardFullClearRewardIfNeeded自身の挙動に合わせてガードしておく）。
      if (state.gmFlowEnabled) {
        state.gmFlow.pendingChipCheckSlot = index;
        state.gmFlow.pendingMapMoveSlot = index;
      }
      grantCardFullClearRewardIfNeeded(index);
    }
  }

  // 「全樓層踏破效果」（例：盧恩：2／時間損耗：1）本文から、該当ラベルの数値を取り出す。
  function parseAllFloorEffectAmount(text, labels) {
    var t = String(text || "");
    for (var i = 0; i < labels.length; i++) {
      var re = new RegExp(labels[i] + "[：:]\\s*([+＋]?\\d+)");
      var m = re.exec(t);
      if (m) return parseInt(m[1].replace(/[＋+]/g, ""), 10) || 0;
    }
    return 0;
  }

  // 進度版の樓層詳細資訊（#location-status-content）用：「全樓層踏破效果」の原文
  // （例："盧恩：2／時間損耗：1"）を、ラベルの繰り返しコロンを省いた精簡表記
  // （例："盧恩2／時間1"）へ変換する。数値を検出できなければ原文をそのまま返す
  // （フォーマットが想定外のカードでも情報を失わないため）。
  function compactAllFloorEffectText(rawText) {
    var runeAmount = parseAllFloorEffectAmount(rawText, ["盧恩", "ルーン"]);
    var timeLossAmount = parseAllFloorEffectAmount(rawText, ["時間損耗", "タイムロス"]);
    var parts = [];
    if (runeAmount) parts.push(window.I18N.t("field_all_floor_effect_rune_compact", { value: runeAmount }));
    if (timeLossAmount) parts.push(window.I18N.t("field_all_floor_effect_time_compact", { value: timeLossAmount }));
    return parts.length ? parts.join("／") : rawText;
  }

  // 「威脅効果決定表」：i18nの roll_effect_*_label 先頭に付いている丸数字（①〜⑥）が
  // そのまま1D6の出目に対応する表記（ユーザー確認済み）。①②の2目が「敵方傷害增加」に
  // 割り当てられている（他は1目ずつ）。
  var THREAT_EFFECT_ROLL_TABLE = ["enemy_damage", "enemy_damage", "enemy_hp", "max_blessing", "attribute_buildup", "flask_uses"];

  // タイムロス軌道の「威脅効果追加」段（TIME_LOSS_ROW_DEFSのkind:"threat"）が新たに埋まった
  // 瞬間に呼ぶ。1D6を振り、上表で対応する骰效果（ROLL_EFFECTS、state.rollEffects）を
  // 1段階分だけ進める——renderRollEffectsの「+」ボタンと全く同じ処理・上限（GMが手で
  // 押した場合と区別しない）。結果はGM留言板・公告へ骰値付きで知らせる。
  function rollAndTriggerThreatEffect() {
    var roll = 1 + Math.floor(Math.random() * 6);
    var effectId = THREAT_EFFECT_ROLL_TABLE[roll - 1];
    var effect = ROLL_EFFECTS.filter(function (e) {
      return e.id === effectId;
    })[0];
    if (!effect) return null;
    var count = state.rollEffects[effectId] || 0;
    var newCount = Math.min(effect.tiers, count + 1);
    state.rollEffects[effectId] = newCount;
    if (effectId === "flask_uses") applyFlaskUsesRollEffect(newCount - count);
    saveState();
    renderRollEffects();
    renderTimeLossSummary();
    var label = window.I18N.t("roll_effect_" + effectId + "_label");
    var detail = window.I18N.t("roll_effect_" + effectId + "_tier" + newCount);
    var msg = window.I18N.t("threat_effect_roll_broadcast", { roll: roll }) + label + window.I18N.t("colon_separator") + detail;
    postSystemTurnMessage(msg);
    showThreatBroadcast([msg]);
    // 自動化GM 戰鬥自動化：進度版（防禦階段開始時のTime Loss+1）から呼ばれた場合、
    // このメッセージも進度版へ打字機で表示できるよう返す。
    return msg;
  }

  // 「時間損耗：N」をタイムロス軌道（TIME_LOSS_ROW_DEFS、現在の日にちに対応する
  // state.timeLoss[dayKey]）へ実際に反映する。物理チェックリストと同じ「先頭から空いている
  // 箱を順にN個チェックする」規則（GMが手でチェックする既存のbuildTimeLossRowsのリスナーと
  // 全く同じstate書き換え）。以前はGM留言板への公告のみで、実際の軌道は更新されていなかった
  // （ユーザー報告のバグ）。「威脅効果追加」段（kind:"threat"）がこの呼び出しで新たに
  // 埋まった場合は、そのままrollAndTriggerThreatEffectで1D6を振って骰效果へ反映する
  // （ユーザー確認済み：①〜⑥の丸数字が出目対応表そのもの）。
  // 使用者確認：戻り値は「今回のaddTimeLossで新たに発生した公告文字」の配列（威脅効果決定表の
  // 抽選結果、夜雨が新しい段階に達した旨）。自動化GM 戰鬥自動化の防禦階段開始時Time Loss+1が
  // 進度版へ打字機で表示するために利用する（既存のGM留言板／公告への投稿はそのまま維持）。
  function addTimeLoss(n) {
    if (!n) return [];
    var dayKey = isSwappedDay() ? "day2" : "day1";
    var rows = state.timeLoss[dayKey];
    var remaining = n;
    var messages = [];
    for (var r = 0; r < TIME_LOSS_ROW_DEFS.length && remaining > 0; r++) {
      var rowWasFull = rows[r].every(Boolean);
      for (var b = 0; b < TIME_LOSS_ROW_DEFS[r].boxes && remaining > 0; b++) {
        if (!rows[r][b]) {
          rows[r][b] = true;
          remaining--;
        }
      }
      if (!rowWasFull && rows[r].every(Boolean)) {
        if (TIME_LOSS_ROW_DEFS[r].kind === "threat") {
          var threatMsg = rollAndTriggerThreatEffect();
          if (threatMsg) messages.push(threatMsg);
        } else if (TIME_LOSS_ROW_DEFS[r].kind === "rain") {
          messages.push(
            window.I18N.t("night_rain_label") +
              window.I18N.t("colon_separator") +
              window.I18N.t("night_rain_detail_" + dayKey + "_" + TIME_LOSS_ROW_DEFS[r].tier)
          );
        }
      }
    }
    renderTimeLossChecks(dayKey);
    renderTimeLossSummary();
    // 使用者確認（項目8）：自動化GM経由（防禦階段開始時のTime Loss+1等）で夜雨段階が
    // 変わった場合も、盤面の下雨アイコンを追随して更新する。
    renderRainIcons();
    return messages;
  }

  // #10：樓層レベルが「全」に達したら、そのカードの「全樓層踏破效果」（盧恩／時間損耗）を
  // 自動的に全入場PCへ付与し、時間損耗分を公告＆留言板へ投稿する。同じカードに対しては
  // 1回のみ（cardFloorRewardGrantedへ「このカードのcode」を記録し、以後の重複を防ぐ。
  // カードが入れ替われば別codeになるため、次のカードでは改めて発火できる）。
  function grantCardFullClearRewardIfNeeded(index) {
    var slot = state.slots[index];
    if (!slot) return;
    if (!state.cardFloorRewardGranted) state.cardFloorRewardGranted = {};
    if (state.cardFloorRewardGranted[index] === slot.code) return;
    var card = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(index);
    if (!card) return;
    // 自動化GM Phase 2第18項：「この＋1でカードの実在する全樓層を踏破した」こと自体は
    // allFloorEffectの有無にかかわらず必ずGM敘述する（続く［地圖移動］案内のため）。
    // 実際のルーン／タイムロス自動付与だけはallFloorEffectがあるカードに限る。
    state.cardFloorRewardGranted[index] = slot.code;
    var effectText = card.allFloorEffect ? window.PriTestFields.localizedText(card.allFloorEffect) : "";
    if (card.allFloorEffect) {
      var runeAmount = parseAllFloorEffectAmount(effectText, ["盧恩", "ルーン"]);
      var timeLossAmount = parseAllFloorEffectAmount(effectText, ["時間損耗", "タイムロス"]);
      if (runeAmount) window.PriTestNightFloorBreakthrough.grantRuneToAllEntered(runeAmount);
      if (timeLossAmount) {
        addTimeLoss(timeLossAmount);
        var cardNameForBroadcast = window.PriTestFields.localizedText(card.name);
        var msg = window.I18N.t("card_full_clear_time_loss_broadcast", { card: cardNameForBroadcast, value: timeLossAmount });
        postSystemTurnMessage(msg);
        showThreatBroadcast([msg]);
      }
    }
    // 自動化GM Phase 2：全樓層踏破の効果はすでに自動付与されているので（上のgrantRuneToAllEntered等）、
    // ここでは進度版に「何が起きたか」をGM敘述として提示し、[OK]で確認してから次に進めるようにする。
    // 「黄金樹の帳」（夜の強敵）の全踏破だけは特別に扱う：HP/FP/加護/聖杯瓶/技能を全員分自動回復し、
    // 次の夜へ進むかどうかの選択肢を出す（規則書：夜の強敵撃破後の追加処理）。それ以外の通常カードは
    // showFullClearNarration側で続けて［地圖移動］（次の目的地選択）への案内も敘述する。
    if (state.gmFlowEnabled && window.PriTestNightGmFlow) {
      var cardName = window.PriTestFields.localizedText(card.name);
      if (card.id === "a_golden") {
        window.PriTestNightGmFlow.handleGoldenTreeFullClear(cardName, effectText);
      } else {
        window.PriTestNightGmFlow.showFullClearNarration(cardName, effectText);
      }
    }
    saveState();
  }

  // grantCardFullClearRewardIfNeededの起點／終點（"start"|"end"）版。数値板塊はcardLevelsが
  // "全"（null）に達したことをstepCardLevel経由で検知するが、起點/終點にはその概念が無い
  // ため、代わりにstate.startChecks.all／endChecks.allそのものを重複防止フラグとして使う
  // （defaultChecks()でリセットされるタイミング＝新しい起點/終點が割り当てられたタイミング
  // と一致するため、数値板塊のcardFloorRewardGranted[index]===slot.codeと同じ役割を果たす）。
  // 出發地點（a_start）は常にfloorCount:1で、樓層本文の敘述完了＝即座に全踏破対象になる
  // （night_gm_flow.jsのfinishFieldWalk参照）。終點（"end"）は常にa_golden解決になるため、
  // 下のcard.id==="a_golden"分岐へ入り、既存の進次日フローがそのまま使われる。
  function grantPileFullClearRewardIfNeeded(which) {
    var pileChecks = which === "start" ? state.startChecks : state.endChecks;
    if (!pileChecks || pileChecks.all) return;
    pileChecks.all = true;
    var card = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(which);
    if (!card) {
      renderPiles();
      saveState();
      return;
    }
    var effectText = card.allFloorEffect ? window.PriTestFields.localizedText(card.allFloorEffect) : "";
    if (card.allFloorEffect) {
      var runeAmount = parseAllFloorEffectAmount(effectText, ["盧恩", "ルーン"]);
      var timeLossAmount = parseAllFloorEffectAmount(effectText, ["時間損耗", "タイムロス"]);
      if (runeAmount) window.PriTestNightFloorBreakthrough.grantRuneToAllEntered(runeAmount);
      if (timeLossAmount) {
        addTimeLoss(timeLossAmount);
        var pileCardNameForBroadcast = window.PriTestFields.localizedText(card.name);
        var pileMsg = window.I18N.t("card_full_clear_time_loss_broadcast", { card: pileCardNameForBroadcast, value: timeLossAmount });
        postSystemTurnMessage(pileMsg);
        showThreatBroadcast([pileMsg]);
      }
    }
    if (state.gmFlowEnabled && window.PriTestNightGmFlow) {
      var pileCardName = window.PriTestFields.localizedText(card.name);
      if (card.id === "a_golden") {
        window.PriTestNightGmFlow.handleGoldenTreeFullClear(pileCardName, effectText);
      } else {
        window.PriTestNightGmFlow.showFullClearNarration(pileCardName, effectText);
      }
    }
    renderPiles();
    saveState();
  }


  // pushBreakthroughSummaryMessageと同じ形だが、既に組み立て済みの文字列（i18nキーに
  // 落とし込みにくい動的な組み合わせ文言）をそのままGM留言板へ投稿する汎用版。
  function postSystemTurnMessage(text) {
    state.turnMessages.push({ text: text, time: Date.now(), side: "gm" });
    saveState();
    renderTurnHolderBar();
  }


  function renderPrimaryButton() {
    var btn = document.getElementById("btn-primary-action");
    var emptyCount = state.slots.filter(function (s) {
      return s === null;
    }).length;
    if (!state.boardStarted) {
      btn.textContent = window.I18N.t("start_button");
      btn.disabled = false;
      btn.onclick = scenario
        ? dealScenarioInitial
        : function () {
            openSelectDrawer("initial", SLOT_COUNT);
          };
    } else {
      btn.textContent = window.I18N.t("next_night_button");
      if (state.dayNumber >= MAX_DAY) {
        btn.disabled = true;
      } else if (scenario && state.dayNumber >= MAX_DAY - 1) {
        // ユーザー報告：2日目→3日目（最終夜）は探索盤面が存在しないため、1日目→2日目と同じ
        // 「保持するカードを選ぶ」ドロワーを経由させず、直接夜の王戦闘の案内へ進める。
        btn.disabled = false;
        btn.onclick = advanceToFinalNightDirect;
      } else if (scenario) {
        btn.disabled = false;
        btn.onclick = openKeepCardsDrawer;
      } else {
        btn.disabled = emptyCount === 0;
        btn.onclick = function () {
          openSelectDrawer("continue", emptyCount);
        };
      }
    }
  }

  function renderLog() {
    // 完全な記録一覧（#log-list）とは別に、常駐で見える精簡摘要（#log-summary）も更新する。
    // 摘要はcollapsedトグルの対象外＝他の人が完全な記録を展開しなくても最新状況を見られる。
    var summary = document.getElementById("log-summary");
    if (summary) {
      summary.innerHTML = "";
      if (state.log.length === 0) {
        summary.textContent = window.I18N.t("log_summary_empty");
      } else {
        state.log
          .slice(-3)
          .reverse()
          .forEach(function (entry) {
            var line = document.createElement("p");
            var time = new Date(entry.time).toLocaleTimeString();
            line.textContent = "[" + time + "] " + window.I18N.t(entry.key, entry.params);
            summary.appendChild(line);
          });
      }
    }

    var list = document.getElementById("log-list");
    list.innerHTML = "";
    if (state.log.length === 0) {
      var empty = document.createElement("li");
      empty.textContent = window.I18N.t("log_empty");
      list.appendChild(empty);
      return;
    }
    state.log.forEach(function (entry) {
      var li = document.createElement("li");
      var time = new Date(entry.time).toLocaleTimeString();
      li.textContent = "[" + time + "] " + window.I18N.t(entry.key, entry.params);
      list.appendChild(li);
    });
  }

  function renderLogToggleLabel() {
    var btn = document.getElementById("btn-log-toggle");
    var collapsed = document.getElementById("log-list").classList.contains("collapsed");
    btn.textContent = collapsed ? "🙈" : "👁";
    btn.title = window.I18N.t(collapsed ? "log_toggle_show" : "log_toggle_hide");
  }

  function openLogDrawer() {
    document.getElementById("log-drawer").classList.add("open");
  }

  function closeLogDrawer() {
    document.getElementById("log-drawer").classList.remove("open");
  }

  // 懸浮泡泡：公開盤（全員が見る画面）左上に常時表示するショートカット。state.logBubbleEnabled
  // （クラウド同期対象）で全端末に反映し、ドロワー内のボタンでON、泡泡自体の×ボタンでのみOFFにする。
  function renderLogFloatToggleButton() {
    var btn = document.getElementById("btn-log-float-toggle");
    if (!btn) return;
    btn.textContent = window.I18N.t(state.logBubbleEnabled ? "log_float_toggle_on_label" : "log_float_toggle_off_label");
  }

  function renderLogFloatingBubble() {
    var wrap = document.getElementById("log-floating-bubble-wrap");
    if (wrap) wrap.hidden = !state.logBubbleEnabled;
  }

  function setLogBubbleEnabled(enabled) {
    state.logBubbleEnabled = enabled;
    saveState();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
  }

  // 全角色分の可発動能力／被動技能セクション（character-roster-skills）をまとめて折りたたむトグル。
  function renderRosterSkillsToggleLabel() {
    var btn = document.getElementById("btn-roster-skills-toggle");
    if (!btn) return;
    var collapsed = document.getElementById("character-roster-skills").classList.contains("collapsed");
    btn.textContent = collapsed ? "🙈" : "👁";
    btn.title = window.I18N.t(collapsed ? "roster_skills_toggle_show" : "roster_skills_toggle_hide");
  }

  // --- select drawer ---
  function renderSelectScreen() {
    var grid = document.getElementById("select-grid");
    grid.innerHTML = "";
    var onBoard = codesOnBoard();
    SUITS.forEach(function (suit) {
      var group = document.createElement("div");
      group.className = "suit-group";
      var heading = document.createElement("h3");
      heading.className = SUIT_CLASS[suit];
      heading.textContent = SUIT_SYMBOL[suit];
      group.appendChild(heading);

      var subGrid = document.createElement("div");
      subGrid.className = "suit-grid";
      DECK.filter(function (c) {
        return c.suit === suit;
      }).forEach(function (card) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mini-card " + card.colorClass;
        btn.textContent = card.label;
        var disabled = onBoard.has(card.code);
        if (disabled) btn.classList.add("disabled");
        if (state.selection.has(card.code)) btn.classList.add("selected");
        btn.disabled = disabled;
        btn.addEventListener("click", function () {
          toggleSelect(card.code);
        });
        subGrid.appendChild(btn);
      });
      group.appendChild(subGrid);
      grid.appendChild(group);
    });

    document.getElementById("select-title").textContent = window.I18N.t(
      state.selectMode === "initial" ? "select_title_initial" : "select_title_continue",
      { max: state.maxSelect }
    );
    updateSelectCount();
  }

  function updateSelectCount() {
    document.getElementById("select-count").textContent = window.I18N.t("selected_count", {
      n: state.selection.size,
      max: state.maxSelect,
    });
    document.getElementById("btn-select-submit").disabled = state.selection.size === 0;
  }

  function toggleSelect(code) {
    if (state.selection.has(code)) {
      state.selection.delete(code);
    } else {
      if (state.selection.size >= state.maxSelect) return;
      state.selection.add(code);
    }
    renderSelectScreen();
  }

  function openSelectDrawer(mode, maxSelect) {
    if (maxSelect <= 0) {
      if (mode === "continue") alert(window.I18N.t("error_no_empty_slots"));
      return;
    }
    state.selectMode = mode;
    state.maxSelect = maxSelect;
    state.selection.clear();
    renderSelectScreen();
    document.getElementById("select-drawer").classList.add("open");
  }

  function closeSelectDrawer() {
    document.getElementById("select-drawer").classList.remove("open");
  }

  function submitSelection() {
    if (state.selection.size === 0) {
      alert(window.I18N.t("error_select_at_least_one"));
      return;
    }
    var wasContinue = state.selectMode === "continue";
    if (wasContinue) saveUndoSnapshot();

    var codes = Array.from(state.selection);
    var cardsLabel = codes
      .map(function (c) {
        return CARD_BY_CODE[c].label;
      })
      .join(", ");

    var targetPositions;
    if (state.selectMode === "initial") {
      targetPositions = shuffle(
        Array.from({ length: SLOT_COUNT }, function (_, i) {
          return i;
        })
      ).slice(0, codes.length);
    } else {
      var emptyPositions = [];
      state.slots.forEach(function (s, i) {
        if (s === null) emptyPositions.push(i);
      });
      targetPositions = shuffle(emptyPositions).slice(0, codes.length);
    }

    targetPositions.forEach(function (pos, i) {
      state.slots[pos] = { code: codes[i], revealed: false };
      state.cardLevels[pos] = 0;
    });
    var rolledEventChips = rollEventChips();
    state.eventChips = rolledEventChips.ids;
    state.eventChipNumbers = rolledEventChips.numbers;
    state.eventChipsUsed = new Array(SLOT_COUNT).fill(false);
    state.eventChipsData = {};

    var logKey = wasContinue ? "log_continue_submit" : "log_select_submit";
    if (!wasContinue) state.focusedIndex = "start";
    state.boardStarted = true;
    revealStartAdjacentSlots();
    if (wasContinue) advanceToNextNight();
    closeSelectDrawer();
    renderBoard();
    addLog(logKey, { n: codes.length, cards: cardsLabel });
    if (wasContinue) addLog("log_next_night", { day: state.dayNumber });
  }

  function advanceToNextNight() {
    state.startDefeatedDay = state.dayNumber;
    state.startSuit = state.endSuit;
    state.startChecks = { one: true, all: true };
    state.startDefeated = true;
    state.endSuit = null;
    state.endChecks = defaultChecks();
    state.dayNumber += 1;
  }

  // ユーザー報告：3日目（最終夜、夜の王戦闘のみでフィールド探索盤面が存在しない）への遷移が、
  // 1日目→2日目と同じ「保持するカードを選ぶ」ドロワー（openKeepCardsDrawer/submitKeepCards）
  // を経由していた。submitKeepCardsは常にscenario.day2のデータで新しい盤面を組み立てる
  // ため、2日目→3日目の遷移でもscenario.day2を使い回して意味のない「3日目の探索盤面」を
  // 誤って再構築してしまっていた（scenario.day3という概念自体が存在しない）。
  // 3日目には盤面が無いため、カードを選ぶ操作自体が不要——advanceToNextNightで日付だけ
  // 進め、盤面データを空にして（renderBoardのdayNumber>=MAX_DAYガードで#board-area自体も
  // 非表示にする）、そのまま夜の王戦闘の案内（night_gm_flow.jsのmaybeAnnounceFinalDay、
  // renderLocationBanner呼び出しのたびに自動的にチェックされる）へ直行させる。
  function advanceToFinalNightDirect() {
    saveUndoSnapshot();
    advanceToNextNight();
    for (var i = 0; i < SLOT_COUNT; i++) {
      state.slots[i] = null;
      state.cardLevels[i] = null;
    }
    state.eventChips = new Array(SLOT_COUNT).fill(null);
    state.eventChipNumbers = new Array(SLOT_COUNT).fill(null);
    state.eventChipsUsed = new Array(SLOT_COUNT).fill(false);
    state.eventChipsData = {};
    // focusedIndexはあえてクリアしない：renderCurrentLocationStatusは
    // 「focusedIndexが解決できる場地カードを持たず、かつgmFlow側が敘述待ち状態でもない」場合に
    // 進度版オーバーレイ自体を早期return（非表示）してしまうため、nullにすると
    // maybeAnnounceFinalDay（renderLocationBanner内、night_gm_flow.js）に到達する前に
    // 描画が打ち切られ、3日目の夜の王戦闘案内が一切表示されなくなってしまう
    // （盤面自体はboard-areaのhidden制御で別途隠しているため、focusedIndexを残しても
    // 盤面が再表示されることはない）。
    saveState();
    renderBoard();
    renderCurrentLocationStatus();
    addLog("log_next_night", { day: state.dayNumber });
  }

  // --- シナリオ（副本）モード：固定カード配置 ---
  function dealScenarioInitial() {
    state.startSuit = scenario.start.suit;
    state.endSuit = scenario.end.suit;
    if (scenario.fixedLayout) {
      // 固定配置副本：原書図解の通りの位置（FIXED_LAYOUT_POS_TO_SLOT）にそのまま配置する。
      scenario.day1.forEach(function (row) {
        var idx = FIXED_LAYOUT_POS_TO_SLOT[row.pos];
        state.slots[idx] = { code: row.suit + "-" + row.rank, revealed: false };
        state.cardLevels[idx] = 0;
      });
    } else {
      // 副本で決まっているのは「9枚のカードと場効果の組」だけで、どのマスに入るかは
      // 自訂モードと同様にランダム（プレイのたびに配置が変わる）。
      var positions = shuffle(
        Array.from({ length: SLOT_COUNT }, function (_, i) {
          return i;
        })
      );
      scenario.day1.forEach(function (row, i) {
        var idx = positions[i];
        state.slots[idx] = { code: row.suit + "-" + row.rank, revealed: false };
        state.cardLevels[idx] = 0;
      });
    }
    var rolledEventChips = rollEventChips();
    state.eventChips = rolledEventChips.ids;
    state.eventChipNumbers = rolledEventChips.numbers;
    state.eventChipsUsed = new Array(SLOT_COUNT).fill(false);
    state.eventChipsData = {};
    state.focusedIndex = "start";
    state.boardStarted = true;
    revealStartAdjacentSlots();
    renderBoard();
    addLog("log_select_submit", {
      n: scenario.day1.length,
      cards: scenario.day1
        .map(function (row) {
          return CARD_BY_CODE[row.suit + "-" + row.rank].label;
        })
        .join(", "),
    });
  }

  var keepSelection = new Set(); // 保留する場地（スロット番号）

  function keepCardsTarget() {
    return scenario && scenario.fixedLayout ? SLOT_COUNT - scenario.day2.length : 3;
  }

  function openKeepCardsDrawer() {
    keepSelection.clear();
    if (scenario && scenario.fixedLayout) keepSelection.add(FIXED_LAYOUT_CENTER_SLOT);
    // 地変マスは「常に保持」ではなく「常に除外」なので keepSelection には入れない
    // （入れると submitKeepCards のクリアループで残ってしまい、地変タイルを配置できなくなる）。
    renderKeepGrid();
    var terrainNote = document.getElementById("keep-terrain-note");
    if (terrainNote) {
      var hasTerrain = scenarioTerrainRows().length > 0;
      terrainNote.hidden = !hasTerrain;
      if (hasTerrain && scenario.note) terrainNote.textContent = window.PriTestWeapons.localizedText(scenario.note);
    }
    document.getElementById("keep-drawer").classList.add("open");
  }

  function closeKeepCardsDrawer() {
    document.getElementById("keep-drawer").classList.remove("open");
  }

  function renderKeepGrid() {
    var grid = document.getElementById("keep-grid");
    grid.innerHTML = "";
    var target = keepCardsTarget();
    var isFixed = scenario && scenario.fixedLayout;
    var titleEl = document.querySelector("#keep-drawer h2");
    if (titleEl) {
      titleEl.textContent = isFixed
        ? window.I18N.t("keep_cards_title_fixed", { n: target })
        : window.I18N.t("keep_cards_title");
    }
    var hasTerrain = scenarioTerrainRows().length > 0;
    for (var i = 0; i < SLOT_COUNT; i++) {
      (function (index) {
        var slot = state.slots[index];
        var locked = isFixed && index === FIXED_LAYOUT_CENTER_SLOT;
        var terrainLocked = hasTerrain && TERRAIN_SWAP_SLOTS.indexOf(index) !== -1;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mini-card";
        if (slot) {
          var card = CARD_BY_CODE[slot.code];
          btn.textContent = index + 1 + ". " + card.label;
          btn.classList.add(card.colorClass);
        } else {
          btn.textContent = index + 1 + ". -";
          btn.classList.add("disabled");
          btn.disabled = true;
        }
        if (keepSelection.has(index)) btn.classList.add("selected");
        if (locked) btn.classList.add("locked");
        if (terrainLocked) btn.classList.add("terrain-locked");
        btn.addEventListener("click", function () {
          if (!slot || locked || terrainLocked) return;
          if (keepSelection.has(index)) {
            keepSelection.delete(index);
          } else {
            if (keepSelection.size >= target) return;
            keepSelection.add(index);
          }
          renderKeepGrid();
        });
        grid.appendChild(btn);
      })(i);
    }
    document.getElementById("keep-count").textContent = isFixed
      ? window.I18N.t("keep_cards_count_fixed", { n: keepSelection.size, max: target })
      : window.I18N.t("keep_cards_count", { n: keepSelection.size });
    document.getElementById("btn-keep-submit").disabled = keepSelection.size !== target;
  }

  function submitKeepCards() {
    if (keepSelection.size !== keepCardsTarget()) return;
    saveUndoSnapshot();
    for (var i = 0; i < SLOT_COUNT; i++) {
      if (!keepSelection.has(i)) {
        state.slots[i] = null;
        state.cardLevels[i] = null;
      }
    }
    var allDay2Rows = scenario.day2.slice().sort(function (a, b) {
      return a.pos - b.pos;
    });
    var terrainRows = allDay2Rows.filter(function (row) {
      return row.terrain;
    });
    var normalRows = allDay2Rows.filter(function (row) {
      return !row.terrain;
    });
    // 地変（terrain-shift）タイル：場地列5（slot 0/3/6）へランダム順で強制配置。
    // 保持選択の対象外なので、この時点で既に空マスになっている。
    if (terrainRows.length) {
      shuffle(terrainRows).forEach(function (row, i) {
        var pos = TERRAIN_SWAP_SLOTS[i];
        if (pos === undefined) return;
        state.slots[pos] = { code: row.suit + "-" + row.rank, revealed: false };
        state.cardLevels[pos] = 0;
      });
    }
    var emptyPositions = shuffle(
      state.slots
        .map(function (s, i) {
          return s === null ? i : null;
        })
        .filter(function (v) {
          return v !== null;
        })
    );
    normalRows.forEach(function (row, i) {
      var pos = emptyPositions[i];
      if (pos === undefined) return;
      state.slots[pos] = { code: row.suit + "-" + row.rank, revealed: false };
      state.cardLevels[pos] = 0;
    });
    var day2Rows = allDay2Rows;
    var rolledEventChips = rollEventChips();
    state.eventChips = rolledEventChips.ids;
    state.eventChipNumbers = rolledEventChips.numbers;
    state.eventChipsUsed = new Array(SLOT_COUNT).fill(false);
    state.eventChipsData = {};

    advanceToNextNight();
    closeKeepCardsDrawer();
    renderBoard();
    addLog("log_continue_submit", {
      n: day2Rows.length,
      cards: day2Rows
        .map(function (row) {
          return CARD_BY_CODE[row.suit + "-" + row.rank].label;
        })
        .join(", "),
    });
    addLog("log_next_night", { day: state.dayNumber });
  }

  // --- 起點／終點：花色は自動的に決まる値（副本データ・日をまたぐ引き継ぎ）を表示するのみで、
  // クリックによる手動変更はできない。通常の板塊と同様、短押しで規則書の該当ページ
  // （起點＝出発地点／終點＝黄金樹の帳）を開き、長押しで「ここへ移動」を框選できる。
  function onPileShortClick(which) {
    if (!isRulebookAuthenticated()) return;
    var chosenId = which === "start" ? "a_start" : "a_golden";
    document.getElementById("rulebook-modal").hidden = false;
    switchRulebookTab("board");
    setTimeout(function () {
      var target = document.getElementById("field-card-" + chosenId);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function onPileClick(pos) {
    var previousFocusedIndex = state.focusedIndex;
    if (previousFocusedIndex === null || previousFocusedIndex === pos) return;
    var canOfferMove =
      typeof previousFocusedIndex === "number"
        ? !!(state.slots[previousFocusedIndex] && state.slots[previousFocusedIndex].revealed)
        : true;
    if (!canOfferMove) return;
    openConfirm("confirm_move_here_msg", function () {
      attemptMoveToPosition(previousFocusedIndex, pos);
    });
  }

  // --- modal ---
  // extra（任意）：{ labelKey, onClick } を渡すと、否／是に加えて赤色の3つ目のボタンを表示する
  // （例：板塊長押し時の「否／是（移動）／放回牌庫」統合ダイアログ）。
  function openConfirm(messageKey, onYes, onNo, extra) {
    var modal = document.getElementById("modal");
    document.getElementById("modal-message").textContent = window.I18N.t(messageKey);
    modal.hidden = false;
    var yesBtn = document.getElementById("modal-yes");
    var noBtn = document.getElementById("modal-no");
    var extraBtn = document.getElementById("modal-extra");
    if (extra) {
      extraBtn.hidden = false;
      extraBtn.textContent = window.I18N.t(extra.labelKey);
    } else {
      extraBtn.hidden = true;
    }

    function cleanup() {
      modal.hidden = true;
      yesBtn.removeEventListener("click", onYesClick);
      noBtn.removeEventListener("click", onNoClick);
      extraBtn.removeEventListener("click", onExtraClick);
    }
    function onYesClick() {
      cleanup();
      onYes();
    }
    function onNoClick() {
      cleanup();
      if (onNo) onNo();
    }
    function onExtraClick() {
      cleanup();
      if (extra && extra.onClick) extra.onClick();
    }
    yesBtn.addEventListener("click", onYesClick);
    noBtn.addEventListener("click", onNoClick);
    extraBtn.addEventListener("click", onExtraClick);
  }

  // 短押し（タップ）＝規則書の該当ページを開く（規則書パスワード認証済みが前提。未認証時は何もしない）。
  // カードのrank（A〜K）が、fields.jsのフィールドカードのcardLabelに対応する。同じrankを持つ
  // カードが複数ある場合（シナリオ違いの同ランク別内容）は、規則書のフィールドタブを開くだけに留め、
  // 該当ページへの自動スクロールは最初に見つかった1件に対して行う。
  function onSlotShortClick(index) {
    var slot = state.slots[index];
    if (!slot) return;
    if (!isRulebookAuthenticated()) return;
    var card = CARD_BY_CODE[slot.code];
    var Fields = window.PriTestFields;
    if (!card || !Fields) return;
    var matches = Fields.list().filter(function (fc) {
      return fc.cardLabel === card.rank;
    });
    if (!matches.length) return;
    // Aのみ、同じ「A」ランクに「出発地点」（開始花色と同じスートのA）と「黄金樹の帳」
    // （それ以外のスートのA）の2枚が存在するため、実際のカードのスートで正しい方を選ぶ
    // （それ以外のランクは1ランクにつき1枚のみなのでmatches[0]で確定）。
    var chosen = matches[0];
    if (card.rank === "A" && matches.length > 1) {
      var wantId = card.suit === state.startSuit ? "a_start" : "a_golden";
      chosen =
        matches.filter(function (fc) {
          return fc.id === wantId;
        })[0] || matches[0];
    }
    document.getElementById("rulebook-modal").hidden = false;
    switchRulebookTab("board");
    setTimeout(function () {
      var target = document.getElementById("field-card-" + chosen.id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // #19：うっかり「山札に戻す」を押した場合の回復用に、消す直前のカード情報を記録する
  // （マス単位。次に同じマスを長押しすれば復元できる）。
  function recordReturnedCard(index, slot) {
    if (!state.returnedCardMemory) state.returnedCardMemory = {};
    state.returnedCardMemory[index] = { code: slot.code, cardLevel: state.cardLevels[index] };
  }

  // 空きマスの長押し：直前にこのマスへ「放回牌庫」した記録があれば、確認の上で元に戻す。
  function restoreReturnedCardIfAny(index) {
    var mem = state.returnedCardMemory && state.returnedCardMemory[index];
    if (!mem) return;
    openConfirm("restore_returned_card_confirm", function () {
      state.slots[index] = { code: mem.code, revealed: true };
      state.cardLevels[index] = mem.cardLevel;
      delete state.returnedCardMemory[index];
      renderBoard();
      saveState();
      var card = CARD_BY_CODE[mem.code];
      addLog("log_restore_returned_card", { slot: index + 1, card: card ? card.label : mem.code });
    });
  }

  // 長押し（1秒）＝既存の「めくる（未公開→公開）」「山札に戻す（公開→除去）」操作。
  function onSlotClick(index) {
    var slot = state.slots[index];
    if (!slot) {
      restoreReturnedCardIfAny(index);
      return;
    }

    // 既存の「めくる／山札に戻す」フロー（focusedIndexの更新も含めて元の挙動のまま）。
    function proceedRevealOrReturn() {
      // めくる／放回牌庫は現在地（focusedIndex）を更新しない。現在地は「移動」操作でのみ
      // 変わる（黄色枠のハイライトは実際の移動があった場所を示すため）。
      var card = CARD_BY_CODE[slot.code];
      if (!slot.revealed) {
        openConfirm(
          "confirm_reveal_msg",
          function () {
            slot.revealed = true;
            renderBoard();
            addLog("log_reveal", { slot: index + 1, card: card.label });
          },
          function () {
            addLog("log_cancel_reveal", { slot: index + 1 });
          }
        );
      } else {
        openConfirm(
          "confirm_draw_msg",
          function () {
            recordReturnedCard(index, slot);
            state.slots[index] = null;
            state.cardLevels[index] = null;
            if (state.focusedIndex === index) state.focusedIndex = null;
            renderBoard();
            addLog("log_draw_out", { slot: index + 1, card: card.label });
          },
          function () {
            addLog("log_cancel_draw", { slot: index + 1, card: card.label });
          }
        );
      }
    }

    // 既に別の公開済み地点（板塊または起點／終點）にフォーカス（＝現在地）がある場合のみ、
    // 「移動」の選択肢を先に出す。移動が成立するかどうかは攀登判定の結果次第なので、
    // 成立前にfocusedIndexは書き換えない。
    var previousFocusedIndex = state.focusedIndex;
    var canOfferMove =
      slot.revealed &&
      previousFocusedIndex !== null &&
      previousFocusedIndex !== index &&
      (typeof previousFocusedIndex === "number"
        ? state.slots[previousFocusedIndex] && state.slots[previousFocusedIndex].revealed
        : true);

    if (canOfferMove) {
      // 否／是（移動）／放回牌庫（赤）を1つのダイアログに統合する。
      openConfirm(
        "confirm_move_here_msg",
        function () {
          attemptMoveToPosition(previousFocusedIndex, index);
        },
        null,
        {
          labelKey: "return_to_deck_button",
          onClick: function () {
            var card = CARD_BY_CODE[slot.code];
            recordReturnedCard(index, slot);
            state.slots[index] = null;
            state.cardLevels[index] = null;
            if (state.focusedIndex === index) state.focusedIndex = null;
            renderBoard();
            saveState();
            addLog("log_draw_out", { slot: index + 1, card: card.label });
          },
        }
      );
    } else {
      proceedRevealOrReturn();
    }
  }

  // 花色の「高さ」（攀登判定の花色差の基準）。ユーザー確認済み：黑桃＞愛心＞方塊＞梅花。
  var SUIT_ELEVATION = { C: 0, D: 1, H: 2, S: 3 };

  // 起點／終點は日をまたぐたびに盤面の左右が入れ替わる（isSwappedDay）ため、
  // 隣接する板塊のindexもそれに応じて変わる（style.cssの.pile-wrap-start/endの
  // grid-column配置と対応）。起點／終點は盤外（左右いずれかの辺）にあり、その辺の
  // 列（3マス、斜め方向の板塊も含む）すべてに隣接するとみなす。
  function pileAdjacentSlotIndices(which) {
    var leftCol = [0, 3, 6];
    var rightCol = [2, 5, 8];
    var startOnRight = isSwappedDay();
    if (which === "start") return startOnRight ? rightCol : leftCol;
    return startOnRight ? leftCol : rightCol; // "end"
  }

  // fromPos／toPosは板塊index(0-8)、または"start"/"end"のいずれか。
  function isAdjacentPosition(fromPos, toPos) {
    if (typeof fromPos === "number" && typeof toPos === "number") {
      var fromRow = Math.floor(fromPos / 3),
        fromCol = fromPos % 3;
      var toRow = Math.floor(toPos / 3),
        toCol = toPos % 3;
      var dRow = Math.abs(fromRow - toRow);
      var dCol = Math.abs(fromCol - toCol);
      return (dRow === 1 && dCol === 0) || (dRow === 0 && dCol === 1); // 通常マス同士は上下左右のみ
    }
    if (typeof fromPos === "number") return pileAdjacentSlotIndices(toPos).indexOf(fromPos) !== -1;
    if (typeof toPos === "number") return pileAdjacentSlotIndices(fromPos).indexOf(toPos) !== -1;
    return false; // 起點⇔終點は隣接しない
  }

  // 花色の「高さ」（攀登判定の要否の基準）。板塊なら実際のカードの花色、起點／終點なら
  // その位置に設定されている花色（未設定ならnull＝高さ比較をスキップする）。
  function elevationOfPosition(pos) {
    if (typeof pos === "number") {
      var slot = state.slots[pos];
      var card = slot ? CARD_BY_CODE[slot.code] : null;
      return card ? SUIT_ELEVATION[card.suit] : null;
    }
    var suit = pos === "start" ? state.startSuit : state.endSuit;
    return suit ? SUIT_ELEVATION[suit] : null;
  }

  // 自動化GM Phase 2：移動後に周囲一圈（上下左右の隣接マスのみ、斜めは含まない——
  // isAdjacentPositionと同じ隣接定義）を自動でオープンにする。state.gmFlowEnabledの間のみ動作し、
  // 既存の「1枚ずつ長押しでオープン」手動操作（onSlotClick）はそのまま残す。
  function revealAdjacentSlots(pos) {
    if (typeof pos !== "number") return false;
    var changed = false;
    for (var i = 0; i < SLOT_COUNT; i++) {
      if (i === pos) continue;
      if (isAdjacentPosition(pos, i) && state.slots[i] && !state.slots[i].revealed) {
        state.slots[i].revealed = true;
        changed = true;
      }
    }
    return changed;
  }

  // 出発地点（"start"板塊）に隣接する板塊を自動でオープンにする（規則書：セットアップ終了時に
  // 「出発地点」に隣接している3ヵ所のトランプをオープンにする）。
  function revealStartAdjacentSlots() {
    var changed = false;
    pileAdjacentSlotIndices("start").forEach(function (i) {
      if (state.slots[i] && !state.slots[i].revealed) {
        state.slots[i].revealed = true;
        changed = true;
      }
    });
    return changed;
  }

  function attemptMoveToPosition(fromPos, toPos) {
    if (!isAdjacentPosition(fromPos, toPos)) {
      window.alert(window.I18N.t("move_not_adjacent_msg"));
      return;
    }
    var fromElev = elevationOfPosition(fromPos);
    var toElev = elevationOfPosition(toPos);
    if (fromElev != null && toElev != null && toElev > fromElev) {
      window.PriTestNightFloorBreakthrough.openClimbingCheckModal(toPos, toElev - fromElev);
    } else {
      finalizeSlotMove(toPos);
    }
  }

  function finalizeSlotMove(toPos) {
    state.focusedIndex = toPos;
    if (state.gmFlowEnabled) revealAdjacentSlots(toPos);
    renderBoard();
    saveState();
    if (typeof toPos === "number") {
      addLog("log_slot_move", { slot: toPos + 1 });
    } else {
      addLog("log_slot_move_to_pile", { place: window.I18N.t(toPos === "start" ? "start_point_label" : "end_point_label") });
    }
  }

  // ユーザー指定：新遊戲で「角色状態も剛入場の状態へ戻す」を選んだ場合に使う。
  // CharacterDrawer.newCharacter(name, typeId)が返す「まっさらな同職業角色」の中身で、
  // id／enteredだけを保持したまま完全上書きする（等級1・初期武器のみ・盧恩0・已習得盧恩
  // 效果／附加效果／護符／消耗品／骰子池／執行紀錄が全てクリアされる）。参照を保つため
  // 配列要素を差し替えず、既存オブジェクトをin-placeで書き換える。
  function resetCharacterToInitialState(c) {
    var fresh = CharacterDrawer.newCharacter(c.name, c.typeId);
    var id = c.id;
    var entered = c.entered;
    for (var key in c) {
      if (Object.prototype.hasOwnProperty.call(c, key)) delete c[key];
    }
    for (var freshKey in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, freshKey)) c[freshKey] = fresh[freshKey];
    }
    c.id = id;
    c.entered = entered;
  }

  function checkNewGamePassword() {
    var input = window.prompt(window.I18N.t("new_game_password_prompt"));
    return input === NEW_GAME_PASSWORD;
  }

  function handleNewGame() {
    if (!checkNewGamePassword()) return;
    var hadBoard = state.boardStarted;
    // 既に盤面があった場合（＝本当に「新しい」遊戲を始める場合）のみ、角色重置の要否を確認する。
    // まだ何も始まっていない盤面（hadBoard===false）に対して聞いても意味が無いため対象外。
    if (hadBoard && window.confirm(window.I18N.t("new_game_reset_characters_confirm"))) {
      rosterCharacters
        .filter(function (c) {
          return c.entered;
        })
        .forEach(resetCharacterToInitialState);
      saveRosterCharacters();
      renderCharacterRoster();
    }
    resetState();
    renderBoard();
    renderLog();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
    if (hadBoard) addLog("log_new_game");
    // resetStateでstate.gmFlow.openingPlayedがfalseへ戻るため、ページ再読込を挟まなくても
    // 新しい遊戲の開場敘述をここで再生する。
    if (window.PriTestNightGmFlow) {
      window.PriTestNightGmFlow.maybeShowOpeningNarration();
      renderCurrentLocationStatus();
    }
  }

  function buildBoardSlots() {
    var grid = document.getElementById("board-grid");
    for (var i = 0; i < SLOT_COUNT; i++) {
      (function (index) {
        var wrap = document.createElement("div");
        wrap.className = "slot-wrap slot-wrap-" + index;

        // 使用者確認（項目8）：最上段（index 0-2、各列の一番上のカード格）だけに、夜雨
        // 発生時の下雨アイコン用プレースホルダーを仕込む（表示/非表示はrenderRainIcons）。
        if (index < 3) {
          var rainIcon = document.createElement("div");
          rainIcon.className = "slot-rain-icon";
          rainIcon.id = "slot-rain-icon-" + index;
          rainIcon.hidden = true;
          rainIcon.setAttribute("aria-hidden", "true");
          wrap.appendChild(rainIcon);
        }

        var btn = document.createElement("button");
        btn.type = "button";
        btn.id = "slot-" + index;
        btn.className = "slot empty";
        var slotPressTimer = null;
        var slotLongPressFired = false;
        btn.addEventListener("pointerdown", function () {
          slotLongPressFired = false;
          slotPressTimer = setTimeout(function () {
            slotLongPressFired = true;
            onSlotClick(index);
          }, SLOT_LONG_PRESS_MS);
        });
        btn.addEventListener("pointerup", function () {
          clearTimeout(slotPressTimer);
          if (!slotLongPressFired) onSlotShortClick(index);
        });
        btn.addEventListener("pointerleave", function () {
          clearTimeout(slotPressTimer);
        });
        btn.addEventListener("pointercancel", function () {
          clearTimeout(slotPressTimer);
        });
        wrap.appendChild(btn);

        var effectCaption = document.createElement("div");
        effectCaption.className = "slot-effect";
        effectCaption.id = "slot-effect-" + index;
        wrap.appendChild(effectCaption);

        var levelControl = document.createElement("div");
        levelControl.className = "level-control";
        levelControl.id = "level-control-" + index;

        var minus = document.createElement("button");
        minus.type = "button";
        minus.className = "level-btn";
        minus.textContent = "-";
        minus.addEventListener("click", function () {
          stepCardLevel(index, -1);
        });

        var value = document.createElement("span");
        value.className = "level-value";
        value.id = "level-value-" + index;

        var plus = document.createElement("button");
        plus.type = "button";
        plus.className = "level-btn";
        plus.textContent = "+";
        plus.addEventListener("click", function () {
          openConfirm(
            "confirm_breakthrough_check_msg",
            function () {
              window.PriTestNightFloorBreakthrough.openBreakthroughModal(index);
            },
            function () {
              stepCardLevel(index, 1);
            }
          );
        });

        levelControl.appendChild(minus);
        levelControl.appendChild(value);
        levelControl.appendChild(plus);
        wrap.appendChild(levelControl);

        grid.appendChild(wrap);
      })(i);
    }
  }


  // Shared internals exported for night_*.js sibling modules split out of this file (see module map
  // comment near the top of the codebase's CLAUDE.md). state/CARD_BY_CODE/etc. are live references,
  // not snapshots, so mutations made through this object are immediately visible here too.
  window.PriTestNightCore = {
    state: state,
    getRosterCharacters: function () { return rosterCharacters; },
    // ランダムイベント決定表の劇本限定行判定（night_gm_flow.jsのautoRollRandomEventChipIfNeeded）
    // 用：現在の副本id（game/scenarioは共にこのファイルのモジュール内closure変数のため未export、
    // 自訂副本や副本未選択時はnull）。
    getScenarioId: function () { return game && game.scenarioId ? game.scenarioId : null; },
    saveState: saveState,
    saveRosterCharacters: saveRosterCharacters,
    renderCharacterRoster: renderCharacterRoster,
    renderBoard: renderBoard,
    renderSlotEffect: renderSlotEffect,
    renderSmithingStoneCount: renderSmithingStoneCount,
    renderStoneswordKeyCount: renderStoneswordKeyCount,
    renderTurnHolderBar: renderTurnHolderBar,
    // 自動化GM 戰鬥自動化：進度版（night_gm_flow.jsのrenderLocationBanner）から呼ばれる。
    getRoundStageNarrationText: getRoundStageNarrationText,
    renderBattleRoundActionButtons: renderBattleRoundActionButtons,
    buildEncounterSummaryText: buildEncounterSummaryText,
    buildBossTable: buildBossTable,
    markFloorRewardObtained: markFloorRewardObtained,
    openItemDrawModal: openItemDrawModal,
    openWeaponSkillRerollModal: openWeaponSkillRerollModal,
    finalizeSlotMove: finalizeSlotMove,
    stepCardLevel: stepCardLevel,
    restoreTurnRewardModalIfMinimized: restoreTurnRewardModalIfMinimized,
    pushTurnRewards: pushTurnRewards,
    TURN_REWARD_ANY_TARGET_VALUE: TURN_REWARD_ANY_TARGET_VALUE,
    TURN_REWARD_SHARED_TARGET_VALUE: TURN_REWARD_SHARED_TARGET_VALUE,
    CARD_BY_CODE: CARD_BY_CODE,
    SLOT_COUNT: SLOT_COUNT,
    MERCHANT_CONSUMABLE_IDS: MERCHANT_CONSUMABLE_IDS,
    RULEBOOK_PASSWORD: RULEBOOK_PASSWORD,
    openConfirm: openConfirm,
    isRulebookAuthenticated: isRulebookAuthenticated,
    checkRulebookPassword: checkRulebookPassword,
    renderCurrentLocationStatus: renderCurrentLocationStatus,
    // 自動化GM 戰鬥自動化：「雜兵戰鬥／王戰」トリガーで戦闘に入った瞬間、night_gm_flow.js側から
    // 直接actionPhaseを"combat"へ切り替えるために公開する（GMが「行動階段」ボタンを手動で
    // 押す必要をなくす。フロント側の手動ボタン自体は変更・削除しない、別経路として共存する）。
    setActionPhase: setActionPhase,
    addPendingRewardWindow: addPendingRewardWindow,
    openTurnRewardModal: openTurnRewardModal,
    removePendingRewardWindow: removePendingRewardWindow,
    openBattleDrawer: openBattleDrawer,
    getScenario: function () { return scenario; },
    getGame: function () { return game; },
    openKeepCardsDrawer: openKeepCardsDrawer,
    addEnemyToBattle: addEnemyToBattle,
    renderPiles: renderPiles,
    grantPileFullClearRewardIfNeeded: grantPileFullClearRewardIfNeeded,
    grantCardFullClearRewardIfNeeded: grantCardFullClearRewardIfNeeded,
    renderCardLevel: renderCardLevel,
    resolveScenarioTrueName: resolveScenarioTrueName,
    resolveScenarioTrueNameRaw: resolveScenarioTrueNameRaw,
    eventChipDisplayLabel: eventChipDisplayLabel,
    fieldLevelsForDay: fieldLevelsForDay,
    addAutoMobHpRow: addAutoMobHpRow,
    // 自動化GM 戰鬥自動化：敵人擊破後、樓層獎勵ゲートの領取完了をGMが確定した瞬間に
    // night_gm_flow.js側から呼ぶ（「重置全骰」ボタンと同じ内容だがconfirmを挟まない）。
    resetAllDiceSilently: performResetAllDice,
  };

  document.addEventListener("DOMContentLoaded", async function () {
    // この端末がまだ知らないgameId（他端末で作成されたクラウドゲームのリンクを初めて開いた場合）
    // なら、Firebaseからメタ情報を取得してローカルにも登録を試みる。
    if (!game) {
      var remoteMeta = await GameStorage.fetchGameMeta(gameId);
      if (remoteMeta) {
        game = Games.registerCloudGame(gameId, remoteMeta);
        scenario = game && game.scenarioId ? Scenarios.get(game.scenarioId) : null;
      }
    }
    // クラウド保存ゲームはgameId（推測困難な長いID）自体がアクセス制御の鍵なので、
    // 管理員パスワードは不要（他端末から共有リンクだけでそのまま入場できる）。
    // ローカル専用ゲーム・存在しないgameIdの場合は、従来通り管理員パスワードで保護する。
    if (!(game && game.storageMode === "cloud") && !Games.checkAdminPassword(window.I18N.t("admin_password_prompt"))) {
      window.location.href = "../admin/index.html";
      return;
    }
    if (!game) {
      document.getElementById("screen-missing-game").hidden = false;
      document.getElementById("screen-board").hidden = true;
      document.getElementById("day-status").hidden = true;
      document.getElementById("link-characters").hidden = true;
      return;
    }

    document.getElementById("link-characters").href =
      "../characters/index.html?game=" + encodeURIComponent(gameId);

    buildBoardSlots();
    buildTimeLossRows("day1");
    buildTimeLossRows("day2");
    buildWanderingBlessingChecks();
    rosterCharacters = loadRosterCharacters();
    CharacterDrawer.init({
      characters: rosterCharacters,
      save: saveRosterCharacters,
      onChange: renderCharacterRoster,
      renderRoster: renderCharacterRoster,
      restrictEnteredAndDelete: true,
    });
    loadState();
    if (window.PriTestNightGmFlow) {
      window.PriTestNightGmFlow.maybeShowOpeningNarration();
      window.PriTestNightGmFlow.maybeAnnounceFinalDay();
    }
    renderBattlePositionAreas();
    renderEnemyHpGrid();
    renderMobHpList();
    renderSelectedEnemies();
    renderBattleRefTexts();
    // GMがページを再読込した場合でも、簡易戰鬥の追擊損害確認バナーが消えないようにする。
    if (state.battle.simplifiedCombatEndPending) renderSimplifiedCombatEndPrompt();
    renderCurrentLocationStatus();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderAutoGmToggleButton();
    renderAutoGmLog();
    renderActionPhaseGrid();
    renderBoard();
    renderLog();
    renderLogToggleLabel();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
    renderRosterSkillsToggleLabel();
    window.PriTestNightRulebook.renderBossRulebook();
    window.PriTestNightWeaponRulebook.renderWeaponRulebookAll();
    window.PriTestNightRulebook.renderTalismanAcquisitionTable();
    window.PriTestNightRulebook.renderTalismanRulebook();
    window.PriTestNightRulebook.renderConsumableDetermineTable();
    window.PriTestNightRulebook.renderConsumableRulebook();
    window.PriTestNightRulebook.renderEnemyRulebookAll();
    window.PriTestNightRulebook.renderFieldRulebook();
    window.PriTestNightRulebook.renderEventRulebook();
    window.PriTestNightRulebook.renderWorldviewRulebook();
    window.PriTestNightRulebook.renderCommandsRulebook();

    // クラウド保存ゲームのみ：Firebaseから最新状態を取得し（購読開始時に1回必ず呼ばれる）、
    // 以後は他端末からの変更を受信するたびに再描画する。ローカル専用ゲームでは何もしない。
    if (game && game.storageMode === "cloud") {
      // ゲーム作成直後にすぐページ遷移すると送信中のメタ情報書き込みが中断されることがあるため、
      // このページの読み込み時にも念のため再送信しておく（冪等な操作なので害はない）。
      GameStorage.pushGameMeta(gameId, "cloud", {
        name: game.name,
        createdAt: game.createdAt,
        scenarioId: game.scenarioId || null,
        night3BossId: game.night3BossId || null,
      });
      GameStorage.subscribeNightState(gameId, game.storageMode, function (data) {
        // 使用者確認：Firebase同步のrace condition対策。「.on("value")」は購読開始時に必ず
        // 一度、現在サーバーに残っている値で呼ばれる——直前の分頁を閉じた際にpushNightStateの
        // debounce/fire-and-forget送信が間に合わなかった場合、ここに古いスナップショットが
        // 届くことがある（autoGmEnabled/focusedIndexが巻き戻って見える不具合の根因）。
        // 遠端のupdatedAtがこの端末が現在表示している内容より古ければ、適用せずに無視し、
        // 逆に本機（より新しい）状態をFirebaseへ再送して自己修復する。
        if (typeof data.updatedAt === "number" && typeof state.updatedAt === "number" && data.updatedAt < state.updatedAt) {
          GameStorage.pushNightState(gameId, game.storageMode, buildSaveData());
          return;
        }
        applyLoadedData(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        renderEnemyHpGrid();
        renderMobHpList();
        renderSelectedEnemies();
        renderDicePool();
        renderActionPhaseButton();
        renderActionPhaseGrid();
        renderBoard();
        renderLog();
        renderLogToggleLabel();
        renderRosterSkillsToggleLabel();
        renderUndoButton();
        renderTurnHolderBar();
        // 他端末がほぼ同時に同じ獎勵/突破チェックのモーダルを開いている場合、遠隔側の
        // claimed/確定状態を反映し忘れると「まだ獲得できるように見える」→二重取得の原因になる
        // （handleTurnHolderToggleにある再描画ガードと同じパターンをここにも適用する）。
        if (!document.getElementById("turn-reward-modal").hidden) renderTurnRewardModal();
        // Task 8：戦利品自動push起因でstate.activeDraws.turnRewardAutoOpenが立っている間は、
        // まだこの端末でモーダルを開いていなければ自動で開く（potentialPowerの跨端末復元と
        // 同じパターン）。主選單から手動で開いた既存の挙動はこのフラグに依存しないため影響なし。
        if (state.activeDraws.turnRewardAutoOpen && document.getElementById("turn-reward-modal").hidden) {
          openTurnRewardModal();
        }
        if (!document.getElementById("breakthrough-modal").hidden) window.PriTestNightFloorBreakthrough.renderBreakthroughCharacters();
        if (!document.getElementById("floor-reward-modal").hidden && window.PriTestNightFloorBreakthrough.getFloorRewardModalFloor()) {
          window.PriTestNightFloorBreakthrough.renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), window.PriTestNightFloorBreakthrough.getFloorRewardModalFloor());
        }
        if (state.activeDraws.potentialPower) {
          var ppRemote = state.activeDraws.potentialPower;
          var ppModal = document.getElementById("potential-power-modal");
          var ppRestoreBtn = document.getElementById("btn-potential-power-restore");
          if (ppRemote.minimized) {
            ppModal.hidden = true;
            ppRestoreBtn.hidden = false;
          } else if (ppModal.hidden) {
            ppModal.hidden = false;
            ppRestoreBtn.hidden = true;
            window.PriTestNightPotentialPower.renderPotentialPowerModal();
          }
        }
        // weapon/talisman/consumableは、確定(resolved)時・閉じた時に自動でnullへ戻るため、
        // 通常は同時に高々1つしか非nullにならない。念のため複数該当してもタイトルと内容が
        // 食い違わないよう、最初に見つかった1つだけを処理する。まだこのクライアントで
        // 見ていない場合は樓層獲得と同じ縮小ボタンとして表示する（フルモーダルでは画面を
        // 占有しない）。該当が無くなった場合、縮小ボタンとして表示されたままなら隠す
        // （遠隔で確定/クローズされた抽選のゴースト表示を防ぐ）。
        var activeDrawKind = ["weapon", "talisman", "consumable"].filter(function (kind) {
          return !!state.activeDraws[kind];
        })[0];
        var itemDrawModalEl = document.getElementById("item-draw-modal");
        var itemDrawRestoreBtnEl = document.getElementById("btn-item-draw-modal-restore");
        if (activeDrawKind) {
          var drawData = state.activeDraws[activeDrawKind];
          var titleKey =
            activeDrawKind === "weapon"
              ? "item_draw_modal_title_weapon"
              : activeDrawKind === "talisman"
              ? "item_draw_modal_title_talisman"
              : "item_draw_modal_title_consumable";
          var drawChar = rosterCharacters.filter(function (rc) {
            return rc.id === drawData.characterId;
          })[0];
          document.getElementById("item-draw-modal-title").textContent = window.I18N.t(titleKey, { name: drawChar ? drawChar.name : "" });
          if (itemDrawModalEl.hidden && itemDrawRestoreBtnEl.hidden) {
            CharacterDrawer.mountRemoteDrawField(activeDrawKind, document.getElementById("item-draw-modal-content"));
            itemDrawRestoreBtnEl.hidden = false;
          }
          CharacterDrawer.applyRemoteDrawState(activeDrawKind, drawData);
        } else if (itemDrawModalEl.hidden && !itemDrawRestoreBtnEl.hidden) {
          itemDrawRestoreBtnEl.hidden = true;
        }
      });
      GameStorage.subscribeCharacters(gameId, game.storageMode, function (list) {
        rosterCharacters.length = 0;
        list.forEach(function (c) {
          rosterCharacters.push(CharacterDrawer.ensureDefaults(c));
        });
        localStorage.setItem(CHARACTERS_KEY, JSON.stringify(rosterCharacters));
        renderCharacterRoster();
      });
    }

    document.getElementById("btn-open-rulebook").addEventListener("click", handleOpenRulebook);
    document.getElementById("btn-rulebook-close").addEventListener("click", closeRulebookModal);
    document.getElementById("btn-rulebook-floating-close").addEventListener("click", closeRulebookModal);
    document.querySelectorAll(".rulebook-tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchRulebookTab(btn.getAttribute("data-tab"));
      });
    });

    document.getElementById("btn-select-submit").addEventListener("click", submitSelection);
    document.getElementById("btn-select-cancel").addEventListener("click", closeSelectDrawer);
    document.getElementById("drawer-backdrop").addEventListener("click", closeSelectDrawer);
    document.getElementById("btn-keep-submit").addEventListener("click", submitKeepCards);
    document.getElementById("btn-keep-cancel").addEventListener("click", closeKeepCardsDrawer);
    document.getElementById("keep-drawer-backdrop").addEventListener("click", closeKeepCardsDrawer);
    document.getElementById("btn-new-game").addEventListener("click", handleNewGame);
    document.getElementById("btn-undo-night").addEventListener("click", handleUndoNight);
    document.getElementById("btn-log-toggle").addEventListener("click", function () {
      document.getElementById("log-list").classList.toggle("collapsed");
      renderLogToggleLabel();
    });
    document.getElementById("btn-main-menu-log").addEventListener("click", openLogDrawer);
    document.getElementById("btn-log-drawer-close").addEventListener("click", closeLogDrawer);
    document.getElementById("log-drawer-backdrop").addEventListener("click", closeLogDrawer);
    document.getElementById("btn-log-float-toggle").addEventListener("click", function () {
      setLogBubbleEnabled(!state.logBubbleEnabled);
    });
    document.getElementById("btn-log-floating-bubble-open").addEventListener("click", openLogDrawer);
    document.getElementById("btn-log-floating-bubble-close").addEventListener("click", function () {
      setLogBubbleEnabled(false);
    });
    document.getElementById("btn-roster-skills-toggle").addEventListener("click", function () {
      document.getElementById("character-roster-skills").classList.toggle("collapsed");
      renderRosterSkillsToggleLabel();
    });
    document.getElementById("btn-board-position-toggle").addEventListener("click", function () {
      setBoardPositionExpanded(document.getElementById("board-side-position-full").hidden);
    });
    document.getElementById("btn-setup-info").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleSetupInfo();
    });
    document.getElementById("setup-info-close").addEventListener("click", closeSetupInfo);
    document.addEventListener("click", function (e) {
      var bubble = document.getElementById("setup-info-bubble");
      if (bubble.hidden) return;
      if (bubble.contains(e.target) || e.target.id === "btn-setup-info") return;
      closeSetupInfo();
    });
    document.addEventListener("click", function (e) {
      var enemyBubble = document.getElementById("strong-enemy-info-bubble");
      if (!enemyBubble || enemyBubble.hidden) return;
      if (enemyBubble.contains(e.target)) return;
      enemyBubble.hidden = true;
    });
    document.getElementById("btn-time-loss-info").addEventListener("click", openThreatDrawer);
    document.getElementById("btn-time-loss-broadcast").addEventListener("click", triggerThreatBroadcast);
    document.getElementById("btn-threat-broadcast-close").addEventListener("click", closeThreatBroadcast);
    document.getElementById("btn-enemy-row-status-close").addEventListener("click", closeEnemyRowStatusBanner);
    document.getElementById("btn-simplified-combat-end-confirm").addEventListener("click", handleSimplifiedCombatEndConfirm);
    var locationStatusToggleBtn = document.getElementById("btn-location-status-toggle");
    locationStatusToggleBtn.addEventListener("click", handleLocationBannerToggleClick);
    attachLocationBannerToggleLongPress(locationStatusToggleBtn);
    document.getElementById("btn-threat-drawer-close").addEventListener("click", closeThreatDrawer);
    document.getElementById("threat-drawer-backdrop").addEventListener("click", closeThreatDrawer);
    document.getElementById("btn-active-threat-effect-add").addEventListener("click", handleActiveThreatEffectAdd);
    document.getElementById("active-threat-effect-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleActiveThreatEffectAdd();
      }
    });
    document.getElementById("btn-battle-info").addEventListener("click", openBattleDrawer);
    document.getElementById("btn-battle-drawer-close").addEventListener("click", closeBattleDrawer);
    document.getElementById("btn-bag-drawer-open").addEventListener("click", openBagDrawer);
    document.getElementById("btn-bag-drawer-close").addEventListener("click", closeBagDrawer);
    document.getElementById("btn-attribute-status-info").addEventListener("click", openAttributeStatusDrawer);
    document.getElementById("btn-attribute-status-drawer-close").addEventListener("click", closeAttributeStatusDrawer);
    document.getElementById("attribute-status-drawer-backdrop").addEventListener("click", closeAttributeStatusDrawer);
    document.getElementById("btn-merchant-modal-close").addEventListener("click", closeMerchantModal);
    document.getElementById("btn-event-chip-trigger").addEventListener("click", window.PriTestNightEventChips.handleEventChipTrigger);
    document.getElementById("btn-event-chip-minimize").addEventListener("click", window.PriTestNightEventChips.minimizeEventChipModal);
    document.getElementById("btn-event-chip-modal-close").addEventListener("click", window.PriTestNightEventChips.closeEventChipModal);
    document.getElementById("btn-event-chip-restore").addEventListener("click", window.PriTestNightEventChips.restoreEventChipModal);
    document.getElementById("btn-potential-power-info").addEventListener("click", window.PriTestNightPotentialPower.openPotentialPowerModal);
    document.getElementById("btn-potential-power-modal-close").addEventListener("click", window.PriTestNightPotentialPower.closePotentialPowerModal);
    document.getElementById("btn-main-menu-draw-weapon").addEventListener("click", function () {
      openMainMenuDrawModal("weapon");
    });
    document.getElementById("btn-main-menu-draw-talisman").addEventListener("click", function () {
      openMainMenuDrawModal("talisman");
    });
    document.getElementById("btn-main-menu-draw-consumable").addEventListener("click", function () {
      openMainMenuDrawModal("consumable");
    });
    document.getElementById("btn-tts-toggle").addEventListener("click", function () {
      setTtsEnabled(!ttsEnabled);
    });
    renderTtsToggleButton();
    document.getElementById("btn-dice-animation-toggle").addEventListener("click", function () {
      setDiceAnimationEnabled(!diceAnimationEnabled);
    });
    renderDiceAnimationToggleButton();
    document.getElementById("btn-turn-board-toggle").addEventListener("click", function () {
      setTurnBoardEnabled(!state.turnBoardEnabled);
    });
    document.getElementById("btn-auto-gm-toggle").addEventListener("click", handleAutoGmToggleClick);
    document.getElementById("btn-auto-gm-boss-form-toggle").addEventListener("click", handleAutoGmBossFormToggleClick);
    document.querySelectorAll(".log-drawer-tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchLogDrawerTab(btn.getAttribute("data-log-tab"));
      });
    });
    document.getElementById("btn-reset-all-dice").addEventListener("click", handleResetAllDice);
    document.getElementById("btn-main-menu-draw-close").addEventListener("click", closeMainMenuDrawModal);
    document.getElementById("btn-item-draw-modal-close").addEventListener("click", closeItemDrawModal);
    document.getElementById("btn-item-draw-modal-minimize").addEventListener("click", minimizeItemDrawModal);
    document.getElementById("btn-item-draw-modal-restore").addEventListener("click", restoreItemDrawModal);
    document.getElementById("btn-dice-hand-draw-random").addEventListener("click", window.PriTestNightFloorBreakthrough.handleDiceHandDrawRandom);
    document.getElementById("btn-dice-hand-draw-judge").addEventListener("click", window.PriTestNightFloorBreakthrough.handleDiceHandDrawJudge);
    document.getElementById("btn-dice-hand-draw-minimize").addEventListener("click", window.PriTestNightFloorBreakthrough.minimizeDiceHandDrawModal);
    document.getElementById("btn-dice-hand-draw-close").addEventListener("click", window.PriTestNightFloorBreakthrough.closeDiceHandDrawModal);
    document.getElementById("btn-dice-hand-draw-restore").addEventListener("click", window.PriTestNightFloorBreakthrough.restoreDiceHandDrawModal);
    document.getElementById("btn-weapon-skill-reroll-modal-close").addEventListener("click", closeWeaponSkillRerollModal);
    document.getElementById("btn-potential-power-minimize").addEventListener("click", window.PriTestNightPotentialPower.minimizePotentialPowerModal);
    document.getElementById("btn-potential-power-restore").addEventListener("click", window.PriTestNightPotentialPower.restorePotentialPowerModal);
    document.getElementById("btn-floor-reward-modal-close").addEventListener("click", window.PriTestNightFloorBreakthrough.closeFloorRewardModal);
    document.getElementById("btn-floor-reward-minimize").addEventListener("click", window.PriTestNightFloorBreakthrough.minimizeFloorRewardModal);
    document.getElementById("btn-floor-reward-restore").addEventListener("click", window.PriTestNightFloorBreakthrough.restoreFloorRewardModal);
    document.querySelectorAll(".combat-action-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        combatModalAction = btn.dataset.action;
        combatDiceSelection = [];
        combatAttackState = null;
        combatSpecialAttackState = null;
        renderCombatModal();
      });
    });
    document.getElementById("btn-combat-modal-close").addEventListener("click", closeCombatModal);
    document.getElementById("btn-combat-modal-minimize").addEventListener("click", handleCombatModalMinimizeToggle);
    document.getElementById("btn-breakthrough-minimize").addEventListener("click", window.PriTestNightFloorBreakthrough.minimizeBreakthroughModal);
    document.getElementById("btn-breakthrough-restore").addEventListener("click", window.PriTestNightFloorBreakthrough.restoreBreakthroughModal);
    document.getElementById("btn-breakthrough-cancel").addEventListener("click", window.PriTestNightFloorBreakthrough.closeBreakthroughModal);
    document.getElementById("btn-breakthrough-reveal").addEventListener("click", window.PriTestNightFloorBreakthrough.revealBreakthroughTarget);
    document.getElementById("btn-breakthrough-pass").addEventListener("click", function () {
      window.PriTestNightFloorBreakthrough.resolveBreakthroughCheck(true);
    });
    document.getElementById("btn-breakthrough-fail").addEventListener("click", function () {
      window.PriTestNightFloorBreakthrough.resolveBreakthroughCheck(false);
    });
    document.getElementById("btn-ability-check-done").addEventListener("click", window.PriTestNightGmFlow.handleAbilityCheckDoneClick);
    document.getElementById("btn-cooperative-check-confirm").addEventListener("click", window.PriTestNightGmFlow.handleCooperativeCheckConfirmClick);
    document.getElementById("btn-branch-tally-confirm").addEventListener("click", window.PriTestNightGmFlow.handleBranchTallyConfirmClick);
    document.getElementById("breakthrough-target-input").addEventListener("input", window.PriTestNightFloorBreakthrough.renderBreakthroughCharacters);
    document.getElementById("breakthrough-perpc-checkbox").addEventListener("change", window.PriTestNightFloorBreakthrough.renderBreakthroughCharacters);
    document.getElementById("breakthrough-stat-select").addEventListener("change", window.PriTestNightFloorBreakthrough.renderBreakthroughCharacters);
    document.getElementById("battle-drawer-backdrop").addEventListener("click", closeBattleDrawer);
    document.getElementById("bag-drawer-backdrop").addEventListener("click", closeBagDrawer);
    document.getElementById("battle-enemy-search-input").addEventListener("input", renderBattleEnemySearchResults);
    document.getElementById("btn-battle-add-mob-row").addEventListener("click", handleAddMobRow);
    document.getElementById("battle-guard-calc-target-select").addEventListener("change", renderBattleGuardCalc);
    document.getElementById("btn-battle-guard-calc-apply").addEventListener("click", handleBattleGuardCalcApply);
    document.getElementById("btn-battle-clear").addEventListener("click", handleBattleClear);
    document.getElementById("btn-dice-pool-add").addEventListener("click", handleAddDice);
    // 靈體管理／屬性痕管理を開くボタンは、キャラ個人の骰子池横（renderCharacterRoster内）に
    // キャラごとに動的生成されるため、ここではモーダルの閉じるボタンのみ配線する。
    document.getElementById("btn-spirit-panel-close").addEventListener("click", closeSpiritPanel);
    document.getElementById("btn-element-mark-panel-close").addEventListener("click", closeElementMarkPanel);
    document.getElementById("btn-action-phase").addEventListener("click", openActionPhaseModal);
    document.getElementById("btn-turn-holder-toggle").addEventListener("click", handleTurnHolderToggle);
    document.getElementById("btn-turn-message-send").addEventListener("click", handleTurnMessageSend);
    document.getElementById("btn-turn-message-history").addEventListener("click", openTurnMessageHistoryModal);
    document.getElementById("btn-turn-message-history-close").addEventListener("click", closeTurnMessageHistoryModal);
    document.getElementById("btn-turn-reward-open").addEventListener("click", openTurnRewardModal);
    document.getElementById("btn-turn-reward-modal-close").addEventListener("click", closeTurnRewardModal);
    document.getElementById("btn-turn-reward-modal-minimize").addEventListener("click", minimizeTurnRewardModal);
    document.getElementById("btn-turn-reward-restore").addEventListener("click", restoreTurnRewardModal);
    document.getElementById("btn-turn-reward-add").addEventListener("click", handleTurnRewardAdd);
    document.getElementById("btn-action-phase-cancel").addEventListener("click", closeActionPhaseModal);
    document.getElementById("btn-generic-check").addEventListener("click", window.PriTestNightFloorBreakthrough.openGenericCheckModal);
    document.getElementById("btn-enemy-damage-open").addEventListener("click", openEnemyDamageModal);
    document.getElementById("btn-enemy-damage-cancel").addEventListener("click", closeEnemyDamageModal);
    document.getElementById("btn-auto-gm-roll").addEventListener("click", handleAutoGmRollClick);
    document.getElementById("btn-function-menu-toggle").addEventListener("click", function () {
      var list = document.getElementById("function-menu-list");
      var open = list.classList.toggle("open");
      this.textContent = open ? "◀" : "▶";
    });
    // 主選單（返回角色列表／回到上一晚／下一晚／新遊戲／戰場面板）：項目を押したら自動的に閉じる。
    document.getElementById("btn-main-menu-toggle").addEventListener("click", function () {
      document.getElementById("main-menu-list").classList.toggle("open");
    });
    document.getElementById("main-menu-list").addEventListener("click", function () {
      this.classList.remove("open");
    });
    // 「設定」はサブメニューを開閉するだけのトグルなので、押しても主選單自体は閉じない
    // （e.stopPropagationでmain-menu-listの全体クローズ処理をブロックする）。
    document.getElementById("btn-settings-menu-toggle").addEventListener("click", function (e) {
      e.stopPropagation();
      var submenu = document.getElementById("settings-submenu");
      submenu.hidden = !submenu.hidden;
    });
    document.querySelectorAll(".action-phase-grid button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        // 戰鬥フェイズから額外行動を経由せず直接防禦フェイズへ進もうとした場合、額外行動の
        // 条件（いずれかの敵HP段が撃破済み）を満たしているのにまだ額外行動を使っていなければ、
        // 本当にスキップしてよいかGMに確認する（額外→防禦の通常進行時は確認しない）。
        if (
          btn.dataset.phase === "defense" &&
          state.actionPhase === "combat" &&
          anyEnemyHpRowDepleted() &&
          !window.confirm(window.I18N.t("action_phase_skip_extra_confirm"))
        ) {
          return;
        }
        setActionPhase(btn.dataset.phase);
      });
    });
    document.getElementById("btn-smithing-stone-minus").addEventListener("click", function () {
      adjustSmithingStoneCount(-1);
    });
    document.getElementById("btn-smithing-stone-plus").addEventListener("click", function () {
      adjustSmithingStoneCount(1);
    });
    document.getElementById("btn-stonesword-key-minus").addEventListener("click", function () {
      adjustStoneswordKeyCount(-1);
    });
    document.getElementById("btn-stonesword-key-plus").addEventListener("click", function () {
      adjustStoneswordKeyCount(1);
    });
    document.getElementById("input-grace").addEventListener("input", function (e) {
      state.grace = e.target.value;
      saveState();
    });
    ["start", "end"].forEach(function (pos) {
      var pileBtn = document.getElementById("pile-" + pos);
      var pilePressTimer = null;
      var pileLongPressFired = false;
      pileBtn.addEventListener("pointerdown", function () {
        pileLongPressFired = false;
        pilePressTimer = setTimeout(function () {
          pileLongPressFired = true;
          onPileClick(pos);
        }, SLOT_LONG_PRESS_MS);
      });
      pileBtn.addEventListener("pointerup", function () {
        clearTimeout(pilePressTimer);
        if (!pileLongPressFired) onPileShortClick(pos);
      });
      pileBtn.addEventListener("pointerleave", function () {
        clearTimeout(pilePressTimer);
      });
      pileBtn.addEventListener("pointercancel", function () {
        clearTimeout(pilePressTimer);
      });
    });
    ["start", "end"].forEach(function (which) {
      ["one", "all"].forEach(function (field) {
        document.getElementById("pile-check-" + which + "-" + field).addEventListener("change", function (e) {
          if (which === "start" && state.startDefeated) {
            renderStartPile();
            return;
          }
          var checks = which === "start" ? state.startChecks : state.endChecks;
          checks[field] = e.target.checked;
          if (field === "all") {
            var pileLabel = window.I18N.t(which === "start" ? "start_point_label" : "end_point_label");
            addLog(e.target.checked ? "log_pile_all_check" : "log_pile_all_uncheck", { pile: pileLabel });
          } else {
            saveState();
          }
        });
      });
    });

    window.addEventListener("i18n:change", function () {
      renderBoard();
      renderLog();
      renderLogToggleLabel();
      renderRosterSkillsToggleLabel();
      renderSelectScreen();
      renderBattleRefTexts();
      window.PriTestNightRulebook.renderBossRulebook();
      window.PriTestNightWeaponRulebook.renderWeaponRulebookAll();
      window.PriTestNightRulebook.renderTalismanAcquisitionTable();
      window.PriTestNightRulebook.renderTalismanRulebook();
      window.PriTestNightRulebook.renderConsumableDetermineTable();
      window.PriTestNightRulebook.renderConsumableRulebook();
      window.PriTestNightRulebook.renderEnemyRulebookAll();
      window.PriTestNightRulebook.renderFieldRulebook();
      window.PriTestNightRulebook.renderEventRulebook();
      window.PriTestNightRulebook.renderWorldviewRulebook();
      window.PriTestNightRulebook.renderCommandsRulebook();
      renderSelectedEnemies();
    });
  });
})();

