(function () {
  // characters.js（角色一覧ページ）と night.js（盤面ページ）の両方から
  // 使う共通のキャラクタードロワー（編集モーダル）ロジック。
  // 呼び出し側は init({ characters, save, onChange }) でこのモジュールに
  // 自分の characters 配列（参照）と永続化関数を渡す。
  var CharacterTypes = window.PriTestCharacterTypes;
  var Weapons = window.PriTestWeapons;
  var WeaponRulebook = window.PriTestWeaponRulebook;
  var Talismans = window.PriTestTalismans;
  var Consumables = window.PriTestConsumables;
  // 「狀態／裝備欄／武器欄／技能／道具欄／護符」の自由記述タグ欄は廃止済み
  // （武器・タリスマン・消耗品データベース機能に置き換わったため）。今も残るのは
  // notes（スキル発動ウィンドウの補足説明）とbuildup（属性／異常蓄積値）のみ。
  var TAG_FIELDS = ["notes", "buildup"];
  var MAX_DICE_POOL = 20;

  // 共通武器スキル（規則書154-155頁、カテゴリを問わず武器に付与され得る汎用テンプレート）。
  // 抽選のランダム戦技枠でも、武器カード上の追加戦技欄でも、同じ候補一覧から選べるようにする。
  var COMMON_SKILL_ELEMENT_OPTIONS = [
    { ja: "炎", zh: "火" },
    { ja: "雷", zh: "雷" },
    { ja: "聖", zh: "聖" },
    { ja: "魔", zh: "魔" },
  ];
  var COMMON_SKILL_STATUS_OPTIONS = [
    { ja: "猛毒", zh: "猛毒" },
    { ja: "腐敗", zh: "腐敗" },
    { ja: "出血", zh: "出血" },
    { ja: "凍傷", zh: "凍傷" },
    { ja: "発狂", zh: "發狂" },
    { ja: "睡眠", zh: "睡眠" },
    { ja: "呪死", zh: "呪死" },
  ];
  var COMMON_SKILL_SPECIAL_TARGET_OPTIONS = [
    { ja: "死に生きる者", zh: "死而復生者" },
    { ja: "竜", zh: "龍" },
    { ja: "星の眷属", zh: "星之眷屬" },
  ];
  var COMMON_SKILL_TYPES = [
    { kind: "element", field: "element", labelKey: "weapon_common_skill_type_element", options: COMMON_SKILL_ELEMENT_OPTIONS },
    { kind: "status", field: "status", labelKey: "weapon_common_skill_type_status", options: COMMON_SKILL_STATUS_OPTIONS },
    {
      kind: "element_minus5",
      field: "element",
      labelKey: "weapon_common_skill_type_element_minus5",
      options: COMMON_SKILL_ELEMENT_OPTIONS,
    },
    {
      kind: "status_minus5",
      field: "status",
      labelKey: "weapon_common_skill_type_status_minus5",
      options: COMMON_SKILL_STATUS_OPTIONS,
    },
    { kind: "special", field: "target", labelKey: "weapon_common_skill_type_special", options: COMMON_SKILL_SPECIAL_TARGET_OPTIONS },
  ];

  function rollD6() {
    return 1 + Math.floor(Math.random() * 6);
  }

  // 骰子池（1-6の出目配列）をアイコン＋削除ボタンで描画する。
  // night.js の共有骰子池、このファイル自身のキャラクター別骰子池の両方から使う。
  function renderDicePool(listEl, pool, onRemove, addBtnEl) {
    listEl.innerHTML = "";
    pool.forEach(function (value, index) {
      var die = document.createElement("span");
      die.className = "dice-item";
      die.textContent = value;

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "dice-remove";
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        onRemove(index);
      });

      die.appendChild(remove);
      listEl.appendChild(die);
    });
    if (addBtnEl) addBtnEl.disabled = pool.length >= MAX_DICE_POOL;
  }

  // 出目のみを表示する（削除ボタン無し）。レベルアップ遺物効果の擲骰結果表示に使う。
  function renderDiceDisplay(listEl, values) {
    listEl.innerHTML = "";
    values.forEach(function (v) {
      var die = document.createElement("span");
      die.className = "dice-item";
      die.textContent = v;
      listEl.appendChild(die);
    });
  }

  // 骰子池の現況判定：プール内の最大値が偶数なら前衛、奇数なら後衛。プール内に「6」が
  // 1つでもあれば敵視+1（複数出ていても+1のまま、出目6の有無だけを見る）。
  // night.js（盤面ロスター）・character_drawer.js（個人情報ドロワー）の両方で共有する。
  function computeDiceStatus(pool) {
    if (!pool || !pool.length) return null;
    var max = Math.max.apply(null, pool);
    var position = max % 2 === 0 ? "front" : "back";
    var aggroIncrease = pool.indexOf(6) !== -1 ? 1 : 0;
    return { position: position, aggroIncrease: aggroIncrease };
  }

  function renderDiceStatusLabel(el, pool) {
    if (!el) return;
    var status = computeDiceStatus(pool);
    if (!status) {
      el.textContent = "";
      return;
    }
    var positionText = window.I18N.t(status.position === "front" ? "dice_status_front" : "dice_status_back");
    el.textContent = window.I18N.t("dice_status_label", { position: positionText, aggro: status.aggroIncrease });
  }

  // --- 附帯効果（装備品から獲得する、キャラクタータイプに依存しない共通の付帯効果） ---
  // 出典:「付帯効果決定表」。全24種、6個ずつ4ブロックに分かれる。
  var ATTACHED_EFFECT_BLOCKS = [
    [
      {
        id: "attack_dmg",
        name: { zh: "攻擊傷害+", ja: "アタックダメージ+" },
        body: {
          zh: "將自身近戰武器與射擊武器所產生的攻擊傷害設為「1Hit：+5／2Hit：+10」。",
          ja: "自身の近接武器と射撃武器から発生するアタックによるダメージを「1Hit：+5／2Hit：+10」する。",
        },
      },
      {
        id: "arts_dmg",
        name: { zh: "戰技傷害+5", ja: "戦技ダメージ+5" },
        body: { zh: "將自身戰技造成的傷害「+5」。", ja: "自身の戦技から発生するダメージを「+5」する。" },
      },
      {
        id: "sorcery_dmg",
        name: { zh: "魔術傷害+5", ja: "魔術ダメージ+5" },
        body: { zh: "將自身魔術造成的傷害「+5」。", ja: "自身の魔術から発生するダメージを「+5」する。" },
      },
      {
        id: "incant_dmg",
        name: { zh: "祈禱傷害+5", ja: "祈祷ダメージ+5" },
        body: { zh: "將自身祈禱造成的傷害「+5」。", ja: "自身の祈祷から発生するダメージを「+5」する。" },
      },
      {
        id: "max_hp_up",
        name: { zh: "最大HP上升", ja: "最大HP上昇" },
        body: { zh: "將自身「最大HP：+□」。", ja: "自身を「最大HP：+□」する。" },
      },
      {
        id: "max_fp_up",
        name: { zh: "最大FP上升", ja: "最大FP上昇" },
        body: { zh: "將自身「最大FP：+□」。", ja: "自身を「最大FP：+□」する。" },
      },
    ],
    [
      {
        id: "hp_regen",
        name: { zh: "HP持續回復", ja: "HP持続回復" },
        body: {
          zh: "於戰鬥結束時與防禦階段結束時，對自身施加「HP回復□」的效果。",
          ja: "戦闘終了時とディフェンスフェイズ終了時に、自身に「HP回復□」の効果を処理する。",
        },
      },
      {
        id: "fp_regen",
        name: { zh: "FP持續回復", ja: "FP持続回復" },
        body: {
          zh: "於戰鬥結束時與防禦階段結束時，對自身施加「FP回復□」的效果。",
          ja: "戦闘終了時とディフェンスフェイズ終了時に、自身に「FP回復□」の効果を処理する。",
        },
      },
      {
        id: "guard_hp_regen",
        name: { zh: "防禦成功時HP回復", ja: "ガード成功時HP回復" },
        body: {
          zh: "「防禦」敵人的傷害成功時，先施加「HP回復□」後，再處理HP損害。",
          ja: "エネミーからのダメージを「ガード」したとき、まず「HP回復□」した後、HP損害を処理する。",
        },
      },
      {
        id: "guard_counter_up",
        name: { zh: "防禦反擊強化", ja: "ガードカウンター強化" },
        body: {
          zh: "將遺物效果「防禦反擊」造成的傷害「+15」。",
          ja: "遺物効果「ガードカウンター」から発生するダメージを「+15」する。",
        },
      },
      {
        id: "jump_atk_up",
        name: { zh: "跳躍攻擊強化", ja: "ジャンプ攻撃強化" },
        body: {
          zh: "將遺物效果「跳躍攻擊」造成的傷害「+10」。",
          ja: "遺物効果「ジャンプ攻撃」から発生するダメージを「+10」する。",
        },
      },
      {
        id: "dash_atk_up",
        name: { zh: "衝刺攻擊強化", ja: "ダッシュ攻撃強化" },
        body: {
          zh: "將遺物效果「衝刺攻擊」造成的傷害「+10」。",
          ja: "遺物効果「ダッシュ攻撃」から発生するダメージを「+10」する。",
        },
      },
    ],
    [
      {
        id: "crit_up",
        name: { zh: "致命一擊強化", ja: "致命の一撃強化" },
        body: {
          zh: "將遺物效果「致命一擊」造成傷害的上限值「+10」。",
          ja: "遺物効果「致命の一撃」から発生するダメージの上限値を「+10」する。",
        },
      },
      {
        id: "status_resist",
        name: { zh: "狀態異常耐性", ja: "状態異常耐性" },
        body: {
          zh: "習得此附帶效果時選擇1種狀態異常。自身承受所選狀態異常的蓄積值，將原本的「□×8」變更為「□×9」，變得較不容易陷入該狀態異常。",
          ja: "この付帯効果の獲得時に状態異常を1つ選ぶ。自身に適用される選んだ状態異常の蓄積値は、通常「□×8」のところ「□×9」になり、状態異常になりにくくなる。",
        },
      },
      {
        id: "element_resist",
        name: { zh: "屬性耐性", ja: "属性耐性" },
        body: {
          zh: "習得此附帶效果時選擇1種屬性。自身承受所選屬性的蓄積值上限，將原本的「□×8」變更為「□×9」，變得較不容易受到屬性損害。",
          ja: "この付帯効果の獲得時に属性を1つ選ぶ。自身に適用される選んだ属性の蓄積値の上限を、通常「□×8」のところ「□×9」にし、属性損害を受けにくくする。",
        },
      },
      {
        id: "easy_target",
        name: { zh: "容易被盯上", ja: "狙われやすい" },
        body: { zh: "將自身常時設為「敵視：+1」。", ja: "自身を常に「敵視：+1」する。" },
      },
      {
        id: "hard_target",
        name: { zh: "不易被盯上", ja: "狙われにくい" },
        body: { zh: "將自身常時設為「敵視：-1」。", ja: "自身を常に「敵視：-1」する。" },
      },
      {
        id: "phys_cut",
        name: { zh: "物理減傷+", ja: "物理カット値+" },
        body: { zh: "將自身的「物理減傷值：+10」。", ja: "自身を「物理カット値：+10」する。" },
      },
    ],
    [
      {
        id: "arts_revive_regen",
        name: { zh: "復歸時恢復技藝", ja: "復帰時アーツ回復" },
        body: {
          zh: "從瀕死狀態復歸時，回復自身技藝的使用次數1次份。",
          ja: "瀕死状態から復帰した時、自身のアーツの使用回数1回分を回復する。",
        },
      },
      {
        id: "sprint_fire",
        name: { zh: "疾跑時發生火焰", ja: "疾走で赤い落雷が発生" },
        body: {
          zh: "行動階段開始時，若自身從「後衛移動至前衛」，則對敵人造成「火：1D」。此附帶效果每個行動階段中僅發揮1次。（原文判讀不易，內容待確認）",
          ja: "アクションフェイズ開始時に自身が「後衛から前衛」に変化した場合、エネミーに「炎：1D」を与える。この付帯効果はアクションフェイズ中に1回しか発揮されない。（原文判読が難しく、内容要確認）",
        },
      },
      {
        id: "walk_lightning",
        name: { zh: "步行時發生落雷", ja: "歩きで溶岩が発生" },
        body: {
          zh: "行動階段開始時若位於前衛，則給予敵人造成「雷：1D」。此附帶效果每個行動階段中僅發揮1次。",
          ja: "アクションフェイズ開始時に前衛の場合、エネミーに「雷：1D」を与える。この付帯効果はアクションフェイズ中に1回しか発揮されない。",
        },
      },
      {
        id: "time_gem",
        name: { zh: "一定時間後產生輝石", ja: "一定時間で輝石が発生" },
        body: {
          zh: "行動階段開始時若自身「敵視：1以上」，則給予敵人造成「魔：1D」。此附帶效果每個行動階段中僅發揮1次。",
          ja: "アクションフェイズ開始時に自身が「敵視：1以上」の場合、エネミーに「魔：1D」を与える。この付帯効果はアクションフェイズ中に1回しか発揮されない。",
        },
      },
      {
        id: "two_hand_up",
        name: { zh: "雙手持握強化", ja: "両手持ち強化" },
        body: {
          zh: "僅在自身只裝備1把武器時，將攻擊造成的傷害設為「1Hit：+5／2Hit：+10」，戰技傷害設為「+5」。",
          ja: "自身が武器を1つしか装備状態にしていないとき、アタックのダメージを「1Hit：+5／2Hit：+10」し、戦技ダメージを「+5」する。",
        },
      },
      {
        id: "dual_wield_up",
        name: { zh: "雙刀持握強化", ja: "二刀持ち強化" },
        body: {
          zh: "僅在自身同時裝備2把同類別近戰武器時，將攻擊造成的傷害設為「1Hit：+5／2Hit：+10」，戰技傷害設為「+5」。",
          ja: "自身が同じカテゴリの近接武器を2つ装備状態にしているとき、アタックから発生するダメージを「1Hit：+5／2Hit：+10」し、戦技ダメージを「+5」する。",
        },
      },
    ],
  ];
  var MAX_ATTACHED_EFFECTS = 3;
  var attachedRollResult = null; // { dice: [x,y], block: 0-3, candidates: [effect] } | null
  var attachedPendingCandidate = null; // 上限到達時、置き換え対象を選ぶまで保留する新規候補
  var commonSkillSettingWeaponId = null; // 共通戦技の選択欄を開いている武器id（1本のみ、他は自動で閉じる）

  // 1個目の骰子の出目からブロック(0-3)を決める: 1→0 / 2,3→1 / 4,5→2 / 6→3
  function attachedBlockForValue(value) {
    if (value === 1) return 0;
    if (value === 2 || value === 3) return 1;
    if (value === 4 || value === 5) return 2;
    return 3;
  }

  function attachedEffectById(id) {
    for (var b = 0; b < ATTACHED_EFFECT_BLOCKS.length; b++) {
      for (var i = 0; i < ATTACHED_EFFECT_BLOCKS[b].length; i++) {
        if (ATTACHED_EFFECT_BLOCKS[b][i].id === id) return ATTACHED_EFFECT_BLOCKS[b][i];
      }
    }
    return null;
  }

  function renderAttachedCandidateCard(container, effect, c) {
    var card = document.createElement("div");
    card.className = "relic-candidate-card";
    var title = document.createElement("div");
    title.className = "relic-candidate-name";
    title.textContent = CharacterTypes.localizedText(effect.name) + "［Passive］";
    card.appendChild(title);
    var body = document.createElement("p");
    body.className = "threat-ref-body";
    body.textContent = CharacterTypes.localizedText(effect.body);
    card.appendChild(body);
    var learnBtn = document.createElement("button");
    learnBtn.type = "button";
    learnBtn.textContent = window.I18N.t("relic_learn_button");
    learnBtn.addEventListener("click", function () {
      if (!c.learnedAttachedEffects) c.learnedAttachedEffects = [];
      if (c.learnedAttachedEffects.length >= MAX_ATTACHED_EFFECTS) {
        attachedPendingCandidate = effect;
        renderAttachedSection();
        return;
      }
      c.learnedAttachedEffects.push(effect.id);
      saveFn();
      attachedRollResult = null;
      renderAttachedSection();
    });
    card.appendChild(learnBtn);
    container.appendChild(card);
  }

  function renderAttachedCandidates() {
    var c = findCharacter(activeCharacterId);
    var container = document.getElementById("attached-candidates");
    if (!container) return;
    container.innerHTML = "";
    if (!c || !attachedRollResult) return;

    var learned = c.learnedAttachedEffects || [];
    var candidates = attachedRollResult.candidates.filter(function (e) {
      return learned.indexOf(e.id) === -1;
    });

    var label = document.createElement("p");
    label.className = "threat-ref-body";
    label.textContent = window.I18N.t("attached_choose_one_label");
    container.appendChild(label);

    if (candidates.length === 0) {
      var freeLabel = document.createElement("p");
      freeLabel.className = "threat-ref-body";
      freeLabel.textContent = window.I18N.t("relic_free_choice_label");
      container.appendChild(freeLabel);
      candidates = ATTACHED_EFFECT_BLOCKS[attachedRollResult.block].filter(function (e) {
        return learned.indexOf(e.id) === -1;
      });
      if (candidates.length === 0) {
        // 同ブロックが全て習得済みの場合は、全24種の未習得から自由に選ぶ
        candidates = [].concat.apply([], ATTACHED_EFFECT_BLOCKS).filter(function (e) {
          return learned.indexOf(e.id) === -1;
        });
      }
    }

    candidates.forEach(function (e) {
      renderAttachedCandidateCard(container, e, c);
    });
  }

  function renderAttachedLearnedList() {
    var c = findCharacter(activeCharacterId);
    var container = document.getElementById("attached-learned-list");
    if (!container) return;
    container.innerHTML = "";
    if (!c) return;

    if (attachedPendingCandidate) {
      var prompt = document.createElement("p");
      prompt.className = "threat-ref-body";
      prompt.textContent = window.I18N.t("attached_replace_prompt", {
        name: CharacterTypes.localizedText(attachedPendingCandidate.name),
      });
      container.appendChild(prompt);

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = window.I18N.t("cancel_button");
      cancelBtn.addEventListener("click", function () {
        attachedPendingCandidate = null;
        renderAttachedSection();
      });
      container.appendChild(cancelBtn);
    }

    (c.learnedAttachedEffects || []).forEach(function (id) {
      var effect = attachedEffectById(id);
      if (!effect) return;
      var details = document.createElement("details");
      details.className = "ability-entry";
      var summary = document.createElement("summary");
      summary.textContent = CharacterTypes.localizedText(effect.name) + "［Passive］";
      details.appendChild(summary);
      var body = document.createElement("p");
      body.className = "threat-ref-body";
      body.textContent = CharacterTypes.localizedText(effect.body);
      details.appendChild(body);

      if (attachedPendingCandidate) {
        var replaceBtn = document.createElement("button");
        replaceBtn.type = "button";
        replaceBtn.textContent = window.I18N.t("attached_replace_button");
        replaceBtn.addEventListener("click", function () {
          var idx = c.learnedAttachedEffects.indexOf(id);
          if (idx !== -1) c.learnedAttachedEffects.splice(idx, 1, attachedPendingCandidate.id);
          saveFn();
          attachedPendingCandidate = null;
          attachedRollResult = null;
          renderAttachedSection();
        });
        details.appendChild(replaceBtn);
      }

      container.appendChild(details);
    });
  }

  // 「顯示全部」: 全24種の付帯効果を、ブロック位置・習得済みかどうか付きで一覧表示する（閲覧専用）。
  var attachedShowAll = false;

  function renderAttachedAllList() {
    var c = findCharacter(activeCharacterId);
    var container = document.getElementById("attached-all-list");
    var toggleBtn = document.getElementById("btn-attached-toggle-all");
    if (!container) return;
    if (toggleBtn) {
      toggleBtn.textContent = window.I18N.t(attachedShowAll ? "relic_hide_all_button" : "relic_show_all_button");
    }
    container.hidden = !attachedShowAll;
    container.innerHTML = "";
    if (!attachedShowAll || !c) return;

    var learned = c.learnedAttachedEffects || [];
    var BLOCK_LABEL = ["A", "B", "C", "D"];
    ATTACHED_EFFECT_BLOCKS.forEach(function (block, bi) {
      block.forEach(function (e, ei) {
        var isLearned = learned.indexOf(e.id) !== -1;
        var details = document.createElement("details");
        details.className = "ability-entry";
        var summary = document.createElement("summary");
        summary.textContent =
          CharacterTypes.localizedText(e.name) +
          "［Passive］　" +
          (BLOCK_LABEL[bi] || bi) +
          (ei + 1) +
          "　" +
          window.I18N.t(isLearned ? "relic_learned_tag" : "relic_unlearned_tag");
        details.appendChild(summary);
        var body = document.createElement("p");
        body.className = "threat-ref-body";
        body.textContent = CharacterTypes.localizedText(e.body);
        details.appendChild(body);
        container.appendChild(details);
      });
    });
  }

  function renderAttachedSection() {
    var c = findCharacter(activeCharacterId);
    var progressEl = document.getElementById("attached-progress-text");
    var roll2Btn = document.getElementById("btn-attached-roll-2d");
    var diceEl = document.getElementById("attached-dice-display");
    if (!progressEl) return;

    if (!c) {
      progressEl.textContent = "";
      if (roll2Btn) roll2Btn.disabled = true;
      if (diceEl) diceEl.innerHTML = "";
      document.getElementById("attached-candidates").innerHTML = "";
      document.getElementById("attached-learned-list").innerHTML = "";
      renderAttachedAllList();
      return;
    }

    var learned = (c.learnedAttachedEffects || []).length;
    progressEl.textContent = window.I18N.t("attached_progress_text", { learned: learned, max: MAX_ATTACHED_EFFECTS });
    if (roll2Btn) roll2Btn.disabled = false;
    if (diceEl) {
      if (attachedRollResult) renderDiceDisplay(diceEl, attachedRollResult.dice);
      else diceEl.innerHTML = "";
    }
    renderAttachedCandidates();
    renderAttachedLearnedList();
    renderAttachedAllList();
  }

  function handleAttachedRoll2D() {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    attachedPendingCandidate = null;
    var x = rollD6();
    var y = rollD6();
    var block = attachedBlockForValue(x);
    var effect = ATTACHED_EFFECT_BLOCKS[block][y - 1];
    attachedRollResult = { dice: [x, y], block: block, candidates: [effect] };
    renderAttachedSection();
  }

  // --- レベルアップ遺物効果の習得（骰子2個で正選／逆選） ---
  // レベル4-15の12回分、群A(1-2)/B(3-4)/C(5-6)＋群内位置(1-6)で対象を決める。
  var RELIC_LEVEL_START = 4;
  var RELIC_LEVEL_END = 15;
  var relicRolledDice = null; // { x, y } | null

  function relicEffectKey(typeId, groupIndex, effectIndex) {
    return typeId + "-r" + groupIndex + "-" + effectIndex;
  }

  function relicThird(value) {
    if (value <= 2) return 0;
    if (value <= 4) return 1;
    return 2;
  }

  // 遺物効果の本文が「自身を『敵視：+N』する」のような単純な常時加算効果だけを表す場合に、
  // そのNを取り出す。条件付き・複合効果の文章（他の語句を含む）にはマッチしない、
  // 純粋な数値調整のみの受動効果を検出するための厳密な正規表現。
  var AGGRO_PASSIVE_RE_ZH = /^將自身「敵視：([+－\-]\d+)」。$/;
  var AGGRO_PASSIVE_RE_JA = /^自身を「敵視：([+＋－\-]\d+)」する。$/;

  function parseAggroDelta(text) {
    var m = AGGRO_PASSIVE_RE_ZH.exec(text || "") || AGGRO_PASSIVE_RE_JA.exec(text || "");
    if (!m) return 0;
    var normalized = m[1].replace(/－/g, "-").replace(/＋/g, "+");
    return parseInt(normalized, 10) || 0;
  }

  // 角色が習得済みの遺物効果の中に、常時「敵視」を加減する受動効果があれば合計値を返す。
  // 新しい戦闘（雑魚・敵人が0体の状態から追加）の開始時に、初期敵視へ自動反映するために使う。
  function getPassiveAggroBonus(c) {
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    if (!type) return 0;
    var learned = c.learnedRelicEffects || [];
    var total = 0;
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        if (learned.indexOf(relicEffectKey(type.id, gi, ei)) === -1) return;
        if (e.kind !== "Passive") return;
        var delta = parseAggroDelta(e.body && e.body.zh);
        if (!delta) delta = parseAggroDelta(e.body && e.body.ja);
        total += delta;
      });
    });
    return total;
  }

  // 「聖杯瓶回復量提升」「技能使用次數＋1」等の遺物効果は、本文が「+□」「+○」のような
  // シナリオ変数プレースホルダーで具体的な数値が無いため、名前が完全一致した場合に
  // 固定+1として扱う（ユーザーの指示どおりのベストエフォート）。
  function countLearnedRelicEffectsByName(c, names) {
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    if (!type) return 0;
    var learned = c.learnedRelicEffects || [];
    var count = 0;
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        if (learned.indexOf(relicEffectKey(type.id, gi, ei)) === -1) return;
        if (e.kind !== "Passive") return;
        var nameZh = e.name && e.name.zh;
        var nameJa = e.name && e.name.ja;
        if (names.indexOf(nameZh) !== -1 || names.indexOf(nameJa) !== -1) count += 1;
      });
    });
    return count;
  }

  // countLearnedRelicEffectsByNameと同じ探索だが、個数ではなく該当した遺物効果そのもの
  // （本文を含む）を返す。本文中の具体的な数値（骰子消耗／HP価値など）を参照したい場合に使う。
  function findLearnedRelicEffectByName(c, names) {
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    if (!type) return null;
    var learned = c.learnedRelicEffects || [];
    var found = null;
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        if (found || e.kind !== "Passive") return;
        if (learned.indexOf(relicEffectKey(type.id, gi, ei)) === -1) return;
        var nameZh = e.name && e.name.zh;
        var nameJa = e.name && e.name.ja;
        if (names.indexOf(nameZh) !== -1 || names.indexOf(nameJa) !== -1) found = e;
      });
    });
    return found;
  }

  function getFlaskHealBonus(c) {
    return countLearnedRelicEffectsByName(c, ["聖杯瓶回復量提升", "聖杯瓶回復量アップ"]);
  }

  function getSkillUsesBonus(c) {
    return countLearnedRelicEffectsByName(c, ["技能使用次數＋1", "スキル使用回数＋1"]);
  }

  function relicMaxLearnable(level) {
    return Math.max(0, Math.min(level - (RELIC_LEVEL_START - 1), RELIC_LEVEL_END - RELIC_LEVEL_START + 1));
  }

  // groupValue で群（A/B/C）、indexValue（1-6）で群内の位置を決める。
  // 該当位置が存在しない、または既に習得済みなら null（=選択不可）を返す。
  function relicCandidateFor(type, c, groupValue, indexValue) {
    var group = type.relicEffectGroups[relicThird(groupValue)];
    var idx = indexValue - 1;
    if (!group || idx >= group.effects.length) return null;
    var key = relicEffectKey(type.id, relicThird(groupValue), idx);
    if ((c.learnedRelicEffects || []).indexOf(key) !== -1) return null;
    return { key: key, effect: group.effects[idx] };
  }

  function relicAllUnlearned(type, c) {
    var out = [];
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        var key = relicEffectKey(type.id, gi, ei);
        if ((c.learnedRelicEffects || []).indexOf(key) === -1) out.push({ key: key, effect: e });
      });
    });
    return out;
  }

  function relicEffectForKey(type, key) {
    var groups = type.relicEffectGroups || [];
    for (var gi = 0; gi < groups.length; gi++) {
      for (var ei = 0; ei < groups[gi].effects.length; ei++) {
        if (relicEffectKey(type.id, gi, ei) === key) return groups[gi].effects[ei];
      }
    }
    return null;
  }

  // 誤クリックで習得してしまった遺物効果を、個別に未習得の状態へ戻せるようにする一覧。
  function renderRelicLearnedList() {
    var c = findCharacter(activeCharacterId);
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    var container = document.getElementById("relic-learned-list");
    if (!container) return;
    container.innerHTML = "";
    if (!c || !type || !(c.learnedRelicEffects || []).length) return;

    var title = document.createElement("p");
    title.className = "boss-subheading";
    title.textContent = window.I18N.t("relic_learned_list_title");
    container.appendChild(title);

    c.learnedRelicEffects.forEach(function (key) {
      var effect = relicEffectForKey(type, key);
      if (!effect) return;
      var details = document.createElement("details");
      details.className = "ability-entry";
      var summary = document.createElement("summary");
      summary.textContent = CharacterTypes.localizedText(effect.name) + "［" + effect.kind + "］";
      details.appendChild(summary);
      var body = document.createElement("p");
      body.className = "threat-ref-body";
      body.textContent = CharacterTypes.localizedText(effect.body);
      details.appendChild(body);

      var resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "danger-btn";
      resetBtn.textContent = window.I18N.t("relic_reset_button");
      resetBtn.addEventListener("click", function () {
        if (!window.confirm(window.I18N.t("relic_reset_confirm", { name: CharacterTypes.localizedText(effect.name) }))) return;
        var idx = c.learnedRelicEffects.indexOf(key);
        if (idx !== -1) c.learnedRelicEffects.splice(idx, 1);
        saveFn();
        relicRolledDice = null;
        renderRelicSection();
        renderTypeReference(c);
      });
      details.appendChild(resetBtn);

      container.appendChild(details);
    });
  }

  function renderRelicCandidateCard(container, candidate, c) {
    var card = document.createElement("div");
    card.className = "relic-candidate-card";

    var title = document.createElement("div");
    title.className = "relic-candidate-name";
    title.textContent = CharacterTypes.localizedText(candidate.effect.name) + "［" + candidate.effect.kind + "］";
    card.appendChild(title);

    var body = document.createElement("p");
    body.className = "threat-ref-body";
    body.textContent = CharacterTypes.localizedText(candidate.effect.body);
    card.appendChild(body);

    var learnBtn = document.createElement("button");
    learnBtn.type = "button";
    learnBtn.textContent = window.I18N.t("relic_learn_button");
    learnBtn.addEventListener("click", function () {
      if (!c.learnedRelicEffects) c.learnedRelicEffects = [];
      c.learnedRelicEffects.push(candidate.key);
      saveFn();
      relicRolledDice = null;
      renderRelicSection();
      renderTypeReference(c);
    });
    card.appendChild(learnBtn);

    container.appendChild(card);
  }

  function renderRelicCandidates() {
    var c = findCharacter(activeCharacterId);
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    var candidatesEl = document.getElementById("relic-candidates");
    if (!candidatesEl) return;
    candidatesEl.innerHTML = "";
    if (!c || !type || !relicRolledDice) return;
    if ((c.learnedRelicEffects || []).length >= relicMaxLearnable(c.level)) return;

    var forward = relicCandidateFor(type, c, relicRolledDice.x, relicRolledDice.y);
    var reverse = relicCandidateFor(type, c, relicRolledDice.y, relicRolledDice.x);
    if (forward && reverse && forward.key === reverse.key) reverse = null;

    if (forward || reverse) {
      var label = document.createElement("p");
      label.className = "threat-ref-body";
      label.textContent = window.I18N.t("relic_choose_one_label");
      candidatesEl.appendChild(label);
      if (forward) renderRelicCandidateCard(candidatesEl, forward, c);
      if (reverse) renderRelicCandidateCard(candidatesEl, reverse, c);
    } else {
      var freeLabel = document.createElement("p");
      freeLabel.className = "threat-ref-body";
      freeLabel.textContent = window.I18N.t("relic_free_choice_label");
      candidatesEl.appendChild(freeLabel);
      relicAllUnlearned(type, c).forEach(function (cand) {
        renderRelicCandidateCard(candidatesEl, cand, c);
      });
    }
  }

  function renderRelicSection() {
    var c = findCharacter(activeCharacterId);
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    var progressEl = document.getElementById("relic-progress-text");
    var rollBtn = document.getElementById("btn-relic-roll");
    var diceEl = document.getElementById("relic-dice-display");
    if (!progressEl) return;

    if (!c || !type) {
      progressEl.textContent = "";
      if (rollBtn) rollBtn.disabled = true;
      if (diceEl) diceEl.innerHTML = "";
      document.getElementById("relic-candidates").innerHTML = "";
      var learnedListEl = document.getElementById("relic-learned-list");
      if (learnedListEl) learnedListEl.innerHTML = "";
      return;
    }

    var learned = (c.learnedRelicEffects || []).length;
    var maxLearnable = relicMaxLearnable(c.level);
    progressEl.textContent = window.I18N.t("relic_progress_text", { learned: learned, max: maxLearnable });
    if (rollBtn) rollBtn.disabled = learned >= maxLearnable;
    if (diceEl) {
      if (relicRolledDice) renderDiceDisplay(diceEl, [relicRolledDice.x, relicRolledDice.y]);
      else diceEl.innerHTML = "";
    }
    renderRelicCandidates();
    renderRelicLearnedList();
    renderRelicAllList();
    renderFlaskHealBonusMarker(c);
  }

  // 「聖杯瓶回復量提升」遺物効果を習得している場合、その分を黄字の(+N)として表示する
  // （実際の回復量への加算は戦闘モーダル側でgetFlaskHealBonusを呼んで行う）。
  function renderFlaskHealBonusMarker(c) {
    var el = document.getElementById("char-flask-heal-bonus");
    if (!el) return;
    var bonus = c ? getFlaskHealBonus(c) : 0;
    el.textContent = bonus > 0 ? window.I18N.t("flask_heal_bonus_marker", { value: bonus }) : "";
  }

  function handleRelicRoll() {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    if ((c.learnedRelicEffects || []).length >= relicMaxLearnable(c.level)) return;
    relicRolledDice = { x: rollD6(), y: rollD6() };
    renderRelicSection();
  }

  // 「顯示全部」: そのタイプの全アビリティ/スキル/アーツ/遺物効果を、
  // レベル条件・群/位置・習得済みかどうか付きで一覧表示する（閲覧専用、参照用）。
  var relicShowAll = false;

  function renderRelicAllEntry(container, entry, tagText, learnedTag) {
    var details = document.createElement("details");
    details.className = "ability-entry";
    var summary = document.createElement("summary");
    summary.textContent =
      CharacterTypes.localizedText(entry.name) +
      "［" + entry.kind + "］　" + tagText + (learnedTag ? "　" + learnedTag : "");
    details.appendChild(summary);
    var body = document.createElement("p");
    body.className = "threat-ref-body";
    body.textContent = CharacterTypes.localizedText(entry.body);
    details.appendChild(body);
    container.appendChild(details);
  }

  function renderRelicAllList() {
    var c = findCharacter(activeCharacterId);
    var type = c && c.typeId ? CharacterTypes.get(c.typeId) : null;
    var container = document.getElementById("relic-all-list");
    var toggleBtn = document.getElementById("btn-relic-toggle-all");
    if (!container) return;
    if (toggleBtn) {
      toggleBtn.textContent = window.I18N.t(relicShowAll ? "relic_hide_all_button" : "relic_show_all_button");
    }
    container.hidden = !relicShowAll;
    container.innerHTML = "";
    if (!relicShowAll || !c || !type) return;

    var learned = c.learnedRelicEffects || [];
    var GROUP_LABEL = ["A", "B", "C"];

    [].concat(type.abilities || [], type.skills || [], type.arts || []).forEach(function (entry) {
      renderRelicAllEntry(container, entry, window.I18N.t("ability_level_label", { level: entry.level }), null);
    });
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        var key = relicEffectKey(type.id, gi, ei);
        var isLearned = learned.indexOf(key) !== -1;
        var tag = (GROUP_LABEL[gi] || gi) + (ei + 1);
        renderRelicAllEntry(container, e, tag, window.I18N.t(isLearned ? "relic_learned_tag" : "relic_unlearned_tag"));
      });
    });
  }

  // レベルアップで得られるHP/FP/加護上限の累加値（2等→HP、3等→FP、4等→加護、以降繰り返し、
  // 上限15等）を、該当する項目のラベル横に「(+N)」として表示する（Lv15なら+5/+5/+4）。
  var LEVEL_CAP = 15;

  // 等級レベル（2以上）に応じて、対応する上限（HP／FP／加護）へsign分（+1または-1）を実際に
  // 反映する。1等→2等なら「2等分＝HP+1」、3等→2等に戻す場合は「3等分＝FP-1」を戻す、という
  // ように、変化する等級（level）自身が対応する枠を決める（2→HP、3→FP、4→加護、以降繰り返し）。
  function applyLevelUpResourceBonus(c, level, sign) {
    if (level < 2) return;
    var slot = (level - 2) % 3;
    if (slot === 0) c.hp.max = Math.max(0, (c.hp.max || 0) + sign);
    else if (slot === 1) c.fp.max = Math.max(0, (c.fp.max || 0) + sign);
    else c.blessingSlots.max = Math.max(0, (c.blessingSlots.max || 0) + sign);
  }

  function renderLevelBonusMarkers(c) {
    var hpEl = document.getElementById("char-hp-level-bonus");
    var fpEl = document.getElementById("char-fp-level-bonus");
    var blessingEl = document.getElementById("char-blessing-level-bonus");
    if (!hpEl || !fpEl || !blessingEl) return;
    var counts = [0, 0, 0];
    var level = c ? Math.min(c.level || 0, LEVEL_CAP) : 0;
    for (var lv = 2; lv <= level; lv++) counts[(lv - 2) % 3]++;
    [hpEl, fpEl, blessingEl].forEach(function (el, i) {
      el.textContent = counts[i] > 0 ? window.I18N.t("level_bonus_marker", { count: counts[i] }) : "";
    });
  }

  // 次の等級に上げるために必要な盧恩を、等級欄の横に「(-N)」として表示する。
  // 等級Lから等級L+1に上げるのに必要な盧恩は「L+1」（等級1なら次の2等へ「-2」）。上限等級では非表示。
  function renderLevelNextCostMarker(c) {
    var el = document.getElementById("char-level-next-cost");
    if (!el) return;
    var level = c ? c.level || 0 : 0;
    el.textContent = level > 0 && level < LEVEL_CAP ? window.I18N.t("level_next_cost_marker", { cost: level + 1 }) : "";
  }

  // 復歸次数（死亡→再挑戦した回数）に応じたHP/FP/加護ボーナスの目安を表示する。
  // 0回: +20/+20/+20、1回: +30/+30/+30、2回以上: +40/+40/+40（常に3項目とも同値）。
  function renderRevivalBonusMarkers(c) {
    var el = document.getElementById("char-revival-bonus-marker");
    if (!el) return;
    var count = c ? c.revivalCount || 0 : 0;
    var n = count >= 2 ? 40 : count === 1 ? 30 : 20;
    el.textContent = window.I18N.t("revival_bonus_marker", { n: n });
  }

  // 詳細ドロワーの数値項目は直接入力せず+/-ボタンのみで操作する。値は常にcから都度読み書きし、
  // 変更のたびにrenderAllStatSteppersで全項目の表示をまとめて更新する（例:等級を上げると盧恩も
  // 連動して減るなど、項目間の依存を個別に追いかける必要が無い）。等級のみ、盧恩が足りるかの
  // 確認と消費を伴う特別処理（onDelta）を持つ。
  var STAT_STEPPERS = [
    {
      id: "char-level",
      get: function (c) {
        return c.level;
      },
      onDelta: function (c, delta) {
        if (delta > 0) {
          if (c.level >= LEVEL_CAP) return;
          var cost = c.level + 1;
          if ((c.runes || 0) < cost) {
            showCharDrawerError(window.I18N.t("level_up_insufficient_runes", { level: c.level + 1, cost: cost, runes: c.runes || 0 }));
            return;
          }
          c.runes -= cost;
          c.level += 1;
          applyLevelUpResourceBonus(c, c.level, 1);
        } else {
          if (c.level <= 1) return;
          var oldLevel = c.level;
          c.level = Math.max(1, c.level - 1);
          applyLevelUpResourceBonus(c, oldLevel, -1);
        }
      },
    },
    {
      id: "char-runes",
      get: function (c) {
        return c.runes;
      },
      set: function (c, v) {
        c.runes = v;
      },
      min: 0,
    },
    {
      id: "char-blessing-current",
      get: function (c) {
        return c.blessingSlots.current;
      },
      set: function (c, v) {
        c.blessingSlots.current = v;
      },
      min: 0,
      maxFn: function (c) {
        return c.blessingSlots.max;
      },
    },
    {
      id: "char-blessing-max",
      get: function (c) {
        return c.blessingSlots.max;
      },
      set: function (c, v) {
        c.blessingSlots.max = v;
      },
      min: 0,
    },
    {
      // このcurrentは「現在の残数」（HP/FPと同じ意味）。以前は「使用済み回数」だったため、
      // 「3/3」表示なのに戦闘の聖杯瓶使用が「残数なし」と誤判定するバグがあった。
      id: "char-flask-base-used",
      get: function (c) {
        return c.flaskBase.current;
      },
      set: function (c, v) {
        c.flaskBase.current = v;
      },
      min: 0,
      maxFn: function (c) {
        return c.flaskBase.max;
      },
    },
    {
      id: "char-flask-base-max",
      get: function (c) {
        return c.flaskBase.max;
      },
      set: function (c, v) {
        c.flaskBase.max = v;
      },
      min: 0,
    },
    {
      id: "char-flask-extra-used",
      get: function (c) {
        return c.flaskExtra.current;
      },
      set: function (c, v) {
        c.flaskExtra.current = v;
      },
      min: 0,
      maxFn: function (c) {
        return c.flaskExtra.max;
      },
    },
    {
      id: "char-flask-extra-max",
      get: function (c) {
        return c.flaskExtra.max;
      },
      set: function (c, v) {
        c.flaskExtra.max = v;
      },
      min: 0,
    },
    {
      id: "char-revival-count",
      get: function (c) {
        return c.revivalCount;
      },
      set: function (c, v) {
        c.revivalCount = v;
      },
      min: 0,
    },
    {
      id: "char-hp-current",
      get: function (c) {
        return c.hp.current;
      },
      set: function (c, v) {
        c.hp.current = v;
      },
      min: 0,
      maxFn: function (c) {
        return c.hp.max;
      },
    },
    {
      id: "char-hp-max",
      get: function (c) {
        return c.hp.max;
      },
      set: function (c, v) {
        c.hp.max = v;
      },
      min: 0,
    },
    {
      id: "char-fp-current",
      get: function (c) {
        return c.fp.current;
      },
      set: function (c, v) {
        c.fp.current = v;
      },
      min: 0,
      maxFn: function (c) {
        return c.fp.max;
      },
    },
    {
      id: "char-fp-max",
      get: function (c) {
        return c.fp.max;
      },
      set: function (c, v) {
        c.fp.max = v;
      },
      min: 0,
    },
    {
      id: "char-flask-heal-amount",
      get: function (c) {
        return c.flaskHealAmount;
      },
      set: function (c, v) {
        c.flaskHealAmount = v;
      },
      min: 0,
    },
  ];

  function renderAllStatSteppers(c) {
    STAT_STEPPERS.forEach(function (def) {
      var el = document.getElementById(def.id + "-value");
      if (el) el.textContent = c ? def.get(c) : "";
    });
  }

  // 上限系の数値（data-longpress-edit属性付きの.level-value）は+/-ボタンを持たず、代わりに
  // 1秒間の長押しで直接入力できるinputへ差し替える。押している時間が短い場合（通常のタップ／
  // クリック）は何も起きない。委譲イベントなので、対象要素は事前に固定idで存在していればよい。
  var LONG_PRESS_MS = 250;

  function bindLongPressEditValues(scopeEl) {
    var pressTimer = null;
    var pressedEl = null;

    function startEdit(valueEl) {
      var def = STAT_STEPPERS.filter(function (d) {
        return d.id + "-value" === valueEl.id;
      })[0];
      var c = findCharacter(activeCharacterId);
      if (!def || !c) return;
      var input = document.createElement("input");
      input.type = "number";
      input.className = "level-value-edit-input";
      input.value = def.get(c);
      valueEl.replaceWith(input);
      input.focus();
      input.select();
      var committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        var v = parseInt(input.value, 10);
        if (!isNaN(v)) {
          def.set(c, Math.max(def.min !== undefined ? def.min : 0, v));
          saveFn();
        }
        input.replaceWith(valueEl);
        renderAllStatSteppers(c);
      }
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          committed = true;
          input.replaceWith(valueEl);
        }
      });
    }

    function onDown(e) {
      var el = e.target.closest("[data-longpress-edit]");
      if (!el) return;
      pressedEl = el;
      pressTimer = setTimeout(function () {
        if (pressedEl) startEdit(pressedEl);
        pressTimer = null;
      }, LONG_PRESS_MS);
    }
    function onUp() {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      pressedEl = null;
    }
    scopeEl.addEventListener("pointerdown", onDown);
    scopeEl.addEventListener("pointerup", onUp);
    scopeEl.addEventListener("pointerleave", onUp);
    scopeEl.addEventListener("pointercancel", onUp);
  }

  function showCharDrawerError(message) {
    var el = document.getElementById("char-drawer-error");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function hideCharDrawerError() {
    var el = document.getElementById("char-drawer-error");
    if (el) el.hidden = true;
  }

  function applyStatStepperDelta(def, delta) {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    hideCharDrawerError();
    if (def.onDelta) {
      def.onDelta(c, delta);
    } else {
      var next = def.get(c) + delta;
      if (def.min !== undefined) next = Math.max(def.min, next);
      if (def.max !== undefined) next = Math.min(def.max, next);
      if (def.maxFn) next = Math.min(def.maxFn(c), next);
      def.set(c, next);
    }
    saveFn();
    renderAllStatSteppers(c);
    if (def.id === "char-level") {
      relicRolledDice = null;
      renderTypeReference(c);
      renderRelicSection();
      renderLevelBonusMarkers(c);
      renderLevelNextCostMarker(c);
    }
    if (def.id === "char-revival-count") renderRevivalBonusMarkers(c);
  }

  // --- 武器データベース検索＆選択（武器欄に既存の自由記述タグとは別枠で追加する） ---
  // ※ランダム戦技: 決定表が未確認のため、既知の戦技一覧から検索して手動で割り当てる
  // ランダム戦技枠（c.weaponRandomSkills[weaponId]）の解決済み値は、名称武器戦技を検索して
  // 決めた場合は文字列（SKILLSのid）、共通戦技を直接選んだ場合はskill ref（オブジェクト）になる。
  // どちらの形でも表示できるようにする。
  function resolveRandomSkillDisplay(resolvedValue) {
    if (!resolvedValue) return null;
    if (typeof resolvedValue === "string") {
      var resolved = Weapons.getSkill(resolvedValue);
      return resolved
        ? { name: Weapons.localizedText(resolved.name), body: Weapons.localizedText(resolved.body), kind: resolved.kind }
        : { name: resolvedValue, body: "", kind: null };
    }
    return resolveWeaponSkillDisplay(resolvedValue);
  }

  function renderRandomSkillPicker(container, weaponId, c) {
    var resolvedValue = c.weaponRandomSkills && c.weaponRandomSkills[weaponId];
    if (resolvedValue) {
      var display = resolveRandomSkillDisplay(resolvedValue);
      var details = document.createElement("details");
      details.className = "ability-entry";
      var summary = document.createElement("summary");
      summary.textContent =
        window.I18N.t("weapon_random_skill_label") + "　→　" + display.name + (display.kind ? "［" + display.kind + "］" : "");
      details.appendChild(summary);
      if (display.body) {
        var p = document.createElement("p");
        p.className = "threat-ref-body";
        p.textContent = display.body;
        details.appendChild(p);
      }
      var clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "danger-btn";
      clearBtn.textContent = window.I18N.t("weapon_random_skill_clear_button");
      clearBtn.addEventListener("click", function () {
        var clearedName = display.name;
        if (!window.confirm(window.I18N.t("weapon_random_skill_clear_confirm", { name: clearedName }))) return;
        delete c.weaponRandomSkills[weaponId];
        if (!c.weaponNotes) c.weaponNotes = {};
        var appended = window.I18N.t("weapon_cleared_skill_note", { name: clearedName });
        c.weaponNotes[weaponId] = c.weaponNotes[weaponId] ? c.weaponNotes[weaponId] + "\n" + appended : appended;
        saveFn();
        renderWeaponList();
      });
      details.appendChild(clearBtn);
      container.appendChild(details);
      return;
    }

    var wrap = document.createElement("div");
    wrap.className = "weapon-random-picker";
    var label = document.createElement("p");
    label.className = "threat-ref-body";
    label.textContent = window.I18N.t("weapon_random_skill_label");
    wrap.appendChild(label);

    var searchBox = document.createElement("div");
    searchBox.className = "weapon-search-box";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = window.I18N.t("weapon_random_skill_search_placeholder");
    var results = document.createElement("div");
    results.className = "weapon-search-results";
    results.hidden = true;

    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      results.innerHTML = "";
      if (!q) {
        results.hidden = true;
        return;
      }
      var matches = Weapons.allSkills().filter(function (entry) {
        return Weapons.localizedText(entry.name).toLowerCase().indexOf(q) !== -1;
      });
      if (matches.length === 0) {
        results.hidden = true;
        return;
      }
      results.hidden = false;
      matches.slice(0, 8).forEach(function (entry) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "weapon-search-item";
        item.textContent = Weapons.localizedText(entry.name);
        item.addEventListener("click", function () {
          if (!c.weaponRandomSkills) c.weaponRandomSkills = {};
          c.weaponRandomSkills[weaponId] = entry.id;
          saveFn();
          renderWeaponList();
        });
        results.appendChild(item);
      });
    });

    searchBox.appendChild(input);
    searchBox.appendChild(results);
    wrap.appendChild(searchBox);

    var orLabel = document.createElement("p");
    orLabel.className = "threat-ref-body";
    orLabel.textContent = window.I18N.t("weapon_common_skill_or_label");
    wrap.appendChild(orLabel);

    renderCommonSkillPicker(wrap, function (ref) {
      if (!c.weaponRandomSkills) c.weaponRandomSkills = {};
      c.weaponRandomSkills[weaponId] = ref;
      saveFn();
      renderWeaponList();
    });

    container.appendChild(wrap);
  }

  // skill ref（weapon.skills／attachedEffect／reverseArt／共通戦技いずれも同じ形）から
  // 表示用の{name, body, kind}を求める。ランダム枠（kind:"random"）はここでは扱わない。
  function resolveWeaponSkillDisplay(ref) {
    var body;
    var name;
    var kind = null;
    if (ref.kind === "art") {
      var art = Weapons.getSkill(ref.id);
      name = art ? Weapons.localizedText(art.name) : ref.id;
      body = art ? Weapons.localizedText(art.body) : "";
      kind = art ? art.kind : null;
    } else if (ref.kind === "innate") {
      var innate = null;
      Weapons.categories().forEach(function (cat) {
        (cat.innateSkills || []).forEach(function (s) {
          if (s.id === ref.id) innate = s;
        });
      });
      name = innate ? Weapons.localizedText(innate.name) : ref.id;
      body = innate ? Weapons.localizedText(innate.body) : "";
      kind = innate ? innate.kind : null;
    } else if (ref.kind === "status") {
      name = window.I18N.t("weapon_status_skill_label", { status: Weapons.localizedText(ref.status) });
      body = Weapons.localizedText(Weapons.statusSkillBody(ref.status));
      kind = "Passive";
    } else if (ref.kind === "element") {
      name = window.I18N.t("weapon_element_skill_label", { element: Weapons.localizedText(ref.element) });
      body = Weapons.localizedText(Weapons.elementSkillBody(ref.element));
      kind = "Passive";
    } else if (ref.kind === "element_minus5") {
      name = window.I18N.t("weapon_element_minus5_skill_label", { element: Weapons.localizedText(ref.element) });
      body = Weapons.localizedText(Weapons.elementMinus5SkillBody(ref.element));
      kind = "Passive";
    } else if (ref.kind === "status_minus5") {
      name = window.I18N.t("weapon_status_minus5_skill_label", { status: Weapons.localizedText(ref.status) });
      body = Weapons.localizedText(Weapons.statusMinus5SkillBody(ref.status));
      kind = "Passive";
    } else if (ref.kind === "special") {
      name = window.I18N.t("weapon_special_skill_label", { target: Weapons.localizedText(ref.target) });
      body = Weapons.localizedText(Weapons.specialEffectSkillBody(ref.target));
      kind = "Passive";
    } else if (ref.kind === "bonus") {
      name = Weapons.localizedText(ref.text);
      body = "";
    } else {
      name = window.I18N.t("weapon_note_label");
      body = Weapons.localizedText(ref.text);
    }
    return { name: name, body: body, kind: kind };
  }

  function renderWeaponSkillEntry(container, ref, weaponId, c) {
    if (ref.kind === "random") {
      renderRandomSkillPicker(container, weaponId, c);
      return;
    }
    var display = resolveWeaponSkillDisplay(ref);
    var details = document.createElement("details");
    details.className = "ability-entry";
    var summary = document.createElement("summary");
    summary.appendChild(document.createTextNode(display.name + (display.kind ? "［" + display.kind + "］" : "")));
    if (ref.kind === "art") {
      var artInfo = computeArtPower(c, weaponId);
      var artWeapon = Weapons.get(baseWeaponId(weaponId));
      var artCategory = artWeapon ? Weapons.getCategory(artWeapon.category) : null;
      var isSpellCategory = artCategory && NON_HIT_CATEGORY_IDS.indexOf(artCategory.id) !== -1;
      var artResult = artInfo
        ? isSpellCategory
          ? spellSkillPowerValue(display.body, artInfo.artPower)
          : artSkillPowerValue(display.body, artInfo.artPower)
        : null;
      if (artResult !== null) {
        var artTag = document.createElement("span");
        artTag.className = "weapon-damage-tag";
        artTag.textContent = window.I18N.t("weapon_damage_art_power_tag", { value: formatValueWithSymbol(artResult.value, artResult.symbol) });
        summary.appendChild(document.createTextNode(" "));
        summary.appendChild(artTag);
      }
    }
    details.appendChild(summary);
    if (display.body) {
      var p = document.createElement("p");
      p.className = "threat-ref-body";
      p.textContent = display.body;
      details.appendChild(p);
    }
    container.appendChild(details);
  }

  // 共通戦技（規則書154-155頁）を選ぶ2段階ピッカー：①種類（属性／状態異常／各々の威力-5版／特効）
  // ②その種類内の具体的な対象（魔／炎／雷／聖、猛毒／腐敗…等）。決定したskill refをonPickへ渡す。
  function renderCommonSkillPicker(container, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "weapon-common-skill-picker";

    var typeLabel = document.createElement("label");
    typeLabel.textContent = window.I18N.t("weapon_common_skill_type_label");
    var typeSelect = document.createElement("select");
    COMMON_SKILL_TYPES.forEach(function (t, idx) {
      var opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = window.I18N.t(t.labelKey);
      typeSelect.appendChild(opt);
    });
    typeLabel.appendChild(typeSelect);
    wrap.appendChild(typeLabel);

    var valueLabel = document.createElement("label");
    valueLabel.textContent = window.I18N.t("weapon_common_skill_value_label");
    var valueSelect = document.createElement("select");
    valueLabel.appendChild(valueSelect);
    wrap.appendChild(valueLabel);

    function renderValueOptions() {
      var t = COMMON_SKILL_TYPES[Number(typeSelect.value)];
      valueSelect.innerHTML = "";
      t.options.forEach(function (opt, idx) {
        var o = document.createElement("option");
        o.value = String(idx);
        o.textContent = Weapons.localizedText(opt);
        valueSelect.appendChild(o);
      });
    }
    renderValueOptions();
    typeSelect.addEventListener("change", renderValueOptions);

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = window.I18N.t("weapon_common_skill_add_button");
    addBtn.addEventListener("click", function () {
      var t = COMMON_SKILL_TYPES[Number(typeSelect.value)];
      var value = t.options[Number(valueSelect.value)];
      var ref = { kind: t.kind };
      ref[t.field] = value;
      onPick(ref);
    });
    wrap.appendChild(addBtn);

    container.appendChild(wrap);
  }

  function renderWeaponCard(container, weaponId, c, onRemoved) {
    var weapon = Weapons.get(baseWeaponId(weaponId));
    if (!weapon) return;
    var category = Weapons.getCategory(weapon.category);

    var card = document.createElement("div");
    card.className = "relic-candidate-card";

    var damage = category && !category.isShield ? computeWeaponDamage(c, weaponId) : null;

    var title = document.createElement("div");
    title.className = "relic-candidate-name";
    title.appendChild(
      document.createTextNode(
        Weapons.localizedText(weapon.name) + "（" + (category ? Weapons.localizedText(category.name) : weapon.category) + "・" + weapon.rarity + "）"
      )
    );
    if (damage) appendWeaponDamageTag(title, damage);
    card.appendChild(title);

    if (category && category.isShield) {
      var shieldHp = weapon.rarity === "R" || weapon.rarity === "L" ? category.basicStats.guardHpRL : category.basicStats.guardHpCU;
      var shieldStats = document.createElement("p");
      shieldStats.className = "threat-ref-body";
      shieldStats.textContent = [
        window.I18N.t("weapon_guard_cost_label") + window.I18N.t("colon_separator") + Weapons.localizedText(category.basicStats.guardCost),
        window.I18N.t("weapon_guard_hp_label") + window.I18N.t("colon_separator") + shieldHp,
        window.I18N.t("weapon_power_mod_label") +
          window.I18N.t("colon_separator") +
          (weapon.powerModOverride ? Weapons.localizedText(weapon.powerModOverride) : Weapons.localizedText(category.basicStats.powerMod)),
      ].join("\n");
      card.appendChild(shieldStats);
    } else if (category) {
      var stats = document.createElement("p");
      stats.className = "threat-ref-body";
      stats.textContent = [
        window.I18N.t("weapon_attack_cost_label") + window.I18N.t("colon_separator") + Weapons.localizedText(category.basicStats.attackCost),
        window.I18N.t("weapon_power_label") + window.I18N.t("colon_separator") + category.basicStats.weaponPower,
        window.I18N.t("weapon_power_mod_label") +
          window.I18N.t("colon_separator") +
          (weapon.powerModOverride ? Weapons.localizedText(weapon.powerModOverride) : Weapons.localizedText(category.basicStats.powerMod)),
      ].join("\n");
      card.appendChild(stats);
    }

    if (category && category.twoHitBonus && category.twoHitBonus.length) {
      var twoHitTitle = document.createElement("p");
      twoHitTitle.className = "boss-subheading";
      twoHitTitle.textContent = window.I18N.t("weapon_two_hit_bonus_label");
      card.appendChild(twoHitTitle);
      category.twoHitBonus.forEach(function (bonus) {
        var bonusP = document.createElement("p");
        bonusP.className = "threat-ref-body";
        bonusP.textContent = Weapons.localizedText(bonus.name) + window.I18N.t("colon_separator") + Weapons.localizedText(bonus.body);
        card.appendChild(bonusP);
      });
    }

    if (damage) {
      var damageDetails = document.createElement("details");
      damageDetails.className = "ability-entry weapon-damage-details";
      var damageSummary = document.createElement("summary");
      damageSummary.textContent = window.I18N.t("weapon_damage_formula_label");
      damageDetails.appendChild(damageSummary);
      var damageBreakdown = document.createElement("p");
      damageBreakdown.className = "threat-ref-body weapon-damage-breakdown";
      damageBreakdown.textContent = weaponDamageBreakdownText(damage);
      damageDetails.appendChild(damageBreakdown);
      card.appendChild(damageDetails);
    }

    if (category && category.isShield) {
      // 盾は「付随効果」と「逆手の戦技（ガード時戦技）」の2種類のスキル欄を持つ。武器の単一skills欄とは構造が異なる。
      if (weapon.attachedEffect && weapon.attachedEffect.length) {
        var attachedTitle = document.createElement("p");
        attachedTitle.className = "boss-subheading";
        attachedTitle.textContent = window.I18N.t("weapon_attached_effect_label");
        card.appendChild(attachedTitle);
        weapon.attachedEffect.forEach(function (ref) {
          renderWeaponSkillEntry(card, ref, weaponId, c);
        });
      }
      if (weapon.reverseArt && weapon.reverseArt.length) {
        var reverseTitle = document.createElement("p");
        reverseTitle.className = "boss-subheading";
        reverseTitle.textContent = window.I18N.t("weapon_reverse_art_label");
        card.appendChild(reverseTitle);
        weapon.reverseArt.forEach(function (ref) {
          renderWeaponSkillEntry(card, ref, weaponId, c);
        });
      }
    } else {
      // 装備品スキル欄（weapon.skills）に載っているものだけがこの武器の戦技・固有技能。
      // カテゴリの固有戦技一覧を無条件に全部表示することはしない。
      (weapon.skills || []).forEach(function (ref) {
        renderWeaponSkillEntry(card, ref, weaponId, c);
      });
    }

    // 共通戦技（規則書154-155頁）：武器は原則1つまでしか共通戦技を持たない。未設定なら「設定」で
    // 選択欄を開いて1つ決定し、設定済みなら選択欄は隠して「清除」だけを出す。
    var commonTitle = document.createElement("p");
    commonTitle.className = "boss-subheading";
    commonTitle.textContent = window.I18N.t("weapon_common_skill_section_title");
    card.appendChild(commonTitle);

    var existingExtraSkills = (c.weaponExtraSkills && c.weaponExtraSkills[weaponId]) || [];
    if (existingExtraSkills.length) {
      var ref = existingExtraSkills[0];
      var display = resolveWeaponSkillDisplay(ref);
      var details = document.createElement("details");
      details.className = "ability-entry";
      var summary = document.createElement("summary");
      summary.textContent = display.name + (display.kind ? "［" + display.kind + "］" : "");
      details.appendChild(summary);
      if (display.body) {
        var p = document.createElement("p");
        p.className = "threat-ref-body";
        p.textContent = display.body;
        details.appendChild(p);
      }
      card.appendChild(details);

      var clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "danger-btn-sm";
      clearBtn.textContent = window.I18N.t("weapon_common_skill_clear_button");
      clearBtn.addEventListener("click", function () {
        c.weaponExtraSkills[weaponId] = [];
        saveFn();
        renderWeaponList();
      });
      card.appendChild(clearBtn);
    } else if (commonSkillSettingWeaponId === weaponId) {
      renderCommonSkillPicker(card, function (ref2) {
        if (!c.weaponExtraSkills) c.weaponExtraSkills = {};
        c.weaponExtraSkills[weaponId] = [ref2];
        commonSkillSettingWeaponId = null;
        saveFn();
        renderWeaponList();
      });
      var cancelSetBtn = document.createElement("button");
      cancelSetBtn.type = "button";
      cancelSetBtn.textContent = window.I18N.t("cancel_button");
      cancelSetBtn.addEventListener("click", function () {
        commonSkillSettingWeaponId = null;
        renderWeaponList();
      });
      card.appendChild(cancelSetBtn);
    } else {
      var setBtn = document.createElement("button");
      setBtn.type = "button";
      setBtn.textContent = window.I18N.t("weapon_common_skill_set_button");
      setBtn.addEventListener("click", function () {
        commonSkillSettingWeaponId = weaponId;
        renderWeaponList();
      });
      card.appendChild(setBtn);
    }

    var noteLabel = document.createElement("p");
    noteLabel.className = "boss-subheading";
    noteLabel.textContent = window.I18N.t("weapon_note_label");
    card.appendChild(noteLabel);
    var noteInput = document.createElement("textarea");
    noteInput.className = "weapon-note-input";
    noteInput.placeholder = window.I18N.t("weapon_note_placeholder");
    noteInput.value = (c.weaponNotes && c.weaponNotes[weaponId]) || "";
    noteInput.addEventListener("change", function () {
      if (!c.weaponNotes) c.weaponNotes = {};
      c.weaponNotes[weaponId] = noteInput.value;
      saveFn();
    });
    card.appendChild(noteInput);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger-btn";
    removeBtn.textContent = window.I18N.t("weapon_remove_button");
    removeBtn.addEventListener("click", function () {
      if (!window.confirm(window.I18N.t("weapon_remove_confirm", { name: Weapons.localizedText(weapon.name) }))) return;
      c.weaponIds.splice(c.weaponIds.indexOf(weaponId), 1);
      if (c.weaponRandomSkills) delete c.weaponRandomSkills[weaponId];
      if (c.weaponNotes) delete c.weaponNotes[weaponId];
      if (c.weaponExtraSkills) delete c.weaponExtraSkills[weaponId];
      if (c.equippedWeaponIds) {
        var eqIdx = c.equippedWeaponIds.indexOf(weaponId);
        if (eqIdx !== -1) c.equippedWeaponIds.splice(eqIdx, 1);
      }
      saveFn();
      (onRemoved || renderWeaponList)();
    });
    card.appendChild(removeBtn);

    container.appendChild(card);
  }

  function renderWeaponList() {
    var c = findCharacter(activeCharacterId);
    var container = document.getElementById("weapon-list");
    if (!container) return;
    container.innerHTML = "";
    if (!c) return;
    (c.weaponIds || []).forEach(function (id) {
      renderWeaponCard(container, id, c);
    });
  }

  // 盤面ロスター用：戦技名だけを簡潔に取り出す（本文・ランダム決定表UIは含めない）。
  // ランダム戦技は、既に抽出済み（c.weaponRandomSkills[weaponId]が設定済み）ならその
  // 戦技名だけを表示し、未決定の間は何も表示しない（冗長な案内文を出さない）。
  function weaponSkillRefName(ref, c, weaponId) {
    if (ref.kind === "random") {
      var resolvedValue = c && c.weaponRandomSkills && c.weaponRandomSkills[weaponId];
      if (!resolvedValue) return null;
      var display = resolveRandomSkillDisplay(resolvedValue);
      return display ? display.name : null;
    }
    if (ref.kind === "art") {
      var art = Weapons.getSkill(ref.id);
      return art ? Weapons.localizedText(art.name) : ref.id;
    }
    if (ref.kind === "innate") {
      var innate = null;
      Weapons.categories().forEach(function (cat) {
        (cat.innateSkills || []).forEach(function (s) {
          if (s.id === ref.id) innate = s;
        });
      });
      return innate ? Weapons.localizedText(innate.name) : ref.id;
    }
    if (ref.kind === "status") return window.I18N.t("weapon_status_skill_label", { status: Weapons.localizedText(ref.status) });
    if (ref.kind === "element") return window.I18N.t("weapon_element_skill_label", { element: Weapons.localizedText(ref.element) });
    if (ref.kind === "element_minus5")
      return window.I18N.t("weapon_element_minus5_skill_label", { element: Weapons.localizedText(ref.element) });
    if (ref.kind === "status_minus5")
      return window.I18N.t("weapon_status_minus5_skill_label", { status: Weapons.localizedText(ref.status) });
    if (ref.kind === "special") return window.I18N.t("weapon_special_skill_label", { target: Weapons.localizedText(ref.target) });
    if (ref.kind === "bonus") return Weapons.localizedText(ref.text);
    return null; // "note" 等、要約に含める意味のないもの
  }

  // 盤面ロスター（キャラクターの下）に出す武器要約1行：[装備チェック][名前(攻撃消耗)・戦技名, クリックで詳細][転交]
  // options.attackOnly=true の場合（戦闘モーダルの攻撃アクション用）は、装備中の武器だけに
  // 絞り込み、装備チェックボックスと転交ボタンは表示しない（閲覧専用の攻撃対象一覧にする）。
  function renderRosterWeaponList(c, container, options) {
    var attackOnly = !!(options && options.attackOnly);
    container.innerHTML = "";
    if (!c || !(c.weaponIds || []).length) return;
    if (!c.equippedWeaponIds) c.equippedWeaponIds = [];
    var weaponIds = attackOnly
      ? c.weaponIds.filter(function (id) {
          return c.equippedWeaponIds.indexOf(id) !== -1;
        })
      : c.weaponIds;
    weaponIds.forEach(function (weaponId) {
      var weapon = Weapons.get(baseWeaponId(weaponId));
      if (!weapon) return;
      var category = Weapons.getCategory(weapon.category);
      var row = document.createElement("div");
      row.className = "roster-weapon-row";

      if (!attackOnly) {
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "roster-weapon-equip-check";
        checkbox.checked = c.equippedWeaponIds.indexOf(weaponId) !== -1;
        checkbox.title = window.I18N.t("weapon_equipped_label");
        checkbox.addEventListener("change", function () {
          var idx = c.equippedWeaponIds.indexOf(weaponId);
          if (checkbox.checked && idx === -1) {
            if (c.equippedWeaponIds.length >= MAX_EQUIPPED_WEAPONS) {
              checkbox.checked = false;
              showCharDrawerError(window.I18N.t("weapon_equip_max_note", { max: MAX_EQUIPPED_WEAPONS }));
              return;
            }
            c.equippedWeaponIds.push(weaponId);
          }
          if (!checkbox.checked && idx !== -1) c.equippedWeaponIds.splice(idx, 1);
          saveFn();
        });
        row.appendChild(checkbox);
      }

      var attackCost =
        category && !category.isShield ? Weapons.localizedText(category.basicStats.attackCost) : category ? Weapons.localizedText(category.basicStats.guardCost) : "";
      var skillRefs = (
        category && category.isShield ? (weapon.attachedEffect || []).concat(weapon.reverseArt || []) : weapon.skills || []
      ).concat((c.weaponExtraSkills && c.weaponExtraSkills[weaponId]) || []);
      var skillNames = skillRefs
        .map(function (ref) {
          return weaponSkillRefName(ref, c, weaponId);
        })
        .filter(function (n) {
          return n;
        });

      var damage = category && !category.isShield ? computeWeaponDamage(c, weaponId) : null;
      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "roster-weapon-name-btn";
      nameBtn.appendChild(
        document.createTextNode(
          Weapons.localizedText(weapon.name) +
            (attackCost ? "（" + attackCost + "）" : "") +
            (skillNames.length ? " ｜ " + skillNames.join("・") : "")
        )
      );
      if (damage) appendWeaponDamageTag(nameBtn, damage);
      nameBtn.addEventListener("click", function () {
        openWeaponDetailDrawer(c.id, weaponId);
      });
      row.appendChild(nameBtn);

      if (attackOnly) {
        container.appendChild(row);
        return;
      }

      var transferBtn = document.createElement("button");
      transferBtn.type = "button";
      transferBtn.className = "roster-weapon-transfer-btn";
      transferBtn.textContent = window.I18N.t("weapon_transfer_button");
      var transferSelect = document.createElement("select");
      transferSelect.className = "roster-weapon-transfer-select";
      transferSelect.hidden = true;
      transferBtn.addEventListener("click", function () {
        if (!transferSelect.hidden) {
          transferSelect.hidden = true;
          return;
        }
        transferSelect.innerHTML = "";
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = window.I18N.t("weapon_transfer_select_placeholder");
        transferSelect.appendChild(placeholder);
        characters
          .filter(function (other) {
            return other.entered && other.id !== c.id;
          })
          .forEach(function (other) {
            var opt = document.createElement("option");
            opt.value = other.id;
            opt.textContent = other.name;
            transferSelect.appendChild(opt);
          });
        transferSelect.hidden = false;
      });
      transferSelect.addEventListener("change", function () {
        var targetId = transferSelect.value;
        if (!targetId) return;
        var target = findCharacter(targetId);
        if (!target) return;
        c.weaponIds.splice(c.weaponIds.indexOf(weaponId), 1);
        var eqIdx = c.equippedWeaponIds.indexOf(weaponId);
        if (eqIdx !== -1) c.equippedWeaponIds.splice(eqIdx, 1);
        if (!target.weaponIds) target.weaponIds = [];
        // 移転先が既に同じid（枝番込み）の武器を持っている場合のみ、衝突を避けるため
        // 新しい枝番付きidへ振り直す（通常はそのままのidで移転する）。
        var newWeaponId =
          target.weaponIds.indexOf(weaponId) === -1 ? weaponId : makeWeaponInstanceId(baseWeaponId(weaponId), target);
        target.weaponIds.push(newWeaponId);
        if (c.weaponRandomSkills && c.weaponRandomSkills[weaponId] !== undefined) {
          if (!target.weaponRandomSkills) target.weaponRandomSkills = {};
          target.weaponRandomSkills[newWeaponId] = c.weaponRandomSkills[weaponId];
          delete c.weaponRandomSkills[weaponId];
        }
        if (c.weaponNotes && c.weaponNotes[weaponId] !== undefined) {
          if (!target.weaponNotes) target.weaponNotes = {};
          target.weaponNotes[newWeaponId] = c.weaponNotes[weaponId];
          delete c.weaponNotes[weaponId];
        }
        if (c.weaponExtraSkills && c.weaponExtraSkills[weaponId] !== undefined) {
          if (!target.weaponExtraSkills) target.weaponExtraSkills = {};
          target.weaponExtraSkills[newWeaponId] = c.weaponExtraSkills[weaponId];
          delete c.weaponExtraSkills[weaponId];
        }
        saveFn();
        renderRosterFn();
        if (activeCharacterId === c.id || activeCharacterId === target.id) renderWeaponList();
      });
      row.appendChild(transferBtn);
      row.appendChild(transferSelect);

      container.appendChild(row);
    });
  }

  // 盤面ロスターに出す裝飾品（タリスマン）要約1行：[名前][転交]
  function renderRosterTalismanList(c, container) {
    container.innerHTML = "";
    if (!c || !(c.talismanIds || []).length) return;
    c.talismanIds.forEach(function (talismanId) {
      var talisman = Talismans.get(talismanId);
      if (!talisman) return;
      var row = document.createElement("div");
      row.className = "roster-weapon-row";

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "roster-weapon-name-btn";
      nameBtn.textContent = Talismans.localizedText(talisman.name);
      nameBtn.addEventListener("click", function () {
        openTalismanDetailDrawer(c.id, talismanId);
      });
      row.appendChild(nameBtn);

      var transferBtn = document.createElement("button");
      transferBtn.type = "button";
      transferBtn.className = "roster-weapon-transfer-btn";
      transferBtn.textContent = window.I18N.t("weapon_transfer_button");
      var transferSelect = document.createElement("select");
      transferSelect.className = "roster-weapon-transfer-select";
      transferSelect.hidden = true;
      transferBtn.addEventListener("click", function () {
        if (!transferSelect.hidden) {
          transferSelect.hidden = true;
          return;
        }
        transferSelect.innerHTML = "";
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = window.I18N.t("weapon_transfer_select_placeholder");
        transferSelect.appendChild(placeholder);
        characters
          .filter(function (other) {
            return other.entered && other.id !== c.id;
          })
          .forEach(function (other) {
            var opt = document.createElement("option");
            opt.value = other.id;
            opt.textContent = other.name;
            transferSelect.appendChild(opt);
          });
        transferSelect.hidden = false;
      });
      transferSelect.addEventListener("change", function () {
        var targetId = transferSelect.value;
        if (!targetId) return;
        var target = findCharacter(targetId);
        if (!target) return;
        c.talismanIds.splice(c.talismanIds.indexOf(talismanId), 1);
        if (!target.talismanIds) target.talismanIds = [];
        if (target.talismanIds.indexOf(talismanId) === -1) target.talismanIds.push(talismanId);
        saveFn();
        renderRosterFn();
        if (activeCharacterId === c.id || activeCharacterId === target.id) renderTalismanList();
      });
      row.appendChild(transferBtn);
      row.appendChild(transferSelect);

      container.appendChild(row);
    });
  }

  // 盤面ロスターに出す消耗品要約1行：[名前(所持數)][転交数量][対象][確定]
  function renderRosterConsumableList(c, container) {
    container.innerHTML = "";
    if (!c) return;
    var ids = Object.keys(c.consumableCounts || {}).filter(function (id) {
      return (c.consumableCounts[id] || 0) > 0;
    });
    if (!ids.length) return;
    ids.forEach(function (consumableId) {
      var consumable = Consumables.get(consumableId);
      if (!consumable) return;
      var row = document.createElement("div");
      row.className = "roster-weapon-row";

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "roster-weapon-name-btn";
      nameBtn.textContent = Consumables.localizedText(consumable.name) + "（" + c.consumableCounts[consumableId] + "）";
      nameBtn.addEventListener("click", function () {
        openConsumableDetailDrawer(c.id, consumableId);
      });
      row.appendChild(nameBtn);

      var transferBtn = document.createElement("button");
      transferBtn.type = "button";
      transferBtn.className = "roster-weapon-transfer-btn";
      transferBtn.textContent = window.I18N.t("weapon_transfer_button");
      row.appendChild(transferBtn);

      var transferWrap = document.createElement("span");
      transferWrap.className = "roster-consumable-transfer-wrap";
      transferWrap.hidden = true;

      var qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.min = "1";
      qtyInput.title = window.I18N.t("consumable_transfer_qty_label");
      qtyInput.className = "roster-consumable-transfer-qty";

      var transferSelect = document.createElement("select");
      transferSelect.className = "roster-weapon-transfer-select";

      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = window.I18N.t("consumable_transfer_confirm_button");

      transferBtn.addEventListener("click", function () {
        if (!transferWrap.hidden) {
          transferWrap.hidden = true;
          return;
        }
        transferSelect.innerHTML = "";
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = window.I18N.t("weapon_transfer_select_placeholder");
        transferSelect.appendChild(placeholder);
        characters
          .filter(function (other) {
            return other.entered && other.id !== c.id;
          })
          .forEach(function (other) {
            var opt = document.createElement("option");
            opt.value = other.id;
            opt.textContent = other.name;
            transferSelect.appendChild(opt);
          });
        qtyInput.max = String(c.consumableCounts[consumableId] || 1);
        qtyInput.value = "1";
        transferWrap.hidden = false;
      });

      confirmBtn.addEventListener("click", function () {
        var targetId = transferSelect.value;
        if (!targetId) return;
        var target = findCharacter(targetId);
        if (!target) return;
        var have = c.consumableCounts[consumableId] || 0;
        var qty = parseInt(qtyInput.value, 10);
        if (isNaN(qty) || qty < 1) qty = 1;
        if (qty > have) qty = have;
        if (qty <= 0) return;
        c.consumableCounts[consumableId] = have - qty;
        if (c.consumableCounts[consumableId] <= 0) delete c.consumableCounts[consumableId];
        if (!target.consumableCounts) target.consumableCounts = {};
        target.consumableCounts[consumableId] = (target.consumableCounts[consumableId] || 0) + qty;
        saveFn();
        renderRosterFn();
        if (activeCharacterId === c.id || activeCharacterId === target.id) renderConsumableList();
      });

      transferWrap.appendChild(qtyInput);
      transferWrap.appendChild(transferSelect);
      transferWrap.appendChild(confirmBtn);
      row.appendChild(transferWrap);

      container.appendChild(row);
    });
  }

  function renderWeaponSearchResults(query) {
    var results = document.getElementById("weapon-search-results");
    if (!results) return;
    results.innerHTML = "";
    var matches = Weapons.search(query);
    if (matches.length === 0) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    matches.slice(0, 8).forEach(function (w) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "weapon-search-item";
      item.textContent = Weapons.localizedText(w.name) + "（" + w.rarity + "）";
      item.addEventListener("click", function () {
        var c = findCharacter(activeCharacterId);
        if (!c) return;
        if (!c.weaponIds) c.weaponIds = [];
        c.weaponIds.push(makeWeaponInstanceId(w.id, c));
        saveFn();
        renderWeaponList();
        var input = document.getElementById("weapon-search-input");
        input.value = "";
        results.innerHTML = "";
        results.hidden = true;
      });
      results.appendChild(item);
    });
  }

  // --- 武器の抽選入手（〔任意〕大分類→小分類 → 稀有度 → 武器 → ランダム戦技） ---
  // カテゴリを「武器」（大分類未指定）で始めた場合のみ、weapon_rulebook.js の
  // 「武器」大カテゴリ決定表〔4-1〕→小カテゴリ決定表〔4-2〕に従って先にカテゴリそのものを
  // 決定する（杖・聖印はこの手順の対象外＝最初からカテゴリ指定で選ぶ）。
  // 稀有度は「weapon_rulebook.js」のレア度決定表（★の数だけD6を振り、合計値で判定）に、
  // 武器決定は各WEAPONS項目の roll 範囲（例："1〜2"）に、戦技決定は各カテゴリの
  // randomSkillTable（単純な1D6）または namedSkillTables（"1・2／3"形式の複合ロール、杖・聖印用。
  // 個々の武器項目が持つ skills の {kind:"random", table:"A"} で使用する決定表が指定されている）に
  // それぞれ準拠する。各段階は「ロール結果を表示した上で手動でも上書きできる」形にし、
  // 既存の手動検索（renderWeaponSearchResults）とは独立して共存する。
  var ANY_WEAPON_CATEGORY = "__any_weapon__";
  // 個別カテゴリ（弓／大弓／弩／弩砲、小盾／中盾／大盾）をそのまま選ぶ以外に、大分類決定表の
  // 「射撃武器」「盾」をそのまま指定して、その小分類決定表だけを1D抽選するショートカットを設ける。
  var RANGED_GROUP_CATEGORY = "__ranged_group__";
  var SHIELD_GROUP_CATEGORY = "__shield_group__";
  var RANGED_GROUP_MAJOR_INDEX = 4;
  var SHIELD_GROUP_MAJOR_INDEX = 5;
  var weaponRollState = null;

  function resetWeaponRollState() {
    var firstCat = Weapons.categories()[0];
    weaponRollState = {
      potentialPower: null, // null=未選択／true=潜在する力／false=それ以外の装備品獲得
      favoredDie: null,
      favoredIndex: null,
      favoredResult: null,
      favoredNonWeaponNote: null,

      categoryId: firstCat ? firstCat.id : null,
      categoryResolved: true,
      majorGroupShortcut: null, // "射撃武器"/"盾"のグループ選択肢を選んだ場合のみ非null
      majorDie: null,
      majorIndex: null,
      minorDie: null,
      minorRerollNote: false,

      starCount: 1,
      rarityDice: null,
      raritySum: null,
      rarity: null,
      rarityConfirmed: false,

      itemDie: null,
      item: null,
      itemMissMessage: false,
      itemMissNote: null,

      skillTableLetter: null,
      skillDice: null,
      skillId: null,
      skillMissMessage: false,
    };
  }

  function parseRollRange(roll) {
    var m = String(roll || "").match(/^(\d+)(?:\s*[〜~]\s*(\d+))?/);
    if (!m) return null;
    var lo = parseInt(m[1], 10);
    var hi = m[2] ? parseInt(m[2], 10) : lo;
    return [lo, hi];
  }

  function getRarityBreakpoints() {
    if (!WeaponRulebook) return null;
    var table = WeaponRulebook.rarityTable();
    var headers = table.columns.slice(1);
    var rarityCells = table.rows[0].slice(1);
    return headers.map(function (h, i) {
      var text = Weapons.localizedText(h);
      var m = text.match(/^(\d+)(?:[〜~](\d+))?/);
      var lo = m ? parseInt(m[1], 10) : 0;
      var hi = m && m[2] ? parseInt(m[2], 10) : text.indexOf("以上") !== -1 || text.indexOf("+") !== -1 ? Infinity : lo;
      var rarityText = Weapons.localizedText(rarityCells[i]);
      var rarityLetter = (rarityText.match(/[CURL]/) || [])[0] || "C";
      return { lo: lo, hi: hi, rarity: rarityLetter };
    });
  }

  function lookupRarityBySum(sum) {
    var bps = getRarityBreakpoints();
    if (!bps) return null;
    for (var i = 0; i < bps.length; i++) {
      if (sum >= bps[i].lo && sum <= bps[i].hi) return bps[i].rarity;
    }
    return bps[bps.length - 1].rarity;
  }

  function pickWeaponByRoll(categoryId, rarity, dieValue) {
    var candidates = Weapons.list().filter(function (w) {
      return w.category === categoryId && w.rarity === rarity;
    });
    var ranged = candidates.filter(function (w) {
      var range = parseRollRange(w.roll);
      return range && dieValue >= range[0] && dieValue <= range[1];
    });
    if (ranged.length) return ranged[0];
    // この区分にダイス範囲を持つ武器が1つも無い場合（例:大弓の各稀有度のように、そもそも
    // その稀有度に武器が1種類しか無くロール自体が不要な区分）は、ノート専用のプレースホルダー
    // （「該当武器なし」等）を除いた唯一の実武器があれば、それをそのまま自動選出する。
    var hasAnyRangedWeapon = candidates.some(function (w) {
      return !!parseRollRange(w.roll);
    });
    if (!hasAnyRangedWeapon) {
      var realCandidates = candidates.filter(function (w) {
        return !isNotePlaceholderWeapon(w);
      });
      if (realCandidates.length === 1) return realCandidates[0];
    }
    return null;
  }

  function resolveSimpleTableRoll(category, d1) {
    var row = (category.randomSkillTable || []).filter(function (r) {
      return String(r.roll) === String(d1);
    })[0];
    return row || null;
  }

  function resolveNamedTableRoll(table, d1, d2) {
    for (var i = 0; i < table.rows.length; i++) {
      var row = table.rows[i];
      var parts = String(row.roll).split("／");
      if (parts.length !== 2) continue;
      var leftVals = parts[0].split("・").map(function (s) {
        return parseInt(s, 10);
      });
      var rightVal = parseInt(parts[1], 10);
      if (leftVals.indexOf(d1) !== -1 && rightVal === d2) return row;
    }
    return null;
  }

  // weapon_rulebook.js の小カテゴリ決定表セル（例："短剣（158頁）"）からページ参照を除いた
  // 名称で Weapons.categories() と突き合わせ、実データ上のカテゴリidを求める。
  function findCategoryIdByMinorLabel(label) {
    var name = String(label || "")
      .replace(/[（(].*?[）)]/g, "")
      .trim();
    if (!name) return null;
    var match = Weapons.categories().filter(function (c) {
      return Weapons.localizedText(c.name) === name;
    })[0];
    return match ? match.id : null;
  }

  // 盾は skills ではなく attachedEffect／reverseArt にランダム枠を持つ（renderWeaponCard の
  // skillRefs 判定と同じルール）。抽選フローでもここを見落とすとランダム戦技の解決漏れになる。
  function getItemSkillRefs(category, item) {
    if (category && category.isShield) {
      return (item.attachedEffect || []).concat(item.reverseArt || []);
    }
    return item.skills || [];
  }

  // 1人が同じ武器を複数所持できるように、c.weaponIdsの要素はカタログid（例:"rapier_x"）そのもの
  // か、2つ目以降の複製に付けた枝番付きid（例:"rapier_x::2"）のどちらかになる。カタログ参照時は
  // baseWeaponIdで枝番を取り除き、ランダム戦技／備考／装備状態のキーには常に完全なid（枝番込み）
  // を使うことで、複製ごとに独立した状態を持たせる（既存セーブの枝番なしidともそのまま互換）。
  function baseWeaponId(weaponId) {
    var idx = String(weaponId || "").indexOf("::");
    return idx === -1 ? weaponId : weaponId.slice(0, idx);
  }

  function makeWeaponInstanceId(catalogId, target) {
    var existing = (target.weaponIds || []).filter(function (id) {
      return id === catalogId || id.indexOf(catalogId + "::") === 0;
    });
    return existing.length === 0 ? catalogId : catalogId + "::" + (existing.length + 1);
  }

  // ノート専用（kind:"note"のみ）のプレースホルダー武器（例:「該当武器なし」）かどうか。
  // 実際に入手可能な武器（スキル無しの物も含む）と区別するために使う。
  function isNotePlaceholderWeapon(w) {
    var skills = (w && w.skills) || [];
    return skills.length === 1 && skills[0].kind === "note";
  }

  // ============================================================
  // ダメージ計算：稀有度補正+威力補正=戦技威力 + 武器威力 = 1hit基本 + 遺物効果 + 付帯効果 = 1hit傷害
  //              1hit基本*2 + 遺物効果 + 付帯効果 + 特典 = 2hit傷害
  // 遺物効果／付帯効果／特典は、習得済みの遺物効果・付帯効果・所持タリスマンの本文（自由文章）から
  // 「1Hit：+n／2Hit：+n」等の定型表現を正規表現で抽出するベストエフォート方式。文章が特殊な形式
  // （▲や□等の可変値、対応する定型パターンを持たない条件付き効果）の場合は0として扱う。
  var MAX_EQUIPPED_WEAPONS = 2;
  var RARITY_CORRECTION = { C: 0, U: 5, R: 10, L: 15 };
  var POWER_MOD_STAT_MAP = [
    ["筋力", "strength"],
    ["力量", "strength"],
    ["技量", "dex"],
    ["技巧", "dex"],
    ["バランス", "balance"],
    ["平衡", "balance"],
    ["知力", "intelligence"],
    ["智力", "intelligence"],
    ["信仰", "faith"],
    ["秘術", "arcane"],
    ["神秘", "arcane"],
  ];
  var RANGED_CATEGORY_IDS = ["bow", "greatbow", "crossbow", "ballista", "staff", "sacred_seal"];
  var HIT_DAMAGE_RE = /1Hit[：:]\s*([+＋－\-]\d+)[／\/]2Hit[：:]?\s*([+＋－\-]\d+)/;
  // 「1Hit：+▲／2Hit：+◆」のように数値の代わりに可変ボーナス記号が入る可能性に備えた版。
  var HIT_DAMAGE_SYMBOL_RE = /1Hit[：:]\s*[+＋]([▲◆])[／\/]2Hit[：:]?\s*[+＋]([▲◆])/;

  function normalizeSignedNumber(text) {
    var n = parseInt(String(text).replace(/＋/g, "+").replace(/－/g, "-"), 10);
    return isNaN(n) ? 0 : n;
  }

  function resolvePowerModStatKey(text) {
    var t = String(text || "");
    for (var i = 0; i < POWER_MOD_STAT_MAP.length; i++) {
      if (t.indexOf(POWER_MOD_STAT_MAP[i][0]) !== -1) return POWER_MOD_STAT_MAP[i][1];
    }
    return null;
  }

  // 対象テキストから「1Hit：+n／2Hit：+n」を抽出し[n1, n2, symbol1, symbol2]を返す（無ければ
  // [0,0,null,null]）。数値の代わりに「▲」「◆」等の可変ボーナス記号が入っている場合は、
  // 該当する数値は0のまま、symbol1/symbol2にその記号を入れて呼び出し側で表示に反映させる。
  function extractHitBonus(text) {
    var t = String(text || "");
    var m = HIT_DAMAGE_RE.exec(t);
    if (m) return [normalizeSignedNumber(m[1]), normalizeSignedNumber(m[2]), null, null];
    var sm = HIT_DAMAGE_SYMBOL_RE.exec(t);
    if (sm) return [0, 0, sm[1], sm[2]];
    return [0, 0, null, null];
  }

  // タリスマンの「威力補正「技量：+5、バランス：+5」」のような文章から、指定したstatKeyに
  // 該当する加算値だけを合計して返す。
  function talismanPowerModBonus(c, statKey) {
    if (!statKey) return 0;
    var total = 0;
    (c.talismanIds || []).forEach(function (id) {
      var t = Talismans.get(id);
      if (!t) return;
      // ja/zhの両方を数えると二重加算になるため、いずれか一方（ja優先）だけを見る。
      var text = (t.body && t.body.ja) || (t.body && t.body.zh);
      if (!text) return;
      var m = /威力補正[「『]([^」』]+)[」』]/.exec(text);
      if (!m) return;
      m[1].split(/[、，]/).forEach(function (clause) {
        var key = resolvePowerModStatKey(clause);
        var numMatch = /[+＋－\-]\s*\d+/.exec(clause);
        if (key === statKey && numMatch) total += normalizeSignedNumber(numMatch[0]);
      });
    });
    return total;
  }

  // 属性を強化する「毒蠍」系タリスマン（Hit数を問わず蓄積値+1）を、属性名（ja表記固定）から
  // 逆引きするための対応表。
  var SCORPION_TALISMAN_BY_ELEMENT_JA = {
    魔: "talisman_scorpion_magic",
    炎: "talisman_scorpion_flame",
    雷: "talisman_scorpion_thunder",
    聖: "talisman_scorpion_sacred",
  };

  // 武器が持つ元素／状態異常スキル（kind:"element"/"status"/"element_minus5"/"status_minus5"）
  // から、攻撃で実際に発生する蓄積値（1Hitのとき+1、2Hitのとき+2）の元となる情報を返す。
  // 該当する毒蠍系タリスマンを所持している場合は、そのHit数分の加算値も含める。
  // 戻り値: [{ label, isElement, scorpionBonus }]（scorpionBonusは「Hit数を問わず+1」の値）
  function weaponAccumulationEffects(c, weaponId) {
    var weapon = Weapons.get(baseWeaponId(weaponId));
    if (!weapon) return [];
    var category = Weapons.getCategory(weapon.category);
    var skillRefs = (
      category && category.isShield ? (weapon.attachedEffect || []).concat(weapon.reverseArt || []) : weapon.skills || []
    ).concat((c.weaponExtraSkills && c.weaponExtraSkills[weaponId]) || []);
    var results = [];
    skillRefs.forEach(function (ref) {
      var actualRef = ref;
      if (ref.kind === "random") {
        var resolvedValue = c.weaponRandomSkills && c.weaponRandomSkills[weaponId];
        if (!resolvedValue || typeof resolvedValue === "string") return;
        actualRef = resolvedValue;
      }
      var isElement = actualRef.kind === "element" || actualRef.kind === "element_minus5";
      var isStatus = actualRef.kind === "status" || actualRef.kind === "status_minus5";
      if (!isElement && !isStatus) return;
      var fieldValue = isElement ? actualRef.element : actualRef.status;
      if (!fieldValue) return;
      var scorpionBonus = 0;
      if (isElement && fieldValue.ja && SCORPION_TALISMAN_BY_ELEMENT_JA[fieldValue.ja]) {
        var talismanId = SCORPION_TALISMAN_BY_ELEMENT_JA[fieldValue.ja];
        if ((c.talismanIds || []).indexOf(talismanId) !== -1) scorpionBonus = 1;
      }
      results.push({ label: Weapons.localizedText(fieldValue), isElement: isElement, scorpionBonus: scorpionBonus });
    });
    return results;
  }

  // 武器固有スキル（innate）が持つ、単独装備時のみ発揮する固定の「アタックのダメージを
  // 1Hit：+N／2Hit：+M」ボーナス（例：直剣の二本差し、大剣・斧槍・槌等の両手持ちダメージ＋）を
  // 計算する。weaponInnatePowerAdjustment（武器威力：±N）とは別枠で扱う（武器威力に乗せると
  // 2Hitで2倍計上され二重加算になるため、1Hit/2Hitのダメージへ直接加算する）。
  function weaponInnateHitBonus(c, weaponId, weapon) {
    var soloEquipped = (c.equippedWeaponIds || []).length === 1 && c.equippedWeaponIds[0] === weaponId;
    var hit1 = 0,
      hit2 = 0;
    (weapon.skills || []).forEach(function (ref) {
      if (ref.kind !== "innate") return;
      var innate = null;
      Weapons.categories().forEach(function (cat) {
        (cat.innateSkills || []).forEach(function (s) {
          if (s.id === ref.id) innate = s;
        });
      });
      if (!innate) return;
      var text = (innate.body && innate.body.ja) || (innate.body && innate.body.zh);
      if (!text) return;
      // 「他の武器を装備状態にしておらず」等の単独装備条件が明記されている場合は、
      // この武器を単独装備しているときだけ加算する（categoryTwoHitBonusと同じ判定方針）。
      if (text.indexOf("他の武器") !== -1 && !soloEquipped) return;
      var b = extractHitBonus(text);
      hit1 += b[0];
      hit2 += b[1];
    });
    return { hit1: hit1, hit2: hit2 };
  }

  // タリスマン起因の、条件付き／射撃武器専用の固定アタックダメージ加算。
  // ・talisman_sword_scorpion_charm：現在HP＝最大HP時、アタックのダメージを「1Hit：+5／2Hit：+10」
  // ・talisman_longbow／talisman_hardbow：射撃武器の1Hit／2Hitダメージにそれぞれ+5
  function talismanFlatHitBonus(c, weaponId, category) {
    var hit1 = 0,
      hit2 = 0;
    var isRanged = category && RANGED_CATEGORY_IDS.indexOf(category.id) !== -1;
    (c.talismanIds || []).forEach(function (id) {
      if (id === "talisman_sword_scorpion_charm" && c.hp && c.hp.current === c.hp.max) {
        hit1 += 5;
        hit2 += 10;
      }
      // 「□□□」は3マス＝HP3を表す（本タリスマンの表記に準拠したユーザー確認済みの値）。
      if (id === "talisman_crimson_seven_edge" && c.hp && c.hp.current <= 3) {
        hit1 += 5;
        hit2 += 5;
      }
      if (isRanged && id === "talisman_longbow") hit1 += 5;
      if (isRanged && id === "talisman_hardbow") hit2 += 5;
    });
    return { hit1: hit1, hit2: hit2 };
  }

  // タリスマン起因の、条件付きの固定「戦技／魔術／祈祷」ダメージ加算（computeSkillDamage側で
  // 使う）。
  // ・talisman_sword_scorpion_charm：現在HP＝最大HP時、戦技・魔術・祈祷のダメージを+5
  //   （アタックの1Hit：+5／2Hit：+10とは別記載のため、talismanFlatHitBonusとは別枠で扱う）
  // ・talisman_crimson_seven_edge：現在HP＝3（□□□）以下のとき、自身から発生するダメージ+5
  //   （アタック限定の記載ではなく「自身から発生するダメージ」全般が対象）
  function talismanFlatSkillBonus(c) {
    var bonus = 0;
    (c.talismanIds || []).forEach(function (id) {
      if (id === "talisman_sword_scorpion_charm" && c.hp && c.hp.current === c.hp.max) bonus += 5;
      if (id === "talisman_crimson_seven_edge" && c.hp && c.hp.current <= 3) bonus += 5;
    });
    return bonus;
  }

  // 武器が持つ特効スキル（kind:"special"、例：「エネミーが『死に生きる者』の場合、
  // 1Hit：+5／2Hit：+10」）は対象エネミーの種別を戦闘UI側で把握していないため、
  // ダメージへの自動加算はしない（誤って過大な数値を出さないため）。該当する場合のみ
  // 「対象が条件を満たすなら＋N」という参考情報として返す（UI側で任意表示する）。
  function weaponSpecialEffectNotes(weaponId) {
    var weapon = Weapons.get(baseWeaponId(weaponId));
    if (!weapon) return [];
    return (weapon.skills || [])
      .filter(function (ref) {
        return ref.kind === "special";
      })
      .map(function (ref) {
        return Weapons.localizedText(Weapons.specialEffectSkillBody(ref.target));
      });
  }

  // 武器自身が持つ「element_minus5／status_minus5」スキル（レア度C/U限定の武器威力-5スキル）や、
  // 固有スキル（innate、例：「武器威力＋10」）による武器威力の追加補正を合算する。
  function weaponInnatePowerAdjustment(weapon) {
    var total = 0;
    (weapon.skills || []).forEach(function (ref) {
      if (ref.kind === "element_minus5" || ref.kind === "status_minus5") {
        total -= 5;
        return;
      }
      if (ref.kind !== "innate") return;
      var innate = null;
      Weapons.categories().forEach(function (cat) {
        (cat.innateSkills || []).forEach(function (s) {
          if (s.id === ref.id) innate = s;
        });
      });
      if (!innate) return;
      // ja/zhの両方を数えると二重加算になるため、いずれか一方（ja優先）だけを見る。
      var text = (innate.body && innate.body.ja) || (innate.body && innate.body.zh);
      if (text) {
        var m = /武器威力[」』]?[：:]\s*([+＋－\-]\d+)/.exec(text);
        if (m) total += normalizeSignedNumber(m[1]);
      }
    });
    return total;
  }

  // 「総合ダメージ」等の直後にある「+n」または「+▲／+◆」を1件抽出する共通ヘルパー。
  // 数値が見つかればvalueに、見つからず記号だけならsymbolに入れて返す。
  function extractTotalDamageBonus(text) {
    if (text.indexOf("総合ダメージ") === -1 && text.indexOf("總合傷害") === -1 && text.indexOf("總和傷害") === -1) {
      return { value: 0, symbol: null };
    }
    var m = /(?:総合ダメージ|總合傷害|總和傷害)[^0-9+＋▲◆]*([+＋]\s*\d+)/.exec(text);
    if (m) return { value: normalizeSignedNumber(m[1]), symbol: null };
    var sm = /(?:総合ダメージ|總合傷害|總和傷害)[^0-9+＋▲◆]*[+＋]\s*([▲◆])/.exec(text);
    if (sm) return { value: 0, symbol: sm[1] };
    return { value: 0, symbol: null };
  }

  // 特典（2Hit専用）：装備状態の近接武器に対して常時「2Hit特典：総合ダメージ＋n」を与える
  // タリスマンを所持している場合、その分を合算する。可変値「▲」等はsymbolとして返す。
  function talisman2HitBonus(c, weaponId, category) {
    if (!category || category.isShield || RANGED_CATEGORY_IDS.indexOf(category.id) !== -1) return { value: 0, symbol: null };
    if ((c.equippedWeaponIds || []).indexOf(weaponId) === -1) return { value: 0, symbol: null };
    var total = 0;
    var symbol = null;
    (c.talismanIds || []).forEach(function (id) {
      var t = Talismans.get(id);
      if (!t) return;
      // ja/zhの両方を数えると二重加算になるため、いずれか一方（ja優先）だけを見る。
      var text = (t.body && t.body.ja) || (t.body && t.body.zh);
      if (!text || text.indexOf("2Hit特典") === -1) return;
      var r = extractTotalDamageBonus(text);
      total += r.value;
      if (r.symbol) symbol = r.symbol;
    });
    return { value: total, symbol: symbol };
  }

  // 「2Hitアタックのダメージを「＋N」する」（拳・両刃剣・爪など。総合ダメージ表記ではないため
  // extractTotalDamageBonusでは拾えない）を検出する。
  var TWO_HIT_ATTACK_DAMAGE_RE = /2Hit.{0,2}アタックのダメージを[「\[]?[+＋]\s*(\d+)/;

  // 特典（2Hit専用）その2：武器カテゴリ自身が持つ「2Hitアタックによる総合ダメージ＋n」
  // （category.twoHitBonus、例：刀の「総合＆復帰ダメージ＋10」）。装備状態を問わず、その
  // カテゴリの武器であれば常に発揮される固有特典なので、talisman2HitBonusとは別に加算する。
  // ただし本文に「他の武器を装備状態にしておらず」等の単独装備条件が明記されている特典
  // （拳・両刃剣・爪の「＋10」等）は、この武器を単独装備しているときだけ加算する。
  function categoryTwoHitBonus(c, weaponId, category) {
    if (!category || !category.twoHitBonus) return { value: 0, symbol: null };
    var total = 0;
    var symbol = null;
    var soloEquipped = (c.equippedWeaponIds || []).length === 1 && c.equippedWeaponIds[0] === weaponId;
    category.twoHitBonus.forEach(function (bonus) {
      var text = (bonus.body && bonus.body.ja) || (bonus.body && bonus.body.zh);
      if (!text) return;
      if (text.indexOf("他の武器") !== -1 && !soloEquipped) return;
      var r = extractTotalDamageBonus(text);
      if (r.value === 0 && !r.symbol) {
        var m2 = TWO_HIT_ATTACK_DAMAGE_RE.exec(text);
        if (m2) r = { value: parseInt(m2[1], 10), symbol: null };
      }
      total += r.value;
      if (r.symbol) symbol = r.symbol;
    });
    return { value: total, symbol: symbol };
  }

  // 特典（2Hit専用）その3：武器カテゴリによっては、ダメージではなく「2Hitアタックの後、
  // 自身のスタミナダイスに固定点数Nを追加する」という特典を持つ（槍・刺剣＝1、大槍・重刺剣＝2、
  // 斧槍＝3）。ダメージ計算には関与しないため、実際にダイスを骰子池へ追加するのは
  // combat攻撃actionの2Hit確定処理側で行う（この関数は加算すべき固定点数だけを返す）。
  var TWO_HIT_STAMINA_DICE_RE = /スタミナダイスに(\d+)点を追加する/;

  function categoryTwoHitDiceBonus(category) {
    if (!category || !category.twoHitBonus) return 0;
    var value = 0;
    category.twoHitBonus.forEach(function (bonus) {
      var text = (bonus.body && bonus.body.ja) || (bonus.body && bonus.body.zh);
      if (!text) return;
      var m = TWO_HIT_STAMINA_DICE_RE.exec(text);
      if (m) value += parseInt(m[1], 10);
    });
    return value;
  }

  // 付帯効果（c.learnedAttachedEffects）：一部の効果は装備状況に条件がある
  // （two_hand_up＝武器を1つのみ装備、dual_wield_up＝同カテゴリの近接武器を2つ装備）。
  function attachedEffectAppliesTo(effect, c, weaponId, weapon) {
    if (effect.id === "two_hand_up") {
      return (c.equippedWeaponIds || []).length === 1 && c.equippedWeaponIds[0] === weaponId;
    }
    if (effect.id === "dual_wield_up") {
      var sameCategory = (c.equippedWeaponIds || []).filter(function (id) {
        var w = Weapons.get(baseWeaponId(id));
        return w && w.category === weapon.category;
      });
      return (c.equippedWeaponIds || []).length === 2 && sameCategory.length === 2 && (c.equippedWeaponIds || []).indexOf(weaponId) !== -1;
    }
    return true;
  }

  // 稀有度補正+威力補正=戦技威力（artPower）だけを計算する。武器種を問わず（杖・聖印・盾を
  // 含む）常に使う共通部分で、各アーツ／魔術／祈祷の「威力：N＋戦技威力」の解決に使う。
  var NON_HIT_CATEGORY_IDS = ["staff", "sacred_seal"];

  function computeArtPower(c, weaponId) {
    var weapon = Weapons.get(baseWeaponId(weaponId));
    if (!weapon) return null;
    var category = Weapons.getCategory(weapon.category);
    if (!category) return null;

    var rarityCorrection = RARITY_CORRECTION[weapon.rarity] || 0;
    var powerModText = weapon.powerModOverride ? Weapons.localizedText(weapon.powerModOverride) : Weapons.localizedText(category.basicStats.powerMod);
    var statKey = resolvePowerModStatKey(powerModText);
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var powerMod = (type && statKey && type.powerMod ? type.powerMod[statKey] || 0 : 0) + talismanPowerModBonus(c, statKey);
    return { rarityCorrection: rarityCorrection, powerMod: powerMod, artPower: rarityCorrection + powerMod };
  }

  // 武器1つ分のダメージ内訳を計算する。盾／杖／聖印（1Hit・2Hitの概念を持たない武器種）や
  // カテゴリ不明の場合はnullを返す（杖・聖印は各魔術／祈祷ごとにcomputeArtPowerを使う）。
  function computeWeaponDamage(c, weaponId) {
    var weapon = Weapons.get(baseWeaponId(weaponId));
    if (!weapon) return null;
    var category = Weapons.getCategory(weapon.category);
    if (!category || category.isShield || NON_HIT_CATEGORY_IDS.indexOf(category.id) !== -1) return null;

    var artInfo = computeArtPower(c, weaponId);
    var rarityCorrection = artInfo.rarityCorrection;
    var powerMod = artInfo.powerMod;
    var artPower = artInfo.artPower;

    var weaponPowerRaw = category.basicStats.weaponPower;
    var weaponPowerBase = (typeof weaponPowerRaw === "number" ? weaponPowerRaw : parseInt(weaponPowerRaw, 10) || 0) + weaponInnatePowerAdjustment(weapon);

    var hit1Base = artPower + weaponPowerBase;

    var charType = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var relic1 = 0,
      relic2 = 0,
      hit1Symbol = null,
      hit2Symbol = null;
    (c.learnedRelicEffects || []).forEach(function (key) {
      var effect = charType ? relicEffectForKey(charType, key) : null;
      if (!effect || effect.kind !== "Passive") return;
      var bJa = extractHitBonus(effect.body && effect.body.ja);
      var b = bJa[0] || bJa[1] || bJa[2] || bJa[3] ? bJa : extractHitBonus(effect.body && effect.body.zh);
      relic1 += b[0];
      relic2 += b[1];
      if (b[2]) hit1Symbol = b[2];
      if (b[3]) hit2Symbol = b[3];
    });

    var attached1 = 0,
      attached2 = 0;
    (c.learnedAttachedEffects || []).forEach(function (id) {
      var effect = attachedEffectById(id);
      if (!effect || !attachedEffectAppliesTo(effect, c, weaponId, weapon)) return;
      var bJa = extractHitBonus(effect.body && effect.body.ja);
      var b = bJa[0] || bJa[1] || bJa[2] || bJa[3] ? bJa : extractHitBonus(effect.body && effect.body.zh);
      attached1 += b[0];
      attached2 += b[1];
      if (b[2]) hit1Symbol = b[2];
      if (b[3]) hit2Symbol = b[3];
    });

    var talismanBonus = talisman2HitBonus(c, weaponId, category);
    var categoryBonus = categoryTwoHitBonus(c, weaponId, category);
    var bonus2hit = talismanBonus.value + categoryBonus.value;
    if (talismanBonus.symbol) hit2Symbol = talismanBonus.symbol;
    if (categoryBonus.symbol) hit2Symbol = categoryBonus.symbol;

    var innateHitBonus = weaponInnateHitBonus(c, weaponId, weapon);
    var talismanFlatBonus = talismanFlatHitBonus(c, weaponId, category);

    var hit1Damage = hit1Base + relic1 + attached1 + innateHitBonus.hit1 + talismanFlatBonus.hit1;
    var hit2Damage = hit1Base * 2 + relic2 + attached2 + bonus2hit + innateHitBonus.hit2 + talismanFlatBonus.hit2;

    return {
      rarityCorrection: rarityCorrection,
      powerMod: powerMod,
      artPower: artPower,
      weaponPower: weaponPowerBase,
      hit1Base: hit1Base,
      relic1: relic1,
      relic2: relic2,
      attached1: attached1,
      attached2: attached2,
      bonus2hit: bonus2hit,
      hit1Damage: hit1Damage,
      hit2Damage: hit2Damage,
      hit1Symbol: hit1Symbol,
      hit2Symbol: hit2Symbol,
    };
  }

  function weaponDamageTagText(d) {
    if (!d) return "";
    return window.I18N.t("weapon_damage_hit_tag", {
      hit1: formatValueWithSymbol(d.hit1Damage, d.hit1Symbol),
      hit2: formatValueWithSymbol(d.hit2Damage, d.hit2Symbol),
    });
  }

  // 黄色・小さめのタグとして(1hit/2hit)を親要素へ追加する（他要素の色に影響しないようspanで囲む）。
  function appendWeaponDamageTag(parentEl, damage) {
    var tag = document.createElement("span");
    tag.className = "weapon-damage-tag";
    tag.textContent = weaponDamageTagText(damage);
    parentEl.appendChild(document.createTextNode(" "));
    parentEl.appendChild(tag);
  }

  function weaponDamageBreakdownText(d) {
    if (!d) return "";
    return window.I18N.t("weapon_damage_breakdown", {
      rarity: d.rarityCorrection,
      powerMod: d.powerMod,
      artPower: d.artPower,
      weaponPower: d.weaponPower,
      relic1: d.relic1,
      attached1: d.attached1,
      hit1: formatValueWithSymbol(d.hit1Damage, d.hit1Symbol),
      hit1Base: d.hit1Base,
      relic2: d.relic2,
      attached2: d.attached2,
      bonus2hit: d.bonus2hit,
      hit2: formatValueWithSymbol(d.hit2Damage, d.hit2Symbol),
    });
  }

  // 効果文中の「威力＋▲」「威力＋◆」のような、数値化できない可変ボーナス記号を検出する。
  // 見つかった場合は最終的な表示で「+▲」のように追記し、数値に含められないことを可視化する。
  function extractDamageSymbol(text) {
    var m = /威力[＋+]([▲◆])/.exec(String(text || ""));
    return m ? m[1] : null;
  }

  // 数値と（あれば）可変ボーナス記号を「45」または「45 + ▲」のような表示用文字列に組み立てる。
  function formatValueWithSymbol(value, symbol) {
    return symbol ? value + " + " + symbol : String(value);
  }

  // 戦技（art）の「威力：N＋戦技威力」から、指定した武器のartPowerを使ってm（=戦技の実際の威力）を
  // 計算する。パターンに合致しない場合はnullを返す（無理に数字を出さない）。
  function artSkillPowerValue(bodyText, artPower) {
    var m = /威力[：:]\s*(-?\d+)＋(?:戦技威力|戰技威力)/.exec(String(bodyText || ""));
    if (!m) return null;
    return { value: parseInt(m[1], 10) + artPower, symbol: extractDamageSymbol(bodyText) };
  }

  // 杖・聖印の魔術／祈祷は、原文に「＋戦技威力」の明記が無くても「威力：N」の印字値に対して
  // 常に戦技威力（稀有度補正＋威力補正）が加算される前提で計算する（近接武器のアーツとは異なり、
  // 「威力：N」だけの記載しかない資料が大半のため、明記の有無を問わず加算するベストエフォート）。
  function spellSkillPowerValue(bodyText, artPower) {
    var m = /威力[：:]\s*(-?\d+)/.exec(String(bodyText || ""));
    if (!m) return null;
    return { value: parseInt(m[1], 10) + artPower, symbol: extractDamageSymbol(bodyText) };
  }

  // タイプ（夜渡りタイプ）レベルの技能・遺物効果向け：本文中の「【総合ダメージ：N（＋▲等）】」
  // のように、武器の戦技威力に依存しない固定数値が直接書かれている場合だけそれを取り出す。
  // 「装備中の近接武器1つの1Hitダメージ」のような武器依存の記述はNにマッチしないため、
  // その場合は従来通りnull（数値を捏造しない）を返す。
  function fixedSkillPowerValue(bodyText) {
    var t = String(bodyText || "");
    var m = /(?:総合ダメージ|總合傷害|總和傷害)[：:]\s*(-?\d+)(?:[＋+]([▲◆]))?/.exec(t);
    if (!m) return null;
    return { value: parseInt(m[1], 10), symbol: m[2] || null };
  }

  // ============================================================
  // 骰子コスト（コスト／消耗欄）の解析・検証エンジン。
  // 対応する表記（ユーザー確認済みルール）：
  //   ・ゾロ／豹子／ソロ（N個）：同じ出目のダイスN個（ソロはゾロと同義、ルールブックの
  //     表記ゆれ／誤植と判断）
  //   ・連番／連號（N個）：連続する出目のダイスN個（重複不可）
  //   ・①②③のような丸数字の並び：各数字を合計した値が「必要な出目合計」になる
  //     （例：「③③」＝3+3=6必要、2+4の2個のダイスでも支払い可）
  //   ・「／FP■」：FPコスト（■の個数＝必要FP）
  //   （N〜M個）のように範囲がある場合は、その個数の範囲内であれば良い。
  // ============================================================
  var CIRCLED_DIGIT_MAP = { "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5, "⑥": 6 };

  function parseFpCost(text) {
    var m = /FP[／\/]?(■+)/.exec(String(text || "")) || /FP(■+)/.exec(String(text || ""));
    return m ? m[1].length : 0;
  }

  function parseHpCost(text) {
    var m = /HP[／\/]?(■+)/.exec(String(text || "")) || /HP(■+)/.exec(String(text || ""));
    return m ? m[1].length : 0;
  }

  // 「コスト：...」「消耗：...」の後ろにある、骰子コストのトークン部分（／FPや空白の手前まで）
  // だけを取り出す。
  function extractCostToken(text) {
    var m = /(?:コスト|消耗)[：:]\s*([^\s／\/]+)/.exec(String(text || ""));
    return m ? m[1] : null;
  }

  // 骰子コストの1トークン（例："ゾロ（2個）"「①①」「連番（2〜3個）"）を解析する。
  // 戻り値: { diceKind: "same"|"straight"|"sum"|null, diceCountMin, diceCountMax, sumTotal }
  function classifyDiceCostToken(token) {
    if (!token) return null;
    var sameMatch = /(?:ゾロ|豹子|ソロ)[（(](\d+)(?:[〜～](\d+))?個[）)]/.exec(token);
    if (sameMatch) {
      var sMin = parseInt(sameMatch[1], 10);
      return { diceKind: "same", diceCountMin: sMin, diceCountMax: sameMatch[2] ? parseInt(sameMatch[2], 10) : sMin, sumTotal: null };
    }
    var straightMatch = /(?:連番|連號)[（(](\d+)(?:[〜～](\d+))?個[）)]/.exec(token);
    if (straightMatch) {
      var stMin = parseInt(straightMatch[1], 10);
      return {
        diceKind: "straight",
        diceCountMin: stMin,
        diceCountMax: straightMatch[2] ? parseInt(straightMatch[2], 10) : stMin,
        sumTotal: null,
      };
    }
    var circledChars = token.match(/[①②③④⑤⑥]/g);
    if (circledChars && circledChars.length) {
      var sum = 0;
      circledChars.forEach(function (ch) {
        sum += CIRCLED_DIGIT_MAP[ch] || 0;
      });
      return { diceKind: "sum", diceCountMin: 1, diceCountMax: null, sumTotal: sum };
    }
    return null;
  }

  // 技能／護符等の本文から「コスト：」欄全体（骰子コスト＋FPコスト）を解析する。
  // 骰子コストが無い（FPのみ、または無コスト）場合はdiceKindがnullになる。
  function parseActionCost(text) {
    var t = String(text || "");
    var token = extractCostToken(t);
    var dice = token ? classifyDiceCostToken(token) : null;
    var fpCost = parseFpCost(t);
    var hpCost = parseHpCost(t);
    return {
      diceKind: dice ? dice.diceKind : null,
      diceCountMin: dice ? dice.diceCountMin : 0,
      diceCountMax: dice ? dice.diceCountMax : null,
      sumTotal: dice ? dice.sumTotal : null,
      fpCost: fpCost,
      hpCost: hpCost,
    };
  }

  // 武器カテゴリのattackCost欄「1Hit：③／2Hit：③③」を1Hit・2Hitそれぞれのコストへ分解する。
  function parseAttackCost(text) {
    var t = String(text || "");
    var m = /1Hit[：:]\s*([^／\/]+)[／\/]2Hit[：:]\s*([^／\/]+)/.exec(t);
    if (!m) return null;
    return {
      hit1: classifyDiceCostToken(m[1].trim()) || { diceKind: null, diceCountMin: 0, diceCountMax: null, sumTotal: null },
      hit2: classifyDiceCostToken(m[2].trim()) || { diceKind: null, diceCountMin: 0, diceCountMax: null, sumTotal: null },
    };
  }

  // 盾のguardCost欄（例："①"）を、renderDiceCostActionが期待するcost形状（FP/HPコスト無し）に変換する。
  function parseGuardCost(text) {
    var dice = classifyDiceCostToken(String(text || "").trim());
    return {
      diceKind: dice ? dice.diceKind : null,
      diceCountMin: dice ? dice.diceCountMin : 0,
      diceCountMax: dice ? dice.diceCountMax : null,
      sumTotal: dice ? dice.sumTotal : null,
      fpCost: 0,
      hpCost: 0,
    };
  }

  // 選択した骰子の出目配列（values）が、costの条件を満たすかどうかを判定する。
  function validateDiceSelection(cost, values) {
    if (!cost || !cost.diceKind) return values.length === 0;
    if (!values || !values.length) return false;
    if (cost.diceKind === "sum") {
      var sum = values.reduce(function (a, b) {
        return a + b;
      }, 0);
      return sum >= cost.sumTotal;
    }
    var count = values.length;
    if (count < cost.diceCountMin || (cost.diceCountMax !== null && count > cost.diceCountMax)) return false;
    if (cost.diceKind === "same") {
      return values.every(function (v) {
        return v === values[0];
      });
    }
    if (cost.diceKind === "straight") {
      var sorted = values.slice().sort(function (a, b) {
        return a - b;
      });
      for (var i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) return false;
      }
      return true;
    }
    // "count"：出目を問わず、個数の範囲さえ満たせば良い（格擋の「骰子消耗：N」など）。
    if (cost.diceKind === "count") return true;
    return false;
  }

  // コストを短い参考文字列にする（骰子選択UIの説明用）。
  function describeDiceCost(cost) {
    if (!cost || !cost.diceKind) return null;
    var countLabel = cost.diceCountMax && cost.diceCountMax !== cost.diceCountMin ? cost.diceCountMin + "〜" + cost.diceCountMax : cost.diceCountMin;
    if (cost.diceKind === "same") return window.I18N.t("dice_cost_same_label", { count: countLabel });
    if (cost.diceKind === "straight") return window.I18N.t("dice_cost_straight_label", { count: countLabel });
    if (cost.diceKind === "sum") return window.I18N.t("dice_cost_sum_label", { total: cost.sumTotal });
    if (cost.diceKind === "count") return window.I18N.t("dice_cost_count_label", { count: countLabel });
    return null;
  }

  // 隊列制限「隊列：前衛のとき使用可能」「隊列：後衛のとき使用可能」を検出する。
  // 「前衛・後衛どちらでも使用可能」やそもそも記載が無い場合はnull（制限なし）を返す。
  function parsePositionRestriction(text) {
    var t = String(text || "");
    if (t.indexOf("前衛・後衛どちらでも") !== -1 || t.indexOf("前衛・後衛皆可") !== -1) return null;
    if (t.indexOf("前衛のとき使用可能") !== -1 || t.indexOf("前衛時可使用") !== -1) return "front";
    if (t.indexOf("後衛のとき使用可能") !== -1 || t.indexOf("後衛時可使用") !== -1) return "back";
    return null;
  }

  function findNotePlaceholderWeapon(categoryId, rarity) {
    return (
      Weapons.list().filter(function (w) {
        return w.category === categoryId && w.rarity === rarity && isNotePlaceholderWeapon(w);
      })[0] || null
    );
  }

  function renderWeaponRollField() {
    var field = document.getElementById("weapon-roll-field");
    if (!field) return;
    if (!weaponRollState) resetWeaponRollState();
    var st = weaponRollState;

    field.innerHTML = "";

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "weapon-roll-toggle-btn";
    toggleBtn.textContent = window.I18N.t(field.dataset.open === "1" ? "weapon_roll_toggle_hide" : "weapon_roll_toggle_button");
    toggleBtn.addEventListener("click", function () {
      field.dataset.open = field.dataset.open === "1" ? "0" : "1";
      renderWeaponRollField();
    });
    field.appendChild(toggleBtn);

    if (field.dataset.open !== "1") return;

    var panel = document.createElement("div");
    panel.className = "weapon-roll-panel";

    // 潜在する力（Yes/No）：規則書154頁のACQUISITION_NOTEにある通り、潜在する力での獲得
    // だけ「得意武器のダイスを振る」手順が入る。それ以外（シナリオでカテゴリ指定済みの
    // 装備品獲得等）は従来通り手動でカテゴリを選ぶ。
    var potentialRow = document.createElement("div");
    potentialRow.className = "weapon-roll-row";
    var potentialLabel = document.createElement("label");
    potentialLabel.textContent = window.I18N.t("weapon_roll_potential_power_label");
    var potentialSelect = document.createElement("select");
    [
      { value: "", label: window.I18N.t("weapon_roll_potential_power_unset") },
      { value: "yes", label: window.I18N.t("yes_button") },
      { value: "no", label: window.I18N.t("no_button") },
    ].forEach(function (optDef) {
      var opt = document.createElement("option");
      opt.value = optDef.value;
      opt.textContent = optDef.label;
      if (
        (st.potentialPower === true && optDef.value === "yes") ||
        (st.potentialPower === false && optDef.value === "no") ||
        (st.potentialPower === null && optDef.value === "")
      ) {
        opt.selected = true;
      }
      potentialSelect.appendChild(opt);
    });
    potentialSelect.addEventListener("change", function () {
      var newValue = potentialSelect.value === "yes" ? true : potentialSelect.value === "no" ? false : null;
      resetWeaponRollState();
      weaponRollState.potentialPower = newValue;
      if (newValue === true) {
        weaponRollState.categoryId = null;
        weaponRollState.categoryResolved = false;
      }
      renderWeaponRollField();
    });
    potentialLabel.appendChild(potentialSelect);
    potentialRow.appendChild(potentialLabel);
    panel.appendChild(potentialRow);

    if (st.potentialPower === true) {
      var potentialChar = findCharacter(activeCharacterId);
      var potentialType = potentialChar && potentialChar.typeId ? CharacterTypes.get(potentialChar.typeId) : null;
      if (!potentialType) {
        var noTypeNote = document.createElement("p");
        noTypeNote.className = "threat-ref-body weapon-roll-result";
        noTypeNote.textContent = window.I18N.t("weapon_roll_potential_power_no_type");
        panel.appendChild(noTypeNote);
        field.appendChild(panel);
        return;
      }
      var favoredNames = CharacterTypes.localizedText(potentialType.favoredWeapons)
        .split("・")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);

      if (st.favoredIndex === null) {
        var favoredBtn = document.createElement("button");
        favoredBtn.type = "button";
        favoredBtn.className = "primary-btn";
        favoredBtn.textContent = window.I18N.t("weapon_roll_favored_button");
        favoredBtn.addEventListener("click", function () {
          var die = rollD6();
          st.favoredDie = die;
          var idx = die <= 3 ? 0 : die <= 5 ? 1 : 2;
          st.favoredIndex = idx;
          var name = favoredNames[idx] || null;
          st.favoredResult = name;
          if (name === "武器") {
            st.categoryId = null;
            st.categoryResolved = false;
            st.favoredNonWeaponNote = null;
          } else {
            var resolvedId = name ? findCategoryIdByMinorLabel(name) : null;
            if (resolvedId) {
              st.categoryId = resolvedId;
              st.categoryResolved = true;
              st.favoredNonWeaponNote = null;
            } else {
              st.categoryId = null;
              st.categoryResolved = false;
              st.favoredNonWeaponNote = name;
            }
          }
          renderWeaponRollField();
        });
        panel.appendChild(favoredBtn);
        field.appendChild(panel);
        return;
      }

      var favoredResultMsg = document.createElement("p");
      favoredResultMsg.className = "threat-ref-body weapon-roll-result";
      favoredResultMsg.textContent = window.I18N.t("weapon_roll_favored_result", {
        die: st.favoredDie,
        name: st.favoredResult || "-",
      });
      panel.appendChild(favoredResultMsg);

      if (st.favoredNonWeaponNote) {
        var nonWeaponMsg = document.createElement("p");
        nonWeaponMsg.className = "threat-ref-body weapon-roll-result";
        nonWeaponMsg.textContent = window.I18N.t("weapon_roll_favored_non_weapon_note", { name: st.favoredNonWeaponNote });
        panel.appendChild(nonWeaponMsg);
        field.appendChild(panel);
        return;
      }
    }

    // カテゴリ選択（「武器」を選ぶと大分類→小分類の抽選が挟まる／個別カテゴリなら即決定）。
    // 潜在する力＝はいで既にカテゴリが決まっている場合はこの手動選択欄自体を出さない。
    if (st.potentialPower !== true) {
      var configRow = document.createElement("div");
      configRow.className = "weapon-roll-row";
      var catLabel = document.createElement("label");
      catLabel.textContent = window.I18N.t("weapon_roll_category_label");
      var catSelect = document.createElement("select");
      var anyOpt = document.createElement("option");
      anyOpt.value = ANY_WEAPON_CATEGORY;
      anyOpt.textContent = window.I18N.t("weapon_roll_category_any_option");
      catSelect.appendChild(anyOpt);
      var rangedGroupOpt = document.createElement("option");
      rangedGroupOpt.value = RANGED_GROUP_CATEGORY;
      rangedGroupOpt.textContent = window.I18N.t("weapon_roll_category_ranged_group_option");
      catSelect.appendChild(rangedGroupOpt);
      var shieldGroupOpt = document.createElement("option");
      shieldGroupOpt.value = SHIELD_GROUP_CATEGORY;
      shieldGroupOpt.textContent = window.I18N.t("weapon_roll_category_shield_group_option");
      catSelect.appendChild(shieldGroupOpt);
      Weapons.categories().forEach(function (cat) {
        var opt = document.createElement("option");
        opt.value = cat.id;
        opt.textContent = Weapons.localizedText(cat.name);
        catSelect.appendChild(opt);
      });
      catSelect.value = st.categoryId !== null ? st.categoryId : st.majorGroupShortcut || ANY_WEAPON_CATEGORY;
      catSelect.addEventListener("change", function () {
        var newValue = catSelect.value;
        var prevPotentialPower = st.potentialPower;
        resetWeaponRollState();
        weaponRollState.potentialPower = prevPotentialPower;
        if (newValue === ANY_WEAPON_CATEGORY) {
          weaponRollState.categoryId = null;
          weaponRollState.categoryResolved = false;
        } else if (newValue === RANGED_GROUP_CATEGORY || newValue === SHIELD_GROUP_CATEGORY) {
          weaponRollState.categoryId = null;
          weaponRollState.categoryResolved = false;
          weaponRollState.majorGroupShortcut = newValue;
          weaponRollState.majorIndex = newValue === RANGED_GROUP_CATEGORY ? RANGED_GROUP_MAJOR_INDEX : SHIELD_GROUP_MAJOR_INDEX;
        } else {
          weaponRollState.categoryId = newValue;
          weaponRollState.categoryResolved = true;
        }
        renderWeaponRollField();
      });
      catLabel.appendChild(catSelect);
      configRow.appendChild(catLabel);
      panel.appendChild(configRow);
    }

    // 〔4-1〕〔4-2〕カテゴリ自体の抽選（「武器」を選んだときのみ）
    if (!st.categoryResolved) {
      if (st.majorIndex === null) {
        var majorBtn = document.createElement("button");
        majorBtn.type = "button";
        majorBtn.className = "primary-btn";
        majorBtn.textContent = window.I18N.t("weapon_roll_major_button");
        majorBtn.addEventListener("click", function () {
          var die = rollD6();
          st.majorDie = die;
          st.majorIndex = die - 1;
          renderWeaponRollField();
        });
        panel.appendChild(majorBtn);
      } else {
        var majorTable = WeaponRulebook.majorTable();
        var majorRow = majorTable.rows[st.majorIndex];
        // majorDieがnullの場合は「射撃武器」「盾」グループ選択肢のショートカットで大分類が
        // 既に確定しているケース（大分類自体は抽選していない）なので、抽選結果の文言は出さない。
        if (st.majorDie !== null) {
          var majorResult = document.createElement("p");
          majorResult.className = "threat-ref-body weapon-roll-result";
          majorResult.textContent = window.I18N.t("weapon_roll_major_result", {
            die: st.majorDie,
            label: Weapons.localizedText(majorRow[1]),
          });
          panel.appendChild(majorResult);
        }

        var minorTable = WeaponRulebook.minorTables()[st.majorIndex];
        var minorBtn = document.createElement("button");
        minorBtn.type = "button";
        minorBtn.className = "primary-btn";
        minorBtn.textContent = window.I18N.t("weapon_roll_minor_button");
        minorBtn.addEventListener("click", function () {
          var die = rollD6();
          st.minorDie = die;
          var row = null;
          for (var i = 0; i < minorTable.rows.length; i++) {
            var range = parseRollRange(Weapons.localizedText(minorTable.rows[i][0]));
            if (range && die >= range[0] && die <= range[1]) {
              row = minorTable.rows[i];
              break;
            }
          }
          var resolvedId = row ? findCategoryIdByMinorLabel(Weapons.localizedText(row[1])) : null;
          if (resolvedId) {
            st.categoryId = resolvedId;
            st.categoryResolved = true;
            st.minorRerollNote = false;
          } else {
            st.minorRerollNote = true;
          }
          renderWeaponRollField();
        });
        panel.appendChild(minorBtn);

        if (st.minorRerollNote) {
          var rerollMsg = document.createElement("p");
          rerollMsg.className = "threat-ref-body weapon-roll-result";
          rerollMsg.textContent = window.I18N.t("weapon_roll_minor_reroll_note", { die: st.minorDie });
          panel.appendChild(rerollMsg);
        }
      }
      field.appendChild(panel);
      return;
    }

    if (st.majorIndex !== null) {
      var categoryResolvedMsg = document.createElement("p");
      categoryResolvedMsg.className = "threat-ref-body weapon-roll-result";
      var resolvedCat = Weapons.getCategory(st.categoryId);
      categoryResolvedMsg.textContent = window.I18N.t("weapon_roll_category_resolved", {
        name: resolvedCat ? Weapons.localizedText(resolvedCat.name) : st.categoryId,
      });
      panel.appendChild(categoryResolvedMsg);
    }

    // ★選択・稀有度決定
    var starRow = document.createElement("div");
    starRow.className = "weapon-roll-row";
    var starLabel = document.createElement("label");
    starLabel.textContent = window.I18N.t("weapon_roll_star_label");
    var starSelect = document.createElement("select");
    [1, 2, 3, 4].forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = "★".repeat(n);
      if (n === st.starCount) opt.selected = true;
      starSelect.appendChild(opt);
    });
    starSelect.disabled = st.rarityConfirmed;
    starSelect.addEventListener("change", function () {
      st.starCount = parseInt(starSelect.value, 10);
    });
    starLabel.appendChild(starSelect);
    starRow.appendChild(starLabel);
    panel.appendChild(starRow);

    var category = Weapons.getCategory(st.categoryId);

    // ①稀有度決定（ロール後も手動で上書きし、「次へ」で確定するまでは編集可能）
    var step1Btn = document.createElement("button");
    step1Btn.type = "button";
    step1Btn.className = "primary-btn";
    step1Btn.textContent = window.I18N.t("weapon_roll_step1_button");
    step1Btn.disabled = st.rarityConfirmed;
    step1Btn.addEventListener("click", function () {
      var dice = [];
      for (var i = 0; i < st.starCount; i++) dice.push(rollD6());
      var sum = dice.reduce(function (a, b) {
        return a + b;
      }, 0);
      st.rarityDice = dice;
      st.raritySum = sum;
      st.rarity = lookupRarityBySum(sum);
      renderWeaponRollField();
    });
    panel.appendChild(step1Btn);

    if (st.rarityDice) {
      var rarityResult = document.createElement("p");
      rarityResult.className = "threat-ref-body weapon-roll-result";
      rarityResult.textContent = window.I18N.t("weapon_roll_rarity_result", {
        dice: st.rarityDice.join("、"),
        sum: st.raritySum,
        rarity: st.rarity,
      });
      panel.appendChild(rarityResult);

      if (!st.rarityConfirmed) {
        var rarityRerollBtn = document.createElement("button");
        rarityRerollBtn.type = "button";
        rarityRerollBtn.textContent = window.I18N.t("weapon_roll_star_reroll_button");
        rarityRerollBtn.addEventListener("click", function () {
          st.rarityDice = null;
          st.raritySum = null;
          st.rarity = null;
          renderWeaponRollField();
        });
        panel.appendChild(rarityRerollBtn);
      }
    }

    if (st.rarity && !st.rarityConfirmed) {
      var rarityOverrideRow = document.createElement("div");
      rarityOverrideRow.className = "weapon-roll-row";
      var rarityOverrideLabel = document.createElement("label");
      rarityOverrideLabel.textContent = window.I18N.t("weapon_roll_rarity_override_label");
      var raritySelect = document.createElement("select");
      ["C", "U", "R", "L"].forEach(function (r) {
        var opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        if (r === st.rarity) opt.selected = true;
        raritySelect.appendChild(opt);
      });
      raritySelect.addEventListener("change", function () {
        st.rarity = raritySelect.value;
      });
      rarityOverrideLabel.appendChild(raritySelect);
      rarityOverrideRow.appendChild(rarityOverrideLabel);
      panel.appendChild(rarityOverrideRow);

      var rarityNextBtn = document.createElement("button");
      rarityNextBtn.type = "button";
      rarityNextBtn.className = "primary-btn";
      rarityNextBtn.textContent = window.I18N.t("weapon_roll_rarity_next_button");
      rarityNextBtn.addEventListener("click", function () {
        st.rarityConfirmed = true;
        renderWeaponRollField();
      });
      panel.appendChild(rarityNextBtn);
    }

    if (st.rarity && st.rarityConfirmed) {
      var rarityConfirmedResult = document.createElement("p");
      rarityConfirmedResult.className = "threat-ref-body weapon-roll-result";
      rarityConfirmedResult.textContent = window.I18N.t("weapon_roll_rarity_confirmed", { rarity: st.rarity });
      panel.appendChild(rarityConfirmedResult);

      // ②武器決定
      var step2Btn = document.createElement("button");
      step2Btn.type = "button";
      step2Btn.className = "primary-btn";
      step2Btn.textContent = window.I18N.t("weapon_roll_step2_button");
      step2Btn.disabled = !!st.item;
      step2Btn.addEventListener("click", function () {
        var die = rollD6();
        st.itemDie = die;
        var picked = pickWeaponByRoll(st.categoryId, st.rarity, die);
        if (!picked) {
          st.item = null;
          st.itemMissMessage = true;
          var placeholder = findNotePlaceholderWeapon(st.categoryId, st.rarity);
          st.itemMissNote = placeholder ? Weapons.localizedText(placeholder.skills[0].text) : null;
        } else {
          st.item = picked;
          st.itemMissMessage = false;
          st.itemMissNote = null;
          st.skillId = null;
          st.skillDice = null;
          var randomRef = getItemSkillRefs(category, picked).filter(function (s) {
            return s.kind === "random";
          })[0];
          st.skillTableLetter = randomRef && randomRef.table ? randomRef.table : null;
        }
        renderWeaponRollField();
      });
      panel.appendChild(step2Btn);

      if (st.itemMissMessage) {
        var missMsg = document.createElement("p");
        missMsg.className = "threat-ref-body weapon-roll-result";
        missMsg.textContent = st.itemMissNote || window.I18N.t("weapon_roll_item_none");
        panel.appendChild(missMsg);
      }

      if (st.item) {
        var itemResult = document.createElement("p");
        itemResult.className = "threat-ref-body weapon-roll-result";
        itemResult.textContent = window.I18N.t("weapon_roll_item_result", {
          die: st.itemDie,
          name: Weapons.localizedText(st.item.name),
          rarity: st.item.rarity,
        });
        panel.appendChild(itemResult);

        var noteSkill = getItemSkillRefs(category, st.item).filter(function (s) {
          return s.kind === "note";
        })[0];
        if (noteSkill) {
          var noteP = document.createElement("p");
          noteP.className = "threat-ref-body weapon-roll-result weapon-roll-note";
          noteP.textContent = Weapons.localizedText(noteSkill.text);
          panel.appendChild(noteP);
        }

        var needsSkillRoll = getItemSkillRefs(category, st.item).some(function (s) {
          return s.kind === "random";
        });

        if (needsSkillRoll) {
          var hasNamedTables = category.namedSkillTables && category.namedSkillTables.length;

          if (hasNamedTables && !st.skillId) {
            var tableIndexByLetter = {};
            category.namedSkillTables.forEach(function (t, idx) {
              var letter = (Weapons.localizedText(t.title).match(/[（(]([A-Z])[）)]/) || [])[1];
              if (letter) tableIndexByLetter[letter] = idx;
            });
            if (st.skillTableLetter && !(st.skillTableLetter in tableIndexByLetter)) st.skillTableLetter = null;
            if (!st.skillTableLetter) {
              var firstLetter = Object.keys(tableIndexByLetter)[0];
              st.skillTableLetter = firstLetter || null;
            }

            if (st.skillTableLetter) {
              var tableNoteP = document.createElement("p");
              tableNoteP.className = "threat-ref-body weapon-roll-result weapon-roll-note";
              tableNoteP.textContent = window.I18N.t("weapon_roll_skill_table_auto_note", { table: st.skillTableLetter });
              panel.appendChild(tableNoteP);
            }

            var tableSelectRow = document.createElement("div");
            tableSelectRow.className = "weapon-roll-row";
            var tblLabel = document.createElement("label");
            tblLabel.textContent = window.I18N.t("weapon_roll_skill_table_label");
            var tblSelect = document.createElement("select");
            category.namedSkillTables.forEach(function (t) {
              var letter = (Weapons.localizedText(t.title).match(/[（(]([A-Z])[）)]/) || [])[1];
              var opt = document.createElement("option");
              opt.value = letter || Weapons.localizedText(t.title);
              opt.textContent = Weapons.localizedText(t.title);
              if (opt.value === st.skillTableLetter) opt.selected = true;
              tblSelect.appendChild(opt);
            });
            tblSelect.addEventListener("change", function () {
              st.skillTableLetter = tblSelect.value;
            });
            tblLabel.appendChild(tblSelect);
            tableSelectRow.appendChild(tblLabel);
            panel.appendChild(tableSelectRow);
          }

          var step3Btn = document.createElement("button");
          step3Btn.type = "button";
          step3Btn.className = "primary-btn";
          step3Btn.textContent = window.I18N.t("weapon_roll_step3_button");
          step3Btn.disabled = !!st.skillId;
          step3Btn.addEventListener("click", function () {
            if (hasNamedTables) {
              var d1 = rollD6();
              var d2 = rollD6();
              st.skillDice = [d1, d2];
              var tableIndexByLetter2 = {};
              category.namedSkillTables.forEach(function (t, idx) {
                var letter = (Weapons.localizedText(t.title).match(/[（(]([A-Z])[）)]/) || [])[1];
                if (letter) tableIndexByLetter2[letter] = idx;
              });
              var idx = st.skillTableLetter !== null ? tableIndexByLetter2[st.skillTableLetter] : undefined;
              var table = idx !== undefined ? category.namedSkillTables[idx] : null;
              var row = table ? resolveNamedTableRoll(table, d1, d2) : null;
              st.skillId = row ? row.id : null;
              st.skillMissMessage = !row;
            } else {
              var d = rollD6();
              st.skillDice = [d];
              var row2 = resolveSimpleTableRoll(category, d);
              st.skillId = row2 ? row2.id : null;
              st.skillMissMessage = !row2;
            }
            renderWeaponRollField();
          });
          panel.appendChild(step3Btn);

          if (st.skillMissMessage) {
            var skillMissMsg = document.createElement("p");
            skillMissMsg.className = "threat-ref-body weapon-roll-result";
            skillMissMsg.textContent = window.I18N.t("weapon_roll_item_none");
            panel.appendChild(skillMissMsg);
          }

          if (st.skillId) {
            var resolvedSkill = Weapons.getSkill(st.skillId);
            var skillResult = document.createElement("p");
            skillResult.className = "threat-ref-body weapon-roll-result";
            skillResult.textContent = window.I18N.t("weapon_roll_skill_result", {
              dice: st.skillDice.join("、"),
              name: resolvedSkill ? Weapons.localizedText(resolvedSkill.name) : st.skillId,
            });
            panel.appendChild(skillResult);
          }
        }

        var confirmReady = !needsSkillRoll || !!st.skillId;
        var confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "primary-btn";
        confirmBtn.textContent = window.I18N.t("weapon_roll_confirm_button");
        confirmBtn.disabled = !confirmReady;
        confirmBtn.addEventListener("click", function () {
          var c = findCharacter(activeCharacterId);
          if (!c) return;
          if (!c.weaponIds) c.weaponIds = [];
          var newInstanceId = makeWeaponInstanceId(st.item.id, c);
          c.weaponIds.push(newInstanceId);
          if (st.skillId) {
            if (!c.weaponRandomSkills) c.weaponRandomSkills = {};
            c.weaponRandomSkills[newInstanceId] = st.skillId;
          }
          saveFn();
          resetWeaponRollState();
          field.dataset.open = "0";
          renderWeaponRollField();
          renderWeaponList();
        });
        panel.appendChild(confirmBtn);
      }
    }

    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = window.I18N.t("weapon_roll_reset_button");
    resetBtn.addEventListener("click", function () {
      var keepCategoryId = st.categoryId;
      var keepStarCount = st.starCount;
      resetWeaponRollState();
      weaponRollState.categoryId = keepCategoryId;
      weaponRollState.starCount = keepStarCount;
      renderWeaponRollField();
    });
    panel.appendChild(resetBtn);

    field.appendChild(panel);
  }

  // タリスマン（装飾品）：武器と異なり単体でPassive効果を1つ持つだけの単純な構造。
  function renderTalismanCard(container, talismanId, c, onRemoved) {
    var talisman = Talismans.get(talismanId);
    if (!talisman) return;

    var card = document.createElement("div");
    card.className = "relic-candidate-card";

    var title = document.createElement("div");
    title.className = "relic-candidate-name";
    title.textContent = Talismans.localizedText(talisman.name);
    card.appendChild(title);

    var body = document.createElement("p");
    body.className = "threat-ref-body";
    body.textContent = Talismans.localizedText(talisman.body);
    card.appendChild(body);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = window.I18N.t("weapon_remove_button");
    removeBtn.addEventListener("click", function () {
      c.talismanIds.splice(c.talismanIds.indexOf(talismanId), 1);
      saveFn();
      (onRemoved || renderTalismanList)();
    });
    card.appendChild(removeBtn);

    container.appendChild(card);
  }

  function renderTalismanList() {
    var c = findCharacter(activeCharacterId);
    var container = document.getElementById("talisman-list");
    if (!container) return;
    container.innerHTML = "";
    if (!c) return;
    (c.talismanIds || []).forEach(function (id) {
      renderTalismanCard(container, id, c);
    });
  }

  function renderTalismanSearchResults(query) {
    var results = document.getElementById("talisman-search-results");
    if (!results) return;
    results.innerHTML = "";
    var matches = Talismans.search(query);
    if (matches.length === 0) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    matches.slice(0, 8).forEach(function (t) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "weapon-search-item";
      item.textContent = Talismans.localizedText(t.name);
      item.addEventListener("click", function () {
        var c = findCharacter(activeCharacterId);
        if (!c) return;
        if (!c.talismanIds) c.talismanIds = [];
        if (c.talismanIds.indexOf(t.id) === -1) c.talismanIds.push(t.id);
        saveFn();
        renderTalismanList();
        var input = document.getElementById("talisman-search-input");
        input.value = "";
        results.innerHTML = "";
        results.hidden = true;
      });
      results.appendChild(item);
    });
  }

  // 消耗品：タリスマンと似た単純な構造だが、持有數（所持数）を持つ点が異なる。
  function renderConsumableCard(container, consumableId, c, onRemoved) {
    var consumable = Consumables.get(consumableId);
    if (!consumable) return;

    var card = document.createElement("div");
    card.className = "relic-candidate-card";

    var title = document.createElement("div");
    title.className = "relic-candidate-name";
    title.textContent = Consumables.localizedText(consumable.name);
    card.appendChild(title);

    var body = document.createElement("p");
    body.className = "threat-ref-body";
    body.textContent = Consumables.localizedText(consumable.body);
    card.appendChild(body);

    var countRow = document.createElement("div");
    countRow.className = "consumable-count-row";
    var countLabel = document.createElement("span");
    countLabel.textContent = window.I18N.t("consumable_count_label");
    countRow.appendChild(countLabel);
    var countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "0";
    countInput.value = String(c.consumableCounts[consumableId] || 0);
    countInput.addEventListener("change", function () {
      var n = parseInt(countInput.value, 10);
      if (isNaN(n) || n < 0) n = 0;
      c.consumableCounts[consumableId] = n;
      saveFn();
    });
    countRow.appendChild(countInput);
    card.appendChild(countRow);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = window.I18N.t("weapon_remove_button");
    removeBtn.addEventListener("click", function () {
      delete c.consumableCounts[consumableId];
      saveFn();
      (onRemoved || renderConsumableList)();
    });
    card.appendChild(removeBtn);

    container.appendChild(card);
  }

  function renderConsumableList() {
    var c = findCharacter(activeCharacterId);
    var container = document.getElementById("consumable-list");
    if (!container) return;
    container.innerHTML = "";
    if (!c) return;
    Object.keys(c.consumableCounts || {}).forEach(function (id) {
      renderConsumableCard(container, id, c);
    });
  }

  function renderConsumableSearchResults(query) {
    var results = document.getElementById("consumable-search-results");
    if (!results) return;
    results.innerHTML = "";
    var matches = Consumables.search(query);
    if (matches.length === 0) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    matches.slice(0, 8).forEach(function (i) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "weapon-search-item";
      item.textContent = Consumables.localizedText(i.name);
      item.addEventListener("click", function () {
        var c = findCharacter(activeCharacterId);
        if (!c) return;
        if (!c.consumableCounts) c.consumableCounts = {};
        if (!c.consumableCounts[i.id]) c.consumableCounts[i.id] = 1;
        saveFn();
        renderConsumableList();
        var input = document.getElementById("consumable-search-input");
        input.value = "";
        results.innerHTML = "";
        results.hidden = true;
      });
      results.appendChild(item);
    });
  }

  // "4-5"や"1-3（基本アイテム）"のような、先頭の数字（範囲）だけを取り出す共通パーサー。
  // タリスマン・消耗品どちらの決定表も同じ表記規則（ハイフン区切り＋任意の説明文）を使う。
  function parseDashRange(text) {
    var m = String(text || "").match(/^(\d+)(?:-(\d+))?/);
    if (!m) return null;
    var lo = parseInt(m[1], 10);
    var hi = m[2] ? parseInt(m[2], 10) : lo;
    return [lo, hi];
  }

  // --- 裝飾品（タリスマン）抽選：規則書200-202頁。①1D6で表A(1-3)/表B(4-6)を決定、
  // ②表内の6グループから1D6でグループを直接選び（groupIndex=die-1）、③グループ内の
  // アイテムをさらに1D6で決定する（各アイテムのroll欄の範囲表記に出目が収まる行を採用）。
  var talismanRollState = null;

  function resetTalismanRollState() {
    talismanRollState = {
      tableDie: null,
      tableLetter: null,
      groupDie: null,
      groupIndex: null,
      itemDie: null,
      item: null,
      itemMissMessage: false,
    };
  }

  function renderTalismanRollField() {
    var field = document.getElementById("talisman-roll-field");
    if (!field) return;
    if (!talismanRollState) resetTalismanRollState();
    var st = talismanRollState;

    field.innerHTML = "";

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "weapon-roll-toggle-btn";
    toggleBtn.textContent = window.I18N.t(field.dataset.open === "1" ? "talisman_roll_toggle_hide" : "talisman_roll_toggle_button");
    toggleBtn.addEventListener("click", function () {
      field.dataset.open = field.dataset.open === "1" ? "0" : "1";
      renderTalismanRollField();
    });
    field.appendChild(toggleBtn);

    if (field.dataset.open !== "1") return;

    var panel = document.createElement("div");
    panel.className = "weapon-roll-panel";

    var step1Btn = document.createElement("button");
    step1Btn.type = "button";
    step1Btn.className = "primary-btn";
    step1Btn.textContent = window.I18N.t("talisman_roll_step1_button");
    step1Btn.disabled = st.tableLetter !== null;
    step1Btn.addEventListener("click", function () {
      var die = rollD6();
      st.tableDie = die;
      st.tableLetter = die <= 3 ? "A" : "B";
      renderTalismanRollField();
    });
    panel.appendChild(step1Btn);

    if (st.tableLetter) {
      var step1Result = document.createElement("p");
      step1Result.className = "threat-ref-body weapon-roll-result";
      step1Result.textContent = window.I18N.t("talisman_roll_step1_result", { die: st.tableDie, table: st.tableLetter });
      panel.appendChild(step1Result);
    } else {
      field.appendChild(panel);
      return;
    }

    var tables = Talismans.acquisitionTables();
    var group = (st.tableLetter === "A" ? tables.groupsA : tables.groupsB)[st.groupIndex !== null ? st.groupIndex : -1];

    var step2Btn = document.createElement("button");
    step2Btn.type = "button";
    step2Btn.className = "primary-btn";
    step2Btn.textContent = window.I18N.t("talisman_roll_step2_button");
    step2Btn.disabled = st.groupIndex !== null;
    step2Btn.addEventListener("click", function () {
      var die = rollD6();
      st.groupDie = die;
      st.groupIndex = die - 1;
      renderTalismanRollField();
    });
    panel.appendChild(step2Btn);

    if (st.groupIndex !== null) {
      var step2Result = document.createElement("p");
      step2Result.className = "threat-ref-body weapon-roll-result";
      step2Result.textContent = window.I18N.t("talisman_roll_step2_result", { die: st.groupDie, group: st.groupIndex + 1 });
      panel.appendChild(step2Result);
      group = (st.tableLetter === "A" ? tables.groupsA : tables.groupsB)[st.groupIndex] || [];
    } else {
      field.appendChild(panel);
      return;
    }

    var step3Btn = document.createElement("button");
    step3Btn.type = "button";
    step3Btn.className = "primary-btn";
    step3Btn.textContent = window.I18N.t("talisman_roll_step3_button");
    step3Btn.disabled = !!st.item;
    step3Btn.addEventListener("click", function () {
      var die = rollD6();
      st.itemDie = die;
      var row = group.filter(function (r) {
        var range = parseDashRange(r.roll);
        return range && die >= range[0] && die <= range[1];
      })[0];
      if (row) {
        st.item = Talismans.get(row.id);
        st.itemMissMessage = !st.item;
      } else {
        st.item = null;
        st.itemMissMessage = true;
      }
      renderTalismanRollField();
    });
    panel.appendChild(step3Btn);

    if (st.itemMissMessage) {
      var missMsg = document.createElement("p");
      missMsg.className = "threat-ref-body weapon-roll-result";
      missMsg.textContent = window.I18N.t("talisman_roll_item_none");
      panel.appendChild(missMsg);
    }

    if (st.item) {
      var itemResult = document.createElement("p");
      itemResult.className = "threat-ref-body weapon-roll-result";
      itemResult.textContent = window.I18N.t("talisman_roll_item_result", {
        die: st.itemDie,
        name: Talismans.localizedText(st.item.name),
      });
      panel.appendChild(itemResult);

      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "primary-btn";
      confirmBtn.textContent = window.I18N.t("weapon_roll_confirm_button");
      confirmBtn.addEventListener("click", function () {
        var c = findCharacter(activeCharacterId);
        if (!c) return;
        if (!c.talismanIds) c.talismanIds = [];
        if (c.talismanIds.indexOf(st.item.id) === -1) c.talismanIds.push(st.item.id);
        saveFn();
        resetTalismanRollState();
        field.dataset.open = "0";
        renderTalismanRollField();
        renderTalismanList();
      });
      panel.appendChild(confirmBtn);
    }

    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = window.I18N.t("weapon_roll_reset_button");
    resetBtn.addEventListener("click", function () {
      resetTalismanRollState();
      renderTalismanRollField();
    });
    panel.appendChild(resetBtn);

    field.appendChild(panel);
  }

  // --- 消耗品抽選：この頁の決定表。①1D6で分類（1-3=基本アイテム／4-5=投擲系／6=調香瓶系）を、
  // ②1D6で分類内の具体的なアイテムを決定する。調香瓶系×出目6は表の注記通り「同じ分類内で
  // 再抽選」が必要なため、②のボタンを無効化せずそのまま振り直せるようにする。
  var consumableRollState = null;

  function resetConsumableRollState() {
    consumableRollState = {
      groupDie: null,
      groupLabel: null,
      itemDie: null,
      item: null,
      itemMissMessage: false,
      needsReroll: false,
    };
  }

  function resolveConsumableTableRow(d1, d2) {
    var table = Consumables.determineTable();
    for (var i = 0; i < table.rows.length; i++) {
      var row = table.rows[i];
      var groupRange = parseDashRange(row[0].ja);
      var dieRange = parseDashRange(row[1].ja);
      if (groupRange && dieRange && d1 >= groupRange[0] && d1 <= groupRange[1] && d2 >= dieRange[0] && d2 <= dieRange[1]) {
        return row;
      }
    }
    return null;
  }

  function renderConsumableRollField() {
    var field = document.getElementById("consumable-roll-field");
    if (!field) return;
    if (!consumableRollState) resetConsumableRollState();
    var st = consumableRollState;

    field.innerHTML = "";

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "weapon-roll-toggle-btn";
    toggleBtn.textContent = window.I18N.t(field.dataset.open === "1" ? "consumable_roll_toggle_hide" : "consumable_roll_toggle_button");
    toggleBtn.addEventListener("click", function () {
      field.dataset.open = field.dataset.open === "1" ? "0" : "1";
      renderConsumableRollField();
    });
    field.appendChild(toggleBtn);

    if (field.dataset.open !== "1") return;

    var panel = document.createElement("div");
    panel.className = "weapon-roll-panel";
    var table = Consumables.determineTable();

    var step1Btn = document.createElement("button");
    step1Btn.type = "button";
    step1Btn.className = "primary-btn";
    step1Btn.textContent = window.I18N.t("consumable_roll_step1_button");
    step1Btn.disabled = st.groupDie !== null;
    step1Btn.addEventListener("click", function () {
      var die = rollD6();
      st.groupDie = die;
      var row = table.rows.filter(function (r) {
        var range = parseDashRange(r[0].ja);
        return range && die >= range[0] && die <= range[1];
      })[0];
      st.groupLabel = row ? Consumables.localizedText(row[0]) : null;
      renderConsumableRollField();
    });
    panel.appendChild(step1Btn);

    if (st.groupDie !== null) {
      var step1Result = document.createElement("p");
      step1Result.className = "threat-ref-body weapon-roll-result";
      step1Result.textContent = window.I18N.t("consumable_roll_step1_result", { die: st.groupDie, group: st.groupLabel || "-" });
      panel.appendChild(step1Result);
    } else {
      field.appendChild(panel);
      return;
    }

    var step2Btn = document.createElement("button");
    step2Btn.type = "button";
    step2Btn.className = "primary-btn";
    step2Btn.textContent = window.I18N.t("consumable_roll_step2_button");
    step2Btn.disabled = !!st.item;
    step2Btn.addEventListener("click", function () {
      var die = rollD6();
      st.itemDie = die;
      var row = resolveConsumableTableRow(st.groupDie, die);
      if (!row) {
        st.item = null;
        st.itemMissMessage = true;
        st.needsReroll = false;
      } else {
        var nameField = row[2];
        var nameText = Consumables.localizedText(nameField);
        if (nameText.indexOf("※") !== -1) {
          st.item = null;
          st.itemMissMessage = false;
          st.needsReroll = true;
        } else {
          var found = Consumables.list().filter(function (it) {
            return it.name.ja === nameField.ja || it.name.ja.indexOf(nameField.ja) !== -1;
          })[0];
          st.item = found || null;
          st.itemMissMessage = !found;
          st.needsReroll = false;
        }
      }
      renderConsumableRollField();
    });
    panel.appendChild(step2Btn);

    if (st.needsReroll) {
      var rerollNote = document.createElement("p");
      rerollNote.className = "threat-ref-body weapon-roll-result";
      rerollNote.textContent = window.I18N.t("consumable_roll_reroll_note");
      panel.appendChild(rerollNote);
    }

    if (st.itemMissMessage) {
      var consumableMissMsg = document.createElement("p");
      consumableMissMsg.className = "threat-ref-body weapon-roll-result";
      consumableMissMsg.textContent = window.I18N.t("weapon_roll_item_none");
      panel.appendChild(consumableMissMsg);
    }

    if (st.item) {
      var consumableItemResult = document.createElement("p");
      consumableItemResult.className = "threat-ref-body weapon-roll-result";
      consumableItemResult.textContent = window.I18N.t("consumable_roll_item_result", {
        die: st.itemDie,
        name: Consumables.localizedText(st.item.name),
      });
      panel.appendChild(consumableItemResult);

      var consumableConfirmBtn = document.createElement("button");
      consumableConfirmBtn.type = "button";
      consumableConfirmBtn.className = "primary-btn";
      consumableConfirmBtn.textContent = window.I18N.t("weapon_roll_confirm_button");
      consumableConfirmBtn.addEventListener("click", function () {
        var c = findCharacter(activeCharacterId);
        if (!c) return;
        if (!c.consumableCounts) c.consumableCounts = {};
        c.consumableCounts[st.item.id] = (c.consumableCounts[st.item.id] || 0) + 1;
        saveFn();
        resetConsumableRollState();
        field.dataset.open = "0";
        renderConsumableRollField();
        renderConsumableList();
      });
      panel.appendChild(consumableConfirmBtn);
    }

    var consumableResetBtn = document.createElement("button");
    consumableResetBtn.type = "button";
    consumableResetBtn.textContent = window.I18N.t("weapon_roll_reset_button");
    consumableResetBtn.addEventListener("click", function () {
      resetConsumableRollState();
      renderConsumableRollField();
    });
    panel.appendChild(consumableResetBtn);

    field.appendChild(panel);
  }

  var characters = [];
  var activeCharacterId = null;
  var activeSkillsCharacterId = null;
  var activeWeaponDetailCharacterId = null;
  var activeWeaponDetailWeaponId = null;
  var activeTalismanDetailCharacterId = null;
  var activeTalismanDetailTalismanId = null;
  var activeConsumableDetailCharacterId = null;
  var activeConsumableDetailConsumableId = null;
  var saveFn = function () {};
  var onChangeFn = function () {};
  var renderRosterFn = function () {};
  // 盤面（night.js）から開いた場合はtrue。この場合「已入場」と「刪除角色」は
  // 副本管理ページ側でのみ操作させ、盤面の詳細ドロワーでは無効化する。
  var restrictEnteredAndDelete = false;

  function newCharacter(name, typeId) {
    // 選んだタイプの基本資源枠（resourceSlots）から、HP/FP/加護の上限（と満タンの初期値）を
    // 自動設定する。タイプ未選択（typeId無し）の場合は従来通り0/0のまま。
    var type = typeId ? CharacterTypes.get(typeId) : null;
    var slots = type ? type.resourceSlots : null;
    return {
      id: "c" + Date.now() + Math.floor(Math.random() * 1000),
      name: name,
      typeId: typeId || null,
      entered: false,
      hp: { current: slots ? slots.hp : 0, max: slots ? slots.hp : 0 },
      fp: { current: slots ? slots.fp : 0, max: slots ? slots.fp : 0 },
      notes: [],
      status: [],
      equipment: [],
      weapons: [],
      skills: [],
      items: [],
      level: 1,
      hpValue: 30,
      runes: 0,
      blessingSlots: { current: 0, max: slots ? slots.blessing : 0 },
      flaskBase: { current: 3, max: 3 },
      flaskExtra: { current: 0, max: 0 },
      flaskHealAmount: 3,
      revivalCount: 0,
      talismans: [],
      buildup: [],
      abilityUses: {},
      dicePool: [],
      learnedRelicEffects: [],
      learnedAttachedEffects: [],
      weaponIds: [],
      weaponRandomSkills: {},
      weaponNotes: {},
      weaponExtraSkills: {},
      equippedWeaponIds: [],
      talismanIds: [],
      consumableCounts: {},
      pendingActionBoxes: [],
    };
  }

  // 旧データ互換: 新フィールドが無い既存キャラクターに初期値を補完する
  // 聖杯瓶は元々「使用済み回数」（used）で保持していたが、「3/3なのに戦闘で使用不可と誤判定される」
  // バグの原因だったため「現在の残数」（current、HP/FPと同じ意味）へ移行した。旧データ（usedのみ
  // 持ちcurrentが無い）を読み込んだ場合、ここで「残数＝上限－使用済み」に変換して補う。
  function migrateFlaskField(field) {
    if (field && field.current === undefined && field.used !== undefined) {
      field.current = Math.max(0, (field.max || 0) - field.used);
      delete field.used;
    }
  }

  function ensureDefaults(c) {
    var fallback = newCharacter(c.name, c.typeId);
    Object.keys(fallback).forEach(function (key) {
      if (c[key] === undefined) c[key] = fallback[key];
    });
    migrateFlaskField(c.flaskBase);
    migrateFlaskField(c.flaskExtra);
    return c;
  }

  function findCharacter(id) {
    return (
      characters.filter(function (c) {
        return c.id === id;
      })[0] || null
    );
  }

  function renderTagList(field) {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    var container = document.getElementById("tag-list-" + field);
    if (!container) return;
    container.innerHTML = "";
    c[field].forEach(function (value, index) {
      var chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = value;

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tag-remove";
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        c[field].splice(index, 1);
        saveFn();
        renderTagList(field);
      });

      chip.appendChild(remove);
      container.appendChild(chip);
    });
  }

  function addTag(field) {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    var input = document.getElementById("tag-input-" + field);
    var value = input.value.trim();
    if (!value) return;
    c[field].push(value);
    input.value = "";
    saveFn();
    renderTagList(field);
  }

  // 1つのアビリティ/スキル/アーツ/遺物効果を折りたたみ表示（クリックで詳細展開）で描画する。
  // レベル未到達なら表示しない。使用回数がある場合は残り回数の増減ボタンも付ける。
  function renderAbilityEntry(container, entry, c) {
    if (entry.level && c.level < entry.level) return;
    var details = document.createElement("details");
    details.className = "ability-entry";
    var summary = document.createElement("summary");
    summary.textContent =
      CharacterTypes.localizedText(entry.name) +
      "［" + entry.kind + "］" +
      (entry.level ? "　" + window.I18N.t("ability_level_label", { level: entry.level }) : "");
    details.appendChild(summary);

    if (entry.uses && entry.id) {
      var usesRow = document.createElement("div");
      usesRow.className = "level-control ability-uses";

      var label = document.createElement("span");
      label.className = "ability-uses-label";
      label.textContent = window.I18N.t("ability_uses_label");

      var minus = document.createElement("button");
      minus.type = "button";
      minus.className = "level-btn";
      minus.textContent = "-";

      var value = document.createElement("span");
      value.className = "level-value";

      var plus = document.createElement("button");
      plus.type = "button";
      plus.className = "level-btn";
      plus.textContent = "+";

      var effectiveMax = entry.uses + getSkillUsesBonus(c);
      function remaining() {
        var v = c.abilityUses && c.abilityUses[entry.id];
        return typeof v === "number" ? v : effectiveMax;
      }
      function renderVal() {
        value.textContent = remaining() + "/" + effectiveMax;
      }
      renderVal();
      minus.addEventListener("click", function () {
        if (!c.abilityUses) c.abilityUses = {};
        c.abilityUses[entry.id] = Math.max(0, remaining() - 1);
        renderVal();
        saveFn();
      });
      plus.addEventListener("click", function () {
        if (!c.abilityUses) c.abilityUses = {};
        c.abilityUses[entry.id] = Math.min(effectiveMax, remaining() + 1);
        renderVal();
        saveFn();
      });

      usesRow.appendChild(label);
      usesRow.appendChild(minus);
      usesRow.appendChild(value);
      usesRow.appendChild(plus);
      details.appendChild(usesRow);
    }

    var body = document.createElement("p");
    body.className = "threat-ref-body";
    body.textContent = CharacterTypes.localizedText(entry.body);
    details.appendChild(body);

    container.appendChild(details);
  }

  // 戦闘モーダルの「技能」action用：レベル到達済み・Passive／Defenseを除いた、実際に使用ボタンを
  // 出す対象の技能一覧を返す（可発動技能＝Action、防禦フェイズ専用のDefenseは除外）。
  function getCombatSkillEntries(c, type) {
    if (!type) return [];
    var entries = [].concat(type.abilities || []).concat(type.skills || []).concat(type.arts || []);
    var learned = c.learnedRelicEffects || [];
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        if (learned.indexOf(relicEffectKey(type.id, gi, ei)) !== -1) entries.push(e);
      });
    });
    return entries.filter(function (entry) {
      if (entry.kind === "Passive" || entry.kind === "Defense") return false;
      if (entry.level && c.level < entry.level) return false;
      return true;
    });
  }

  // 戦闘モーダルの「技能」action用：装備中の武器・盾が持つ戦技（kind:"art"／"innate"のうち
  // Action種別のもの）を、type側のentryと同じ{id, name, body, kind}形式で返す。ランダム戦技枠は
  // 決定済み（c.weaponRandomSkills[weaponId]が設定済み）のものだけを対象にする。
  function getEquippedWeaponSkillEntries(c) {
    var Weapons = window.PriTestWeapons;
    var entries = [];
    (c.equippedWeaponIds || []).forEach(function (weaponId) {
      var weapon = Weapons.get(baseWeaponId(weaponId));
      if (!weapon) return;
      var category = Weapons.getCategory(weapon.category);
      var skillRefs = (
        category && category.isShield ? (weapon.attachedEffect || []).concat(weapon.reverseArt || []) : weapon.skills || []
      ).concat((c.weaponExtraSkills && c.weaponExtraSkills[weaponId]) || []);
      skillRefs.forEach(function (ref) {
        var actualRef = ref;
        if (ref.kind === "random") {
          var resolvedValue = c.weaponRandomSkills && c.weaponRandomSkills[weaponId];
          if (!resolvedValue) return;
          actualRef = typeof resolvedValue === "string" ? { kind: "art", id: resolvedValue } : resolvedValue;
        }
        var skill = null;
        if (actualRef.kind === "art") {
          skill = Weapons.getSkill(actualRef.id);
        } else if (actualRef.kind === "innate") {
          Weapons.categories().forEach(function (cat) {
            (cat.innateSkills || []).forEach(function (s) {
              if (s.id === actualRef.id) skill = s;
            });
          });
        }
        if (!skill || skill.kind !== "Action") return;
        entries.push({
          id: "wpn:" + weaponId + ":" + actualRef.id,
          name: skill.name,
          body: skill.body,
          kind: skill.kind,
          weaponName: Weapons.localizedText(weapon.name),
          weaponId: weaponId,
        });
      });
    });
    return entries;
  }

  // type（夜渡りタイプ）の全アビリティ/スキル/アーツ/遺物効果を
  // 「可発動技能（Action/Defense）」「被動能力（Passive）」の2コンテナに振り分けて描画する。
  // excludeDefense=trueの場合、［Defense］（防禦フェイズでの反応使用専用）は可発動技能に含めない
  // （戦闘モーダルの「技能」アクションは攻撃ターンでの発動を想定しているため）。
  function renderAbilitySections(c, type, activeContainer, passiveContainer, excludeDefense) {
    activeContainer.innerHTML = "";
    passiveContainer.innerHTML = "";
    if (!type) return;
    var entries = [].concat(type.abilities || []).concat(type.skills || []).concat(type.arts || []);
    var learned = c.learnedRelicEffects || [];
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      g.effects.forEach(function (e, ei) {
        if (learned.indexOf(relicEffectKey(type.id, gi, ei)) !== -1) entries.push(e);
      });
    });
    entries.forEach(function (entry) {
      if (excludeDefense && entry.kind === "Defense") return;
      renderAbilityEntry(entry.kind === "Passive" ? passiveContainer : activeContainer, entry, c);
    });
  }

  // タイプの基本数値（体力骰・リソース枠数・判定値・威力補正・得意武器＋任意で初期装備）を、
  // 本体ドロワーの参照欄と、画像クリックで開くスキル発動ウィンドウの両方から使う共通の行配列。
  function buildTypeStatLines(type, includeStartingEquipment) {
    var lines = [
      window.I18N.t("stat_stamina_dice") + window.I18N.t("colon_separator") + type.staminaDice.action + "／" + type.staminaDice.defense,
      window.I18N.t("stat_resource_slots") +
        window.I18N.t("colon_separator") +
        type.resourceSlots.hp + "／" + type.resourceSlots.fp + "／" + type.resourceSlots.blessing,
      window.I18N.t("stat_check_values") +
        window.I18N.t("colon_separator") +
        type.checkValues.luck + "／" + type.checkValues.physical + "／" + type.checkValues.mental,
      window.I18N.t("stat_power_mod") +
        window.I18N.t("colon_separator") +
        [
          type.powerMod.strength,
          type.powerMod.dex,
          type.powerMod.balance,
          type.powerMod.intelligence,
          type.powerMod.faith,
          type.powerMod.arcane,
        ].join("／"),
      window.I18N.t("stat_favored_weapons") + window.I18N.t("colon_separator") + CharacterTypes.localizedText(type.favoredWeapons),
    ];
    if (includeStartingEquipment) {
      lines.push(
        window.I18N.t("stat_starting_equipment") + window.I18N.t("colon_separator") + CharacterTypes.localizedText(type.startingEquipment)
      );
    }
    return lines;
  }

  function renderTypeReference(c) {
    var block = document.getElementById("type-reference-block");
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var badge = document.getElementById("character-type-badge");
    if (badge) {
      badge.textContent = type
        ? window.I18N.t("character_type_label") + window.I18N.t("colon_separator") + CharacterTypes.localizedName(type.name)
        : "";
    }
    var portrait = document.getElementById("character-portrait");
    if (portrait) {
      var src = type ? CharacterTypes.imagePath(type) : null;
      if (src) {
        portrait.src = src;
        portrait.alt = CharacterTypes.localizedName(type.name);
        portrait.hidden = false;
      } else {
        portrait.hidden = true;
      }
    }
    if (!block) return;
    if (!type) {
      block.hidden = true;
      document.getElementById("type-active-skills").innerHTML = "";
      document.getElementById("type-passives").innerHTML = "";
      return;
    }
    block.hidden = false;
    document.getElementById("type-reference-title").textContent = CharacterTypes.localizedName(type.name);
    document.getElementById("type-reference-stats").textContent = buildTypeStatLines(type, true).join("\n");

    renderAbilitySections(c, type, document.getElementById("type-active-skills"), document.getElementById("type-passives"));
  }

  function renderCharacterDicePool() {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    var listEl = document.getElementById("char-dice-pool-list");
    if (!listEl) return;
    renderDicePool(
      listEl,
      c.dicePool,
      function (index) {
        c.dicePool.splice(index, 1);
        saveFn();
        onChangeFn();
        renderCharacterDicePool();
      },
      document.getElementById("btn-char-dice-add")
    );
    renderDiceStatusLabel(document.getElementById("char-dice-pool-status"), c.dicePool);
  }

  function openDrawer(id) {
    activeCharacterId = id;
    var c = findCharacter(id);
    if (!c) return;

    commonSkillSettingWeaponId = null;
    document.getElementById("character-drawer-name").textContent = c.name;
    hideCharDrawerError();
    document.getElementById("char-entered").checked = c.entered;
    document.getElementById("char-hp-value").value = c.hpValue;
    renderAllStatSteppers(c);
    // 盤面（night.js）から開いた場合、已入場・刪除角色は副本管理ページ専用の操作として
    // 完全に非表示にする（無効化ではなく、そもそも見えない状態にする）。
    var enteredRow = document.getElementById("char-entered-row");
    var deleteBtn = document.getElementById("btn-delete-character");
    if (enteredRow) enteredRow.hidden = restrictEnteredAndDelete;
    if (deleteBtn) deleteBtn.hidden = restrictEnteredAndDelete;
    TAG_FIELDS.forEach(renderTagList);
    relicRolledDice = null;
    relicShowAll = false;
    attachedRollResult = null;
    attachedPendingCandidate = null;
    attachedShowAll = false;
    renderTypeReference(c);
    renderCharacterDicePool();
    renderRelicSection();
    renderLevelBonusMarkers(c);
    renderLevelNextCostMarker(c);
    renderRevivalBonusMarkers(c);
    renderAttachedSection();
    renderWeaponList();
    resetWeaponRollState();
    var weaponRollField = document.getElementById("weapon-roll-field");
    if (weaponRollField) weaponRollField.dataset.open = "0";
    renderWeaponRollField();
    var weaponSearchInput = document.getElementById("weapon-search-input");
    if (weaponSearchInput) {
      weaponSearchInput.value = "";
      weaponSearchInput.placeholder = window.I18N.t("weapon_search_placeholder");
    }
    var weaponSearchResults = document.getElementById("weapon-search-results");
    if (weaponSearchResults) weaponSearchResults.hidden = true;

    renderTalismanList();
    var talismanSearchInput = document.getElementById("talisman-search-input");
    if (talismanSearchInput) {
      talismanSearchInput.value = "";
      talismanSearchInput.placeholder = window.I18N.t("talisman_search_placeholder");
    }
    var talismanSearchResults = document.getElementById("talisman-search-results");
    if (talismanSearchResults) talismanSearchResults.hidden = true;
    resetTalismanRollState();
    var talismanRollField = document.getElementById("talisman-roll-field");
    if (talismanRollField) talismanRollField.dataset.open = "0";
    renderTalismanRollField();

    renderConsumableList();
    var consumableSearchInput = document.getElementById("consumable-search-input");
    if (consumableSearchInput) {
      consumableSearchInput.value = "";
      consumableSearchInput.placeholder = window.I18N.t("consumable_search_placeholder");
    }
    var consumableSearchResults = document.getElementById("consumable-search-results");
    if (consumableSearchResults) consumableSearchResults.hidden = true;
    resetConsumableRollState();
    var consumableRollField = document.getElementById("consumable-roll-field");
    if (consumableRollField) consumableRollField.dataset.open = "0";
    renderConsumableRollField();

    document.getElementById("character-drawer").classList.add("open");
  }

  function closeDrawer() {
    document.getElementById("character-drawer").classList.remove("open");
    activeCharacterId = null;
    onChangeFn();
  }

  // 角色画像クリックで左からスライドインする、可発動技能／被動能力だけの閲覧専用パネル
  function openSkillsDrawer(id) {
    var c = findCharacter(id);
    if (!c) return;
    activeSkillsCharacterId = id;
    // 補充説明タグ（notes）はこのスキル発動ウィンドウ最上部に表示するため、
    // ここから直接開かれた場合（本体ドロワーを経由しない盤面ロスターからの導線）にも
    // 対象キャラクターを反映できるよう、activeCharacterIdもここで合わせておく。
    activeCharacterId = id;
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    document.getElementById("skills-drawer-name").textContent =
      c.name + (type ? "（" + CharacterTypes.localizedName(type.name) + "）" : "");
    var statsBlock = document.getElementById("skills-drawer-stats-block");
    if (statsBlock) {
      if (type) {
        statsBlock.hidden = false;
        document.getElementById("skills-drawer-stats-title").textContent = window.I18N.t("stat_block_title");
        document.getElementById("skills-drawer-stats").textContent = buildTypeStatLines(type, false).join("\n");
      } else {
        statsBlock.hidden = true;
      }
    }
    renderTagList("notes");
    renderAbilitySections(c, type, document.getElementById("skills-drawer-active"), document.getElementById("skills-drawer-passive"));
    document.getElementById("skills-drawer").classList.add("open");
  }

  function closeSkillsDrawer() {
    document.getElementById("skills-drawer").classList.remove("open");
    activeSkillsCharacterId = null;
  }

  // 盤面ロスターの武器要約をクリックすると左からスライドインする、単一武器の詳細閲覧パネル
  function openWeaponDetailDrawer(characterId, weaponId) {
    var c = findCharacter(characterId);
    if (!c) return;
    activeWeaponDetailCharacterId = characterId;
    activeWeaponDetailWeaponId = weaponId;
    renderWeaponDetailDrawer();
    document.getElementById("weapon-detail-drawer").classList.add("open");
  }

  function renderWeaponDetailDrawer() {
    var c = findCharacter(activeWeaponDetailCharacterId);
    var container = document.getElementById("weapon-detail-drawer-body");
    if (!container) return;
    container.innerHTML = "";
    if (!c || !activeWeaponDetailWeaponId) return;
    renderWeaponCard(container, activeWeaponDetailWeaponId, c, function () {
      closeWeaponDetailDrawer();
      renderWeaponList();
      if (renderRosterFn) renderRosterFn();
    });
  }

  function closeWeaponDetailDrawer() {
    document.getElementById("weapon-detail-drawer").classList.remove("open");
    activeWeaponDetailCharacterId = null;
    activeWeaponDetailWeaponId = null;
  }

  // 盤面ロスターの裝飾品要約をクリックすると左からスライドインする、単一タリスマンの詳細閲覧パネル
  function openTalismanDetailDrawer(characterId, talismanId) {
    var c = findCharacter(characterId);
    if (!c) return;
    activeTalismanDetailCharacterId = characterId;
    activeTalismanDetailTalismanId = talismanId;
    renderTalismanDetailDrawer();
    document.getElementById("talisman-detail-drawer").classList.add("open");
  }

  function renderTalismanDetailDrawer() {
    var c = findCharacter(activeTalismanDetailCharacterId);
    var container = document.getElementById("talisman-detail-drawer-body");
    if (!container) return;
    container.innerHTML = "";
    if (!c || !activeTalismanDetailTalismanId) return;
    renderTalismanCard(container, activeTalismanDetailTalismanId, c, function () {
      closeTalismanDetailDrawer();
      renderTalismanList();
      if (renderRosterFn) renderRosterFn();
    });
  }

  function closeTalismanDetailDrawer() {
    document.getElementById("talisman-detail-drawer").classList.remove("open");
    activeTalismanDetailCharacterId = null;
    activeTalismanDetailTalismanId = null;
  }

  // 盤面ロスターの消耗品要約をクリックすると左からスライドインする、単一消耗品の詳細閲覧パネル
  function openConsumableDetailDrawer(characterId, consumableId) {
    var c = findCharacter(characterId);
    if (!c) return;
    activeConsumableDetailCharacterId = characterId;
    activeConsumableDetailConsumableId = consumableId;
    renderConsumableDetailDrawer();
    document.getElementById("consumable-detail-drawer").classList.add("open");
  }

  function renderConsumableDetailDrawer() {
    var c = findCharacter(activeConsumableDetailCharacterId);
    var container = document.getElementById("consumable-detail-drawer-body");
    if (!container) return;
    container.innerHTML = "";
    if (!c || !activeConsumableDetailConsumableId) return;
    renderConsumableCard(container, activeConsumableDetailConsumableId, c, function () {
      closeConsumableDetailDrawer();
      renderConsumableList();
      if (renderRosterFn) renderRosterFn();
    });
  }

  function closeConsumableDetailDrawer() {
    document.getElementById("consumable-detail-drawer").classList.remove("open");
    activeConsumableDetailCharacterId = null;
    activeConsumableDetailConsumableId = null;
  }

  function bindFieldSave(elId, apply) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener("change", function (e) {
      var c = findCharacter(activeCharacterId);
      if (!c) return;
      apply(c, e.target);
      saveFn();
      if (elId === "char-entered") onChangeFn();
      if (elId === "char-level") {
        relicRolledDice = null;
        renderTypeReference(c);
        renderRelicSection();
        renderLevelBonusMarkers(c);
        renderLevelNextCostMarker(c);
      }
    });
  }

  function handleDeleteCharacter() {
    var c = findCharacter(activeCharacterId);
    if (!c) return;
    if (!window.confirm(window.I18N.t("character_confirm_delete", { name: c.name }))) return;
    characters.splice(characters.indexOf(c), 1);
    saveFn();
    closeDrawer();
  }

  function bindEvents() {
    // 各ドロワー中央の細長い折りたたみタブ：data-close-btnが指す既存の閉じるボタンを
    // クリックしたことにして、状態リセットを含む既存のクローズ処理をそのまま再利用する。
    document.querySelectorAll(".drawer-close-tab[data-close-btn]").forEach(function (tab) {
      var targetBtn = document.getElementById(tab.dataset.closeBtn);
      if (targetBtn) tab.addEventListener("click", targetBtn.click.bind(targetBtn));
    });
    document.getElementById("btn-character-close").addEventListener("click", closeDrawer);
    document.getElementById("character-drawer-backdrop").addEventListener("click", closeDrawer);
    document.getElementById("btn-delete-character").addEventListener("click", handleDeleteCharacter);
    document.getElementById("character-portrait").addEventListener("click", function () {
      if (activeCharacterId) openSkillsDrawer(activeCharacterId);
    });
    document.getElementById("btn-skills-drawer-close").addEventListener("click", closeSkillsDrawer);
    document.getElementById("skills-drawer-backdrop").addEventListener("click", closeSkillsDrawer);
    var weaponDetailCloseBtn = document.getElementById("btn-weapon-detail-drawer-close");
    var weaponDetailBackdrop = document.getElementById("weapon-detail-drawer-backdrop");
    if (weaponDetailCloseBtn) weaponDetailCloseBtn.addEventListener("click", closeWeaponDetailDrawer);
    if (weaponDetailBackdrop) weaponDetailBackdrop.addEventListener("click", closeWeaponDetailDrawer);
    var talismanDetailCloseBtn = document.getElementById("btn-talisman-detail-drawer-close");
    var talismanDetailBackdrop = document.getElementById("talisman-detail-drawer-backdrop");
    if (talismanDetailCloseBtn) talismanDetailCloseBtn.addEventListener("click", closeTalismanDetailDrawer);
    if (talismanDetailBackdrop) talismanDetailBackdrop.addEventListener("click", closeTalismanDetailDrawer);
    var consumableDetailCloseBtn = document.getElementById("btn-consumable-detail-drawer-close");
    var consumableDetailBackdrop = document.getElementById("consumable-detail-drawer-backdrop");
    if (consumableDetailCloseBtn) consumableDetailCloseBtn.addEventListener("click", closeConsumableDetailDrawer);
    if (consumableDetailBackdrop) consumableDetailBackdrop.addEventListener("click", closeConsumableDetailDrawer);
    document.getElementById("btn-char-dice-add").addEventListener("click", function () {
      var c = findCharacter(activeCharacterId);
      if (!c || c.dicePool.length >= MAX_DICE_POOL) return;
      c.dicePool.push(rollD6());
      saveFn();
      onChangeFn();
      renderCharacterDicePool();
    });
    document.getElementById("btn-relic-roll").addEventListener("click", handleRelicRoll);
    document.getElementById("btn-relic-toggle-all").addEventListener("click", function () {
      relicShowAll = !relicShowAll;
      renderRelicAllList();
    });
    document.getElementById("btn-attached-roll-2d").addEventListener("click", handleAttachedRoll2D);
    document.getElementById("btn-attached-toggle-all").addEventListener("click", function () {
      attachedShowAll = !attachedShowAll;
      renderAttachedAllList();
    });
    var weaponSearchEl = document.getElementById("weapon-search-input");
    if (weaponSearchEl) {
      weaponSearchEl.addEventListener("input", function (e) {
        renderWeaponSearchResults(e.target.value);
      });
    }
    var talismanSearchEl = document.getElementById("talisman-search-input");
    if (talismanSearchEl) {
      talismanSearchEl.addEventListener("input", function (e) {
        renderTalismanSearchResults(e.target.value);
      });
    }
    var consumableSearchEl = document.getElementById("consumable-search-input");
    if (consumableSearchEl) {
      consumableSearchEl.addEventListener("input", function (e) {
        renderConsumableSearchResults(e.target.value);
      });
    }

    document.querySelectorAll(".tag-add-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addTag(btn.getAttribute("data-field"));
      });
    });
    TAG_FIELDS.forEach(function (field) {
      var input = document.getElementById("tag-input-" + field);
      if (!input) return;
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          addTag(field);
        }
      });
    });

    var buildupClearBtn = document.getElementById("btn-buildup-clear-all");
    if (buildupClearBtn) {
      buildupClearBtn.addEventListener("click", function () {
        var c = findCharacter(activeCharacterId);
        if (!c || !c.buildup || !c.buildup.length) return;
        if (!window.confirm(window.I18N.t("buildup_clear_all_confirm"))) return;
        c.buildup = [];
        saveFn();
        renderTagList("buildup");
      });
    }

    bindFieldSave("char-entered", function (c, el) {
      c.entered = el.checked;
    });
    bindFieldSave("char-hp-value", function (c, el) {
      c.hpValue = Number(el.value) || 0;
    });
    var characterDrawerPanel = document.querySelector("#character-drawer .drawer-panel");
    if (characterDrawerPanel) {
      characterDrawerPanel.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-stepper]");
        if (!btn) return;
        var def = STAT_STEPPERS.filter(function (d) {
          return d.id === btn.dataset.stepper;
        })[0];
        if (def) applyStatStepperDelta(def, Number(btn.dataset.delta));
      });
      bindLongPressEditValues(characterDrawerPanel);
    }

    window.addEventListener("i18n:change", function () {
      if (activeCharacterId) openDrawer(activeCharacterId);
      if (activeSkillsCharacterId) openSkillsDrawer(activeSkillsCharacterId);
      if (activeWeaponDetailCharacterId && activeWeaponDetailWeaponId) renderWeaponDetailDrawer();
      if (activeTalismanDetailCharacterId && activeTalismanDetailTalismanId) renderTalismanDetailDrawer();
      if (activeConsumableDetailCharacterId && activeConsumableDetailConsumableId) renderConsumableDetailDrawer();
    });
  }

  function init(options) {
    characters = options.characters;
    saveFn = options.save;
    onChangeFn = options.onChange || function () {};
    renderRosterFn = options.renderRoster || function () {};
    restrictEnteredAndDelete = !!options.restrictEnteredAndDelete;
    bindEvents();
  }

  window.PriTestCharacterDrawer = {
    init: init,
    open: openDrawer,
    close: closeDrawer,
    openSkills: openSkillsDrawer,
    closeSkills: closeSkillsDrawer,
    newCharacter: newCharacter,
    ensureDefaults: ensureDefaults,
    renderAbilitySections: renderAbilitySections,
    rollD6: rollD6,
    renderDicePool: renderDicePool,
    renderDiceDisplay: renderDiceDisplay,
    MAX_DICE_POOL: MAX_DICE_POOL,
    renderRosterWeaponList: renderRosterWeaponList,
    openWeaponDetailDrawer: openWeaponDetailDrawer,
    renderRosterTalismanList: renderRosterTalismanList,
    renderRosterConsumableList: renderRosterConsumableList,
    computeDiceStatus: computeDiceStatus,
    renderDiceStatusLabel: renderDiceStatusLabel,
    getPassiveAggroBonus: getPassiveAggroBonus,
    getFlaskHealBonus: getFlaskHealBonus,
    findLearnedRelicEffectByName: findLearnedRelicEffectByName,
    getSkillUsesBonus: getSkillUsesBonus,
    getCombatSkillEntries: getCombatSkillEntries,
    getEquippedWeaponSkillEntries: getEquippedWeaponSkillEntries,
    categoryTwoHitDiceBonus: categoryTwoHitDiceBonus,
    weaponAccumulationEffects: weaponAccumulationEffects,
    weaponSpecialEffectNotes: weaponSpecialEffectNotes,
    talismanFlatSkillBonus: talismanFlatSkillBonus,
    computeWeaponDamage: computeWeaponDamage,
    weaponDamageTagText: weaponDamageTagText,
    parseActionCost: parseActionCost,
    parseAttackCost: parseAttackCost,
    parseGuardCost: parseGuardCost,
    validateDiceSelection: validateDiceSelection,
    describeDiceCost: describeDiceCost,
    parsePositionRestriction: parsePositionRestriction,
    computeArtPower: computeArtPower,
    artSkillPowerValue: artSkillPowerValue,
    spellSkillPowerValue: spellSkillPowerValue,
    fixedSkillPowerValue: fixedSkillPowerValue,
    formatValueWithSymbol: formatValueWithSymbol,
  };
})();
