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

  // 商人：購買ボタンを押した瞬間、そのボタンだけ1秒間だけ強調色にし、上部に「已購買」の
  // 簡短提醒文字を出す（ユーザー確認済み仕様）。eventChipMerchantJustPurchasedKeyがどの
  // ボタンを光らせるかの識別子（"weapon"／消耗品id／鍛造のweaponId）、Textが提醒文字。
  // 1秒後にsetTimeoutで両方nullへ戻し再描画する（既存のthreatBroadcastIntervalと同じ
  // 「一定時間だけ表示→自動で消す」パターン）。
  var eventChipMerchantJustPurchasedKey = null;
  var eventChipMerchantJustPurchasedText = null;
  var eventChipMerchantJustPurchasedTimer = null;

  function flashMerchantPurchase(key, text) {
    eventChipMerchantJustPurchasedKey = key;
    eventChipMerchantJustPurchasedText = text;
    if (eventChipMerchantJustPurchasedTimer) clearTimeout(eventChipMerchantJustPurchasedTimer);
    eventChipMerchantJustPurchasedTimer = setTimeout(function () {
      eventChipMerchantJustPurchasedKey = null;
      eventChipMerchantJustPurchasedText = null;
      eventChipMerchantJustPurchasedTimer = null;
      renderEventChipModal();
    }, 1000);
  }

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

  // 使用者確認：籌碼事件視窗も獎勵清單／潛在之力と同じ「大視窗は開いた本人の端末のみ、
  // 縮小状態だけ全端末で同期」パターンに揃える。state.eventChips/state.eventChipsDataは
  // 既に跨裝置同步済みなので、idxさえ分かればどの端末でも同じ内容を再現できる——
  // したがって縮小からの「還元」はどの端末で押しても正しく機能する（他の3つ＝骰子役判定／
  // 突破・攀登判定とは異なり、内容を丸ごと同期する必要が無い簡単なケース）。
  function openEventChipModal(idx) {
    eventChipModalIndex = idx;
    eventChipMerchantLastWeaponResult = null;
    eventChipBlessingUsedIds = {};
    window.PriTestDrawStateSync.set("eventChip", { idx: idx, minimized: false });
    document.getElementById("event-chip-modal").hidden = false;
    document.getElementById("btn-event-chip-restore").hidden = true;
    renderEventChipModal();
  }

  function closeEventChipModal() {
    document.getElementById("event-chip-modal").hidden = true;
    document.getElementById("btn-event-chip-restore").hidden = true;
    eventChipModalIndex = null;
    window.PriTestDrawStateSync.set("eventChip", null);
    // 霊脈チットを「使用」した後、結局どこへも移動せずにこのモーダルを閉じた場合、
    // 保留していたGM敘述の継続処理をここで再開する（moveTo側で先に消費済みなら
    // 何も起きない）。
    if (window.PriTestNightGmFlow && window.PriTestNightGmFlow.declinePendingSpiritVeinContinuation) {
      window.PriTestNightGmFlow.declinePendingSpiritVeinContinuation();
    }
  }

  function minimizeEventChipModal() {
    document.getElementById("event-chip-modal").hidden = true;
    document.getElementById("btn-event-chip-restore").hidden = false;
    var current = window.PriTestDrawStateSync.get("eventChip");
    window.PriTestDrawStateSync.set("eventChip", { idx: current ? current.idx : eventChipModalIndex, minimized: true });
  }

  function restoreEventChipModal() {
    document.getElementById("btn-event-chip-restore").hidden = true;
    document.getElementById("event-chip-modal").hidden = false;
    // 他端末の縮小ボタンから復元した場合、この端末ではeventChipModalIndexがまだnullの
    // ままなので、同期済みのidxから補う（state.eventChips/eventChipsDataは既に跨裝置
    // 同步済みのため、idxさえ分かればどの端末でも正しい内容を再現できる）。
    if (eventChipModalIndex === null) {
      var remote = window.PriTestDrawStateSync.get("eventChip");
      if (remote && typeof remote.idx === "number") eventChipModalIndex = remote.idx;
    }
    window.PriTestDrawStateSync.set("eventChip", { idx: eventChipModalIndex, minimized: false });
    renderEventChipModal();
  }

  // 使用者確認（2026-09-01）：籌碼事件視窗改為全端強制開啟後，其他裝置需要在渲染前先把
  // 這個模組的本機eventChipModalIndex對齊到遠端的idx，才能正確render——跟restoreEventChipModal
  // 不同的是，這裡只同步本機index，不會再push一次（避免echo迴圈）。
  function syncEventChipModalIndexFromRemote(idx) {
    if (typeof idx === "number") eventChipModalIndex = idx;
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
    titleEl.textContent = window.PriTestNightCore.eventChipDisplayLabel(idx);
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
    // ユーザー確認：購買ボタンを押した瞬間、上部に「已購買：xxx」の簡短提醒文字を1秒間だけ出す
    // （flashMerchantPurchaseが1秒後に自動的にクリア＆再描画する）。
    if (eventChipMerchantJustPurchasedText) {
      var purchasedFlashNote = document.createElement("p");
      purchasedFlashNote.className = "threat-ref-body merchant-purchase-flash-note";
      purchasedFlashNote.textContent = eventChipMerchantJustPurchasedText;
      content.appendChild(purchasedFlashNote);
    }
    var canAfford = (c.runes || 0) >= 1;
    var Weapons = window.PriTestWeapons;
    var Consumables = window.PriTestConsumables;

    var weaponTitle = document.createElement("h5");
    weaponTitle.textContent = window.I18N.t("merchant_weapon_purchase_title");
    content.appendChild(weaponTitle);
    var weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "primary-btn" + (eventChipMerchantJustPurchasedKey === "weapon" ? " merchant-purchase-flash-btn" : "");
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
      flashMerchantPurchase("weapon", window.I18N.t("merchant_purchase_flash_note", { item: Weapons.localizedText(result.item.name) }));
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
      var itemLabel = Consumables.localizedText ? Consumables.localizedText(item.name) : item.name.zh;
      btn.className = "combat-attack-hit-btn" + (eventChipMerchantJustPurchasedKey === id ? " merchant-purchase-flash-btn" : "");
      btn.textContent = itemLabel;
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
          item: itemLabel,
        });
        markEventChipUsed(idx);
        flashMerchantPurchase(id, window.I18N.t("merchant_purchase_flash_note", { item: itemLabel }));
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
      upgradeBtn.className = "combat-attack-hit-btn" + (eventChipMerchantJustPurchasedKey === weaponId ? " merchant-purchase-flash-btn" : "");
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
        flashMerchantPurchase(
          weaponId,
          window.I18N.t("merchant_purchase_flash_note", { item: Weapons.localizedText(weapon.name) + "（" + rarity + " → " + next + "）" })
        );
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

  // --- 靈脈：任意の1マス（または起點/終點）へ現在のフォーカス位置（黄枠）を無条件で移動する
  // （登攀判定不要——規則書「登攀判定に自動成功する扱い」）。使用者確認（項目5）：目的地選択の
  // 見た目は本盤面（3x3、buildBoardSlots）と同じ配置にし、飛んだ先の隣接マスも自動で翻牌する。
  // finalizeSlotMove（night.js、exposed）は数値スロットとstart/endの両方を受け付け、
  // focusedIndex設定・隣接翻牌（revealAdjacentSlots、gmFlowEnabled時）・保存・盤面再描画・
  // ログまで一括で行う既存の正規移動処理のため、attemptMoveToPositionの隣接/登攀判定
  // （靈脈には不要）を経由せず直接これを呼ぶ。 ---
  function renderEventChipSpiritVein(idx, content) {
    var Core = window.PriTestNightCore;
    var note = document.createElement("p");
    note.className = "threat-ref-body";
    note.textContent = window.I18N.t("event_chip_spirit_vein_note");
    content.appendChild(note);

    function moveTo(target, label) {
      // 使用者確認（バグ報告2-1）：実際に移動が確定する前に、保留していた継続処理
      // （resolveChipOfferが移動元idxのまま即座に呼ぶのを止めていたもの）を先に取り出して
      // おく——closeEventChipModal自体は「移動せず閉じた」場合の再開フックも兼ねているため、
      // 先に消費しておかないと二重に発火してしまう。
      var pendingContinuation = window.PriTestNightGmFlow && window.PriTestNightGmFlow.consumePendingSpiritVeinContinuation
        ? window.PriTestNightGmFlow.consumePendingSpiritVeinContinuation()
        : null;
      Core.finalizeSlotMove(target);
      window.PriTestNightLog("log_event_chip_spirit_vein_move", { position: label });
      markEventChipUsed(idx);
      closeEventChipModal();
      if (pendingContinuation && window.PriTestNightGmFlow && window.PriTestNightGmFlow.resumeChipOfferContinuationAfterMove) {
        window.PriTestNightGmFlow.resumeChipOfferContinuationAfterMove(pendingContinuation);
      }
    }

    var grid = document.createElement("div");
    grid.className = "spirit-vein-grid";
    for (var i = 0; i < Core.SLOT_COUNT; i++) {
      (function (target) {
        var slot = Core.state.slots[target];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "spirit-vein-cell";
        var label =
          slot && slot.revealed ? Core.CARD_BY_CODE[slot.code].label : window.I18N.t("event_chip_spirit_vein_slot_hidden", { n: target + 1 });
        btn.textContent = label;
        if (target === idx) {
          btn.disabled = true;
          btn.classList.add("spirit-vein-cell-current");
        } else {
          btn.addEventListener("click", function () {
            moveTo(target, label);
          });
        }
        grid.appendChild(btn);
      })(i);
    }
    content.appendChild(grid);

    var piles = document.createElement("div");
    piles.className = "spirit-vein-piles";
    [
      { pos: "start", key: "start_point_label" },
      { pos: "end", key: "end_point_label" },
    ].forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spirit-vein-cell spirit-vein-pile-btn";
      var label = window.I18N.t(p.key);
      btn.textContent = label;
      btn.addEventListener("click", function () {
        moveTo(p.pos, label);
      });
      piles.appendChild(btn);
    });
    content.appendChild(piles);
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
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = window.I18N.t("event_chip_strong_enemy_input_placeholder");
    if (recorded) input.value = recorded.enemyName;

    // 自動擲骰決定：⑧号強敵チットが2日目なら「恐るべき強敵決定表」（extraTables[1]）、
    // それ以外（⑦、または⑧だが1日目）は「一般強敵決定表」（extraTables[0]）を自動選択する
    // （state.eventChipNumbersで①〜⑨の身分を判別、GMの手動勾選は不要）。
    var Core = window.PriTestNightCore;
    var GmFlow = window.PriTestNightGmFlow;
    var isTerribleSlot = Core.state.eventChipNumbers && Core.state.eventChipNumbers[idx] === 8 && Core.state.dayNumber === 2;
    var selectedTable = card ? (card.extraTables || [])[isTerribleSlot ? 1 : 0] : null;
    if (selectedTable && GmFlow) {
      var autoRollBtn = document.createElement("button");
      autoRollBtn.type = "button";
      autoRollBtn.className = "primary-btn";
      autoRollBtn.textContent = window.I18N.t("event_chip_strong_enemy_auto_roll_button");
      autoRollBtn.addEventListener("click", function () {
        var result = GmFlow.rollStrongEnemyTable(selectedTable);
        if (!result) return; // 表の解析/解決に失敗：GMへ委ねる（既存の表参照・手動輸入のまま）
        var entryText = Events.localizedText(result.entry);
        input.value = entryText;
        GmFlow.resolveStrongEnemyEntry(result.entry, idx, result.levelBonus);
        var rollsText = result.rollLog
          .map(function (r) {
            return r.die1 + "+" + r.die2 + "＝" + r.text;
          })
          .join(" → ");
        Core.state.turnMessages.push({
          text: window.I18N.t("event_chip_strong_enemy_auto_roll_log", { rolls: rollsText, entry: entryText }),
          time: Date.now(),
          side: "gm",
        });
        Core.saveState();
        renderEventChipModal();
      });
      content.appendChild(autoRollBtn);
    }

    var inputRow = document.createElement("div");
    inputRow.className = "wb-row";
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

  // --- 聖甲蟲（項目4）：PC人數匹＝各PC獨立1隻聖甲蟲，各自任意選擇是否參加〈13｜任選能力值〉
  // 行為判定。成功者獲得「護符」1個（抽選）；失敗者承受FP損害1（黑方塊■＝1點，使用者已對照
  // 規則書原文確認），並可再付出FP損害1挑戰一次（再次失敗則聖甲蟲完全逃離、不再有動作）。
  // 進行中不呼叫markEventChipUsed，任何一位PC完成判定（成功或第一次失敗）後才標記使用——
  // 比照祝福籌碼「任一PC完成動作即視為此籌碼已發揮」的既有慣例。
  var SCARAB_TARGET = 13;
  // 使用者確認：改用state.eventChipsData[idx].scarab（跨端末同步、依idx區分）取代原本模組層級的
  // 純本地變數，避免（a）不同裝置各自持有獨立、互不同步的進度，導致誰按下判定/FP扣款對象
  // 混亂；（b）切換到別的籌碼再切回來時，eventChipModalIndex沒變但進度卻被意外重置。
  function scarabStateForIdx(idx) {
    var Core = window.PriTestNightCore;
    if (!Core.state.eventChipsData[idx] || typeof Core.state.eventChipsData[idx] !== "object") {
      Core.state.eventChipsData[idx] = {};
    }
    if (!Core.state.eventChipsData[idx].scarab || typeof Core.state.eventChipsData[idx].scarab !== "object") {
      Core.state.eventChipsData[idx].scarab = {}; // { [charId]: { stage: "unresolved"|"failedFirst"|"success"|"fled", statKey, dice, sum } }
    }
    return Core.state.eventChipsData[idx].scarab;
  }

  function renderEventChipScarabRow(idx, container, c) {
    var Core = window.PriTestNightCore;
    var Breakthrough = window.PriTestNightFloorBreakthrough;
    var CharacterTypes = window.PriTestCharacterTypes;
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var scarabState = scarabStateForIdx(idx);
    if (!scarabState[c.id]) scarabState[c.id] = { stage: "unresolved", statKey: "luck" };
    var st = scarabState[c.id];

    var row = document.createElement("div");
    row.className = "wb-row breakthrough-char-row";
    var name = document.createElement("span");
    name.className = "breakthrough-char-name";
    name.textContent = c.name;
    row.appendChild(name);

    function doRoll(isRetry) {
      if (isRetry) {
        // 為了獲得再挑戰一次的機會，先付出FP損害1（規則書：「さらに『FP損害：■』を被って」）。
        c.fp.current = Math.max(0, c.fp.current - 1);
      }
      var count = Breakthrough.effectiveCheckValue(c, type, st.statKey);
      var dice = [];
      for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
      var sum = dice.reduce(function (a, b) {
        return a + b;
      }, 0);
      var passed = sum >= SCARAB_TARGET;
      st.dice = dice;
      st.sum = sum;
      var outcomeKey = passed ? "ability_check_pass_label" : "ability_check_fail_label";
      window.PriTestNightLog("log_event_chip_scarab_result", {
        character: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(outcomeKey),
      });
      if (passed) {
        st.stage = "success";
        markEventChipUsed(idx);
        Core.openItemDrawModal("talisman", c.id, {
          onGranted: function () {
            renderEventChipModal();
          },
        });
      } else if (!isRetry) {
        // 首次失敗：徒勞感導致的FP損害1（與再挑戰的付出各自獨立累計）。
        c.fp.current = Math.max(0, c.fp.current - 1);
        st.stage = "failedFirst";
        markEventChipUsed(idx);
      } else {
        st.stage = "fled";
      }
      Core.saveRosterCharacters();
      Core.renderCharacterRoster();
      Core.saveState();
      renderEventChipModal();
    }

    if (st.stage === "unresolved") {
      var statSelect = document.createElement("select");
      ["luck", "physical", "mental"].forEach(function (key) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = window.I18N.t("check_stat_" + key);
        statSelect.appendChild(opt);
      });
      statSelect.value = st.statKey;
      statSelect.addEventListener("change", function () {
        st.statKey = statSelect.value;
      });
      row.appendChild(statSelect);
      var rollBtn = document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "combat-attack-hit-btn";
      rollBtn.textContent = window.I18N.t("event_chip_scarab_participate_button");
      rollBtn.addEventListener("click", function () {
        doRoll(false);
      });
      row.appendChild(rollBtn);
    } else {
      var resultLabel = document.createElement("span");
      var resultKey =
        st.stage === "success"
          ? "event_chip_scarab_result_success"
          : st.stage === "fled"
          ? "event_chip_scarab_result_fled"
          : "event_chip_scarab_result_fail_first";
      resultLabel.className = "ability-check-result " + (st.stage === "success" ? "ability-check-pass" : "ability-check-fail");
      resultLabel.textContent = window.I18N.t("ability_check_result_label", {
        dice: st.dice.join("+"),
        sum: st.sum,
        outcome: window.I18N.t(resultKey),
      });
      row.appendChild(resultLabel);
      if (st.stage === "failedFirst") {
        var retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "combat-attack-hit-btn";
        retryBtn.textContent = window.I18N.t("event_chip_scarab_retry_button");
        retryBtn.addEventListener("click", function () {
          doRoll(true);
        });
        row.appendChild(retryBtn);
      }
    }
    container.appendChild(row);
  }

  function renderEventChipScarab(idx, content, branch, Events) {
    (branch.floors || []).forEach(function (floor) {
      (floor.lines || []).forEach(function (line) {
        window.PriTestNightRulebook.renderFieldLine(content, line, Events.localizedText);
      });
    });
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var list = document.createElement("div");
    entered.forEach(function (c) {
      renderEventChipScarabRow(idx, list, c);
    });
    content.appendChild(list);
  }

  // --- 隨機事件：ランダムイベント決定表に載る全事件をGMが選択できるようにし、選んだ事件の
  // 本文（event_rulebook.js）をそのまま表示する。聖甲蟲（スカラベ）のみ上記の専用UIで
  // 自動化する（項目4）。それ以外は実際の処理を玩家の反応を見ながらGMが手動で進行する
  // （自動化しない）。 ---
  function renderEventChipRandom(idx, content) {
    var Events = window.PriTestEventRulebook;
    var card = Events ? Events.list().filter(function (ec) {
      return ec.id === "random_event";
    })[0] : null;
    var branches = card ? (card.branches || []).slice(1) : []; // 先頭は導入文のみのため除く
    // night_gm_flow.jsのautoRollRandomEventChipIfNeededが2-1のオファー時点で既に自動抽選
    // している場合、その結果（state.eventChipsData[idx].randomEventBranchIndex、branches
    // フル配列基準＝この配列より1大きいindex）をデフォルト選択にする——GMが毎回また手動で
    // 選び直す必要をなくす（ユーザー指定：自動化GM直接抽、告訴玩家抽到什麼事件）。
    var recordedData = window.PriTestNightCore.state.eventChipsData[idx];
    var recordedLocalIndex =
      recordedData && typeof recordedData.randomEventBranchIndex === "number" ? recordedData.randomEventBranchIndex - 1 : null;
    if (recordedLocalIndex !== null) {
      var autoNote = document.createElement("p");
      autoNote.className = "threat-ref-body";
      autoNote.textContent = window.I18N.t("event_chip_random_auto_drawn_note", { event: recordedData.randomEventName });
      content.appendChild(autoNote);
    }
    var select = document.createElement("select");
    branches.forEach(function (b, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = Events.localizedText(b.name);
      select.appendChild(o);
    });
    if (recordedLocalIndex !== null && branches[recordedLocalIndex]) select.value = String(recordedLocalIndex);
    content.appendChild(select);
    var detailDiv = document.createElement("div");
    content.appendChild(detailDiv);
    function isScarabBranch(b) {
      return !!(b && b.name && (b.name.zh === "聖甲蟲" || b.name.ja === "スカラベ"));
    }
    // 聖甲蟲は各PC個別の判定ボタンで進行が完結するため、汎用の「確定」ボタンは隠す
    // （要素自体は常に作っておき、renderDetailの中でhiddenを切り替える——選択を切り替える
    // たびに正しく更新されるようにする）。
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
    function renderDetail() {
      detailDiv.innerHTML = "";
      var b = branches[parseInt(select.value, 10)];
      if (!b) return;
      if (isScarabBranch(b)) {
        renderEventChipScarab(idx, detailDiv, b, Events);
        confirmBtn.hidden = true;
      } else {
        (b.floors || []).forEach(function (floor) {
          (floor.lines || []).forEach(function (line) {
            window.PriTestNightRulebook.renderFieldLine(detailDiv, line, Events.localizedText);
          });
        });
        confirmBtn.hidden = false;
      }
    }
    select.addEventListener("change", function () {
      // 別の事件へ切り替えたら聖甲蟲の個人別進行状態はリセットする（同一チットで別の
      // ランダムイベントを選び直した場合のみ。scarabの進行状態は今はstate.eventChipsData[idx]
      // 側に持つため、ここではその中のscarabキーだけを消す）。
      var Core = window.PriTestNightCore;
      if (Core.state.eventChipsData[idx] && Core.state.eventChipsData[idx].scarab) {
        delete Core.state.eventChipsData[idx].scarab;
      }
      renderDetail();
    });
    renderDetail();
    content.appendChild(confirmBtn);
  }

  window.PriTestNightEventChips = {
    handleEventChipTrigger: handleEventChipTrigger,
    openEventChipModal: openEventChipModal,
    closeEventChipModal: closeEventChipModal,
    minimizeEventChipModal: minimizeEventChipModal,
    restoreEventChipModal: restoreEventChipModal,
    applyEventChipBlessingRest: applyEventChipBlessingRest,
    markEventChipUsed: markEventChipUsed,
    renderEventChipModal: renderEventChipModal,
    syncEventChipModalIndexFromRemote: syncEventChipModalIndexFromRemote,
  };
})();
