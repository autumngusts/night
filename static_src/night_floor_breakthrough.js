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
  // 使用者確認（バグ報告：連續進入兩張同名卡牌，第二張沒有發到獎勵）：floor.__rewardKey は
  // night_rulebook.js の renderFieldCard がカード定義（規則書表示用、盤面のどのマスかとは
  // 無関係）を描画する際に1回だけ設定する共有プロパティのため、地図上に同じ rank（例：K）の
  // カードが複数マスへ同時に存在する場合、両方が同じ floor オブジェクト参照＝同じ
  // __rewardKey を共有してしまう。1枚目で獲得済みフラグ（state.floorRewardObtained）が
  // 立つと、2枚目でも「既に獲得済み」と誤判定されて獎勵が発放されなくなる。
  // floor自体（共有オブジェクト）は書き換えず、代わりにこのモーダルを開いた時点の
  // slotIndex を別途保持し、実際に使う「獲得済みキー」はrewardKeyBase()経由で
  // slotIndex接頭辞を付けたものを使う（同じ floor でもマスが違えば別キーになる）。
  var floorRewardModalSlotIndex = null;

  function rewardKeyBase(floor) {
    var base = (floor && floor.__rewardKey) || "floor";
    return typeof floorRewardModalSlotIndex === "number" ? "slot" + floorRewardModalSlotIndex + "_" + base : base;
  }

  function openFloorRewardModal(floor, slotIndex) {
    floorRewardModalSlotIndex = typeof slotIndex === "number" ? slotIndex : null;
    var Core = window.PriTestNightCore;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var lootObjs = floorAutoLootTurnRewards(floor, entered);
    // 規則書ブラウズ経由（night_rulebook.jsの「獲得」ボタン）で呼ばれた場合、戦利品だけの
    // フロアはこの下で早期returnするため、規則書を閉じたままにするとGM側に何も残らない
    // （行動ログしか手掛かりが無い）。閉じる前の表示状態を控えておき、早期return時だけ戻す。
    var rulebookModal = document.getElementById("rulebook-modal");
    var rulebookWasVisible = !!(rulebookModal && !rulebookModal.hidden);
    if (rulebookModal) rulebookModal.hidden = true;
    if (lootObjs.length) {
      Core.pushTurnRewards(lootObjs);
      window.PriTestNightLog("log_floor_reward_auto_pushed", {
        items: lootObjs
          .map(function (r) {
            return window.I18N.t("turn_reward_kind_" + r.kind);
          })
          .join("、"),
      });
    }
    // 呼び出し元（night_gm_flow.jsのhandleFloorEndRewardClick）が「獎勵清單を開くべきか」
    // 「樓層獎勵ゲート（pendingRewardWindows）を追跡すべきか」を判定できるよう、何が
    // 起きたかを返す。night_rulebook.jsの既存呼び出しは戻り値を使わないため無変更で動く。
    var hasJudgment = floorHasJudgmentReward(floor);
    if (!hasJudgment) {
      if (rulebookWasVisible && rulebookModal) rulebookModal.hidden = false;
      return { lootPushed: lootObjs.length > 0, judgmentModalOpened: false };
    }
    floorRewardModalFloor = floor;
    document.getElementById("floor-reward-modal").hidden = false;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floor);
    return { lootPushed: lootObjs.length > 0, judgmentModalOpened: true };
  }

  function closeFloorRewardModal() {
    document.getElementById("floor-reward-modal").hidden = true;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    floorRewardModalFloor = null;
    floorRewardModalSlotIndex = null;
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

  function restoreFloorRewardModalIfMinimized() {
    var restoreBtn = document.getElementById("btn-floor-reward-restore");
    if (restoreBtn && !restoreBtn.hidden) restoreFloorRewardModal();
  }

  // 魔術師塔の解封等、実際にPCが振った複数個のダイス目から役を自動判定するケース向けの専用
  // モーダル。floor-reward-modalとは独立した開閉/縮小/復元状態を持つ（診断済みの役の報酬は
  // floorRewardEntryToTurnRewards経由で獎勵清單へpushし、floor-reward-modal側の再描画には頼らない）。
  var diceHandDrawEntry = null; // { entry, entered } — 縮小/復元のために保持
  var diceHandDrawSelects = [];

  function buildDiceHandDrawSelects(diceCount) {
    var group = document.getElementById("dice-hand-draw-select-group");
    group.innerHTML = "";
    diceHandDrawSelects = [];
    for (var i = 0; i < diceCount; i++) {
      var dieSelect = document.createElement("select");
      dieSelect.className = "dice-hand-die-select";
      [1, 2, 3, 4, 5, 6].forEach(function (v) {
        var opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = String(v);
        dieSelect.appendChild(opt);
      });
      diceHandDrawSelects.push(dieSelect);
      group.appendChild(dieSelect);
    }
  }

  function judgeDiceHand(entry, values) {
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
    return (entry.hands || []).filter(function (h) {
      return h.id === matchedId;
    })[0] || null;
  }

  function openDiceHandDrawModal(entry, entered) {
    diceHandDrawEntry = { entry: entry, entered: entered };
    var diceCount = entry.diceCount || 12;
    document.getElementById("dice-hand-draw-label").textContent = window.I18N.t("floor_reward_dice_hand_label", { count: diceCount });
    buildDiceHandDrawSelects(diceCount);
    document.getElementById("dice-hand-draw-result").textContent = "";
    document.getElementById("dice-hand-draw-result-list").innerHTML = "";
    document.getElementById("btn-dice-hand-draw-judge").disabled = false;
    document.getElementById("dice-hand-draw-modal").hidden = false;
    document.getElementById("btn-dice-hand-draw-restore").hidden = true;
    window.PriTestDrawStateSync.set("diceHandDraw", { minimized: false });
  }

  function closeDiceHandDrawModal() {
    document.getElementById("dice-hand-draw-modal").hidden = true;
    document.getElementById("btn-dice-hand-draw-restore").hidden = true;
    diceHandDrawEntry = null;
    window.PriTestDrawStateSync.set("diceHandDraw", null);
    restoreFloorRewardModalIfMinimized();
  }

  // 使用者確認：縮小状態は全端末で連動表示させるが（state.activeDraws.diceHandDraw）、
  // 進行中のentry（floor.rewardの参照）自体はこの端末のローカルにしか無いため、他端末で
  // 還元ボタンを押しても実際の内容は復元できない（restoreDiceHandDrawModal側でガードする）。
  function minimizeDiceHandDrawModal() {
    document.getElementById("dice-hand-draw-modal").hidden = true;
    document.getElementById("btn-dice-hand-draw-restore").hidden = false;
    window.PriTestDrawStateSync.set("diceHandDraw", { minimized: true });
  }

  function restoreDiceHandDrawModal() {
    if (!diceHandDrawEntry) {
      window.alert(window.I18N.t("remote_restore_unavailable_note"));
      return;
    }
    document.getElementById("btn-dice-hand-draw-restore").hidden = true;
    document.getElementById("dice-hand-draw-modal").hidden = false;
    window.PriTestDrawStateSync.set("diceHandDraw", { minimized: false });
  }

  function handleDiceHandDrawRandom() {
    diceHandDrawSelects.forEach(function (s) {
      s.value = String(1 + Math.floor(Math.random() * 6));
    });
  }

  function handleDiceHandDrawJudge() {
    if (!diceHandDrawEntry) return;
    var values = diceHandDrawSelects.map(function (s) {
      return parseInt(s.value, 10);
    });
    var matchedHand = judgeDiceHand(diceHandDrawEntry.entry, values);
    diceHandDrawSelects.forEach(function (s) {
      s.disabled = true;
    });
    document.getElementById("btn-dice-hand-draw-judge").disabled = true;
    var handLabelText = matchedHand ? window.PriTestFields.localizedText(matchedHand.label) : window.I18N.t("floor_reward_dice_hand_result_none");
    document.getElementById("dice-hand-draw-result").textContent = window.I18N.t("floor_reward_dice_hand_result", { dice: values.join("、"), hand: handLabelText });
    window.PriTestNightLog("log_floor_reward_dice_hand", { dice: values.join("、"), hand: handLabelText });
    if (matchedHand) {
      var pushed = [];
      // 役判定は判定ボタンが一度きり（disabled化）で、state.floorRewardObtainedへ
      // 永続フラグを立てない経路のため、sourceFloorRewardKey（＝放棄時に消すフラグの
      // 参照先）は持たせない。消すべきフラグがそもそも存在しない。
      (matchedHand.rewards || []).forEach(function (sub, subIndex) {
        pushed = pushed.concat(floorRewardEntryToTurnRewards(sub, diceHandDrawEntry.entered, "diceHand_" + Date.now() + "_" + subIndex));
      });
      if (pushed.length) {
        window.PriTestNightCore.pushTurnRewards(pushed);
        window.PriTestNightLog("log_floor_reward_auto_pushed", {
          items: pushed
            .map(function (r) {
              return window.I18N.t("turn_reward_kind_" + r.kind);
            })
            .join("、"),
        });
      }
      var resultList = document.getElementById("dice-hand-draw-result-list");
      var resultP = document.createElement("p");
      resultP.className = "threat-ref-body";
      resultP.textContent = window.I18N.t("log_floor_reward_auto_pushed", {
        items: pushed
          .map(function (r) {
            return window.I18N.t("turn_reward_kind_" + r.kind);
          })
          .join("、"),
      });
      resultList.appendChild(resultP);
    }
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

  // 「戦利品」種別：GMの分岐選択を伴わず、確定した瞬間にそのまま獎勵清單
  // （state.turnRewards）へpushしてよい種類。残り（hpDamage/tieredChoice/diceHandChoice/
  // bargainReveal/note）はGM判断が必要なため、従来通りfloor-reward-modal内で解決する。
  var LOOT_REWARD_KINDS = [
    "rune",
    "weaponStar",
    "consumable",
    "talisman",
    "potentialPower",
    "stoneswordKey",
    "smithingStone",
    "chaliceBonus",
    "weaponSkillReroll",
  ];
  function isLootRewardKind(kind) {
    return LOOT_REWARD_KINDS.indexOf(kind) !== -1;
  }

  // isLootRewardKindだけではkind単位でしか判定できないが、smithingStoneは同じkindでも
  // perPerson: true（教會の商人：PC各自がルーンを消費して個別に選び取る）の場合だけ例外的に
  // GM判断（＝手動UI）へ回す必要がある（他のPC任意目標系kindと違い、個人のルーン消費という
  // コストチェックを伴う選択のため、獎勵清單の共有カウンター/任意対象という仕組みに載らない）。
  // stoneswordKeyには現状perPerson:trueのデータが存在しない（fields_data_*.js確認済み）ため、
  // ここではsmithingStoneのみ例外扱いする。
  function isLootRewardEntry(entry) {
    if (!isLootRewardKind(entry.kind)) return false;
    if (entry.kind === "smithingStone" && entry.perPerson) return false;
    return true;
  }

  function floorHasJudgmentReward(floor) {
    var reward = (floor && floor.reward) || [];
    return reward.some(function (entry) {
      return !isLootRewardEntry(entry);
    });
  }

  var turnRewardIdCounter = 0;
  function makeTurnRewardId(suffix) {
    turnRewardIdCounter++;
    return "tr" + Date.now() + "_" + turnRewardIdCounter + "_" + suffix;
  }

  // floor.rewardの「戦利品」エントリ1件を、state.turnRewardsへpushする1件以上の
  // オブジェクトへ変換する（実際のpushはfloorAutoLootTurnRewards/pushTurnRewardsが行う）。
  // sourceKeyを渡すと、生成した各項目へsourceFloorRewardKeyとして刻む。獎勵清單を
  // 「未獲得のまま閉じる（＝放棄）」した際、night.js側がこのキーを見てstate.floorRewardObtained
  // の対応フラグも消し、同じフロアを開き直せば再pushできる状態へ戻せるようにするため
  // （マーカーが無いと、一度きりpush方式のせいで自動戦利品が永久に失われる）。
  function floorRewardEntryToTurnRewards(entry, entered, idSuffix, sourceKey) {
    var objs = buildFloorRewardTurnRewards(entry, entered, idSuffix);
    if (sourceKey) {
      objs.forEach(function (o) {
        o.sourceFloorRewardKey = sourceKey;
      });
    }
    return objs;
  }

  function buildFloorRewardTurnRewards(entry, entered, idSuffix) {
    var Core = window.PriTestNightCore;
    if (entry.kind === "rune" || entry.kind === "chaliceBonus") {
      return [
        {
          id: makeTurnRewardId(idSuffix),
          kind: entry.kind,
          targetCharacterId: Core.TURN_REWARD_SHARED_TARGET_VALUE,
          value: entry.value,
          claimed: false,
        },
      ];
    }
    if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
      var total = entry.perParty ? entry.value * entered.length : entry.value;
      return [{ id: makeTurnRewardId(idSuffix), kind: entry.kind, targetCharacterId: null, value: total, claimed: false }];
    }
    if (entry.kind === "potentialPower" || entry.kind === "weaponSkillReroll") {
      // 修正（ユーザー報告）：valueが2以上（例：「潛在之力★★」）の場合、以前は1人につき
      // 1件（value:2以上）にまとめていたため、獎勵清單上では1回分の抽選ウィザードの中で
      // まとめて処理され、個別に確認・選択できなかった。consumable/talismanと同じ
      // 「1件＝1回分」の方針に合わせ、1人あたりvalue個の独立した項目（value:1）に分割する。
      var perPersonDraws = entry.value || 1;
      var objs = [];
      entered.forEach(function (c, i) {
        for (var vi = 0; vi < perPersonDraws; vi++) {
          objs.push({
            id: makeTurnRewardId(idSuffix + "_" + i + "_" + vi),
            kind: entry.kind,
            targetCharacterId: c.id,
            value: 1,
            attributeTag: entry.attributeTag || null,
            claimed: false,
          });
        }
      });
      return objs;
    }
    if (entry.kind === "weaponStar") {
      return [
        {
          id: makeTurnRewardId(idSuffix),
          kind: "weapon",
          targetCharacterId: Core.TURN_REWARD_ANY_TARGET_VALUE,
          value: entry.value,
          categoryId: entry.categoryId || null,
          attributeTag: entry.attributeTag || null,
          claimed: false,
        },
      ];
    }
    if (entry.kind === "consumable" || entry.kind === "talisman") {
      // 第2項：規則書が「N個」を明記している場合、獎勵清單上は1個ずつ独立した項目に
      // 分割する（1件にまとめてしまうと、本来別々に抽選されるべきアイテムが同一の結果に
      // なってしまう。手動追加フォーム側のhandleTurnRewardAddと同じ方針）。itemId指定
      // （品名固定、第1項）の場合は常に1個扱いで、値の分割対象にはならない。
      var itemCount = entry.itemId ? 1 : entry.value || 1;
      var arr = [];
      for (var vi = 0; vi < itemCount; vi++) {
        var obj = {
          id: makeTurnRewardId(idSuffix + "_" + vi),
          kind: entry.kind,
          targetCharacterId: Core.TURN_REWARD_ANY_TARGET_VALUE,
          value: 1,
          claimed: false,
        };
        if (entry.itemId) {
          obj.itemId = entry.itemId;
          if (entry.attributeTag) obj.attributeTag = entry.attributeTag;
        }
        arr.push(obj);
      }
      return arr;
    }
    return [];
  }

  // tieredChoice/diceHandChoiceエントリの各tier/handのrewards配列を平坦化し、その中に
  // rune種別が1つでもあるかを調べる（トップレベルのhasRuneRewardでは検出できない、
  // 「段階/役ごとの分岐先にrune報酬がある」ケースを判定するため）。例：封牢(森)は3つの
  // tierすべてにrune（3／11／3）を持つ、教会の「6＝強敵の予感」tierはrune:8を持つ、と
  // いった具合にすでに正しく実装済みのフロアがあり、これらをconditionalRuneReminderの
  // 誤検知（false positive）にしないために必要。
  function floorConditionalRewardHasNestedRune(reward) {
    return reward.some(function (entry) {
      if (entry.kind === "tieredChoice") {
        return (entry.tiers || []).some(function (tier) {
          return (tier.rewards || []).some(function (r) {
            return r.kind === "rune";
          });
        });
      }
      if (entry.kind === "diceHandChoice") {
        return (entry.hands || []).some(function (hand) {
          return (hand.rewards || []).some(function (r) {
            return r.kind === "rune";
          });
        });
      }
      return false;
    });
  }

  // フロア終端で確定している「戦利品」を一括で獎勵清單へ積む配列を組み立てる。reward配列に
  // rune種別が無いのに本文に「擊破盧恩：N」がある（規則書の記述とデータのズレ）場合は、
  // フォールバック検出分もあわせて積む。二重pushは__rewardKeyベースのフラグで防ぐ。
  function floorAutoLootTurnRewards(floor, entered) {
    // 誰も入場していない状態（例：規則書の閲覧だけでopenFloorRewardModalが呼ばれた場合）で
    // 呼ばれた場合は何もpushしない。ここでstate.floorRewardObtainedへ既読フラグを立てて
    // しまうと、perParty分がentered.length===0で0確定→以後実際に入場しても二度と
    // pushされなくなる（一度きりpush方式のため）。よってstateには一切触れず即座に空配列を返す。
    if (!entered || !entered.length) return [];
    var Core = window.PriTestNightCore;
    var reward = (floor && floor.reward) || [];
    var results = [];
    var hasRuneReward = reward.some(function (entry) {
      return entry.kind === "rune";
    });
    // 段階選択・ダイス役のフロアは、盧恩の額そのものが「どの段階／役になったか」で変わる
    // （例：封牢(森)の本文「撃破ルーン：3+8」は侵入者が出た場合のみ合計11、出なければ3）。
    // 本文からの合計値検出でフロア開始時に無条件push＝過剰／時期尚早な付与になるため、
    // これらのフロアではフォールバック検出を行わず、段階確定／役判定の経路だけでpushする。
    var hasConditionalReward = reward.some(function (entry) {
      return entry.kind === "tieredChoice" || entry.kind === "diceHandChoice";
    });
    var keyBase = rewardKeyBase(floor);
    reward.forEach(function (entry, entryIndex) {
      if (!isLootRewardEntry(entry)) return;
      var pushKey = keyBase + "_pushed_" + entryIndex;
      if (Core.state.floorRewardObtained && Core.state.floorRewardObtained[pushKey]) return;
      var objs = floorRewardEntryToTurnRewards(entry, entered, keyBase + "_" + entryIndex, pushKey);
      if (!objs.length) return;
      if (!Core.state.floorRewardObtained) Core.state.floorRewardObtained = {};
      Core.state.floorRewardObtained[pushKey] = true;
      results = results.concat(objs);
    });
    if (!hasRuneReward && !hasConditionalReward) {
      var detectedAmount = parseRuneAmountFromText(floorLineText(floor));
      if (detectedAmount) {
        var detectedKey = keyBase + "_detectedRune_pushed";
        var alreadyDetected = !!(Core.state.floorRewardObtained && Core.state.floorRewardObtained[detectedKey]);
        if (!alreadyDetected) {
          if (!Core.state.floorRewardObtained) Core.state.floorRewardObtained = {};
          Core.state.floorRewardObtained[detectedKey] = true;
          results.push({
            id: makeTurnRewardId(keyBase + "_detectedRune"),
            kind: "rune",
            targetCharacterId: Core.TURN_REWARD_SHARED_TARGET_VALUE,
            value: detectedAmount,
            claimed: false,
            sourceFloorRewardKey: detectedKey || null,
          });
        }
      }
    } else if (hasConditionalReward && !floorConditionalRewardHasNestedRune(reward)) {
      // hasConditionalRewardによりフォールバック検出（上のブロック）が抑止された場合、
      // card0_4_0／card2_4_0のように「本文には撃破ルーン：Nの記述があるのに、reward配列の
      // どのtieredChoice/diceHandChoiceの分岐（tiers[].rewards / hands[].rewards）にも
      // rune種別が1つも無い」フロアでは、盧恩がどの経路からも一切GMへ提示されない
      // “サイレント0”になってしまう。tieredChoice/diceHandChoice側のいずれかのtier/handに
      // rune分岐が実在するフロア（封牢(森)の3tierすべて、教会の「6＝強敵の予感」tierなど）は
      // floorConditionalRewardHasNestedRuneで検出でき、そちら経由で正しくpushされるので
      // 実害が無い＝リマインダー不要と判定して除外する。ただし「どのtier/handにも一致する
      // rune分岐が無い」ことの判定はあくまでkind==="rune"の存在チェックであり、額が本文の
      // 検出値と完全一致することまでは保証しない（tierの選び方次第で額が変わる設計は
      // 正当なので、ここでは存在有無のみを見る）。念のため、リマインダー文言自体は
      // 「対応する報酬が見つからない場合はGMが確認」という留保付きの表現にしてある。
      var conditionalAmount = parseRuneAmountFromText(floorLineText(floor));
      if (conditionalAmount) {
        var reminderKey = keyBase + "_conditionalRuneReminder_logged";
        var alreadyReminded = !!(Core.state.floorRewardObtained && Core.state.floorRewardObtained[reminderKey]);
        if (!alreadyReminded) {
          if (!Core.state.floorRewardObtained) Core.state.floorRewardObtained = {};
          Core.state.floorRewardObtained[reminderKey] = true;
          window.PriTestNightLog("log_floor_reward_conditional_rune_reminder", { amount: conditionalAmount });
        }
      }
    }
    return results;
  }

  // 検出した盧恩獎勵を、対象コンテナへ「數値入力（GMが微調整可）＋獲得ボタン」の1行として
  // 追加する。stateKeyを渡すとmarkFloorRewardObtainedと同じ仕組みで一度きりの獲得に制限する。
  // 注意：floor-reward-modal自体はfloorAutoLootTurnRewardsの自動検出に一本化されたためもう
  // 呼ばないが、night_rulebook.js（敵の規則書タブ、special/actions注釈からのルーン検出）が
  // 別経路でこの関数を呼び続けているため、削除しない。
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
      // 他の報酬と同じく、ロスターへ直接加算せず獎勵清單（state.turnRewards）を経由する
      // （実際の付与タイミング・対象の確認をGMが一覧上で行えるようにするため）。
      // ボタン自体の一度きりロック（markFloorRewardObtained）は従来どおり維持する。
      var runeObjs = [
        {
          id: makeTurnRewardId(stateKey || "runeGrantRow"),
          kind: "rune",
          targetCharacterId: window.PriTestNightCore.TURN_REWARD_SHARED_TARGET_VALUE,
          value: value,
          claimed: false,
          sourceFloorRewardKey: stateKey || null,
        },
      ];
      window.PriTestNightCore.pushTurnRewards(runeObjs);
      window.PriTestNightLog("log_floor_reward_auto_pushed", { items: window.I18N.t("turn_reward_kind_rune") });
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
    // 戦利品はopenFloorRewardModal内で自動的に獎勵清單へpush済みのため、ここには表示しない
    // （smithingStone×perPerson:trueは例外——コスト付きの個人選択が必要なためGM判断側に残る）。
    if (isLootRewardEntry(entry)) return;
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

    if (entry.kind === "smithingStone" && entry.perPerson) {
      // 教會の商人：PC各自が任意で「ルーン：1」を消費し「鍛石」を1個獲得できる（1人につき最大1回）。
      // 従来は共有の1ボタンをGMが人数分クリックする運用だったが、各PCが自分のルーンを使う操作
      // なので、キャラクターごとに独立したボタンにする。ルーン消費というコストチェックを伴う
      // 個人選択のため、獎勵清單の自動push（共有カウンター／任意対象）には載せずここに残す
      // （isLootRewardEntryがこのkind×perPersonの組み合わせだけを例外扱いしている）。
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
        // 段階内の報酬も、トップレベルのreward配列と同じ扱いにする：戦利品種別は
        // 獎勵清單へ直接push（renderFloorRewardOptionは戦利品を描画しないので、ここで
        // 再帰させると何も表示されず何も付与されない）、GM判断が要る種別だけ従来通り
        // この段階の結果欄へ描画する。二重pushはfloorKey＋段階index＋sub indexで防ぐ。
        var tierIndex = parseInt(tierSelect.value, 10);
        var tierPushed = [];
        (tier.rewards || []).forEach(function (sub, subIndex) {
          if (!isLootRewardEntry(sub)) {
            renderFloorRewardOption(tierResultContainer, sub, entered);
            return;
          }
          var subKeyBase = (floorKey || "floor") + "_" + (entryIndex === undefined ? "x" : entryIndex) + "_tier" + tierIndex + "_" + subIndex;
          var subPushKey = floorKey && entryIndex !== undefined ? subKeyBase + "_pushed" : null;
          if (subPushKey && window.PriTestNightCore.state.floorRewardObtained && window.PriTestNightCore.state.floorRewardObtained[subPushKey]) return;
          var subObjs = floorRewardEntryToTurnRewards(sub, entered, subKeyBase, subPushKey);
          if (!subObjs.length) return;
          if (subPushKey) {
            if (!window.PriTestNightCore.state.floorRewardObtained) window.PriTestNightCore.state.floorRewardObtained = {};
            window.PriTestNightCore.state.floorRewardObtained[subPushKey] = true;
          }
          tierPushed = tierPushed.concat(subObjs);
        });
        if (tierPushed.length) {
          window.PriTestNightCore.pushTurnRewards(tierPushed);
          var tierPushedItems = tierPushed
            .map(function (r) {
              return window.I18N.t("turn_reward_kind_" + r.kind);
            })
            .join("、");
          window.PriTestNightLog("log_floor_reward_auto_pushed", { items: tierPushedItems });
          var tierPushedP = document.createElement("p");
          tierPushedP.className = "threat-ref-body";
          tierPushedP.textContent = window.I18N.t("log_floor_reward_auto_pushed", { items: tierPushedItems });
          tierResultContainer.appendChild(tierPushedP);
        }
      });
      tieredRow.appendChild(tierConfirmBtn);
      container.appendChild(tieredRow);
      container.appendChild(tierResultContainer);
      return;
    }

    if (entry.kind === "diceHandChoice") {
      var diceHandRow = document.createElement("div");
      diceHandRow.className = "wb-row";
      var diceHandBtn = document.createElement("button");
      diceHandBtn.type = "button";
      diceHandBtn.className = "primary-btn";
      diceHandBtn.textContent = window.I18N.t("floor_reward_dice_hand_label", { count: entry.diceCount || 12 }) + noteText;
      diceHandBtn.addEventListener("click", function () {
        minimizeFloorRewardModal();
        openDiceHandDrawModal(entry, entered);
      });
      diceHandRow.appendChild(diceHandBtn);
      container.appendChild(diceHandRow);
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
    if (!floorHasJudgmentReward(floor)) return;
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;

    var title = document.createElement("h5");
    title.textContent = window.I18N.t("floor_reward_title");
    container.appendChild(title);

    ((floor && floor.reward) || []).forEach(function (entry, entryIndex) {
      renderFloorRewardOption(container, entry, entered, rewardKeyBase(floor), entryIndex);
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
    window.PriTestDrawStateSync.set("breakthrough", { minimized: false });
    document.getElementById("breakthrough-modal-title").textContent = window.I18N.t("breakthrough_modal_title");
    document.getElementById("breakthrough-import-row").hidden = false;
    // 目標點數・PC人數倍のチェックは揭曉するまで非表示（GMも含め、揭曉ボタンを押すまでは
    // 誰の目にも触れないようにする）。判定属性（stat-select）は骰子を振るために必要な情報
    // なので、こちらは常に表示する。
    document.getElementById("breakthrough-target-hideable").hidden = true;
    // 第2項：自動化下の突破判定は目標値を一切表示しない（行為判定と同じ方針）——
    // 揭曉ボタン自体を隠し、target-hideable区塊が開く経路を無くす（GMが規則書と
    // 照らし合わせたい場合は規則書パネルを別途参照する）。
    document.getElementById("btn-breakthrough-reveal").hidden = true;
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
    window.PriTestDrawStateSync.set("breakthrough", { minimized: false });
    document.getElementById("breakthrough-modal-title").textContent = window.I18N.t("climb_check_modal_title");
    document.getElementById("breakthrough-import-row").hidden = true;
    document.getElementById("breakthrough-target-hideable").hidden = true;
    // 第2項：登攀判定も目標値を表示しない（従来はGMの秘密ではないという理由で揭曉ボタンに
    // パスワードは不要としていたが、自動化下では行為判定/突破判定と同じく一切表示しない）。
    document.getElementById("btn-breakthrough-reveal").hidden = true;
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
    window.PriTestDrawStateSync.set("breakthrough", { minimized: false });
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
    window.PriTestDrawStateSync.set("breakthrough", null);
  }

  // 縮小/復元は他のモーダル(獎勵清單・抽選等)と同じ「モーダルを隠す＋別のスタッキング型
  // 固定ボタンを表示」方式。判定發生は目標揭曉前・揭曉後（結果発表）のどちらの状態でも
  // 同じモーダルを縮小するだけなので、専用の分岐は不要。
  // 使用者確認：縮小状態は全端末で連動表示させる（state.activeDraws.breakthrough）が、
  // 進行中の骰子（breakthroughState）自体はこの端末のローカルにしか無いため、他端末で
  // 還元ボタンを押しても実際の内容は復元できない（restoreBreakthroughModal側でガードする）。
  function minimizeBreakthroughModal() {
    document.getElementById("breakthrough-modal").hidden = true;
    document.getElementById("btn-breakthrough-restore").hidden = false;
    window.PriTestDrawStateSync.set("breakthrough", { minimized: true });
  }

  function restoreBreakthroughModal() {
    if (!breakthroughState) {
      // 開いた本人の端末ではない：復元できる内容が無いので、その旨を伝えるだけに留める
      // （他の縮小系モーダルと同じ「本人の端末へ戻って操作してほしい」案内）。
      window.alert(window.I18N.t("remote_restore_unavailable_note"));
      return;
    }
    document.getElementById("btn-breakthrough-restore").hidden = true;
    document.getElementById("breakthrough-modal").hidden = false;
    window.PriTestDrawStateSync.set("breakthrough", { minimized: false });
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

    // バグ修正（既存の缺口）：突破判定／登攀判定（mode "floor"/"climb"）は揭曉ボタン自体を
    // 常に隠す設計（下のhideRevealButton参照）のため、revealBreakthroughTarget()が一度も
    // 呼ばれず、Pass/Fail按鈕の表示条件（!breakthroughState.revealed）が永遠に成立しない
    // ままだった——結果、GMがPass/Failを押せず地圖移動が進められずに詰まっていた
    // （使用者報告）。目標値自体はrevealBreakthroughTarget()を経由しないここでは公開せず
    // （sumLabelの判定を下で別途mode考慮に修正）、entered全員が擲骰完了した時点で
    // revealedだけを直接trueにし、Pass/Fail按鈕を正常に出す。
    if (
      (breakthroughState.mode === "floor" || breakthroughState.mode === "climb") &&
      !breakthroughState.revealed &&
      entered.length > 0 &&
      entered.every(function (c) {
        return !!breakthroughState.characters[c.id];
      })
    ) {
      breakthroughState.revealed = true;
    }

    var target = Number(document.getElementById("breakthrough-target-input").value) || 0;
    var perPC = document.getElementById("breakthrough-perpc-checkbox").checked;
    var actualTarget = perPC ? target * entered.length : target;
    var sumLabel = document.getElementById("breakthrough-sum-label");
    // floor/climbは上記の自動revealed後もGMへの目標値表示は行わない（自動化下の既定方針）。
    var showTargetValue =
      breakthroughState.revealed && breakthroughState.mode !== "floor" && breakthroughState.mode !== "climb";
    sumLabel.textContent = showTargetValue
      ? window.I18N.t("breakthrough_sum_label", { sum: breakthroughDiceSum(), target: actualTarget })
      : window.I18N.t("breakthrough_sum_label_hidden", { sum: breakthroughDiceSum() });

    // 第2項：突破判定／登攀判定（mode "floor"/"climb"）は自動化下で目標値を一切表示しない
    // ため、揭曉ボタン自体を常に隠す（revealedフラグに関わらず）。判定發生（mode "generic"）
    // は従来通りrevealedで開閉する。
    var hideRevealButton = breakthroughState.mode === "floor" || breakthroughState.mode === "climb" || breakthroughState.revealed;
    document.getElementById("btn-breakthrough-reveal").hidden = hideRevealButton;
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
    if (passed) {
      // 第5項：突破判定の「スキップ」は真の踏破ではないため、cardLevelsの単純+1
      // （旧stepCardLevel）ではなくresolveFloorSkipへ委ねる——先の樓層へポインタは
      // 進めるが、floorClearedはtrueにしない（同じ訪問中に全樓層を1巡し終えた時点で、
      // このスキップした樓層へ改めて巻き戻して差し出される）。ブランチ/樓層はGMが
      // モーダルで手動選択したもの（populateBreakthroughFieldSelectors）をそのまま使う。
      var branchSelect = document.getElementById("breakthrough-branch-select");
      var floorSelect = document.getElementById("breakthrough-floor-select");
      var branchIndex = branchSelect && !branchSelect.hidden ? Number(branchSelect.value) : NaN;
      var skipFloorIndex = floorSelect && !floorSelect.hidden ? Number(floorSelect.value) : NaN;
      if (window.PriTestNightGmFlow && !isNaN(branchIndex) && !isNaN(skipFloorIndex)) {
        window.PriTestNightGmFlow.resolveFloorSkip(index, branchIndex, skipFloorIndex);
      }
    }
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
    openDiceHandDrawModal: openDiceHandDrawModal,
    closeDiceHandDrawModal: closeDiceHandDrawModal,
    minimizeDiceHandDrawModal: minimizeDiceHandDrawModal,
    restoreDiceHandDrawModal: restoreDiceHandDrawModal,
    handleDiceHandDrawRandom: handleDiceHandDrawRandom,
    handleDiceHandDrawJudge: handleDiceHandDrawJudge,
    grantRuneToAllEntered: grantRuneToAllEntered,
    floorHasAnyReward: floorHasAnyReward,
    appendRuneGrantRowIfDetected: appendRuneGrantRowIfDetected,
    isLootRewardKind: isLootRewardKind,
    isLootRewardEntry: isLootRewardEntry,
    floorHasJudgmentReward: floorHasJudgmentReward,
    floorRewardEntryToTurnRewards: floorRewardEntryToTurnRewards,
    floorAutoLootTurnRewards: floorAutoLootTurnRewards,
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
