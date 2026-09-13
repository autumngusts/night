// ============================================================================
// 武器詞條（2026-09-13新增，使用者明確規格「在房間創立中 可以選擇武器詞條開放；開啟後
// 在遊戲中內獲得的武器杖聖印等 都會帶有詞條（除了初始裝備的武器）；C稀有度的一條 其他的
// 兩條詞條；抽選時一併抽出；第一條必定為有益效果 第二條60%機率為有益效果；當玩家的裝備欄
// 持有時 基本無須裝備在手上也能發動詞條效果」）。
// ============================================================================
// 這個檔案是**純參考資料**（比照consumables.js／talismans.js的既有分工，見CLAUDE.md §27.1）：
// 只放詞條的名稱、有益／有害分類、數值範圍與規則本文，實際的機制接入全部在
// static_src/midnight.js（見該檔的 AFFIX_* 區塊）。
//
// 語言：name的ja是使用者提供的原始詞條名（艾爾登法環的遺灰詞條名），zh是對應中譯。
// desc目前只有zh——那是使用者親自寫下的即時制換算規格本文，刻意不自行翻成日文（避免在
// 規則文字上產生二次走樣，CLAUDE.md §42.4）。localizedText()的既有fallback會讓ja/en
// 讀者看到zh本文，跟本專案「遊戲資料的en大多fallback」的既有狀況一致（CLAUDE.md §6）。
//
// 數值：使用者對多數詞條給了範圍（例「10%~20%」）。依使用者明確選擇，**取得武器時一次
// 擲定並存起來**，之後永遠是那個值（見midnight.jsのrollWeaponAffixes()）。range為null
// 代表這條詞條沒有可變數值。
//
// phase：1＝效果已接入；2＝尚未接入（UI照樣顯示，但會標注「效果尚未實作」，且
// midnight.jsのaffixTotal()／hasAffix()一律當成沒有這條，不會讓數值提前生效）。
// 2026-09-13第2批交付後全部101條都已接入，目前沒有phase 2的詞條；這個欄位保留給
// 日後新增詞條時的同一套「先上資料與UI、效果之後再接」流程。
//
// kind：給midnight.js的效果接入用的分類標籤。同一個kind的詞條共用同一個注入點，避免
// 每一條詞條各自寫一套判斷（CLAUDE.md §42.10「優先重用現有helper、generic pipeline」）。
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

  // range: [min, max]（兩者相同代表固定值）。unit決定UI怎麼顯示這個數字：
  //   "pct"  →「+12%」/「-12%」
  //   "flat" →「+12」/「-12」
  //   "sec"  →「12秒」
  //   "prob" →「12%機率」
  //   null   → 不顯示數字（詞條本文已經說完）
  function A(id, ja, zh, good, kind, range, unit, descZh, phase) {
    return {
      id: id,
      name: C(ja, zh),
      good: !!good,
      kind: kind,
      range: range || null,
      unit: unit || null,
      desc: { zh: descZh },
      phase: phase || 1,
    };
  }

  var AFFIXES = [
    // ---- 資源上限／持續增減 ----
    A("maxHpUp", "最大HP上昇", "最大HP上升", true, "maxStat", [5, 15], "flat", "最大HP+{v}。", 1),
    A("maxHpDown", "最大HP低下", "最大HP下降", false, "maxStat", [5, 15], "flat", "最大HP-{v}。", 1),
    A("maxFpUp", "最大FP上昇", "最大FP上升", true, "maxStat", [5, 15], "flat", "最大FP+{v}。", 1),
    A("maxFpDown", "最大FP低下", "最大FP下降", false, "maxStat", [5, 15], "flat", "最大FP-{v}。", 1),
    A("maxStaminaUp", "最大スタミナ上昇", "最大體力上升", true, "maxStat", [5, 15], "flat", "最大體力+{v}。", 1),
    A("maxStaminaDown", "最大スタミナ低下", "最大體力下降", false, "maxStat", [5, 15], "flat", "最大體力-{v}。", 1),
    A("guardianRegret", "守護者の無念", "守護者的無念", true, "maxStat", [5, 15], "flat", "最大HP與最大體力各+{v}。", 1),
    A("hpRegen", "HP持続回復1", "HP持續回復", true, "overTime", [1, 1], "flat", "每10秒回復HP{v}點。", 1),
    A("hpDrain", "HP持続減少", "HP持續減少", false, "overTime", [1, 1], "flat", "每30秒扣除HP{v}點。", 1),
    A("staminaRegenUp", "スタミナ回復速度上昇", "體力回復速度上升", true, "staminaRegen", [1, 2], "flat", "體力每秒回復量+{v}。", 1),

    // ---- HP未滿／HP低下時的條件效果 ----
    A("hpNotFullArtSlow", "HP最大未満時、アーツゲージ蓄積鈍化", "HP未滿時技藝充能變慢", false, "artCooldown", [20, 20], "pct", "HP未達最大值時，技藝冷卻時間延長{v}%。", 1),
    A("hpNotFullAtkDown", "HP最大未満時、攻撃力低下", "HP未滿時攻擊力下降", false, "atkPct", [10, 20], "pct", "HP未達最大值時，自身造成的傷害-{v}%。", 1),
    A("hpNotFullPoison", "HP最大未満時、毒が蓄積", "HP未滿時累積猛毒", false, "overTime", [1, 1], "flat", "HP未達最大值時，每30秒自身累積猛毒{v}（不限戰鬥中）。", 1),
    A("hpNotFullRot", "HP最大未満時、腐敗が蓄積", "HP未滿時累積腐敗", false, "overTime", [1, 1], "flat", "HP未達最大值時，每30秒自身累積腐敗{v}（不限戰鬥中）。", 1),
    A("lowHpGuardUp", "HP低下時、カット率上昇", "HP低下時減傷上升", true, "guardValue", [12, 36], "flat", "HP在30%以下時，HP價值+{v}。", 1),
    A("lowHpAtkUp", "HP低下時、攻撃力上昇", "HP低下時攻擊力上升", true, "atkPct", [7, 15], "pct", "HP在30%以下時，自身造成的傷害+{v}%。", 1),
    A("lowStaminaGuardDown", "スタミナ低下時、カット率低下", "體力低下時減傷下降", false, "guardValue", [7, 15], "flat", "體力在30%以下時，HP價值-{v}。", 1),

    // ---- 防禦（ガード）系 ----
    A("guardCounterUp", "ガードカウンター強化", "防禦反擊強化", true, "atkPct", [7, 15], "pct", "防禦反擊造成的傷害+{v}%。", 1),
    A("guardBreakChance", "ガードを崩す力上昇", "破防力上升", true, "onGuardSuccess", [10, 20], "prob", "防禦成功時，{v}%機率對敵人追加一個▲破防。", 1),
    A("guardSpellUp", "ガード成功時、魔術／祈祷強化", "防禦成功時魔術／祈禱強化", true, "onGuardSuccess", [15, 15], "pct", "防禦成功後5秒內，魔術／祈禱傷害+{v}%。", 1),
    A("guardCutUp", "ガード成功時、カット率上昇", "防禦成功時減傷上升", true, "onGuardSuccess", [7, 15], "flat", "防禦成功後，HP價值+{v}。", 1),
    A("guardStaminaUp", "ガード成功時、強靭度上昇", "防禦成功時強韌上升", true, "onGuardSuccess", [1, 3], "flat", "防禦成功時，體力回復{v}。", 1),
    A("poiseUp", "強靭度上昇", "強韌度上升", true, "guardValue", [5, 10], "flat", "HP價值+{v}。", 1),
    A("holyGroundOnGuard", "盾を構えていると、聖域を展開", "持續防禦展開聖域", true, "special", null, null, "持續架起防禦3秒後展開聖域：戰鬥中全員10秒內HP回復20、HP價值+10，冷卻20秒。", 1),
    A("walkCurseSpirit", "歩きで、呪霊を放つ", "行進中放出咒靈", true, "special", null, null, "架起防禦超過3秒時，產生咒靈特效攻擊敵人，造成神秘威力補正的傷害，冷卻10秒。", 1),
    A("walkBurn", "歩きで、周囲を激しく焼く", "行進中灼燒周圍", true, "special", null, null, "架起防禦超過3秒時，產生燃燒特效攻擊敵人，造成智力威力補正的傷害，冷卻10秒。", 1),
    A("walkRedLightning", "歩きで、赤い落雷を周囲に呼ぶ", "行進中召來赤雷", true, "special", null, null, "架起防禦超過3秒時，產生落雷特效攻擊敵人，造成智力威力補正的傷害，冷卻10秒。", 1),

    // ---- 蓄力攻擊（タメ攻撃）系 ----
    A("chargePhantom", "タメ攻撃で、幻影が攻撃", "蓄力攻擊召出幻影", true, "special", [5, 5], "pct", "蓄力攻擊時追加幻影攻擊特效，傷害+{v}%。", 1),
    A("chargeBlackFlame", "タメ攻撃で、黒炎を撒く", "蓄力攻擊散布黑炎", true, "special", null, null, "蓄力攻擊時追加黑炎特效，造成智力威力補正的傷害。", 1),
    A("chargeSleepMist", "タメ攻撃で、睡眠の霧を発生", "蓄力攻擊產生睡眠霧", true, "special", [1, 1], "flat", "蓄力攻擊時追加睡眠之霧特效，睡眠蓄積+{v}。", 1),
    A("chargeHolyWave", "タメ攻撃で、聖衝撃波を発生", "蓄力攻擊產生聖衝擊波", true, "special", null, null, "蓄力攻擊時追加聖衝擊波特效，造成信仰威力補正的傷害。", 1),
    A("chargeIceStorm", "タメ攻撃で、氷嵐を発生", "蓄力攻擊產生冰嵐", true, "special", null, null, "蓄力攻擊時追加冰嵐特效，造成神秘威力補正的傷害。", 1),
    A("chargeMagicBolt", "タメ攻撃で、魔力弾が追撃", "蓄力攻擊追加魔力彈", true, "special", null, null, "蓄力攻擊時追加魔力彈特效，造成智力威力補正的傷害。", 1),
    A("chargeLava", "タメ攻撃で、溶岩が発生", "蓄力攻擊產生熔岩", true, "special", null, null, "蓄力攻擊時追加熔岩特效，造成智力威力補正的傷害。", 1),
    A("chargeAtkUp", "タメ攻撃強化", "蓄力攻擊強化", true, "atkPct", [6, 12], "pct", "蓄力攻擊造成的傷害+{v}%。", 1),
    A("chargeGuardUp", "タメ攻撃時、カット率上昇", "蓄力攻擊時減傷上升", true, "guardValue", [20, 40], "flat", "蓄力攻擊過程中，HP價值+{v}。", 1),
    A("chargeHolyAccum", "タメ攻撃時、聖攻撃が発生", "蓄力攻擊附加聖屬性", true, "onCharge", [50, 50], "prob", "蓄力攻擊時，{v}%機率對敵人追加聖蓄積+1。", 1),
    A("chargeMagicAccum", "タメ攻撃時、魔力攻撃が発生", "蓄力攻擊附加魔屬性", true, "onCharge", [50, 50], "prob", "蓄力攻擊時，{v}%機率對敵人追加魔蓄積+1。", 1),
    A("chargeLightningAccum", "タメ攻撃時、雷攻撃が発生", "蓄力攻擊附加雷屬性", true, "onCharge", [50, 50], "prob", "蓄力攻擊時，{v}%機率對敵人追加雷蓄積+1。", 1),

    // ---- 迴避／跳躍／連擊 ----
    A("jumpAtkUp", "ジャンプ攻撃強化", "跳躍攻擊強化", true, "atkPct", [6, 12], "pct", "跳躍攻擊造成的傷害+{v}%。", 1),
    A("dodgeDamageTakenUp", "回避直後の被ダメージ増加", "迴避後受傷增加", false, "damageTaken", [10, 10], "pct", "迴避後5秒內，自身受到的傷害+{v}%。", 1),
    A("dodgeGuardDown", "回避連続時、カット率低下", "連續迴避時減傷下降", false, "guardValue", [15, 15], "flat", "迴避後5秒內，HP價值-{v}。", 1),
    A("comboGuardUp", "攻撃連続時、一度だけカット率上昇", "連擊時單次減傷上升", true, "guardValue", [20, 45], "flat", "打出2Hit攻擊後3秒內，HP價值+{v}。", 1),
    A("finalHitUp", "連撃の最終攻撃強化", "連擊最終攻擊強化", true, "atkPct", [10, 20], "pct", "2Hit攻擊造成的傷害+{v}%。", 1),
    A("attackGraze", "攻撃時、稀に攻撃がかすめる", "攻擊偶爾擦身而過", false, "onAttack", [3, 5], "prob", "攻擊時{v}%機率完全不造成傷害。", 1),

    // ---- 射擊系 ----
    A("rangedAtkUp", "射撃攻撃強化", "射擊攻擊強化", true, "atkPct", [8, 16], "pct", "射擊武器造成的傷害+{v}%。", 1),
    A("shotBleed", "精密射撃で、着弾時に血蠅を発生", "精準射擊產生血蠅", true, "onRanged", [5, 10], "prob", "射擊時{v}%機率給予敵人出血1。", 1),
    A("shotPoison", "精密射撃で、着弾時に毒の霧を発生", "精準射擊產生毒霧", true, "onRanged", [5, 10], "prob", "射擊時{v}%機率給予敵人猛毒1。", 1),
    A("shotRot", "精密射撃で、着弾時に腐敗の霧を発生", "精準射擊產生腐敗霧", true, "onRanged", [5, 10], "prob", "射擊時{v}%機率給予敵人腐敗1。", 1),
    A("shotLightning", "精密射撃で、着弾時に落雷を発生", "精準射擊產生落雷", true, "onRanged", [5, 10], "prob", "射擊時{v}%機率給予敵人雷1。", 1),

    // ---- 屬性攻擊力／減傷 ----
    A("fireCutUp", "炎カット率上昇", "炎減傷上升", true, "accumResist", [15, 15], "prob", "受到的炎蓄積有{v}%機率不會累積。", 1),
    A("fireAtkUp", "炎攻撃力上昇", "炎攻擊力上升", true, "elementAtkPct", [6, 9], "pct", "帶有炎屬性的攻擊傷害+{v}%。", 1),
    A("holyCutUp", "聖カット率上昇", "聖減傷上升", true, "elementDamageTaken", [15, 15], "pct", "敵人帶有聖屬性的攻擊傷害-{v}%。", 1),
    A("holyAtkUp", "聖攻撃力上昇", "聖攻擊力上升", true, "elementAtkPct", [6, 12], "pct", "帶有聖屬性的攻擊傷害+{v}%。", 1),
    A("magicCutUp", "魔力カット率上昇", "魔力減傷上升", true, "elementDamageTaken", [15, 15], "pct", "敵人帶有魔屬性的攻擊傷害-{v}%。", 1),
    A("magicAtkUp", "魔力攻撃力上昇", "魔力攻擊力上升", true, "elementAtkPct", [6, 12], "pct", "帶有魔屬性的攻擊與戰技傷害+{v}%。", 1),
    A("lightningCutUp", "雷カット率上昇", "雷減傷上升", true, "elementDamageTaken", [15, 15], "pct", "敵人帶有雷屬性的攻擊傷害-{v}%。", 1),
    // 使用者原文的括號說明寫成「帶有魔屬性」，但詞條名與數值範圍（6~9%，跟炎攻撃力上昇
    // 同一組）都指向雷，判定為與上一條魔力攻撃力上昇混到的筆誤，這裡依詞條名實作為雷。
    A("lightningAtkUp", "雷攻撃力上昇", "雷攻擊力上升", true, "elementAtkPct", [6, 9], "pct", "帶有雷屬性的攻擊與戰技傷害+{v}%。", 1),
    A("elementAtkUp", "属性攻撃力上昇", "屬性攻擊力上升", true, "elementAtkPct", [10, 10], "pct", "帶有任一屬性的攻擊傷害+{v}%。", 1),
    A("elementCutDown", "属性カット率低下", "屬性減傷下降", false, "elementDamageTaken", [10, 10], "pct", "敵人帶有屬性的攻擊對自身傷害+{v}%。", 1),
    A("physicalAtkUp", "物理攻撃力上昇", "物理攻擊力上升", true, "physicalAtkPct", [5, 12], "pct", "不帶屬性的攻擊傷害+{v}%。", 1),
    A("physicalCutDown", "物理カット率低下", "物理減傷下降", false, "physicalDamageTaken", [5, 12], "pct", "不帶屬性的敵人傷害對自身+{v}%。", 1),

    // ---- 異常狀態耐性 ----
    A("bleedResist", "出血耐性上昇75", "出血耐性上升", true, "accumResist", [50, 50], "prob", "受到的出血蓄積有{v}%機率不會累積。", 1),
    A("sleepResist", "睡眠耐性上昇", "睡眠耐性上升", true, "accumResist", [50, 50], "prob", "受到的睡眠蓄積有{v}%機率不會累積。", 1),
    A("poisonResist", "毒耐性上昇75", "猛毒耐性上升", true, "accumResist", [50, 50], "prob", "受到的猛毒蓄積有{v}%機率不會累積。", 1),
    A("rotResist", "腐敗耐性上昇57", "腐敗耐性上升", true, "accumResist", [50, 50], "prob", "受到的腐敗蓄積有{v}%機率不會累積。", 1),
    A("madnessResist", "発狂耐性上昇57", "發狂耐性上升", true, "accumResist", [50, 50], "prob", "受到的發狂蓄積有{v}%機率不會累積。", 1),
    A("deathResist", "即死耐性上昇112", "即死耐性上升", true, "accumResist", [50, 50], "prob", "受到的呪死蓄積有{v}%機率不會累積。", 1),
    A("allAilmentResistUp", "全状態異常耐性を高める", "全異常狀態耐性提高", true, "accumThreshold", [2, 2], "flat", "屬性蓄積與異常狀態蓄積的觸發上限+{v}（更不容易觸發）。", 1),
    A("allAilmentResistDown", "すべての状態異常耐性低下", "全異常狀態耐性下降", false, "accumThreshold", [2, 2], "flat", "屬性蓄積與異常狀態蓄積的觸發上限-{v}（更容易觸發）。", 1),
    A("ailmentDamageTakenUp", "状態異常による被ダメージ増加", "異常狀態時受傷增加", false, "damageTaken", [10, 10], "pct", "自身帶有屬性／異常狀態蓄積時，受到的傷害+{v}%。", 1),

    // ---- 魔術／祈禱 ----
    A("castSpeedUp", "魔術/祈祷、詠唱速度上昇1", "魔術／祈禱詠唱速度上升", true, "castSpeed", [10, 10], "pct", "魔術／祈禱的詠唱時間-{v}%。", 1),
    A("castFpDown", "魔術/祈祷、消費FP軽減", "魔術／祈禱消耗FP減輕", true, "castFpCost", [10, 20], "pct", "魔術／祈禱消耗的FP-{v}%。", 1),
    A("castDurationUp", "魔術/祈祷の効果時間延長", "魔術／祈禱效果時間延長", true, "buffDuration", [5, 5], "sec", "魔術／祈禱產生的持續效果延長{v}秒。", 1),
    A("spellUp", "魔術/祈祷強化", "魔術／祈禱強化", true, "atkPct", [10, 10], "pct", "魔術與祈禱造成的傷害+{v}%。", 1),
    A("sorceryUp", "魔術強化", "魔術強化", true, "atkPct", [5, 11], "pct", "魔術造成的傷害+{v}%。", 1),
    A("prayerUp", "祈祷強化", "祈禱強化", true, "atkPct", [5, 12], "pct", "祈禱造成的傷害+{v}%。", 1),
    A("prayerDurationUp", "祈祷タメ強化", "祈禱蓄力強化", true, "buffDuration", [2, 5], "sec", "祈禱產生的持續效果延長{v}秒。", 1),
    A("castingGuardUp", "魔法詠唱中、カット率上昇", "詠唱中減傷上升", true, "damageTaken", [12, 24], "pct", "魔術／祈禱詠唱中，自身受到的傷害-{v}%。", 1),
    A("fpRecoverOnEmptyCast", "FP不足による魔術/祈祷でFP回復", "FP不足詠唱回復FP", true, "castNoFp", [10, 10], "flat", "FP不足時仍可施放魔術／祈禱：不產生效果，但回復FP{v}點。", 1),

    // ---- 戰技／致命／體崩 ----
    A("weaponArtUp", "戦技攻撃力上昇", "戰技攻擊力上升", true, "atkPct", [8, 11], "pct", "戰技造成的傷害+{v}%。", 1),
    A("executionUp", "致命の一撃強化", "致命一擊強化", true, "atkPct", [8, 16], "pct", "致命一擊造成的傷害+{v}%。", 1),
    A("staggerPowerUp", "体勢を崩す力上昇", "破防力上升", true, "onAttack", [20, 20], "prob", "使用帶有破防的攻擊時，{v}%機率再追加一個▲。", 1),
    A("dualWieldStaggerUp", "二刀持ちの、体勢を崩す力上昇", "雙持破防力上升", true, "staggerThreshold", [10, 20], "pct", "左右手裝備兩把不同武器時，自身造成的體崩蓄積+{v}%。", 1),
    A("dualWieldAtkUp", "二刀持ちの攻撃力上昇", "雙持攻擊力上升", true, "atkPct", [7, 13], "pct", "左右手裝備兩把不同武器時，造成的傷害+{v}%。", 1),
    // 使用者原文的括號說明寫成「雙持兩把不同武器時」，但那是上一條二刀持ち的條件；
    // 両手持ち在本專案既有機制中＝左右手裝備同一把武器（見midnight.jsのtwoHandGuardBreakSymbol()
    // 「c.equippedWeaponIdL !== c.equippedWeaponIdR則不成立」），這裡依詞條名實作為雙手持握。
    A("twoHandAtkUp", "両手持ちの攻撃力上昇", "雙手持握攻擊力上升", true, "atkPct", [7, 13], "pct", "左右手裝備同一把武器（雙手持握）時，造成的傷害+{v}%。", 1),

    // ---- 聖杯瓶 ----
    A("flaskFpRecover", "聖杯瓶の回復で、FPも回復", "聖杯瓶同時回復FP", true, "flask", [10, 10], "flat", "使用聖杯瓶時額外回復FP{v}點。", 1),
    A("flaskHealUp", "聖杯瓶の回復量上昇", "聖杯瓶回復量上升", true, "flask", [10, 10], "flat", "聖杯瓶的回復量+{v}。", 1),
    A("flaskHealDown", "聖杯瓶の回復量低下", "聖杯瓶回復量下降", false, "flask", [10, 10], "flat", "聖杯瓶的回復量-{v}。", 1),
    A("flaskGuardDown", "聖杯瓶使用時、カット率低下", "聖杯瓶使用時減傷下降", false, "guardValue", [10, 10], "flat", "使用聖杯瓶期間，HP價值-{v}。", 1),

    // ---- 受傷／擊破／瀕死 ----
    A("onDamagedFp", "被ダメージ時、FP回復2", "受傷時回復FP", true, "onDamaged", [4, 6], "flat", "受到傷害時，FP回復{v}。", 1),
    A("onDamagedGuardUp", "被ダメージ時、カット率上昇", "受傷時減傷上升", true, "onDamaged", [8, 16], "flat", "受到傷害後10秒內，HP價值+{v}。", 1),
    A("onKillFp", "敵撃破時、FP回復10", "擊破敵人時回復FP", true, "onKill", [10, 10], "flat", "擊破敵人時，FP回復{v}。", 1),
    A("onKillHp", "敵撃破時、HP回復20", "擊破敵人時回復HP", true, "onKill", [20, 20], "flat", "擊破敵人時，HP回復{v}。", 1),
    A("onKillRune", "敵撃破時、取得ルーン増加", "擊破敵人時盧恩增加", true, "onKill", [1, 1], "flat", "擊破敵人時，自身額外獲得盧恩{v}。", 1),
    A("nearDeathArtPenalty", "瀕死時、アーツゲージが減少", "瀕死時技藝充能減少", false, "nearDeath", [60, 60], "sec", "進入瀕死時，技藝冷卻延長{v}秒。", 1),
    A("nearDeathMaxHpDown", "瀕死時、最大HP低下", "瀕死時最大HP下降", false, "nearDeath", [10, 10], "flat", "進入瀕死時，最大HP-{v}（不會低於100）。", 1),

    // ---- 其他 ----
    A("lowAggro", "敵から狙われ難くなる", "不易被敵人鎖定", true, "aggro", [15, 15], "pct", "自身計入敵人仇恨值的傷害總和-{v}%。", 1),
    A("discoveryUp", "発見力上昇", "發現力上升", true, "discovery", [1, 2], "flat", "抽選時的稀有度點數+{v}。", 1),
    A("nightDamageTakenUp", "夜が深まるほど被ダメージ増加", "夜越深受傷越重", false, "damageTaken", null, null, "第一次縮圈後自身受到的傷害+5%，第二次縮圈後+10%。", 1),
    A("nightRainDamageUp", "夜の雨の被ダメージ増加", "夜雨傷害增加", false, "nightRain", [2, 2], "flat", "自身受到的夜雨傷害+{v}。", 1),
  ];

  var BY_ID = {};
  AFFIXES.forEach(function (a) {
    BY_ID[a.id] = a;
  });

  function get(id) {
    return BY_ID[id] || null;
  }

  function list() {
    return AFFIXES.slice();
  }

  function listByGood(good) {
    return AFFIXES.filter(function (a) {
      return a.good === !!good;
    });
  }

  // 詞條本文中的「{v}」替換成實際擲定的數值（見midnight.jsのrollWeaponAffixes()）。
  // value為null（沒有可變數值的詞條）時原樣回傳。
  function describe(affix, value) {
    var text = T(affix && affix.desc);
    if (value === null || value === undefined) return text;
    return text.replace(/\{v\}/g, String(value));
  }

  window.PriTestWeaponAffixes = {
    list: list,
    listByGood: listByGood,
    get: get,
    describe: describe,
    localizedText: T,
  };
})();
