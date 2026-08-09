(function () {
  // Split out of night.js to keep file sizes manageable. Event-chip draw/trigger modal (merchant/blessing/spirit-vein/strong-enemy/random).
  // Depends on window.PriTestNightCore (state/roster/shared render helpers exported by night.js)
  // and, in a few spots, on other night_*.js sibling modules -- see night.js for the full module map.

  var CharacterDrawer = window.PriTestCharacterDrawer;

  // ============================================================
  // 籌碼事件：GM限定。現在フォーカス中のマス（window.PriTestNightCore.state.focusedIndex）にある未発動のイベント
  // チットを、実際に操作できるウィンドウとして開く（縮小→右下固定ボタンパターン）。
  // 種類ごとに内容が異なり、「何らかの行動を使用した」時点でそのマスのチットを
  // 使用済み（地図上は取り消し線表示、再度「籌碼事件」を押しても発動しない）にする。
  // 唯一の例外は強敵チット：撃破／除去まで地図上に残り続ける仕様のため、決定内容の
  // 記録だけでは使用済みにしない。
  // ============================================================
  var eventChipModalIndex = null;
  var eventChipMerchantCharId = null;
  var eventChipMerchantLastWeaponResult = null;
  var eventChipBlessingUsedIds = {}; // このモーダルを開いている間だけ、誰が既に使ったかを覚えておく

  function currentFocusedChipIndex() {
    return typeof window.PriTestNightCore.state.focusedIndex === "number" ? window.PriTestNightCore.state.focusedIndex : null;
  }

  function handleEventChipTrigger() {
    var idx = currentFocusedChipIndex();
    if (idx === null) {
      window.alert(window.I18N.t("event_chip_no_position_note"));
      return;
    }
    var chipId = window.PriTestNightCore.state.eventChips[idx];
    if (!chipId) {
      window.alert(window.I18N.t("event_chip_none_note"));
      return;
    }
    if (window.PriTestNightCore.state.eventChipsUsed[idx]) {
      window.alert(window.I18N.t("event_chip_already_used_note"));
      return;
    }
    openEventChipModal(idx);
  }

  function openEventChipModal(idx) {
    eventChipModalIndex = idx;
    eventChipMerchantLastWeaponResult = null;
    eventChipBlessingUsedIds = {};
    document.getElementById("event-chip-modal").hidden = false;
    document.getElementById("btn-event-chip-restore").hidden = true;
    renderEventChipModal();
  }

  function closeEventChipModal() {
    document.getElementById("event-chip-modal").hidden = true;
    document.getElementById("btn-event-chip-restore").hidden = true;
    eventChipModalIndex = null;
  }

  function minimizeEventChipModal() {
    document.getElementById("event-chip-modal").hidden = true;
    document.getElementById("btn-event-chip-restore").hidden = false;
  }

  function restoreEventChipModal() {
    document.getElementById("btn-event-chip-restore").hidden = true;
    document.getElementById("event-chip-modal").hidden = false;
    renderEventChipModal();
  }

  function markEventChipUsed(idx) {
    if (window.PriTestNightCore.state.eventChipsUsed[idx]) return;
    window.PriTestNightCore.state.eventChipsUsed[idx] = true;
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderSlotEffect(idx);
  }

  function renderEventChipModal() {
    var idx = eventChipModalIndex;
    var content = document.getElementById("event-chip-modal-content");
    var titleEl = document.getElementById("event-chip-modal-title");
    if (idx === null || !content || !titleEl) return;
    var chipId = window.PriTestNightCore.state.eventChips[idx];
    content.innerHTML = "";
    titleEl.textContent = window.I18N.t("event_chip_" + chipId);
    if (chipId === "merchant") renderEventChipMerchant(idx, content);
    else if (chipId === "blessing") renderEventChipBlessing(idx, content);
    else if (chipId === "spirit_vein") renderEventChipSpiritVein(idx, content);
    else if (chipId === "strong_enemy") renderEventChipStrongEnemy(idx, content);
    else if (chipId === "random") renderEventChipRandom(idx, content);
  }

  // --- 商人（既存の商人モーダルと同じ購買武器／購買消耗品に加え、鍛造台を追加） ---
  function renderEventChipMerchant(idx, content) {
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("event_chip_no_characters_note");
      content.appendChild(empty);
      return;
    }
    if (
      !entered.some(function (c) {
        return c.id === eventChipMerchantCharId;
      })
    ) {
      eventChipMerchantCharId = entered[0].id;
    }
    var select = document.createElement("select");
    entered.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === eventChipMerchantCharId) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener("change", function () {
      eventChipMerchantCharId = select.value;
      eventChipMerchantLastWeaponResult = null;
      renderEventChipModal();
    });
    content.appendChild(select);

    var c = entered.filter(function (rc) {
      return rc.id === eventChipMerchantCharId;
    })[0];
    var runeLabel = document.createElement("p");
    runeLabel.className = "threat-ref-body";
    runeLabel.textContent = window.I18N.t("merchant_rune_label", { value: c.runes || 0 });
    content.appendChild(runeLabel);
    var canAfford = (c.runes || 0) >= 1;
    var Weapons = window.PriTestWeapons;
    var Consumables = window.PriTestConsumables;

    var weaponTitle = document.createElement("h5");
    weaponTitle.textContent = window.I18N.t("merchant_weapon_purchase_title");
    content.appendChild(weaponTitle);
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
      window.PriTestNightCore.saveRosterCharacters();
      window.PriTestNightCore.renderCharacterRoster();
      window.PriTestNightLog("log_merchant_weapon_purchase", { character: c.name, weapon: Weapons.localizedText(result.item.name) });
      eventChipMerchantLastWeaponResult = result;
      markEventChipUsed(idx);
      renderEventChipModal();
      CharacterDrawer.resolveInventoryOverflow(c, "weapon", function () {
        window.PriTestNightCore.renderCharacterRoster();
        renderEventChipModal();
      });
    });
    content.appendChild(weaponBtn);
    if (eventChipMerchantLastWeaponResult) {
      var resultP = document.createElement("p");
      resultP.className = "threat-ref-body weapon-roll-result";
      resultP.textContent = window.I18N.t("merchant_weapon_result", {
        weapon: Weapons.localizedText(eventChipMerchantLastWeaponResult.item.name),
        rarity: eventChipMerchantLastWeaponResult.rarity,
      });
      content.appendChild(resultP);
    }

    var consumableTitle = document.createElement("h5");
    consumableTitle.textContent = window.I18N.t("merchant_consumable_purchase_title");
    content.appendChild(consumableTitle);
    var consumableRow = document.createElement("div");
    consumableRow.className = "wb-row";
    window.PriTestNightCore.MERCHANT_CONSUMABLE_IDS.forEach(function (id) {
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
        c.consumables.push({ id: newInstanceId, itemId: id, usesRemaining: item.uses || 1 });
        window.PriTestNightCore.saveRosterCharacters();
        window.PriTestNightCore.renderCharacterRoster();
        window.PriTestNightLog("log_merchant_consumable_purchase", {
          character: c.name,
          item: Consumables.localizedText ? Consumables.localizedText(item.name) : item.name.zh,
        });
        markEventChipUsed(idx);
        window.PriTestCharacterDrawer.resolveInventoryOverflow(c, "consumable", function () {
          window.PriTestNightCore.renderCharacterRoster();
          renderEventChipModal();
        });
        renderEventChipModal();
      });
      consumableRow.appendChild(btn);
    });
    content.appendChild(consumableRow);

    // 鍛造台（新規）：鍛石1でC→U、鍛石2でU→R。武器の個体（インスタンス）ごとの強化として
    // CharacterDrawer.weaponRarityOverrideに保存し、武器カタログ自体は書き換えない。
    var smithingTitle = document.createElement("h5");
    smithingTitle.textContent = window.I18N.t("merchant_smithing_table_title");
    content.appendChild(smithingTitle);
    var smithingNote = document.createElement("p");
    smithingNote.className = "threat-ref-body";
    smithingNote.textContent = window.I18N.t("merchant_smithing_table_note", { count: window.PriTestNightCore.state.smithingStoneCount || 0 });
    content.appendChild(smithingNote);
    var weaponIds = c.weaponIds || [];
    var anyUpgradeable = false;
    weaponIds.forEach(function (weaponId) {
      var rarity = CharacterDrawer.getEffectiveWeaponRarity(c, weaponId);
      var next = rarity === "C" ? "U" : rarity === "U" ? "R" : null;
      if (!next) return;
      anyUpgradeable = true;
      var cost = rarity === "C" ? 1 : 2;
      var baseId = weaponId.indexOf("::") !== -1 ? weaponId.slice(0, weaponId.indexOf("::")) : weaponId;
      var weapon = Weapons.get(baseId);
      if (!weapon) return;
      var row = document.createElement("div");
      row.className = "wb-row";
      var label = document.createElement("span");
      label.textContent = Weapons.localizedText(weapon.name) + "（" + rarity + " → " + next + "）";
      row.appendChild(label);
      var upgradeBtn = document.createElement("button");
      upgradeBtn.type = "button";
      upgradeBtn.textContent = window.I18N.t("merchant_smithing_upgrade_button", { cost: cost });
      upgradeBtn.disabled = (window.PriTestNightCore.state.smithingStoneCount || 0) < cost;
      upgradeBtn.addEventListener("click", function () {
        if ((window.PriTestNightCore.state.smithingStoneCount || 0) < cost) return;
        window.PriTestNightCore.state.smithingStoneCount -= cost;
        CharacterDrawer.upgradeWeaponRarity(c, weaponId);
        window.PriTestNightCore.saveRosterCharacters();
        window.PriTestNightCore.saveState();
        window.PriTestNightCore.renderSmithingStoneCount();
        window.PriTestNightCore.renderCharacterRoster();
        window.PriTestNightLog("log_merchant_smithing_upgrade", {
          character: c.name,
          weapon: Weapons.localizedText(weapon.name),
          from: rarity,
          to: next,
        });
        markEventChipUsed(idx);
        renderEventChipModal();
      });
      row.appendChild(upgradeBtn);
      content.appendChild(row);
    });
    if (!anyUpgradeable) {
      var noUpgrade = document.createElement("p");
      noUpgrade.className = "threat-ref-body";
      noUpgrade.textContent = window.I18N.t("merchant_smithing_no_weapon_note");
      content.appendChild(noUpgrade);
    }
  }

  // --- 祝福：入場中の各角色が個別に「使用」ボタンを押せる。HP/FP/加護/聖杯瓶/技能使用次數/
  // 死靈のHPを、それぞれの上限まで一括回復する。 ---
  function applyEventChipBlessingRest(c) {
    c.hp.current = c.hp.max;
    c.fp.current = c.fp.max;
    if (c.blessingSlots) c.blessingSlots.current = c.blessingSlots.max;
    if (c.flaskBase) c.flaskBase.current = c.flaskBase.max;
    if (c.flaskExtra) c.flaskExtra.current = c.flaskExtra.max;
    c.abilityUses = {};
    (c.deathSpirits || []).forEach(function (spirit) {
      spirit.hpCurrent = spirit.hpMax;
    });
    if (c.spiritSummon && c.spiritSummonHp && c.spiritSummonHp[c.spiritSummon]) {
      c.spiritSummonHp[c.spiritSummon].current = c.spiritSummonHp[c.spiritSummon].max;
    }
    window.PriTestNightCore.saveRosterCharacters();
    window.PriTestNightCore.renderCharacterRoster();
    window.PriTestNightLog("log_event_chip_blessing_use", { character: c.name });
  }

  function renderEventChipBlessing(idx, content) {
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) {
      var empty = document.createElement("p");
      empty.className = "threat-ref-body";
      empty.textContent = window.I18N.t("event_chip_no_characters_note");
      content.appendChild(empty);
      return;
    }
    var note = document.createElement("p");
    note.className = "threat-ref-body";
    note.textContent = window.I18N.t("event_chip_blessing_note");
    content.appendChild(note);
    entered.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "wb-row";
      var label = document.createElement("span");
      label.textContent = c.name;
      row.appendChild(label);
      var used = !!eventChipBlessingUsedIds[c.id];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.textContent = window.I18N.t("event_chip_blessing_use_button");
      btn.disabled = used;
      btn.addEventListener("click", function () {
        applyEventChipBlessingRest(c);
        eventChipBlessingUsedIds[c.id] = true;
        markEventChipUsed(idx);
        renderEventChipModal();
      });
      row.appendChild(btn);
      content.appendChild(row);
    });
  }

  // --- 靈脈：任意の1マスへ現在のフォーカス位置（黄枠）を無条件で移動する（登攀判定不要）。 ---
  function renderEventChipSpiritVein(idx, content) {
    var note = document.createElement("p");
    note.className = "threat-ref-body";
    note.textContent = window.I18N.t("event_chip_spirit_vein_note");
    content.appendChild(note);
    var grid = document.createElement("div");
    grid.className = "wb-row";
    for (var i = 0; i < window.PriTestNightCore.SLOT_COUNT; i++) {
      if (i === idx) continue;
      (function (target) {
        var slot = window.PriTestNightCore.state.slots[target];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent =
          slot && slot.revealed ? window.PriTestNightCore.CARD_BY_CODE[slot.code].label : window.I18N.t("event_chip_spirit_vein_slot_hidden", { n: target + 1 });
        btn.addEventListener("click", function () {
          window.PriTestNightCore.state.focusedIndex = target;
          window.PriTestNightCore.saveState();
          window.PriTestNightCore.renderBoard();
          window.PriTestNightLog("log_event_chip_spirit_vein_move", { position: btn.textContent });
          markEventChipUsed(idx);
          closeEventChipModal();
        });
        grid.appendChild(btn);
      })(i);
    }
    content.appendChild(grid);
  }

  // --- 強敵：既存の強敵決定表（event_rulebook.js）を参照表示し、GMが実際に振った出目に
  // 応じたエネミー名をその場で記録する。撃破／除去まで地図上に残る仕様のため、
  // 記録だけでは籌碼を使用済みにしない（強敵決定表閲覧・記録自体は「行動」とみなさない）。 ---
  function renderEventChipStrongEnemy(idx, content) {
    var recorded = window.PriTestNightCore.state.eventChipsData[idx];
    if (recorded && recorded.enemyName) {
      var recordedP = document.createElement("p");
      recordedP.className = "threat-ref-body";
      recordedP.textContent = window.I18N.t("event_chip_strong_enemy_recorded_note", { enemy: recorded.enemyName });
      content.appendChild(recordedP);
    }
    var note = document.createElement("p");
    note.className = "threat-ref-body";
    note.textContent = window.I18N.t("event_chip_strong_enemy_note");
    content.appendChild(note);
    var Events = window.PriTestEventRulebook;
    var card = Events ? Events.list().filter(function (ec) {
      return ec.id === "strong_enemy";
    })[0] : null;
    (card ? card.extraTables || [] : []).forEach(function (tbl) {
      var tblBlock = document.createElement("div");
      tblBlock.className = "threat-ref-block";
      var tblH = document.createElement("h5");
      tblH.textContent = Events.localizedText(tbl.title);
      tblBlock.appendChild(tblH);
      var tblWrap = document.createElement("div");
      tblWrap.className = "field-variance-wrap";
      tblWrap.appendChild(window.PriTestNightCore.buildBossTable(tbl.columns, tbl.rows, Events.localizedText));
      tblBlock.appendChild(tblWrap);
      content.appendChild(tblBlock);
    });
    var inputRow = document.createElement("div");
    inputRow.className = "wb-row";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = window.I18N.t("event_chip_strong_enemy_input_placeholder");
    if (recorded) input.value = recorded.enemyName;
    inputRow.appendChild(input);
    var recordBtn = document.createElement("button");
    recordBtn.type = "button";
    recordBtn.className = "primary-btn";
    recordBtn.textContent = window.I18N.t("event_chip_strong_enemy_record_button");
    recordBtn.addEventListener("click", function () {
      if (!input.value.trim()) return;
      window.PriTestNightCore.state.eventChipsData[idx] = { enemyName: input.value.trim() };
      window.PriTestNightCore.saveState();
      window.PriTestNightLog("log_event_chip_strong_enemy_record", { enemy: input.value.trim() });
      renderEventChipModal();
    });
    inputRow.appendChild(recordBtn);
    content.appendChild(inputRow);
  }

  // --- 隨機事件：ランダムイベント決定表に載る全事件をGMが選択できるようにし、選んだ事件の
  // 本文（event_rulebook.js）をそのまま表示する。実際の処理は玩家の反応を見ながらGMが
  // 手動で進行する（自動化しない）。 ---
  function renderEventChipRandom(idx, content) {
    var Events = window.PriTestEventRulebook;
    var card = Events ? Events.list().filter(function (ec) {
      return ec.id === "random_event";
    })[0] : null;
    var branches = card ? (card.branches || []).slice(1) : []; // 先頭は導入文のみのため除く
    var select = document.createElement("select");
    branches.forEach(function (b, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = Events.localizedText(b.name);
      select.appendChild(o);
    });
    content.appendChild(select);
    var detailDiv = document.createElement("div");
    content.appendChild(detailDiv);
    function renderDetail() {
      detailDiv.innerHTML = "";
      var b = branches[parseInt(select.value, 10)];
      if (!b) return;
      (b.floors || []).forEach(function (floor) {
        (floor.lines || []).forEach(function (line) {
          window.PriTestNightRulebook.renderFieldLine(detailDiv, line, Events.localizedText);
        });
      });
    }
    select.addEventListener("change", renderDetail);
    renderDetail();
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary-btn";
    confirmBtn.textContent = window.I18N.t("event_chip_random_confirm_button");
    confirmBtn.addEventListener("click", function () {
      var b = branches[parseInt(select.value, 10)];
      if (b) window.PriTestNightLog("log_event_chip_random_pick", { event: Events.localizedText(b.name) });
      markEventChipUsed(idx);
      closeEventChipModal();
    });
    content.appendChild(confirmBtn);
  }

  window.PriTestNightEventChips = {
    handleEventChipTrigger: handleEventChipTrigger,
    closeEventChipModal: closeEventChipModal,
    minimizeEventChipModal: minimizeEventChipModal,
    restoreEventChipModal: restoreEventChipModal,
    applyEventChipBlessingRest: applyEventChipBlessingRest,
  };
})();
