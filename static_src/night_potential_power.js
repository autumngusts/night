(function () {
  // Split out of night.js to keep file sizes manageable. Potential Power dice-roll/effect-choose modal.
  // Depends on window.PriTestNightCore (state/roster/shared render helpers exported by night.js)
  // and, in a few spots, on other night_*.js sibling modules -- see night.js for the full module map.

  var CharacterDrawer = window.PriTestCharacterDrawer;

  // ============================================================
  // 潛在之力（潜在する力）：地圖板塊で敵人を擊破、または全踏破した際などにPCが獲得できる
  // 機会。GMが★の数（レア度決定値）を指定して抽選すると「得意武器」と「付帯効果」の両方の
  // 結果が確定し、PCはそのどちらか一方だけを選んで獲得する（規則書093/149頁）。
  //
  // 使用者確認：跨裝置同步顯示視窗——「一次給全員」的場合（全踏破/樓層獎勵常見同時發放給
  // 多名角色），改為每個角色各自獨立的抽選槽位（state.activeDraws.potentialPowerByChar，
  // key=角色id），讓每位玩家能在自己的裝置上為自己的角色單獨抽選、互不干擾（以前是單一
  // 全域槽位，切換角色下拉選單就會直接洗掉另一位角色尚未完成的擲骰結果）。
  // ============================================================
  var potentialPowerOnResolvedFn = null; // 場地報酬から起動した場合のみ、実際に武器/付帯効果を確定した時点でmarkFloorRewardObtainedを呼ぶコールバック。関数はJSONにできないため同期対象外・常にローカルのみ
  // このクライアントが「今どの角色の抽選を見ているか」はローカル専用（同期しない）——
  // 複数裝置が同時に別々の角色を見ていて構わないため。
  var viewingCharacterId = null;

  function ppMap() {
    if (!window.PriTestNightCore.state.activeDraws.potentialPowerByChar) {
      window.PriTestNightCore.state.activeDraws.potentialPowerByChar = {};
    }
    return window.PriTestNightCore.state.activeDraws.potentialPowerByChar;
  }

  // 未使用時はエントリが無いので、参照前に必ずppState(charId)経由でデフォルト値を用意してから使う。
  function ppState(charId) {
    var map = ppMap();
    if (!map[charId]) {
      map[charId] = {
        starCount: 1,
        weaponResult: null, // CharacterDrawer.potentialPowerDrawWeaponの戻り値 | null
        effectResult: null, // CharacterDrawer.rollPotentialPowerAttachedEffectの戻り値 | null
        effectSlotPreview: null, // CharacterDrawer.previewAttachedEffectSlotの戻り値 | null（3枠埋まっている場合のみ）
        resolved: null, // "weapon" | "effect" | null
        minimized: false,
        pendingAttributeTag: null, // 場地報酬で指定された共通戦技タグ（例:「炎/-5」）。武器確定時に自動付与する
      };
    }
    return map[charId];
  }

  // 使用者確認（2026-09-01、跨裝置race condition修正）：以前はppMap()全體を
  // PriTestDrawStateSync.set()経由で丸ごと書き戻していたが、複数端末がほぼ同時に別々の
  // charIdへ書き込むと、後から書いた側が先の追加を消してしまうrace conditionがあった
  // （詳細はdocs/combat_flow_rules.md該当箇所）。ppSave()を呼ぶ全箇所は必ずその時点の
  // viewingCharacterId（＝今このクライアントが編集している角色）のエントリだけを変更する
  // ため、そのcharId1件だけをFirebaseの狭いleaf update経路（setCharEntry）で書けば十分。
  function ppSave() {
    var map = ppMap();
    window.PriTestDrawStateSync.setCharEntry("potentialPowerByChar", viewingCharacterId, map[viewingCharacterId] || null);
  }

  function openPotentialPowerModal(presetCharacterId, presetStarCount, presetAttributeTag, onResolved) {
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;
    var charId =
      presetCharacterId &&
      entered.some(function (c) {
        return c.id === presetCharacterId;
      })
        ? presetCharacterId
        : viewingCharacterId &&
          entered.some(function (c) {
            return c.id === viewingCharacterId;
          })
        ? viewingCharacterId
        : entered[0].id;
    viewingCharacterId = charId;
    var pp = ppState(charId);
    // presetCharacterIdが指定された呼び出し（＝獎勵清單からの新規「獲得」操作）のときだけ、
    // その角色の抽選を新しく始め直す。プルダウンで別の角色の進行中の抽選を「見る」だけの
    // 場合（presetCharacterId無し）は、既存の内容をそのまま維持する。
    if (presetCharacterId) {
      pp.starCount = presetStarCount || 1;
      pp.weaponResult = null;
      pp.effectResult = null;
      pp.effectSlotPreview = null;
      pp.resolved = null;
      pp.minimized = false;
      pp.pendingAttributeTag = presetAttributeTag || null;
      // 使用者確認：「簡化抽選」開啟時，跳過「按下擲骰」這一步，開啟視窗當下就直接自動骰完
      // 得意武器與付帶效果，讓玩家一開視窗就看到抽選結果（是否要「得意武器」或「付帶效果」
      // 仍是真正的獎勵選擇，不算中間判定過程，保留給玩家點選）。
      if (window.PriTestNightCore.state.simplifiedDrawEnabled) {
        var c = entered.filter(function (rc) {
          return rc.id === charId;
        })[0];
        pp.weaponResult = CharacterDrawer.potentialPowerDrawWeapon(c, pp.starCount);
        pp.effectResult = CharacterDrawer.rollPotentialPowerAttachedEffect(c);
        pp.effectSlotPreview = CharacterDrawer.previewAttachedEffectSlot(c);
      }
    }
    potentialPowerOnResolvedFn = onResolved || null;
    ppSave();
    document.getElementById("potential-power-modal").hidden = false;
    renderPotentialPowerModal();
    renderPotentialPowerRestoreList();
  }

  // このcharIdの抽選が完全に終わった（確定して閉じた）ときだけ、マップからエントリを削除する。
  function removePotentialPowerEntry(charId) {
    var map = ppMap();
    delete map[charId];
    ppSave();
  }

  function closePotentialPowerModal() {
    // 確定・縮小せずに「離開」を押した場合は放棄——このcharIdのエントリを削除しないと、
    // 他の操作によるstate同期のたびに「非null かつ 非縮小 かつ モーダル非表示」の条件を
    // 満たしてしまい、この画面が勝手に何度も再表示されるバグになる（closeItemDrawModalと
    // 同じ対策）。縮小したいだけの場合はminimizePotentialPowerModal（別のボタン）を使う。
    var charId = viewingCharacterId;
    document.getElementById("potential-power-modal").hidden = true;
    if (charId) removePotentialPowerEntry(charId);
    viewingCharacterId = null;
    renderPotentialPowerRestoreList();
    window.PriTestNightCore.restoreTurnRewardModalIfMinimized();
  }

  // 縮小/復元は樓層獲得と同じ「モーダルを隠す＋別のスタッキング型固定ボタンを表示」方式。
  // 抽選結果を保持したままモーダルだけを一時的に隠す（状態はリセットしない）。
  function minimizePotentialPowerModal() {
    document.getElementById("potential-power-modal").hidden = true;
    if (viewingCharacterId) {
      ppState(viewingCharacterId).minimized = true;
      ppSave();
    }
    renderPotentialPowerRestoreList();
  }

  function restorePotentialPowerModal(charId) {
    var map = ppMap();
    var targetId = charId || viewingCharacterId;
    if (!targetId || !map[targetId]) return;
    viewingCharacterId = targetId;
    map[targetId].minimized = false;
    ppSave();
    document.getElementById("potential-power-modal").hidden = false;
    renderPotentialPowerModal();
    renderPotentialPowerRestoreList();
  }

  // 使用者確認：跨裝置同步顯示視窗——目前有幾位角色的潛在之力抽選處於「縮小中」，就在右下
  // 顯示幾個還原按鈕（橫向並排在同一個固定位置，不佔用其他視窗類型既有的堆疊欄位）。
  function renderPotentialPowerRestoreList() {
    var list = document.getElementById("potential-power-restore-list");
    if (!list) return;
    var map = ppMap();
    var entered = window.PriTestNightCore.getRosterCharacters();
    var pendingIds = Object.keys(map).filter(function (charId) {
      return map[charId] && map[charId].minimized;
    });
    list.innerHTML = "";
    list.hidden = pendingIds.length === 0;
    pendingIds.forEach(function (charId) {
      var c = entered.filter(function (rc) {
        return rc.id === charId;
      })[0];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "potential-power-restore-chip";
      btn.textContent = window.I18N.t("potential_power_restore_button") + (c ? "（" + c.name + "）" : "");
      btn.addEventListener("click", function () {
        restorePotentialPowerModal(charId);
      });
      list.appendChild(btn);
    });
  }

  function renderPotentialPowerModal() {
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!viewingCharacterId || !entered.some(function (c) { return c.id === viewingCharacterId; })) {
      viewingCharacterId = entered.length ? entered[0].id : null;
    }
    var pp = viewingCharacterId ? ppState(viewingCharacterId) : null;
    var select = document.getElementById("potential-power-character-select");
    select.innerHTML = "";
    entered.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      // 使用者確認：跨裝置同步顯示視窗——這個下拉選單現在只是「切換這台裝置正在看誰的抽選」，
      // 不會影響/清除其他角色的進行中資料，因此選項旁標示是否已有進行中/已完成的抽選。
      var entry = ppMap()[c.id];
      var suffix = entry ? (entry.resolved ? window.I18N.t("potential_power_option_done_suffix") : window.I18N.t("potential_power_option_in_progress_suffix")) : "";
      o.textContent = c.name + suffix;
      if (c.id === viewingCharacterId) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function () {
      viewingCharacterId = select.value;
      renderPotentialPowerModal();
    };

    var content = document.getElementById("potential-power-modal-content");
    var starSelect = document.getElementById("potential-power-star-select");
    if (!pp) {
      content.innerHTML = "";
      return;
    }
    starSelect.value = String(pp.starCount);
    // 使用者確認：星數（★數，決定稀有度機率）已經由樓層獎勵在發放當下自動決定好，一般玩家
    // 不應該能更改；只有規則書密碼驗證過的GM（isRulebookAuthenticated，比單純turnHolder===
    // "gm"更嚴格）才能視情況手動調整。
    starSelect.disabled = !!(pp.weaponResult || pp.effectResult) || !window.PriTestNightCore.isRulebookAuthenticated();
    starSelect.onchange = function () {
      ppState(viewingCharacterId).starCount = parseInt(starSelect.value, 10) || 1;
      ppSave();
    };

    var c = entered.filter(function (rc) {
      return rc.id === viewingCharacterId;
    })[0];
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
        var freshPp = ppState(viewingCharacterId);
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
        var freshPp = ppState(viewingCharacterId);
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
        var freshPp = ppState(viewingCharacterId);
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

  // 使用者確認：跨裝置同步顯示視窗——subscribeNightState収到遠端snapshot時呼ばれる。
  // 潛在之力是「給特定1名角色」的個人獎勵，不像防禦階段視窗/判定視窗是全員共同關心的
  // 戰鬥資訊，因此**不**強制在所有裝置自動彈出（否則3名角色同時獲得時，每個人的畫面都會
  // 跳出3份跟自己無關的抽選視窗）。這裡只做兩件事：(1) 讓還原清單隨時反映目前所有裝置
  // 各自縮小/進行中的角色清單；(2) 如果這台裝置本來就已經開著某個角色的抽選（無論是自己
  // 開的還是稍早還原的），持續同步該角色的最新內容（例如GM在旁邊協助操作時，雙方畫面
  // 都能即時看到同一份最新結果）。
  function applyRemotePotentialPowerState() {
    var map = ppMap();
    var modalEl = document.getElementById("potential-power-modal");
    if (!modalEl.hidden && viewingCharacterId) {
      if (map[viewingCharacterId]) {
        renderPotentialPowerModal();
      } else {
        // 這台裝置正在看的角色已經在別的裝置被確定完成並關閉，跟著關閉。
        viewingCharacterId = null;
        modalEl.hidden = true;
      }
    }
    renderPotentialPowerRestoreList();
  }

  window.PriTestNightPotentialPower = {
    openPotentialPowerModal: openPotentialPowerModal,
    closePotentialPowerModal: closePotentialPowerModal,
    minimizePotentialPowerModal: minimizePotentialPowerModal,
    restorePotentialPowerModal: restorePotentialPowerModal,
    renderPotentialPowerModal: renderPotentialPowerModal,
    renderPotentialPowerRestoreList: renderPotentialPowerRestoreList,
    applyRemotePotentialPowerState: applyRemotePotentialPowerState,
  };
})();
