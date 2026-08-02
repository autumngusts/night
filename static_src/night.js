(function () {
  var SUITS = ["S", "H", "D", "C"];
  var SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  var SUIT_CLASS = { S: "suit-black", H: "suit-red", D: "suit-orange", C: "suit-green" };
  var SUIT_CLASSES = ["suit-black", "suit-red", "suit-orange", "suit-green"];
  var RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var SLOT_COUNT = 9;
  // 新規ゲーム開始時、現在地（focusedIndex）の初期位置とする左列中段のマス
  // （盤面レイアウトはstyle.cssの.slot-wrap-3が左列・中段に対応）。
  var BOARD_LEFT_SLOT = 3;
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
  var activeWeaponSubTab = "acquisition";
  var LEVEL_STEPS = [null, 0, 1, 2, 3, 4, 5]; // null = "全"（未指定）

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
  function renderRosterDiceDisplay(c, container) {
    container.innerHTML = "";
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

    entered.forEach(function (c) {
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
          saveRosterCharacters();
          renderCharacterRoster();
        });
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
      var diceStatus = document.createElement("p");
      diceStatus.className = "dice-status-label";
      CharacterDrawer.renderDiceStatusLabel(diceStatus, c.dicePool || []);
      diceCol.appendChild(diceStatus);
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
          saveRosterCharacters();
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
      var weaponTitle = document.createElement("h5");
      weaponTitle.textContent = window.I18N.t("character_weapons_label");
      var weaponWrap = document.createElement("div");
      weaponWrap.className = "roster-weapon-list";
      CharacterDrawer.renderRosterWeaponList(c, weaponWrap);
      weaponCol.appendChild(weaponTitle);
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
      enemyHp: new Array(ENEMY_HP_ROWS * ENEMY_HP_COLS).fill(false),
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

  function rollEventChips() {
    return shuffle(EVENT_CHIP_TYPES.map(function (c) { return c.id; }));
  }

  var state = {
    slots: new Array(SLOT_COUNT).fill(null), // { code, revealed } | null
    cardLevels: new Array(SLOT_COUNT).fill(null), // null("全") | 0-5
    eventChips: new Array(SLOT_COUNT).fill(null), // 各マスのイベントチット（翻開まで非公開）
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
    turnHolder: "gm", // "gm"|"players"（GM/玩家が同時にプレイしなくても各自の番で行動できるようにする受け渡しフラグ）
    turnMessages: [], // {text, time}の配列。現在の番の間だけ積み重なり、番の終了確認時にクリアされる
    turnRewards: [], // {id, text, checked}の配列。地板獎勵とは無関係の獨立勾選清單、手動削除まで保持
    turnBoardEnabled: true, // 主選單から行動留言板機能全体を開閉するフラグ
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
      slots: state.slots,
      cardLevels: state.cardLevels,
      eventChips: state.eventChips,
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
      turnHolder: state.turnHolder,
      turnMessages: state.turnMessages,
      turnRewards: state.turnRewards,
      turnBoardEnabled: state.turnBoardEnabled,
    };
  }

  function saveState() {
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
    var hpTotal = ENEMY_HP_ROWS * ENEMY_HP_COLS;
    var enemyHp = Array.isArray(raw.enemyHp) ? raw.enemyHp.slice(0, hpTotal).map(Boolean) : fallback.enemyHp.slice();
    while (enemyHp.length < hpTotal) enemyHp.push(false);
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
    return {
      front: front,
      back: back,
      aggro: aggro,
      enemyHp: enemyHp,
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

  // state.battle.selectedEnemyIds（"familyId|enemyId|level"）を、目標選択UIやパネル表示に使う
  // {key, name}の配列へ解決する。
  function resolveSelectedEnemyOptions() {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return [];
    var T = Enemies.localizedText;
    return ((state.battle && state.battle.selectedEnemyIds) || [])
      .map(function (key) {
        var parts = key.split("|");
        var info = Enemies.get(parts[0], parts[1]);
        return info ? { key: key, name: T(info.enemy.name) + "（Lv." + parts[2] + "）" } : null;
      })
      .filter(Boolean);
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
  // 屬性/異常名の配列へ分割する。
  function enemyWeaknessLabels(enemyKey) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies || !enemyKey) return [];
    var parts = enemyKey.split("|");
    var info = Enemies.get(parts[0], parts[1]);
    if (!info) return [];
    var weakness = extractWeakness(info.enemy.special, Enemies.localizedText);
    if (!weakness) return [];
    return weakness.split(/[＆、,]/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
  }

  function attributeStatusThresholdForEnemy(enemyKey, label) {
    var weaknesses = enemyWeaknessLabels(enemyKey);
    var isWeak = weaknesses.indexOf(label) !== -1;
    return isWeak ? ATTRIBUTE_STATUS_WEAKNESS_THRESHOLD : ATTRIBUTE_STATUS_BASE_THRESHOLD;
  }

  // enemyKeyに紐付くHP行番号を返す（選択順=行、ENEMY_HP_ROWS段を超える分は紐付け不可）。
  function enemyHpRowIndexForKey(enemyKey) {
    var ids = (state.battle && state.battle.selectedEnemyIds) || [];
    var idx = ids.indexOf(enemyKey);
    if (idx === -1 || idx >= ENEMY_HP_ROWS) return -1;
    return idx;
  }

  function enemyDisplayNameForKey(enemyKey) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return enemyKey;
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

  // 敵人のHP行をcount個（0扣分）扣除する。紐付け行が無ければ何もしない（GMへログのみ残る）。
  function damageEnemyHpForKey(enemyKey, count) {
    var rowIdx = enemyHpRowIndexForKey(enemyKey);
    if (rowIdx === -1) return false;
    adjustEnemyHpRow(rowIdx, count);
    return true;
  }

  // 敵人のHP行を丸ごと扣光する（體崩／擊破で使う）。
  function depleteEnemyHpRowForKey(enemyKey) {
    return damageEnemyHpForKey(enemyKey, ENEMY_HP_COLS);
  }

  function applyAttributeStatusElementTriggerOnEnemy(enemyKey, label) {
    damageEnemyHpForKey(enemyKey, 1);
    addLog("log_attribute_status_element_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey), label: label });
    renderEnemyHpGrid();
  }

  function applyAttributeStatusAilmentTriggerOnEnemy(enemyKey, label) {
    if (label === ATTRIBUTE_STATUS_SLEEP_LABEL) {
      depleteEnemyHpRowForKey(enemyKey);
      if (!state.battle.enemyDmgOverride) state.battle.enemyDmgOverride = {};
      state.battle.enemyDmgOverride[enemyKey] = (state.battle.enemyDmgOverride[enemyKey] || 0) - 300;
      addLog("log_attribute_status_sleep_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey) });
    } else if (label === ATTRIBUTE_STATUS_DEATH_CURSE_LABEL) {
      if (enemyIsAttackerFamily(enemyKey)) {
        depleteEnemyHpRowForKey(enemyKey);
        addLog("log_attribute_status_death_curse_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey) });
      }
      // 「襲擊者」以外の敵人は無效果（何もしない）。
    } else {
      damageEnemyHpForKey(enemyKey, 2);
      addLog("log_attribute_status_ailment_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey), label: label });
    }
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
    addLog("log_attribute_status_element_trigger_char", { name: c.name, label: label });
  }

  function applyAttributeStatusAilmentTriggerOnChar(characterId, label) {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (!c) return;
    applyUnyieldingStack(c);
    if (label === ATTRIBUTE_STATUS_SLEEP_LABEL) {
      c._nextActionDicePenalty = (c._nextActionDicePenalty || 0) + 3;
      addLog("log_attribute_status_sleep_trigger_char", { name: c.name });
    } else if (label === ATTRIBUTE_STATUS_DEATH_CURSE_LABEL) {
      c.hp.current = 0;
      c._nearDeath = true;
      addLog("log_attribute_status_death_curse_trigger_char", { name: c.name });
    } else {
      c.hp.current = Math.max(0, (c.hp.current || 0) - 2);
      addLog("log_attribute_status_ailment_trigger_char", { name: c.name, label: label });
    }
    saveRosterCharacters();
    renderCharacterRoster();
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
    if (!state.battle.attributeStatus) state.battle.attributeStatus = defaultBattleState().attributeStatus;
    var key = characterId + "|" + enemyKey + "|" + label;
    var as = state.battle.attributeStatus;
    as.dealt[key] = (as.dealt[key] || 0) + value;
    var accumKey = enemyKey + "|" + label;
    as.enemyAccum[accumKey] = (as.enemyAccum[accumKey] || 0) + value;
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
      if (Array.isArray(data.slots) && data.slots.length === SLOT_COUNT) {
        state.slots = data.slots;
      }
      if (Array.isArray(data.cardLevels) && data.cardLevels.length === SLOT_COUNT) {
        state.cardLevels = data.cardLevels;
      }
      if (Array.isArray(data.eventChips) && data.eventChips.length === SLOT_COUNT) {
        state.eventChips = data.eventChips;
      }
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
      state.turnHolder = ["gm", "players"].indexOf(data.turnHolder) !== -1 ? data.turnHolder : "gm";
      state.turnMessages = Array.isArray(data.turnMessages) ? data.turnMessages : [];
      state.turnRewards = Array.isArray(data.turnRewards) ? data.turnRewards : [];
      state.turnBoardEnabled = typeof data.turnBoardEnabled === "boolean" ? data.turnBoardEnabled : true;
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
    state.turnHolder = "gm";
    state.turnMessages = [];
    state.turnRewards = [];
    state.turnBoardEnabled = true;
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

  function addLog(key, params) {
    state.log.push({ key: key, params: params || {}, time: Date.now() });
    renderLog();
    saveState();
    speakLog(key, params);
  }

  // character_drawer.js（night.jsとは別クロージャ、night以外のページでも単独利用される）から
  // 任意でログへ記録できるようにするフック。存在確認つきで呼ばれるため、他ページでは無害。
  window.PriTestNightLog = addLog;

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

  function renderBossRulebook() {
    var container = document.getElementById("boss-rulebook-list");
    var Rulebook = window.PriTestBossRulebook;
    if (!container || !Rulebook) return;
    container.innerHTML = "";
    var T = CharacterTypes.localizedText;

    Rulebook.list().forEach(function (boss) {
      var details = document.createElement("details");
      details.className = "ability-entry";
      details.id = "boss-entry-" + boss.id;
      var summary = document.createElement("summary");
      summary.textContent = T(boss.name);
      details.appendChild(summary);

      var statLines = document.createElement("p");
      statLines.className = "threat-ref-body";
      statLines.textContent = [
        window.I18N.t("boss_level_label") + window.I18N.t("colon_separator") + boss.level,
        window.I18N.t("boss_size_label") + window.I18N.t("colon_separator") + T(boss.size),
        window.I18N.t("boss_hp_label") + window.I18N.t("colon_separator") + T(boss.hp),
        T(boss.guard),
        window.I18N.t("boss_weakness_label") + window.I18N.t("colon_separator") + T(boss.weakness),
        window.I18N.t("boss_resistance_label") + window.I18N.t("colon_separator") + T(boss.resistance),
      ].join("\n");
      details.appendChild(statLines);

      if (boss.specials && boss.specials.length) {
        var specialsTitle = document.createElement("p");
        specialsTitle.className = "boss-subheading";
        specialsTitle.textContent = window.I18N.t("boss_specials_label");
        details.appendChild(specialsTitle);
        boss.specials.forEach(function (sp) {
          var spEntry = document.createElement("details");
          spEntry.className = "ability-entry";
          var spSummary = document.createElement("summary");
          spSummary.textContent = T(sp.name);
          spEntry.appendChild(spSummary);
          var spBody = document.createElement("p");
          spBody.className = "threat-ref-body";
          spBody.textContent = T(sp.body);
          spEntry.appendChild(spBody);
          details.appendChild(spEntry);
        });
      }

      if (boss.additionalEffectTable) {
        var aetTitle = document.createElement("p");
        aetTitle.className = "boss-subheading";
        aetTitle.textContent = window.I18N.t("boss_additional_effect_label");
        details.appendChild(aetTitle);
        details.appendChild(buildBossTable(boss.additionalEffectTable.columns, boss.additionalEffectTable.rows, T));
      }

      var actionsTitle = document.createElement("p");
      actionsTitle.className = "boss-subheading";
      actionsTitle.textContent = window.I18N.t("boss_actions_label");
      details.appendChild(actionsTitle);
      details.appendChild(buildBossTable(boss.actionColumns, boss.actions, T));

      container.appendChild(details);
    });
  }

  // タリスマン獲得決定表（200-202頁）：1Dで表A/Bを決め、各表内をグループ→アイテムの
  // 2段階で振って1個を決定する参考資料。ゲーム内でダイスを振らせる機能ではなく、GM向けの一覧表示。
  function renderTalismanAcquisitionTable() {
    var container = document.getElementById("talisman-acquisition-table");
    var Talismans = window.PriTestTalismans;
    if (!container || !Talismans) return;
    container.innerHTML = "";

    var note = document.createElement("p");
    note.className = "threat-ref-body";
    note.textContent = window.I18N.t("talisman_acquisition_note");
    container.appendChild(note);

    var tables = Talismans.acquisitionTables();
    [
      { label: window.I18N.t("talisman_acquisition_table_a_label"), groups: tables.groupsA },
      { label: window.I18N.t("talisman_acquisition_table_b_label"), groups: tables.groupsB },
    ].forEach(function (table) {
      var heading = document.createElement("p");
      heading.className = "boss-subheading";
      heading.textContent = table.label;
      container.appendChild(heading);

      table.groups.forEach(function (rows, groupIndex) {
        var groupBlock = document.createElement("details");
        groupBlock.className = "ability-entry";
        var summary = document.createElement("summary");
        summary.textContent = window.I18N.t("talisman_acquisition_group_label", { n: groupIndex + 1 });
        groupBlock.appendChild(summary);
        var itemList = document.createElement("ul");
        rows.forEach(function (row) {
          var talisman = Talismans.get(row.id);
          var li = document.createElement("li");
          li.textContent = "[" + row.roll + "] " + (talisman ? Talismans.localizedText(talisman.name) : row.id);
          itemList.appendChild(li);
        });
        groupBlock.appendChild(itemList);
        container.appendChild(groupBlock);
      });
    });
  }

  // タリスマン（装飾品）一覧の参考資料タブ。武器と異なり単体でPassive効果を1つ持つだけ。
  function renderTalismanRulebook() {
    var container = document.getElementById("talisman-rulebook-list");
    var Talismans = window.PriTestTalismans;
    if (!container || !Talismans) return;
    container.innerHTML = "";

    Talismans.list().forEach(function (talisman) {
      var details = document.createElement("details");
      details.className = "ability-entry";
      var summary = document.createElement("summary");
      summary.textContent = Talismans.localizedText(talisman.name);
      details.appendChild(summary);
      var body = document.createElement("p");
      body.className = "threat-ref-body";
      body.textContent = Talismans.localizedText(talisman.body);
      details.appendChild(body);
      container.appendChild(details);
    });
  }

  // 消耗品一覧の参考資料タブ。タリスマンと似た単純な構造（名称＋効果）。
  function renderConsumableRulebook() {
    var container = document.getElementById("consumable-rulebook-list");
    var Consumables = window.PriTestConsumables;
    if (!container || !Consumables) return;
    container.innerHTML = "";

    Consumables.list().forEach(function (item) {
      var details = document.createElement("details");
      details.className = "ability-entry";
      var summary = document.createElement("summary");
      summary.textContent = Consumables.localizedText(item.name);
      details.appendChild(summary);
      var body = document.createElement("p");
      body.className = "threat-ref-body";
      body.textContent = Consumables.localizedText(item.body);
      details.appendChild(body);
      container.appendChild(details);
    });
  }

  // 消耗品決定表（ダイス2回、d66形式）の参考資料。
  function renderConsumableDetermineTable() {
    var container = document.getElementById("consumable-determine-table");
    var Consumables = window.PriTestConsumables;
    if (!container || !Consumables) return;
    container.innerHTML = "";
    var table = Consumables.determineTable();
    container.appendChild(buildBossTable(table.columns, table.rows, window.PriTestConsumables.localizedText));
  }

  // エネミー（通常討伐対象）一覧の参考資料タブ。系統別サブタブ＋名前検索。
  var activeEnemyFamily = "all";

  function setupEnemyFamilyTabs() {
    var tabsContainer = document.getElementById("enemy-family-subtabs");
    var Enemies = window.PriTestEnemies;
    if (!tabsContainer || !Enemies) return;
    tabsContainer.innerHTML = "";

    var tabs = [{ id: "all", label: window.I18N.t("enemy_family_all_label") }].concat(
      Enemies.listFamilies().map(function (fam) {
        return { id: fam.id, label: Enemies.localizedText(fam.name) };
      })
    );

    tabs.forEach(function (tab) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "weapon-subtab-btn" + (tab.id === activeEnemyFamily ? " active" : "");
      btn.setAttribute("data-subtab", tab.id);
      btn.textContent = tab.label;
      btn.addEventListener("click", function () {
        activeEnemyFamily = tab.id;
        setupEnemyFamilyTabs();
        renderEnemyRulebookList();
      });
      tabsContainer.appendChild(btn);
    });
  }

  function buildEnemyActionTable(enemy) {
    var Enemies = window.PriTestEnemies;
    var T = Enemies.localizedText;
    var hasNote = (enemy.actions || []).some(function (a) {
      return a.note;
    });
    var columns = [
      { ja: "出目", zh: "點數" },
      { ja: "アクション名", zh: "招式名稱" },
      { ja: "乱戦ダメージ修正", zh: "亂戰傷害修正" },
    ];
    if (hasNote) columns.push({ ja: "乱戦ダメージへの注釈、個別ダメージなど", zh: "亂戰傷害注釋、個別傷害等" });
    var rows = (enemy.actions || []).map(function (a) {
      var row = [{ ja: a.roll, zh: a.roll }, a.name, { ja: a.mod || "—", zh: a.mod || "—" }];
      if (hasNote) row.push(a.note || { ja: "", zh: "" });
      return row;
    });
    var wrap = document.createElement("div");
    wrap.className = "field-variance-wrap";
    wrap.appendChild(buildBossTable(columns, rows, T));
    return wrap;
  }

  // 系統共通の「レベル／HP枠／乱戦ダメージ」基礎データ表（fam.baseがある系統のみ表示）。
  // 各等級のHP枠／亂戰傷害を表示するテーブル（<details>で折りたたみ可能）。
  // 戦場面板の敵検索結果（renderBattleEnemyLookupResult）と規則書（buildEnemyBaseTable）の
  // 両方でこの同じ関数を使うことで、見出し文言・列見出し・表の見た目を完全に統一する。
  function buildEnemyLevelTable(familyBase) {
    var levelDetails = document.createElement("details");
    levelDetails.className = "ability-entry";
    var levelSummary = document.createElement("summary");
    levelSummary.textContent = window.I18N.t("enemy_level_table_toggle_label");
    levelDetails.appendChild(levelSummary);

    var table = document.createElement("table");
    table.className = "boss-action-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [window.I18N.t("enemy_level_label"), window.I18N.t("enemy_hp_label"), window.I18N.t("enemy_melee_damage_label")].forEach(function (
      label
    ) {
      var th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var hasHp = false;
    (familyBase || []).forEach(function (lv) {
      if (lv.hp) hasHp = true;
      var tr = document.createElement("tr");
      var tdLevel = document.createElement("td");
      tdLevel.textContent = lv.level;
      tr.appendChild(tdLevel);
      var tdHp = document.createElement("td");
      tdHp.textContent = lv.hp || "—";
      tr.appendChild(tdHp);
      var tdDmg = document.createElement("td");
      tdDmg.textContent = lv.dmg != null ? lv.dmg : "—";
      tr.appendChild(tdDmg);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var wrap = document.createElement("div");
    wrap.className = "boss-table-scroll";
    wrap.appendChild(table);
    levelDetails.appendChild(wrap);

    if (!hasHp) {
      var note = document.createElement("p");
      note.className = "threat-ref-body";
      note.textContent = window.I18N.t("enemy_hp_unavailable_note");
      levelDetails.appendChild(note);
    }
    return levelDetails;
  }

  function buildEnemyBaseTable(fam) {
    return buildEnemyLevelTable(fam.base);
  }

  // 系統共通の「ガード回数／HP価値」参考表（データがある系統のみ表示）。
  // row.value は通常レベルによらず一定の数値だが、一部の系統（結晶人・人形兵系、ゴーレム・乙女人形系、
  // 小姓・卑兵系など）は原本の基礎データ表でレベルごとにHP価値が異なるため、その場合は
  // row.value に15要素（Lv.1〜15）の配列を指定する。配列を持つ行が1つでもあれば、
  // レベル別の列を持つ表を表示する（配列でない行は全レベル同じ値として扱う）。
  function buildEnemyGuardValueTable(fam) {
    var Enemies = window.PriTestEnemies;
    var T = Enemies.localizedText;
    var hasByLevel = fam.guardValueTable.some(function (row) {
      return Array.isArray(row.value);
    });

    function fmt(row, value) {
      return row.theoretical ? "（" + value + "）" : String(value);
    }

    var columns, rows;
    if (hasByLevel) {
      columns = [{ ja: "ガード回数", zh: "防禦次數" }];
      for (var lv = 1; lv <= 15; lv++) {
        columns.push({ ja: "Lv." + lv, zh: "Lv." + lv });
      }
      rows = fam.guardValueTable.map(function (row) {
        var cells = [row.count];
        for (var i = 0; i < 15; i++) {
          var v = Array.isArray(row.value) ? row.value[i] : row.value;
          var text = fmt(row, v);
          cells.push({ ja: text, zh: text });
        }
        return cells;
      });
    } else {
      columns = [
        { ja: "ガード回数", zh: "防禦次數" },
        { ja: "HP価値", zh: "HP價值" },
      ];
      rows = fam.guardValueTable.map(function (row) {
        var valueText = fmt(row, row.value);
        return [row.count, { ja: valueText, zh: valueText }];
      });
    }

    var wrap = document.createElement("div");
    wrap.className = "field-variance-wrap";
    wrap.appendChild(buildBossTable(columns, rows, T));
    return wrap;
  }

  // 系統（大分類）／エネミー（中分類）へのジャンプボタンを並べた目次。現在の検索・サブタブの絞り込み結果と連動する。
  function renderEnemyNav(container, matchedFamilies, T) {
    var nav = document.createElement("div");
    nav.className = "field-nav";
    matchedFamilies.forEach(function (row) {
      var famEntry = document.createElement("div");
      famEntry.className = "field-nav-card";

      var famLink = document.createElement("button");
      famLink.type = "button";
      famLink.className = "field-nav-card-link";
      famLink.textContent = T(row.fam.name);
      famLink.addEventListener("click", function () {
        var target = document.getElementById("enemy-family-" + row.fam.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      famEntry.appendChild(famLink);

      var enemyList = document.createElement("div");
      enemyList.className = "field-nav-branch-list";
      row.enemies.forEach(function (enemy) {
        var enemyLink = document.createElement("button");
        enemyLink.type = "button";
        enemyLink.className = "field-nav-branch-link";
        enemyLink.textContent = T(enemy.name);
        enemyLink.addEventListener("click", function () {
          var target = document.getElementById("enemy-entry-" + row.fam.id + "-" + enemy.id);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        enemyList.appendChild(enemyLink);
      });
      famEntry.appendChild(enemyList);

      nav.appendChild(famEntry);
    });
    container.appendChild(nav);
  }

  function renderEnemyRulebookList() {
    var container = document.getElementById("enemy-rulebook-list");
    var Enemies = window.PriTestEnemies;
    if (!container || !Enemies) return;
    var T = Enemies.localizedText;
    container.innerHTML = "";

    var query = (document.getElementById("enemy-rulebook-search-input") || {}).value || "";
    var q = query.trim().toLowerCase();

    var matchedFamilies = Enemies.listFamilies()
      .filter(function (fam) {
        return activeEnemyFamily === "all" || activeEnemyFamily === fam.id;
      })
      .map(function (fam) {
        var famEnemies = fam.enemies.filter(function (e) {
          if (!q) return true;
          var n = e.name;
          return (n.ja && n.ja.toLowerCase().indexOf(q) !== -1) || (n.zh && n.zh.toLowerCase().indexOf(q) !== -1);
        });
        return { fam: fam, enemies: famEnemies };
      })
      .filter(function (row) {
        return row.enemies.length > 0;
      });

    renderEnemyNav(container, matchedFamilies, T);

    matchedFamilies.forEach(function (row) {
      var fam = row.fam;
      var famEnemies = row.enemies;

      var famHeading = document.createElement("p");
      famHeading.className = "boss-subheading";
      famHeading.id = "enemy-family-" + fam.id;
      famHeading.textContent = T(fam.name);
      container.appendChild(famHeading);

      if (fam.base) {
        container.appendChild(buildEnemyBaseTable(fam));
      }

      if (fam.note) {
        var noteP = document.createElement("p");
        noteP.className = "threat-ref-body";
        noteP.textContent = T(fam.note);
        container.appendChild(noteP);
      }

      if (fam.guardValueTable) {
        if (fam.guardCount != null) {
          var guardCountP = document.createElement("p");
          guardCountP.className = "threat-ref-body";
          guardCountP.textContent =
            window.I18N.t("enemy_guard_count_label") + window.I18N.t("colon_separator") + fam.guardCount;
          container.appendChild(guardCountP);
        }
        container.appendChild(buildEnemyGuardValueTable(fam));
      }

      famEnemies.forEach(function (enemy) {
        var details = document.createElement("details");
        details.className = "ability-entry";
        details.id = "enemy-entry-" + fam.id + "-" + enemy.id;
        var summary = document.createElement("summary");
        summary.textContent = T(enemy.name);
        details.appendChild(summary);

        var imgSrc = Enemies.imagePath(enemy);
        if (imgSrc) {
          var img = document.createElement("img");
          img.className = "enemy-portrait";
          img.src = imgSrc;
          img.alt = T(enemy.name);
          details.appendChild(img);
        }

        var statLines = document.createElement("p");
        statLines.className = "threat-ref-body";
        var lines = [window.I18N.t("enemy_size_label") + window.I18N.t("colon_separator") + (enemy.size || "-")];
        if (enemy.resistance) {
          lines.push(window.I18N.t("enemy_resistance_label") + window.I18N.t("colon_separator") + T(enemy.resistance));
        }
        statLines.textContent = lines.join("\n");
        details.appendChild(statLines);

        var actionsTitle = document.createElement("p");
        actionsTitle.className = "boss-subheading";
        actionsTitle.textContent = window.I18N.t("boss_actions_label");
        details.appendChild(actionsTitle);
        details.appendChild(buildEnemyActionTable(enemy));

        if (enemy.special) {
          var spTitle = document.createElement("p");
          spTitle.className = "boss-subheading";
          spTitle.textContent = window.I18N.t("boss_specials_label");
          details.appendChild(spTitle);
          var spBody = document.createElement("p");
          spBody.className = "threat-ref-body";
          spBody.textContent = T(enemy.special);
          details.appendChild(spBody);
        }

        container.appendChild(details);
      });
    });
  }

  function renderEnemyRulebookAll() {
    setupEnemyFamilyTabs();
    renderEnemyRulebookList();
    var searchInput = document.getElementById("enemy-rulebook-search-input");
    if (searchInput && !searchInput.dataset.wired) {
      searchInput.dataset.wired = "1";
      searchInput.addEventListener("input", renderEnemyRulebookList);
    }
  }

  // マップ盤面（フィールド）カードの参考資料タブ。1行＝L(depth, label, text, bullet)。
  // depth 0＝通常記述、1〜3＝「→」「→→」「→→→」に相当するイベント／小イベントの分岐（背景色で強調）。
  function renderFieldLine(container, line, T) {
    var depth = Math.min(line.depth || 0, 3);
    var p = document.createElement("p");
    p.className = "field-line field-line-d" + depth + (line.bullet ? " field-line-bullet" : "");
    var prefix = "";
    if (line.bullet) {
      prefix = "・";
    } else if (depth > 0) {
      for (var i = 0; i < depth; i++) prefix += "→";
    }
    var text = prefix;
    if (line.label) text += "【" + T(line.label) + "】";
    text += T(line.text);
    p.textContent = text;
    container.appendChild(p);
  }

  function renderFieldCard(container, card, T) {
    var block = document.createElement("div");
    block.className = "field-card-block";
    block.id = "field-card-" + card.id;

    var h = document.createElement("h3");
    h.className = "field-card-title";
    h.textContent = "【" + card.cardLabel + "】" + T(card.name);
    block.appendChild(h);

    var metaParts = [];
    if (card.floorCount != null) {
      metaParts.push(window.I18N.t("field_floor_count_label") + window.I18N.t("colon_separator") + card.floorCount);
    }
    if (card.allFloorEffect) {
      metaParts.push(
        window.I18N.t("field_all_floor_effect_label") + window.I18N.t("colon_separator") + T(card.allFloorEffect)
      );
    }
    if (metaParts.length) {
      var metaP = document.createElement("p");
      metaP.className = "field-card-meta";
      metaP.textContent = metaParts.join("　");
      block.appendChild(metaP);
    }

    if (card.varianceNote) {
      var noteP = document.createElement("p");
      noteP.className = "threat-ref-body";
      noteP.textContent = T(card.varianceNote);
      block.appendChild(noteP);
    }

    if (card.varianceTable) {
      block.appendChild(buildBossTable(card.varianceTable.columns, card.varianceTable.rows, T));
    }

    (card.branches || []).forEach(function (branch, branchIndex) {
      var branchDiv = document.createElement("div");
      branchDiv.className = "field-branch";
      branchDiv.id = "field-branch-" + card.id + "-" + branchIndex;

      var tag = document.createElement("span");
      tag.className = "field-region-tag";
      tag.textContent = T(branch.name);
      branchDiv.appendChild(tag);

      if (branch.intro) {
        var introP = document.createElement("p");
        introP.className = "field-branch-intro";
        introP.textContent = T(branch.intro);
        branchDiv.appendChild(introP);
      }

      if (branch.specialRule) {
        var ruleP = document.createElement("p");
        ruleP.className = "field-branch-intro";
        ruleP.textContent = T(branch.specialRule);
        branchDiv.appendChild(ruleP);
      }

      (branch.floorPreviews || []).forEach(function (preview) {
        var pv = document.createElement("p");
        pv.className = "field-branch-intro";
        pv.textContent = "＞" + T(preview.label) + "：" + T(preview.title) + "\n" + T(preview.text);
        branchDiv.appendChild(pv);
      });

      (branch.floors || []).forEach(function (floor, floorIndex) {
        // 場地報酬「獲得済み」の永続化キー：カード/分岐/フロアを一意に識別する。
        floor.__rewardKey = card.id + "_" + branchIndex + "_" + floorIndex;
        var floorDiv = document.createElement("div");
        floorDiv.className = "field-floor";

        var marker = document.createElement("div");
        marker.className = "field-floor-marker";
        marker.textContent = T(floor.label) + (floor.title ? "　" : "");
        if (floor.title) {
          var titleSpan = document.createElement("span");
          titleSpan.className = "field-floor-title";
          titleSpan.textContent = T(floor.title);
          marker.appendChild(titleSpan);
        }
        floorDiv.appendChild(marker);

        (floor.lines || []).forEach(function (line) {
          renderFieldLine(floorDiv, line, T);
        });

        if (floor.reward) {
          var rewardBtn = document.createElement("button");
          rewardBtn.type = "button";
          rewardBtn.className = "field-floor-reward-btn";
          rewardBtn.textContent = window.I18N.t("floor_reward_open_button");
          rewardBtn.addEventListener("click", function () {
            openFloorRewardModal(floor);
          });
          floorDiv.appendChild(rewardBtn);
        }

        branchDiv.appendChild(floorDiv);
      });

      block.appendChild(branchDiv);
    });

    (card.extraNotes || []).forEach(function (note) {
      var noteBlock = document.createElement("div");
      noteBlock.className = "threat-ref-block";
      var noteH = document.createElement("h4");
      noteH.textContent = T(note.title);
      noteBlock.appendChild(noteH);
      var noteBody = document.createElement("p");
      noteBody.className = "threat-ref-body";
      noteBody.textContent = T(note.body);
      noteBlock.appendChild(noteBody);
      block.appendChild(noteBlock);
    });

    (card.extraTables || []).forEach(function (tbl) {
      var tblBlock = document.createElement("div");
      tblBlock.className = "threat-ref-block";
      var tblH = document.createElement("h4");
      tblH.textContent = T(tbl.title);
      tblBlock.appendChild(tblH);
      var tblWrap = document.createElement("div");
      tblWrap.className = "field-variance-wrap";
      tblWrap.appendChild(buildBossTable(tbl.columns, tbl.rows, T));
      tblBlock.appendChild(tblWrap);
      block.appendChild(tblBlock);
    });

    container.appendChild(block);
  }

  // カード（大分類）と分岐区域（中分類）へのジャンプボタンを並べた目次。
  // カードは同じcardLabel（例:「A」）を複数枚持ちうるため、カード単位（card.id）でリンク先を決める。
  function renderFieldNav(container, cards, T) {
    var nav = document.createElement("div");
    nav.className = "field-nav";
    cards.forEach(function (card) {
      var cardEntry = document.createElement("div");
      cardEntry.className = "field-nav-card";

      var cardLink = document.createElement("button");
      cardLink.type = "button";
      cardLink.className = "field-nav-card-link";
      cardLink.textContent = "【" + card.cardLabel + "】" + T(card.name);
      cardLink.addEventListener("click", function () {
        var target = document.getElementById("field-card-" + card.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      cardEntry.appendChild(cardLink);

      var branches = card.branches || [];
      if (branches.length) {
        var branchList = document.createElement("div");
        branchList.className = "field-nav-branch-list";
        branches.forEach(function (branch, branchIndex) {
          var branchLink = document.createElement("button");
          branchLink.type = "button";
          branchLink.className = "field-nav-branch-link";
          branchLink.textContent = T(branch.name);
          branchLink.addEventListener("click", function () {
            var target = document.getElementById("field-branch-" + card.id + "-" + branchIndex);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          branchList.appendChild(branchLink);
        });
        cardEntry.appendChild(branchList);
      }

      nav.appendChild(cardEntry);
    });
    container.appendChild(nav);
  }

  function renderFieldRulebook() {
    var container = document.getElementById("field-rulebook-list");
    var Fields = window.PriTestFields;
    if (!container || !Fields) return;
    container.innerHTML = "";
    var T = Fields.localizedText;
    var cards = Fields.list();
    renderFieldNav(container, cards, T);
    cards.forEach(function (card) {
      renderFieldCard(container, card, T);
    });
  }

  // イベントチット（霊脈・商人・強敵・ランダムイベント）のルールブックタブ。
  // データ形状はfields.jsのCARDSと同じなので、renderFieldNav/renderFieldCardをそのまま再利用する。
  function renderEventRulebook() {
    var container = document.getElementById("event-rulebook-list");
    var Events = window.PriTestEventRulebook;
    if (!container || !Events) return;
    container.innerHTML = "";
    var T = Events.localizedText;
    var cards = Events.list();
    renderFieldNav(container, cards, T);
    cards.forEach(function (card) {
      renderFieldCard(container, card, T);
    });
  }

  // 世界観タブ：イントロダクション・夜渡り概説・舞台設定・10体の夜の王ストーリーの参考資料。
  // fields.js/event_rulebook.jsのカード階層とは形が異なる（title＋blocksの単純な並び）ため、
  // renderFieldNav/renderFieldCardは流用せず専用の描画関数を用意する。
  function renderWorldviewNav(container, sections, T) {
    var nav = document.createElement("div");
    nav.className = "field-nav";
    sections.forEach(function (section) {
      var entry = document.createElement("div");
      entry.className = "field-nav-card";
      var link = document.createElement("button");
      link.type = "button";
      link.className = "field-nav-card-link";
      link.textContent = T(section.title);
      link.addEventListener("click", function () {
        var target = document.getElementById("worldview-section-" + section.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      entry.appendChild(link);
      nav.appendChild(entry);
    });
    container.appendChild(nav);
  }

  function renderWorldviewSection(container, section, T) {
    var block = document.createElement("div");
    block.className = "field-card-block worldview-section";
    block.id = "worldview-section-" + section.id;

    var h = document.createElement("h3");
    h.className = "field-card-title";
    h.textContent = T(section.title);
    block.appendChild(h);

    (section.blocks || []).forEach(function (entry) {
      if (entry.kind === "label") {
        var h4 = document.createElement("h4");
        h4.className = "worldview-label";
        h4.textContent = T(entry.body);
        block.appendChild(h4);
      } else {
        var p = document.createElement("p");
        p.className = "worldview-text";
        p.textContent = T(entry.body);
        block.appendChild(p);
      }
    });

    container.appendChild(block);
  }

  function renderWorldviewRulebook() {
    var container = document.getElementById("worldview-rulebook-list");
    var Worldview = window.PriTestWorldview;
    if (!container || !Worldview) return;
    container.innerHTML = "";
    var T = Worldview.localizedText;
    var sections = Worldview.list();
    renderWorldviewNav(container, sections, T);
    sections.forEach(function (section) {
      renderWorldviewSection(container, section, T);
    });
  }

  // 「得意武器：武器」時の抽選手順（レア度判定→大分類→小分類）の参考資料タブ
  function renderWeaponRulebook() {
    var container = document.getElementById("weapon-rulebook-list");
    var WR = window.PriTestWeaponRulebook;
    if (!container || !WR) return;
    container.innerHTML = "";
    var T = CharacterTypes.localizedText;

    WR.procedure().forEach(function (step) {
      var block = document.createElement("div");
      block.className = "threat-ref-block";
      var h = document.createElement("h4");
      h.textContent = T(step.title);
      block.appendChild(h);
      var p = document.createElement("p");
      p.className = "threat-ref-body";
      p.textContent = T(step.body);
      block.appendChild(p);
      container.appendChild(block);
    });

    var majorTable = WR.majorTable();
    var majorBlock = document.createElement("div");
    majorBlock.className = "threat-ref-block";
    var majorTitle = document.createElement("h4");
    majorTitle.textContent = T(majorTable.title);
    majorBlock.appendChild(majorTitle);
    majorBlock.appendChild(buildBossTable(majorTable.columns, majorTable.rows, T));
    container.appendChild(majorBlock);

    WR.minorTables().forEach(function (tbl) {
      var block = document.createElement("div");
      block.className = "threat-ref-block";
      var h = document.createElement("h4");
      h.textContent = T(tbl.title);
      block.appendChild(h);
      block.appendChild(buildBossTable(tbl.columns, tbl.rows, T));
      container.appendChild(block);
    });

    [WR.acquisitionNote(), WR.rarityNote()].concat(WR.commonSkillNotes()).forEach(function (note) {
      var block = document.createElement("div");
      block.className = "threat-ref-block";
      var h = document.createElement("h4");
      h.textContent = T(note.title);
      block.appendChild(h);
      var p = document.createElement("p");
      p.className = "threat-ref-body";
      p.textContent = T(note.body);
      block.appendChild(p);
      container.appendChild(block);
    });

    var rarityTable = WR.rarityTable();
    var rarityBlock = document.createElement("div");
    rarityBlock.className = "threat-ref-block";
    var rarityTitle = document.createElement("h4");
    rarityTitle.textContent = T(rarityTable.title);
    rarityBlock.appendChild(rarityTitle);
    rarityBlock.appendChild(buildBossTable(rarityTable.columns, rarityTable.rows, T));
    container.appendChild(rarityBlock);

    renderWeaponCategoryRollTables(container);
  }

  // カテゴリごとの種類決定表（レア度内での出目→武器名）。武器獲取タブの末尾に表示。
  function renderWeaponCategoryRollTables(container) {
    var Weapons = window.PriTestWeapons;
    if (!Weapons) return;
    var identity = function (v) {
      return v;
    };
    var rarityOrder = { C: 1, U: 2, R: 3, L: 4 };
    Weapons.categories().forEach(function (category) {
      var weapons = Weapons.list()
        .filter(function (w) {
          return w.category === category.id;
        })
        .slice()
        .sort(function (a, b) {
          return (rarityOrder[a.rarity] || 9) - (rarityOrder[b.rarity] || 9);
        });
      var block = document.createElement("div");
      block.className = "threat-ref-block";
      var h = document.createElement("h4");
      h.textContent = window.I18N.t("weapon_roll_table_title", { category: Weapons.localizedText(category.name) });
      block.appendChild(h);
      var columns = [
        window.I18N.t("weapon_rarity_column_label"),
        window.I18N.t("weapon_roll_column_label"),
        window.I18N.t("weapon_name_column_label"),
      ];
      var rows = weapons.map(function (w) {
        return [w.rarity, w.roll || "－", Weapons.localizedText(w.name)];
      });
      block.appendChild(buildBossTable(columns, rows, identity));
      container.appendChild(block);
    });
  }

  // 武器データ（weapons.js）の装備品スキル参照（art/innate/status/element/bonus/random/note）を
  // 読み取り専用の <details> エントリとして描画する。character_drawer.js の同名処理と役割は同じだが、
  // ランダム戦技をここでは検索割り当てせず「未決定」表示に留める（規則書は参照専用のため）。
  function renderWeaponSkillRefEntry(container, ref) {
    var Weapons = window.PriTestWeapons;
    var WL = Weapons.localizedText;
    var body = "";
    var name = "";
    var kind = null;
    if (ref.kind === "art") {
      var art = Weapons.getSkill(ref.id);
      name = art ? WL(art.name) : ref.id;
      body = art ? WL(art.body) : "";
      kind = art ? art.kind : null;
    } else if (ref.kind === "innate") {
      var innate = null;
      Weapons.categories().forEach(function (cat) {
        (cat.innateSkills || []).forEach(function (s) {
          if (s.id === ref.id) innate = s;
        });
      });
      name = innate ? WL(innate.name) : ref.id;
      body = innate ? WL(innate.body) : "";
      kind = innate ? innate.kind : null;
    } else if (ref.kind === "status") {
      name = window.I18N.t("weapon_status_skill_label", { status: WL(ref.status) });
      body = WL(Weapons.statusSkillBody(ref.status));
      kind = "Passive";
    } else if (ref.kind === "element") {
      name = window.I18N.t("weapon_element_skill_label", { element: WL(ref.element) });
      body = WL(Weapons.elementSkillBody(ref.element));
      kind = "Passive";
    } else if (ref.kind === "special") {
      name = window.I18N.t("weapon_special_skill_label", { target: WL(ref.target) });
      body = WL(Weapons.specialEffectSkillBody(ref.target));
      kind = "Passive";
    } else if (ref.kind === "elementMinus5") {
      name = window.I18N.t("weapon_element_minus5_skill_label", { element: WL(ref.element) });
      body = WL(Weapons.elementMinus5SkillBody(ref.element));
      kind = "Passive";
    } else if (ref.kind === "statusMinus5") {
      name = window.I18N.t("weapon_status_minus5_skill_label", { status: WL(ref.status) });
      body = WL(Weapons.statusMinus5SkillBody(ref.status));
      kind = "Passive";
    } else if (ref.kind === "bonus") {
      name = WL(ref.text);
    } else if (ref.kind === "random") {
      name = window.I18N.t("weapon_random_skill_label") + (ref.table ? "（" + ref.table + "）" : "");
      if (ref.note) body = WL(ref.note);
    } else {
      name = window.I18N.t("weapon_note_label");
      body = WL(ref.text);
    }

    var details = document.createElement("details");
    details.className = "ability-entry";
    var summary = document.createElement("summary");
    summary.textContent = name + (kind ? "［" + kind + "］" : "");
    details.appendChild(summary);
    if (body) {
      var p = document.createElement("p");
      p.className = "threat-ref-body";
      p.textContent = body;
      details.appendChild(p);
    }
    container.appendChild(details);
  }

  // カテゴリ別サブタブの中身：カテゴリの基礎データ＋固有戦技一覧（参照用）＋所属武器ごとの装備品スキル。
  // 各武器に表示するのは weapon.skills（＝表の装備品スキル欄）に載っているものだけ。
  function renderWeaponCategoryList(categoryId) {
    var container = document.getElementById("weapon-category-" + categoryId + "-list");
    var Weapons = window.PriTestWeapons;
    if (!container || !Weapons) return;
    container.innerHTML = "";
    var WL = Weapons.localizedText;
    var category = Weapons.getCategory(categoryId);
    if (!category) return;

    var statsBlock = document.createElement("div");
    statsBlock.className = "threat-ref-block";
    var statsP = document.createElement("p");
    statsP.className = "threat-ref-body";
    if (category.isShield) {
      statsP.textContent = [
        window.I18N.t("weapon_guard_cost_label") + window.I18N.t("colon_separator") + WL(category.basicStats.guardCost),
        window.I18N.t("weapon_guard_hp_label") +
          window.I18N.t("colon_separator") +
          "C/U " +
          category.basicStats.guardHpCU +
          "　R/L " +
          category.basicStats.guardHpRL,
        window.I18N.t("weapon_power_mod_label") + window.I18N.t("colon_separator") + WL(category.basicStats.powerMod),
      ].join("\n");
    } else {
      statsP.textContent = [
        window.I18N.t("weapon_attack_cost_label") + window.I18N.t("colon_separator") + WL(category.basicStats.attackCost),
        window.I18N.t("weapon_power_label") + window.I18N.t("colon_separator") + category.basicStats.weaponPower,
        window.I18N.t("weapon_power_mod_label") + window.I18N.t("colon_separator") + WL(category.basicStats.powerMod),
      ].join("\n");
    }
    statsBlock.appendChild(statsP);
    container.appendChild(statsBlock);

    if (category.note) {
      var noteP = document.createElement("p");
      noteP.className = "threat-ref-body";
      noteP.textContent = WL(category.note);
      container.appendChild(noteP);
    }

    if (category.twoHitBonus && category.twoHitBonus.length) {
      var twoHitTitle = document.createElement("p");
      twoHitTitle.className = "boss-subheading";
      twoHitTitle.textContent = window.I18N.t("weapon_two_hit_bonus_label");
      container.appendChild(twoHitTitle);
      category.twoHitBonus.forEach(function (bonus) {
        var bonusP = document.createElement("p");
        bonusP.className = "threat-ref-body";
        bonusP.textContent = WL(bonus.name) + window.I18N.t("colon_separator") + WL(bonus.body);
        container.appendChild(bonusP);
      });
    }

    if (category.innateSkills && category.innateSkills.length) {
      var innateTitle = document.createElement("p");
      innateTitle.className = "boss-subheading";
      innateTitle.textContent = window.I18N.t("weapon_innate_skills_label");
      container.appendChild(innateTitle);
      category.innateSkills.forEach(function (s) {
        renderWeaponSkillRefEntry(container, { kind: "innate", id: s.id });
      });
    }

    if (category.randomSkillTable && category.randomSkillTable.length) {
      var randomTitle = document.createElement("p");
      randomTitle.className = "boss-subheading";
      randomTitle.textContent = window.I18N.t("weapon_random_skill_table_label");
      container.appendChild(randomTitle);
      category.randomSkillTable.forEach(function (row) {
        var art = Weapons.getSkill(row.id);
        var details = document.createElement("details");
        details.className = "ability-entry";
        var summary = document.createElement("summary");
        summary.textContent = "[" + row.roll + "] " + (art ? WL(art.name) : row.id) + (art && art.kind ? "［" + art.kind + "］" : "");
        details.appendChild(summary);
        if (art) {
          var p = document.createElement("p");
          p.className = "threat-ref-body";
          p.textContent = WL(art.body);
          details.appendChild(p);
        }
        container.appendChild(details);
      });
    }

    if (category.extraTables && category.extraTables.length) {
      category.extraTables.forEach(function (tbl) {
        var tblBlock = document.createElement("div");
        tblBlock.className = "threat-ref-block";
        var tblH = document.createElement("p");
        tblH.className = "boss-subheading";
        tblH.textContent = WL(tbl.title);
        tblBlock.appendChild(tblH);
        var tblWrap = document.createElement("div");
        tblWrap.className = "field-variance-wrap";
        tblWrap.appendChild(buildBossTable(tbl.columns, tbl.rows, WL));
        tblBlock.appendChild(tblWrap);
        container.appendChild(tblBlock);
      });
    }

    // 杖・聖印の「ランダム魔術／ランダム祈祷」決定表：ダイス出目→魔術/祈祷スキルIDを、
    // カテゴリのrandomSkillTableと同じ〈details〉展開形式で複数表ぶん表示する。
    if (category.namedSkillTables && category.namedSkillTables.length) {
      category.namedSkillTables.forEach(function (namedTbl) {
        var namedTitle = document.createElement("p");
        namedTitle.className = "boss-subheading";
        namedTitle.textContent = WL(namedTbl.title);
        container.appendChild(namedTitle);
        namedTbl.rows.forEach(function (row) {
          var art = Weapons.getSkill(row.id);
          var details = document.createElement("details");
          details.className = "ability-entry";
          var summary = document.createElement("summary");
          summary.textContent = "[" + row.roll + "] " + (art ? WL(art.name) : row.id) + (art && art.kind ? "［" + art.kind + "］" : "");
          details.appendChild(summary);
          if (art) {
            var p = document.createElement("p");
            p.className = "threat-ref-body";
            p.textContent = WL(art.body);
            details.appendChild(p);
          }
          container.appendChild(details);
        });
      });
    }

    var listTitle = document.createElement("p");
    listTitle.className = "boss-subheading";
    listTitle.textContent = window.I18N.t("weapon_category_weapon_list_label");
    container.appendChild(listTitle);

    var rarityOrder = { C: 1, U: 2, R: 3, L: 4 };
    var weapons = Weapons.list()
      .filter(function (w) {
        return w.category === categoryId;
      })
      .slice()
      .sort(function (a, b) {
        return (rarityOrder[a.rarity] || 9) - (rarityOrder[b.rarity] || 9);
      });

    weapons.forEach(function (weapon) {
      var card = document.createElement("div");
      card.className = "relic-candidate-card";
      var title = document.createElement("div");
      title.className = "relic-candidate-name";
      title.textContent =
        WL(weapon.name) +
        "（" +
        window.I18N.t("weapon_rarity_column_label") +
        window.I18N.t("colon_separator") +
        weapon.rarity +
        "・" +
        window.I18N.t("weapon_roll_column_label") +
        window.I18N.t("colon_separator") +
        (weapon.roll || "－") +
        "）";
      card.appendChild(title);
      if (category.isShield) {
        if (weapon.attachedEffect && weapon.attachedEffect.length) {
          var attachedTitle = document.createElement("p");
          attachedTitle.className = "boss-subheading";
          attachedTitle.textContent = window.I18N.t("weapon_attached_effect_label");
          card.appendChild(attachedTitle);
          weapon.attachedEffect.forEach(function (ref) {
            renderWeaponSkillRefEntry(card, ref);
          });
        }
        if (weapon.reverseArt && weapon.reverseArt.length) {
          var reverseTitle = document.createElement("p");
          reverseTitle.className = "boss-subheading";
          reverseTitle.textContent = window.I18N.t("weapon_reverse_art_label");
          card.appendChild(reverseTitle);
          weapon.reverseArt.forEach(function (ref) {
            renderWeaponSkillRefEntry(card, ref);
          });
        }
      } else {
        (weapon.skills || []).forEach(function (ref) {
          renderWeaponSkillRefEntry(card, ref);
        });
      }
      container.appendChild(card);
    });
  }

  // 武器タブのサブタブ（武器獲取／カテゴリ別）を動的に構築する。カテゴリは weapons.js に追加され次第、
  // 自動でサブタブとして増えていく。
  function setupWeaponSubTabs() {
    var tabsContainer = document.getElementById("weapon-subtabs");
    var panelsContainer = document.getElementById("weapon-subtab-panels");
    var Weapons = window.PriTestWeapons;
    if (!tabsContainer || !panelsContainer || !Weapons) return;
    tabsContainer.innerHTML = "";
    panelsContainer.innerHTML = "";

    var tabs = [{ id: "acquisition", label: window.I18N.t("weapon_subtab_acquisition_label") }].concat(
      Weapons.categories().map(function (cat) {
        return { id: cat.id, label: Weapons.localizedText(cat.name) };
      })
    );

    tabs.forEach(function (tab) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "weapon-subtab-btn" + (tab.id === activeWeaponSubTab ? " active" : "");
      btn.setAttribute("data-subtab", tab.id);
      btn.textContent = tab.label;
      btn.addEventListener("click", function () {
        switchWeaponSubTab(tab.id);
      });
      tabsContainer.appendChild(btn);

      var panel = document.createElement("div");
      panel.className = "weapon-subtab-panel";
      panel.id = "weapon-subpanel-" + tab.id;
      panel.hidden = tab.id !== activeWeaponSubTab;
      var inner = document.createElement("div");
      inner.id = tab.id === "acquisition" ? "weapon-rulebook-list" : "weapon-category-" + tab.id + "-list";
      panel.appendChild(inner);
      panelsContainer.appendChild(panel);
    });
  }

  function switchWeaponSubTab(id) {
    activeWeaponSubTab = id;
    document.querySelectorAll(".weapon-subtab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-subtab") === id);
    });
    document.querySelectorAll(".weapon-subtab-panel").forEach(function (panel) {
      panel.hidden = panel.id !== "weapon-subpanel-" + id;
    });
  }

  // 武器タブ全体（サブタブ構築＋武器獲取＋カテゴリ別一覧）をまとめて描画する。
  function renderWeaponRulebookAll() {
    setupWeaponSubTabs();
    renderWeaponRulebook();
    var Weapons = window.PriTestWeapons;
    if (Weapons) {
      Weapons.categories().forEach(function (cat) {
        renderWeaponCategoryList(cat.id);
      });
    }
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
            state.timeLoss[dayKey][rowIndex][boxIndex] = cb.checked;
            renderTimeLossSummary();
            saveState();
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

  function renderTimeLossSummary() {
    var dayKey = isSwappedDay() ? "day2" : "day1";
    var rows = state.timeLoss[dayKey];
    var triggered = [];
    TIME_LOSS_ROW_DEFS.forEach(function (def, i) {
      if (rows[i].every(Boolean)) triggered.push(timeLossRowLabelDetail(dayKey, def));
    });
    ROLL_EFFECTS.forEach(function (effect) {
      var count = state.rollEffects[effect.id] || 0;
      if (count > 0) {
        triggered.push([window.I18N.t("roll_effect_" + effect.id + "_label"), window.I18N.t("roll_effect_" + effect.id + "_tier" + count)]);
      }
    });
    var summaryEl = document.getElementById("time-loss-summary");
    if (triggered.length === 0) {
      summaryEl.textContent = window.I18N.t("time_loss_none");
      return;
    }
    summaryEl.textContent = triggered
      .map(function (parts) {
        return parts[0] + window.I18N.t("colon_separator") + parts[1];
      })
      .join("、");
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
    document.getElementById("input-smithing-stone").value = state.smithingStone || "";
    document.getElementById("input-stonesword-key").value = state.stoneswordKey || "";
    document.getElementById("input-grace").value = state.grace || "";
    renderStoneswordKeyCount();
    renderSmithingStoneCount();
  }

  function renderStoneswordKeyCount() {
    var el = document.getElementById("stonesword-key-count-label");
    if (!el) return;
    el.textContent = window.I18N.t("stonesword_key_count_label", { value: state.stoneswordKeyCount || 0 });
  }

  function renderSmithingStoneCount() {
    var el = document.getElementById("smithing-stone-count-label");
    if (!el) return;
    el.textContent = window.I18N.t("smithing_stone_count_label", { value: state.smithingStoneCount || 0 });
  }

  function renderThreatRefTexts() {
    document.getElementById("time-loss-accum-timing-body").textContent = window.I18N.t("time_loss_accum_timing_body");
    document.getElementById("night-rain-timing-body").textContent = window.I18N.t("night_rain_timing_body");
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
        state.rollEffects[effect.id] = Math.max(0, count - 1);
        saveState();
        renderRollEffects();
        renderTimeLossSummary();
      });
      plus.addEventListener("click", function () {
        state.rollEffects[effect.id] = Math.min(effect.tiers, count + 1);
        saveState();
        renderRollEffects();
        renderTimeLossSummary();
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
    var boardSidePosition = document.getElementById("board-side-position");
    if (boardSidePosition) boardSidePosition.hidden = !hasActiveBattleContext();
  }

  // 骰子池の判定結果（前衛/後衛、6の目による敵視+1）を、戦場シートの対応するPCスロットへ
  // 自動反映する。前衛/後衛の点灯は常に最新の骰子池内容で上書き（べき等）するが、敵視+1は
  // 「6が出た」という1回のロールセッションにつき一度だけ加算するフラグ方式にする（骰子池の
  // キー文字列で比較すると、6を含んだまま骰子を追加するたびに毎回+1されてしまうため）。
  // このフラグは骰子池が空になった（＝重置骰子が押された）ときにのみ解除する。
  function syncDiceStatusToBattle() {
    // 「一般行動」フェイズ中は、骰子池がどんな内容であっても前後衛・敵視の自動判定を行わない
    // （一般行動の骰子は戦闘外の用途であり、勝手に戦場の陣形を変えてしまわないようにするため）。
    if (state.actionPhase === "normal") return;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    var stateChanged = false;
    var flagsChanged = false;
    entered.forEach(function (c, idx) {
      if (idx >= BATTLE_SLOT_COUNT) return;
      var pool = c.dicePool || [];
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
      }
      if (!pool.length) {
        if (c._diceAggroApplied) {
          c._diceAggroApplied = false;
          flagsChanged = true;
        }
        return;
      }
      if (status && status.aggroIncrease && !c._diceAggroApplied) {
        state.battle.aggro[idx] = (state.battle.aggro[idx] || 0) + 1;
        c._diceAggroApplied = true;
        stateChanged = true;
        flagsChanged = true;
      }
    });
    if (stateChanged) saveState();
    if (flagsChanged) saveRosterCharacters();
  }

  // 敵人を除去した、または戦場を初期化したときは、前衛/後衛の点灯と敵視を全て解除する。
  function resetBattlePositionsAndAggro() {
    for (var i = 0; i < BATTLE_SLOT_COUNT; i++) {
      state.battle.front[i] = false;
      state.battle.back[i] = false;
      state.battle.aggro[i] = 0;
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
  // 消去前の内容は記録として全体ログへ残す。
  function clearAllPendingActionBoxes() {
    rosterCharacters.forEach(function (c) {
      if (!c.pendingActionBoxes || !c.pendingActionBoxes.length) return;
      var summary = c.pendingActionBoxes
        .map(function (b) {
          return b.total ? b.title + "(" + b.total + ")" : b.title;
        })
        .join("、");
      c.pendingActionBoxes = [];
      addLog("log_action_box_clear", { character: c.name, actions: summary });
    });
  }

  function renderActionBoxes(c, container) {
    (c.pendingActionBoxes || []).forEach(function (box) {
      var el = document.createElement("div");
      el.className = "action-log-box";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "action-log-close";
      closeBtn.textContent = "×";
      closeBtn.title = window.I18N.t("action_log_clear_button");
      closeBtn.addEventListener("click", function () {
        removeActionBox(c, box.id);
      });
      el.appendChild(closeBtn);
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
  }

  function showCombatError(key, params) {
    var errEl = document.getElementById("combat-modal-error");
    errEl.textContent = window.I18N.t(key, params);
    errEl.hidden = false;
  }

  // 攻撃action中「どの武器のどちらのHitを実行しようとしているか」の一時状態。
  // アクションを閉じる／別のアクションに切り替えるたびにnullへ戻す。
  var combatAttackState = null; // { weaponId, hitType: "hit1"|"hit2" } | null
  // 攻撃actionで属性/異常蓄積の記録先とする、選択中の敵人のキー。選択肢が変わるたびに
  // 有効な値へ補正する（既定は先頭の敵人）。
  var combatAttackTargetEnemyKey = null;

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
      return;
    }

    equippedIds.forEach(function (weaponId) {
      var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
      var weapon = Weapons.get(baseId);
      var category = Weapons.getCategory(weapon.category);
      var damage = CharacterDrawer.computeWeaponDamage(c, weaponId);
      var attackCost = CharacterDrawer.parseAttackCost(Weapons.localizedText(category.basicStats.attackCost));
      // 基本1Hit/2Hit攻撃のコスト表記（"1Hit：.../2Hit：..."）自体には現状、隊列限定の記述は
      // 含まれない（隊列限定は個別技能の本文にのみ現れる）が、将来データが追加された場合に
      // 備え、同じ判定ロジックを明示的に通しておく（現状は常にnull＝制限なし）。
      var posRestriction = CharacterDrawer.parsePositionRestriction(Weapons.localizedText(category.basicStats.attackCost));
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
        dmgTag.textContent = " " + CharacterDrawer.weaponDamageTagText(damage);
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

      ["hit1", "hit2"].forEach(function (hitType) {
        var hitBtn = document.createElement("button");
        hitBtn.type = "button";
        hitBtn.className = "combat-attack-hit-btn";
        hitBtn.textContent = window.I18N.t(hitType === "hit1" ? "combat_attack_hit1_button" : "combat_attack_hit2_button");
        var isActive = combatAttackState && combatAttackState.weaponId === weaponId && combatAttackState.hitType === hitType;
        if (isActive) hitBtn.classList.add("active");
        if (!posOk) hitBtn.disabled = true;
        hitBtn.addEventListener("click", function () {
          combatAttackState = isActive ? null : { weaponId: weaponId, hitType: hitType };
          combatDiceSelection = [];
          renderCombatModal();
        });
        row.appendChild(hitBtn);
      });
      content.appendChild(row);

      if (combatAttackState && combatAttackState.weaponId === weaponId) {
        var hitType = combatAttackState.hitType;
        var cost = attackCost ? attackCost[hitType] : null;
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
          var songHitBonus = songOfBloodSpiritHitBonus();
          var unyieldingBonus = unyieldingHitBonus(c);
          var dmgValue =
            (hitType === "hit1" ? damage.hit1Damage : damage.hit2Damage) +
            (hitType === "hit1" ? songHitBonus.hit1 : songHitBonus.hit2) +
            (hitType === "hit1" ? unyieldingBonus.hit1 : unyieldingBonus.hit2);
          var dmgSymbol = hitType === "hit1" ? damage.hit1Symbol : damage.hit2Symbol;
          var lines = [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines);
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
      var isSpellCategory = category && (category.id === "staff" || category.id === "sacred_seal");
      dmg = isSpellCategory
        ? CharacterDrawer.spellSkillPowerValue(body, artInfo.artPower)
        : CharacterDrawer.artSkillPowerValue(body, artInfo.artPower);
    }
    if (!dmg) return null;
    // 基礎威力が実際に計算できた場合のみ、タリスマン起因の固定加算（戦技・魔術・祈祷向け）と
    // 無賴漢「鬥爭心」（現在HPが最大HPと異なる場合＋20）を上乗せする（計算不能な場合にまで
    // 数値を捏造しないため）。
    var talismanBonus = CharacterDrawer.talismanFlatSkillBonus(c);
    var fightingSpiritBonus = CharacterDrawer.fightingSpiritFlatBonus(c);
    var songBonus = songOfBloodSpiritSkillBonus();
    var unyieldingBonus = unyieldingSkillBonus(c);
    var flatBonus = talismanBonus + fightingSpiritBonus + songBonus + unyieldingBonus;
    return flatBonus ? { value: dmg.value + flatBonus, symbol: dmg.symbol } : dmg;
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

      var effectiveMax = entry.uses ? entry.uses + usesBonus : null;
      var remaining = effectiveMax !== null ? (typeof (c.abilityUses && c.abilityUses[entry.id]) === "number" ? c.abilityUses[entry.id] : effectiveMax) : null;
      if (effectiveMax !== null) {
        var usesEl = document.createElement("span");
        usesEl.className = "ability-uses-label";
        usesEl.textContent = window.I18N.t("action_log_uses_remaining", { current: remaining, max: effectiveMax });
        row.appendChild(usesEl);
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
      if ((effectiveMax !== null && remaining <= 0) || !posOk || (entry.id === "whirlwind" && c._whirlwindUsedThisPhase)) useBtn.disabled = true;
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
            content.appendChild(buildEnemyGuardValueTable(resolvedFamily));
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
            addActionBox(c, name, window.I18N.t("restage_applied_note"), [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
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
          addActionBox(c, name, total, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
          addLog("log_combat_skill_use", { character: c.name, skill: name, dice: dice.join("、") });
          combatSkillState = null;
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
              if (!c.dicePool) c.dicePool = [];
              c.dicePool.push(1 + Math.floor(Math.random() * 6));
              inquiryNote = window.I18N.t("inquiry_bonus_dice_note");
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
            addActionBox(c, name, roarTotal, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
            addLog("log_crucible_roar_use", {
              character: c.name,
              choice: window.I18N.t(crucibleRoarChoice === "damage" ? "crucible_roar_choice_damage_label" : "crucible_roar_choice_revival_label"),
            });
            combatSkillState = null;
            crucibleRoarChoice = null;
          });
        }
      } else if (isActive) {
        var cost = CharacterDrawer.parseActionCost(body);
        renderDiceCostAction(c, content, cost, function (dice, costLines) {
          if (entry.uses && entry.id) {
            if (!c.abilityUses) c.abilityUses = {};
            c.abilityUses[entry.id] = Math.max(0, (remaining !== null ? remaining : effectiveMax) - 1);
          }
          // 葬儀屋「力量感應」：この汎用パスを通るあらゆる技藝の使用（他キャラのarts含む）が
          // 発火対象になりうる。判定自体はtriggerPowerResonance内でisArtをチェックする。
          triggerPowerResonance(c, entry);
          if (entry.id === "whirlwind") c._whirlwindUsedThisPhase = true;
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
          }
          // 守護者「救世之翼」：戦闘フェイズでの発動後、額外・防禦フェイズを跨いで持続する
          // 全体バフ（HP損害無効化）。次に戦闘フェイズへ新規突入した時にのみクリアされる
          // （setActionPhaseの「新しい回合開始」判定箇所を参照）。
          if (entry.id === "wings_of_salvation") {
            rosterCharacters.forEach(function (rc) {
              rc._wingsOfSalvationActive = true;
            });
          }
          // 復仇者「不死行軍」：救世之翼と全く同じライフサイクル（戦闘→額外→防禦の1回合を
          // 跨いで持続し、次に戦闘フェイズへ新規突入した時にのみクリア）の全体バフ。
          // 「復歸傷害：120」自体はGM手動反映（■/▲と同様の未確定数値は捏造しない方針）。
          if (entry.id === "march_of_the_undying") {
            rosterCharacters.forEach(function (rc) {
              rc._marchOfTheUndyingActive = true;
            });
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
          var artInfo = CharacterDrawer.computeArtPower(c, st.pursueWeaponId);
          var dmg = artInfo ? CharacterDrawer.artSkillPowerValue(body, artInfo.artPower) : null;
          pursueNote = dmg
            ? window.I18N.t("action_log_damage_total", { value: CharacterDrawer.formatValueWithSymbol(dmg.value, dmg.symbol) })
            : window.I18N.t("claw_shot_choice_damage_label");
        } else {
          pursueNote = window.I18N.t("claw_shot_choice_revival_label");
        }
        addActionBox(c, window.I18N.t("claw_shot_pursue_label"), pursueNote, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
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

    renderCombatDicePicker(c, content);
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("combat_confirm_button");
    confirmBtn.disabled = !combatDiceSelection.length;
    confirmBtn.addEventListener("click", function () {
      if (c.hp.current + healAmount > c.hp.max) {
        if (!window.confirm(window.I18N.t("combat_flask_overflow_confirm", { current: c.hp.current, max: c.hp.max, amount: healAmount }))) {
          return;
        }
      }
      var dice = consumeCombatDice(c);
      if (c.flaskBase.current > 0) c.flaskBase.current -= 1;
      else c.flaskExtra.current -= 1;
      c.hp.current = Math.min(c.hp.max, c.hp.current + healAmount);
      combatDiceSelection = [];
      saveRosterCharacters();
      addLog("log_combat_flask_use", { character: c.name, dice: dice.join("、"), amount: healAmount });
      addActionBox(c, window.I18N.t("combat_action_flask"), window.I18N.t("action_log_heal_total", { value: healAmount }), [
        window.I18N.t("action_log_dice_used", { dice: dice.join("、") }),
      ]);
      renderCharacterRoster();
      renderCombatModal();
    });
    content.appendChild(confirmBtn);
  }

  // 學者「博聞強識」：消耗品使用時、指定出目で骰子消耗を支払ったかどうかのYes/No確認（範囲が
  // 不明のためGM/プレイヤーの手動判定に委ねる、淑女「重演」等と同型のゲート）。
  var carriedKnowledgeNoConsume = null; // true | false | null（null=未確認）

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
    selLabel.appendChild(sel);
    content.appendChild(selLabel);

    // 學者「博聞強識」：自身が使う消耗品は常に等級2效果が發揮される（具体的な数値適用は
    // GM手動反映）。また、指定出目で骰子消耗を支払ったかどうかをYes/Noで確認し、「是」なら
    // 使用回数を消費しない。
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

      var ckQuestion = document.createElement("p");
      ckQuestion.className = "threat-ref-body";
      ckQuestion.textContent = window.I18N.t("carried_knowledge_confirm_question");
      content.appendChild(ckQuestion);
      var ckRow = document.createElement("div");
      ckRow.className = "wb-row";
      [
        { key: true, label: window.I18N.t("carried_knowledge_confirm_yes_button") },
        { key: false, label: window.I18N.t("carried_knowledge_confirm_no_button") },
      ].forEach(function (opt) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = opt.label;
        if (carriedKnowledgeNoConsume === opt.key) btn.classList.add("active");
        btn.addEventListener("click", function () {
          carriedKnowledgeNoConsume = carriedKnowledgeNoConsume === opt.key ? null : opt.key;
          renderCombatModal();
        });
        ckRow.appendChild(btn);
      });
      content.appendChild(ckRow);
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
      if (target && !(hasCarriedKnowledge && carriedKnowledgeNoConsume)) {
        target.usesRemaining -= 1;
        if (target.usesRemaining <= 0) {
          var idx = c.consumables.indexOf(target);
          if (idx !== -1) c.consumables.splice(idx, 1);
        }
      }
      combatDiceSelection = [];
      carriedKnowledgeNoConsume = null;
      saveRosterCharacters();
      addLog("log_combat_consumable_use", {
        character: c.name,
        item: item ? Consumables.localizedText(item.name) : id,
        dice: dice.join("、"),
      });
      addActionBox(c, item ? Consumables.localizedText(item.name) : id, null, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })]);
      renderCharacterRoster();
      renderCombatModal();
    });
    content.appendChild(confirmBtn);
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
    var swappable = (c.weaponIds || []).filter(function (id) {
      return c.equippedWeaponIds.indexOf(id) === -1;
    });
    if (!swappable.length) {
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
      addLog("log_combat_equip_change", { character: c.name, dice: dice.join("、") });
      addActionBox(c, window.I18N.t("combat_action_equip"), null, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })]);
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
          activeDefenseSkill.id === "marking"
            ? window.I18N.t("marking_defense_note")
            : activeDefenseSkill.id === "counterattack"
            ? window.I18N.t("counterattack_defense_note")
            : activeDefenseSkill.id === "trance"
            ? window.I18N.t("trance_defense_note")
            : window.I18N.t("combat_defense_skill_negate_note");
        if (activeDefenseSkill.id === "counterattack") c._counterattackDefenseUsed = true;
        // 執行者「妖刀」：完全無效化ノート自体は汎用（combat_defense_skill_negate_note）のまま。
        // このディフェンス後、妖刀蓄積に✓1個（上限2、既に2でも使用自体は妨げない）を記入し、
        // 次の戦闘フェイズ開始時に體力骰+1を予約する（setActionPhaseの「新しい回合開始」判定
        // 箇所で消化する）。
        if (activeDefenseSkill.id === "yoto") {
          c._yotoMarks = Math.min(2, (c._yotoMarks || 0) + 1);
          c._yotoPendingBonusDice = true;
        }
        addActionBox(c, skillName, defenseNote, [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })].concat(costLines));
        addLog(
          activeDefenseSkill.id === "counterattack"
            ? "log_counterattack_defense_use"
            : activeDefenseSkill.id === "yoto"
            ? "log_yoto_defense_use"
            : activeDefenseSkill.id === "trance"
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
          combatDefenseState = null;
          elegantFootworkActive = false;
        });
      } else {
        renderDiceCostAction(c, content, DODGE_COST, function (dice) {
          var value = dice[0] * 10 + 30;
          addActionBox(
            c,
            window.I18N.t("combat_defense_dodge_button"),
            window.I18N.t("action_log_defense_value_total", { value: value }),
            [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })]
          );
          addLog("log_combat_defense_dodge", { character: c.name, value: value, dice: dice.join("、") });
          c._dodgeActionUsed = true;
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
      var value = applyConsecutiveGuardBonus(c, baseValue);
      renderDiceCostAction(c, content, cost, function (dice) {
        addActionBox(
          c,
          window.I18N.t("combat_defense_block_button"),
          window.I18N.t("action_log_defense_value_total", { value: value }),
          [window.I18N.t("action_log_dice_used", { dice: dice.join("、") })]
        );
        addLog("log_combat_defense_block", { character: c.name, value: value, dice: dice.join("、") });
        registerGuardUsed(c);
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
  var ENEMY_HP_GRID_TARGETS = [
    { containerId: "battle-enemy-hp-grid", idPrefix: "battle-enemy-hp-" },
    { containerId: "board-side-enemy-hp-grid", idPrefix: "board-enemy-hp-" },
    { containerId: "night3-boss-hp-grid", idPrefix: "night3-boss-hp-" },
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

  // 非雑兵エネミー（state.battle.enemyHp）の指定段がHP0（全マス被弾済み）かどうか。
  function isEnemyHpRowFull(rowIdx) {
    return countRowChecked(state.battle.enemyHp, rowIdx * ENEMY_HP_COLS, ENEMY_HP_COLS) === ENEMY_HP_COLS;
  }

  // 額外行動フェイズは、非雑兵エネミーの4段のうちいずれか1段でもHP0になって初めて選択可能になる。
  function anyEnemyHpRowDepleted() {
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (isEnemyHpRowFull(i)) return true;
    }
    return false;
  }

  // 4段全てがHP0＝戦闘終了（一般行動へ自動的に戻す）。
  function allEnemyHpRowsDepleted() {
    for (var i = 0; i < ENEMY_HP_ROWS; i++) {
      if (!isEnemyHpRowFull(i)) return false;
    }
    return true;
  }

  // エネミーHPが変化するたびに呼び、額外行動ボタンの活性状態を更新しつつ、
  // 4段全滅であれば自動的に一般行動へ切り替えて戦闘終了を記録する。
  function handleEnemyHpChanged() {
    renderActionPhaseGrid();
    if (state.actionPhase !== "normal" && allEnemyHpRowsDepleted()) {
      setActionPhase("normal", { combatEnd: true });
    }
  }

  // 指定した段のチェック数を、増減ではなく指定した個数ちょうどに設定する（左詰め）。
  // エネミー追加時のHP自動設定で使う。
  function setEnemyHpRowCount(rowIdx, count) {
    var start = rowIdx * ENEMY_HP_COLS;
    var clamped = Math.max(0, Math.min(ENEMY_HP_COLS, count));
    for (var i = 0; i < ENEMY_HP_COLS; i++) {
      state.battle.enemyHp[start + i] = i < clamped;
    }
  }

  // エネミーのHP枠表記（例："×7/×7"）から、第1段・第2段それぞれの個数を取り出す。
  // 解析できない場合はnullを返す。
  function parseEnemyHpNotation(text) {
    var m = /[×xX]\s*(\d+)\s*\/\s*[×xX]\s*(\d+)/.exec(String(text || ""));
    if (!m) return null;
    return { row1: parseInt(m[1], 10), row2: parseInt(m[2], 10) };
  }

  function adjustEnemyHpRow(rowIdx, delta) {
    var start = rowIdx * ENEMY_HP_COLS;
    var current = countRowChecked(state.battle.enemyHp, start, ENEMY_HP_COLS);
    var target = Math.max(0, Math.min(ENEMY_HP_COLS, current + delta));
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
    renderEnemyHpGrid();
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
          var rowDiv = document.createElement("div");
          rowDiv.className = "battle-hp-stepper-row";

          var label = document.createElement("span");
          label.className = "battle-hp-stepper-label";
          label.textContent = window.I18N.t("battle_hp_row_label", { row: rowIdx + 1 });
          rowDiv.appendChild(label);

          var minus = document.createElement("button");
          minus.type = "button";
          minus.className = "level-btn";
          minus.textContent = "−";
          minus.addEventListener("click", function () {
            adjustEnemyHpRow(rowIdx, -1);
          });
          rowDiv.appendChild(minus);

          var value = document.createElement("span");
          value.className = "level-value battle-hp-stepper-value";
          value.textContent = count + "/" + ENEMY_HP_COLS;
          rowDiv.appendChild(value);

          var plus = document.createElement("button");
          plus.type = "button";
          plus.className = "level-btn";
          plus.textContent = "＋";
          plus.addEventListener("click", function () {
            adjustEnemyHpRow(rowIdx, 1);
          });
          rowDiv.appendChild(plus);

          container.appendChild(rowDiv);
        })(row);
      }
    });
  }

  // 雑魚HPリストも、エネミーHPグリッドと同様に戦場面板内のフル表示（削除ボタン付き）と、
  // 盤面左側の共用パネル（board-side-mob-hp-list、削除ボタンなしの簡易表示）の2箇所に
  // 同じstate.battle.mobHpRowsを描画する。どちらのチェックボックスを操作しても両方に
  // 即時反映される。共用パネル側は雑魚が1行も無いときは非表示にする。
  var MOB_HP_LIST_TARGETS = [
    { containerId: "battle-mob-hp-list", withRemove: true },
    { containerId: "board-side-mob-hp-list", withRemove: false },
  ];

  var MOB_HP_COLS = 10;

  function adjustMobHpRow(rowIndex, delta) {
    var row = state.battle.mobHpRows[rowIndex];
    if (!row) return;
    var current = countRowChecked(row, 0, MOB_HP_COLS);
    var target = Math.max(0, Math.min(MOB_HP_COLS, current + delta));
    if (target === current) return;
    if (target > current) {
      var need = target - current;
      for (var i = 0; i < MOB_HP_COLS && need > 0; i++) {
        if (!row[i]) {
          row[i] = true;
          need--;
        }
      }
    } else {
      var remove = current - target;
      for (var j = MOB_HP_COLS - 1; j >= 0 && remove > 0; j--) {
        if (row[j]) {
          row[j] = false;
          remove--;
        }
      }
    }
    // 復仇者「死靈術」：雑兵の段が「未到達→ちょうど今回HP0に到達」した瞬間だけ発火させる
    // （既にHP0の段をさらに操作しても再発火しない）。非雑兵エネミー側のhandleEnemyHpChangedに
    // 相当する検知が雑兵側には無かったため、ここに追加する。
    if (current !== MOB_HP_COLS && target === MOB_HP_COLS) {
      handleMobRowDepleted();
    }
    renderMobHpList();
    saveState();
  }

  // 死靈術（necromancy）能力を持つ入場済みキャラ全員に「擲骰待ち」を1件積む。
  // 実際の擲骰・成否判定はSpirit Panel側（renderSpiritPanel）で行う。
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

        var count = countRowChecked(row, 0, MOB_HP_COLS);

        var minus = document.createElement("button");
        minus.type = "button";
        minus.className = "level-btn";
        minus.textContent = "−";
        minus.addEventListener("click", function () {
          adjustMobHpRow(rowIndex, -1);
        });
        rowDiv.appendChild(minus);

        var value = document.createElement("span");
        value.className = "level-value battle-hp-stepper-value";
        value.textContent = count + "/" + MOB_HP_COLS;
        rowDiv.appendChild(value);

        var plus = document.createElement("button");
        plus.type = "button";
        plus.className = "level-btn";
        plus.textContent = "＋";
        plus.addEventListener("click", function () {
          adjustMobHpRow(rowIndex, 1);
        });
        rowDiv.appendChild(plus);

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
      if (c.dicePool.length === 0) {
        // 睡眠トリガーで課された「次回合のスタミナ骰-3」を、この回合の擲骰時に1回だけ消費する。
        rolled = Math.max(0, type.staminaDice.action - (c._nextActionDicePenalty || 0));
        c._nextActionDicePenalty = 0;
        for (var j = 0; j < rolled; j++) c.dicePool.push(CharacterDrawer.rollD6());
      }
    } else if (state.actionPhase === "defense") {
      if (!c._defenseActionUsed) {
        rolled = type.staminaDice.defense;
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
  }

  function renderActionPhaseButton() {
    var btn = document.getElementById("btn-action-phase");
    if (!btn) return;
    btn.textContent = window.I18N.t("action_phase_" + state.actionPhase);
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

  // 獎勵勾選清單／潛在之力／抽選武器・消耗品・飾品の「新規に開く」メインメニュー項目は
  // state.turnHolder==="gm"の間だけ表示する。既に開いて縮小済みのウィンドウ自体は
  // state.activeDrawsの非null判定で別途表示されるため、ここで隠れるのはあくまで
  // 「新規オープン」の入口ボタンのみ。
  function renderTurnGatedMenuItems() {
    var isGmTurn = state.turnHolder !== "players";
    ["btn-turn-reward-open", "btn-potential-power-info", "btn-main-menu-draw-weapon", "btn-main-menu-draw-talisman", "btn-main-menu-draw-consumable"].forEach(
      function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.hidden = !isGmTurn;
      }
    );
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
    var isGmTurn = state.turnHolder !== "players";
    statusEl.textContent = window.I18N.t(isGmTurn ? "turn_holder_gm_status" : "turn_holder_players_status");
    toggleBtn.textContent = window.I18N.t(isGmTurn ? "turn_holder_end_gm_button" : "turn_holder_end_players_button");
    if (messageInput) messageInput.placeholder = window.I18N.t("turn_message_placeholder");
    if (messageList) {
      messageList.innerHTML = "";
      state.turnMessages.forEach(function (msg) {
        var line = document.createElement("p");
        line.className = "threat-ref-body";
        var time = new Date(msg.time).toLocaleTimeString();
        line.textContent = "[" + time + "] " + msg.text;
        messageList.appendChild(line);
      });
    }
  }

  // Gm回合／玩家回合を交代する（ボタン文言は「Gm結束」「玩家結束」）。押すと確認ダイアログが出て、
  // 確定した場合のみメッセージ板（state.turnMessages）をクリアしてから交代する。
  function handleTurnHolderToggle() {
    if (!window.confirm(window.I18N.t("turn_board_end_turn_confirm"))) return;
    var wasGmTurn = state.turnHolder !== "players";
    state.turnHolder = wasGmTurn ? "players" : "gm";
    state.turnMessages = [];
    saveState();
    var toLabel = window.I18N.t(wasGmTurn ? "turn_holder_players_status" : "turn_holder_gm_status");
    addLog("log_turn_holder_handoff", { to: toLabel });
    renderTurnHolderBar();
  }

  // 送出ボタン：入力中のメッセージを現在のメッセージ板（state.turnMessages）へ1行追加する。
  // ログへの二重記録はしない（メッセージ板自体が記録の場のため）。
  function handleTurnMessageSend() {
    var input = document.getElementById("turn-message-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    state.turnMessages.push({ text: text, time: Date.now() });
    input.value = "";
    saveState();
    renderTurnHolderBar();
  }

  // 獨立獎勵勾選清單：地板獎勵システムとは無関係の、GMが自由記述で項目を追加・チェックできる
  // 一覧（state.turnRewards）。ターン交代では消えず、GMが手動で削除するまで保持される。
  // 戦闘弾窗と同じ.modal.minimizedパターンで縮小/復元できる。
  function openTurnRewardModal() {
    var modal = document.getElementById("turn-reward-modal");
    if (!modal) return;
    modal.hidden = false;
    modal.classList.remove("minimized");
    renderTurnRewardModalMinimizeButton();
    renderTurnRewardModal();
  }

  function closeTurnRewardModal() {
    var modal = document.getElementById("turn-reward-modal");
    if (modal) modal.hidden = true;
  }

  function renderTurnRewardModalMinimizeButton() {
    var modal = document.getElementById("turn-reward-modal");
    var btn = document.getElementById("btn-turn-reward-modal-minimize");
    if (!modal || !btn) return;
    var isMinimized = modal.classList.contains("minimized");
    btn.textContent = isMinimized ? "\u{1F5D6}" : "\u{1F5D5}";
    btn.title = window.I18N.t(isMinimized ? "combat_modal_restore_button" : "combat_modal_minimize_button");
  }

  function handleTurnRewardModalMinimizeToggle() {
    var modal = document.getElementById("turn-reward-modal");
    if (!modal) return;
    modal.classList.toggle("minimized");
    renderTurnRewardModalMinimizeButton();
  }

  function renderTurnRewardModal() {
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
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!reward.checked;
      checkbox.addEventListener("change", function () {
        reward.checked = checkbox.checked;
        saveState();
      });
      label.appendChild(checkbox);
      var text = document.createElement("span");
      text.textContent = reward.text;
      label.appendChild(text);
      row.appendChild(label);
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

  function handleTurnRewardAdd() {
    var input = document.getElementById("turn-reward-add-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    state.turnRewards.push({ id: "tr" + Date.now() + Math.floor(Math.random() * 1000), text: text, checked: false });
    input.value = "";
    saveState();
    renderTurnRewardModal();
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
          spirit.hpCurrent = Math.max(0, spirit.hpCurrent - 1);
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
          hp.current = Math.max(0, hp.current - 1);
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
    // 「戰鬥→額外→防禦」が1回合。combatフェイズへ新規突入するたびに新しい回合が始まったとみなし、
    // 異常側の「今回合すでに發動した」ロックを解除する（屬性側は回合をまたいで蓄積を持ち越す）。
    if (phase === "combat" && state.actionPhase !== "combat") {
      resetAttributeStatusRoundLocks();
      // 守護者「救世之翼」の全体バフ（戦闘→額外→防禦の1回合を跨いで持続）も、新しい回合が
      // 始まったタイミングでのみクリアする（フェイズ切替の都度リセットする他のフラグとは
      // ライフサイクルが異なる）。
      // 骰子池クリアは「防禦フェイズから戰鬥フェイズへ戻る＝次の回合へ進む」場合のみ発火させる。
      // 「一般行動」から初めて戰鬥フェイズへ入る（戦闘開始）は「次の回合」ではないため対象外
      // （このifブロック自体はresetAttributeStatusRoundLocks等のため combat以外全般で発火する）。
      var isNewRoundFromDefense = state.actionPhase === "defense";
      rosterCharacters.forEach(function (c) {
        // 新しい回合（防禦フェイズから戰鬥フェイズへ再突入）に入るとき、原則として全員の
        // 個人骰子池を空にする（技能・遺物効果で次回合へ持ち越せる場合は、そのキャラだけ
        // ここをスキップする条件を将来追加できる）。消えた骰子はログに記録する。
        if (isNewRoundFromDefense && (c.dicePool || []).length) {
          var clearedDice = c.dicePool.join("、");
          c.dicePool = [];
          addLog("log_dice_pool_cleared_new_round", { character: c.name, dice: clearedDice });
        }
        c._wingsOfSalvationActive = false;
        c._marchOfTheUndyingActive = false;
        c._inquiryDamageReductionActive = false;
        c._empathyActive = false;
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
    }
    // 隱者「血魂之歌」：「階段結束まで」＝発動したフェイズ限定のバフのため、フェイズが
    // 変わるたびに必ずクリアする（回合単位で持続する救世之翼／終曲等とはライフサイクルが
    // 異なる。battle全体のフラグのため、下のrosterCharacters.forEachとは別に1回だけ行う）。
    state.battle._songOfBloodSpiritActive = false;
    state.actionPhase = phase;
    // GM／玩家が同時にプレイしなくてもよいよう、行動階段が切り替わるたびに「今の番」を
    // 必ずGM側へ戻す（GMが状況を確認・反応してから、改めて玩家へ番を渡す運用を想定）。
    state.turnHolder = "gm";
    // フェイズを切り替えるたびに「額外／防禦行動を使用済み」フラグをリセットする（次にまた
    // 同じフェイズへ入ったとき、全員が改めて1回分振れるようにするため）。
    rosterCharacters.forEach(function (c) {
      c._extraActionUsed = false;
      c._defenseActionUsed = false;
      c._consecutiveGuardCount = 0;
      c._dodgeActionUsed = false;
      // 守護者「高防禦」（本フェイズが終わるまで持続）と「旋風」（本フェイズにつき1回まで）は
      // どちらもフェイズ切替の都度リセットする。無賴漢「逆襲」をDefenseとして使用した後の
      // 「他の格擋を使用できない」ロックも同様に、フェイズ切替の都度リセットする。
      c._highGuardActive = false;
      c._whirlwindUsedThisPhase = false;
      c._counterattackDefenseUsed = false;
      // 執行者「坩堝諸相・獸」：「階段結束まで」＝発動したフェイズ限定のため、フェイズ切替の
      // 都度リセットする（血魂之歌のbattle全体フラグとは異なりキャラごとのフラグ）。
      c._crucibleBeastActive = false;
      delete rosterDiceRollFeedback[c.id];
    });
    // 額外・防禦行動へ入るときは、各角色の確定行動（点線枠）を一旦全てクリアする。
    if (phase === "extra" || phase === "defense") {
      clearAllPendingActionBoxes();
    }
    saveRosterCharacters();
    saveState();
    closeActionPhaseModal();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderCharacterRoster();
    if (opts.combatEnd) {
      // 復仇者「死靈術」で召喚した死靈は、靈體と異なりHPを維持せず戦闘終了時に全て消滅する
      // （「戰鬥結束時自動從劇本中移除」）。靈體（c.spiritSummon／spiritSummonHp）はここでは
      // クリアしない（目前HP維持のまま自動的に姿を消すのみで、再召喚時にHPを引き継ぐため）。
      rosterCharacters.forEach(function (c) {
        c.deathSpirits = [];
        // 執行者「不撓」：戦闘終了までの持続スタックのため、戦闘終了のタイミングでクリアする。
        c._unyieldingStacks = 0;
      });
      addLog("log_battle_combat_end");
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
  // 武器ウィザード／消耗品／護符ボタンから共通で使う。潛在之力（openPotentialPowerModal）と
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
  }

  function closeItemDrawModal() {
    document.getElementById("item-draw-modal").hidden = true;
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

  // ============================================================
  // 潛在之力（潜在する力）：地圖板塊で敵人を擊破、または全踏破した際などにPCが獲得できる
  // 機会。GMが★の数（レア度決定値）を指定して抽選すると「得意武器」と「付帯効果」の両方の
  // 結果が確定し、PCはそのどちらか一方だけを選んで獲得する（規則書093/149頁）。
  // ============================================================
  var potentialPowerSelectedCharacterId = null;
  var potentialPowerStarCount = 1;
  var potentialPowerWeaponResult = null; // CharacterDrawer.potentialPowerDrawWeaponの戻り値 | null
  var potentialPowerEffectResult = null; // CharacterDrawer.rollPotentialPowerAttachedEffectの戻り値 | null
  var potentialPowerEffectSlotPreview = null; // CharacterDrawer.previewAttachedEffectSlotの戻り値 | null（3枠埋まっている場合のみ）
  var potentialPowerResolved = null; // "weapon" | "effect" | null
  var potentialPowerMinimized = false; // 一時的に内容を畳んで、他の面板（角色詳細等）を確認できるようにする
  var potentialPowerPendingAttributeTag = null; // 場地報酬で指定された共通戦技タグ（例:「炎/-5」）。武器確定時に自動付与する
  var potentialPowerOnResolvedFn = null; // 場地報酬から起動した場合のみ、実際に武器/付帯効果を確定した時点でmarkFloorRewardObtainedを呼ぶコールバック

  function openPotentialPowerModal(presetCharacterId, presetStarCount, presetAttributeTag, onResolved) {
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;
    if (
      presetCharacterId &&
      entered.some(function (c) {
        return c.id === presetCharacterId;
      })
    ) {
      potentialPowerSelectedCharacterId = presetCharacterId;
    } else if (
      !entered.some(function (c) {
        return c.id === potentialPowerSelectedCharacterId;
      })
    ) {
      potentialPowerSelectedCharacterId = entered[0].id;
    }
    potentialPowerStarCount = presetStarCount || 1;
    potentialPowerWeaponResult = null;
    potentialPowerEffectResult = null;
    potentialPowerEffectSlotPreview = null;
    potentialPowerResolved = null;
    potentialPowerMinimized = false;
    potentialPowerPendingAttributeTag = presetAttributeTag || null;
    potentialPowerOnResolvedFn = onResolved || null;
    document.getElementById("potential-power-modal").hidden = false;
    renderPotentialPowerModal();
  }

  function closePotentialPowerModal() {
    document.getElementById("potential-power-modal").hidden = true;
    document.getElementById("btn-potential-power-restore").hidden = true;
  }

  // 抽選結果を保持したままモーダルだけを一時的に隠す（状態はリセットしない）。プレイヤーが
  // 自分の他の装備・能力の状況を角色詳細等で確認してから、抽選結果の選択に戻れるようにする。
  function minimizePotentialPowerModal() {
    document.getElementById("potential-power-modal").hidden = true;
    document.getElementById("btn-potential-power-restore").hidden = false;
  }

  function restorePotentialPowerModal() {
    document.getElementById("btn-potential-power-restore").hidden = true;
    document.getElementById("potential-power-modal").hidden = false;
    renderPotentialPowerModal();
  }

  function resetPotentialPowerRoll() {
    potentialPowerWeaponResult = null;
    potentialPowerEffectResult = null;
    potentialPowerEffectSlotPreview = null;
    potentialPowerResolved = null;
  }

  function renderPotentialPowerModal() {
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    var select = document.getElementById("potential-power-character-select");
    select.innerHTML = "";
    entered.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === potentialPowerSelectedCharacterId) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function () {
      potentialPowerSelectedCharacterId = select.value;
      resetPotentialPowerRoll();
      renderPotentialPowerModal();
    };

    var starSelect = document.getElementById("potential-power-star-select");
    starSelect.value = String(potentialPowerStarCount);
    starSelect.disabled = !!(potentialPowerWeaponResult || potentialPowerEffectResult);
    starSelect.onchange = function () {
      potentialPowerStarCount = parseInt(starSelect.value, 10) || 1;
    };

    var c = entered.filter(function (rc) {
      return rc.id === potentialPowerSelectedCharacterId;
    })[0];
    var content = document.getElementById("potential-power-modal-content");
    content.innerHTML = "";
    var minimizeBtn = document.getElementById("btn-potential-power-minimize");
    var hasActiveRoll = !!(potentialPowerWeaponResult || potentialPowerEffectResult) && !potentialPowerResolved;
    minimizeBtn.hidden = !hasActiveRoll;
    if (!c) return;

    if (potentialPowerResolved) {
      var doneP = document.createElement("p");
      doneP.className = "threat-ref-body weapon-roll-result";
      doneP.textContent = window.I18N.t("potential_power_resolved_note");
      content.appendChild(doneP);
      return;
    }

    if (!potentialPowerWeaponResult && !potentialPowerEffectResult) {
      var rollBtn = document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "primary-btn";
      rollBtn.textContent = window.I18N.t("potential_power_roll_button");
      rollBtn.addEventListener("click", function () {
        potentialPowerWeaponResult = CharacterDrawer.potentialPowerDrawWeapon(c, potentialPowerStarCount);
        potentialPowerEffectResult = CharacterDrawer.rollPotentialPowerAttachedEffect(c);
        // 3枠が既に埋まっている場合、どの枠が上書きされるかを先に判定しておき、選択前に
        // プレイヤーへ提示できるようにする（実際の上書きはcommitAttachedEffectChoiceで
        // このプレビュー結果をそのまま使う）。
        potentialPowerEffectSlotPreview = CharacterDrawer.previewAttachedEffectSlot(c);
        renderPotentialPowerModal();
      });
      content.appendChild(rollBtn);
      return;
    }

    // --- 得意武器の結果 ---
    var weaponTitle = document.createElement("h5");
    weaponTitle.textContent = window.I18N.t("potential_power_weapon_title");
    content.appendChild(weaponTitle);
    var Weapons = window.PriTestWeapons;
    if (potentialPowerWeaponResult && potentialPowerWeaponResult.item) {
      var wr = potentialPowerWeaponResult;
      var weaponCard = document.createElement("div");
      weaponCard.className = "relic-candidate-card";
      var weaponBody = document.createElement("p");
      weaponBody.className = "threat-ref-body weapon-roll-result";
      weaponBody.textContent = window.I18N.t("potential_power_weapon_result", {
        favored: wr.favoredName || "-",
        category: Weapons.localizedText(Weapons.getCategory(wr.categoryId).name),
        rarity: wr.rarity,
        weapon: Weapons.localizedText(wr.item.name),
      });
      weaponCard.appendChild(weaponBody);
      var weaponDetails = document.createElement("details");
      weaponDetails.className = "ability-entry";
      var weaponSummary = document.createElement("summary");
      weaponSummary.textContent = window.I18N.t("potential_power_weapon_detail_toggle");
      weaponDetails.appendChild(weaponSummary);
      var skillNames = CharacterDrawer.weaponPreviewSkillNames(wr.item, wr.categoryId, wr.skillId);
      var skillP = document.createElement("p");
      skillP.className = "threat-ref-body";
      skillP.textContent = skillNames.length ? skillNames.join("、") : window.I18N.t("potential_power_weapon_no_skill_note");
      weaponDetails.appendChild(skillP);
      weaponCard.appendChild(weaponDetails);
      if (potentialPowerPendingAttributeTag) {
        var attributeTagNote = document.createElement("p");
        attributeTagNote.className = "threat-ref-body weapon-roll-note";
        attributeTagNote.textContent = window.I18N.t("potential_power_pending_attribute_tag_note", { tag: potentialPowerPendingAttributeTag });
        weaponCard.appendChild(attributeTagNote);
      }
      var weaponChooseBtn = document.createElement("button");
      weaponChooseBtn.type = "button";
      weaponChooseBtn.className = "primary-btn";
      weaponChooseBtn.textContent = window.I18N.t("potential_power_weapon_choose_button");
      weaponChooseBtn.addEventListener("click", function () {
        var newWeaponId = CharacterDrawer.commitPotentialPowerWeapon(c, wr, potentialPowerPendingAttributeTag);
        saveRosterCharacters();
        renderCharacterRoster();
        addLog("log_potential_power_weapon_choice", { character: c.name, weapon: Weapons.localizedText(wr.item.name) });
        potentialPowerResolved = "weapon";
        renderPotentialPowerModal();
        if (typeof potentialPowerOnResolvedFn === "function") potentialPowerOnResolvedFn();
        CharacterDrawer.resolveInventoryOverflow(c, "weapon", function () {
          renderCharacterRoster();
        });
      });
      weaponCard.appendChild(weaponChooseBtn);
      content.appendChild(weaponCard);
    } else {
      var weaponFail = document.createElement("p");
      weaponFail.className = "threat-ref-body";
      weaponFail.textContent = window.I18N.t("potential_power_weapon_draw_failed");
      content.appendChild(weaponFail);
    }

    // --- 付帯効果の結果 ---
    var effectTitle = document.createElement("h5");
    effectTitle.textContent = window.I18N.t("potential_power_effect_title");
    content.appendChild(effectTitle);
    var er = potentialPowerEffectResult;

    function appendEffectChooseCard(effect) {
      var card = document.createElement("div");
      card.className = "relic-candidate-card";
      var name = document.createElement("div");
      name.className = "relic-candidate-name";
      name.textContent = Weapons.localizedText(effect.name) + "［Passive］";
      card.appendChild(name);
      var body = document.createElement("p");
      body.className = "threat-ref-body";
      body.textContent = Weapons.localizedText(effect.body);
      card.appendChild(body);
      if (potentialPowerEffectSlotPreview) {
        var replacedEffect = CharacterDrawer.attachedEffectById(potentialPowerEffectSlotPreview.replacedId);
        var replaceNote = document.createElement("p");
        replaceNote.className = "threat-ref-body";
        replaceNote.style.color = "#b3441e";
        replaceNote.textContent = window.I18N.t("potential_power_effect_will_replace_note", {
          old: replacedEffect ? Weapons.localizedText(replacedEffect.name) : potentialPowerEffectSlotPreview.replacedId,
        });
        card.appendChild(replaceNote);
        if (replacedEffect) {
          // 失う予定の効果の全文も同じ画面で確認できるようにする（名前だけでは判断しづらいため）。
          var replacedBox = document.createElement("div");
          replacedBox.className = "relic-candidate-card";
          replacedBox.style.background = "#fff2ec";
          var replacedName = document.createElement("div");
          replacedName.className = "relic-candidate-name";
          replacedName.textContent = Weapons.localizedText(replacedEffect.name) + "［Passive］";
          replacedBox.appendChild(replacedName);
          var replacedBody = document.createElement("p");
          replacedBody.className = "threat-ref-body";
          replacedBody.textContent = Weapons.localizedText(replacedEffect.body);
          replacedBox.appendChild(replacedBody);
          card.appendChild(replacedBox);
        }
      }
      var chooseBtn = document.createElement("button");
      chooseBtn.type = "button";
      chooseBtn.className = "primary-btn";
      chooseBtn.textContent = window.I18N.t("potential_power_effect_choose_button");
      chooseBtn.addEventListener("click", function () {
        var result = CharacterDrawer.commitAttachedEffectChoice(c, effect, potentialPowerEffectSlotPreview);
        saveRosterCharacters();
        var effectName = Weapons.localizedText(effect.name);
        if (result.replacedId) {
          var oldEffect = CharacterDrawer.attachedEffectById(result.replacedId);
          addLog("log_potential_power_effect_replace", {
            character: c.name,
            effect: effectName,
            old: oldEffect ? Weapons.localizedText(oldEffect.name) : result.replacedId,
          });
        } else {
          addLog("log_potential_power_effect_choice", { character: c.name, effect: effectName });
        }
        potentialPowerResolved = "effect";
        renderPotentialPowerModal();
        if (typeof potentialPowerOnResolvedFn === "function") potentialPowerOnResolvedFn();
      });
      card.appendChild(chooseBtn);
      content.appendChild(card);
    }

    if (er && er.effect) {
      var effectRollNote = document.createElement("p");
      effectRollNote.className = "threat-ref-body weapon-roll-result";
      effectRollNote.textContent = window.I18N.t("potential_power_effect_dice_note", { dice: er.dice.join("、") });
      content.appendChild(effectRollNote);
      appendEffectChooseCard(er.effect);
    } else if (er && er.candidates && er.candidates.length) {
      var fallbackNote = document.createElement("p");
      fallbackNote.className = "threat-ref-body";
      fallbackNote.textContent = window.I18N.t("potential_power_effect_fallback_note", { dice: er.dice.join("、") });
      content.appendChild(fallbackNote);
      er.candidates.forEach(appendEffectChooseCard);
    } else {
      var effectFail = document.createElement("p");
      effectFail.className = "threat-ref-body";
      effectFail.textContent = window.I18N.t("potential_power_effect_all_learned_note");
      content.appendChild(effectFail);
    }
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

    container.appendChild(buildEnemyLevelTable(row.familyBase));

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
      var key = row.familyId + "|" + row.enemy.id + "|" + level;
      if (state.battle.selectedEnemyIds.indexOf(key) === -1) {
        var isFreshEncounter = state.battle.selectedEnemyIds.length === 0;
        state.battle.selectedEnemyIds.push(key);
        if (isFreshEncounter) {
          applyInitialPassiveAggro();
          // 新規遭遇の最初の1体に限り、そのレベルのHP枠表記（例："×7/×7"）から
          // 第1段・第2段のHPチェックを自動設定する（既存の戦闘中に追加する2体目以降は、
          // 既にチェック済みのHPを壊さないよう対象にしない）。
          var lvRow = (row.familyBase || []).filter(function (lv) {
            return lv.level === level;
          })[0];
          var hpNotation = lvRow && lvRow.hp ? parseEnemyHpNotation(lvRow.hp) : null;
          if (hpNotation) {
            setEnemyHpRowCount(0, hpNotation.row1);
            setEnemyHpRowCount(1, hpNotation.row2);
            renderEnemyHpGrid();
            handleEnemyHpChanged();
          }
        }
        renderSelectedEnemies();
        addLog("log_battle_enemy_add", { enemy: T(row.enemy.name), level: level });
      }
    });
    addRow.appendChild(addBtn);
    container.appendChild(addRow);
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

  function renderSelectedEnemies() {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return;
    var T = Enemies.localizedText;
    var ids = (state.battle && state.battle.selectedEnemyIds) || [];
    var resolved = ids
      .map(function (key) {
        var parts = key.split("|");
        var info = Enemies.get(parts[0], parts[1]);
        var level = Math.max(1, Number(parts[2]) || 1);
        return info ? { key: key, info: info, level: level } : null;
      })
      .filter(Boolean);

    var boardSideHp = document.getElementById("board-side-enemy-hp");
    if (boardSideHp) boardSideHp.hidden = resolved.length === 0;
    if (typeof renderBattlePositionAreas === "function") renderBattlePositionAreas();

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
        chip.className = "selected-enemy-chip";
        chip.style.cursor = "pointer";
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
        if (target.withRemove && lvRow && lvRow.dmg != null) {
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

  function renderDayStatus() {
    var dayText = window.I18N.t("day_status", { n: state.dayNumber });
    var text = game.name + " " + dayText;
    if (scenario) {
      text += " ・ " + Scenarios.localizedName(scenario.name);
    }
    document.getElementById("day-status").textContent = text;
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
      var effect = Scenarios.findCardEffect(game.scenarioId, dayKey, card.suit, card.rank);
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
      var img = document.createElement("img");
      img.className = "slot-chip-icon";
      img.src = "../static/images/icons/" + chipDef.icon;
      img.alt = window.I18N.t("event_chip_" + chipId);
      var label = document.createElement("span");
      label.textContent = window.I18N.t("event_chip_" + chipId);
      chipRow.appendChild(img);
      chipRow.appendChild(label);
      if (chipId === "merchant") {
        chipRow.style.cursor = "pointer";
        chipRow.addEventListener("click", openMerchantModal);
      }
      el.appendChild(chipRow);
    }
  }

  function stepCardLevel(index, dir) {
    if (!state.slots[index]) return;
    var curIdx = LEVEL_STEPS.indexOf(state.cardLevels[index]);
    if (curIdx === -1) curIdx = 0;
    var nextIdx = (curIdx + dir + LEVEL_STEPS.length) % LEVEL_STEPS.length;
    state.cardLevels[index] = LEVEL_STEPS[nextIdx];
    renderCardLevel(index);
    saveState();
  }

  // ============================================================
  // 樓層突破判定（板塊の「+」ボタンから起動）。
  // 場地カードの該当分岐・フロアの「突破判定」欄（例：「〈協力10×PC人数｜フィジカル〉」
  // 「(10 | 任意の判定値)」「不可」「自動成功」）は書式が多様で、かつ現在どの分岐が
  // 実際に選ばれているかはアプリ側で追跡していないため、GMが分岐／フロアを選んで
  // 「取り込む」ボタンで自動反映するか、目標点・PC人数倍・判定属性を直接手入力するかの
  // どちらも選べるようにする（自動判定はあくまで下書き、最終的な数値は常に編集可能）。
  // ============================================================
  var breakthroughState = null; // { slotIndex, characters: { [charId]: { stat, dice } } }

  function parseBreakthroughCheckText(text) {
    var t = String(text || "");
    if (t.indexOf("自動成功") !== -1) return { special: "auto" };
    if (t.indexOf("不可") !== -1) return { special: "cannot" };
    var numMatch = /(\d+)/.exec(t);
    if (!numMatch) return null;
    var stat = null;
    if (t.indexOf("フィジカル") !== -1 || t.indexOf("體能") !== -1) stat = "physical";
    else if (t.indexOf("メンタル") !== -1 || t.indexOf("精神") !== -1) stat = "mental";
    else if (t.indexOf("運試し") !== -1 || t.indexOf("運氣") !== -1 || t.indexOf("運気") !== -1) stat = "luck";
    else if (t.indexOf("任意") !== -1) stat = "any";
    return { target: parseInt(numMatch[1], 10), perPC: t.indexOf("PC人") !== -1, stat: stat };
  }

  // 板塊のカード（rank・suit）から、該当する場地カードエントリーを解決する。
  // onSlotShortClickと同じ「Aのみスートで出発地点／黄金樹の帳を判別」ロジックを再利用する。
  function resolveFieldEntryForSlot(index) {
    var slot = state.slots[index];
    if (!slot) return null;
    var card = CARD_BY_CODE[slot.code];
    var Fields = window.PriTestFields;
    if (!card || !Fields) return null;
    var matches = Fields.list().filter(function (fc) {
      return fc.cardLabel === card.rank;
    });
    if (!matches.length) return null;
    if (card.rank === "A" && matches.length > 1) {
      var wantId = card.suit === state.startSuit ? "a_start" : "a_golden";
      return (
        matches.filter(function (fc) {
          return fc.id === wantId;
        })[0] || matches[0]
      );
    }
    return matches[0];
  }

  // 樓層突破判定モーダルの分岐/フロア選択に連動して、そのフロアの「獲得」ボタン群を描画する。
  // floor.reward（fields.jsに手作業で追加した構造化データ）が無いフロアは何も表示しない。
  // 樓層の「獲得」ボタン（規則書の該当フロア見出し直下）は1つだけ配置し、押すと規則書を
  // 閉じてこの小さな専用モーダルを開く。抽選と違って各ボタンは即時に効果を適用するだけ
  // （やり直しが効く一覧選択なので）、保持すべき状態は「どのフロアを開いているか」だけ。
  var floorRewardModalFloor = null;

  function openFloorRewardModal(floor) {
    floorRewardModalFloor = floor;
    document.getElementById("rulebook-modal").hidden = true;
    document.getElementById("floor-reward-modal").hidden = false;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floor);
  }

  function closeFloorRewardModal() {
    document.getElementById("floor-reward-modal").hidden = true;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    floorRewardModalFloor = null;
  }

  function minimizeFloorRewardModal() {
    document.getElementById("floor-reward-modal").hidden = true;
    document.getElementById("btn-floor-reward-restore").hidden = false;
  }

  function restoreFloorRewardModal() {
    document.getElementById("btn-floor-reward-restore").hidden = true;
    document.getElementById("floor-reward-modal").hidden = false;
    if (floorRewardModalFloor) renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floorRewardModalFloor);
  }

  // floor.rewardは「起こりうる報酬オプションの配列」として持つ（規則書の報酬記述は分岐・
  // 条件付きのものが大半のため、1つに決め打ちせず、実際に起きた結果に応じてGMが該当する
  // ボタンだけを押す設計にしている）。各エントリの形：
  //   { kind: "rune"|"consumable"|"weaponStar"|"stoneswordKey"|"smithingStone"|
  //           "potentialPower"|"hpDamage"|"chaliceBonus"|"tieredChoice"|"diceHandChoice"|
  //           "bargainReveal"|"note",
  //     perPerson: bool（true=入場中の全PCへ一括適用、false=GMが対象を1人選ぶ）,
  //     value: number（個数・点数）,
  //     note: {ja,zh}（任意、ボタンの補足テキストや"note"種別の本文） }
  function renderFloorRewardOption(container, entry, entered, floorKey, entryIndex) {
    var Consumables = window.PriTestConsumables;
    // 武器／潜在する力の報酬は「獲得済み」を対象キャラID込みでstate.floorRewardObtainedへ
    // 永続化する（floorKeyが無い呼び出し元＝旧経路や単体テストでは永続化をスキップする）。
    function obtainedStateKey(targetCharacterId) {
      if (!floorKey || entryIndex === undefined) return null;
      return floorKey + "_" + entryIndex + "_" + targetCharacterId;
    }
    function isAlreadyObtained(targetCharacterId) {
      var key = obtainedStateKey(targetCharacterId);
      return !!(key && state.floorRewardObtained && state.floorRewardObtained[key]);
    }
    var noteText = entry.note ? window.PriTestFields.localizedText(entry.note) : "";
    // 武器・潜在する力の共通戦技タグ（例:「炎/-5」）。fields.js側は{ja,zh}で持つため、
    // ここで表示言語へ解決してから武器抽選ウィザード／潜在する力モーダルへ渡す。
    var resolvedAttributeTag = entry.attributeTag ? window.PriTestFields.localizedText(entry.attributeTag) : null;

    function makeTargetSelect() {
      var select = document.createElement("select");
      entered.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name;
        select.appendChild(o);
      });
      return select;
    }

    if (entry.kind === "hpDamage") {
      var hpRow = document.createElement("div");
      hpRow.className = "wb-row";
      var hpLabel = document.createElement("span");
      hpLabel.className = "threat-ref-body";
      hpLabel.textContent = window.I18N.t("floor_reward_failure_hp_label", { value: entry.value }) + noteText;
      hpRow.appendChild(hpLabel);
      var hpSelect = makeTargetSelect();
      hpRow.appendChild(hpSelect);
      var hpBtn = document.createElement("button");
      hpBtn.type = "button";
      hpBtn.textContent = window.I18N.t("floor_reward_apply_hp_button");
      hpBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === hpSelect.value;
        })[0];
        if (!target) return;
        target.hp.current = Math.max(0, (target.hp.current || 0) - entry.value);
        saveRosterCharacters();
        renderCharacterRoster();
        addLog("log_floor_reward_hp_damage", { character: target.name, value: entry.value });
        hpSelect.disabled = true;
        markFloorRewardObtained(hpBtn, window.I18N.t("log_floor_reward_hp_damage", { character: target.name, value: entry.value }));
      });
      hpRow.appendChild(hpBtn);
      container.appendChild(hpRow);
      return;
    }

    if (entry.kind === "rune") {
      var runeBtn = document.createElement("button");
      runeBtn.type = "button";
      runeBtn.className = "primary-btn";
      runeBtn.textContent = window.I18N.t("floor_reward_rune_button", { value: entry.value }) + noteText;
      runeBtn.addEventListener("click", function () {
        entered.forEach(function (c) {
          c.runes = (c.runes || 0) + entry.value;
        });
        saveRosterCharacters();
        renderCharacterRoster();
        addLog("log_floor_reward_rune", { value: entry.value, count: entered.length });
        markFloorRewardObtained(runeBtn, window.I18N.t("log_floor_reward_rune", { value: entry.value, count: entered.length }));
      });
      container.appendChild(runeBtn);
      return;
    }

    if (entry.kind === "chaliceBonus") {
      // 全体PCの聖杯瓶「使用回数：+N」。基本欄ではなく追加欄（flaskExtra）へ加算する。
      var chaliceBtn = document.createElement("button");
      chaliceBtn.type = "button";
      chaliceBtn.className = "primary-btn";
      chaliceBtn.textContent = window.I18N.t("floor_reward_chalice_bonus_button", { value: entry.value }) + noteText;
      chaliceBtn.addEventListener("click", function () {
        entered.forEach(function (c) {
          if (!c.flaskExtra) c.flaskExtra = { current: 0, max: 0 };
          c.flaskExtra.max = (c.flaskExtra.max || 0) + entry.value;
          c.flaskExtra.current = (c.flaskExtra.current || 0) + entry.value;
        });
        saveRosterCharacters();
        renderCharacterRoster();
        addLog("log_floor_reward_chalice_bonus", { value: entry.value, count: entered.length });
        markFloorRewardObtained(chaliceBtn, window.I18N.t("log_floor_reward_chalice_bonus", { value: entry.value, count: entered.length }));
      });
      container.appendChild(chaliceBtn);
      return;
    }

    // 消耗品／護符の場地報酬は、GMの手動アイテム選択ではなく、主選單と同じ擲骰抽選UIを
    // このカード内にそのまま展開して決める（詳細画面へは遷移しない）。
    if (entry.kind === "consumable") {
      var consumableRow = document.createElement("div");
      consumableRow.className = "wb-row";
      var consumableCharSelect = makeTargetSelect();
      consumableRow.appendChild(consumableCharSelect);
      var consumableBtn = document.createElement("button");
      consumableBtn.type = "button";
      consumableBtn.textContent = window.I18N.t("floor_reward_consumable_button", { value: entry.value }) + noteText;
      consumableBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === consumableCharSelect.value;
        })[0];
        if (!target) return;
        minimizeFloorRewardModal();
        addLog("log_floor_reward_consumable_roll_nav", { character: target.name });
        openItemDrawModal("consumable", target.id, {
          grantCount: entry.value,
          onGranted: function () {
            consumableCharSelect.disabled = true;
            markFloorRewardObtained(consumableBtn, window.I18N.t("log_floor_reward_consumable_roll_nav", { character: target.name }));
          },
        });
      });
      consumableRow.appendChild(consumableBtn);
      container.appendChild(consumableRow);
      return;
    }

    if (entry.kind === "talisman") {
      var talismanRow = document.createElement("div");
      talismanRow.className = "wb-row";
      var talismanCharSelect = makeTargetSelect();
      talismanRow.appendChild(talismanCharSelect);
      var talismanBtn = document.createElement("button");
      talismanBtn.type = "button";
      talismanBtn.textContent = window.I18N.t("floor_reward_talisman_button", { value: entry.value }) + noteText;
      talismanBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === talismanCharSelect.value;
        })[0];
        if (!target) return;
        minimizeFloorRewardModal();
        addLog("log_floor_reward_talisman_roll_nav", { character: target.name });
        openItemDrawModal("talisman", target.id, {
          onGranted: function () {
            talismanCharSelect.disabled = true;
            markFloorRewardObtained(talismanBtn, window.I18N.t("log_floor_reward_talisman_roll_nav", { character: target.name }));
          },
        });
      });
      talismanRow.appendChild(talismanBtn);
      container.appendChild(talismanRow);
      return;
    }

    if (entry.kind === "weaponStar") {
      var weaponRow = document.createElement("div");
      weaponRow.className = "wb-row";
      var weaponCharSelect = makeTargetSelect();
      weaponRow.appendChild(weaponCharSelect);
      var weaponBtn = document.createElement("button");
      weaponBtn.type = "button";

      // カテゴリ指定（聖印／杖／射撃武器グループ等）や共通戦技タグ（例:「炎／-5」）が
      // 付いている場合は、簡易抽選ではなく本格の武器抽選ウィザードへ連携する（詳細画面へは
      // 遷移せず、このカード内に直接ウィザードを展開する）。
      if (entry.categoryId || entry.attributeTag) {
        weaponBtn.textContent = window.I18N.t("floor_reward_weapon_star_wizard_button", { value: "★".repeat(entry.value) }) + noteText;
        if (isAlreadyObtained()) {
          weaponBtn.disabled = true;
          weaponBtn.classList.add("field-reward-obtained");
          weaponCharSelect.disabled = true;
        }
        weaponBtn.addEventListener("click", function () {
          var target = entered.filter(function (c) {
            return c.id === weaponCharSelect.value;
          })[0];
          if (!target) return;
          minimizeFloorRewardModal();
          addLog("log_floor_reward_weapon_wizard_nav", { character: target.name, value: "★".repeat(entry.value) });
          openItemDrawModal("weapon", target.id, {
            starCount: entry.value,
            categoryId: entry.categoryId,
            attributeTag: resolvedAttributeTag,
            onGranted: function () {
              weaponCharSelect.disabled = true;
              markFloorRewardObtained(
                weaponBtn,
                window.I18N.t("log_floor_reward_weapon_wizard_nav", { character: target.name, value: "★".repeat(entry.value) }),
                obtainedStateKey()
              );
            },
          });
        });
        weaponRow.appendChild(weaponBtn);
        container.appendChild(weaponRow);
        return;
      }

      weaponBtn.textContent = window.I18N.t("floor_reward_weapon_star_button", { value: "★".repeat(entry.value) }) + noteText;
      if (isAlreadyObtained()) {
        weaponBtn.disabled = true;
        weaponBtn.classList.add("field-reward-obtained");
        weaponCharSelect.disabled = true;
      }
      weaponBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === weaponCharSelect.value;
        })[0];
        if (!target) return;
        var result = CharacterDrawer.merchantDrawWeapon(target, entry.value);
        if (!result) {
          window.alert(window.I18N.t("potential_power_weapon_draw_failed"));
          return;
        }
        saveRosterCharacters();
        renderCharacterRoster();
        var Weapons = window.PriTestWeapons;
        var weaponLabel = Weapons.localizedText(result.item.name);
        addLog("log_floor_reward_weapon", { character: target.name, weapon: weaponLabel });
        weaponCharSelect.disabled = true;
        markFloorRewardObtained(
          weaponBtn,
          window.I18N.t("log_floor_reward_weapon", { character: target.name, weapon: weaponLabel }),
          obtainedStateKey()
        );
        CharacterDrawer.resolveInventoryOverflow(target, "weapon", function () {
          renderCharacterRoster();
        });
      });
      weaponRow.appendChild(weaponBtn);
      container.appendChild(weaponRow);
      return;
    }

    if (entry.kind === "stoneswordKey") {
      // perParty: true の場合、パーティ人数ぶんを1クリックで自動計算して加算する
      // （元々は「人数分クリックしてください」という手動運用だった箇所の自動化）。
      var keyTotal = entry.perParty ? entry.value * entered.length : entry.value;
      var keyBtn = document.createElement("button");
      keyBtn.type = "button";
      keyBtn.textContent =
        window.I18N.t("floor_reward_stonesword_key_button", { value: keyTotal }) +
        (entry.perParty ? window.I18N.t("floor_reward_per_party_suffix", { count: entered.length }) : "") +
        noteText;
      keyBtn.addEventListener("click", function () {
        state.stoneswordKeyCount = (state.stoneswordKeyCount || 0) + keyTotal;
        saveState();
        renderStoneswordKeyCount();
        addLog("log_floor_reward_stonesword_key", { value: keyTotal });
        markFloorRewardObtained(keyBtn, window.I18N.t("log_floor_reward_stonesword_key", { value: keyTotal }));
      });
      container.appendChild(keyBtn);
      return;
    }

    if (entry.kind === "smithingStone") {
      var stoneTotal = entry.perParty ? entry.value * entered.length : entry.value;
      var stoneBtn = document.createElement("button");
      stoneBtn.type = "button";
      stoneBtn.textContent =
        window.I18N.t("floor_reward_smithing_stone_button", { value: stoneTotal }) +
        (entry.perParty ? window.I18N.t("floor_reward_per_party_suffix", { count: entered.length }) : "") +
        noteText;
      stoneBtn.addEventListener("click", function () {
        state.smithingStoneCount = (state.smithingStoneCount || 0) + stoneTotal;
        saveState();
        renderSmithingStoneCount();
        addLog("log_floor_reward_smithing_stone", { value: stoneTotal });
        markFloorRewardObtained(stoneBtn, window.I18N.t("log_floor_reward_smithing_stone", { value: stoneTotal }));
      });
      container.appendChild(stoneBtn);
      return;
    }

    if (entry.kind === "potentialPower") {
      // 1人ずつ独立したボタンにする：押した瞬間にそのキャラクター専用の「潜在する力」
      // モーダルを開き（★数を引き継ぐ）、実際の抽選・確定はそちらのモーダルで行う。
      entered.forEach(function (c) {
        var ppBtn = document.createElement("button");
        ppBtn.type = "button";
        ppBtn.textContent = window.I18N.t("floor_reward_potential_power_button", { value: entry.value }) + "（" + c.name + "）" + noteText;
        if (isAlreadyObtained(c.id)) {
          ppBtn.disabled = true;
          ppBtn.classList.add("field-reward-obtained");
        }
        ppBtn.addEventListener("click", function () {
          addLog("log_floor_reward_potential_power_note", { names: c.name });
          minimizeFloorRewardModal();
          openPotentialPowerModal(c.id, entry.value, resolvedAttributeTag, function () {
            markFloorRewardObtained(
              ppBtn,
              window.I18N.t("log_floor_reward_potential_power_note", { names: c.name }),
              obtainedStateKey(c.id)
            );
          });
        });
        container.appendChild(ppBtn);
      });
      return;
    }

    // 鍛冶村「戦技の鍛冶台」：PC全員が1回まで、所持武器1つの戦技1つをランダム戦技決定表で
    // 再抽選できる。潛在之力と同じく1人1ボタン方式で、確定はキャラごとの専用モーダルで行う。
    if (entry.kind === "weaponSkillReroll") {
      entered.forEach(function (c) {
        var rerollBtn = document.createElement("button");
        rerollBtn.type = "button";
        rerollBtn.textContent = window.I18N.t("floor_reward_weapon_skill_reroll_button", { name: c.name }) + noteText;
        if (isAlreadyObtained(c.id)) {
          rerollBtn.disabled = true;
          rerollBtn.classList.add("field-reward-obtained");
        }
        rerollBtn.addEventListener("click", function () {
          minimizeFloorRewardModal();
          openWeaponSkillRerollModal(c.id, function () {
            markFloorRewardObtained(
              rerollBtn,
              window.I18N.t("log_floor_reward_weapon_skill_reroll_nav", { character: c.name }),
              obtainedStateKey(c.id)
            );
          });
        });
        container.appendChild(rerollBtn);
      });
      return;
    }

    if (entry.kind === "tieredChoice") {
      // 成功回数・聖甲蟲追跡回数など、段階に応じて報酬が変わるケース向け。
      // 先にセレクタで段階を選び、確定ボタンを押すまでは他の段階の報酬を見せない。
      var Fields = window.PriTestFields;
      var tieredRow = document.createElement("div");
      tieredRow.className = "wb-row tiered-choice-row";
      var tieredLabel = document.createElement("span");
      tieredLabel.className = "threat-ref-body";
      tieredLabel.textContent =
        (entry.tierLabel ? Fields.localizedText(entry.tierLabel) : window.I18N.t("floor_reward_tiered_choice_label")) +
        window.I18N.t("colon_separator");
      tieredRow.appendChild(tieredLabel);
      var tierSelect = document.createElement("select");
      (entry.tiers || []).forEach(function (tier, idx) {
        var o = document.createElement("option");
        o.value = String(idx);
        o.textContent = Fields.localizedText(tier.label);
        tierSelect.appendChild(o);
      });
      tieredRow.appendChild(tierSelect);
      var tierConfirmBtn = document.createElement("button");
      tierConfirmBtn.type = "button";
      tierConfirmBtn.className = "primary-btn";
      tierConfirmBtn.textContent = window.I18N.t("floor_reward_tiered_choice_confirm_button");
      var tierResultContainer = document.createElement("div");
      tierResultContainer.className = "tiered-choice-result";
      tierConfirmBtn.addEventListener("click", function () {
        var tier = (entry.tiers || [])[parseInt(tierSelect.value, 10)];
        if (!tier) return;
        tierSelect.disabled = true;
        var tierLabelText = Fields.localizedText(tier.label);
        addLog("log_floor_reward_tiered_choice", { tier: tierLabelText });
        markFloorRewardObtained(tierConfirmBtn, window.I18N.t("log_floor_reward_tiered_choice", { tier: tierLabelText }));
        (tier.rewards || []).forEach(function (sub) {
          renderFloorRewardOption(tierResultContainer, sub, entered);
        });
      });
      tieredRow.appendChild(tierConfirmBtn);
      container.appendChild(tieredRow);
      container.appendChild(tierResultContainer);
      return;
    }

    if (entry.kind === "diceHandChoice") {
      // 魔術師塔の解封等、実際にPCが振った複数個のダイス目から役を自動判定するケース向け。
      // GMが出目をプルダウンで入力→判定ボタンで役を確定すると、該当する役の報酬だけを表示する。
      var Fields2 = window.PriTestFields;
      var diceCount = entry.diceCount || 12;
      var diceWrap = document.createElement("div");
      diceWrap.className = "wb-row dice-hand-row";
      var diceLabel = document.createElement("span");
      diceLabel.className = "threat-ref-body";
      diceLabel.textContent = window.I18N.t("floor_reward_dice_hand_label", { count: diceCount });
      diceWrap.appendChild(diceLabel);
      var diceSelectGroup = document.createElement("div");
      diceSelectGroup.className = "dice-hand-select-group";
      var diceSelects = [];
      for (var di = 0; di < diceCount; di++) {
        var dieSelect = document.createElement("select");
        dieSelect.className = "dice-hand-die-select";
        [1, 2, 3, 4, 5, 6].forEach(function (v) {
          var opt = document.createElement("option");
          opt.value = String(v);
          opt.textContent = String(v);
          dieSelect.appendChild(opt);
        });
        diceSelects.push(dieSelect);
        diceSelectGroup.appendChild(dieSelect);
      }
      diceWrap.appendChild(diceSelectGroup);
      var judgeBtn = document.createElement("button");
      judgeBtn.type = "button";
      judgeBtn.className = "primary-btn";
      judgeBtn.textContent = window.I18N.t("floor_reward_dice_hand_judge_button");
      diceWrap.appendChild(judgeBtn);
      container.appendChild(diceWrap);
      var diceResultP = document.createElement("p");
      diceResultP.className = "threat-ref-body";
      container.appendChild(diceResultP);
      var diceResultContainer = document.createElement("div");
      diceResultContainer.className = "tiered-choice-result";
      container.appendChild(diceResultContainer);
      judgeBtn.addEventListener("click", function () {
        var values = diceSelects.map(function (s) {
          return parseInt(s.value, 10);
        });
        var counts = [0, 0, 0, 0, 0, 0, 0];
        values.forEach(function (v) {
          counts[v]++;
        });
        var maxCount = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
        var lowCount = counts[1] + counts[2] + counts[3];
        var highCount = counts[4] + counts[5] + counts[6];
        var isStraight = counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[4] > 0 && counts[5] > 0 && counts[6] > 0;
        var matchedId = null;
        if (maxCount >= 7) matchedId = "sevenDice";
        else if (lowCount === 0) matchedId = "large";
        else if (highCount === 0) matchedId = "small";
        else if (isStraight) matchedId = "straight";
        var matchedHand = (entry.hands || []).filter(function (h) {
          return h.id === matchedId;
        })[0];
        diceSelects.forEach(function (s) {
          s.disabled = true;
        });
        judgeBtn.disabled = true;
        var handLabelText = matchedHand ? Fields2.localizedText(matchedHand.label) : window.I18N.t("floor_reward_dice_hand_result_none");
        diceResultP.textContent = window.I18N.t("floor_reward_dice_hand_result", { dice: values.join("、"), hand: handLabelText });
        addLog("log_floor_reward_dice_hand", { dice: values.join("、"), hand: handLabelText });
        if (matchedHand) {
          (matchedHand.rewards || []).forEach(function (sub) {
            renderFloorRewardOption(diceResultContainer, sub, entered);
          });
        }
      });
      return;
    }

    if (entry.kind === "bargainReveal") {
      // 秤の商人等、対象PCが選んだ内容の「良い効果」だけを先に見せ、取引に応じる確定操作を
      // した後で初めて「悪い効果」もあわせて開示する二段階UI。効果自体はステータス修正など
      // 既存の型に落とし込めないものが多いため、確定後は個人紀錄への反映をGMに促す形にする。
      var Fields3 = window.PriTestFields;
      var bargainRow = document.createElement("div");
      bargainRow.className = "wb-row";
      var bargainCharSelect = makeTargetSelect();
      bargainRow.appendChild(bargainCharSelect);
      var bargainDealSelect = document.createElement("select");
      (entry.deals || []).forEach(function (deal, idx) {
        var opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = Fields3.localizedText(deal.label);
        bargainDealSelect.appendChild(opt);
      });
      bargainRow.appendChild(bargainDealSelect);
      var revealBtn = document.createElement("button");
      revealBtn.type = "button";
      revealBtn.className = "primary-btn";
      revealBtn.textContent = window.I18N.t("floor_reward_bargain_reveal_button");
      bargainRow.appendChild(revealBtn);
      container.appendChild(bargainRow);
      var goodP = document.createElement("p");
      goodP.className = "threat-ref-body";
      container.appendChild(goodP);
      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "primary-btn";
      confirmBtn.hidden = true;
      confirmBtn.textContent = window.I18N.t("floor_reward_bargain_confirm_button");
      container.appendChild(confirmBtn);
      var bothP = document.createElement("p");
      bothP.className = "threat-ref-body";
      container.appendChild(bothP);
      revealBtn.addEventListener("click", function () {
        var deal = (entry.deals || [])[parseInt(bargainDealSelect.value, 10)];
        if (!deal) return;
        bargainCharSelect.disabled = true;
        bargainDealSelect.disabled = true;
        revealBtn.disabled = true;
        goodP.textContent = window.I18N.t("floor_reward_bargain_good_label") + Fields3.localizedText(deal.good);
        confirmBtn.hidden = false;
      });
      confirmBtn.addEventListener("click", function () {
        var deal = (entry.deals || [])[parseInt(bargainDealSelect.value, 10)];
        if (!deal) return;
        var target = entered.filter(function (c) {
          return c.id === bargainCharSelect.value;
        })[0];
        bothP.textContent = window.I18N.t("floor_reward_bargain_bad_label") + Fields3.localizedText(deal.bad);
        var dealLabelText = Fields3.localizedText(deal.label);
        addLog("log_floor_reward_bargain", { character: target ? target.name : "", deal: dealLabelText });
        markFloorRewardObtained(confirmBtn, window.I18N.t("log_floor_reward_bargain", { character: target ? target.name : "", deal: dealLabelText }));
      });
      return;
    }

    if (entry.kind === "note") {
      var noteP = document.createElement("p");
      noteP.className = "threat-ref-body";
      noteP.textContent = noteText;
      container.appendChild(noteP);
    }
  }

  function renderFloorRewardSection(container, floor) {
    container.innerHTML = "";
    var reward = floor && floor.reward;
    if (!reward || !reward.length) return;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;

    var title = document.createElement("h5");
    title.textContent = window.I18N.t("floor_reward_title");
    container.appendChild(title);

    reward.forEach(function (entry, entryIndex) {
      renderFloorRewardOption(container, entry, entered, floor.__rewardKey, entryIndex);
    });
  }

  function populateBreakthroughFieldSelectors(index) {
    var Fields = window.PriTestFields;
    var branchSelect = document.getElementById("breakthrough-branch-select");
    var floorSelect = document.getElementById("breakthrough-floor-select");
    var importBtn = document.getElementById("breakthrough-import-btn");
    branchSelect.innerHTML = "";
    floorSelect.innerHTML = "";
    var entry = resolveFieldEntryForSlot(index);
    var hasData = !!(entry && entry.branches && entry.branches.length);
    branchSelect.hidden = !hasData;
    floorSelect.hidden = !hasData;
    importBtn.hidden = !hasData;
    if (!hasData) return;
    entry.branches.forEach(function (branch, bi) {
      var opt = document.createElement("option");
      opt.value = String(bi);
      opt.textContent = Fields.localizedText(branch.name);
      branchSelect.appendChild(opt);
    });
    function populateFloors() {
      floorSelect.innerHTML = "";
      var branch = entry.branches[Number(branchSelect.value) || 0];
      (branch.floors || []).forEach(function (floor, fi) {
        var opt = document.createElement("option");
        opt.value = String(fi);
        opt.textContent = Fields.localizedText(floor.label);
        floorSelect.appendChild(opt);
      });
    }
    branchSelect.onchange = populateFloors;
    populateFloors();
    importBtn.onclick = function () {
      var branch = entry.branches[Number(branchSelect.value) || 0];
      var floor = (branch.floors || [])[Number(floorSelect.value) || 0];
      if (!floor) return;
      // 「突破判定」ラベルはja/zhどちらも同一表記なので、直接比較する。
      var line = (floor.lines || []).filter(function (l) {
        return l.label && (l.label.ja === "突破判定" || l.label.zh === "突破判定");
      })[0];
      var parsed = line ? parseBreakthroughCheckText(Fields.localizedText(line.text)) : null;
      applyBreakthroughParsed(parsed);
    };
  }

  function applyBreakthroughParsed(parsed) {
    var errEl = document.getElementById("breakthrough-error");
    errEl.hidden = true;
    if (!parsed) {
      errEl.hidden = false;
      errEl.textContent = window.I18N.t("breakthrough_import_not_found");
      return;
    }
    if (parsed.special === "auto" || parsed.special === "cannot") {
      errEl.hidden = false;
      errEl.textContent = window.I18N.t(parsed.special === "auto" ? "breakthrough_special_auto" : "breakthrough_special_cannot");
      return;
    }
    document.getElementById("breakthrough-target-input").value = parsed.target;
    document.getElementById("breakthrough-perpc-checkbox").checked = !!parsed.perPC;
    document.getElementById("breakthrough-stat-select").value = parsed.stat || "any";
    renderBreakthroughCharacters();
  }

  function openBreakthroughModal(index) {
    breakthroughState = { slotIndex: index, mode: "floor", moveTarget: null, characters: {}, revealed: false };
    document.getElementById("breakthrough-modal-title").textContent = window.I18N.t("breakthrough_modal_title");
    document.getElementById("breakthrough-import-row").hidden = false;
    // 目標點數・PC人數倍のチェックは揭曉するまで非表示（GMも含め、揭曉ボタンを押すまでは
    // 誰の目にも触れないようにする）。判定属性（stat-select）は骰子を振るために必要な情報
    // なので、こちらは常に表示する。
    document.getElementById("breakthrough-target-hideable").hidden = true;
    document.getElementById("breakthrough-target-input").value = "10";
    document.getElementById("breakthrough-target-input").disabled = false;
    document.getElementById("breakthrough-perpc-checkbox").checked = false;
    document.getElementById("breakthrough-perpc-checkbox").disabled = false;
    document.getElementById("breakthrough-stat-select").value = "any";
    document.getElementById("breakthrough-stat-select").disabled = false;
    document.getElementById("breakthrough-error").hidden = true;
    populateBreakthroughFieldSelectors(index);
    renderBreakthroughCharacters();
    document.getElementById("breakthrough-modal").hidden = false;
  }

  // 攀登判定：花色が「高い」板塊への移動時に開く。目標値は9+花色差の固定計算式だが、
  // 各角色が最終的な骰子点数を確定するまでは非公開にする（樓層突破判定と同じ隠す演出だが、
  // GMの秘密ではないため揭曉に規則書パスワードは要求しない）。判定属性も固定で體能のみ
  // （任意選択にしない）。
  function openClimbingCheckModal(toIndex, suitDiff) {
    breakthroughState = { slotIndex: null, mode: "climb", moveTarget: toIndex, characters: {}, revealed: false };
    document.getElementById("breakthrough-modal-title").textContent = window.I18N.t("climb_check_modal_title");
    document.getElementById("breakthrough-import-row").hidden = true;
    document.getElementById("breakthrough-target-hideable").hidden = true;
    document.getElementById("breakthrough-target-input").value = String(9 + suitDiff);
    document.getElementById("breakthrough-target-input").disabled = true;
    document.getElementById("breakthrough-perpc-checkbox").checked = true;
    document.getElementById("breakthrough-perpc-checkbox").disabled = true;
    document.getElementById("breakthrough-stat-select").value = "physical";
    document.getElementById("breakthrough-stat-select").disabled = true;
    document.getElementById("breakthrough-error").hidden = true;
    renderBreakthroughCharacters();
    document.getElementById("breakthrough-modal").hidden = false;
  }

  // 判定發生：地圖版から任意のタイミングで開ける汎用判定。攀登判定と同様、目標値は揭曉するまで
  // 非公開（GMが事前に入力し、骰子確定後に揭曉ボタンで開示する）で、全員が個別に骰子を振り
  // その合計で通過／不通過を判定する（perpcは常にON固定）。攀登判定と違い盤面の移動という
  // 前提が無いため目標値に計算式が使えず、開く際にGMへ直接プロンプトで入力させる。判定に
  // 使う数値（幸運／體能／精神）は固定せずGMが選べる。
  function openGenericCheckModal() {
    var input = window.prompt(window.I18N.t("generic_check_target_prompt"));
    if (input === null) return;
    var target = Number(input);
    if (!input.trim() || isNaN(target)) {
      window.alert(window.I18N.t("generic_check_target_invalid"));
      return;
    }
    breakthroughState = { slotIndex: null, mode: "generic", moveTarget: null, characters: {}, revealed: false };
    document.getElementById("breakthrough-modal-title").textContent = window.I18N.t("generic_check_modal_title");
    document.getElementById("breakthrough-import-row").hidden = true;
    document.getElementById("breakthrough-target-hideable").hidden = true;
    document.getElementById("breakthrough-target-input").value = String(target);
    document.getElementById("breakthrough-target-input").disabled = true;
    document.getElementById("breakthrough-perpc-checkbox").checked = true;
    document.getElementById("breakthrough-perpc-checkbox").disabled = true;
    document.getElementById("breakthrough-stat-select").value = "any";
    document.getElementById("breakthrough-stat-select").disabled = false;
    document.getElementById("breakthrough-error").hidden = true;
    renderBreakthroughCharacters();
    document.getElementById("breakthrough-modal").hidden = false;
  }

  // 規則書の通常セッション認証とは別に、揭曉のたびに必ずパスワードを再要求する
  // （既にセッション認証済みでも、目標値の閲覧は毎回明示的な確認を必要とするため）。
  // 攀登判定（mode:"climb"）はGMの秘密ではないため、このパスワード確認は樓層突破判定
  // （mode:"floor"）のときだけ行う。
  function checkBreakthroughRevealPassword() {
    var input = window.prompt(window.I18N.t("rulebook_password_prompt"));
    return input === RULEBOOK_PASSWORD;
  }

  function revealBreakthroughTarget() {
    if (!breakthroughState) return;
    if (breakthroughState.mode === "floor" && !checkBreakthroughRevealPassword()) {
      window.alert(window.I18N.t("rulebook_password_wrong"));
      return;
    }
    breakthroughState.revealed = true;
    // 判定發生は目標値をGMが開く前から直接入力済みで、目標點數／每PC加乘のチェック欄自体が
    // 意味を持たないため、揭曉してもこの最上段の行だけは表示しない（結果は下のsum-labelに出る）。
    if (breakthroughState.mode !== "generic") {
      document.getElementById("breakthrough-target-hideable").hidden = false;
    }
    document.getElementById("breakthrough-target-input").disabled = true;
    document.getElementById("breakthrough-perpc-checkbox").disabled = true;
    document.getElementById("breakthrough-stat-select").disabled = true;
    renderBreakthroughCharacters();
  }

  function closeBreakthroughModal() {
    document.getElementById("breakthrough-modal").hidden = true;
    document.getElementById("btn-breakthrough-reveal").hidden = false;
    document.getElementById("btn-breakthrough-fail").hidden = true;
    document.getElementById("btn-breakthrough-pass").hidden = true;
    document.getElementById("breakthrough-import-row").hidden = false;
    document.getElementById("breakthrough-target-hideable").hidden = false;
    breakthroughState = null;
  }

  var CHECK_STAT_KEYS = { luck: "luck", physical: "physical", mental: "mental" };

  function rollBreakthroughDice(charId, statKey) {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === charId;
    })[0];
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    if (!type || !statKey || !CHECK_STAT_KEYS[statKey]) return;
    var count = Math.max(0, type.checkValues[statKey] || 0);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    breakthroughState.characters[charId] = { stat: statKey, dice: dice, rerollPending: false };
    renderBreakthroughCharacters();
  }

  function useBreakthroughBlessing(charId) {
    var c = rosterCharacters.filter(function (rc) {
      return rc.id === charId;
    })[0];
    if (!c || !c.blessingSlots || c.blessingSlots.current <= 0) {
      var errEl = document.getElementById("breakthrough-error");
      errEl.hidden = false;
      errEl.textContent = window.I18N.t("breakthrough_error_no_blessing");
      return;
    }
    var entry = breakthroughState.characters[charId];
    if (!entry || !entry.dice.length) return;
    if (!window.confirm(window.I18N.t("breakthrough_blessing_confirm", { name: c.name }))) return;
    c.blessingSlots.current -= 1;
    saveRosterCharacters();
    entry.rerollPending = true;
    renderBreakthroughCharacters();
  }

  function rerollBreakthroughDie(charId, dieIndex) {
    var entry = breakthroughState.characters[charId];
    if (!entry || !entry.rerollPending) return;
    entry.dice[dieIndex] = 1 + Math.floor(Math.random() * 6);
    entry.rerollPending = false;
    renderBreakthroughCharacters();
  }

  function breakthroughDiceSum() {
    var total = 0;
    Object.keys(breakthroughState.characters).forEach(function (id) {
      breakthroughState.characters[id].dice.forEach(function (v) {
        total += v;
      });
    });
    return total;
  }

  function renderBreakthroughCharacters() {
    if (!breakthroughState) return;
    var container = document.getElementById("breakthrough-characters");
    container.innerHTML = "";
    var globalStat = document.getElementById("breakthrough-stat-select").value;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c) {
      var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
      var row = document.createElement("div");
      row.className = "wb-row breakthrough-char-row";

      var name = document.createElement("span");
      name.className = "breakthrough-char-name";
      name.textContent = c.name;
      row.appendChild(name);

      var statSelect = null;
      if (globalStat === "any") {
        statSelect = document.createElement("select");
        ["luck", "physical", "mental"].forEach(function (key) {
          var opt = document.createElement("option");
          opt.value = key;
          opt.textContent = window.I18N.t("check_stat_" + key);
          statSelect.appendChild(opt);
        });
        var existing = breakthroughState.characters[c.id];
        statSelect.value = (existing && existing.stat) || "luck";
        row.appendChild(statSelect);
      }

      var rollBtn = document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "combat-attack-hit-btn";
      // 「任意」・固定属性のどちらでも、現在選ばれている判定属性で実際に振る骰子の数を
      // ボタン自体に即時表示する（例：擲骰（3顆））。「任意」時は個別選択を変えるたび更新する。
      function updateRollBtnLabel() {
        var statKey = globalStat === "any" ? statSelect.value : globalStat;
        var count = type && CHECK_STAT_KEYS[statKey] ? Math.max(0, type.checkValues[statKey] || 0) : 0;
        rollBtn.textContent = window.I18N.t("breakthrough_roll_button_with_count", { count: count });
      }
      updateRollBtnLabel();
      if (statSelect) statSelect.addEventListener("change", updateRollBtnLabel);
      rollBtn.addEventListener("click", function () {
        var statKey = globalStat === "any" ? statSelect.value : globalStat;
        rollBreakthroughDice(c.id, statKey);
      });
      row.appendChild(rollBtn);

      var diceWrap = document.createElement("span");
      diceWrap.className = "breakthrough-dice-wrap";
      var entry = breakthroughState.characters[c.id];
      if (entry) {
        var statLabel = document.createElement("span");
        statLabel.className = "ability-uses-label";
        statLabel.textContent = window.I18N.t("breakthrough_dice_count_label", {
          stat: window.I18N.t("check_stat_" + entry.stat),
          count: (type && type.checkValues[entry.stat]) || 0,
        });
        diceWrap.appendChild(statLabel);
        entry.dice.forEach(function (v, i) {
          var dieBtn = document.createElement("button");
          dieBtn.type = "button";
          dieBtn.className = "dice-item";
          if (entry.rerollPending) dieBtn.classList.add("active");
          dieBtn.textContent = String(v);
          dieBtn.disabled = !entry.rerollPending;
          dieBtn.addEventListener("click", function () {
            rerollBreakthroughDie(c.id, i);
          });
          diceWrap.appendChild(dieBtn);
        });
        // 各角色ごとの小計も自分の行内に表示する（全体合計は上のsum-labelに別途出る）。
        var subtotal = entry.dice.reduce(function (a, b) {
          return a + b;
        }, 0);
        var subtotalLabel = document.createElement("span");
        subtotalLabel.className = "ability-uses-label";
        subtotalLabel.textContent = window.I18N.t("breakthrough_char_subtotal_label", { sum: subtotal });
        diceWrap.appendChild(subtotalLabel);
      }
      row.appendChild(diceWrap);

      // 判定發生は、目標を揭曉する前までは加護重骰を使用可能。揭曉後は使用不可のため
      // ボタンごと表示しない（樓層突破判定・攀登判定は従来通り常に表示する）。
      var hideBlessingBtn = breakthroughState.mode === "generic" && breakthroughState.revealed;
      if (!hideBlessingBtn) {
        var blessingBtn = document.createElement("button");
        blessingBtn.type = "button";
        blessingBtn.className = "breakthrough-blessing-btn";
        blessingBtn.textContent = window.I18N.t("breakthrough_blessing_button", {
          current: c.blessingSlots ? c.blessingSlots.current : 0,
        });
        blessingBtn.disabled = !entry || !entry.dice.length || !c.blessingSlots || c.blessingSlots.current <= 0;
        blessingBtn.addEventListener("click", function () {
          useBreakthroughBlessing(c.id);
        });
        row.appendChild(blessingBtn);
      }

      container.appendChild(row);
    });

    var target = Number(document.getElementById("breakthrough-target-input").value) || 0;
    var perPC = document.getElementById("breakthrough-perpc-checkbox").checked;
    var actualTarget = perPC ? target * entered.length : target;
    var sumLabel = document.getElementById("breakthrough-sum-label");
    sumLabel.textContent = breakthroughState.revealed
      ? window.I18N.t("breakthrough_sum_label", { sum: breakthroughDiceSum(), target: actualTarget })
      : window.I18N.t("breakthrough_sum_label_hidden", { sum: breakthroughDiceSum() });

    document.getElementById("btn-breakthrough-reveal").hidden = breakthroughState.revealed;
    document.getElementById("btn-breakthrough-fail").hidden = !breakthroughState.revealed;
    document.getElementById("btn-breakthrough-pass").hidden = !breakthroughState.revealed;
  }

  function computeBreakthroughActualTarget() {
    var target = Number(document.getElementById("breakthrough-target-input").value) || 0;
    var perPC = document.getElementById("breakthrough-perpc-checkbox").checked;
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    return perPC ? target * entered.length : target;
  }

  function resolveBreakthroughCheck(passed) {
    if (!breakthroughState) return;
    var sum = breakthroughDiceSum();
    var actualTarget = computeBreakthroughActualTarget();
    if (breakthroughState.mode === "climb") {
      var moveTarget = breakthroughState.moveTarget;
      closeBreakthroughModal();
      if (passed) finalizeSlotMove(moveTarget);
      if (typeof moveTarget === "number") {
        addLog(passed ? "log_climb_check_pass" : "log_climb_check_fail", { slot: moveTarget + 1, sum: sum, target: actualTarget });
      } else {
        addLog(passed ? "log_climb_check_pass_pile" : "log_climb_check_fail_pile", {
          place: window.I18N.t(moveTarget === "start" ? "start_point_label" : "end_point_label"),
          sum: sum,
          target: actualTarget,
        });
      }
      return;
    }
    if (breakthroughState.mode === "generic") {
      closeBreakthroughModal();
      addLog(passed ? "log_generic_check_pass" : "log_generic_check_fail", { sum: sum, target: actualTarget });
      return;
    }
    var index = breakthroughState.slotIndex;
    if (passed) stepCardLevel(index, 1);
    addLog(passed ? "log_breakthrough_check_pass" : "log_breakthrough_check_fail", {
      slot: index + 1,
      sum: sum,
      target: actualTarget,
    });
    closeBreakthroughModal();
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
    state.eventChips = rollEventChips();

    var logKey = wasContinue ? "log_continue_submit" : "log_select_submit";
    if (!wasContinue) state.focusedIndex = BOARD_LEFT_SLOT;
    state.boardStarted = true;
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
    state.eventChips = rollEventChips();
    state.focusedIndex = BOARD_LEFT_SLOT;
    state.boardStarted = true;
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
    state.eventChips = rollEventChips();

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

  // 長押し（1秒）＝既存の「めくる（未公開→公開）」「山札に戻す（公開→除去）」操作。
  function onSlotClick(index) {
    var slot = state.slots[index];
    if (!slot) return;

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
  // grid-column配置と対応）。
  function pileAdjacentSlotIndex(which) {
    if (which === "start") return isSwappedDay() ? 5 : 3;
    return isSwappedDay() ? 3 : 5;
  }

  // fromPos／toPosは板塊index(0-8)、または"start"/"end"のいずれか。
  function isAdjacentPosition(fromPos, toPos) {
    if (typeof fromPos === "number" && typeof toPos === "number") {
      var fromRow = Math.floor(fromPos / 3),
        fromCol = fromPos % 3;
      var toRow = Math.floor(toPos / 3),
        toCol = toPos % 3;
      return Math.max(Math.abs(fromRow - toRow), Math.abs(fromCol - toCol)) === 1;
    }
    if (typeof fromPos === "number") return fromPos === pileAdjacentSlotIndex(toPos);
    if (typeof toPos === "number") return toPos === pileAdjacentSlotIndex(fromPos);
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

  function attemptMoveToPosition(fromPos, toPos) {
    if (!isAdjacentPosition(fromPos, toPos)) {
      window.alert(window.I18N.t("move_not_adjacent_msg"));
      return;
    }
    var fromElev = elevationOfPosition(fromPos);
    var toElev = elevationOfPosition(toPos);
    if (fromElev != null && toElev != null && toElev > fromElev) {
      openClimbingCheckModal(toPos, toElev - fromElev);
    } else {
      finalizeSlotMove(toPos);
    }
  }

  function finalizeSlotMove(toPos) {
    state.focusedIndex = toPos;
    renderBoard();
    saveState();
    if (typeof toPos === "number") {
      addLog("log_slot_move", { slot: toPos + 1 });
    } else {
      addLog("log_slot_move_to_pile", { place: window.I18N.t(toPos === "start" ? "start_point_label" : "end_point_label") });
    }
  }

  function checkNewGamePassword() {
    var input = window.prompt(window.I18N.t("new_game_password_prompt"));
    return input === NEW_GAME_PASSWORD;
  }

  function handleNewGame() {
    if (!checkNewGamePassword()) return;
    var hadBoard = state.boardStarted;
    resetState();
    renderBoard();
    renderLog();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    if (hadBoard) addLog("log_new_game");
  }

  function buildBoardSlots() {
    var grid = document.getElementById("board-grid");
    for (var i = 0; i < SLOT_COUNT; i++) {
      (function (index) {
        var wrap = document.createElement("div");
        wrap.className = "slot-wrap slot-wrap-" + index;

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
              openBreakthroughModal(index);
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
    renderBattlePositionAreas();
    renderEnemyHpGrid();
    renderMobHpList();
    renderSelectedEnemies();
    renderBattleRefTexts();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderBoard();
    renderLog();
    renderLogToggleLabel();
    renderRosterSkillsToggleLabel();
    renderBossRulebook();
    renderWeaponRulebookAll();
    renderTalismanAcquisitionTable();
    renderTalismanRulebook();
    renderConsumableDetermineTable();
    renderConsumableRulebook();
    renderEnemyRulebookAll();
    renderFieldRulebook();
    renderEventRulebook();
    renderWorldviewRulebook();

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
    document.getElementById("btn-roster-skills-toggle").addEventListener("click", function () {
      document.getElementById("character-roster-skills").classList.toggle("collapsed");
      renderRosterSkillsToggleLabel();
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
    document.getElementById("btn-time-loss-info").addEventListener("click", openThreatDrawer);
    document.getElementById("btn-threat-drawer-close").addEventListener("click", closeThreatDrawer);
    document.getElementById("threat-drawer-backdrop").addEventListener("click", closeThreatDrawer);
    document.getElementById("btn-battle-info").addEventListener("click", openBattleDrawer);
    document.getElementById("btn-battle-drawer-close").addEventListener("click", closeBattleDrawer);
    document.getElementById("btn-bag-drawer-open").addEventListener("click", openBagDrawer);
    document.getElementById("btn-bag-drawer-close").addEventListener("click", closeBagDrawer);
    document.getElementById("btn-attribute-status-info").addEventListener("click", openAttributeStatusDrawer);
    document.getElementById("btn-attribute-status-drawer-close").addEventListener("click", closeAttributeStatusDrawer);
    document.getElementById("attribute-status-drawer-backdrop").addEventListener("click", closeAttributeStatusDrawer);
    document.getElementById("btn-merchant-modal-close").addEventListener("click", closeMerchantModal);
    document.getElementById("btn-potential-power-info").addEventListener("click", openPotentialPowerModal);
    document.getElementById("btn-potential-power-modal-close").addEventListener("click", closePotentialPowerModal);
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
    document.getElementById("btn-turn-board-toggle").addEventListener("click", function () {
      setTurnBoardEnabled(!state.turnBoardEnabled);
    });
    document.getElementById("btn-main-menu-draw-close").addEventListener("click", closeMainMenuDrawModal);
    document.getElementById("btn-item-draw-modal-close").addEventListener("click", closeItemDrawModal);
    document.getElementById("btn-weapon-skill-reroll-modal-close").addEventListener("click", closeWeaponSkillRerollModal);
    document.getElementById("btn-potential-power-minimize").addEventListener("click", minimizePotentialPowerModal);
    document.getElementById("btn-potential-power-restore").addEventListener("click", restorePotentialPowerModal);
    document.getElementById("btn-floor-reward-modal-close").addEventListener("click", closeFloorRewardModal);
    document.getElementById("btn-floor-reward-minimize").addEventListener("click", minimizeFloorRewardModal);
    document.getElementById("btn-floor-reward-restore").addEventListener("click", restoreFloorRewardModal);
    document.querySelectorAll(".combat-action-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        combatModalAction = btn.dataset.action;
        combatDiceSelection = [];
        renderCombatModal();
      });
    });
    document.getElementById("btn-combat-modal-close").addEventListener("click", closeCombatModal);
    document.getElementById("btn-combat-modal-minimize").addEventListener("click", handleCombatModalMinimizeToggle);
    document.getElementById("btn-breakthrough-cancel").addEventListener("click", closeBreakthroughModal);
    document.getElementById("btn-breakthrough-reveal").addEventListener("click", revealBreakthroughTarget);
    document.getElementById("btn-breakthrough-pass").addEventListener("click", function () {
      resolveBreakthroughCheck(true);
    });
    document.getElementById("btn-breakthrough-fail").addEventListener("click", function () {
      resolveBreakthroughCheck(false);
    });
    document.getElementById("breakthrough-target-input").addEventListener("input", renderBreakthroughCharacters);
    document.getElementById("breakthrough-perpc-checkbox").addEventListener("change", renderBreakthroughCharacters);
    document.getElementById("breakthrough-stat-select").addEventListener("change", renderBreakthroughCharacters);
    document.getElementById("battle-drawer-backdrop").addEventListener("click", closeBattleDrawer);
    document.getElementById("bag-drawer-backdrop").addEventListener("click", closeBagDrawer);
    document.getElementById("battle-enemy-search-input").addEventListener("input", renderBattleEnemySearchResults);
    document.getElementById("btn-battle-add-mob-row").addEventListener("click", handleAddMobRow);
    document.getElementById("btn-battle-clear").addEventListener("click", handleBattleClear);
    document.getElementById("btn-dice-pool-add").addEventListener("click", handleAddDice);
    // 靈體管理／屬性痕管理を開くボタンは、キャラ個人の骰子池横（renderCharacterRoster内）に
    // キャラごとに動的生成されるため、ここではモーダルの閉じるボタンのみ配線する。
    document.getElementById("btn-spirit-panel-close").addEventListener("click", closeSpiritPanel);
    document.getElementById("btn-element-mark-panel-close").addEventListener("click", closeElementMarkPanel);
    document.getElementById("btn-action-phase").addEventListener("click", openActionPhaseModal);
    document.getElementById("btn-turn-holder-toggle").addEventListener("click", handleTurnHolderToggle);
    document.getElementById("btn-turn-message-send").addEventListener("click", handleTurnMessageSend);
    document.getElementById("btn-turn-reward-open").addEventListener("click", openTurnRewardModal);
    document.getElementById("btn-turn-reward-modal-close").addEventListener("click", closeTurnRewardModal);
    document.getElementById("btn-turn-reward-modal-minimize").addEventListener("click", handleTurnRewardModalMinimizeToggle);
    document.getElementById("btn-turn-reward-add").addEventListener("click", handleTurnRewardAdd);
    document.getElementById("btn-action-phase-cancel").addEventListener("click", closeActionPhaseModal);
    document.getElementById("btn-generic-check").addEventListener("click", openGenericCheckModal);
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
    document.querySelectorAll(".action-phase-grid button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setActionPhase(btn.dataset.phase);
      });
    });
    document.getElementById("input-smithing-stone").addEventListener("input", function (e) {
      state.smithingStone = e.target.value;
      saveState();
    });
    document.getElementById("input-stonesword-key").addEventListener("input", function (e) {
      state.stoneswordKey = e.target.value;
      saveState();
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
      renderBossRulebook();
      renderWeaponRulebookAll();
      renderTalismanAcquisitionTable();
      renderTalismanRulebook();
      renderConsumableDetermineTable();
      renderConsumableRulebook();
      renderEnemyRulebookAll();
      renderFieldRulebook();
      renderEventRulebook();
      renderWorldviewRulebook();
      renderSelectedEnemies();
    });
  });
})();
