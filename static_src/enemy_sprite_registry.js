(function () {
  // sprite sheet 的登錄表。
  // 自動產生: node tools/sprite_check/sprite_registry_gen.js --write
  // 不要手動修改——要改分配就去改產生器的 OVERRIDES 再重新產生。
  //
  // available 是「圖片是否已產出」。false 期間 midnight_sprite.js 會 fallback 到既有的
  // 靜止畫（spec §4）。圖片放進來之後由 sprite_pack.js 改寫成 true；重新產生登錄表時
  // 產生器會逐 sheet 沿用這裡既有的值，不會把已驗收的成果歸零。
  //
  // sheet は 3 種類：family_*（系統の代表 1 張）／enemy_*（個別敵人專屬）／boss_*（夜王）。
  var SHEETS = [
    { id: "family_dragon_a", file: "family_dragon_a.png", available: true },
    { id: "family_dragon_b", file: "family_dragon_b.png", available: true },
    { id: "family_tree_spirit_a", file: "family_tree_spirit_a.png", available: true },
    { id: "family_tree_spirit_b", file: "family_tree_spirit_b.png", available: true },
    { id: "family_rock_spirit_beast_a", file: "family_rock_spirit_beast_a.png", available: true },
    { id: "family_rock_spirit_beast_b", file: "family_rock_spirit_beast_b.png", available: true },
    { id: "family_rat_basilisk_a", file: "family_rat_basilisk_a.png", available: true },
    { id: "family_rat_basilisk_b", file: "family_rat_basilisk_b.png", available: false },
    { id: "family_death_bird_raven_a", file: "family_death_bird_raven_a.png", available: true },
    { id: "family_death_bird_raven_b", file: "family_death_bird_raven_b.png", available: false },
    { id: "family_grafted_a", file: "family_grafted_a.png", available: true },
    { id: "family_grafted_b", file: "family_grafted_b.png", available: true },
    { id: "family_crustacean_a", file: "family_crustacean_a.png", available: true },
    { id: "family_crustacean_b", file: "family_crustacean_b.png", available: false },
    { id: "family_attacker_warrior_a", file: "family_attacker_warrior_a.png", available: true },
    { id: "family_attacker_warrior_b", file: "family_attacker_warrior_b.png", available: false },
    { id: "family_formless_other_a", file: "family_formless_other_a.png", available: true },
    { id: "family_formless_other_b", file: "family_formless_other_b.png", available: true },
    { id: "family_attacker_mage_a", file: "family_attacker_mage_a.png", available: true },
    { id: "family_attacker_mage_b", file: "family_attacker_mage_b.png", available: false },
    { id: "family_soldier_knight_a", file: "family_soldier_knight_a.png", available: true },
    { id: "family_soldier_knight_b", file: "family_soldier_knight_b.png", available: true },
    { id: "family_dog_wolf_a", file: "family_dog_wolf_a.png", available: true },
    { id: "family_dog_wolf_b", file: "family_dog_wolf_b.png", available: true },
    { id: "family_warrior_swordsman_a", file: "family_warrior_swordsman_a.png", available: true },
    { id: "family_warrior_swordsman_b", file: "family_warrior_swordsman_b.png", available: true },
    { id: "family_strong_type_a", file: "family_strong_type_a.png", available: true },
    { id: "family_strong_type_b", file: "family_strong_type_b.png", available: false },
    { id: "family_cavalry_a", file: "family_cavalry_a.png", available: true },
    { id: "family_cavalry_b", file: "family_cavalry_b.png", available: false },
    { id: "family_demihuman_beastfolk_club_a", file: "family_demihuman_beastfolk_club_a.png", available: true },
    { id: "family_demihuman_beastfolk_club_b", file: "family_demihuman_beastfolk_club_b.png", available: true },
    { id: "family_big_dog_bear_a", file: "family_big_dog_bear_a.png", available: true },
    { id: "family_big_dog_bear_b", file: "family_big_dog_bear_b.png", available: true },
    { id: "family_undead_a", file: "family_undead_a.png", available: true },
    { id: "family_undead_b", file: "family_undead_b.png", available: true },
    { id: "family_crystal_puppet_a", file: "family_crystal_puppet_a.png", available: true },
    { id: "family_crystal_puppet_b", file: "family_crystal_puppet_b.png", available: true },
    { id: "family_mage_messenger_a", file: "family_mage_messenger_a.png", available: true },
    { id: "family_mage_messenger_b", file: "family_mage_messenger_b.png", available: true },
    { id: "family_golem_maiden_puppet_a", file: "family_golem_maiden_puppet_a.png", available: true },
    { id: "family_golem_maiden_puppet_b", file: "family_golem_maiden_puppet_b.png", available: false },
    { id: "family_commoner_a", file: "family_commoner_a.png", available: true },
    { id: "family_commoner_b", file: "family_commoner_b.png", available: false },
    { id: "family_imp_watchdog_gargoyle_a", file: "family_imp_watchdog_gargoyle_a.png", available: true },
    { id: "family_imp_watchdog_gargoyle_b", file: "family_imp_watchdog_gargoyle_b.png", available: false },
    { id: "family_troll_dragonkin_wormface_a", file: "family_troll_dragonkin_wormface_a.png", available: true },
    { id: "family_troll_dragonkin_wormface_b", file: "family_troll_dragonkin_wormface_b.png", available: true },
    { id: "family_page_lowly_soldier_a", file: "family_page_lowly_soldier_a.png", available: true },
    { id: "family_page_lowly_soldier_b", file: "family_page_lowly_soldier_b.png", available: false },
    { id: "enemy_golem_maiden_puppet_guardian_golem", file: "enemy_golem_maiden_puppet_guardian_golem.png", available: true },
    { id: "enemy_golem_maiden_puppet_kidnapper_maiden_puppets", file: "enemy_golem_maiden_puppet_kidnapper_maiden_puppets.png", available: true },
    { id: "enemy_cavalry_tree_guard_capital_cavalry", file: "enemy_cavalry_tree_guard_capital_cavalry.png", available: true },
    { id: "enemy_formless_other_miranda_flowers", file: "enemy_formless_other_miranda_flowers.png", available: true },
    { id: "enemy_undead_graveyard_shades", file: "enemy_undead_graveyard_shades.png", available: true },
    { id: "enemy_crustacean_big_crabs", file: "enemy_crustacean_big_crabs.png", available: true },
    { id: "enemy_demihuman_beastfolk_club_lion_hybrids", file: "enemy_demihuman_beastfolk_club_lion_hybrids.png", available: true },
    { id: "enemy_warrior_swordsman_stoneskin_kings", file: "enemy_warrior_swordsman_stoneskin_kings.png", available: true },
    { id: "enemy_warrior_swordsman_divine_beast_warriors", file: "enemy_warrior_swordsman_divine_beast_warriors.png", available: true },
    { id: "enemy_warrior_swordsman_divine_bird_warrior", file: "enemy_warrior_swordsman_divine_bird_warrior.png", available: true },
    { id: "enemy_mage_messenger_oracle_envoys", file: "enemy_mage_messenger_oracle_envoys.png", available: true },
    { id: "enemy_crystal_puppet_crystal_people", file: "enemy_crystal_puppet_crystal_people.png", available: true },
    { id: "enemy_rock_spirit_beast_golden_hippo", file: "enemy_rock_spirit_beast_golden_hippo.png", available: true },
    { id: "enemy_imp_watchdog_gargoyle_black_blade_kindred", file: "enemy_imp_watchdog_gargoyle_black_blade_kindred.png", available: true },
    { id: "enemy_cavalry_carian_royal_guard", file: "enemy_cavalry_carian_royal_guard.png", available: true },
    { id: "enemy_troll_dragonkin_wormface_nox_dragonkin_soldier", file: "enemy_troll_dragonkin_wormface_nox_dragonkin_soldier.png", available: true },
    { id: "enemy_rat_basilisk_finger_bugs", file: "enemy_rat_basilisk_finger_bugs.png", available: true },
    { id: "enemy_dragon_great_earth_dragon", file: "enemy_dragon_great_earth_dragon.png", available: true },
    { id: "enemy_dragon_gluttonous_dragon", file: "enemy_dragon_gluttonous_dragon.png", available: true },
    { id: "enemy_strong_type_loathed_demon", file: "enemy_strong_type_loathed_demon.png", available: true },
    { id: "enemy_strong_type_divine_skin_apostles", file: "enemy_strong_type_divine_skin_apostles.png", available: true },
    { id: "enemy_strong_type_blood_lord", file: "enemy_strong_type_blood_lord.png", available: true },
    { id: "enemy_soldier_knight_battlefield_veteran", file: "enemy_soldier_knight_battlefield_veteran.png", available: true },
    { id: "enemy_soldier_knight_death_knight", file: "enemy_soldier_knight_death_knight.png", available: true },
    { id: "enemy_soldier_knight_hound_knight", file: "enemy_soldier_knight_hound_knight.png", available: true },
    { id: "enemy_soldier_knight_bell_bearing_hunter", file: "enemy_soldier_knight_bell_bearing_hunter.png", available: true },
    { id: "enemy_grafted_grafted_lord", file: "enemy_grafted_grafted_lord.png", available: true },
    { id: "enemy_rock_spirit_beast_dark_offspring", file: "enemy_rock_spirit_beast_dark_offspring.png", available: true },
    { id: "enemy_rock_spirit_beast_sacred_beast_lion_dance", file: "enemy_rock_spirit_beast_sacred_beast_lion_dance.png", available: true },
    { id: "enemy_rock_spirit_beast_falling_star_beast", file: "enemy_rock_spirit_beast_falling_star_beast.png", available: true },
    { id: "enemy_big_dog_bear_old_lions", file: "enemy_big_dog_bear_old_lions.png", available: true },
    { id: "boss_maris", file: "boss_maris.png", available: true },
    { id: "boss_fulghor", file: "boss_fulghor.png", available: true },
    { id: "boss_harmonia", file: "boss_harmonia.png", available: true },
    { id: "boss_harmonia_split", file: "boss_harmonia_split.png", available: false },
    { id: "boss_gladius", file: "boss_gladius.png", available: true },
    { id: "boss_gladius_split", file: "boss_gladius_split.png", available: true },
    { id: "boss_gnoster", file: "boss_gnoster.png", available: true },
    { id: "boss_caligo", file: "boss_caligo.png", available: true },
    { id: "boss_libra", file: "boss_libra.png", available: true },
    { id: "boss_edele", file: "boss_edele.png", available: true },
    { id: "boss_stragedes", file: "boss_stragedes.png", available: true },
    { id: "boss_nameless", file: "boss_nameless.png", available: true }
  ];

  var ENEMY_SHEET = {
    "dragon/great_earth_dragon": "family_dragon_a",
    "dragon/gluttonous_dragon": "family_dragon_a",
    "dragon/ancient_dragon": "family_dragon_a",
    "dragon/hill_wyvern": "family_dragon_b",
    "dragon/mountain_ice_dragon": "family_dragon_b",
    "dragon/lava_earth_dragon": "family_dragon_b",
    "tree_spirit/golden_tree_avatar": "family_tree_spirit_a",
    "tree_spirit/withered_tree_spirit": "family_tree_spirit_b",
    "rock_spirit_beast/golden_hippo": "family_rock_spirit_beast_a",
    "rock_spirit_beast/sacred_beast_lion_dance": "family_rock_spirit_beast_a",
    "rock_spirit_beast/falling_star_beast": "family_rock_spirit_beast_a",
    "rock_spirit_beast/dark_offspring": "family_rock_spirit_beast_b",
    "rock_spirit_beast/dark_offspring_withered": "enemy_rock_spirit_beast_dark_offspring",
    "rock_spirit_beast/ancestral_spirit": "family_rock_spirit_beast_b",
    "rat_basilisk/big_rats": "family_rat_basilisk_a",
    "rat_basilisk/finger_bugs": "family_rat_basilisk_a",
    "rat_basilisk/basilisks": "family_rat_basilisk_b",
    "death_bird_raven/death_ritual_bird": "family_death_bird_raven_a",
    "death_bird_raven/giant_raven": "family_death_bird_raven_a",
    "death_bird_raven/wounded_demon": "family_death_bird_raven_b",
    "death_bird_raven/demon_prince": "family_death_bird_raven_b",
    "grafted/grafted_prince": "family_grafted_a",
    "grafted/grafted_lord": "family_grafted_a",
    "grafted/royal_wraith": "family_grafted_b",
    "crustacean/duke_freydia": "family_crustacean_a",
    "crustacean/centipede_demon": "family_crustacean_a",
    "crustacean/big_crabs": "family_crustacean_a",
    "crustacean/big_ants": "family_crustacean_b",
    "crustacean/big_crayfish": "family_crustacean_a",
    "attacker_warrior/night_assassin": "family_attacker_warrior_a",
    "attacker_warrior/night_executioner": "family_attacker_warrior_a",
    "attacker_warrior/night_fallen": "family_attacker_warrior_a",
    "attacker_warrior/night_destroyer": "family_attacker_warrior_b",
    "attacker_warrior/night_blasphemer": "family_attacker_warrior_b",
    "formless_other/reflection_trolls": "family_formless_other_a",
    "formless_other/omen": "family_formless_other_a",
    "formless_other/silver_drops": "family_formless_other_b",
    "formless_other/spider_scorpions": "family_formless_other_b",
    "formless_other/mud_men": "family_formless_other_b",
    "formless_other/man_bats": "family_formless_other_b",
    "formless_other/miranda_flowers": "family_formless_other_a",
    "attacker_mage/night_hunter": "family_attacker_mage_a",
    "attacker_mage/night_idol": "family_attacker_mage_a",
    "attacker_mage/night_thief": "family_attacker_mage_a",
    "attacker_mage/night_witch": "family_attacker_mage_b",
    "attacker_mage/night_liar": "family_attacker_mage_b",
    "soldier_knight/red_lion_knights": "family_soldier_knight_a",
    "soldier_knight/cuckoo_knights": "family_soldier_knight_a",
    "soldier_knight/corrupted_knight": "family_soldier_knight_a",
    "soldier_knight/madfire_knights": "family_soldier_knight_a",
    "soldier_knight/liege_army": "family_soldier_knight_a",
    "soldier_knight/lostland_knight": "family_soldier_knight_a",
    "soldier_knight/death_knight": "family_soldier_knight_a",
    "soldier_knight/fire_knights": "family_soldier_knight_a",
    "soldier_knight/messmer_soldiers": "family_soldier_knight_a",
    "soldier_knight/hound_knight": "family_soldier_knight_b",
    "soldier_knight/raya_lucaria_soldiers": "family_soldier_knight_b",
    "soldier_knight/mausoleum_knight": "family_soldier_knight_b",
    "soldier_knight/leyndell_knights": "family_soldier_knight_b",
    "soldier_knight/knight_alutrius": "family_soldier_knight_b",
    "soldier_knight/bell_bearing_hunter": "family_soldier_knight_b",
    "soldier_knight/battlefield_veteran": "family_soldier_knight_b",
    "soldier_knight/remote_veteran": "family_soldier_knight_b",
    "soldier_knight/crucible_knight": "family_soldier_knight_b",
    "dog_wolf/stray_dogs": "family_dog_wolf_a",
    "dog_wolf/wolf": "family_dog_wolf_b",
    "warrior_swordsman/stoneskin_kings": "family_warrior_swordsman_b",
    "warrior_swordsman/loathsome_crushers": "family_warrior_swordsman_b",
    "warrior_swordsman/divine_bird_warrior": "family_warrior_swordsman_b",
    "warrior_swordsman/black_blade_assassin": "family_warrior_swordsman_b",
    "warrior_swordsman/zamor_ancient_hero": "family_warrior_swordsman_b",
    "warrior_swordsman/blood_noble": "family_warrior_swordsman_b",
    "warrior_swordsman/nox_warriors": "family_warrior_swordsman_b",
    "warrior_swordsman/cursed_swordsman": "family_warrior_swordsman_b",
    "warrior_swordsman/grave_warden_duelist": "family_warrior_swordsman_b",
    "warrior_swordsman/exiled_soldier": "family_warrior_swordsman_b",
    "warrior_swordsman/divine_beast_warriors": "family_warrior_swordsman_b",
    "warrior_swordsman/cold_valley_dancer": "family_warrior_swordsman_a",
    "strong_type/omen_children": "family_strong_type_a",
    "strong_type/pumpkin_helm_madman": "family_strong_type_a",
    "strong_type/black_flame_sinners": "family_strong_type_b",
    "strong_type/ancestral_spirit_folk": "family_strong_type_b",
    "strong_type/blood_demons": "family_strong_type_a",
    "strong_type/tuning_demon": "family_strong_type_a",
    "strong_type/fire_monk_warrior": "family_strong_type_b",
    "strong_type/purple_ogre_chief": "family_strong_type_a",
    "strong_type/loathed_demon": "family_strong_type_a",
    "strong_type/divine_skin_apostles": "family_strong_type_a",
    "strong_type/blood_lord": "family_strong_type_a",
    "cavalry/royal_capital_cavalry": "family_cavalry_a",
    "cavalry/kaiden_mercenary": "family_cavalry_a",
    "cavalry/carian_royal_guard": "family_cavalry_a",
    "cavalry/tree_guard_capital_cavalry": "family_cavalry_a",
    "cavalry/unnamed_king": "family_cavalry_b",
    "cavalry/night_cavalry": "family_cavalry_b",
    "cavalry/dragon_tree_guard": "family_cavalry_b",
    "demihuman_beastfolk_club/demihumans": "family_demihuman_beastfolk_club_b",
    "demihuman_beastfolk_club/hybrids": "family_demihuman_beastfolk_club_b",
    "demihuman_beastfolk_club/lion_hybrids": "family_demihuman_beastfolk_club_b",
    "demihuman_beastfolk_club/silver_tears_people": "family_demihuman_beastfolk_club_b",
    "demihuman_beastfolk_club/farum_azula_beastmen": "family_demihuman_beastfolk_club_b",
    "demihuman_beastfolk_club/rot_kindred": "family_demihuman_beastfolk_club_b",
    "demihuman_beastfolk_club/demihuman_queen_swordmaster": "family_demihuman_beastfolk_club_a",
    "big_dog_bear/consort_red_wolf": "family_big_dog_bear_a",
    "big_dog_bear/huge_dog": "family_troll_dragonkin_wormface_a",
    "big_dog_bear/rune_bear": "family_big_dog_bear_b",
    "big_dog_bear/old_lions": "family_big_dog_bear_b",
    "undead/falling_hawk_corps": "family_undead_b",
    "undead/rotten_undead": "family_undead_b",
    "undead/skeletons": "family_undead_b",
    "undead/graveyard_shades": "family_undead_b",
    "undead/wraith_servants": "family_undead_b",
    "undead/tibias_summoning_boat": "family_undead_a",
    "crystal_puppet/living_jars": "family_crystal_puppet_a",
    "crystal_puppet/stone_diggers": "family_crystal_puppet_b",
    "crystal_puppet/crystal_people": "family_crystal_puppet_b",
    "crystal_puppet/puppet_soldiers": "family_crystal_puppet_b",
    "mage_messenger/meteor_scavengers": "family_mage_messenger_b",
    "mage_messenger/glintstone_sorcerers": "family_mage_messenger_b",
    "mage_messenger/oracle_envoys": "family_mage_messenger_b",
    "mage_messenger/interrogators": "family_mage_messenger_a",
    "mage_messenger/perfumers": "family_mage_messenger_b",
    "mage_messenger/sinners": "family_mage_messenger_b",
    "mage_messenger/war_sorcerers": "family_mage_messenger_b",
    "golem_maiden_puppet/guardian_golem": "family_golem_maiden_puppet_a",
    "golem_maiden_puppet/kidnapper_maiden_puppets": "family_golem_maiden_puppet_a",
    "golem_maiden_puppet/fire_chariot_ganmen": "family_golem_maiden_puppet_b",
    "golem_maiden_puppet/molten_iron_demon": "family_golem_maiden_puppet_b",
    "commoner/highway_robbers": "family_commoner_a",
    "commoner/shadow_nobles": "family_commoner_a",
    "commoner/wandering_nobles": "family_commoner_a",
    "commoner/mad_flame_folk": "family_commoner_b",
    "commoner/citizens": "family_commoner_b",
    "commoner/watchers": "family_commoner_b",
    "imp_watchdog_gargoyle/imps": "family_imp_watchdog_gargoyle_b",
    "imp_watchdog_gargoyle/returning_tree_watchdog": "family_imp_watchdog_gargoyle_a",
    "imp_watchdog_gargoyle/black_blade_kindred": "family_imp_watchdog_gargoyle_a",
    "imp_watchdog_gargoyle/grave_guardian_birds": "family_imp_watchdog_gargoyle_b",
    "imp_watchdog_gargoyle/hero_gargoyle": "family_imp_watchdog_gargoyle_a",
    "troll_dragonkin_wormface/knight_troll": "family_troll_dragonkin_wormface_a",
    "troll_dragonkin_wormface/headless_trolls": "family_troll_dragonkin_wormface_b",
    "troll_dragonkin_wormface/mad_flame_troll": "family_troll_dragonkin_wormface_b",
    "troll_dragonkin_wormface/snowfield_trolls": "family_troll_dragonkin_wormface_b",
    "troll_dragonkin_wormface/troll": "family_troll_dragonkin_wormface_b",
    "troll_dragonkin_wormface/dragonkin_soldier": "family_troll_dragonkin_wormface_b",
    "troll_dragonkin_wormface/nox_dragonkin_soldier": "family_troll_dragonkin_wormface_b",
    "troll_dragonkin_wormface/worm_faces": "family_troll_dragonkin_wormface_b",
    "page_lowly_soldier/upper_pages": "family_page_lowly_soldier_a",
    "page_lowly_soldier/lowly_soldiers": "family_page_lowly_soldier_b"
  };

  // 自分だけの絵を持つ敵（2026-09-23）。系統 sheet は 1 張が系統全体を代表する絵なので、
  // 個別に絵を起こした敵はこちらを優先する。available:false のあいだは系統 sheet に戻る。
  var ENEMY_OWN_SHEET = {
    "golem_maiden_puppet/guardian_golem": "enemy_golem_maiden_puppet_guardian_golem",
    "golem_maiden_puppet/kidnapper_maiden_puppets": "enemy_golem_maiden_puppet_kidnapper_maiden_puppets",
    "cavalry/tree_guard_capital_cavalry": "enemy_cavalry_tree_guard_capital_cavalry",
    "formless_other/miranda_flowers": "enemy_formless_other_miranda_flowers",
    "undead/graveyard_shades": "enemy_undead_graveyard_shades",
    "crustacean/big_crabs": "enemy_crustacean_big_crabs",
    "demihuman_beastfolk_club/lion_hybrids": "enemy_demihuman_beastfolk_club_lion_hybrids",
    "warrior_swordsman/stoneskin_kings": "enemy_warrior_swordsman_stoneskin_kings",
    "warrior_swordsman/divine_beast_warriors": "enemy_warrior_swordsman_divine_beast_warriors",
    "warrior_swordsman/divine_bird_warrior": "enemy_warrior_swordsman_divine_bird_warrior",
    "mage_messenger/oracle_envoys": "enemy_mage_messenger_oracle_envoys",
    "crystal_puppet/crystal_people": "enemy_crystal_puppet_crystal_people",
    "rock_spirit_beast/golden_hippo": "enemy_rock_spirit_beast_golden_hippo",
    "imp_watchdog_gargoyle/black_blade_kindred": "enemy_imp_watchdog_gargoyle_black_blade_kindred",
    "cavalry/carian_royal_guard": "enemy_cavalry_carian_royal_guard",
    "troll_dragonkin_wormface/nox_dragonkin_soldier": "enemy_troll_dragonkin_wormface_nox_dragonkin_soldier",
    "rat_basilisk/finger_bugs": "enemy_rat_basilisk_finger_bugs",
    "dragon/great_earth_dragon": "enemy_dragon_great_earth_dragon",
    "dragon/gluttonous_dragon": "enemy_dragon_gluttonous_dragon",
    "strong_type/loathed_demon": "enemy_strong_type_loathed_demon",
    "strong_type/divine_skin_apostles": "enemy_strong_type_divine_skin_apostles",
    "strong_type/blood_lord": "enemy_strong_type_blood_lord",
    "soldier_knight/battlefield_veteran": "enemy_soldier_knight_battlefield_veteran",
    "soldier_knight/death_knight": "enemy_soldier_knight_death_knight",
    "soldier_knight/hound_knight": "enemy_soldier_knight_hound_knight",
    "soldier_knight/bell_bearing_hunter": "enemy_soldier_knight_bell_bearing_hunter",
    "grafted/grafted_lord": "enemy_grafted_grafted_lord",
    "rock_spirit_beast/dark_offspring": "enemy_rock_spirit_beast_dark_offspring",
    "rock_spirit_beast/sacred_beast_lion_dance": "enemy_rock_spirit_beast_sacred_beast_lion_dance",
    "rock_spirit_beast/falling_star_beast": "enemy_rock_spirit_beast_falling_star_beast",
    "big_dog_bear/old_lions": "enemy_big_dog_bear_old_lions"
  };

  function listSheets() {
    return SHEETS;
  }

  function getSheet(sheetId) {
    return (
      SHEETS.filter(function (s) {
        return s.id === sheetId;
      })[0] || null
    );
  }

  // 系統への割当だけを返す（專屬 sheet を見ない）。系統 sheet の成員一覧や、
  // 「空の変体を作っていないか」の検査はこちらを使う。
  function familySheetIdForEnemy(familyId, enemyId) {
    return ENEMY_SHEET[familyId + "/" + enemyId] || null;
  }

  // 表現層が使うのはこちら。專屬 sheet が產出済みならそれを、無ければ系統 sheet を返す。
  function sheetIdForEnemy(familyId, enemyId) {
    var own = ENEMY_OWN_SHEET[familyId + "/" + enemyId];
    if (own) {
      var ownSheet = getSheet(own);
      if (ownSheet && ownSheet.available) return own;
    }
    return familySheetIdForEnemy(familyId, enemyId);
  }

  // form（state.battle.bossForm と同じ文字列）を渡すと、その形態専用の sheet を優先する。
  // 專用 sheet が未產出のときは既定の boss_<id> に戻す——代役（別の夜王の絵）を出すより、
  // 同じ夜王の別形態の絵を出すほうが明らかに近い。
  function sheetIdForBoss(bossId, form) {
    var id = "boss_" + bossId;
    if (form) {
      var formSheet = getSheet(id + "_" + form);
      if (formSheet && formSheet.available) return id + "_" + form;
    }
    return getSheet(id) ? id : null;
  }

  window.PriTestEnemySpriteRegistry = {
    listSheets: listSheets,
    getSheet: getSheet,
    familySheetIdForEnemy: familySheetIdForEnemy,
    sheetIdForEnemy: sheetIdForEnemy,
    sheetIdForBoss: sheetIdForBoss
  };
})();
