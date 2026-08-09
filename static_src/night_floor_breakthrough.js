(function () {
  // Split out of night.js to keep file sizes manageable. Floor reward modal/option rendering + breakthrough (field-check dice roll) modal.
  // Depends on window.PriTestNightCore (state/roster/shared render helpers exported by night.js)
  // and, in a few spots, on other night_*.js sibling modules -- see night.js for the full module map.

  var CharacterTypes = window.PriTestCharacterTypes;
  var CharacterDrawer = window.PriTestCharacterDrawer;

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
  // index === "start"/"end"（盤外の板塊）の場合は、そのまま役割で決まる
  // （出發地點＝a_start、終點＝a_golden。スート比較は板塊にのみ必要な曖昧さで、
  // 起點/終點自体は役割が固定なので不要）。
  function resolveFieldEntryForSlot(index) {
    var Fields = window.PriTestFields;
    if (index === "start" || index === "end") {
      if (!Fields) return null;
      var wantPileId = index === "start" ? "a_start" : "a_golden";
      return (
        Fields.list().filter(function (fc) {
          return fc.id === wantPileId;
        })[0] || null
      );
    }
    var slot = window.PriTestNightCore.state.slots[index];
    if (!slot) return null;
    var card = window.PriTestNightCore.CARD_BY_CODE[slot.code];
    if (!card || !Fields) return null;
    var matches = Fields.list().filter(function (fc) {
      return fc.cardLabel === card.rank;
    });
    if (!matches.length) return null;
    if (card.rank === "A" && matches.length > 1) {
      var wantId = card.suit === window.PriTestNightCore.state.startSuit ? "a_start" : "a_golden";
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
    window.PriTestNightCore.removePendingRewardWindow("floorReward");
  }

  function minimizeFloorRewardModal() {
    document.getElementById("floor-reward-modal").hidden = true;
    document.getElementById("btn-floor-reward-restore").hidden = false;
    window.PriTestNightCore.addPendingRewardWindow("floorReward");
  }

  function restoreFloorRewardModal() {
    document.getElementById("btn-floor-reward-restore").hidden = true;
    document.getElementById("floor-reward-modal").hidden = false;
    if (floorRewardModalFloor) renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floorRewardModalFloor);
  }

  // 規則書の記述文には「擊破盧恩：4」「撃破ルーン：4」のように盧恩獎勵が書かれているのに、
  // 対応するfields.js/enemies.js/event_rulebook.jsのreward配列側にはボタンが用意されていない
  // ケースが多い（データ二重管理のズレ）。この関数で本文から実際の数値を検出し、テキストが
  // 見つかった箇所へ「発見した数値をGMが微調整できる、獲得ボタン付きの行」を後付けで足す。
  var RUNE_AMOUNT_RE = /(?:擊破盧恩|撃破ルーン)[：:]\s*([+＋]?\d+)/g;
  function parseRuneAmountFromText(text) {
    if (!text) return 0;
    var total = 0;
    var re = new RegExp(RUNE_AMOUNT_RE.source, "g");
    var m;
    while ((m = re.exec(text))) {
      total += parseInt(m[1].replace(/[＋+]/g, ""), 10) || 0;
    }
    return total;
  }

  // 全入場中PCへ盧恩を付与する共通処理（獎勵清單のrune種別・場地カードのrune種別・規則書の
  // 自動検出行・留言板の/runeコマンドなど、複数箇所から同じ経路で呼べるようにまとめている）。
  function grantRuneToAllEntered(value) {
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c) {
      c.runes = (c.runes || 0) + value;
    });
    window.PriTestNightCore.saveRosterCharacters();
    window.PriTestNightCore.renderCharacterRoster();
    window.PriTestNightLog("log_floor_reward_rune", { value: value, count: entered.length });
    return entered.length;
  }

  function floorLineText(floor) {
    return ((floor && floor.lines) || [])
      .map(function (line) {
        return window.PriTestFields.localizedText(line.text);
      })
      .join("\n");
  }

  // reward配列に何も無くても、本文に「擊破盧恩：N」の記述だけがあるフロアは獎勵欄を表示する
  // 対象に含める（#9：規則書の記述とreward配列のズレを埋める）。
  function floorHasAnyReward(floor) {
    if (floor && floor.reward && floor.reward.length) return true;
    return !!parseRuneAmountFromText(floorLineText(floor));
  }

  // 検出した盧恩獎勵を、対象コンテナへ「數値入力（GMが微調整可）＋獲得ボタン」の1行として
  // 追加する。stateKeyを渡すとmarkFloorRewardObtainedと同じ仕組みで一度きりの獲得に制限する。
  function appendRuneGrantRowIfDetected(container, text, stateKey) {
    var amount = parseRuneAmountFromText(text);
    if (!amount) return;
    var already = !!(stateKey && window.PriTestNightCore.state.floorRewardObtained && window.PriTestNightCore.state.floorRewardObtained[stateKey]);
    var row = document.createElement("div");
    row.className = "wb-row rune-grant-row";
    var label = document.createElement("span");
    label.className = "threat-ref-body";
    label.textContent = window.I18N.t("rune_grant_detected_label");
    row.appendChild(label);
    var input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.value = String(amount);
    if (already) input.disabled = true;
    row.appendChild(input);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary-btn";
    btn.textContent = window.I18N.t("rune_grant_button");
    if (already) {
      btn.disabled = true;
      btn.classList.add("field-reward-obtained");
    }
    btn.addEventListener("click", function () {
      var value = parseInt(input.value, 10) || 0;
      if (value <= 0) return;
      grantRuneToAllEntered(value);
      input.disabled = true;
      window.PriTestNightCore.markFloorRewardObtained(btn, null, stateKey);
    });
    row.appendChild(btn);
    container.appendChild(row);
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
      return !!(key && window.PriTestNightCore.state.floorRewardObtained && window.PriTestNightCore.state.floorRewardObtained[key]);
    }
    // GMが個別に「この項目は誤り／不要」として取消した状態（項目単位、対象角色は問わない）。
    var dismissKey = floorKey && entryIndex !== undefined ? floorKey + "_dismiss_" + entryIndex : null;
    function isDismissed() {
      return !!(dismissKey && window.PriTestNightCore.state.floorRewardDismissed && window.PriTestNightCore.state.floorRewardDismissed[dismissKey]);
    }
    var outerRow = document.createElement("div");
    outerRow.className = "floor-reward-entry-row";
    container.appendChild(outerRow);
    if (isDismissed()) {
      var dismissedNote = document.createElement("p");
      dismissedNote.className = "threat-ref-body";
      dismissedNote.style.textDecoration = "line-through";
      dismissedNote.textContent = window.I18N.t("floor_reward_dismissed_note");
      outerRow.appendChild(dismissedNote);
      return;
    }
    if (dismissKey) {
      var dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "tag-remove floor-reward-dismiss-btn";
      dismissBtn.textContent = "×";
      dismissBtn.title = window.I18N.t("floor_reward_dismiss_button");
      // GM回合限定操作：完全に「gm」と一致する場合のみ押せる（他の項目の既存GM限定操作と同じ判定）。
      dismissBtn.disabled = !(window.PriTestTurnHolder && window.PriTestTurnHolder() === "gm");
      dismissBtn.addEventListener("click", function () {
        if (!window.confirm(window.I18N.t("floor_reward_dismiss_confirm"))) return;
        if (!window.PriTestNightCore.state.floorRewardDismissed) window.PriTestNightCore.state.floorRewardDismissed = {};
        window.PriTestNightCore.state.floorRewardDismissed[dismissKey] = true;
        window.PriTestNightCore.saveState();
        if (floorRewardModalFloor) renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floorRewardModalFloor);
      });
      outerRow.appendChild(dismissBtn);
    }
    var contentEl = document.createElement("div");
    contentEl.className = "floor-reward-entry-content";
    outerRow.appendChild(contentEl);
    container = contentEl; // 以降の既存ロジックはcontainer.appendChildをそのまま使うため、以後はこのラッパー内に描画される。
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
      if (isAlreadyObtained()) {
        hpBtn.disabled = true;
        hpBtn.classList.add("field-reward-obtained");
        hpSelect.disabled = true;
      }
      hpBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === hpSelect.value;
        })[0];
        if (!target) return;
        target.hp.current = Math.max(0, (target.hp.current || 0) - entry.value);
        window.PriTestNightCore.saveRosterCharacters();
        window.PriTestNightCore.renderCharacterRoster();
        window.PriTestNightLog("log_floor_reward_hp_damage", { character: target.name, value: entry.value });
        hpSelect.disabled = true;
        window.PriTestNightCore.markFloorRewardObtained(
          hpBtn,
          window.I18N.t("log_floor_reward_hp_damage", { character: target.name, value: entry.value }),
          obtainedStateKey()
        );
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
      if (isAlreadyObtained()) {
        runeBtn.disabled = true;
        runeBtn.classList.add("field-reward-obtained");
      }
      runeBtn.addEventListener("click", function () {
        entered.forEach(function (c) {
          c.runes = (c.runes || 0) + entry.value;
        });
        window.PriTestNightCore.saveRosterCharacters();
        window.PriTestNightCore.renderCharacterRoster();
        window.PriTestNightLog("log_floor_reward_rune", { value: entry.value, count: entered.length });
        window.PriTestNightCore.markFloorRewardObtained(
          runeBtn,
          window.I18N.t("log_floor_reward_rune", { value: entry.value, count: entered.length }),
          obtainedStateKey()
        );
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
      if (isAlreadyObtained()) {
        chaliceBtn.disabled = true;
        chaliceBtn.classList.add("field-reward-obtained");
      }
      chaliceBtn.addEventListener("click", function () {
        entered.forEach(function (c) {
          if (!c.flaskExtra) c.flaskExtra = { current: 0, max: 0 };
          c.flaskExtra.max = (c.flaskExtra.max || 0) + entry.value;
          c.flaskExtra.current = (c.flaskExtra.current || 0) + entry.value;
        });
        window.PriTestNightCore.saveRosterCharacters();
        window.PriTestNightCore.renderCharacterRoster();
        window.PriTestNightLog("log_floor_reward_chalice_bonus", { value: entry.value, count: entered.length });
        window.PriTestNightCore.markFloorRewardObtained(
          chaliceBtn,
          window.I18N.t("log_floor_reward_chalice_bonus", { value: entry.value, count: entered.length }),
          obtainedStateKey()
        );
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
      if (isAlreadyObtained()) {
        consumableBtn.disabled = true;
        consumableBtn.classList.add("field-reward-obtained");
        consumableCharSelect.disabled = true;
      }
      consumableBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === consumableCharSelect.value;
        })[0];
        if (!target) return;
        minimizeFloorRewardModal();
        window.PriTestNightLog("log_floor_reward_consumable_roll_nav", { character: target.name });
        window.PriTestNightCore.openItemDrawModal("consumable", target.id, {
          grantCount: entry.value,
          onGranted: function () {
            consumableCharSelect.disabled = true;
            window.PriTestNightCore.markFloorRewardObtained(
              consumableBtn,
              window.I18N.t("log_floor_reward_consumable_roll_nav", { character: target.name }),
              obtainedStateKey()
            );
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
      if (isAlreadyObtained()) {
        talismanBtn.disabled = true;
        talismanBtn.classList.add("field-reward-obtained");
        talismanCharSelect.disabled = true;
      }
      talismanBtn.addEventListener("click", function () {
        var target = entered.filter(function (c) {
          return c.id === talismanCharSelect.value;
        })[0];
        if (!target) return;
        minimizeFloorRewardModal();
        window.PriTestNightLog("log_floor_reward_talisman_roll_nav", { character: target.name });
        window.PriTestNightCore.openItemDrawModal("talisman", target.id, {
          onGranted: function () {
            talismanCharSelect.disabled = true;
            window.PriTestNightCore.markFloorRewardObtained(
              talismanBtn,
              window.I18N.t("log_floor_reward_talisman_roll_nav", { character: target.name }),
              obtainedStateKey()
            );
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
          window.PriTestNightLog("log_floor_reward_weapon_wizard_nav", { character: target.name, value: "★".repeat(entry.value) });
          window.PriTestNightCore.openItemDrawModal("weapon", target.id, {
            starCount: entry.value,
            categoryId: entry.categoryId,
            attributeTag: resolvedAttributeTag,
            onGranted: function () {
              weaponCharSelect.disabled = true;
              window.PriTestNightCore.markFloorRewardObtained(
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

      // カテゴリ/属性タグ指定のない単純な★数のみの場地報酬も、上のブロックと同じく
      // 直接確定ではなく抽選ウィザード（開始→抽選→終了）を経由させる。
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
        window.PriTestNightLog("log_floor_reward_weapon_wizard_nav", { character: target.name, value: "★".repeat(entry.value) });
        window.PriTestNightCore.openItemDrawModal("weapon", target.id, {
          starCount: entry.value,
          onGranted: function () {
            weaponCharSelect.disabled = true;
            window.PriTestNightCore.markFloorRewardObtained(
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
      if (isAlreadyObtained()) {
        keyBtn.disabled = true;
        keyBtn.classList.add("field-reward-obtained");
      }
      keyBtn.addEventListener("click", function () {
        window.PriTestNightCore.state.stoneswordKeyCount = (window.PriTestNightCore.state.stoneswordKeyCount || 0) + keyTotal;
        window.PriTestNightCore.saveState();
        window.PriTestNightCore.renderStoneswordKeyCount();
        window.PriTestNightLog("log_floor_reward_stonesword_key", { value: keyTotal });
        window.PriTestNightCore.markFloorRewardObtained(keyBtn, window.I18N.t("log_floor_reward_stonesword_key", { value: keyTotal }), obtainedStateKey());
      });
      container.appendChild(keyBtn);
      return;
    }

    if (entry.kind === "smithingStone" && entry.perPerson) {
      // 教會の商人：PC各自が任意で「ルーン：1」を消費し「鍛石」を1個獲得できる（1人につき最大1回）。
      // 従来は共有の1ボタンをGMが人数分クリックする運用だったが、各PCが自分のルーンを使う操作
      // なので、キャラクターごとに独立したボタンにする。
      var stoneCost = 1;
      entered.forEach(function (c) {
        var personStoneBtn = document.createElement("button");
        personStoneBtn.type = "button";
        personStoneBtn.textContent = window.I18N.t("floor_reward_smithing_stone_merchant_button", { name: c.name, cost: stoneCost });
        var canAfford = (c.runes || 0) >= stoneCost;
        if (isAlreadyObtained(c.id)) {
          personStoneBtn.disabled = true;
          personStoneBtn.classList.add("field-reward-obtained");
        } else if (!canAfford) {
          personStoneBtn.disabled = true;
          personStoneBtn.title = window.I18N.t("floor_reward_smithing_stone_merchant_no_runes");
        }
        personStoneBtn.addEventListener("click", function () {
          if ((c.runes || 0) < stoneCost || isAlreadyObtained(c.id)) return;
          c.runes -= stoneCost;
          window.PriTestNightCore.state.smithingStoneCount = (window.PriTestNightCore.state.smithingStoneCount || 0) + 1;
          window.PriTestNightCore.saveRosterCharacters();
          window.PriTestNightCore.renderCharacterRoster();
          window.PriTestNightCore.renderSmithingStoneCount();
          window.PriTestNightLog("log_floor_reward_smithing_stone_merchant", { character: c.name, cost: stoneCost });
          window.PriTestNightCore.markFloorRewardObtained(
            personStoneBtn,
            window.I18N.t("log_floor_reward_smithing_stone_merchant", { character: c.name, cost: stoneCost }),
            obtainedStateKey(c.id)
          );
        });
        container.appendChild(personStoneBtn);
      });
      if (noteText) {
        var stoneNoteP = document.createElement("p");
        stoneNoteP.className = "threat-ref-body";
        stoneNoteP.textContent = noteText;
        container.appendChild(stoneNoteP);
      }
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
      if (isAlreadyObtained()) {
        stoneBtn.disabled = true;
        stoneBtn.classList.add("field-reward-obtained");
      }
      stoneBtn.addEventListener("click", function () {
        window.PriTestNightCore.state.smithingStoneCount = (window.PriTestNightCore.state.smithingStoneCount || 0) + stoneTotal;
        window.PriTestNightCore.saveState();
        window.PriTestNightCore.renderSmithingStoneCount();
        window.PriTestNightLog("log_floor_reward_smithing_stone", { value: stoneTotal });
        window.PriTestNightCore.markFloorRewardObtained(stoneBtn, window.I18N.t("log_floor_reward_smithing_stone", { value: stoneTotal }), obtainedStateKey());
      });
      container.appendChild(stoneBtn);
      return;
    }

    if (entry.kind === "potentialPower") {
      // 1人ずつ独立したボタンにする：押した瞬間にそのキャラクター専用の「潜在する力」
      // モーダルを開き（★数を引き継ぐ）、実際の抽選・確定はそちらのモーダルで行う。
      entered.forEach(function (c) {
        // 獎勵清單が長くなりすぎる問題（#1）もあるため、ボタン自体のラベルは
        // 「【角色名稱】全員獲得潛力：★×N」の短い形に留め、フロア個別の補足（noteText）は
        // 別行のグレーテキストへ分離する（#12）。
        var ppBtn = document.createElement("button");
        ppBtn.type = "button";
        ppBtn.textContent = window.I18N.t("floor_reward_potential_power_button", { value: entry.value, character: c.name });
        if (isAlreadyObtained(c.id)) {
          ppBtn.disabled = true;
          ppBtn.classList.add("field-reward-obtained");
        }
        ppBtn.addEventListener("click", function () {
          window.PriTestNightLog("log_floor_reward_potential_power_note", { names: c.name });
          minimizeFloorRewardModal();
          window.PriTestNightPotentialPower.openPotentialPowerModal(c.id, entry.value, resolvedAttributeTag, function () {
            window.PriTestNightCore.markFloorRewardObtained(
              ppBtn,
              window.I18N.t("log_floor_reward_potential_power_note", { names: c.name }),
              obtainedStateKey(c.id)
            );
          });
        });
        container.appendChild(ppBtn);
        if (noteText) {
          var ppNoteP = document.createElement("p");
          ppNoteP.className = "threat-ref-body";
          ppNoteP.textContent = window.I18N.t("floor_reward_potential_power_note") + noteText;
          container.appendChild(ppNoteP);
        }
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
          window.PriTestNightCore.openWeaponSkillRerollModal(c.id, function () {
            window.PriTestNightCore.markFloorRewardObtained(
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
        window.PriTestNightLog("log_floor_reward_tiered_choice", { tier: tierLabelText });
        window.PriTestNightCore.markFloorRewardObtained(tierConfirmBtn, window.I18N.t("log_floor_reward_tiered_choice", { tier: tierLabelText }));
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
        window.PriTestNightLog("log_floor_reward_dice_hand", { dice: values.join("、"), hand: handLabelText });
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
        window.PriTestNightLog("log_floor_reward_bargain", { character: target ? target.name : "", deal: dealLabelText });
        window.PriTestNightCore.markFloorRewardObtained(confirmBtn, window.I18N.t("log_floor_reward_bargain", { character: target ? target.name : "", deal: dealLabelText }));
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
    var reward = (floor && floor.reward) || [];
    // 本文（lines[]）に「擊破盧恩：N」の記述があるのに、reward配列側にrune種別の項目が
    // 用意されていない（＝規則書の記述とボタンがズレている）場合を検出する。reward配列自体が
    // 空のフロアでも、この検出だけで報酬欄を出せるようにする（#9）。
    var hasRuneReward = reward.some(function (entry) {
      return entry.kind === "rune";
    });
    var detectedRuneAmount = !hasRuneReward ? parseRuneAmountFromText(floorLineText(floor)) : 0;
    if (!reward.length && !detectedRuneAmount) return;
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;

    var title = document.createElement("h5");
    title.textContent = window.I18N.t("floor_reward_title");
    container.appendChild(title);

    reward.forEach(function (entry, entryIndex) {
      renderFloorRewardOption(container, entry, entered, floor.__rewardKey, entryIndex);
    });
    if (detectedRuneAmount) {
      var detectedKey = floor.__rewardKey ? floor.__rewardKey + "_detectedRune" : null;
      appendRuneGrantRowIfDetected(container, "擊破盧恩：" + detectedRuneAmount, detectedKey);
    }
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
    document.getElementById("btn-breakthrough-restore").hidden = true;
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
    document.getElementById("btn-breakthrough-restore").hidden = true;
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
    document.getElementById("btn-breakthrough-restore").hidden = true;
  }

  // 規則書の通常セッション認証とは別に、揭曉のたびに必ずパスワードを再要求する
  // （既にセッション認証済みでも、目標値の閲覧は毎回明示的な確認を必要とするため）。
  // 攀登判定（mode:"climb"）はGMの秘密ではないため、このパスワード確認は樓層突破判定
  // （mode:"floor"）のときだけ行う。
  function checkBreakthroughRevealPassword() {
    var input = window.prompt(window.I18N.t("rulebook_password_prompt"));
    return input === window.PriTestNightCore.RULEBOOK_PASSWORD;
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
    document.getElementById("btn-breakthrough-restore").hidden = true;
    breakthroughState = null;
  }

  // 縮小/復元は他のモーダル(獎勵清單・抽選等)と同じ「モーダルを隠す＋別のスタッキング型
  // 固定ボタンを表示」方式。判定發生は目標揭曉前・揭曉後（結果発表）のどちらの状態でも
  // 同じモーダルを縮小するだけなので、専用の分岐は不要。
  function minimizeBreakthroughModal() {
    document.getElementById("breakthrough-modal").hidden = true;
    document.getElementById("btn-breakthrough-restore").hidden = false;
  }

  function restoreBreakthroughModal() {
    document.getElementById("btn-breakthrough-restore").hidden = true;
    document.getElementById("breakthrough-modal").hidden = false;
    renderBreakthroughCharacters();
  }

  var CHECK_STAT_KEYS = { luck: "luck", physical: "physical", mental: "mental" };

  // 遺物効果「學習能力（精神／運氣／體能）」：type.checkValues[statKey]（判定骰數の基本値）に
  // 個別キャラの習得済み+1補正を上乗せする。3箇所（実際に振る・ボタン表示・振った後の内訳表示）で
  // 同じ計算を使うため共通化する。
  function effectiveCheckValue(c, type, statKey) {
    var base = type && statKey ? type.checkValues[statKey] || 0 : 0;
    var bonus = c && CharacterDrawer.getCheckStatBonus ? CharacterDrawer.getCheckStatBonus(c, statKey) : 0;
    return Math.max(0, base + bonus);
  }

  function rollBreakthroughDice(charId, statKey) {
    var c = window.PriTestNightCore.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    if (!type || !statKey || !CHECK_STAT_KEYS[statKey]) return;
    var count = effectiveCheckValue(c, type, statKey);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    breakthroughState.characters[charId] = { stat: statKey, dice: dice, rerollPending: false };
    renderBreakthroughCharacters();
  }

  function useBreakthroughBlessing(charId) {
    var c = window.PriTestNightCore.getRosterCharacters().filter(function (rc) {
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
    window.PriTestNightCore.saveRosterCharacters();
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
    // 判定属性（全体選択）はGM限定操作：玩家回合中は変更不可にする（GM回合中に戻れば再び
    // 変更可能）。ただし攀登判定（固定：體能）や揭曉後は、それぞれ元から常時disabledのため
    // ここでは触らない（誤って再有効化しないよう対象外にする）。
    var globalStatSelectEl = document.getElementById("breakthrough-stat-select");
    if (breakthroughState.mode !== "climb" && !breakthroughState.revealed) {
      globalStatSelectEl.disabled = !!(window.PriTestTurnHolder && window.PriTestTurnHolder() !== "gm");
    }
    var globalStat = globalStatSelectEl.value;
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
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
        var count = type && CHECK_STAT_KEYS[statKey] ? effectiveCheckValue(c, type, statKey) : 0;
        rollBtn.textContent = window.I18N.t("breakthrough_roll_button_with_count", { count: count });
      }
      updateRollBtnLabel();
      if (statSelect) statSelect.addEventListener("change", updateRollBtnLabel);
      // 1度振ったら再ロック（振り直し不可）。以後は加護重骰（1個だけ振り直し可能）のみで対応する。
      rollBtn.disabled = !!breakthroughState.characters[c.id];
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
          count: effectiveCheckValue(c, type, entry.stat),
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

    // 建議高亮（半自動：算出は自動、確定は人間）。ダイス合計と目標値を比較して合格/失敗の
    // どちらかをCSSで強調するだけで、自動クリックはしない——GMが意図的に逆を選ぶ余地を残す。
    var passBtn = document.getElementById("btn-breakthrough-pass");
    var failBtn = document.getElementById("btn-breakthrough-fail");
    passBtn.classList.remove("gm-flow-suggested");
    failBtn.classList.remove("gm-flow-suggested");
    if (breakthroughState.revealed) {
      if (breakthroughDiceSum() >= actualTarget) {
        passBtn.classList.add("gm-flow-suggested");
      } else {
        failBtn.classList.add("gm-flow-suggested");
      }
    }
  }

  function computeBreakthroughActualTarget() {
    var target = Number(document.getElementById("breakthrough-target-input").value) || 0;
    var perPC = document.getElementById("breakthrough-perpc-checkbox").checked;
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    return perPC ? target * entered.length : target;
  }

  // 判定發生／攀登判定／樓層突破判定いずれも、結果をログ(window.PriTestNightCore.state.log)に残すだけでなく、
  // 同じ文言をGM留言板(window.PriTestNightCore.state.turnMessages)にも自動投稿する（GM留言と同じ表示形式で
  // 「GM:」接頭辞・黄字になる）。addLogに渡すのと全く同じi18nキー・paramsを使うことで、
  // ログと留言板の文言が食い違わないようにする。
  function pushBreakthroughSummaryMessage(key, params) {
    window.PriTestNightCore.state.turnMessages.push({ text: window.I18N.t(key, params), time: Date.now(), side: "gm" });
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderTurnHolderBar();
  }

  function resolveBreakthroughCheck(passed) {
    if (!breakthroughState) return;
    var sum = breakthroughDiceSum();
    var actualTarget = computeBreakthroughActualTarget();
    if (breakthroughState.mode === "climb") {
      var moveTarget = breakthroughState.moveTarget;
      closeBreakthroughModal();
      if (passed) window.PriTestNightCore.finalizeSlotMove(moveTarget);
      if (typeof moveTarget === "number") {
        var climbKey = passed ? "log_climb_check_pass" : "log_climb_check_fail";
        var climbParams = { slot: moveTarget + 1, sum: sum, target: actualTarget };
        window.PriTestNightLog(climbKey, climbParams);
        pushBreakthroughSummaryMessage(climbKey, climbParams);
      } else {
        var climbPileKey = passed ? "log_climb_check_pass_pile" : "log_climb_check_fail_pile";
        var climbPileParams = {
          place: window.I18N.t(moveTarget === "start" ? "start_point_label" : "end_point_label"),
          sum: sum,
          target: actualTarget,
        };
        window.PriTestNightLog(climbPileKey, climbPileParams);
        pushBreakthroughSummaryMessage(climbPileKey, climbPileParams);
      }
      return;
    }
    if (breakthroughState.mode === "generic") {
      closeBreakthroughModal();
      var genericKey = passed ? "log_generic_check_pass" : "log_generic_check_fail";
      var genericParams = { sum: sum, target: actualTarget };
      window.PriTestNightLog(genericKey, genericParams);
      pushBreakthroughSummaryMessage(genericKey, genericParams);
      return;
    }
    var index = breakthroughState.slotIndex;
    if (passed) window.PriTestNightCore.stepCardLevel(index, 1);
    var floorKey = passed ? "log_breakthrough_check_pass" : "log_breakthrough_check_fail";
    var floorParams = { slot: index + 1, sum: sum, target: actualTarget };
    window.PriTestNightLog(floorKey, floorParams);
    pushBreakthroughSummaryMessage(floorKey, floorParams);
    closeBreakthroughModal();
  }

  window.PriTestNightFloorBreakthrough = {
    resolveFieldEntryForSlot: resolveFieldEntryForSlot,
    openFloorRewardModal: openFloorRewardModal,
    closeFloorRewardModal: closeFloorRewardModal,
    minimizeFloorRewardModal: minimizeFloorRewardModal,
    restoreFloorRewardModal: restoreFloorRewardModal,
    grantRuneToAllEntered: grantRuneToAllEntered,
    floorHasAnyReward: floorHasAnyReward,
    appendRuneGrantRowIfDetected: appendRuneGrantRowIfDetected,
    renderFloorRewardSection: renderFloorRewardSection,
    openBreakthroughModal: openBreakthroughModal,
    openClimbingCheckModal: openClimbingCheckModal,
    openGenericCheckModal: openGenericCheckModal,
    revealBreakthroughTarget: revealBreakthroughTarget,
    closeBreakthroughModal: closeBreakthroughModal,
    minimizeBreakthroughModal: minimizeBreakthroughModal,
    restoreBreakthroughModal: restoreBreakthroughModal,
    renderBreakthroughCharacters: renderBreakthroughCharacters,
    resolveBreakthroughCheck: resolveBreakthroughCheck,
    getFloorRewardModalFloor: function () { return floorRewardModalFloor; },
    effectiveCheckValue: effectiveCheckValue,
    parseBreakthroughCheckText: parseBreakthroughCheckText,
  };
})();
