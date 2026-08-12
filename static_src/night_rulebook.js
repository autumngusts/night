(function () {
  // Split out of night.js to keep file sizes manageable. Boss/talisman/consumable/enemy/field/event/worldview/commands rulebook tab rendering.
  // Depends on window.PriTestNightCore (state/roster/shared render helpers exported by night.js)
  // and, in a few spots, on other night_*.js sibling modules -- see night.js for the full module map.

  var CharacterTypes = window.PriTestCharacterTypes;

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
        details.appendChild(window.PriTestNightCore.buildBossTable(boss.additionalEffectTable.columns, boss.additionalEffectTable.rows, T));
      }

      var actionsTitle = document.createElement("p");
      actionsTitle.className = "boss-subheading";
      actionsTitle.textContent = window.I18N.t("boss_actions_label");
      details.appendChild(actionsTitle);
      details.appendChild(window.PriTestNightCore.buildBossTable(boss.actionColumns, boss.actions, T));

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
    container.appendChild(window.PriTestNightCore.buildBossTable(table.columns, table.rows, window.PriTestConsumables.localizedText));
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
    wrap.appendChild(window.PriTestNightCore.buildBossTable(columns, rows, T));
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
    wrap.appendChild(window.PriTestNightCore.buildBossTable(columns, rows, T));
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

        // 敵の行動注釈（乱戦ダメージへの注釈など）や特殊効果に「擊破盧恩：N」の記述が
        // あっても、規則書タブには従来何も獲得手段が無かった（#9：enemies.js側）。
        var enemyRuneText =
          T(enemy.special || {}) +
          "\n" +
          (enemy.actions || [])
            .map(function (a) {
              return T(a.note || {});
            })
            .join("\n");
        window.PriTestNightFloorBreakthrough.appendRuneGrantRowIfDetected(details, enemyRuneText, "enemyRulebook_" + fam.id + "_" + enemy.id);

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
      block.appendChild(window.PriTestNightCore.buildBossTable(card.varianceTable.columns, card.varianceTable.rows, T));
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

        if (window.PriTestNightFloorBreakthrough.floorHasAnyReward(floor)) {
          var rewardBtn = document.createElement("button");
          rewardBtn.type = "button";
          rewardBtn.className = "field-floor-reward-btn";
          rewardBtn.textContent = window.I18N.t("floor_reward_open_button");
          rewardBtn.addEventListener("click", function () {
            window.PriTestNightFloorBreakthrough.openFloorRewardModal(floor);
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
      tblWrap.appendChild(window.PriTestNightCore.buildBossTable(tbl.columns, tbl.rows, T));
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

  // 規則書タブ「指令」（#11）：留言板で使える快速指令の一覧。handleChatCommandと一対一対応させる。
  var CHAT_COMMANDS = [
    { cmd: "/cleardice", key: "cleardice" },
    { cmd: "/rune x", key: "rune" },
    { cmd: "/clearenemy", key: "clearenemy" },
    // 使用者指定：場上因故遺失「目前所在位置」（黃框）而卡住時，GMが手動で復帰先の
    // カード番号を指定できるようにする（例：/movetocard 1）。
    { cmd: "/movetocard n", key: "movetocard" },
  ];

  // 留言板の入力欄へコマンド文字列をそのまま挿入する（自動送信はしない——/rune x や
  // /movetocard n のようにプレースホルダーを含むコマンドは、送出前にGMが実際の数値へ
  // 書き換える必要があるため）。挿入後は規則書モーダルを閉じて留言板を見せ、末尾の
  // プレースホルダー文字（あれば）を選択状態にして、そのまま数値を打ち込めるようにする。
  function pasteCommandToTurnMessageInput(cmdText) {
    var input = document.getElementById("turn-message-input");
    var modal = document.getElementById("rulebook-modal");
    if (!input) return;
    input.value = cmdText;
    if (modal) modal.hidden = true;
    input.focus();
    var lastSpace = cmdText.lastIndexOf(" ");
    if (lastSpace !== -1) {
      input.setSelectionRange(lastSpace + 1, cmdText.length);
    } else {
      input.setSelectionRange(cmdText.length, cmdText.length);
    }
  }

  function renderCommandsRulebook() {
    var container = document.getElementById("commands-rulebook-list");
    if (!container) return;
    container.innerHTML = "";
    var intro = document.createElement("p");
    intro.className = "worldview-text";
    intro.textContent = window.I18N.t("rulebook_commands_intro");
    container.appendChild(intro);
    CHAT_COMMANDS.forEach(function (entry) {
      var headerRow = document.createElement("div");
      headerRow.className = "commands-rulebook-header-row";
      var h = document.createElement("h4");
      h.className = "worldview-label";
      h.textContent = entry.cmd;
      headerRow.appendChild(h);
      var pasteBtn = document.createElement("button");
      pasteBtn.type = "button";
      pasteBtn.className = "gm-flow-action-btn";
      pasteBtn.textContent = window.I18N.t("chat_command_paste_button");
      pasteBtn.addEventListener("click", function () {
        pasteCommandToTurnMessageInput(entry.cmd);
      });
      headerRow.appendChild(pasteBtn);
      container.appendChild(headerRow);
      var p = document.createElement("p");
      p.className = "worldview-text";
      p.textContent = window.I18N.t("chat_command_desc_" + entry.key);
      container.appendChild(p);
    });
  }

  window.PriTestNightRulebook = {
    renderBossRulebook: renderBossRulebook,
    renderTalismanAcquisitionTable: renderTalismanAcquisitionTable,
    renderTalismanRulebook: renderTalismanRulebook,
    renderConsumableRulebook: renderConsumableRulebook,
    renderConsumableDetermineTable: renderConsumableDetermineTable,
    buildEnemyLevelTable: buildEnemyLevelTable,
    buildEnemyGuardValueTable: buildEnemyGuardValueTable,
    renderEnemyRulebookAll: renderEnemyRulebookAll,
    renderFieldLine: renderFieldLine,
    renderFieldRulebook: renderFieldRulebook,
    renderEventRulebook: renderEventRulebook,
    renderWorldviewRulebook: renderWorldviewRulebook,
    renderCommandsRulebook: renderCommandsRulebook,
  };
})();
