// ============================================================================
// 遺物記憶目錄（2026-09-24新增，來源 photo/enemyPic/memory/memory.txt）
// ============================================================================
// 這個檔案是**純參考資料**，比照 consumables.js／talismans.js／weapon_affixes.js 的
// 既有分工（CLAUDE.md §27.1）：只放名稱、本文與分類標籤，實際的機制接入全部在
// static_src/midnight.js。設計文件見 docs/superpowers/specs/2026-09-24-relic-memory-design.md §10。
//
// 內容：memory.txt 的 415 條隨機效果（EFFECTS）與 18 個固定配置遺物（FIXED_RELICS）。
// 兩者都與 CharacterDrawer 的 24 種附帶效果**並存**（使用者 2026-09-24 明確指示），
// 不是取代關係，因此 allAttachedEffectIds() 不可被這份目錄換掉。
//
// 語言：ja 是 memory.txt 的原文，一字不改；zh 是對應中譯。專有名詞的中譯沿用既有資料檔
// ——圖騰・史黛拉／家族／屬性痕／妖刀 來自 character_types.js，夜王與出擊名稱來自
// night_boss_rulebook.js 與 scenarios.js，不另立一套。
//
// note：memory.txt 括號內的即時制換算說明，**原文照錄**，空字串代表原始資料沒附說明。
//
// range／unit：從 note 機械化解析出來的數值範圍，只在 note 明確寫出「單一個正值範圍」
// （「物理攻撃力上昇2~5%」）時才有值，415 條中 82 條。以下三種一律留 null，交由使用者確認，
// **不得自行推定**（CLAUDE.md §42.4）：
//   ・原始資料根本沒寫範圍，或寫的是固定值（「毒異常蓄積上限+1」）。
//   ・一條 note 裡有兩組範圍（「HP15~20%以下時, HP價值+6~12%」——前者是觸發條件不是效果值）。
//   ・含負號的「低下」系（「HP價值-12~18」），正負號在原文裡標得不一致。
// 特別注意：武器類別 133 條中只有「短剣」那一組附了 note，其餘 31 種武器類別的同型效果
// 原始資料留白。使用者 2026-09-25 確認**其餘 31 種與短剣同組共用同樣的數值**，因此在
// EFFECTS 建好之後由 applyWeaponFamilyInheritance() 機械化繼承——陣列中那 133 條的字面
// 值維持原樣（note 仍是空字串），繼承來的條目帶 inheritedFrom 指向短剣的來源 effect id，
// 所以「原始資料到底有沒有寫」永遠查得回來。詳見該函式上方的註解。
//
// 抽到該效果、產生那一顆記憶的當下才依 range 擲定一個值，之後永遠是那個值；擲法不是均勻
// 分布，見 midnight_relic_memory.js 的 rollRangeValue()（設計文件 §10.2）。
//
// stackable：使用者在效果台帳上逐條決定的「可否重複疊加」。true＝重複時累加，
// false＝重複時只算一次。null＝尚未決定。
//
// use：使用者逐條決定的用途。
//   "adopt" 接上現有 — midnight 已有對應機制，接到既有注入點。
//   "new"   需新機制 — 要先新增資料欄位或事件 hook。
//   "text"  僅顯示   — 只建檔顯示文字，效果由 GM／玩家處理。
//   "skip"  不採用   — 不納入這套系統。
// null＝尚未決定。
//
// kind：效果的分類標籤，同一個 kind 共用同一個注入點，避免每條各寫一套判斷
// （CLAUDE.md §42.10）。名稱盡量沿用 weapon_affixes.js 既有的 30 種 kind。
//
// bad：memory.txt 標「悪効果」的 26 條。依使用者指示**暫不納入抽選**，抽選規則未定，
// 因此 drawableEffects() 會把它們排除。
//
// phase：1＝效果已接入；2＝只有資料與顯示，midnight 一律當成沒有這條。目前全部是 2。
// 沿用 weapon_affixes.js 的同名欄位語義。
// ============================================================================
(function () {
  "use strict";

  function lang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || "zh";
  }

  function T(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    return field[lang()] || field.zh || field.ja || "";
  }

  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  // flags 是單字元旗標的字串，省得每條都攤開五個 false：
  //   b＝悪効果　i＝聖杯瓶等道具　r＝只出現在固定遺物上　p＝memory.txt 標「專有」（含意待確認）
  //   d＝效果指向的資料在本專案還不存在（例：戰技「嵐脚」「デターミネーション」不在
  //      weapons_skills.js 的 251 條裡），使用者 2026-09-25 指示「先不進入抽選池」。
  // range 是 [min, max, unit]，只有在 note 明確寫出單一個正值範圍時才有；null 代表
  // 原始資料沒寫、寫的是固定值、或一條 note 裡有兩組範圍（見檔頭說明）。
  // unit："pct"＝百分比　"sec"＝秒　"flat"＝直接的數值。
  function E(id, ja, zh, note, stackable, use, kind, character, flags, range) {
    flags = flags || "";
    return {
      id: id,
      name: C(ja, zh),
      note: note,
      stackable: stackable,
      use: use,
      kind: kind,
      character: character,
      range: range ? [range[0], range[1]] : null,
      unit: range ? range[2] : null,
      bad: flags.indexOf("b") >= 0,
      item: flags.indexOf("i") >= 0,
      relicOnly: flags.indexOf("r") >= 0,
      proprietary: flags.indexOf("p") >= 0,
      missingData: flags.indexOf("d") >= 0,
      phase: 2,
    };
  }

  var EFFECTS = [
    // ------------------------------------------------------------------------
    // 基礎數值（12 條）
    // ------------------------------------------------------------------------
    E("rm_max_hp_up", "最大HP上昇", "最大HP上升", "+10~30", false, "adopt", "maxStat", null, "", [10, 30, "flat"]),
    E("rm_max_fp_up", "最大FP上昇", "最大FP上升", "+6~20", false, "adopt", "maxStat", null, "", [6, 20, "flat"]),
    E("rm_max_stamina_up", "最大スタミナ上昇", "最大體力上升", "+5~12", true, "adopt", "maxStat", null, "", [5, 12, "flat"]),
    // 生命力／精神力／持久力／強靭度這 4 條，memory.txt 原本沒有換算說明（note 空、range null）。
    // 使用者 2026-09-25 補齊：生命力＝HP 上限、精神力＝FP 上限、持久力＝體力上限，三者都是
    // **百分比**（+2~5%）；強靭度＝威力補正的「平衡」，是 flat +1~3（跟筋力那 5 條同刻度）。
    // 因此這 4 條的 note 不是 memory.txt 原文照錄，是使用者指定的換算（設計文件 §10.14.1 A）。
    E("rm_stat_vigor", "生命力+1 / 2 / 3", "生命力+1／2／3", "HP上限+2~5%", true, "new", "levelStat", null, "", [2, 5, "pct"]),
    E("rm_stat_mind", "精神力+1 / 2 / 3", "精神力+1／2／3", "FP上限+2~5%", true, "new", "levelStat", null, "", [2, 5, "pct"]),
    E("rm_stat_endurance", "持久力+1 /2 3", "持久力+1／2／3", "體力上限+2~5%", true, "new", "levelStat", null, "", [2, 5, "pct"]),
    E("rm_stat_strength", "筋力", "筋力+1～+3", "+1~+3", true, "adopt", "levelStat", null, "", [1, 3, "flat"]),
    E("rm_stat_dexterity", "技量", "技量+1～+3", "+1~+3", true, "adopt", "levelStat", null, "", [1, 3, "flat"]),
    E("rm_stat_intelligence", "知力", "知力+1～+3", "+1~+3", true, "adopt", "levelStat", null, "", [1, 3, "flat"]),
    E("rm_stat_faith", "信仰", "信仰+1～+3", "+1~+3", true, "adopt", "levelStat", null, "", [1, 3, "flat"]),
    E("rm_stat_arcane", "神秘", "神秘+1～+3", "+1~+3", true, "adopt", "levelStat", null, "", [1, 3, "flat"]),
    E("rm_stat_poise", "強靭度+1/2/3", "強韌度+1／2／3", "平衡（威力補正）+1~3", true, "new", "poise", null, "", [1, 3, "flat"]),

    // ------------------------------------------------------------------------
    // 攻擊力（14 條）
    // ------------------------------------------------------------------------
    E("rm_physical_atk_up", "物理攻撃力上昇", "物理攻擊力上升", "物理攻撃力上昇2~5%", true, "adopt", "physicalAtkPct", null, "", [2, 5, "pct"]),
    E("rm_physical_atk_up_2", "物理攻撃力上昇+2", "物理攻擊力上升+2", "物理攻撃力上昇8~10%", true, "adopt", "physicalAtkPct", null, "", [8, 10, "pct"]),
    E("rm_element_atk_up", "属性攻撃力上昇", "屬性攻擊力上升", "属性攻撃力上昇4~10%", true, "adopt", "elementAtkPct", null, "", [4, 10, "pct"]),
    E("rm_magic_atk_up", "魔力攻撃力上昇", "魔力攻擊力上升", "魔屬性攻擊力上升4~12%", true, "adopt", "elementAtkPct", null, "", [4, 12, "pct"]),
    E("rm_fire_atk_up", "炎攻撃力上昇", "火焰攻擊力上升", "炎屬性攻擊力上升4~12%", true, "adopt", "elementAtkPct", null, "", [4, 12, "pct"]),
    E("rm_lightning_atk_up", "雷攻撃力上昇", "雷電攻擊力上升", "雷屬性攻擊力上升4~12%", true, "adopt", "elementAtkPct", null, "", [4, 12, "pct"]),
    E("rm_holy_atk_up", "聖攻撃力上昇", "神聖攻擊力上升", "聖屬性攻擊力上升4~12%", true, "adopt", "elementAtkPct", null, "", [4, 12, "pct"]),
    E("rm_first_hit_up", "通常攻撃の1段目強化", "一般攻擊第1段強化", "1hit攻擊力上升3~6%", true, "adopt", "atkPct", null, "", [3, 6, "pct"]),
    E("rm_critical_up", "致命の一撃強化", "致命一擊強化", "致命一撃攻擊力上升6~12%", true, "adopt", "atkPct", null, "", [6, 12, "pct"]),
    E("rm_sorcery_up", "魔術強化", "魔術強化", "魔術強化4~10%", true, "adopt", "atkPct", null, "", [4, 10, "pct"]),
    E("rm_incantation_up", "祈祷強化", "祈禱強化", "祈祷強化4~10%", true, "adopt", "atkPct", null, "", [4, 10, "pct"]),
    E("rm_roar_breath_up", "咆哮とブレス強化", "咆哮與吐息強化", "咆哮ブレス強化4~10%", true, "adopt", "atkPct", null, "", [4, 10, "pct"]),
    E("rm_twohand_stagger_up", "両手持ちの、体勢を崩す力上昇", "雙手持武器的破防力上升", "両手持ち破防6~10% +▲", true, "adopt", "staggerThreshold", null, "", [6, 10, "pct"]),
    E("rm_dualwield_stagger_up", "二刀持ちの、体勢を崩す力上昇", "雙刀持武器的破防力上升", "二刀持ち破防6~10% +▲", true, "adopt", "staggerThreshold", null, "", [6, 10, "pct"]),

    // ------------------------------------------------------------------------
    // 條件攻擊力（1 條）
    // ------------------------------------------------------------------------
    E("rm_on_damaged_atk_up", "攻撃を受けると攻撃力上昇", "受到攻擊時攻擊力上升", "受到攻擊傷害3s內 攻擊力上升4~7%", false, "adopt", "onDamaged", null, "", [4, 7, "pct"]),

    // ------------------------------------------------------------------------
    // 防禦反擊（6 條）
    // ------------------------------------------------------------------------
    E("rm_guard_counter_up", "ガードカウンター強化", "防禦反擊強化", "防禦反擊強化 10%~26%", true, "adopt", "onGuardSuccess", null, "", [10, 26, "pct"]),
    E("rm_guard_counter_hp_add", "ガードカウンターに、自身の現在HPの一部を加える", "防禦反擊加上自身現在HP的一部分", "防禦反擊時 追加自身目前HP的3%作為傷害", false, "adopt", "onGuardSuccess", null),
    E("rm_guard_art_gauge", "ガード成功時、アーツゲージを蓄積", "防禦成功時蓄積技藝計量表", "防禦成功時, 技藝冷卻加速 1~2s", false, "adopt", "onGuardSuccess", null, "", [1, 2, "sec"]),
    E("rm_guard_hp_heal", "ガード成功時、HP回復", "防禦成功時回復HP", "防禦成功時 回復1~2點HP", false, "adopt", "onGuardSuccess", null, "", [1, 2, "flat"]),
    E("rm_thrust_counter_hp_heal", "刺突カウンター発生時、HP回復", "發動突刺反擊時回復HP", "防禦反擊成功時 回復1~2點HP", false, "adopt", "onGuardSuccess", null, "", [1, 2, "flat"]),
    E("rm_guard_aggro_up", "ガード中、敵に狙われやすくなる", "防禦中更容易被敵人鎖定", "防禦中, 被成為目標的機率+5%", false, "adopt", "aggro", null),

    // ------------------------------------------------------------------------
    // 減傷（7 條）
    // ------------------------------------------------------------------------
    E("rm_physical_cut_up", "物理カット率+", "物理減傷率+", "HP價值+5~14%", true, "adopt", "damageTaken", null, "", [5, 14, "pct"]),
    E("rm_element_cut_up", "属性カット率+", "屬性減傷率+", "屬性攻擊的HP價值+5~12%", true, "adopt", "elementDamageTaken", null, "", [5, 12, "pct"]),
    E("rm_magic_cut_up", "魔力カット率上昇+", "魔力減傷率上升+", "魔屬性攻擊的HP價值+7~14%", true, "adopt", "elementDamageTaken", null, "", [7, 14, "pct"]),
    E("rm_fire_cut_up", "炎カット率+", "火焰減傷率+", "炎屬性攻擊的HP價值+7~14%", true, "adopt", "elementDamageTaken", null, "", [7, 14, "pct"]),
    E("rm_lightning_cut_up", "雷カット率+", "雷電減傷率+", "雷屬性攻擊的HP價值+7~14%", true, "adopt", "elementDamageTaken", null, "", [7, 14, "pct"]),
    E("rm_holy_cut_up", "聖カット率+", "神聖減傷率+", "聖屬性攻擊的HP價值+7~14%", true, "adopt", "elementDamageTaken", null, "", [7, 14, "pct"]),
    E("rm_low_hp_cut_up", "HP低下時、カット率上昇", "HP低落時減傷率上升", "HP 15~20%以下時（門檻）, HP價值+6~12%", true, "adopt", "nearDeath", null, "", [6, 12, "pct"]),

    // ------------------------------------------------------------------------
    // 異常耐性（7 條）
    // ------------------------------------------------------------------------
    E("rm_resist_poison", "毒耐性+", "猛毒耐性+", "毒異常蓄積上限+1", true, "adopt", "accumResist", null),
    E("rm_resist_rot", "腐敗耐性+", "腐敗耐性+", "腐敗異常蓄積上限+1", true, "adopt", "accumResist", null),
    E("rm_resist_bleed", "出血耐性上昇", "出血耐性上升", "出血異常蓄積上限+1", true, "adopt", "accumResist", null),
    E("rm_resist_frost", "冷気耐性+", "凍傷耐性+", "冷気異常蓄積上限+1", true, "adopt", "accumResist", null),
    E("rm_resist_sleep", "睡眠耐性+", "睡眠耐性+", "睡眠異常蓄積上限+1", true, "adopt", "accumResist", null),
    E("rm_resist_madness", "発狂耐性+", "發狂耐性+", "発狂異常蓄積上限+1", true, "adopt", "accumResist", null),
    E("rm_resist_death", "死耐性+", "呪死耐性+", "死異常蓄積上限+1", true, "adopt", "accumResist", null),

    // ------------------------------------------------------------------------
    // 回復（12 條）
    // ------------------------------------------------------------------------
    E("rm_hp_regen", "HP持続回復", "HP持續回復", "每30s 回復1~3點HP", false, "adopt", "overTime", null, "", [1, 3, "flat"]),
    E("rm_low_hp_party_regen", "HP低下時、周囲の味方を含めHPをゆっくりと回復", "HP低落時連同周圍隊友緩慢回復HP", "HP10%以下時 周圍隊友每30s 回復1~3點HP", false, "adopt", "overTime", null, "", [1, 3, "flat"]),
    E("rm_fp_cost_down", "消費FP軽減", "消耗FP減輕", "消費FP 6~11%輕減", true, "adopt", "castFpCost", null, "", [6, 11, "pct"]),
    E("rm_combo_fp_regen", "攻撃連続時、FP回復", "連續攻擊時回復FP", "連續攻擊10次時, FP回復4~8", false, "adopt", "castFpCost", null, "", [4, 8, "flat"]),
    E("rm_madness_fp_regen", "発狂状態になると、FP持続回復", "進入發狂狀態時FP持續回復", "發狂狀態, FP回復7~15", false, "adopt", "overTime", null, "", [7, 15, "flat"]),
    E("rm_hit_stamina_regen", "攻撃命中時、スタミナ回復", "攻擊命中時回復體力", "打出攻擊後體力恢復1~2", false, "adopt", "staminaRegen", null, "", [1, 2, "flat"]),
    E("rm_critical_stamina_regen", "致命の一撃で、スタミナ回復速度上昇", "致命一擊使體力回復速度上升", "打出致命攻擊後體力恢復10~30", false, "adopt", "staminaRegen", null, "", [10, 30, "flat"]),
    E("rm_party_stamina_regen", "自身を除く、周囲の味方のスタミナ回復速度上昇", "除自身外，周圍隊友的體力回復速度上升", "除了自己的友軍體力恢復+2", false, "adopt", "staminaRegen", null),
    E("rm_kill_party_heal", "敵を倒した時、自身を除く周囲の味方のHPを回復", "擊倒敵人時回復除自身外周圍隊友的HP", "回復5~15HP", false, "adopt", "overTime", null, "", [5, 15, "flat"]),
    E("rm_totem_kill_heal", "トーテム・ステラの周囲で敵を倒した時、HP回復", "在圖騰・史黛拉周圍擊倒敵人時回復HP", "", false, "adopt", "overTime", null, "r"),
    E("rm_nearby_rot_hp_regen", "周囲で腐敗状態の発生時、HP持続回復", "周圍發生腐敗狀態時HP持續回復", "10s內回覆15", false, "adopt", "overTime", null),
    E("rm_fp_regen", "FP持続回復", "FP持續回復", "每10s,1Fp", false, "adopt", "overTime", null),

    // ------------------------------------------------------------------------
    // 冷卻（4 條）
    // ------------------------------------------------------------------------
    E("rm_skill_cooldown_down", "スキルクールタイム軽減", "技能冷卻時間縮短", "腳色技能冷卻減少３％~10%", true, "adopt", "skillCooldown", null, "", [3, 10, "pct"]),
    E("rm_art_cooldown_down", "アーツゲージクールタイム軽減", "技藝計量表冷卻縮短", "技藝冷卻加速 ３％~8%", true, "adopt", "artCooldown", null, "", [3, 8, "pct"]),
    E("rm_on_kill_art_gauge", "敵を倒した時のアーツゲージ蓄積増加", "擊倒敵人時技藝計量表蓄積增加", "擊倒敵人技藝冷卻加速 2~6s", false, "adopt", "artCooldown", null, "", [2, 6, "sec"]),
    E("rm_critical_art_gauge", "致命の一撃で、アーツゲージ蓄積増加", "致命一擊使技藝計量表蓄積增加", "使用致命一擊的話, 技藝冷卻加速 15~20s", false, "adopt", "artCooldown", null, "", [15, 20, "sec"]),

    // ------------------------------------------------------------------------
    // 道具強化（10 條）
    // ------------------------------------------------------------------------
    E("rm_grease_physical_atk_up", "脂アイテム使用時、追加で物理攻撃力上昇", "使用塗脂道具時額外提升物理攻擊力", "塗脂使用時 物理攻擊力上升８％", false, "adopt", "special", null),
    E("rm_grease_atk_up_1", "脂アイテム使用時、追加で攻撃力上昇+1", "使用塗脂道具時額外提升攻擊力+1", "塗脂使用時 攻撃力上昇12~20％", false, "adopt", "special", null, "", [12, 20, "pct"]),
    E("rm_throwing_pot_atk_up", "投擲壺の攻撃力上昇", "投擲壺的攻擊力上升", "投擲壺の攻撃力上昇8%~15%", true, "adopt", "special", null, "", [8, 15, "pct"]),
    E("rm_throwing_pot_atk_up_1", "投擲壺の攻撃力上昇+1", "投擲壺的攻擊力上升+1", "投擲壺の攻撃力上昇12%~21%", true, "adopt", "special", null, "", [12, 21, "pct"]),
    E("rm_throwing_knife_atk_up", "投擲ナイフの攻撃力上昇", "投擲刀的攻擊力上升", "投擲ナイフの攻撃力上昇8%~15%", true, "adopt", "special", null, "", [8, 15, "pct"]),
    E("rm_glintstone_gravity_atk_up", "輝石、重力石アイテムの攻撃力上昇", "輝石、重力石道具的攻擊力上升", "輝石、重力石の攻撃力上昇8%~15%", true, "new", "special", null, "d", [8, 15, "pct"]),
    E("rm_perfume_up", "調香術強化", "調香術強化", "調香術アイテムの攻撃力上昇8%~15% 持續時間+3s", true, "adopt", "special", null, "", [8, 15, "pct"]),
    E("rm_moss_item_heal", "苔薬などのアイテム使用でHP回復", "使用苔藥等道具時回復HP", "苔薬使用時, HP回覆4~9", false, "adopt", "special", null, "", [4, 9, "flat"]),
    E("rm_flask_heal_up", "聖杯瓶の回復量上昇", "聖杯瓶的回復量上升", "聖杯瓶回復輛上升5~15%", true, "adopt", "flask", null, "", [5, 15, "pct"]),
    E("rm_flask_share", "聖杯瓶の回復を、周囲の味方に分配", "將聖杯瓶的回復分配給周圍隊友", "自己喝的聖杯瓶 其中20~40%也能補周圍隊友", false, "adopt", "flask", null, "", [20, 40, "pct"]),

    // ------------------------------------------------------------------------
    // 敵異常連動（8 條）
    // ------------------------------------------------------------------------
    E("rm_vs_poisoned", "毒状態の敵に対する威力が+", "對中毒狀態的敵人威力+", "敵人中毒後10s內 威力+8~12%", false, "adopt", "special", null, "", [8, 12, "pct"]),
    E("rm_vs_rotted", "腐敗状態の敵に対する威力が+", "對腐敗狀態的敵人威力+", "敵人腐敗後10s內 威力+8~12%", false, "adopt", "special", null, "", [8, 12, "pct"]),
    E("rm_vs_frostbitten", "凍傷状態の敵に対する威力が+", "對凍傷狀態的敵人威力+", "敵人凍傷後10s內 威力+8~12%", false, "adopt", "special", null, "", [8, 12, "pct"]),
    E("rm_nearby_poison_rot_atk", "周囲で毒/腐敗状態発生時、攻撃力+", "周圍發生毒／腐敗狀態時攻擊力+", "敵人毒/腐敗状態発生10s內 威力+8~12%", false, "adopt", "special", null, "", [8, 12, "pct"]),
    E("rm_nearby_frost_hide", "周囲で凍傷状態の発生時、自身の姿を隠す", "周圍發生凍傷狀態時隱藏自身身影", "敵人凍傷状態発生10s內 不會成為攻擊目標", false, "adopt", "special", null),
    E("rm_nearby_sleep_atk", "周囲で睡眠状態の発生時、攻撃力上昇", "周圍發生睡眠狀態時攻擊力上升", "敵人睡眠状態発生10s內 威力+8~12%", false, "adopt", "special", null, "", [8, 12, "pct"]),
    E("rm_nearby_madness_atk", "周囲で発狂状態の発生時、攻撃力上昇", "周圍發生發狂狀態時攻擊力上升", "敵人発狂状態発生10s內 威力+8~12%", false, "adopt", "special", null, "", [8, 12, "pct"]),
    E("rm_totem_poise_up", "トーテム・ステラの周囲で、強靭度上昇", "在圖騰・史黛拉周圍強韌度上升", "", false, "adopt", "special", null, "r"),

    // ------------------------------------------------------------------------
    // 受擊連動（1 條）
    // ------------------------------------------------------------------------
    E("rm_on_damaged_rot_infuse", "被ダメージ時、腐敗の状態異常を付加", "受到傷害時附加腐敗狀態異常", "受到傷害時 武器附加腐敗異常 持續8s", false, "adopt", "onDamaged", null),

    // ------------------------------------------------------------------------
    // 武器切換（3 條）
    // ------------------------------------------------------------------------
    E("rm_swap_physical_atk_up", "武器の持ち替え時、物理攻撃力上昇", "切換武器時物理攻擊力上升", "切換武器時,該單手的物理攻擊力上升+6~12% 持續5s", false, "new", "onWeaponSwap", null, "p", [6, 12, "pct"]),
    E("rm_swap_element_infuse", "武器の持ち替え時、いずれかの属性攻撃力を付加", "切換武器時附加任一屬性攻擊力", "切換武器時,該單手的武器附加任一屬性 持續5s cd10s", false, "new", "onWeaponSwap", null, "p"),
    E("rm_on_infuse_element_atk_up", "属性攻撃力が付加された時、属性攻撃力上昇", "附加屬性攻擊力時屬性攻擊力上升", "附加屬性時 屬性攻擊力+8% 持續5s", false, "new", "onInfusion", null, "p"),

    // ------------------------------------------------------------------------
    // 全局里程碑（7 條）
    // ------------------------------------------------------------------------
    E("rm_milestone_tower_fp", "魔術師塔の仕掛けが解除される度、最大FP上昇", "每次解除魔術師塔的機關，最大FP上升", "全局:魔術師塔解謎成功後FP+10", false, "new", "globalMilestone", null),
    E("rm_milestone_fort_rune", "小砦の強敵を倒す度、取得ルーン増加、発見力上昇", "每次擊倒小要塞的強敵，取得盧恩增加、發現力上升", "全局:小砦最後層的敵人擊破後 盧恩+1、發現力+1（抽選時骰出的點數+1）", false, "new", "globalMilestone", null),
    E("rm_milestone_cathedral_hp", "大教会の強敵を倒す度、最大HPが5%上昇", "每次擊倒大教堂的強敵，最大HP上升5%", "全局:大教会最後層的敵人擊破後最大HPが5%上昇", false, "new", "globalMilestone", null),
    E("rm_milestone_camp_stamina", "大野営地の強敵を倒す度、最大スタミナ上昇", "每次擊倒大營地的強敵，最大體力上升", "全局:大教会最後層的敵人擊破後最大體力上升5", false, "new", "globalMilestone", null),
    E("rm_milestone_ruins_arcane", "遺跡の強敵を倒す度、神秘上昇", "每次擊倒遺跡的強敵，神秘上升", "全局:遺跡最後層的敵人擊破後神秘上昇2", false, "new", "globalMilestone", null),
    E("rm_milestone_prison_atk", "封牢の囚を倒す度、攻撃力上昇", "每次擊倒封牢的囚犯，攻擊力上升", "全局:封牢敵人擊破後攻撃力上昇8%", false, "new", "globalMilestone", null),
    E("rm_milestone_invader_atk", "夜の侵入者を倒す度、攻撃力上昇", "每次擊倒夜之入侵者，攻擊力上升", "全局:擊破襲擊者戰士系／襲擊者魔術師系的敵人後 攻擊力+8%", false, "new", "globalMilestone", null),

    // ------------------------------------------------------------------------
    // 戰技置換（20 條）
    // ------------------------------------------------------------------------
    E("rm_skillswap_endure", "出撃時の武器の戦技を「我慢」にする", "出擊時武器的戰技變為「忍耐」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_quickstep", "出撃時の武器の戦技を「クイックステップ」にする", "出擊時武器的戰技變為「疾步」", "", false, "adopt", "grantWeaponSkill", null),
    // 「嵐脚」「デターミネーション」兩條招式在 weapons_skills.js 的 251 條裡找不到，
    // 使用者 2026-09-25 指示「先不進入抽選池」，因此帶 d 旗標由 drawableEffects() 排除。
    // 資料補上之後，把 "d" 拿掉即可，不需要改其他地方。
    E("rm_skillswap_storm_stomp", "出撃時の武器の戦技を「嵐脚」にする", "出擊時武器的戰技變為「風暴腳」", "", false, "adopt", "grantWeaponSkill", null, "d"),
    E("rm_skillswap_determination", "出撃時の武器の戦技を「デターミネーション」にする", "出擊時武器的戰技變為「決意」", "", false, "adopt", "grantWeaponSkill", null, "d"),
    E("rm_skillswap_glintblade_phalanx", "出撃時の武器の戦技を「輝剣の円陣」にする", "出擊時武器的戰技變為「輝劍的圓陣」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_gravitas", "出撃時の武器の戦技を「グラビタス」にする", "出擊時武器的戰技變為「重力」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_flame_strike", "出撃時の武器の戦技を「炎撃」にする", "出擊時武器的戰技變為「炎擊」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_magma_eruption", "出撃時の武器の戦技を「溶岩噴火」にする", "出擊時武器的戰技變為「熔岩噴發」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_thunderbolt", "出撃時の武器の戦技を「落雷」にする", "出擊時武器的戰技變為「落雷」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_lightning_slash", "出撃時の武器の戦技を「雷撃斬」にする", "出擊時武器的戰技變為「雷擊斬」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_sacred_blade", "出撃時の武器の戦技を「聖なる刃」にする", "出擊時武器的戰技變為「神聖之刃」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_prayerful_strike", "出撃時の武器の戦技を「祈りの一撃」にする", "出擊時武器的戰技變為「祈禱的一擊」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_poison_mist", "出撃時の武器の戦技を「毒の霧」にする", "出擊時武器的戰技變為「毒霧」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_poison_moth_flight", "出撃時の武器の戦技を「毒蛾は二度舞う」にする", "出擊時武器的戰技變為「毒蛾二度飛舞」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_blood_blade", "出撃時の武器の戦技を「血の刃」にする", "出擊時武器的戰技變為「血之刃」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_seppuku", "出撃時の武器の戦技を「切腹」にする", "出擊時武器的戰技變為「切腹」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_chilling_mist", "出撃時の武器の戦技を「冷気の霧」にする", "出擊時武器的戰技變為「冷氣之霧」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_hoarfrost_stomp", "出撃時の武器の戦技を「霜踏み」にする", "出擊時武器的戰技變為「踏霜」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_white_shadow_lure", "出撃時の武器の戦技を「白い影の誘い」にする", "出擊時武器的戰技變為「白影的誘引」", "", false, "adopt", "grantWeaponSkill", null),
    E("rm_skillswap_arrow_rain", "出撃時の武器の戦技を「アローレイン」にする", "出擊時武器的戰技變為「箭雨」", "", false, "adopt", "grantWeaponSkill", null),

    // ------------------------------------------------------------------------
    // 武器屬性附加（7 條）
    // ------------------------------------------------------------------------
    E("rm_infuse_magic", "出撃時の武器に魔攻撃力を付加", "出擊時武器附加魔力攻擊力", "", false, "adopt", "weaponInfusion", null),
    E("rm_infuse_fire", "出撃時の武器に炎攻撃力を付加", "出擊時武器附加火焰攻擊力", "", false, "adopt", "weaponInfusion", null),
    E("rm_infuse_lightning", "出撃時の武器に雷攻撃力を付加", "出擊時武器附加雷電攻擊力", "", false, "adopt", "weaponInfusion", null),
    E("rm_infuse_holy", "出撃時の武器に聖攻撃力を付加", "出擊時武器附加神聖攻擊力", "", false, "adopt", "weaponInfusion", null),
    E("rm_infuse_poison", "出撃時の武器に毒の状態異常を付加", "出擊時武器附加猛毒狀態異常", "", false, "adopt", "weaponInfusion", null),
    E("rm_infuse_bleed", "出撃時の武器に出血の状態異常を付加", "出擊時武器附加出血狀態異常", "", false, "adopt", "weaponInfusion", null),
    E("rm_infuse_frost", "出撃時の武器に冷気の状態異常を付加", "出擊時武器附加凍傷狀態異常", "", false, "adopt", "weaponInfusion", null),

    // ------------------------------------------------------------------------
    // 出擊時道具（22 條）
    // ------------------------------------------------------------------------
    E("rm_start_shard_of_starlight", "出撃時に「星光の欠片」x2を持つ", "出擊時攜帶「星光的碎片」×2", "", true, "adopt", "startItem", null),
    E("rm_start_fire_pot", "出撃時に「火炎壺」x2を持つ", "出擊時攜帶「火焰壺」×2", "", true, "adopt", "startItem", null),
    E("rm_start_magic_pot", "出撃時に「魔力壺」x2を持つ", "出擊時攜帶「魔力壺」×2", "", true, "adopt", "startItem", null),
    E("rm_start_lightning_pot", "出撃時に「雷壺」x2を持つ", "出擊時攜帶「雷壺」×2", "", true, "adopt", "startItem", null),
    E("rm_start_holy_water_pot", "出撃時に「聖水壺」x3を持つ", "出擊時攜帶「聖水壺」×3", "", true, "adopt", "startItem", null),
    E("rm_start_bone_poison_dart", "出撃時に「骨の毒投げ矢」x3を持つ", "出擊時攜帶「骨毒投擲箭」×3", "", true, "adopt", "startItem", null),
    E("rm_start_crystal_dart", "出撃時に「結晶投げ矢」x3を持つ", "出擊時攜帶「結晶投擲箭」×3", "", true, "adopt", "startItem", null, "d"),
    E("rm_start_throwing_dagger", "出撃時に「スローイングダガー」x3を持つ", "出擊時攜帶「投擲短劍」×3", "", true, "adopt", "startItem", null),
    E("rm_start_glintstone_scrap", "出撃時に「屑輝石」x2を持つ", "出擊時攜帶「碎輝石」×2", "", true, "new", "startItem", null, "d"),
    E("rm_start_gravity_stone_chunk", "出撃時に「塊の重力石」x2を持つ", "出擊時攜帶「塊狀重力石」×2", "", true, "new", "startItem", null, "d"),
    E("rm_start_spark_aroma", "出撃時に「火花の香り」x1を持つ", "出擊時攜帶「火花之香」×1", "", true, "adopt", "startItem", null),
    E("rm_start_poison_spray", "出撃時に「毒の噴霧」x1を持つ", "出擊時攜帶「毒之噴霧」×1", "", true, "adopt", "startItem", null),
    E("rm_start_iron_pot_perfume", "出撃時に「鉄壺の香薬」x1を持つ", "出擊時攜帶「鐵壺之香藥」×1", "", true, "adopt", "startItem", null),
    E("rm_start_uplifting_aroma", "出撃時に「高揚の香り」x1を持つ", "出擊時攜帶「高揚之香」×1", "", true, "adopt", "startItem", null),
    E("rm_start_acid_spray", "出撃時に「酸の噴霧」x1を持つ", "出擊時攜帶「酸之噴霧」×1", "", true, "adopt", "startItem", null),
    E("rm_start_frenzy_perfume", "出撃時に「狂熱の香薬」x1を持つ", "出擊時攜帶「狂熱之香藥」×1", "", true, "new", "startItem", null, "d"),
    E("rm_start_fire_grease", "出撃時に「火脂」x2を持つ", "出擊時攜帶「火脂」×2", "", true, "adopt", "startItem", null),
    E("rm_start_magic_grease", "出撃時に「魔力脂」x2を持つ", "出擊時攜帶「魔力脂」×2", "", true, "adopt", "startItem", null),
    E("rm_start_lightning_grease", "出撃時に「雷脂」x2を持つ", "出擊時攜帶「雷脂」×2", "", true, "adopt", "startItem", null),
    E("rm_start_holy_grease", "出撃時に「聖脂」x2を持つ", "出擊時攜帶「聖脂」×2", "", true, "adopt", "startItem", null),
    E("rm_start_shield_grease", "出撃時に「盾脂」x2を持つ", "出擊時攜帶「盾脂」×2", "", true, "adopt", "startItem", null),
    E("rm_start_stonesword_key", "出撃時に「石剣の鍵」x1を持つ", "出擊時攜帶「石劍鑰匙」×1", "", false, "adopt", "startItem", null),

    // ------------------------------------------------------------------------
    // 出擊時聖杯瓶（22 條）
    // ------------------------------------------------------------------------
    // note 不是 memory.txt 原文照錄——原始資料這 22 條全部留白，換算是使用者 2026-09-25
    // 逐條補齊的（同 §10.14.1 A 那 4 條能力值的前例）。實際的機制接入在 midnight.js 的
    // RM_CRYSTAL_TEARS，這裡只放顯示用的文字，比照本檔「純參考資料」的既有分工。
    //
    // 這一組跟其餘效果不同：不是被動加成，而是**一件可以使用的道具**（使用者明確規格
    // 「此類為特殊結晶雫／擁有時（只能存在一件）／操作盤的聖杯瓶使用可以左右切換聖杯瓶或
    // 是結晶雫／使用時間如聖杯瓶／使用次數1，用完需回到祝福才能補充」）。因此 midnight 不
    // 把它們接到 RELIC_MEMORY_AFFIX_ALIAS（那張表的語意是「持有就一直生效的加成」），而是
    // 另外一張 RM_CRYSTAL_TEARS。
    E("rm_start_crimson_crystal_tear", "出撃時に「緋色の結晶雫」を持つ", "出擊時攜帶「緋色的結晶雫」", "回復HP上限的50%HP", false, "new", "startFlask", null, "i"),
    E("rm_start_crimson_overflow_tear", "出撃時に「緋溢れの結晶雫」を持つ", "出擊時攜帶「緋色滿溢的結晶雫」", "20秒間 HP上限與HP提升30", false, "new", "startFlask", null, "i"),
    E("rm_start_crimson_bubble_tear", "出撃時に「緋湧きの結晶雫」を持つ", "出擊時攜帶「緋色湧現的結晶雫」", "20秒間 HP回復60", false, "new", "startFlask", null, "i"),
    E("rm_start_cerulean_crystal_tear", "出撃時に「青色の結晶雫」を持つ", "出擊時攜帶「青色的結晶雫」", "FP回復50", false, "new", "startFlask", null, "i"),
    E("rm_start_greenburst_crystal_tear", "出撃時に「緑湧きの結晶雫」を持つ", "出擊時攜帶「綠色湧現的結晶雫」", "20秒間 體力回復60", false, "new", "startFlask", null, "i"),
    E("rm_start_opaline_hardtear", "出撃時に「真珠色の硬雫」を持つ", "出擊時攜帶「珍珠色的硬雫」", "20秒間 HP價值+20", false, "new", "startFlask", null, "i"),
    E("rm_start_iridescent_hardtear", "出撃時に「斑彩色の硬雫」を持つ", "出擊時攜帶「斑彩色的硬雫」", "20秒間 屬性蓄積值上限+2、狀態異常全回復", false, "new", "startFlask", null, "i"),
    E("rm_start_leaden_hardtear", "出撃時に「鉛色の硬雫」を持つ", "出擊時攜帶「鉛色的硬雫」", "20秒間 減傷20%", false, "new", "startFlask", null, "i"),
    E("rm_start_magic_shrouding_cracked_tear", "出撃時に「魔力纏いの割れ雫」を持つ", "出擊時攜帶「纏繞魔力的碎裂雫」", "20秒間 魔攻擊力+10%", false, "new", "startFlask", null, "i"),
    E("rm_start_flame_shrouding_cracked_tear", "出撃時に「炎纏いの割れ雫」を持つ", "出擊時攜帶「纏繞火焰的碎裂雫」", "20秒間 炎攻擊力+10%", false, "new", "startFlask", null, "i"),
    E("rm_start_lightning_shrouding_cracked_tear", "出撃時に「雷纏いの割れ雫」を持つ", "出擊時攜帶「纏繞雷電的碎裂雫」", "20秒間 雷攻擊力+10%", false, "new", "startFlask", null, "i"),
    E("rm_start_holy_shrouding_cracked_tear", "出撃時に「聖纏いの割れ雫」を持つ", "出擊時攜帶「纏繞神聖的碎裂雫」", "20秒間 聖攻擊力+10%", false, "new", "startFlask", null, "i"),
    E("rm_start_stonebarb_cracked_tear", "出撃時に「岩棘の割れ雫」を持つ", "出擊時攜帶「岩棘的碎裂雫」", "10秒間 20%機率攻擊帶▲", false, "new", "startFlask", null, "i"),
    E("rm_start_greatbarb_cracked_tear", "出撃時に「大棘の割れ雫」を持つ", "出擊時攜帶「大棘的碎裂雫」", "20秒間 蓄力攻擊+10%", false, "new", "startFlask", null, "i"),
    E("rm_start_spiked_cracked_tear", "出撃時に「連棘の割れ雫」を持つ", "出擊時攜帶「連棘的碎裂雫」", "20秒間 2hit攻擊+10%", false, "new", "startFlask", null, "i"),
    E("rm_start_twiggy_cracked_tear", "出撃時に「細枝の割れ雫」を持つ", "出擊時攜帶「細枝的碎裂雫」", "死亡時不會掉落盧恩", false, "new", "startFlask", null, "id"),
    E("rm_start_winged_crystal_tear", "出撃時に「風の結晶雫」を持つ", "出擊時攜帶「風的結晶雫」", "Perfect~Great 都能減傷100%，但受到傷害時+20%", false, "new", "startFlask", null, "i"),
    E("rm_start_crimson_bubbletear", "出撃時に「緋色の泡雫」を持つ", "出擊時攜帶「緋色的泡雫」", "HP20%以下時 HP補充30，一次觸發結束", false, "new", "startFlask", null, "i"),
    E("rm_start_crimson_swirl_bubbletear", "出撃時に「緋色渦の泡雫」を持つ", "出擊時攜帶「緋色漩渦的泡雫」", "10秒內 被攻擊的傷害40%回復HP", false, "new", "startFlask", null, "i"),
    E("rm_start_opaline_bubbletear", "出撃時に「真珠色の泡雫」を持つ", "出擊時攜帶「珍珠色的泡雫」", "限一次 受到傷害時減傷80%", false, "new", "startFlask", null, "i"),
    E("rm_start_cerulean_hidden_tear", "出撃時に「青色の秘雫」を持つ", "出擊時攜帶「青色的祕雫」", "10秒內 FP消耗0", false, "new", "startFlask", null, "i"),
    E("rm_start_ruptured_crystal_tear", "出撃時に「破裂した結晶雫」を持つ", "出擊時攜帶「破裂的結晶雫」", "自身扣HP的一半，造成同等傷害×4", false, "new", "startFlask", null, "i"),

    // ------------------------------------------------------------------------
    // 武器類別（133 條）
    // ------------------------------------------------------------------------
    // ---- 短剣 ----
    E("rm_wp_dagger_atk", "短剣の攻撃力+", "短劍的攻擊力+", "短剣の攻撃力+5~8%", true, "adopt", "atkPct", null, "", [5, 8, "pct"]),
    E("rm_wp_dagger_hp", "短剣の攻撃でHP回復", "以短劍攻擊時回復HP", "短剣每攻擊20下 HP回復5~10", false, "adopt", "onAttack", null, "", [5, 10, "flat"]),
    E("rm_wp_dagger_fp", "短剣の攻撃でFP回復", "以短劍攻擊時回復FP", "短剣每攻擊20下 FP回復2~3", false, "adopt", "onAttack", null, "", [2, 3, "flat"]),
    E("rm_wp_dagger_set3_atk", "短剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的短劍時攻擊力+", "短剣武器3個以上持有 攻撃力+10%", false, "adopt", "special", null),
    E("rm_wp_dagger_find", "潜在する力から、短剣を見つけやすくなる", "潛在之力更容易出現短劍", "短剣更容易出現+10%", false, "adopt", "discovery", null),
    // ---- 直剣 ----
    E("rm_wp_straight_sword_atk", "直剣の攻撃力+", "直劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_straight_sword_hp", "直剣の攻撃でHP回復", "以直劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_straight_sword_fp", "直剣の攻撃でFP回復", "以直劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_straight_sword_set3_atk", "直剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的直劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_straight_sword_find", "潜在する力から、直剣を見つけやすくなる", "潛在之力更容易出現直劍", "", false, "adopt", "discovery", null),
    // ---- 大剣 ----
    E("rm_wp_greatsword_atk", "大剣の攻撃力+", "大劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_greatsword_hp", "大剣の攻撃でHP回復", "以大劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_greatsword_fp", "大剣の攻撃でFP回復", "以大劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_greatsword_set3_atk", "大剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的大劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_greatsword_find", "潜在する力から、大剣を見つけやすくなる", "潛在之力更容易出現大劍", "", false, "adopt", "discovery", null),
    // ---- 特大剣 ----
    E("rm_wp_colossal_sword_atk", "特大剣の攻撃力+", "特大劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_colossal_sword_hp", "特大剣の攻撃でHP回復", "以特大劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_colossal_sword_fp", "特大剣の攻撃でFP回復", "以特大劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_colossal_sword_set3_atk", "特大剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的特大劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_colossal_sword_find", "潜在する力から、特大剣を見つけやすくなる", "潛在之力更容易出現特大劍", "", false, "adopt", "discovery", null),
    // ---- 刺剣 ----
    E("rm_wp_thrusting_sword_atk", "刺剣の攻撃力+", "刺劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_thrusting_sword_hp", "刺剣の攻撃でHP回復", "以刺劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_thrusting_sword_fp", "刺剣の攻撃でFP回復", "以刺劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_thrusting_sword_set3_atk", "刺剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的刺劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_thrusting_sword_find", "潜在する力から、刺剣を見つけやすくなる", "潛在之力更容易出現刺劍", "", false, "adopt", "discovery", null),
    // ---- 重刺剣 ----
    E("rm_wp_heavy_thrusting_sword_atk", "重刺剣の攻撃力+", "重刺劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_heavy_thrusting_sword_hp", "重刺剣の攻撃でHP回復", "以重刺劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_heavy_thrusting_sword_fp", "重刺剣の攻撃でFP回復", "以重刺劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_heavy_thrusting_sword_set3_atk", "重刺剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的重刺劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_heavy_thrusting_sword_find", "潜在する力から、重刺剣を見つけやすくなる", "潛在之力更容易出現重刺劍", "", false, "adopt", "discovery", null),
    // ---- 曲剣 ----
    E("rm_wp_curved_sword_atk", "曲剣の攻撃力+", "曲劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_curved_sword_hp", "曲剣の攻撃でHP回復", "以曲劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_curved_sword_fp", "曲剣の攻撃でFP回復", "以曲劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_curved_sword_set3_atk", "曲剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的曲劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_curved_sword_find", "潜在する力から、曲剣を見つけやすくなる", "潛在之力更容易出現曲劍", "", false, "adopt", "discovery", null),
    // ---- 大曲剣 ----
    E("rm_wp_curved_greatsword_atk", "大曲剣の攻撃力+", "大曲劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_curved_greatsword_hp", "大曲剣の攻撃でHP回復", "以大曲劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_curved_greatsword_fp", "大曲剣の攻撃でFP回復", "以大曲劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_curved_greatsword_set3_atk", "大曲剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的大曲劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_curved_greatsword_find", "潜在する力から、大曲剣を見つけやすくなる", "潛在之力更容易出現大曲劍", "", false, "adopt", "discovery", null),
    // ---- 刀 ----
    E("rm_wp_katana_atk", "刀の攻撃力+", "刀的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_katana_hp", "刀の攻撃でHP回復", "以刀攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_katana_fp", "刀の攻撃でFP2回復", "以刀攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_katana_set3_atk", "刀の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的刀時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_katana_find", "潜在する力から、刀を見つけやすくなる", "潛在之力更容易出現刀", "", false, "adopt", "discovery", null),
    // ---- 両刃剣 ----
    E("rm_wp_twinblade_atk", "両刃剣の攻撃力+", "雙刃劍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_twinblade_hp", "両刃剣の攻撃でHP回復", "以雙刃劍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_twinblade_fp", "両刃剣の攻撃でFP回復", "以雙刃劍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_twinblade_set3_atk", "両刃剣の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的雙刃劍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_twinblade_find", "潜在する力から、両刃剣を見つけやすくなる", "潛在之力更容易出現雙刃劍", "", false, "adopt", "discovery", null),
    // ---- 斧 ----
    E("rm_wp_axe_atk", "斧の攻撃力+", "斧的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_axe_hp", "斧の攻撃でHP回復", "以斧攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_axe_fp", "斧の攻撃でFP回復", "以斧攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_axe_set3_atk", "斧の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的斧時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_axe_find", "潜在する力から、斧を見つけやすくなる", "潛在之力更容易出現斧", "", false, "adopt", "discovery", null),
    // ---- 大斧 ----
    E("rm_wp_greataxe_atk", "大斧の攻撃力+", "大斧的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_greataxe_hp", "大斧の攻撃でHP回復", "以大斧攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_greataxe_fp", "大斧の攻撃でFP回復", "以大斧攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_greataxe_set3_atk", "大斧の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的大斧時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_greataxe_find", "潜在する力から、大斧を見つけやすくなる", "潛在之力更容易出現大斧", "", false, "adopt", "discovery", null),
    // ---- 槌 ----
    E("rm_wp_hammer_atk", "槌の攻撃力+", "槌的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_hammer_hp", "槌の攻撃でHP回復", "以槌攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_hammer_fp", "槌の攻撃でFP回復", "以槌攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_hammer_set3_atk", "槌の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的槌時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_hammer_find", "潜在する力から、槌を見つけやすくなる", "潛在之力更容易出現槌", "", false, "adopt", "discovery", null),
    // ---- フレイル ----
    E("rm_wp_flail_atk", "フレイルの攻撃力+", "連枷的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_flail_hp", "フレイルの攻撃でHP回復", "以連枷攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_flail_fp", "フレイルの攻撃でFP回復", "以連枷攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_flail_set3_atk", "フレイルの武器種を3つ以上装備していると攻撃力+", "裝備3個以上的連枷時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_flail_find", "潜在する力から、フレイルを見つけやすくなる", "潛在之力更容易出現連枷", "", false, "adopt", "discovery", null),
    // ---- 大槌 ----
    E("rm_wp_great_hammer_atk", "大槌の攻撃力+", "大槌的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_great_hammer_hp", "大槌の攻撃でHP回復", "以大槌攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_great_hammer_fp", "大槌の攻撃でFP回復", "以大槌攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_great_hammer_set3_atk", "大槌の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的大槌時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_great_hammer_find", "潜在する力から、大槌を見つけやすくなる", "潛在之力更容易出現大槌", "", false, "adopt", "discovery", null),
    // ---- 特大武器 ----
    E("rm_wp_colossal_weapon_atk", "特大武器の攻撃力+", "特大武器的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_colossal_weapon_hp", "特大武器の攻撃でHP回復", "以特大武器攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_colossal_weapon_fp", "特大武器の攻撃でFP回復", "以特大武器攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_colossal_weapon_set3_atk", "特大武器の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的特大武器時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_colossal_weapon_find", "潜在する力から、特大武器を見つけやすくなる", "潛在之力更容易出現特大武器", "", false, "adopt", "discovery", null),
    // ---- 槍 ----
    E("rm_wp_spear_atk", "槍の攻撃力+", "槍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_spear_hp", "槍の攻撃でHP回復", "以槍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_spear_fp", "槍の攻撃でFP2回復", "以槍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_spear_set3_atk", "槍の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的槍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_spear_find", "潜在する力から、槍を見つけやすくなる", "潛在之力更容易出現槍", "", false, "adopt", "discovery", null),
    // ---- 大槍 ----
    E("rm_wp_great_spear_atk", "大槍の攻撃力+", "大槍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_great_spear_hp", "大槍の攻撃でHP回復", "以大槍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_great_spear_fp", "大槍の攻撃でFP回復", "以大槍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_great_spear_set3_atk", "大槍の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的大槍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_great_spear_find", "潜在する力から、大槍を見つけやすくなる", "潛在之力更容易出現大槍", "", false, "adopt", "discovery", null),
    // ---- 斧槍 ----
    E("rm_wp_halberd_atk", "斧槍の攻撃力+", "斧槍的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_halberd_hp", "斧槍の攻撃でHP回復", "以斧槍攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_halberd_fp", "斧槍の攻撃でFP回復", "以斧槍攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_halberd_set3_atk", "斧槍の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的斧槍時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_halberd_find", "潜在する力から、斧槍を見つけやすくなる", "潛在之力更容易出現斧槍", "", false, "adopt", "discovery", null),
    // ---- 鎌 ----
    E("rm_wp_reaper_atk", "鎌の攻撃力+", "鐮的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_reaper_hp", "鎌の攻撃でHP回復", "以鐮攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_reaper_fp", "鎌の攻撃でFP回復", "以鐮攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_reaper_set3_atk", "鎌の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的鐮時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_reaper_find", "潜在する力から、鎌を見つけやすくなる", "潛在之力更容易出現鐮", "", false, "adopt", "discovery", null),
    // ---- 鞭 ----
    E("rm_wp_whip_atk", "鞭の攻撃力+", "鞭的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_whip_hp", "鞭の攻撃でHP回復", "以鞭攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_whip_fp", "鞭の攻撃でFP回復", "以鞭攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_whip_set3_atk", "鞭の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的鞭時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_whip_find", "潜在する力から、鞭を見つけやすくなる", "潛在之力更容易出現鞭", "", false, "adopt", "discovery", null),
    // ---- 拳 ----
    E("rm_wp_fist_atk", "拳の攻撃力+", "拳的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_fist_hp", "拳の攻撃でHP回復", "以拳攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_fist_fp", "拳の攻撃でFP回復", "以拳攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_fist_set3_atk", "拳の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的拳時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_fist_find", "潜在する力から、拳を見つけやすくなる", "潛在之力更容易出現拳", "", false, "adopt", "discovery", null),
    // ---- 爪 ----
    E("rm_wp_claw_atk", "爪の攻撃力+", "爪的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_claw_hp", "爪の攻撃でHP回復", "以爪攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_claw_fp", "爪の攻撃でFP回復", "以爪攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_claw_set3_atk", "爪の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的爪時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_claw_find", "潜在する力から、爪を見つけやすくなる", "潛在之力更容易出現爪", "", false, "adopt", "discovery", null),
    // ---- 弓 ----
    E("rm_wp_bow_atk", "弓の攻撃力+", "弓的攻擊力+", "", true, "adopt", "atkPct", null),
    E("rm_wp_bow_hp", "弓の攻撃でHP回復", "以弓攻擊時回復HP", "", false, "adopt", "onAttack", null),
    E("rm_wp_bow_fp", "弓の攻撃でFP回復", "以弓攻擊時回復FP", "", false, "adopt", "onAttack", null),
    E("rm_wp_bow_set3_atk", "弓の武器種を3つ以上装備していると攻撃力+", "裝備3個以上的弓時攻擊力+", "", false, "adopt", "special", null),
    E("rm_wp_bow_find", "潜在する力から、弓を見つけやすくなる", "潛在之力更容易出現弓", "", false, "adopt", "discovery", null),
    // ---- 大弓 ----
    E("rm_wp_greatbow_find", "潜在する力から、大弓を見つけやすくなる", "潛在之力更容易出現大弓", "", false, "adopt", "discovery", null),
    // ---- クロスボウ ----
    E("rm_wp_crossbow_find", "潜在する力から、クロスボウを見つけやすくなる", "潛在之力更容易出現弩", "", false, "adopt", "discovery", null),
    // ---- バリスタ ----
    E("rm_wp_ballista_find", "潜在する力から、バリスタを見つけやすくなる", "潛在之力更容易出現弩砲", "", false, "adopt", "discovery", null),
    // ---- 小盾 ----
    E("rm_wp_small_shield_set3_hp", "小盾の武器種を3つ以上装備していると最大HP上昇", "裝備3個以上的小盾時最大HP上升", "+40", false, "adopt", "special", null),
    E("rm_wp_small_shield_find", "潜在する力から、小盾を見つけやすくなる", "潛在之力更容易出現小盾", "", false, "adopt", "discovery", null),
    // ---- 中盾 ----
    E("rm_wp_medium_shield_set3_hp", "中盾の武器種を3つ以上装備していると最大HP上昇", "裝備3個以上的中盾時最大HP上升", "+40", false, "adopt", "special", null),
    E("rm_wp_medium_shield_find", "潜在する力から、中盾を見つけやすくなる", "潛在之力更容易出現中盾", "", false, "adopt", "discovery", null),
    // ---- 大盾 ----
    E("rm_wp_greatshield_set3_hp", "大盾の武器種を3つ以上装備していると最大HP上昇", "裝備3個以上的大盾時最大HP上升", "+40", false, "adopt", "special", null),
    E("rm_wp_greatshield_find", "潜在する力から、大盾を見つけやすくなる", "潛在之力更容易出現大盾", "", false, "adopt", "discovery", null),
    // ---- 杖 ----
    E("rm_wp_staff_set3_fp", "杖の武器種を3つ以上装備していると最大FP上昇", "裝備3個以上的法杖時最大FP上升", "+25", false, "adopt", "special", null),
    E("rm_wp_staff_find", "潜在する力から、杖を見つけやすくなる", "潛在之力更容易出現法杖", "", false, "adopt", "discovery", null),
    // ---- 聖印 ----
    E("rm_wp_seal_set3_fp", "聖印の武器種を3つ以上装備していると最大FP上昇", "裝備3個以上的聖印時最大FP上升", "+25", false, "adopt", "special", null),
    E("rm_wp_seal_find", "潜在する力から、聖印を見つけやすくなる", "潛在之力更容易出現聖印", "", false, "adopt", "discovery", null),

    // ------------------------------------------------------------------------
    // 角色專用（65 條）
    // ------------------------------------------------------------------------
    // ---- 追跡者 ----
    E("rm_tracker_ability_art_gauge", "アビリティ発動時、アーツゲージ増加", "【追蹤者】發動能力時技藝計量表增加", "アビリティ発動時　技藝冷卻-10s", false, "adopt", "special", "tracker"),
    E("rm_tracker_skill_flame_follow", "スキル使用時、通常攻撃で炎を纏った追撃を行う", "【追蹤者】使用技能時，一般攻擊會進行纏繞火焰的追擊（僅限大劍）", "技能使用時 大劍附加炎屬性 持續10s", false, "adopt", "special", "tracker"),
    E("rm_tracker_skill_charge", "スキルの使用回数+1", "【追蹤者】技能使用次數+1", "技能使用次數+1", false, "adopt", "special", "tracker"),
    E("rm_tracker_art_burn", "アーツ発動時、周囲を延焼", "【追蹤者】發動技藝時延燒周圍", "技藝發動時 每1秒給予敵人 炎2，持續10秒", false, "adopt", "special", "tracker"),
    E("rm_tracker_mind_up_vig_down", "精神力上昇、生命力低下", "【追蹤者】精神力上升、生命力下降", "+5/-20", false, "adopt", "levelStat", "tracker"),
    E("rm_tracker_int_fth_up_str_dex_down", "知力/信仰上昇、筋力/技量低下", "【追蹤者】知力／信仰上升、筋力／技量下降", "+10 -10", false, "adopt", "levelStat", "tracker"),
    E("rm_tracker_skill_bleed", "スキルに、出血の状態異常を付加", "【追蹤者】技能附加出血狀態異常", "技能使用時 敵人出血+2", false, "adopt", "special", "tracker"),
    // ---- 守護者 ----
    E("rm_guardian_ability_guard_shockwave", "アビリティ発動中 ガード成功時、衝撃波が発生", "【守護者】能力發動中防禦成功時產生衝擊波", "高防禦發動中 防禦成功時 依盾牌稀有度給予10/20/30點傷害", false, "adopt", "special", "guardian"),
    E("rm_guardian_skill_duration", "スキルの持続時間延長", "【守護者】技能的持續時間延長", "技能持續時間延長2s", false, "adopt", "special", "guardian"),
    E("rm_guardian_art_party_regen", "アーツ発動時、周囲の味方HPを徐々に回復", "【守護者】發動技藝時逐漸回復周圍隊友的HP", "技藝發動時 周圍隊友HP每秒恢復4點，持續10秒", false, "adopt", "special", "guardian"),
    E("rm_guardian_halberd_whirlwind", "斧槍タメ攻撃時、つむじ風が発生", "【守護者】斧槍蓄力攻擊時產生旋風", "斧槍蓄力攻擊時 產生旋風，對雜兵造成20傷害", false, "adopt", "special", "guardian"),
    E("rm_guardian_str_dex_up_vig_down", "筋力/技量上昇、生命力低下", "【守護者】筋力／技量上升、生命力下降", "+5 -30", false, "adopt", "levelStat", "guardian"),
    E("rm_guardian_mind_fth_up_vig_down", "精神力/信仰上昇、生命力低下", "【守護者】精神力／信仰上升、生命力下降", "+10 -30", false, "adopt", "levelStat", "guardian"),
    E("rm_guardian_skill_party_cut", "スキル使用時、周囲の味方のカット率上昇", "【守護者】使用技能時周圍隊友的減傷率上升", "技能使用時 同戰場隊友的HP價值+10", false, "adopt", "special", "guardian"),
    // ---- 鉄の目 ----
    E("rm_iron_eye_skill_charge", "スキルの使用回数+1", "【鐵之眼】技能使用次數+1", "技能使用次數+1", false, "adopt", "special", "iron_eye"),
    E("rm_iron_eye_charged_art_poison", "アーツのタメ発動時、毒の状態異常を付加", "【鐵之眼】蓄力發動技藝時附加猛毒狀態異常", "技藝發動後 武器附加猛毒異常10s", false, "adopt", "special", "iron_eye"),
    E("rm_iron_eye_art_thrust_counter", "アーツ発動後、刺突カウンター強化", "【鐵之眼】發動技藝後突刺反擊強化", "", false, "adopt", "special", "iron_eye", "r"),
    E("rm_iron_eye_weakness_duration", "弱点の持続時間を延長させる", "【鐵之眼】延長弱點的持續時間", "", false, "adopt", "special", "iron_eye", "r"),
    E("rm_iron_eye_vig_str_up_dex_down", "生命力/筋力上昇、技量低下", "【鐵之眼】生命力／筋力上升、技量下降", "HP+20／筋力+10／技量-10", false, "adopt", "levelStat", "iron_eye"),
    E("rm_iron_eye_arc_up_dex_down", "神秘上昇、技量低下", "【鐵之眼】神秘上升、技量下降", "神秘+10／技量-10", false, "adopt", "levelStat", "iron_eye"),
    E("rm_iron_eye_skill_poison_burst", "スキルに毒の状態異常を付加して毒状態の敵に大ダメージ", "【鐵之眼】技能附加猛毒狀態異常，並對中毒的敵人造成大傷害", "技能後 武器附加猛毒異常10s，並對猛毒狀態的敵人造成1.1倍傷害", false, "adopt", "special", "iron_eye"),
    // ---- レディ ----
    E("rm_lady_skill_damage", "スキルのダメージ上昇", "【淑女】技能的傷害上升", "", false, "adopt", "special", "lady", "r"),
    E("rm_lady_art_kill_atk", "アーツ発動中、敵撃破で攻撃力上昇", "【淑女】技藝發動中擊破敵人時攻擊力上升", "", false, "adopt", "special", "lady", "r"),
    E("rm_lady_dagger_restage", "短剣による攻撃連続時 周囲の敵に、直近の出来事を再演", "【淑女】以短劍連續攻擊時，對周圍敵人重演最近發生的事", "", false, "adopt", "special", "lady", "r"),
    E("rm_lady_backstab_stealth", "背後からの致命の一撃後 自身の姿を見え難くし、足音を消す", "【淑女】從背後致命一擊後，使自身身影難以被看見並消除腳步聲", "", false, "adopt", "special", "lady", "r"),
    E("rm_lady_vig_str_up_mind_down", "生命力/筋力上昇、精神力低下", "【淑女】生命力／筋力上升、精神力下降", "HP+20／筋力+10／FP-10", false, "adopt", "levelStat", "lady"),
    E("rm_lady_mind_fth_up_int_down", "精神力/信仰上昇、知力低下", "【淑女】精神力／信仰上升、知力下降", "FP+20／信仰+10／知力-10", false, "adopt", "levelStat", "lady"),
    E("rm_lady_skill_invincible", "スキル使用時、僅かに無敵", "【淑女】使用技能時短暫無敵", "技能使用時 2s無敵", false, "adopt", "special", "lady"),
    // ---- 無頼漢 ----
    E("rm_ruffian_skill_damaged_buff", "スキル中に攻撃を受けると攻撃力と最大スタミナ上昇", "【無賴漢】技能中受到攻擊時攻擊力與最大體力上升", "", false, "adopt", "special", "ruffian", "r"),
    E("rm_ruffian_art_duration", "アーツの効果時間延長", "【無賴漢】技藝的效果時間延長", "", false, "adopt", "special", "ruffian", "r"),
    E("rm_ruffian_mind_int_up_vig_end_down", "精神力/知力上昇、生命力/持久力低下", "【無賴漢】精神力／知力上升、生命力／持久力下降", "FP+20／知力+10／HP-20／體力-15", false, "adopt", "levelStat", "ruffian"),
    E("rm_ruffian_arc_up_vig_down", "神秘上昇、生命力低下", "【無賴漢】神秘上升、生命力下降", "神秘+10／HP-20", false, "adopt", "levelStat", "ruffian"),
    E("rm_ruffian_skill_enemy_atk_down", "スキル命中時、敵の攻撃力低下", "【無賴漢】技能命中時敵人的攻擊力下降", "技能命中時 敵人攻擊力-80", false, "adopt", "special", "ruffian"),
    // ---- 復讐者 ----
    E("rm_avenger_art_ghostflame", "アーツ発動時、霊炎の爆発を発生", "【復仇者】發動技藝時產生靈炎爆炸", "", false, "adopt", "special", "avenger", "r"),
    E("rm_avenger_art_sacrifice_heal", "アーツ発動時 自身のHPと引き換えに周囲の味方のHPを全回復", "【復仇者】發動技藝時以自身HP為代價，將周圍隊友的HP全部回復", "", false, "adopt", "special", "avenger", "r"),
    E("rm_avenger_art_family_buff", "アーツ発動時、ファミリーと味方を強化", "【復仇者】發動技藝時強化家族與隊友", "", false, "adopt", "special", "avenger", "r"),
    E("rm_avenger_family_selfbuff", "ファミリーと共闘中の間、自身を強化", "【復仇者】與家族共鬥期間強化自身", "", false, "adopt", "special", "avenger", "r"),
    E("rm_avenger_vig_end_up_mind_down", "生命力/持久力上昇、精神力低下", "【復仇者】生命力／持久力上升、精神力下降", "HP+20／體力+15／FP-10", false, "adopt", "levelStat", "avenger"),
    E("rm_avenger_str_up_fth_down", "筋力上昇、信仰低下", "【復仇者】筋力上升、信仰下降", "筋力+10／信仰-10", false, "adopt", "levelStat", "avenger"),
    E("rm_avenger_ability_max_fp", "アビリティ発動時、最大FPが2%上昇", "【復仇者】發動能力時最大FP上升2%", "死靈術發動時 最大FP+2%", false, "adopt", "special", "avenger"),
    // ---- 隠者 ----
    E("rm_hermit_art_bleed_atk", "アーツ発動時 自身が出血状態になり、攻撃力上昇", "【隱者】發動技藝時自身進入出血狀態，攻擊力上升", "", false, "adopt", "special", "hermit", "r"),
    E("rm_hermit_art_max_hp", "アーツ発動時、最大HP上昇", "【隱者】發動技藝時最大HP上升", "", false, "adopt", "special", "hermit", "r"),
    E("rm_hermit_marks_magic_ground", "属性痕を集めた時、「魔術の地」が発動", "【隱者】集滿屬性痕時發動「魔術之地」", "", false, "adopt", "special", "hermit", "r"),
    E("rm_hermit_vig_end_dex_up_int_fth_down", "生命力/持久力/技量上昇、知力/信仰低下", "【隱者】生命力／持久力／技量上升、知力／信仰下降", "HP+20／體力+15／技量+10／知力-10／信仰-10", false, "adopt", "levelStat", "hermit"),
    E("rm_hermit_int_fth_up_mind_down", "知力/信仰上昇、精神力低下", "【隱者】知力／信仰上升、精神力下降", "知力+10／信仰+10／FP-20", false, "adopt", "levelStat", "hermit"),
    E("rm_hermit_marks_element_cut", "属性痕を集めた時、対応する属性カット率上昇", "【隱者】集滿屬性痕時對應的屬性減傷率上升", "集滿屬性痕時 對應屬性的減傷+5% 持續10s", false, "adopt", "special", "hermit"),
    // ---- 執行者 ----
    E("rm_executor_yoto_release_heal", "スキル中、妖刀が解放状態になるとHP回復", "【執行者】技能中妖刀進入解放狀態時回復HP", "", false, "adopt", "special", "executor", "r"),
    E("rm_executor_art_roar_heal", "アーツ発動中、咆哮でHP回復", "【執行者】技藝發動中以咆哮回復HP", "", false, "adopt", "special", "executor", "r"),
    E("rm_executor_vig_end_up_arc_down", "生命力/持久力上昇、神秘低下", "【執行者】生命力／持久力上升、神秘下降", "HP+20／體力+15／神秘-10", false, "adopt", "levelStat", "executor"),
    E("rm_executor_dex_arc_up_vig_down", "技量/神秘上昇、生命力低下", "【執行者】技量／神秘上升、生命力下降", "技量+10／神秘+10／HP-20", false, "adopt", "levelStat", "executor"),
    E("rm_executor_ability_regen", "アビリティ発動時、HPをゆっくりと回復", "【執行者】發動能力時緩慢回復HP", "不撓發動時 HP 10秒內回復30", false, "adopt", "special", "executor"),
    // ---- 学者 ----
    E("rm_scholar_skill_progress", "スキルの進捗率の低下を抑制", "【學者】抑制技能進度下降", "技能的體力消耗-2", false, "adopt", "special", "scholar"),
    E("rm_scholar_skill_party_atk", "スキル使用時、対象に含まれた味方の攻撃力上昇", "【學者】使用技能時，納入對象的隊友攻擊力上升", "技能使用時 隊友攻擊力+5% 10s", false, "adopt", "special", "scholar"),
    E("rm_scholar_specimen_rune", "スキルによる標本が増える度、ルーンを取得", "【學者】技能的標本每增加一個就取得盧恩", "", false, "skip", "special", "scholar"),
    E("rm_scholar_art_link_dot", "アーツでリンクした敵対象に、継続ダメージ", "【學者】對以技藝連結的敵方對象造成持續傷害", "技藝連結的敵人 20s內每秒扣5", false, "adopt", "special", "scholar"),
    // ---- 葬儀屋 ----
    E("rm_undertaker_art_atk", "アーツ発動時、攻撃力上昇", "【葬儀屋】發動技藝時攻擊力上升", "技藝發動時 攻擊力+7% 10s", false, "adopt", "special", "undertaker"),
    E("rm_undertaker_art_touch_heal", "アーツ発動時、触れた味方のHP回復", "【葬儀屋】發動技藝時回復接觸到的隊友HP", "技藝發動時 隊友HP 10s內回復20", false, "adopt", "special", "undertaker"),
    E("rm_undertaker_combo_final_atk", "連撃の最終攻撃命中時、攻撃力上昇", "【葬儀屋】連擊的最後一擊命中時攻擊力上升", "2Hit命中時 攻擊力+6%", false, "adopt", "special", "undertaker"),
    E("rm_undertaker_incant_buff_atk", "祈祷を使用して、自身に補助効果発生時、物理攻撃力上昇", "【葬儀屋】使用祈禱對自身產生輔助效果時物理攻擊力上升", "以祈禱對自身產生補助效果時 物理攻擊力+6% 10s", false, "adopt", "special", "undertaker"),
    // ---- 学者 ----
    E("rm_scholar_mind_up_vig_down", "精神力上昇、生命力低下", "【學者】精神力上升、生命力下降", "FP+20／HP-20", false, "adopt", "levelStat", "scholar"),
    E("rm_scholar_end_dex_up_int_arc_down", "持久力/技量上昇、知力/神秘低下", "【學者】持久力／技量上升、知力／神秘下降", "體力+15／技量+10／知力-10／神秘-10", false, "adopt", "levelStat", "scholar"),
    // ---- 葬儀屋 ----
    E("rm_undertaker_dex_up_vig_fth_down", "技量上昇、生命力/信仰低下", "【葬儀屋】技量上升、生命力／信仰下降", "技量+10／HP-20／信仰-10", false, "adopt", "levelStat", "undertaker"),
    E("rm_undertaker_mind_fth_up_str_down", "精神力/信仰上昇、筋力低下", "【葬儀屋】精神力／信仰上升、筋力下降", "FP+20／信仰+10／筋力-10", false, "adopt", "levelStat", "undertaker"),
    E("rm_undertaker_art_skill_reset", "アーツ発動後、スキル再使用可能", "【葬儀屋】發動技藝後技能可再次使用", "技藝發動後 技能立刻冷卻完一次", false, "adopt", "special", "undertaker"),
    // ---- 学者 ----
    E("rm_scholar_self_skill_fp", "スキルを自身に使用時、FP消費軽減", "【學者】對自身使用技能時減輕FP消耗", "對自身使用技能時 FP消耗-4", false, "adopt", "special", "scholar"),

    // ------------------------------------------------------------------------
    // 悪效果（26 條）
    // ------------------------------------------------------------------------
    E("rm_bad_vig_arc_down", "生命力と神秘が低下", "生命力與神秘下降", "-20/ -5", false, "text", "badEffect", null, "b"),
    E("rm_bad_str_int_down", "筋力と知力が低下", "筋力與知力下降", "-5/-5", false, "text", "badEffect", null, "b"),
    E("rm_bad_dex_fth_down", "技量と信仰が低下", "技量與信仰下降", "-5/-5", false, "text", "badEffect", null, "b"),
    E("rm_bad_int_dex_down", "知力と技量が低下", "知力與技量下降", "-5/-5", false, "text", "badEffect", null, "b"),
    E("rm_bad_fth_str_down", "信仰と筋力が低下", "信仰與筋力下降", "-5/-5", false, "text", "badEffect", null, "b"),
    E("rm_bad_rune_gain_down", "取得ルーンが10%減少", "取得盧恩減少10%", "擊破敵人盧恩-1", false, "text", "badEffect", null, "b"),
    E("rm_bad_hp_drain", "HP持続減少", "HP持續減少", "每30s -2", false, "text", "badEffect", null, "b"),
    E("rm_bad_all_resist_down", "すべての状態異常耐性低下", "所有狀態異常耐性下降", "蓄積直上限-1", false, "text", "badEffect", null, "b"),
    E("rm_bad_flask_cut_down", "聖杯瓶使用時、カット率低下", "使用聖杯瓶時減傷率下降", "HP價值-12~18", false, "text", "badEffect", null, "b"),
    E("rm_bad_after_dodge_damage_up", "回避直後の被ダメージ増加", "迴避直後受到的傷害增加", "受傷+10~18%", false, "text", "badEffect", null, "b", [10, 18, "pct"]),
    E("rm_bad_dodge_combo_cut_down", "回避連続時、カット率低下", "連續迴避時減傷率下降", "HP價值-12~18", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_poison", "被ダメージ時、毒を蓄積", "受擊時累積猛毒", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_rot", "被ダメージ時、腐敗を蓄積", "受擊時累積腐敗", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_bleed", "被ダメージ時、出血を蓄積", "受擊時累積出血", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_frost", "被ダメージ時、冷気を蓄積", "受擊時累積凍傷", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_sleep", "被ダメージ時、睡眠を蓄積", "受擊時累積睡眠", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_madness", "被ダメージ時、発狂を蓄積", "受擊時累積發狂", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_damaged_death", "被ダメージ時、死を蓄積", "受擊時累積呪死", "+1", false, "text", "badEffect", null, "b"),
    E("rm_bad_flask_heal_down", "聖杯瓶の回復量低下", "聖杯瓶回復量下降", "-20%~40%", false, "text", "badEffect", null, "b"),
    E("rm_bad_art_gauge_slow", "アーツゲージ蓄積鈍化", "技藝計量表蓄積變慢", "冷卻+10~20%", false, "text", "badEffect", null, "b", [10, 20, "pct"]),
    E("rm_bad_hp_not_full_atk_down", "HP最大未満時、攻撃力低下", "HP未滿時攻擊力下降", "-8%~13%", false, "text", "badEffect", null, "b"),
    E("rm_bad_hp_not_full_poison", "HP最大未満時、毒が蓄積", "HP未滿時累積猛毒", "每15s +1蓄積", false, "text", "badEffect", null, "b"),
    E("rm_bad_hp_not_full_rot", "HP最大未満時、腐敗が蓄積", "HP未滿時累積腐敗", "每15s +1蓄積", false, "text", "badEffect", null, "b"),
    E("rm_bad_near_death_max_hp_down", "瀕死時、最大HPが60秒間25%低下", "瀕死時最大HP於60秒內下降25%", "", false, "text", "badEffect", null, "b"),
    E("rm_bad_executor_skill_atk_cut", "スキル中の攻撃力上昇、攻撃時にカット率低下", "【執行者】技能中攻擊力上升，攻擊時減傷率下降", "", false, "text", "badEffect", "executor", "b"),
    E("rm_bad_low_cut_rare_nullify", "カット率低下時、稀に敵から受ける攻撃を無効化", "減傷率下降時，稀有機率無效化敵人攻擊", "", false, "text", "badEffect", null, "b"),

    // ------------------------------------------------------------------------
    // 其他（1 條）
    // ------------------------------------------------------------------------
    E("rm_revenge_heal", "ダメージを受けた直後、攻撃によりHPの一部を回復", "受傷直後以攻擊回復部分HP", "受到攻擊後, 1s內回覆所受傷害的12~22%HP", false, "adopt", "special", null, "", [12, 22, "pct"]),

    // ------------------------------------------------------------------------
    // 魔術（24 條）
    // ------------------------------------------------------------------------
    // ---- 祈禱系統別 ----
    E("rm_school_glintblade", "輝剣の魔術の威力を+12%", "輝劍魔術的威力+", "輝剣の魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_stonedigger", "石掘りの魔術の威力を+12%", "掘石魔術的威力+", "石掘りの魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_carian_sword", "カーリアの剣の魔術の威力を+12%", "卡利亞之劍魔術的威力+", "カーリアの剣の魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_invisibility", "不可視の魔術の威力を+12%", "不可視魔術的威力+", "不可視魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_crystalian", "結晶人の魔術の威力を+12%", "結晶人魔術的威力+", "結晶人魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_gravity", "重力の魔術の威力を+12%", "重力魔術的威力+", "重力魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_thorn", "茨の魔術の威力を+12%", "荊棘魔術的威力+", "茨魔術の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_golden_order", "黄金律原理主義の祈祷の威力を+12%", "黃金律原理主義祈禱的威力+", "黄金律原理主義の祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_capital_dragon_cult", "王都古竜信仰の祈祷の威力を+12%", "王都古龍信仰祈禱的威力+", "王都古竜信仰の祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_giants_flame", "巨人の火の祈祷の威力を+12%", "巨人之火祈禱的威力+", "巨人の火の祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_godslayer", "神狩りの祈祷の威力を+12%", "弒神祈禱的威力+", "神狩りの祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_beast", "獣の祈祷の威力を+12%", "獸祈禱的威力+", "獣の祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_frenzied_flame", "狂い火の祈祷の威力を+12%", "狂亂火焰祈禱的威力+", "狂い火の祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    E("rm_school_dragon_communion", "竜餐の祈祷の威力を+12%", "龍餐祈禱的威力+", "竜餐の祈祷の威力+8~12%", true, "adopt", "spellSchool", null, "", [8, 12, "pct"]),
    // ---- 祈禱置換 ----
    E("rm_spellswap_glintstone_pebble_blade", "出撃時の武器の魔術を「魔術の輝剣」にする", "出擊時武器的魔術變為「魔術的輝劍」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_carian_greatsword", "出撃時の武器の魔術を「カーリアの大剣」にする", "出擊時武器的魔術變為「卡利亞的大劍」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_night_shard", "出撃時の武器の魔術を「夜のつぶて」にする", "出擊時武器的魔術變為「夜之礫」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_magma_shot", "出撃時の武器の魔術を「溶岩弾」にする", "出擊時武器的魔術變為「熔岩彈」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_briars_of_punishment", "出撃時の武器の魔術を「罰の茨」にする", "出擊時武器的魔術變為「懲罰之荊」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_golden_vow_wrath", "出撃時の武器の祈祷を「黄金の怒り」にする", "出擊時武器的祈禱變為「黃金的怒火」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_lightning_spear", "出撃時の武器の祈祷を「雷の槍」にする", "出擊時武器的祈禱變為「雷之槍」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_o_flame", "出撃時の武器の祈祷を「火よ！」にする", "出擊時武器的祈禱變為「火焰啊！」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_beast_claw", "出撃時の武器の祈祷を「獣爪」にする", "出擊時武器的祈禱變為「獸爪」", "", false, "adopt", "grantSpell", null),
    E("rm_spellswap_dragonfire", "出撃時の武器の祈祷を「竜炎」にする", "出擊時武器的祈禱變為「龍炎」", "", false, "adopt", "grantSpell", null),

    // ------------------------------------------------------------------------
    // 盧恩（3 條）
    // ------------------------------------------------------------------------
    // ---- 商店 ----
    E("rm_critical_rune", "致命の一撃で、ルーンを取得", "致命一擊時取得盧恩", "", false, "adopt", "special", null),
    E("rm_shop_discount", "出撃中、ショップでの購入に必要なルーンが割引", "出擊中商店購買所需的盧恩打折", "購買物品有10~20%機率免費", false, "adopt", "special", null, "", [10, 20, "pct"]),
    E("rm_party_rune_up", "自身と味方の取得ルーン増加", "自身與隊友的取得盧恩增加", "踏破板塊時 自身與隊友的盧恩額外+1", false, "adopt", "special", null),

    // ------------------------------------------------------------------------
    // 固定遺物才有的效果（4 條，2026-09-25 補建）
    // ------------------------------------------------------------------------
    // 這 4 條被固定遺物引用，但 memory.txt 的 415 條隨機效果清單裡完全沒有（原 POOL_MISMATCH
    // 的 kind: "missing"）。使用者 2026-09-25 指示「補建成新效果」，因此在這裡建檔。
    // 同一批 missing 中的「ジェスチャー『あぐら』により、発狂が蓄積」使用者指示**拿掉**，
    // 已從「魔の夜」「魔の暗き夜」兩顆的效果清單中移除，不在這裡補建——ジェスチャー 這個
    // 機制在 midnight 完全不存在（0 處）。
    //
    // memory.txt 對這 4 條連名稱都沒收錄，換算說明是使用者 2026-09-25 補的（note 不是原文）：
    //   ・アイテムの効果が周囲の味方にも発動：使用道具時 同一戰場的友軍獲得 20% 效果（固定值）
    //   ・近接攻撃力上昇：近距離攻擊力上升 8~12%
    //   ・戦技攻撃力上昇：戰技攻擊力上升 8~12%
    //   ・状態異常ゲージがある時、徐々に攻撃力上昇：身負異常狀態時攻擊力上升 8~12%
    //     （使用者的換算沒有「逐漸」，照換算一次到位）
    // stackable 使用者沒有指定，維持 null（＝ activeAttachedEffectIds() 的預設「不可疊加」）。
    // 它們仍是 relicOnly（只出現在固定配置遺物上），不進抽選池。
    E("rm_item_effect_to_allies", "アイテムの効果が周囲の味方にも発動", "道具的效果也會對周圍的隊友發動", "使用道具時 同一戰場的友軍獲得20%效果", null, "adopt", "special", null, "r"),
    E("rm_melee_atk_up", "近接攻撃力上昇", "近戰攻擊力上升", "近距離攻擊力上升8~12%", null, "adopt", "atkPct", null, "r", [8, 12, "pct"]),
    E("rm_weapon_skill_atk_up", "戦技攻撃力上昇", "戰技攻擊力上升", "戰技攻擊力上升8~12%", null, "adopt", "atkPct", null, "r", [8, 12, "pct"]),
    E("rm_ailment_gauge_atk_up", "状態異常ゲージがある時、徐々に攻撃力上昇", "有狀態異常計量表時，攻擊力逐漸上升", "身負異常狀態時攻擊力上升8~12%", null, "adopt", "overTime", null, "r", [8, 12, "pct"]),
  ];

  // --------------------------------------------------------------------------
  // 武器類別的家族繼承（使用者 2026-09-25 確認）
  // --------------------------------------------------------------------------
  // memory.txt 的武器類別 133 條中，只有「短剣」那一組附了換算說明（note），其餘 31 種
  // 武器類別的同型效果原始資料整片留白。使用者 2026-09-25 明確確認：**其餘 31 種武器
  // 類別與短剣同組共用同樣的數值**，因此在這裡機械化繼承。
  //
  // 刻意不去改寫上面那 133 條的字面值：檔頭承諾 note「原文照錄，空字串代表原始資料沒附
  // 說明」，直接把推定值寫成字面值，之後就分不出哪些是 memory.txt 寫的、哪些是這次補的。
  // 改成在陣列建好之後跑一次繼承，被繼承的條目留下 inheritedFrom（來源 effect id），
  // 要回頭查「原始資料究竟有沒有寫」時看這個欄位即可。
  //
  // 以 id 尾綴判定同型，五種：
  //   _atk        ○○の攻撃力+                       → [5, 8] pct
  //   _hp         ○○の攻撃でHP回復                  → [5, 10] flat
  //   _fp         ○○の攻撃でFP回復                  → [2, 3] flat
  //   _set3_atk   ○○を3つ以上装備していると攻撃力+   → 固定 10%，只繼承 note
  //   _find       潜在する力から、○○を見つけやすくなる → 固定 10%，只繼承 note
  // 盾（小盾／中盾／大盾）的 _set3_hp 與 杖／聖印 的 _set3_fp **不在此列**：它們原始資料
  // 本來就各自寫了固定值（+40／+25），note 非空，繼承一律跳過已有 note 的條目。
  var WEAPON_FAMILY_SOURCE = "dagger";
  // 比對順序有意義：set3_atk 必須排在 atk 前面，否則 "..._set3_atk" 會先被 "_atk" 吃掉。
  var WEAPON_FAMILY_KINDS = ["set3_atk", "atk", "hp", "fp", "find"];

  function weaponFamilySplit(id) {
    if (id.indexOf("rm_wp_") !== 0) return null;
    var rest = id.slice("rm_wp_".length);
    for (var i = 0; i < WEAPON_FAMILY_KINDS.length; i++) {
      var suffix = "_" + WEAPON_FAMILY_KINDS[i];
      if (rest.length > suffix.length && rest.slice(-suffix.length) === suffix) {
        return { family: rest.slice(0, -suffix.length), kind: WEAPON_FAMILY_KINDS[i] };
      }
    }
    return null;
  }

  // 該武器類別的日文名。_find 的本文（「潜在する力から、○○を見つけやすくなる」）32 種
  // 全都有，是最穩的來源；抽不到時退回 _atk 的「○○の攻撃力+」。
  function weaponFamilyLabelJa(group) {
    var m;
    if (group.find) {
      m = /^潜在する力から、(.+)を見つけやすくなる$/.exec(group.find.name.ja);
      if (m) return m[1];
    }
    if (group.atk) {
      m = /^(.+)の攻撃力/.exec(group.atk.name.ja);
      if (m) return m[1];
    }
    return null;
  }

  function applyWeaponFamilyInheritance() {
    var groups = {};
    for (var i = 0; i < EFFECTS.length; i++) {
      var parsed = weaponFamilySplit(EFFECTS[i].id);
      if (!parsed) continue;
      if (!groups[parsed.family]) groups[parsed.family] = {};
      groups[parsed.family][parsed.kind] = EFFECTS[i];
    }

    var source = groups[WEAPON_FAMILY_SOURCE];
    if (!source) return;
    var sourceLabel = weaponFamilyLabelJa(source);
    if (!sourceLabel) return;

    var names = Object.keys(groups);
    for (var n = 0; n < names.length; n++) {
      if (names[n] === WEAPON_FAMILY_SOURCE) continue;
      var group = groups[names[n]];
      var label = weaponFamilyLabelJa(group);
      if (!label) continue;
      for (var k = 0; k < WEAPON_FAMILY_KINDS.length; k++) {
        var kind = WEAPON_FAMILY_KINDS[k];
        var target = group[kind];
        var src = source[kind];
        // 原始資料自己就有 note 的條目一律不動（盾的 _set3_hp 等）。
        if (!target || !src || !src.note || target.note) continue;
        target.note = src.note.split(sourceLabel).join(label);
        target.range = src.range ? src.range.slice() : null;
        target.unit = src.unit;
        target.inheritedFrom = src.id;
      }
    }
  }

  applyWeaponFamilyInheritance();

  // --------------------------------------------------------------------------
  // 固定配置遺物記憶（memory.txt「【固定配置遺物記憶】」以下的 18 個）
  // --------------------------------------------------------------------------
  // 這一組不進隨機抽選：達成 howto 的條件就直接給整顆，三個效果是指定的、不擲骰。
  //
  // effects 保留 memory.txt 的原文字串，而不是指向 EFFECTS 的 id——因為這 18 顆引用的
  // 效果名稱有 13 條在隨機池裡**不存在或不完全一致**（見下方 POOL_MISMATCH）。在使用者
  // 確認這些是同一條效果的強化級距、還是獨立的新效果之前，不能自行對應過去，否則會把
  // 「致命の一撃強化+1」默默當成「致命の一撃強化」。
  function R(id, name, howto, effects) {
    return { id: id, name: name, howto: howto, effects: effects, phase: 2 };
  }

  var FIXED_RELICS = [
    R(
      "relic_imi_oni_charm",
      C("忌み鬼の呪物", "忌鬼的咒物"),
      C("マルギット撃破", "擊破瑪爾基特"),
      ["武器の持ち替え時、物理攻撃力上昇", "投擲ナイフの攻撃力上昇", "生命力+1"]
    ),
    R(
      "relic_beast_night",
      C("獣の夜", "獸之夜"),
      C("出撃「三つ首の獣」で3日目ボスを倒す", "以出擊「三首之獸」擊敗第三日的夜王"),
      // 這一顆只有 2 個效果（其餘 17 顆都是 3 個）。使用者 2026-09-25 確認「獣の夜 就只有
      // 兩個固定」，不是原始資料缺漏，不需要補第 3 條。
      ["攻撃命中時、スタミナ回復+1", "出撃時の武器に炎攻撃力を付加"]
    ),
    R(
      "relic_mist_night",
      C("霞の夜", "霞之夜"),
      C("出撃「霧の裂け目」で3日目ボスを倒す", "以出擊「霧之裂縫」擊敗第三日的夜王"),
      ["周囲で凍傷状態の発生時、自身の姿を隠す", "出撃時の武器の戦技を「冷気の霧」にする", "凍傷状態の敵に対する攻撃を強化"]
    ),
    R(
      "relic_deepsea_night",
      C("深海の夜", "深海之夜"),
      C("出撃「兆し」で3日目ボスを倒す", "以出擊「兆頭」擊敗第三日的夜王"),
      ["最大HP上昇", "聖杯瓶の回復を、周囲の味方に分配", "アイテムの効果が周囲の味方にも発動"]
    ),
    R(
      "relic_duke_night",
      C("爵の夜", "爵之夜"),
      C("出撃「喰らいつく顎」で3日目ボスを倒す", "以出擊「噬咬之顎」擊敗第三日的夜王"),
      ["致命の一撃強化+1", "致命の一撃で、アーツゲージ蓄積増加", "致命の一撃で、スタミナ回復速度上昇"]
    ),
    R(
      "relic_hunter_night",
      C("狩人の夜", "獵人之夜"),
      C("出撃「闇駆ける狩人」で3日目ボスを倒す", "以出擊「暗夜疾行的獵人」擊敗第三日的夜王"),
      ["最大スタミナ上昇", "ガードカウンターに、自身の現在HPの一部を加える", "刺突カウンター発生時、HP回復"]
    ),
    R(
      "relic_magic_night",
      C("魔の夜", "魔之夜"),
      C("出撃「調律の魔物」で3日目ボスを倒す", "以出擊「調律的魔物」擊敗第三日的夜王"),
      // 2026-09-25：原本中間還有「ジェスチャー「あぐら」により、発狂が蓄積」，使用者指示拿掉
      // ——ジェスチャー 這個機制在 midnight 完全不存在。這一顆因此只剩 2 個效果。
      ["出撃中、ショップでの購入に必要なルーンが大割引", "発狂状態になると、FP持続回復"]
    ),
    R(
      "relic_wisdom_night",
      C("識の夜", "識之夜"),
      C("出撃「知性の蟲」で3日目ボスを倒す", "以出擊「智性之蟲」擊敗第三日的夜王"),
      ["最大FP上昇", "出撃時の武器に毒の状態異常を付加", "周囲で毒/腐敗状態の発生時、攻撃力上昇"]
    ),
    R(
      "relic_king_night",
      C("王の夜", "王之夜"),
      C("出撃「夜を象る者」で3日目ボスを倒す", "以出擊「形塑夜晚者」擊敗第三日的夜王"),
      ["武器の持ち替え時、いずれかの属性攻撃力を付加", "属性攻撃力が付加された時、属性攻撃力上昇", "武器の持ち替え時、物理攻撃力上昇"]
    ),
    R(
      "relic_duke_dark_night",
      C("爵の暗き夜", "爵之暗夜"),
      C("「常夜の王エデレ」を倒す", "擊敗「常夜之王・艾德蕾」"),
      ["致命の一撃強化+1", "致命の一撃強化", "致命の一撃で、ルーンを取得"]
    ),
    R(
      "relic_hunter_dark_night",
      C("狩人の暗き夜", "獵人之暗夜"),
      C("「常夜の王フルゴール」を倒す", "擊敗「常夜之王・弗爾格爾」"),
      ["最大スタミナ上昇", "属性攻撃力が付加された時、属性攻撃力上昇", "敵を倒した時のアーツゲージ蓄積増加"]
    ),
    R(
      "relic_wisdom_dark_night",
      C("識の暗き夜", "識之暗夜"),
      C("「常夜の王グノスター」を倒す", "擊敗「常夜之王・格諾斯特」"),
      ["最大FP上昇", "攻撃連続時、FP回復", "魔術師塔の仕掛けが解除される度、最大FP上昇"]
    ),
    R(
      "relic_deepsea_dark_night",
      C("深海の暗き夜", "深海之暗夜"),
      C("「常夜の王マリス」を倒す", "擊敗「常夜之王・瑪莉絲」"),
      ["最大HP上昇", "HP持続回復", "HP低下時、周囲の味方を含めHPをゆっくりと回復"]
    ),
    R(
      "relic_mist_dark_night",
      C("霞の暗き夜", "霞之暗夜"),
      C("「常夜の王カリゴ」を倒す", "擊敗「常夜之王・卡利戈」"),
      ["周囲で凍傷状態の発生時、自身の姿を隠す", "出撃時の武器に冷気の状態異常を付加", "物理カット率上昇"]
    ),
    R(
      "relic_magic_dark_night",
      C("魔の暗き夜", "魔之暗夜"),
      C("「常夜の王リブラ」を倒す", "擊敗「常夜之王・利布拉」"),
      // 2026-09-25：同上，「ジェスチャー「あぐら」により、発狂が蓄積」已依使用者指示拿掉。
      ["攻撃を受けると攻撃力上昇", "発狂状態になると、FP持続回復"]
    ),
    R(
      "relic_beast_dark_night",
      C("獣の暗き夜", "獸之暗夜"),
      C("「常夜の王グラディウス」を倒す", "擊敗「常夜之王・格拉迪烏斯」"),
      ["攻撃命中時、スタミナ回復+1", "攻撃を受けると攻撃力上昇", "炎攻撃力上昇+2"]
    ),
    R(
      "relic_peaceful_will",
      C("安寧者の遺志", "安寧者的遺志"),
      C("「安寧者たち」をクリア", "通關「安寧者們」"),
      ["近接攻撃力上昇", "戦技攻撃力上昇", "FP持続回復"]
    ),
    R(
      "relic_rubble_night",
      C("瓦礫の夜", "瓦礫之夜"),
      C("出撃「瓦礫の王」で3日目ボスを倒す", "以出擊「瓦礫之王」擊敗第三日的夜王"),
      ["被ダメージ時、腐敗の状態異常を付加", "周囲で腐敗状態の発生時、HP持続回復", "状態異常ゲージがある時、徐々に攻撃力上昇"]
    ),
  ];

  // --------------------------------------------------------------------------
  // 固定遺物引用、但 EFFECTS 裡找不到完全相同名稱的效果（2026-09-25 全數解決）
  // --------------------------------------------------------------------------
  //   variant — EFFECTS 裡有同名的基礎版，固定遺物用的是「+1／+2／大」這種強化變體。
  //   renamed — EFFECTS 裡有語意相同但措辭不同的一條。
  //   missing — EFFECTS 裡完全沒有這條。
  // 使用者 2026-09-25 的決定，逐類記在 resolution 欄位，對應關係實作在下方的
  // FIXED_RELIC_EFFECT_ALIAS 與 resolveFixedRelicEffects()。這張表本身留著當歷史紀錄
  // ——之後看到某顆固定遺物的 effectId 跟顯示文字對不上時，來這裡查為什麼。
  var POOL_MISMATCH = [
    { text: "攻撃命中時、スタミナ回復+1", kind: "variant", pool: "攻撃命中時、スタミナ回復", resolution: "alias-high" },
    { text: "致命の一撃強化+1", kind: "variant", pool: "致命の一撃強化", resolution: "alias-high" },
    { text: "炎攻撃力上昇+2", kind: "variant", pool: "炎攻撃力上昇", resolution: "alias-high" },
    { text: "出撃中、ショップでの購入に必要なルーンが大割引", kind: "variant", pool: "出撃中、ショップでの購入に必要なルーンが割引", resolution: "alias-high" },
    { text: "凍傷状態の敵に対する攻撃を強化", kind: "renamed", pool: "凍傷状態の敵に対する威力が+", resolution: "alias" },
    { text: "物理カット率上昇", kind: "renamed", pool: "物理カット率+", resolution: "alias" },
    { text: "生命力+1", kind: "renamed", pool: "生命力+1 / 2 / 3", resolution: "alias" },
    { text: "周囲で毒/腐敗状態の発生時、攻撃力上昇", kind: "renamed", pool: "周囲で毒/腐敗状態発生時、攻撃力+", resolution: "alias" },
    { text: "アイテムの効果が周囲の味方にも発動", kind: "missing", pool: null, resolution: "added" },
    { text: "ジェスチャー「あぐら」により、発狂が蓄積", kind: "missing", pool: null, resolution: "removed" },
    { text: "近接攻撃力上昇", kind: "missing", pool: null, resolution: "added" },
    { text: "戦技攻撃力上昇", kind: "missing", pool: null, resolution: "added" },
    { text: "状態異常ゲージがある時、徐々に攻撃力上昇", kind: "missing", pool: null, resolution: "added" },
  ];

  // --------------------------------------------------------------------------
  // 固定遺物的效果名稱 → EFFECTS 的 id（只列名稱對不上的例外）
  // --------------------------------------------------------------------------
  // 完全同名的由 resolveFixedRelicEffects() 自動比對，不需要列在這裡；上面 POOL_MISMATCH
  // 標 resolution "added" 的 4 條也不需要——它們補建時就用了固定遺物引用的原文當 ja 名稱。
  //
  // high: true 是使用者 2026-09-25 明確規格「（variant）較高機率出現好效果」，選擇的是
  // 「只擲後段（必定高值）」：這一條在固定遺物上擲範圍時，改成只在 rollRangeValue() 的
  // 後 20% 區間內均勻取值，而不是一般的「前段 80%／後段 20%」。四條 variant 對應的效果
  // 都有 range（[1,2]／[6,12]%／[4,12]%／[10,20]%），所以這個旗標一定擲得出效果。
  // 實作在 midnight_relic_memory.js 的 rollRangeValue(min, max, rand, opts) 的 opts.high。
  var FIXED_RELIC_EFFECT_ALIAS = {
    // variant：同一條效果的強化版（+1／+2／大）。對應同一個 effect id，擲值只擲後段。
    "攻撃命中時、スタミナ回復+1": { id: "rm_hit_stamina_regen", high: true },
    "致命の一撃強化+1": { id: "rm_critical_up", high: true },
    "炎攻撃力上昇+2": { id: "rm_fire_atk_up", high: true },
    "出撃中、ショップでの購入に必要なルーンが大割引": { id: "rm_shop_discount", high: true },
    // renamed：措辭不同但是同一條，使用者 2026-09-25 指示「名稱對齊」。
    "凍傷状態の敵に対する攻撃を強化": { id: "rm_vs_frostbitten" },
    "物理カット率上昇": { id: "rm_physical_cut_up" },
    "生命力+1": { id: "rm_stat_vigor" },
    "周囲で毒/腐敗状態の発生時、攻撃力上昇": { id: "rm_nearby_poison_rot_atk" },
  };

  // FIXED_RELICS.effects 由字串陣列就地換成
  //   { text: 原文字串, effectId: 對應的 EFFECTS id 或 null, high: 是否為強化版 }
  // 的物件陣列。text 一律保留原文——固定遺物顯示的是遺物自己的措辭（「致命の一撃強化+1」），
  // 不是池中那條的名稱（「致命の一撃強化」），兩者不該被對應關係抹掉。
  // effectId 為 null 代表對應漏了；回歸測試（relic_memory_unit_check.js）會抓出來。
  function resolveFixedRelicEffects() {
    var byJa = {};
    for (var i = 0; i < EFFECTS.length; i++) byJa[EFFECTS[i].name.ja] = EFFECTS[i].id;
    for (var r = 0; r < FIXED_RELICS.length; r++) {
      FIXED_RELICS[r].effects = FIXED_RELICS[r].effects.map(function (text) {
        // 已經是物件（重複呼叫）時原樣回傳，避免二次解析把 text 弄丟。
        if (text && typeof text === "object") return text;
        var alias = FIXED_RELIC_EFFECT_ALIAS[text];
        return {
          text: text,
          effectId: alias ? alias.id : byJa[text] || null,
          high: !!(alias && alias.high),
        };
      });
    }
  }

  resolveFixedRelicEffects();

  function effect(id) {
    for (var i = 0; i < EFFECTS.length; i++) {
      if (EFFECTS[i].id === id) return EFFECTS[i];
    }
    return null;
  }

  function fixedRelic(id) {
    for (var i = 0; i < FIXED_RELICS.length; i++) {
      if (FIXED_RELICS[i].id === id) return FIXED_RELICS[i];
    }
    return null;
  }

  // 可以進抽選池的效果。排除三種：
  //   ・bad（悪効果）——使用者指示先建檔、暫不抽選，抽選規則未定（設計文件 §10.4）。
  //   ・use === "skip"——使用者明確決定不納入這套系統。
  //   ・relicOnly——這個欄位的語意就是「只出現在固定配置遺物上」，不該同時是隨機抽選的
  //     獎品。2026-09-25 的池擴充之前 midnight 根本沒在抽這份目錄，所以這 23 條
  //     （19 條既有 ＋ §10.6.1 補建的 4 條）從來沒有真的被抽到過，排除不會改變任何既有行為。
  //     這是依欄位語意做的判斷，不是使用者明確規格——要讓固定遺物的效果也能隨機抽到，
  //     把下面這一行的 !e.relicOnly 拿掉即可。
  // 角色專用（character 非 null）效果**不**排除：依使用者明確規格，別的角色也有機會抽到，
  // 只是同一顆記憶內的第 2 條會被 10% 門檻壓住（設計文件 §10.3）。
  // 第四種排除（2026-09-25）：missingData（d 旗標）——效果指向的招式／道具資料在本專案還不
  // 存在，抽到也接不上，使用者明確指示「先不進入抽選池」。
  function drawableEffects() {
    return EFFECTS.filter(function (e) {
      return !e.bad && !e.relicOnly && !e.missingData && e.use !== "skip";
    });
  }

  // 抽選池用的 id 清單，與 CharacterDrawer.allAttachedEffectIds() 併用（設計文件 §10.1
  // 「並存」：這份目錄不取代那 24 種附帶效果）。
  function drawableEffectIds() {
    return drawableEffects().map(function (e) {
      return e.id;
    });
  }

  // 角色專用效果的判定（rollEffects 的 opts.isExclusive）。不在這份目錄裡的 id
  // ——也就是 CharacterDrawer 那 24 種附帶效果——一律不是專用。
  function isExclusiveEffect(id) {
    var e = effect(id);
    return !!(e && e.character);
  }

  // 互斥組（使用者 2026-09-25 明確規格）：
  //   ・「出撃時の武器」組：武器屬性／異常附加（weaponInfusion）、戰技置換（grantWeaponSkill）、
  //     魔術／祈禱置換（grantSpell）——「初始武器帶屬性 帶戰技 等等 一個遺物記憶只能抽到一條」。
  //   ・結晶雫組（startFlask）——「結晶雫 一個遺物記憶只能帶一條」。
  // 抽選時同一顆記憶內每組最多一條（midnight_relic_memory.js 的 rollEffects() opts.exclusiveGroup）；
  // 帶入多顆記憶時同組只有帶入順序的**第一條**發動（「只會發動前面一個的效果」，
  // 見 midnight.js 的 relicMemoryFirstGroupEffectId()）。不在組內的效果回 null。
  //
  // 2026-09-25 第 2 次補充（使用者明確規格「一顆記憶只會出現最多一條」）：再加三組，
  //   ・全局里程碑（globalMilestone 7 條）
  //   ・出擊時道具（startItem 22 條）
  //   ・盧恩 3 條（致命の一撃でルーン取得／ショップ割引／自身と味方の取得ルーン増加）——
  //     kind 是 special，所以用 id 指定。小砦那條（rm_milestone_fort_rune）屬於全局里程碑組。
  // 「出撃時の武器」三類使用者這次分開列出，但前一次的規格是三類合為一組（「初始武器帶屬性
  // 帶戰技 等等 一個遺物記憶只能抽到一條」），合為一組同時滿足「每類最多一條」，因此維持。
  // 這三組只限制**抽選**；帶入時「同組只發動第一條」只套用在 startWeapon／crystalTear
  // （那兩組是單一欄位的置換／持有，見 LOADOUT_FIRST_ONLY_GROUPS）。
  var EXCLUSIVE_GROUP_BY_KIND = {
    weaponInfusion: "startWeapon",
    grantWeaponSkill: "startWeapon",
    grantSpell: "startWeapon",
    startFlask: "crystalTear",
    globalMilestone: "milestone",
    startItem: "startItem",
  };
  var EXCLUSIVE_GROUP_BY_ID = {
    rm_critical_rune: "rune",
    rm_shop_discount: "rune",
    rm_party_rune_up: "rune",
  };
  var LOADOUT_FIRST_ONLY_GROUPS = { startWeapon: true, crystalTear: true };

  function exclusiveGroup(id) {
    if (EXCLUSIVE_GROUP_BY_ID[id]) return EXCLUSIVE_GROUP_BY_ID[id];
    var e = effect(id);
    return (e && EXCLUSIVE_GROUP_BY_KIND[e.kind]) || null;
  }

  // 帶入多顆記憶時「同組只發動第一條」的組名；其餘回 null。
  function loadoutFirstOnlyGroup(id) {
    var g = exclusiveGroup(id);
    return g && LOADOUT_FIRST_ONLY_GROUPS[g] ? g : null;
  }

  // 固定配置遺物的取得條件（使用者 2026-09-25 明確規格「擊破三頭犬必定另外獲得」，
  // 其餘固定遺物比照）：midnight 判定得出的只有「以某劇本擊敗第 3 天夜王」這一種，
  // 以劇本 id（meta.resolvedNightBossId）對應。「安寧者たち をクリア」＝以劇本 balancers
  // 擊敗第 3 天夜王（midnight 的通關就是這一刻）。
  // 對不上的 8 顆不發放：「常夜の王○○」6 顆（midnight 沒有常夜之王）與「マルギット撃破」
  // （midnight 沒有這個敵人）。
  var FIXED_RELIC_BY_SCENARIO = {
    tricephalos: "relic_beast_night",
    fissure_in_the_fog: "relic_mist_night",
    augur: "relic_deepsea_night",
    gaping_jaw: "relic_duke_night",
    darkdrift_knight: "relic_hunter_night",
    equilibrious_beast: "relic_magic_night",
    sentient_pest: "relic_wisdom_night",
    night_aspect: "relic_king_night",
    dreglord: "relic_rubble_night",
    balancers: "relic_peaceful_will",
  };

  function fixedRelicIdForScenario(scenarioId) {
    return (scenarioId && FIXED_RELIC_BY_SCENARIO[scenarioId]) || null;
  }

  function badEffects() {
    return EFFECTS.filter(function (e) {
      return e.bad;
    });
  }

  // character 為 null 代表通用效果；有值代表 memory.txt 標了「専用【角色】」。
  function effectsForCharacter(typeId) {
    return EFFECTS.filter(function (e) {
      return e.character === typeId;
    });
  }

  // ==========================================================================
  // 能力值效果的換算表（第 3 期，2026-09-25 使用者補齊，設計文件 §10.14.1）
  // ==========================================================================
  // 這兩張表是**資料**（使用者給的規則換算），不是機制——實際的注入點分成兩邊：
  //   ・威力補正（力量／技巧／平衡／智力／信仰／神秘）在 character_drawer.js 的
  //     computeArtPower()／statPowerModValue()（那是威力補正的唯一出口）。
  //   ・HP／FP／體力上限在 midnight.js 的 selfArenaHpMax()／selfFpMax()／updateStamina()。
  // character_drawer.js 不載入 midnight.js 的任何東西（night 頁面沒有 midnight.js），
  // 所以兩邊共用的換算表只能放在這個資料檔，而不是 midnight.js 的 alias 表裡。
  //
  // midnight 沒有艾爾登法環那 8 種能力值，對應關係是使用者 2026-09-25 明確指定的：
  //   生命力→HP 上限　精神力→FP 上限　持久力→體力上限　強靭度→威力補正「平衡」
  //   筋力→力量　技量→技巧　知力→智力　信仰→信仰　神秘→神秘（威力補正既有的 5 種）

  // 值由 range 擲出來的 6 條：效果 id → 要加到哪一項威力補正。加的量是那顆記憶擲定的
  // value（都是 [1,3] flat）。
  var POWER_MOD_STAT_OF = {
    rm_stat_strength: "strength",
    rm_stat_dexterity: "dex",
    rm_stat_intelligence: "intelligence",
    rm_stat_faith: "faith",
    rm_stat_arcane: "arcane",
    rm_stat_poise: "balance",
  };

  // 角色專用的能力值互換 20 條：固定值，不擲範圍（原始資料就是「上昇/低下」的成套換算）。
  // hp／fp／stamina 是 flat 加減（跟武器詞條的最大HP上昇同一層，不是 ×10 的對象）。
  // 數值來源：tracker／guardian 那 4 條是 memory.txt 本來就附的 note，其餘 16 條是使用者
  // 2026-09-25 逐條指定的。使用者同時給了一條原則「FP・HP ±20／體力 ±15／其餘屬性 ±10」；
  // 逐條列表當時把體力寫成 ±20，使用者同日確認**以原則為準**，因此體力一律 ±15。
  var STAT_SWAPS = {
    // ---- 追蹤者（note 原本就有）----
    rm_tracker_mind_up_vig_down: { fp: 5, hp: -20 },
    rm_tracker_int_fth_up_str_dex_down: { powerMod: { intelligence: 10, faith: 10, strength: -10, dex: -10 } },
    // ---- 守護者（note 原本就有）----
    rm_guardian_str_dex_up_vig_down: { hp: -30, powerMod: { strength: 5, dex: 5 } },
    rm_guardian_mind_fth_up_vig_down: { fp: 10, hp: -30, powerMod: { faith: 10 } },
    // ---- 鐵之眼 ----
    rm_iron_eye_vig_str_up_dex_down: { hp: 20, powerMod: { strength: 10, dex: -10 } },
    rm_iron_eye_arc_up_dex_down: { powerMod: { arcane: 10, dex: -10 } },
    // ---- 淑女 ----
    rm_lady_vig_str_up_mind_down: { hp: 20, fp: -10, powerMod: { strength: 10 } },
    rm_lady_mind_fth_up_int_down: { fp: 20, powerMod: { faith: 10, intelligence: -10 } },
    // ---- 無賴漢 ----
    rm_ruffian_mind_int_up_vig_end_down: { fp: 20, hp: -20, stamina: -15, powerMod: { intelligence: 10 } },
    rm_ruffian_arc_up_vig_down: { hp: -20, powerMod: { arcane: 10 } },
    // ---- 復仇者 ----
    rm_avenger_vig_end_up_mind_down: { hp: 20, stamina: 15, fp: -10 },
    rm_avenger_str_up_fth_down: { powerMod: { strength: 10, faith: -10 } },
    // ---- 隱者 ----
    rm_hermit_vig_end_dex_up_int_fth_down: { hp: 20, stamina: 15, powerMod: { dex: 10, intelligence: -10, faith: -10 } },
    rm_hermit_int_fth_up_mind_down: { fp: -20, powerMod: { intelligence: 10, faith: 10 } },
    // ---- 執行者 ----
    rm_executor_vig_end_up_arc_down: { hp: 20, stamina: 15, powerMod: { arcane: -10 } },
    rm_executor_dex_arc_up_vig_down: { hp: -20, powerMod: { dex: 10, arcane: 10 } },
    // ---- 學者 ----
    rm_scholar_mind_up_vig_down: { fp: 20, hp: -20 },
    rm_scholar_end_dex_up_int_arc_down: { stamina: 15, powerMod: { dex: 10, intelligence: -10, arcane: -10 } },
    // ---- 葬儀屋 ----
    rm_undertaker_dex_up_vig_fth_down: { hp: -20, powerMod: { dex: 10, faith: -10 } },
    rm_undertaker_mind_fth_up_str_down: { fp: 20, powerMod: { faith: 10, strength: -10 } },
  };

  function powerModStatOf(id) {
    return POWER_MOD_STAT_OF[id] || null;
  }

  function statSwap(id) {
    return STAT_SWAPS[id] || null;
  }

  window.PriTestMidnightRelicMemoryCatalog = {
    EFFECTS: EFFECTS,
    POWER_MOD_STAT_OF: POWER_MOD_STAT_OF,
    STAT_SWAPS: STAT_SWAPS,
    powerModStatOf: powerModStatOf,
    statSwap: statSwap,
    FIXED_RELICS: FIXED_RELICS,
    POOL_MISMATCH: POOL_MISMATCH,
    FIXED_RELIC_EFFECT_ALIAS: FIXED_RELIC_EFFECT_ALIAS,
    effect: effect,
    fixedRelic: fixedRelic,
    drawableEffects: drawableEffects,
    drawableEffectIds: drawableEffectIds,
    isExclusiveEffect: isExclusiveEffect,
    exclusiveGroup: exclusiveGroup,
    loadoutFirstOnlyGroup: loadoutFirstOnlyGroup,
    FIXED_RELIC_BY_SCENARIO: FIXED_RELIC_BY_SCENARIO,
    fixedRelicIdForScenario: fixedRelicIdForScenario,
    badEffects: badEffects,
    effectsForCharacter: effectsForCharacter,
    localizedText: T,
  };
})();
