(function () {
  // Split out of night.js to keep file sizes manageable. Potential Power dice-roll/effect-choose modal.
  // Depends on window.PriTestNightCore (state/roster/shared render helpers exported by night.js)
  // and, in a few spots, on other night_*.js sibling modules -- see night.js for the full module map.

  var CharacterDrawer = window.PriTestCharacterDrawer;

  // ============================================================
  // 潛在之力（潜在する力）：地圖板塊で敵人を擊破、または全踏破した際などにPCが獲得できる
  // 機会。GMが★の数（レア度決定値）を指定して抽選すると「得意武器」と「付帯効果」の両方の
  // 結果が確定し、PCはそのどちらか一方だけを選んで獲得する（規則書093/149頁）。
  // ============================================================
  var potentialPowerOnResolvedFn = null; // 場地報酬から起動した場合のみ、実際に武器/付帯効果を確定した時点でmarkFloorRewardObtainedを呼ぶコールバック。関数はJSONにできないため同期対象外・常にローカルのみ

  // window.PriTestNightCore.state.activeDraws.potentialPowerを進行中状態の実体として使う（跨裝置同期対象）。
  // 未使用時はnullなので、参照前に必ずppState()経由でデフォルト値を用意してから使う。
  function ppState() {
    if (!window.PriTestNightCore.state.activeDraws.potentialPower) {
      window.PriTestNightCore.state.activeDraws.potentialPower = {
        selectedCharacterId: null,
        starCount: 1,
        weaponResult: null, // CharacterDrawer.potentialPowerDrawWeaponの戻り値 | null
        effectResult: null, // CharacterDrawer.rollPotentialPowerAttachedEffectの戻り値 | null
        effectSlotPreview: null, // CharacterDrawer.previewAttachedEffectSlotの戻り値 | null（3枠埋まっている場合のみ）
        resolved: null, // "weapon" | "effect" | null
        minimized: false,
        pendingAttributeTag: null, // 場地報酬で指定された共通戦技タグ（例:「炎/-5」）。武器確定時に自動付与する
      };
    }
    return window.PriTestNightCore.state.activeDraws.potentialPower;
  }

  function ppSave() {
    window.PriTestDrawStateSync.set("potentialPower", window.PriTestNightCore.state.activeDraws.potentialPower);
  }

  function openPotentialPowerModal(presetCharacterId, presetStarCount, presetAttributeTag, onResolved) {
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;
    var pp = ppState();
    if (
      presetCharacterId &&
      entered.some(function (c) {
        return c.id === presetCharacterId;
      })
    ) {
      pp.selectedCharacterId = presetCharacterId;
    } else if (
      !entered.some(function (c) {
        return c.id === pp.selectedCharacterId;
      })
    ) {
      pp.selectedCharacterId = entered[0].id;
    }
    pp.starCount = presetStarCount || 1;
    pp.weaponResult = null;
    pp.effectResult = null;
    pp.effectSlotPreview = null;
    pp.resolved = null;
    pp.minimized = false;
    pp.pendingAttributeTag = presetAttributeTag || null;
    potentialPowerOnResolvedFn = onResolved || null;
    ppSave();
    document.getElementById("potential-power-modal").hidden = false;
    document.getElementById("btn-potential-power-restore").hidden = true;
    renderPotentialPowerModal();
  }

  function closePotentialPowerModal() {
    // 確定・縮小せずに閉じた場合、window.PriTestNightCore.state.activeDraws.potentialPowerを明示的にクリアしないと、
    // 他の操作によるstate同期のたびに「非null かつ 非縮小 かつ モーダル非表示」の条件を
    // 満たしてしまい、この画面が勝手に何度も再表示されるバグになる（closeItemDrawModalと同じ対策）。
    window.PriTestNightCore.state.activeDraws.potentialPower = null;
    ppSave();
    document.getElementById("potential-power-modal").hidden = true;
    document.getElementById("btn-potential-power-restore").hidden = true;
    window.PriTestNightCore.restoreTurnRewardModalIfMinimized();
  }

  // 縮小/復元は樓層獲得と同じ「モーダルを隠す＋別のスタッキング型固定ボタンを表示」方式。
  // 抽選結果を保持したままモーダルだけを一時的に隠す（状態はリセットしない）。
  function minimizePotentialPowerModal() {
    document.getElementById("potential-power-modal").hidden = true;
    document.getElementById("btn-potential-power-restore").hidden = false;
    ppState().minimized = true;
    ppSave();
  }

  function restorePotentialPowerModal() {
    document.getElementById("btn-potential-power-restore").hidden = true;
    document.getElementById("potential-power-modal").hidden = false;
    ppState().minimized = false;
    ppSave();
    renderPotentialPowerModal();
  }

  function resetPotentialPowerRoll() {
    var pp = ppState();
    pp.weaponResult = null;
    pp.effectResult = null;
    pp.effectSlotPreview = null;
    pp.resolved = null;
    ppSave();
  }

  function renderPotentialPowerModal() {
    var pp = ppState();
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var select = document.getElementById("potential-power-character-select");
    select.innerHTML = "";
    entered.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === pp.selectedCharacterId) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function () {
      ppState().selectedCharacterId = select.value;
      resetPotentialPowerRoll();
      renderPotentialPowerModal();
    };

    var starSelect = document.getElementById("potential-power-star-select");
    starSelect.value = String(pp.starCount);
    starSelect.disabled = !!(pp.weaponResult || pp.effectResult) || window.PriTestNightCore.state.turnHolder !== "gm";
    starSelect.onchange = function () {
      ppState().starCount = parseInt(starSelect.value, 10) || 1;
      ppSave();
    };

    var c = entered.filter(function (rc) {
      return rc.id === pp.selectedCharacterId;
    })[0];
    var content = document.getElementById("potential-power-modal-content");
    content.innerHTML = "";
    if (!c) return;

    if (pp.resolved) {
      var doneP = document.createElement("p");
      doneP.className = "threat-ref-body weapon-roll-result";
      doneP.textContent = window.I18N.t("potential_power_resolved_note");
      content.appendChild(doneP);
      return;
    }

    if (!pp.weaponResult && !pp.effectResult) {
      var rollBtn = document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "primary-btn";
      rollBtn.textContent = window.I18N.t("potential_power_roll_button");
      rollBtn.addEventListener("click", function () {
        var freshPp = ppState();
        freshPp.weaponResult = CharacterDrawer.potentialPowerDrawWeapon(c, freshPp.starCount);
        freshPp.effectResult = CharacterDrawer.rollPotentialPowerAttachedEffect(c);
        // 3枠が既に埋まっている場合、どの枠が上書きされるかを先に判定しておき、選択前に
        // プレイヤーへ提示できるようにする（実際の上書きはcommitAttachedEffectChoiceで
        // このプレビュー結果をそのまま使う）。
        freshPp.effectSlotPreview = CharacterDrawer.previewAttachedEffectSlot(c);
        ppSave();
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
    if (pp.weaponResult && pp.weaponResult.item) {
      var wr = pp.weaponResult;
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
      // #13：従来は戦技名を並べるだけだったが、名前をクリックすると戦技/魔術/祈禱の詳細説明
      // まで展開できるよう、規則書タブと同じrenderWeaponSkillRefEntry（<details>）を再利用する。
      // ランダム戦技（kind:"random"）は、既に抽選済み（wr.skillId）ならその実際の戦技として
      // 解決して表示する（規則書タブの「未決定」表示のままだと抽選結果と食い違うため）。
      var wrCategory = Weapons.getCategory(wr.categoryId);
      var skillRefs = CharacterDrawer.getItemSkillRefs(wrCategory, wr.item).filter(function (ref) {
        return ref.kind !== "note";
      });
      if (skillRefs.length) {
        skillRefs.forEach(function (ref) {
          var effectiveRef = ref.kind === "random" && wr.skillId ? { kind: "art", id: wr.skillId } : ref;
          window.PriTestNightWeaponRulebook.renderWeaponSkillRefEntry(weaponDetails, effectiveRef);
        });
      } else {
        var skillP = document.createElement("p");
        skillP.className = "threat-ref-body";
        skillP.textContent = window.I18N.t("potential_power_weapon_no_skill_note");
        weaponDetails.appendChild(skillP);
      }
      weaponCard.appendChild(weaponDetails);
      if (pp.pendingAttributeTag) {
        var attributeTagNote = document.createElement("p");
        attributeTagNote.className = "threat-ref-body weapon-roll-note";
        attributeTagNote.textContent = window.I18N.t("potential_power_pending_attribute_tag_note", { tag: pp.pendingAttributeTag });
        weaponCard.appendChild(attributeTagNote);
      }
      var weaponChooseBtn = document.createElement("button");
      weaponChooseBtn.type = "button";
      weaponChooseBtn.className = "primary-btn";
      weaponChooseBtn.textContent = window.I18N.t("potential_power_weapon_choose_button");
      weaponChooseBtn.addEventListener("click", function () {
        var freshPp = ppState();
        var newWeaponId = CharacterDrawer.commitPotentialPowerWeapon(c, wr, freshPp.pendingAttributeTag);
        window.PriTestNightCore.saveRosterCharacters();
        window.PriTestNightCore.renderCharacterRoster();
        window.PriTestNightLog("log_potential_power_weapon_choice", { character: c.name, weapon: Weapons.localizedText(wr.item.name) });
        freshPp.resolved = "weapon";
        ppSave();
        renderPotentialPowerModal();
        if (typeof potentialPowerOnResolvedFn === "function") potentialPowerOnResolvedFn();
        CharacterDrawer.resolveInventoryOverflow(c, "weapon", function () {
          window.PriTestNightCore.renderCharacterRoster();
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
    var er = pp.effectResult;

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
      if (pp.effectSlotPreview) {
        var replacedEffect = CharacterDrawer.attachedEffectById(pp.effectSlotPreview.replacedId);
        var replaceNote = document.createElement("p");
        replaceNote.className = "threat-ref-body";
        replaceNote.style.color = "#b3441e";
        replaceNote.textContent = window.I18N.t("potential_power_effect_will_replace_note", {
          old: replacedEffect ? Weapons.localizedText(replacedEffect.name) : pp.effectSlotPreview.replacedId,
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
        var freshPp = ppState();
        var result = CharacterDrawer.commitAttachedEffectChoice(c, effect, freshPp.effectSlotPreview);
        window.PriTestNightCore.saveRosterCharacters();
        var effectName = Weapons.localizedText(effect.name);
        if (result.replacedId) {
          var oldEffect = CharacterDrawer.attachedEffectById(result.replacedId);
          window.PriTestNightLog("log_potential_power_effect_replace", {
            character: c.name,
            effect: effectName,
            old: oldEffect ? Weapons.localizedText(oldEffect.name) : result.replacedId,
          });
        } else {
          window.PriTestNightLog("log_potential_power_effect_choice", { character: c.name, effect: effectName });
        }
        freshPp.resolved = "effect";
        ppSave();
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

  window.PriTestNightPotentialPower = {
    openPotentialPowerModal: openPotentialPowerModal,
    closePotentialPowerModal: closePotentialPowerModal,
    minimizePotentialPowerModal: minimizePotentialPowerModal,
    restorePotentialPowerModal: restorePotentialPowerModal,
    renderPotentialPowerModal: renderPotentialPowerModal,
  };
})();
