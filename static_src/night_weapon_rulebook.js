(function () {
  // Split out of night.js to keep file sizes manageable. Weapon rulebook tab rendering.
  // Depends on window.PriTestNightCore (state/roster/shared render helpers exported by night.js)
  // and, in a few spots, on other night_*.js sibling modules -- see night.js for the full module map.

  var CharacterTypes = window.PriTestCharacterTypes;

  var activeWeaponSubTab = "acquisition";

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
    majorBlock.appendChild(window.PriTestNightCore.buildBossTable(majorTable.columns, majorTable.rows, T));
    container.appendChild(majorBlock);

    WR.minorTables().forEach(function (tbl) {
      var block = document.createElement("div");
      block.className = "threat-ref-block";
      var h = document.createElement("h4");
      h.textContent = T(tbl.title);
      block.appendChild(h);
      block.appendChild(window.PriTestNightCore.buildBossTable(tbl.columns, tbl.rows, T));
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
    rarityBlock.appendChild(window.PriTestNightCore.buildBossTable(rarityTable.columns, rarityTable.rows, T));
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
      block.appendChild(window.PriTestNightCore.buildBossTable(columns, rows, identity));
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
        tblWrap.appendChild(window.PriTestNightCore.buildBossTable(tbl.columns, tbl.rows, WL));
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

  window.PriTestNightWeaponRulebook = {
    renderWeaponSkillRefEntry: renderWeaponSkillRefEntry,
    renderWeaponRulebookAll: renderWeaponRulebookAll,
  };
})();
